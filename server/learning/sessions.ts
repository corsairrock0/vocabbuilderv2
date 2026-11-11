// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
/** Study sessions: creation (planning), attempts (grading + scheduling), resume, completion. */
import { randomUUID } from 'node:crypto';
import type { App } from '../app.ts';
import type { Db } from '../db/database.ts';
import { json } from '../db/database.ts';
import { HttpError, notFound } from '../http/http.ts';
import { checkAnswer, checkChoice, type CheckResult, type Grade } from '../../shared/answer.ts';
import {
  aggregateInitialRating,
  attemptScore,
  isSuccess,
  KINDS,
  planRemediation,
  suggestRating,
  type CardSkill,
  type ExerciseKind,
} from '../../shared/exercises.ts';
import { fuzzSeed, seededRandom, type Rating } from '../../shared/fsrs.ts';
import type { LanguageCode } from '../../shared/languages.ts';
import type {
  ActiveSessionInfo,
  AttemptRequest,
  AttemptResponse,
  ExercisePayload,
  ExerciseResult,
  ItemResource,
  PlanMeta,
  ReviewChange,
  SessionConfig,
  SessionExercise,
  SessionSummary,
  StudyPreview,
  StudySession,
} from '../../shared/types.ts';
import { addDays, endOfLocalDay, localDay, startOfLocalDay } from '../../shared/time.ts';
import { getLanguageSettings, getTimezone } from '../services/settings.ts';
import { DEFAULT_STUDY_MODE } from '../../shared/settings.ts';
import { MAX_ANSWER_ACTIVE_MS, mergeRound, roundTotals, type RoundEvent } from '../../shared/activity.ts';
import { mixCounts, planPractice, practiceLeft } from '../../shared/mix.ts';
import { ensureItem, loadStudyEntries } from '../vocab/repo.ts';
import { planSession, type DueCardInfo, type Performance } from './planner.ts';
import { applyReview, bumpDaily, dueAsOf, ensureCards, getCard, schedulerFor, updateEvidence, type CardRow } from './scheduling.ts';
import type { PoolEntry } from './payloads.ts';
import { exactLookup } from './grammar.ts';
import { nextSentence } from './writing.ts';

const STALE_MS = 12 * 3600_000;
/** The most active time one answer or event can add (the device splits longer stretches, such as a practice round). */
const MAX_ACTIVE_DELTA_MS = MAX_ANSWER_ACTIVE_MS;

interface SessionRow {
  id: string;
  language_code: LanguageCode;
  status: StudySession['status'];
  mode: string;
  config: string;
  plan_meta: string;
  resources: string;
  created_at: number;
  started_at: number | null;
  last_activity_at: number | null;
  ended_at: number | null;
  active_ms: number;
  summary: string | null;
}

interface ExerciseRow {
  id: string;
  session_id: string;
  seq: number;
  stage: string;
  item_id: number;
  card_skill: CardSkill | null;
  kind: ExerciseKind;
  priority: 'core' | 'optional';
  origin: 'plan' | 'remediation';
  parent_id: string | null;
  payload: string;
  status: 'pending' | 'done' | 'skipped';
  completed_at: number | null;
  attempt_id: number | null;
}

function tzOf(app: App) {
  return getTimezone(app.db, app.config.defaultTimezone);
}

// ------------------------------------------------------------------ planning inputs

/** The pace before a learner has finished sessions to measure: sessions took about twice the model's time (1.8.4). */
export const DEFAULT_PACE = 2;

/**
 * How much longer than the time model this learner's sessions take in real life (1.8.4): the active time of the last
 * ten sessions finished in the past 30 days (at least two minutes and half their exercises done) against the model
 * time their plans filled, weighted by the minutes done. A plan that could not fill its time (too few words to study)
 * says nothing about pace and is left out. DEFAULT_PACE without such sessions; between 1 and 3.
 */
export function sessionPace(db: Db, language: LanguageCode, now: number): number {
  const rows = db.all<{ active_ms: number; config: string; plan_meta: string; done: number; planned: number }>(
    `SELECT s.active_ms, s.config, s.plan_meta,
            (SELECT COUNT(*) FROM session_exercises e WHERE e.session_id = s.id AND e.origin = 'plan' AND e.status != 'pending') AS done,
            (SELECT COUNT(*) FROM session_exercises e WHERE e.session_id = s.id AND e.origin = 'plan') AS planned
       FROM study_sessions s
      WHERE s.language_code = ? AND s.status IN ('completed', 'abandoned') AND s.created_at > ? AND s.active_ms >= 120000
      ORDER BY s.created_at DESC LIMIT 10`,
    language,
    now - 30 * 86_400_000,
  );
  let sum = 0;
  let weight = 0;
  for (const r of rows) {
    const config = json<Partial<SessionConfig>>(r.config, {});
    const meta = json<Partial<PlanMeta>>(r.plan_meta, {});
    const minutes = Number(config.minutes) || 0;
    if (minutes <= 0 || r.planned < 5) continue;
    const done = r.done / r.planned;
    if (done < 0.5) continue;
    const used = Math.min(3, Math.max(1, Number(meta.pace) || 1));
    const modelBudget = ((Number(meta.budgetSeconds) || minutes * 60) / used) * (config.mode === 'comprehensive' ? 0.65 : 1);
    if ((Number(meta.estimatedSeconds) || 0) < 0.85 * modelBudget) continue;
    // Real time per planned minute, times the pace the plan used: the pace that would have fitted.
    const ratio = r.active_ms / (minutes * 60_000 * done);
    sum += used * ratio * minutes * done;
    weight += minutes * done;
  }
  return weight ? Math.min(3, Math.max(1, Math.round((sum / weight) * 100) / 100)) : DEFAULT_PACE;
}

function performanceFor(db: Db, language: LanguageCode, now: number): Performance {
  const since = now - 14 * 86_400_000;
  const rows = db.all<{ kind: ExerciseKind; skill: string; grade: Grade | 'self'; self_rating: number | null; latency_ms: number | null; feedback_code: string | null }>(
    "SELECT kind, skill, grade, self_rating, latency_ms, feedback_code FROM exercise_attempts WHERE language_code = ? AND answered_at > ? AND kind != 'intro'",
    language,
    since,
  );
  const acc = (filter: (r: (typeof rows)[number]) => boolean) => {
    const xs = rows.filter(filter);
    return xs.length >= 5 ? xs.filter((r) => isSuccess(r.grade, r.self_rating)).length / xs.length : null;
  };
  const reviews = db.get<{ n: number; ok: number }>(
    "SELECT COUNT(*) AS n, SUM(rating > 1) AS ok FROM review_logs WHERE language_code = ? AND reviewed_at > ? AND rating_source != 'aggregate'",
    language,
    since,
  )!;
  const infl = rows.filter((r) => r.kind === 'cloze_typed' || r.kind === 'form_typed');
  const latency: Partial<Record<ExerciseKind, number>> = {};
  const byKind = new Map<ExerciseKind, number[]>();
  for (const r of rows) if (r.latency_ms && r.latency_ms < 120_000 && r.grade !== 'incorrect') (byKind.get(r.kind) ?? byKind.set(r.kind, []).get(r.kind)!).push(r.latency_ms);
  for (const [k, xs] of byKind) {
    if (xs.length < 5) continue;
    xs.sort((a, b) => a - b);
    latency[k] = Math.min(xs[Math.floor(xs.length / 2)], KINDS[k].seconds * 3000);
  }
  return {
    attemptsLast14d: rows.length,
    reviewAccuracy: reviews.n >= 10 ? (reviews.ok ?? 0) / reviews.n : null,
    recognition: acc((r) => r.skill === 'recognition' || r.skill === 'comprehension'),
    listening: acc((r) => r.skill === 'listening'),
    recall: acc((r) => r.skill === 'recall'),
    production: acc((r) => r.skill === 'recall' || r.skill === 'production' || (r.skill === 'sentence' && r.kind === 'cloze_typed')),
    inflectionErrorRate: infl.length >= 5 ? infl.filter((r) => r.feedback_code === 'wrong_form').length / infl.length : null,
    latencyMsByKind: latency,
    pace: sessionPace(db, language, now),
  };
}

function introducedToday(db: Db, language: LanguageCode, day: string): number {
  return db.get<{ introduced: number }>('SELECT introduced FROM daily_stats WHERE language_code = ? AND local_day = ?', language, day)?.introduced ?? 0;
}

export function normalizeConfig(app: App, raw: Partial<SessionConfig> & { language: LanguageCode }, now: number): SessionConfig {
  const s = getLanguageSettings(app.db, raw.language);
  const tz = tzOf(app);
  const quick = !!raw.quick;
  const remainingDaily = Math.max(0, s.dailyNewTarget - introducedToday(app.db, raw.language, localDay(now, tz)));
  return {
    language: raw.language,
    minutes: raw.minutes ?? s.sessionMinutes,
    newWords: raw.newWords ?? (quick ? remainingDaily : s.dailyNewTarget),
    difficulty: raw.difficulty ?? s.difficulty,
    focus: raw.focus ?? s.focus,
    mode: raw.mode ?? DEFAULT_STUDY_MODE,
    frequencyMin: raw.frequencyMin !== undefined ? raw.frequencyMin : s.frequencyMin,
    frequencyMax: raw.frequencyMax !== undefined ? raw.frequencyMax : s.frequencyMax,
    tag: raw.tag ?? null,
    quick,
  };
}

// ------------------------------------------------------------------ create

export function createSession(
  app: App,
  input: { id: string; config: SessionConfig; prepared?: boolean; replaceActive?: boolean },
  now: number,
  deviceId: string | null,
): StudySession {
  const db = app.db;
  const existing = db.get<SessionRow>('SELECT * FROM study_sessions WHERE id = ?', input.id);
  if (existing) return getSession(app, input.id);
  const { config } = input;
  const language = config.language;
  const tz = tzOf(app);
  finalizeStaleSessions(app, now);
  const active = db.get<SessionRow>("SELECT * FROM study_sessions WHERE language_code = ? AND status IN ('active', 'paused') ORDER BY last_activity_at DESC LIMIT 1", language);
  if (active && !input.prepared) {
    if (!input.replaceActive) {
      throw new HttpError(409, 'active_session_exists', 'You have an unfinished session in this language.', { sessionId: active.id });
    }
    completeSession(app, active.id, now, 'completed');
  }

  const endToday = endOfLocalDay(now, tz);
  const startToday = startOfLocalDay(localDay(now, tz), tz);
  const sched = schedulerFor(db, language);
  const dueRows = db.all<CardRow & { is_difficult: number }>(
    `SELECT c.*, li.is_difficult FROM fsrs_cards c JOIN learning_items li ON li.id = c.item_id JOIN vocabulary_entries e ON e.id = li.entry_id
      WHERE c.language_code = ? AND c.state != 0 AND c.due < ? AND li.status = 'active' AND e.deleted_at IS NULL
        AND (c.last_review IS NULL OR c.last_review < ?)
        AND NOT EXISTS (SELECT 1 FROM fsrs_cards sib WHERE sib.item_id = c.item_id AND sib.id != c.id AND sib.last_review >= ?)
      ORDER BY c.due LIMIT 600`,
    language,
    endToday,
    startToday,
    startToday, // a word's receptive and productive cards are never both scheduled on the same local day, across sessions too
  );
  const due: DueCardInfo[] = dueRows.map((c) => ({
    cardId: c.id,
    itemId: c.item_id,
    skill: c.skill,
    state: c.state,
    stability: c.stability ?? 1,
    difficulty: c.difficulty ?? 5,
    due: c.due ?? now,
    lastReview: c.last_review,
    lapses: c.lapses,
    reps: c.reps,
    retrievability: sched.retrievability({ state: c.state as 0, step: c.step, stability: c.stability, difficulty: c.difficulty, due: c.due, lastReview: c.last_review }, now),
    isDifficult: !!c.is_difficult,
  }));

  const newCandidates: number[] = [];
  if (config.mode !== 'review') {
    for (const r of db.all<{ id: number }>(
      `SELECT li.id FROM learning_items li JOIN vocabulary_entries e ON e.id = li.entry_id
        WHERE li.language_code = ? AND li.status = 'introduced' AND e.deleted_at IS NULL ORDER BY li.introduced_at LIMIT 30`,
      language,
    )) newCandidates.push(r.id);
    const want = Math.max(0, config.newWords + 6 - newCandidates.length);
    if (want > 0) {
      const rows = db.all<{ id: number }>(
        `SELECT e.id FROM vocabulary_entries e LEFT JOIN learning_items li ON li.entry_id = e.id
          WHERE e.language_code = ? AND e.deleted_at IS NULL AND (li.id IS NULL OR li.status = 'new')
            AND EXISTS (SELECT 1 FROM vocabulary_senses s WHERE s.entry_id = e.id)
            AND (? IS NULL OR COALESCE(e.frequency_rank, e.curated_order) >= ?)
            AND (? IS NULL OR COALESCE(e.frequency_rank, e.curated_order) <= ?)
            AND (? IS NULL OR EXISTS (SELECT 1 FROM entry_tags et JOIN tags t ON t.id = et.tag_id WHERE et.entry_id = e.id AND t.name = ?))
          ORDER BY (e.frequency_rank IS NULL), e.frequency_rank, (e.curated_order IS NULL), e.curated_order, e.id LIMIT ?`,
        language,
        config.frequencyMin,
        config.frequencyMin,
        config.frequencyMax,
        config.frequencyMax,
        config.tag,
        config.tag,
        want,
      );
      db.tx(() => {
        for (const r of rows) newCandidates.push(ensureItem(db, r.id, language, now));
      });
    }
  }
  const productiveUnlock = db
    .all<{ id: number }>(
      `SELECT li.id FROM learning_items li
         JOIN fsrs_cards r ON r.item_id = li.id AND r.skill = 'receptive'
         JOIN fsrs_cards p ON p.item_id = li.id AND p.skill = 'productive'
         JOIN vocabulary_entries e ON e.id = li.entry_id
        WHERE li.language_code = ? AND li.status = 'active' AND e.deleted_at IS NULL AND p.state = 0 AND r.state = 2 AND r.reps >= 2 AND r.stability >= 3
          AND r.due >= ? AND (r.last_review IS NULL OR r.last_review < ?)
        ORDER BY r.stability DESC LIMIT 10`,
      language,
      endToday, // the receptive memory is not due today (it would be reviewed in this session) …
      startToday, // … and was not reviewed today: a word's two memories are never both scheduled on one day
    )
    .map((r) => r.id);

  const forvoEnabled = app.forvo.configured;
  const allItemIds = [...new Set([...due.map((d) => d.itemId), ...newCandidates, ...productiveUnlock])];
  const entries = loadStudyEntries(db, allItemIds, forvoEnabled, now);
  const pool = db.all<PoolEntry>(
    `SELECT e.id AS entryId, e.lemma, COALESCE(e.display, e.lemma) AS display, e.pos,
            (SELECT gloss FROM vocabulary_senses s WHERE s.entry_id = e.id ORDER BY sense_order LIMIT 1) AS gloss
       FROM vocabulary_entries e WHERE e.language_code = ? AND e.deleted_at IS NULL
      ORDER BY (e.frequency_rank IS NULL), e.frequency_rank, (e.curated_order IS NULL), e.curated_order, e.id LIMIT 500`,
    language,
  ).filter((p) => p.gloss);
  const poolIds = new Set(pool.map((p) => p.entryId));
  for (const e of entries.values()) {
    if (!poolIds.has(e.entryId) && e.senses[0]) pool.push({ entryId: e.entryId, lemma: e.lemma, display: e.display, pos: e.pos, gloss: e.senses[0].gloss });
  }

  const plan = planSession({
    sessionId: input.id,
    now,
    language,
    config,
    settings: getLanguageSettings(db, language),
    forvoEnabled,
    due,
    productiveUnlock,
    newCandidates,
    entries,
    pool,
    performance: performanceFor(db, language, now),
    introducedToday: introducedToday(db, language, localDay(now, tz)),
    exact: exactLookup(app, language),
    writing: nextSentence(app, { language }, now).sentence != null,
  });
  if (!plan.exercises.length) {
    const vocabCount = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM vocabulary_entries WHERE language_code = ? AND deleted_at IS NULL', language)!.n;
    const nextDue = db.get<{ due: number | null }>(
      "SELECT MIN(c.due) AS due FROM fsrs_cards c JOIN learning_items li ON li.id = c.item_id WHERE c.language_code = ? AND c.state != 0 AND li.status = 'active'",
      language,
    )?.due;
    throw new HttpError(422, 'nothing_to_study', vocabCount ? 'Nothing is due and no new words match these settings.' : 'This language has no vocabulary yet. Import a word list or load the starter set.', {
      vocabularyCount: vocabCount,
      nextDue: nextDue ?? null,
    });
  }
  const resources = { items: Object.fromEntries([...plan.items].map(([k, v]) => [String(k), v])) };
  db.tx(() => {
    db.run(
      `INSERT INTO study_sessions (id, language_code, status, mode, config, plan_meta, resources, created_at, started_at, last_activity_at, device_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      input.id,
      language,
      input.prepared ? 'prepared' : 'active',
      config.mode === 'review' ? 'review' : config.mode === 'comprehensive' ? 'comprehensive' : config.quick ? 'quick' : 'standard',
      JSON.stringify(config),
      JSON.stringify(plan.meta),
      JSON.stringify(resources),
      now,
      input.prepared ? null : now,
      now,
      deviceId,
    );
    for (const x of plan.exercises) {
      db.run(
        `INSERT INTO session_exercises (id, session_id, seq, stage, item_id, card_skill, kind, priority, origin, payload)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'plan', ?)`,
        x.id,
        input.id,
        x.seq,
        x.stage,
        x.itemId,
        x.cardSkill,
        x.kind,
        x.priority,
        JSON.stringify(x.payload),
      );
    }
  });
  return getSession(app, input.id);
}

/**
 * What a session started now would hold, per type of question, without starting one: planned exactly as Start plans it
 * (createSession, as a prepared session), then rolled back, so nothing is written (not even the words it would add to
 * the learning list).
 */
export function previewSession(app: App, config: SessionConfig, now: number, id: string = randomUUID()): StudyPreview {
  const base = { language: config.language, mode: config.mode, minutes: config.minutes };
  const rollback = new Error('preview');
  let preview: StudyPreview = { ...base, total: 0, parts: [], reviews: 0, newWords: 0, empty: null };
  try {
    app.db.tx(() => {
      try {
        // A session with this id already (started a moment ago): its plan is the one to show.
        const s = createSession(app, { id, config, prepared: true }, now, null);
        const parts = mixCounts(
          s.exercises.map((e) => ({ kind: e.kind, isNew: !!s.items[String(e.itemId)]?.isNew })),
          s.meta.practice ?? [],
        );
        preview = { ...base, total: parts.reduce((n, p) => n + p.count, 0), parts, reviews: s.meta.reviewsPlanned, newWords: s.meta.newPlanned, empty: null };
      } catch (err) {
        if (!(err instanceof HttpError && err.code === 'nothing_to_study')) throw err;
        preview = { ...preview, empty: err.message };
      }
      throw rollback;
    });
  } catch (err) {
    if (err !== rollback) throw err;
  }
  return preview;
}

// ------------------------------------------------------------------ read

function exerciseResult(db: Db, row: ExerciseRow): ExerciseResult | null {
  if (!row.attempt_id) return null;
  const a = db.get<any>('SELECT * FROM exercise_attempts WHERE id = ?', row.attempt_id);
  if (!a) return null;
  return {
    attemptId: a.id,
    grade: a.grade,
    code: a.feedback_code ?? '',
    message: '',
    expected: '',
    response: a.response,
    rating: a.final_rating,
    countedAsReview: !!a.counted_as_review,
    answeredAt: a.answered_at,
  };
}

function toExercise(db: Db, r: ExerciseRow): SessionExercise {
  return {
    id: r.id,
    seq: r.seq,
    stage: r.stage as SessionExercise['stage'],
    kind: r.kind,
    itemId: r.item_id,
    cardSkill: r.card_skill,
    priority: r.priority,
    origin: r.origin,
    parentId: r.parent_id,
    status: r.status,
    payload: JSON.parse(r.payload),
    result: exerciseResult(db, r),
  };
}

export function getSession(app: App, id: string): StudySession {
  const db = app.db;
  const s = db.get<SessionRow>('SELECT * FROM study_sessions WHERE id = ?', id);
  if (!s) throw notFound('Session');
  const rows = db.all<ExerciseRow>('SELECT * FROM session_exercises WHERE session_id = ? ORDER BY seq', id);
  return {
    id: s.id,
    language: s.language_code,
    status: s.status,
    mode: s.mode,
    config: JSON.parse(s.config),
    meta: JSON.parse(s.plan_meta),
    createdAt: s.created_at,
    startedAt: s.started_at,
    lastActivityAt: s.last_activity_at,
    endedAt: s.ended_at,
    activeMs: s.active_ms,
    exercises: rows.map((r) => toExercise(db, r)),
    items: json(s.resources, { items: {} }).items,
    summary: json<SessionSummary | null>(s.summary, null),
  };
}

export function listActiveSessions(app: App, language?: LanguageCode): ActiveSessionInfo[] {
  finalizeStaleSessions(app, Date.now());
  const rows = app.db.all<any>(
    `SELECT s.id, s.language_code, s.status, s.last_activity_at, s.created_at, s.config, s.plan_meta,
            (SELECT COUNT(*) FROM session_exercises x WHERE x.session_id = s.id AND x.status != 'pending') AS done,
            (SELECT COUNT(*) FROM session_exercises x WHERE x.session_id = s.id) AS total
       FROM study_sessions s WHERE s.status IN ('active', 'paused', 'prepared') ${language ? 'AND s.language_code = ?' : ''}
      ORDER BY s.last_activity_at DESC`,
    ...(language ? [language] : []),
  );
  return rows.map((r) => {
    // Questions, as the session's counter counts them (SessionPage): its exercises answered or skipped and, in a
    // Comprehensive session, every practice answer given, against those plus the exercises left and the questions its
    // practice slots still have. A session planned before the mix was stored gets the mix its length plans.
    const config = json<Partial<SessionConfig>>(r.config, {});
    const meta = json<PlanMeta | null>(r.plan_meta, null);
    let answered = 0;
    let left = 0;
    if (config.mode === 'comprehensive' && meta) {
      answered = roundTotals(meta.rounds ?? {}).answered;
      left = practiceLeft(meta.practice ?? planPractice({ language: r.language_code, minutes: config.minutes ?? 20, exercises: r.total }), meta);
    }
    return { id: r.id, language: r.language_code, status: r.status, done: r.done + answered, total: r.total + answered + left, lastActivityAt: r.last_activity_at, createdAt: r.created_at };
  });
}

export function sessionHistory(app: App, language: LanguageCode | null, limit: number) {
  return app.db
    .all<any>(
      `SELECT id, language_code, status, mode, created_at, started_at, ended_at, active_ms, summary, plan_meta FROM study_sessions
        WHERE status IN ('completed', 'abandoned') ${language ? 'AND language_code = ?' : ''} ORDER BY COALESCE(ended_at, created_at) DESC LIMIT ?`,
      ...(language ? [language, limit] : [limit]),
    )
    .map((r) => {
      const summary = json<SessionSummary | null>(r.summary, null);
      return {
        id: r.id,
        language: r.language_code,
        status: r.status,
        mode: r.mode,
        startedAt: r.started_at ?? r.created_at,
        endedAt: r.ended_at,
        activeMs: r.active_ms,
        introduced: summary?.introduced.length ?? 0,
        reviewed: summary?.reviewed ?? 0,
        attempts: summary?.attempts ?? 0,
        accuracy: summary?.retrievalAccuracy ?? null,
      };
    });
}

// ------------------------------------------------------------------ attempts

function loadSession(db: Db, id: string): SessionRow {
  const s = db.get<SessionRow>('SELECT * FROM study_sessions WHERE id = ?', id);
  if (!s) throw notFound('Session');
  return s;
}

function progress(db: Db, sessionId: string) {
  const r = db.get<{ done: number; total: number }>(
    "SELECT SUM(status != 'pending') AS done, COUNT(*) AS total FROM session_exercises WHERE session_id = ?",
    sessionId,
  )!;
  const s = db.get<{ status: StudySession['status']; active_ms: number }>('SELECT status, active_ms FROM study_sessions WHERE id = ?', sessionId)!;
  return { status: s.status, done: r.done ?? 0, total: r.total ?? 0, activeMs: s.active_ms };
}


/** Score the first eligible attempts of a new word's card into one initial FSRS event. */
/** Exercise kinds whose attempts feed a new word's aggregated initial rating (not intros, assisted or practice-only). */
const RATED_KINDS = (Object.keys(KINDS) as ExerciseKind[]).filter((k) => k !== 'intro' && !KINDS[k].assisted && !KINDS[k].practiceOnly);

function finalizeItemCards(app: App, sessionId: string, itemId: number, tz: string, now: number, force: boolean): Array<{ itemId: number; changes: ReviewChange[] }> {
  const db = app.db;
  const changes: ReviewChange[] = [];
  const cards = db.all<CardRow>('SELECT * FROM fsrs_cards WHERE item_id = ? AND state = 0', itemId);
  for (const card of cards) {
    if (!force) {
      // Wait for every remaining graded exercise on this card (core, optional and remediation), so the single
      // initial rating reflects the whole session rather than only the first, immediate recognition.
      const pending = db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM session_exercises WHERE session_id = ? AND item_id = ? AND card_skill = ? AND status = 'pending'
           AND kind IN (${RATED_KINDS.map(() => '?').join(', ')})`,
        sessionId,
        itemId,
        card.skill,
        ...RATED_KINDS,
      )!.n;
      if (pending > 0) continue;
    }
    const attempts = db
      .all<{ id: number; kind: ExerciseKind; grade: Grade | 'self'; hints_used: number; self_rating: number | null; answered_at: number; device_id: string | null }>(
        'SELECT id, kind, grade, hints_used, self_rating, answered_at, device_id FROM exercise_attempts WHERE session_id = ? AND item_id = ? AND card_skill = ? ORDER BY answered_at, id',
        sessionId,
        itemId,
        card.skill,
      )
      .filter((a) => !KINDS[a.kind].assisted && !KINDS[a.kind].practiceOnly);
    const rating = aggregateInitialRating(attempts.map((a) => ({ grade: a.grade, hintsUsed: a.hints_used, selfRating: a.self_rating, at: a.answered_at })));
    if (!rating) continue;
    const last = attempts[attempts.length - 1];
    const change = applyReview(db, {
      card,
      rating,
      reviewedAt: last.answered_at,
      timezone: tz,
      opId: `init:${sessionId}:${itemId}:${card.skill}`,
      ratingSource: 'aggregate',
      exerciseKind: 'initial',
      attemptId: last.id,
      sessionId,
      deviceId: last.device_id,
      now,
    });
    if (change) changes.push(change);
  }
  return changes.length ? [{ itemId, changes }] : [];
}

/**
 * When the card was due as of `at`. A late (offline) attempt dated before the card's latest
 * review is judged against the card's history up to that moment, so a valid offline review is
 * inserted chronologically (and the card replayed) instead of being reduced to practice.
 */
/**
 * A device that studied offline plans follow-up (remediation) exercises itself, with the same deterministic rules as
 * the server. When server and device disagree (a stale copy, different spelling strictness), the device may have
 * answered a follow-up the server never created. Its answer is still kept: the exercise is created from the
 * word's prepared variant, so nothing the learner did is rejected or lost.
 */
function adoptOfflineFollowUp(db: Db, session: SessionRow, req: AttemptRequest): ExerciseRow | undefined {
  const m = /^(.+)~r(\d+)$/.exec(req.exerciseId);
  if (!m || !req.kind || !(req.kind in KINDS)) return undefined;
  const parent = db.get<ExerciseRow>('SELECT * FROM session_exercises WHERE id = ? AND session_id = ?', m[1], session.id);
  if (!parent) return undefined;
  const resources = json<{ items: Record<string, ItemResource> }>(session.resources, { items: {} });
  const payload = resources.items[String(parent.item_id)]?.variants?.[req.kind];
  if (!payload) return undefined;
  db.run(
    `INSERT INTO session_exercises (id, session_id, seq, stage, item_id, card_skill, kind, priority, origin, parent_id, payload)
     VALUES (?, ?, ?, 'H', ?, ?, ?, 'optional', 'remediation', ?, ?) ON CONFLICT(id) DO NOTHING`,
    req.exerciseId,
    session.id,
    parent.seq + 0.001,
    parent.item_id,
    KINDS[req.kind].card,
    req.kind,
    parent.id,
    JSON.stringify(payload),
  );
  return db.get<ExerciseRow>('SELECT * FROM session_exercises WHERE id = ? AND session_id = ?', req.exerciseId, session.id);
}

export function submitAttempt(app: App, sessionId: string, req: AttemptRequest, now: number, deviceId: string | null): AttemptResponse {
  const db = app.db;
  const tz = tzOf(app);
  const dup = db.get<{ id: number; exercise_id: string }>('SELECT id, exercise_id FROM exercise_attempts WHERE op_id = ?', req.opId);
  if (dup) {
    const ex = db.get<ExerciseRow>('SELECT * FROM session_exercises WHERE id = ?', dup.exercise_id);
    return {
      exerciseId: req.exerciseId,
      result: ex ? exerciseResult(db, { ...ex, attempt_id: dup.id })! : (null as unknown as ExerciseResult),
      check: null,
      review: null,
      finalized: [],
      inserted: [],
      skipped: [],
      alreadyCompleted: true,
      session: progress(db, sessionId),
    };
  }
  const session = loadSession(db, sessionId);
  let ex = db.get<ExerciseRow>('SELECT * FROM session_exercises WHERE id = ? AND session_id = ?', req.exerciseId, sessionId);
  if (!ex) ex = adoptOfflineFollowUp(db, session, req);
  if (!ex) throw notFound('Exercise');
  const payload = JSON.parse(ex.payload) as ExercisePayload;
  const info = KINDS[ex.kind];
  const answeredAt = Math.min(Math.max(Number(req.answeredAt) || now, 0), now);
  const day = localDay(answeredAt, tz);
  const item = db.get<any>('SELECT * FROM learning_items WHERE id = ?', ex.item_id)!;
  const alreadyCompleted = ex.status === 'done';
  const settings = getLanguageSettings(db, session.language_code);
  const skipped: string[] = [];

  if (ex.kind === 'intro') {
    if (req.markKnown) {
      if (item.status === 'new' || item.status === 'introduced') {
        db.run("UPDATE learning_items SET status = 'known', updated_at = ?, version = version + 1 WHERE id = ?", now, item.id);
      }
      for (const r of db.all<{ id: string }>("SELECT id FROM session_exercises WHERE session_id = ? AND item_id = ? AND status = 'pending' AND id != ?", sessionId, item.id, ex.id)) {
        db.run("UPDATE session_exercises SET status = 'skipped', completed_at = ? WHERE id = ?", now, r.id);
        skipped.push(r.id);
      }
    } else {
      ensureCards(db, item.id, session.language_code, now);
      if (item.status === 'new') {
        db.run("UPDATE learning_items SET status = 'introduced', introduced_at = ?, introduced_day = ?, updated_at = ?, version = version + 1 WHERE id = ?", answeredAt, day, now, item.id);
        bumpDaily(db, session.language_code, day, { introduced: 1 });
      }
    }
  }

  // Grade (server-authoritative, using the stored payload).
  let check: CheckResult | null = null;
  let grade: Grade | 'self' = 'self';
  let override = 0;
  if (info.response === 'choice') check = checkChoice(req.choiceId, (payload as { correctId: string }).correctId);
  else if (info.response === 'typed') check = checkAnswer(req.response ?? '', (payload as { answer: any }).answer, settings.spellingStrictness);
  if (check) grade = check.grade;
  if (req.revealed && info.response !== 'self' && info.response !== 'none') {
    grade = 'incorrect';
    check = { ...(check ?? { expected: '', message: '' }), grade: 'incorrect', code: 'incorrect', message: 'Answer revealed.' } as CheckResult;
  }
  if (req.override && info.response === 'typed' && grade !== 'correct') {
    grade = 'correct';
    override = 1;
    check = { ...check!, grade: 'correct', code: 'exact', message: 'Marked correct by you.' };
  }
  const selfRating = info.response === 'self' ? (req.selfRating ?? null) : null;
  // "I was right" makes the answer correct, but a hint still downgrades it to Hard (and a revealed answer stays Again).
  const suggested: Rating = suggestRating({ kind: ex.kind, grade, hintsUsed: req.hintsUsed ?? 0, revealed: req.revealed, selfRating });
  const finalRating: Rating = (req.ratingOverride ?? suggested) as Rating;
  const ratingSource = info.response === 'self' ? 'self' : req.ratingOverride ? 'adjusted' : 'auto';
  const success = ex.kind === 'intro' ? true : isSuccess(grade, selfRating);
  const score = ex.kind === 'intro' ? 1 : attemptScore(grade, selfRating);
  const evidenceSkill = info.assisted ? `${info.skill}_assisted` : info.skill;

  const attemptId = db.run(
    `INSERT INTO exercise_attempts (op_id, session_id, exercise_id, item_id, language_code, kind, skill, card_skill, stage, response, grade, feedback_code,
       score, hints_used, revealed, latency_ms, self_rating, suggested_rating, final_rating, override, answered_at, received_at, local_day, device_id, offline)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    req.opId,
    sessionId,
    ex.id,
    item.id,
    session.language_code,
    ex.kind,
    evidenceSkill,
    ex.card_skill,
    ex.stage,
    info.response === 'choice' ? (req.choiceId ?? null) : info.response === 'typed' ? (req.response ?? '').slice(0, 500) : req.markKnown ? 'known' : null,
    grade,
    check?.code ?? (req.markKnown ? 'marked_known' : null),
    score,
    req.hintsUsed ?? 0,
    req.revealed ? 1 : 0,
    req.latencyMs ?? null,
    selfRating,
    ex.kind === 'intro' ? null : suggested,
    ex.kind === 'intro' ? null : finalRating,
    override,
    answeredAt,
    now,
    day,
    deviceId ?? req.deviceId ?? null,
    req.offline ? 1 : 0,
  ).lastInsertRowid;

  let review: ReviewChange | null = null;
  if (ex.kind !== 'intro') {
    const delayed = !!item.introduced_day && day > item.introduced_day;
    updateEvidence(db, item.id, evidenceSkill, success, score, answeredAt, delayed);
    bumpDaily(db, session.language_code, day, {
      attempts: 1,
      correct: success ? 1 : 0,
      listening_attempts: info.skill === 'listening' ? 1 : 0,
      listening_correct: info.skill === 'listening' && success ? 1 : 0,
      production_attempts: info.card === 'productive' && !info.assisted ? 1 : 0,
      production_correct: info.card === 'productive' && !info.assisted && success ? 1 : 0,
    });
    db.run('UPDATE learning_items SET last_studied_at = MAX(COALESCE(last_studied_at, 0), ?) WHERE id = ?', answeredAt, item.id);
    // Scheduling event: first eligible retrieval of a due card on this local day.
    if (ex.card_skill && !info.practiceOnly && !info.assisted) {
      const card = getCard(db, item.id, ex.card_skill);
      const dueThen = card && card.state !== 0 ? dueAsOf(db, card, answeredAt) : null;
      if (card && dueThen != null && dueThen < endOfLocalDay(answeredAt, tz) && item.status === 'active') {
        review = applyReview(db, {
          card,
          rating: finalRating,
          reviewedAt: answeredAt,
          timezone: tz,
          opId: `rev:${req.opId}`,
          ratingSource,
          exerciseKind: ex.kind,
          attemptId,
          sessionId,
          deviceId,
          now,
        });
        if (review) {
          const logId = db.get<{ id: number }>('SELECT id FROM review_logs WHERE op_id = ?', `rev:${req.opId}`)!.id;
          db.run('UPDATE exercise_attempts SET counted_as_review = 1, review_log_id = ? WHERE id = ?', logId, attemptId);
        }
      }
    }
  }

  const inserted: SessionExercise[] = [];
  if (!alreadyCompleted) {
    db.run("UPDATE session_exercises SET status = 'done', completed_at = ?, attempt_id = ? WHERE id = ?", now, attemptId, ex.id);
    if (ex.kind !== 'intro') {
      const remCount = db.get<{ n: number }>("SELECT COUNT(*) AS n FROM session_exercises WHERE session_id = ? AND item_id = ? AND origin = 'remediation'", sessionId, item.id)!.n;
      const pending = db.all<{ seq: number }>("SELECT seq FROM session_exercises WHERE session_id = ? AND status = 'pending' ORDER BY seq", sessionId);
      const resources = json<{ items: Record<string, ItemResource> }>(session.resources, { items: {} });
      const variants = resources.items[String(item.id)]?.variants ?? {};
      const rem = planRemediation({
        exercise: { id: ex.id, kind: ex.kind, itemId: item.id, seq: ex.seq },
        grade,
        selfRating,
        remediationsSoFar: remCount,
        availableKinds: Object.keys(variants) as ExerciseKind[],
        pending,
      });
      if (rem && variants[rem.kind] && ['active', 'paused', 'prepared'].includes(session.status)) {
        db.run(
          `INSERT INTO session_exercises (id, session_id, seq, stage, item_id, card_skill, kind, priority, origin, parent_id, payload)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'remediation', ?, ?) ON CONFLICT(id) DO NOTHING`,
          rem.id,
          sessionId,
          rem.seq,
          rem.stage,
          item.id,
          rem.cardSkill,
          rem.kind,
          rem.priority,
          rem.parentId,
          JSON.stringify(variants[rem.kind]),
        );
        inserted.push(toExercise(db, db.get<ExerciseRow>('SELECT * FROM session_exercises WHERE id = ?', rem.id)!));
      }
    }
  }

  const finalized = finalizeItemCards(app, sessionId, item.id, tz, now, false);
  const delta = Math.min(Math.max(Number(req.activeMsDelta) || 0, 0), MAX_ACTIVE_DELTA_MS);
  db.run(
    `UPDATE study_sessions SET status = CASE WHEN status IN ('prepared', 'paused') THEN 'active' ELSE status END,
       started_at = COALESCE(started_at, ?), last_activity_at = ?, active_ms = active_ms + ?, version = version + 1 WHERE id = ?`,
    answeredAt,
    now,
    delta,
    sessionId,
  );
  if (delta) bumpDaily(db, session.language_code, day, { study_ms: delta });
  const remaining = db.get<{ n: number }>("SELECT COUNT(*) AS n FROM session_exercises WHERE session_id = ? AND status = 'pending'", sessionId)!.n;
  const current = db.get<{ status: string }>('SELECT status FROM study_sessions WHERE id = ?', sessionId)!.status;
  if (remaining === 0 && current === 'active') completeSession(app, sessionId, now, 'completed');

  const expected = check?.expected ?? '';
  const result: ExerciseResult = {
    attemptId,
    grade,
    code: check?.code ?? '',
    message: check?.message ?? '',
    expected: info.response === 'choice' ? ((payload as any).options?.find((o: any) => o.id === expected)?.text ?? expected) : expected,
    response: req.response ?? req.choiceId ?? null,
    rating: ex.kind === 'intro' ? null : finalRating,
    countedAsReview: !!review,
    answeredAt,
  };
  return { exerciseId: ex.id, result, check, review, finalized, inserted, skipped, alreadyCompleted, session: progress(db, sessionId) };
}

// ------------------------------------------------------------------ events

export function sessionEvent(
  app: App,
  sessionId: string,
  ev: { type: 'pause' | 'resume' | 'heartbeat' | 'skip' | 'wrap_up' | 'start' | 'round'; exerciseId?: string; activeMsDelta?: number; at?: number } & Partial<RoundEvent>,
  now: number,
): { session: ReturnType<typeof progress>; skipped: string[] } {
  const db = app.db;
  const tz = tzOf(app);
  const s = loadSession(db, sessionId);
  const delta = Math.min(Math.max(Number(ev.activeMsDelta) || 0, 0), MAX_ACTIVE_DELTA_MS);
  const day = localDay(Math.min(ev.at ?? now, now), tz);
  const skipped: string[] = [];
  const open = ['active', 'paused', 'prepared'].includes(s.status);
  if (delta) {
    db.run('UPDATE study_sessions SET active_ms = active_ms + ?, last_activity_at = ? WHERE id = ?', delta, now, sessionId);
    bumpDaily(db, s.language_code, day, { study_ms: delta });
  }
  if (ev.type === 'round' && ev.roundId && ev.skill && ev.grades) {
    // A practice round's answers so far, kept with the session whatever its status: the session is completed with its
    // last exercise, and the rounds at the end come after that. Only the counts: the answers themselves were saved, and
    // scheduled where they count, by the practice endpoints (scheduleFromPractice).
    const meta = json<PlanMeta>(s.plan_meta, {} as PlanMeta);
    const merged = mergeRound(meta, { roundId: ev.roundId, skill: ev.skill, grades: ev.grades, from: ev.from, end: ev.end });
    if (merged !== meta) db.run('UPDATE study_sessions SET plan_meta = ?, version = version + 1 WHERE id = ?', JSON.stringify(merged), sessionId);
  }
  if (open) {
    if (ev.type === 'pause' && s.status === 'active') db.run("UPDATE study_sessions SET status = 'paused', last_activity_at = ? WHERE id = ?", now, sessionId);
    if ((ev.type === 'resume' || ev.type === 'start') && s.status !== 'active') {
      db.run("UPDATE study_sessions SET status = 'active', started_at = COALESCE(started_at, ?), last_activity_at = ? WHERE id = ?", now, now, sessionId);
    }
    if (ev.type === 'heartbeat' || ev.type === 'round') db.run('UPDATE study_sessions SET last_activity_at = ? WHERE id = ?', now, sessionId);
    if (ev.type === 'skip' && ev.exerciseId) {
      const ex = db.get<ExerciseRow>("SELECT * FROM session_exercises WHERE id = ? AND session_id = ? AND status = 'pending'", ev.exerciseId, sessionId);
      if (ex) {
        db.run("UPDATE session_exercises SET status = 'skipped', completed_at = ? WHERE id = ?", now, ex.id);
        skipped.push(ex.id);
        finalizeItemCards(app, sessionId, ex.item_id, tz, now, false);
      }
    }
    if (ev.type === 'wrap_up') {
      // Out of time: drop optional work and words that were not introduced yet; keep reviews and started words.
      const notIntroduced = db.all<{ item_id: number }>("SELECT item_id FROM session_exercises WHERE session_id = ? AND kind = 'intro' AND status = 'pending'", sessionId).map((r) => r.item_id);
      const rows = db.all<ExerciseRow>("SELECT * FROM session_exercises WHERE session_id = ? AND status = 'pending'", sessionId);
      for (const r of rows) {
        if (r.priority === 'optional' || notIntroduced.includes(r.item_id)) {
          db.run("UPDATE session_exercises SET status = 'skipped', completed_at = ? WHERE id = ?", now, r.id);
          skipped.push(r.id);
        }
      }
      for (const itemId of new Set(rows.map((r) => r.item_id))) finalizeItemCards(app, sessionId, itemId, tz, now, false);
    }
    const remaining = db.get<{ n: number }>("SELECT COUNT(*) AS n FROM session_exercises WHERE session_id = ? AND status = 'pending'", sessionId)!.n;
    if (remaining === 0 && (ev.type === 'skip' || ev.type === 'wrap_up')) completeSession(app, sessionId, now, 'completed');
  }
  return { session: progress(db, sessionId), skipped };
}

// ------------------------------------------------------------------ completion

export function completeSession(app: App, sessionId: string, now: number, status: 'completed' | 'abandoned'): SessionSummary {
  const db = app.db;
  const tz = tzOf(app);
  const s = loadSession(db, sessionId);
  if (s.status === 'completed' || s.status === 'abandoned') return json<SessionSummary>(s.summary, buildSummary(app, s, now));
  const itemIds = db.all<{ item_id: number }>('SELECT DISTINCT item_id FROM session_exercises WHERE session_id = ?', sessionId).map((r) => r.item_id);
  for (const itemId of itemIds) finalizeItemCards(app, sessionId, itemId, tz, now, true);
  db.run("UPDATE session_exercises SET status = 'skipped', completed_at = ? WHERE session_id = ? AND status = 'pending'", now, sessionId);
  const fresh = loadSession(db, sessionId);
  const summary = buildSummary(app, fresh, now);
  db.run('UPDATE study_sessions SET status = ?, ended_at = ?, summary = ?, version = version + 1 WHERE id = ?', status, now, JSON.stringify(summary), sessionId);
  if (status === 'completed') bumpDaily(db, s.language_code, localDay(now, tz), { sessions_completed: 1 });
  return summary;
}

function buildSummary(app: App, s: SessionRow, now: number): SessionSummary {
  const db = app.db;
  const tz = tzOf(app);
  const resources = json<{ items: Record<string, ItemResource> }>(s.resources, { items: {} });
  const res = (id: number) => resources.items[String(id)];
  const introduced = db
    .all<{ item_id: number }>(
      `SELECT x.item_id FROM session_exercises x JOIN exercise_attempts a ON a.id = x.attempt_id
        WHERE x.session_id = ? AND x.kind = 'intro' AND x.status = 'done' AND COALESCE(a.feedback_code, '') != 'marked_known'`,
      s.id,
    )
    .map((r) => ({ itemId: r.item_id, lemma: res(r.item_id)?.display ?? '', gloss: res(r.item_id)?.senses[0]?.gloss ?? '' }));
  const attempts = db.all<{ item_id: number; kind: ExerciseKind; skill: string; grade: Grade | 'self'; self_rating: number | null; card_skill: string | null }>(
    "SELECT item_id, kind, skill, grade, self_rating, card_skill FROM exercise_attempts WHERE session_id = ? AND kind != 'intro'",
    s.id,
  );
  const graded = attempts.filter((a) => a.grade !== 'self');
  const firstTry = db.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM session_exercises x JOIN exercise_attempts a ON a.id = x.attempt_id
      WHERE x.session_id = ? AND x.kind != 'intro' AND a.grade = 'correct'`,
    s.id,
  )!.n;
  const misses = new Map<number, number>();
  for (const a of attempts) if (a.grade === 'incorrect') misses.set(a.item_id, (misses.get(a.item_id) ?? 0) + 1);
  const changes = db
    .all<any>('SELECT item_id, skill, rating, scheduled_days, due_after FROM review_logs WHERE session_id = ? ORDER BY reviewed_at', s.id)
    .map((r) => ({ itemId: r.item_id, lemma: res(r.item_id)?.display ?? '', skill: r.skill, rating: r.rating, scheduledDays: r.scheduled_days, dueAfter: r.due_after }));
  const tomorrowEnd = startOfLocalDay(addDays(localDay(now, tz), 2), tz);
  const weekEnd = startOfLocalDay(addDays(localDay(now, tz), 8), tz);
  const dueCount = (until: number) =>
    db.get<{ n: number }>(
      "SELECT COUNT(DISTINCT c.item_id) AS n FROM fsrs_cards c JOIN learning_items li ON li.id = c.item_id WHERE c.language_code = ? AND c.state != 0 AND c.due < ? AND li.status = 'active'",
      s.language_code,
      until,
    )!.n;
  const dueTomorrow = dueCount(tomorrowEnd);
  const dueWeek = dueCount(weekEnd);
  const minutes = Math.max(10, Math.min(60, Math.ceil((dueTomorrow * 14) / 60 / 5) * 5 + 5));
  const listening = attempts.filter((a) => a.skill === 'listening');
  const production = attempts.filter((a) => a.card_skill === 'productive' && !KINDS[a.kind].assisted);
  return {
    introduced,
    reviewed: changes.length,
    attempts: attempts.length,
    correctFirstTry: firstTry,
    retrievalAccuracy: graded.length ? graded.filter((a) => a.grade === 'correct').length / graded.length : null,
    listening: { attempts: listening.length, correct: listening.filter((a) => isSuccess(a.grade, a.self_rating)).length },
    production: { attempts: production.length, correct: production.filter((a) => isSuccess(a.grade, a.self_rating)).length },
    difficult: [...misses.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([itemId, n]) => ({ itemId, lemma: res(itemId)?.display ?? '', gloss: res(itemId)?.senses[0]?.gloss ?? '', misses: n })),
    scheduleChanges: changes,
    activeMs: s.active_ms,
    next: {
      dueTomorrow,
      dueThisWeek: dueWeek,
      suggestion: dueTomorrow
        ? `About ${dueTomorrow} word${dueTomorrow === 1 ? '' : 's'} will be due by tomorrow — a ${minutes}-minute session should cover them.`
        : 'Nothing is due tomorrow — a session with new words will keep momentum.',
    },
  };
}

export function finalizeStaleSessions(app: App, now: number): number {
  const stale = app.db.all<{ id: string }>("SELECT id FROM study_sessions WHERE status IN ('active', 'paused') AND COALESCE(last_activity_at, created_at) < ?", now - STALE_MS);
  for (const s of stale) app.db.tx(() => completeSession(app, s.id, now, 'abandoned'));
  return stale.length;
}
