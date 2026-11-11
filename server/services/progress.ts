// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
/**
 * The Progress page (GET /api/stats/progress/:code and /api/stats/progress/:code/period): words known, being learned
 * and not started, with the words-known history of the last 90 days, the 1,000 most frequent words and the next
 * milestone; the skills and study time of a period (7 days, 30 days, all time) against the period before; the reviews
 * coming up; the words that need work. All of it is read from what the app stores anyway; nothing here writes, and
 * none of it touches FSRS. Definitions and pure helpers: shared/progress.ts.
 *
 * The words-known history is rebuilt day by day from:
 *   - the recognition memory's review log, replayed: at the end of a day a word is learned when it has had at least two
 *     reviews and the stability after the latest is at least 3 days, exactly as the counts now. Every review is logged
 *     with the stability after it, and recomputing a card (a late offline answer, a new retention target) rewrites its
 *     log too, so this part is exact;
 *   - words marked known on a session's new-word card: from that answer's day (exact);
 *   - words marked known on their page: from learning_items.updated_at, the moment of the change. Starring a word or
 *     flagging it difficult no longer moves updated_at, so this is exact from now on; before, a word starred after it
 *     was marked known counts from the day it was starred;
 *   - suspended words count until the day they were suspended (updated_at, likewise), deleted words until the day they
 *     were deleted (deleted_at). A word suspended or marked known and later restored counts as its reviews say.
 */
import type { App } from '../app.ts';
import type { Db } from '../db/database.ts';
import { FEEDBACK_OVERHEAD_S, type ExerciseKind } from '../../shared/exercises.ts';
import type { LanguageCode } from '../../shared/languages.ts';
import { hasParadigms } from '../../shared/paradigms.ts';
import {
  countedFrom,
  goalDays,
  HISTORY_DAYS,
  knownHistory,
  LEARNED_MIN_REVIEWS,
  LEARNED_MIN_STABILITY,
  minutesOf,
  minutesToKeepUp,
  nextMilestone,
  pacePerDay,
  PROGRESS_SKILLS,
  trendPoints,
  weakestSkill,
  weeklyBars,
  type KnownItem,
  type ProgressOverview,
  type ProgressPeriod,
  type ProgressSkill,
  type ProgressSkillKey,
} from '../../shared/progress.ts';
import { tally, windowFirstDay, type StatsWindow } from '../../shared/stats.ts';
import { addDays, daysBetween, localDay, startOfLocalDay } from '../../shared/time.ts';
import { comprehensionSummary, loadComprehension } from '../learning/comprehension.ts';
import { loadIdentify } from '../learning/identify.ts';
import { getLanguageSettings } from './settings.ts';
import { activityByDay, firstStudyDay, streakDays } from './stats.ts';

/** SQL: the word's recognition memory (fsrs_cards r) makes it learned. */
const LEARNED_SQL = `li.status = 'active' AND r.reps >= ${LEARNED_MIN_REVIEWS} AND r.stability >= ${LEARNED_MIN_STABILITY}`;

/** Known, being learned and not started, over the language's words now (suspended and deleted words in none). */
export function wordCounts(db: Db, language: LanguageCode): { known: number; learning: number; notStarted: number } {
  const r = db.get<{ known: number; learning: number; not_started: number }>(
    `SELECT COALESCE(SUM(li.status = 'known' OR (${LEARNED_SQL})), 0) AS known,
            COALESCE(SUM(li.status = 'introduced' OR (li.status = 'active' AND NOT COALESCE(${LEARNED_SQL}, 0))), 0) AS learning,
            COALESCE(SUM(li.id IS NULL OR li.status = 'new'), 0) AS not_started
       FROM vocabulary_entries e
       LEFT JOIN learning_items li ON li.entry_id = e.id
       LEFT JOIN fsrs_cards r ON r.item_id = li.id AND r.skill = 'receptive'
      WHERE e.language_code = ? AND e.deleted_at IS NULL`,
    language,
  )!;
  return { known: r.known, learning: r.learning, notStarted: r.not_started };
}

/** Every word that may have been known since `firstDay`, as the history needs it (see the top of this file). */
export function knownItems(db: Db, language: LanguageCode, firstDay: string, today: string, tz: string): KnownItem[] {
  const rows = db.all<{ id: number; status: string; updated_at: number; deleted_at: number | null }>(
    `SELECT li.id, li.status, li.updated_at, e.deleted_at FROM learning_items li JOIN vocabulary_entries e ON e.id = li.entry_id
      WHERE li.language_code = ? AND li.status IN ('active', 'known', 'suspended') AND (e.deleted_at IS NULL OR e.deleted_at >= ?)`,
    language,
    startOfLocalDay(firstDay, tz),
  );
  // A day after today (the timezone moved west since) counts as today, so the last day always matches the counts.
  const upToToday = (day: string) => (day > today ? today : day);
  const reviews = new Map<number, KnownItem['reviews']>();
  for (const r of db.all<{ item_id: number; local_day: string; stability_after: number }>(
    "SELECT item_id, local_day, stability_after FROM review_logs WHERE language_code = ? AND skill = 'receptive' ORDER BY item_id, reviewed_at, id",
    language,
  )) {
    (reviews.get(r.item_id) ?? reviews.set(r.item_id, []).get(r.item_id)!).push({ day: upToToday(r.local_day), stability: r.stability_after });
  }
  const markedInSession = new Map(
    db
      .all<{ item_id: number; day: string }>(
        "SELECT item_id, MAX(local_day) AS day FROM exercise_attempts WHERE language_code = ? AND kind = 'intro' AND feedback_code = 'marked_known' GROUP BY item_id",
        language,
      )
      .map((r) => [r.item_id, upToToday(r.day)]),
  );
  return rows.map((r) => {
    const changed = upToToday(localDay(r.updated_at, tz));
    const knownFrom = r.status === 'known' ? (markedInSession.get(r.id) ?? changed) : r.status === 'suspended' ? (markedInSession.get(r.id) ?? null) : null;
    const ends = [r.status === 'suspended' ? changed : null, r.deleted_at != null ? upToToday(localDay(r.deleted_at, tz)) : null].filter((d): d is string => d != null);
    return { reviews: reviews.get(r.id) ?? [], knownFrom, until: ends.length ? ends.sort()[0] : null };
  });
}

/** How many of the most frequent words the "most common words" line covers. */
export const COMMON_WORDS = 1000;

/** The COMMON_WORDS words of the set with the lowest frequency ranks (all ranked words when fewer), and how many are known. */
function commonWords(db: Db, language: LanguageCode): { size: number; known: number } | null {
  const r = db.get<{ n: number; known: number }>(
    `SELECT COUNT(*) AS n, COALESCE(SUM(known), 0) AS known FROM (
       SELECT (li.status = 'known' OR (${LEARNED_SQL})) AS known
         FROM vocabulary_entries e
         LEFT JOIN learning_items li ON li.entry_id = e.id
         LEFT JOIN fsrs_cards r ON r.item_id = li.id AND r.skill = 'receptive'
        WHERE e.language_code = ? AND e.deleted_at IS NULL AND e.frequency_rank IS NOT NULL
        ORDER BY e.frequency_rank, e.id LIMIT ?)`,
    language,
    COMMON_WORDS,
  )!;
  return r.n ? { size: r.n, known: r.known } : null;
}

/** Fewer timed reviews than this in 30 days, and a review is taken to last DEFAULT_REVIEW_SECONDS. */
export const MIN_TIMED_REVIEWS = 10;
/** A typical review in the planner (about 12 seconds to answer) and its feedback. */
export const DEFAULT_REVIEW_SECONDS = 15;

/**
 * Reviews due on each of the next 7 days, today with the overdue ones. A word counts once a day: its two memories never
 * both get a review on the same day. The minutes a day come from the learner's own median answer time of the reviews
 * of the last 30 days, plus the feedback after each.
 */
function comingUp(db: Db, language: LanguageCode, now: number, tz: string): ProgressOverview['comingUp'] {
  const today = localDay(now, tz);
  const ends = Array.from({ length: 7 }, (_, i) => startOfLocalDay(addDays(today, i + 1), tz));
  const perDay = ends.map(() => new Set<number>());
  for (const c of db.all<{ item_id: number; due: number }>(
    `SELECT c.item_id, c.due FROM fsrs_cards c JOIN learning_items li ON li.id = c.item_id JOIN vocabulary_entries e ON e.id = li.entry_id
      WHERE c.language_code = ? AND c.state != 0 AND c.due < ? AND li.status = 'active' AND e.deleted_at IS NULL`,
    language,
    ends[ends.length - 1],
  )) {
    perDay[ends.findIndex((end) => c.due < end)].add(c.item_id);
  }
  const days = perDay.map((items, i) => ({ day: addDays(today, i), due: items.size }));
  const total = days.reduce((s, d) => s + d.due, 0);
  const times = db
    .all<{ ms: number }>(
      `SELECT latency_ms AS ms FROM exercise_attempts
        WHERE language_code = ? AND local_day >= ? AND counted_as_review = 1 AND latency_ms > 0 AND latency_ms < 120000 ORDER BY latency_ms`,
      language,
      addDays(today, -29),
    )
    .map((r) => r.ms);
  const ownTiming = times.length >= MIN_TIMED_REVIEWS;
  const seconds = ownTiming ? times[Math.floor(times.length / 2)] / 1000 + FEEDBACK_OVERHEAD_S : DEFAULT_REVIEW_SECONDS;
  return { days, total, secondsPerReview: Math.round(seconds), ownTiming, minutesPerDay: minutesToKeepUp(total, seconds) };
}

/** How far back "Words that need work" looks, and how many it lists. */
export const NEED_WORK_DAYS = 30;
export const NEED_WORK_SIZE = 5;

/**
 * The words missed most in the last NEED_WORK_DAYS days: a miss is a session answer that was wrong (or revealed) or
 * self-rated Again, or a forms, sentence-gap or Identify answer that was wrong or revealed ("almost" is not a miss).
 * Most misses first, then the highest share missed, then the latest miss. Read and Say it are about sentences, not one
 * word, so they are left out.
 */
function needWork(db: Db, language: LanguageCode, today: string): ProgressOverview['needWork'] {
  const since = addDays(today, -(NEED_WORK_DAYS - 1));
  const byEntry = new Map<number, { misses: number; answers: number; last: number }>();
  const add = (rows: Array<{ entry_id: number; n: number; misses: number; last: number | null }>) => {
    for (const r of rows) {
      const x = byEntry.get(r.entry_id) ?? byEntry.set(r.entry_id, { misses: 0, answers: 0, last: 0 }).get(r.entry_id)!;
      x.misses += r.misses;
      x.answers += r.n;
      x.last = Math.max(x.last, r.last ?? 0);
    }
  };
  const sessionMiss = "a.grade = 'incorrect' OR (a.grade = 'self' AND a.self_rating = 1)";
  add(
    db.all(
      `SELECT li.entry_id, COUNT(*) AS n, COALESCE(SUM(${sessionMiss}), 0) AS misses, MAX(CASE WHEN ${sessionMiss} THEN a.answered_at END) AS last
         FROM exercise_attempts a JOIN learning_items li ON li.id = a.item_id
        WHERE a.language_code = ? AND a.local_day >= ? AND a.kind != 'intro' GROUP BY li.entry_id`,
      language,
      since,
    ),
  );
  const practiceMiss = "grade IN ('incorrect', 'revealed')";
  add(
    db.all(
      `SELECT entry_id, COUNT(*) AS n, COALESCE(SUM(${practiceMiss}), 0) AS misses, MAX(CASE WHEN ${practiceMiss} THEN answered_at END) AS last
         FROM practice_attempts WHERE language_code = ? AND local_day >= ? AND mode IN ('forms', 'cloze', 'identify') GROUP BY entry_id`,
      language,
      since,
    ),
  );
  const ranked = [...byEntry]
    .filter(([, x]) => x.misses > 0)
    .sort(([, a], [, b]) => b.misses - a.misses || b.misses / b.answers - a.misses / a.answers || b.last - a.last)
    .slice(0, 50);
  if (!ranked.length) return [];
  const words = new Map(
    db
      .all<{ id: number; lemma: string; gloss: string | null }>(
        `SELECT e.id, COALESCE(e.display, e.lemma) AS lemma, (SELECT gloss FROM vocabulary_senses s WHERE s.entry_id = e.id ORDER BY sense_order LIMIT 1) AS gloss
           FROM vocabulary_entries e WHERE e.id IN (SELECT value FROM json_each(?)) AND e.deleted_at IS NULL`,
        JSON.stringify(ranked.map(([id]) => id)),
      )
      .map((w) => [w.id, w]),
  );
  return ranked
    .filter(([id]) => words.has(id))
    .slice(0, NEED_WORK_SIZE)
    .map(([id, x]) => ({ entryId: id, lemma: words.get(id)!.lemma, gloss: words.get(id)!.gloss ?? '', misses: x.misses, answers: x.answers }));
}

export function progressOverview(app: App, language: LanguageCode, now: number, tz: string): ProgressOverview {
  const db = app.db;
  const today = localDay(now, tz);
  const firstDay = addDays(today, -(HISTORY_DAYS - 1));
  const counts = wordCounts(db, language);
  const history = knownHistory(knownItems(db, language, firstDay, today, tz), firstDay, today);
  const pace = pacePerDay(history);
  return {
    language,
    words: { ...counts, history: { firstDay, known: history }, common: commonWords(db, language), pacePerDay: pace, milestone: nextMilestone(counts.known, pace) },
    comingUp: comingUp(db, language, now, tz),
    needWork: needWork(db, language, today),
  };
}

// ------------------------------------------------------------------ a period: skills and study time

/**
 * Session exercises per skill card. By ear, typed recall, sentence gaps and forms have their own cards; every other
 * session exercise (choosing a meaning, a word or a picture, the meaning in context, typing a meaning, and the self-rated
 * ones: say it aloud, shadowing, a sentence of your own) is Words.
 */
const SESSION_SKILL: Record<Exclude<ExerciseKind, 'intro'>, ProgressSkillKey> = {
  meaning_choice: 'words',
  meaning_typed: 'words',
  context_meaning: 'words',
  word_choice: 'words',
  picture_choice: 'words',
  speak_flashcard: 'words',
  sentence_create: 'words',
  shadowing: 'words',
  recall_typed: 'writing',
  listen_meaning: 'listening',
  listen_choice: 'listening',
  dictation: 'listening',
  cloze_choice: 'sentences',
  cloze_typed: 'sentences',
  form_typed: 'grammar',
};

/** Practice answers per skill card (Practice pages and session rounds). Read sentences understood in full count as reading. */
const PRACTICE_SKILL: Record<string, ProgressSkillKey> = { forms: 'grammar', cloze: 'sentences', identify: 'pictures', say: 'speaking', read: 'reading' };

/** The first day of "all time": before anything the app can hold. */
const ALL_TIME = '1970-01-01';

export function progressPeriod(app: App, language: LanguageCode, window: StatsWindow, now: number, tz: string): ProgressPeriod {
  const db = app.db;
  const today = localDay(now, tz);
  const firstDay = windowFirstDay(window, today);
  const previousFirst = firstDay ? addDays(firstDay, -Number(window)) : null;
  const current = firstDay ?? ALL_TIME;
  const from = previousFirst ?? ALL_TIME;

  // Answers and answers right per skill, in the period (cur = 1) and the one before (cur = 0).
  const sums = new Map<ProgressSkillKey, { cur: [number, number]; prev: [number, number] }>();
  const add = (key: ProgressSkillKey, cur: boolean, n: number, ok: number) => {
    const s = sums.get(key) ?? sums.set(key, { cur: [0, 0], prev: [0, 0] }).get(key)!;
    const t = cur ? s.cur : s.prev;
    t[0] += n;
    t[1] += ok;
  };
  for (const r of db.all<{ kind: ExerciseKind; cur: number; n: number; ok: number }>(
    `SELECT kind, local_day >= ? AS cur, COUNT(*) AS n, COALESCE(SUM(grade = 'correct' OR (grade = 'self' AND COALESCE(self_rating, 0) >= 2)), 0) AS ok
       FROM exercise_attempts WHERE language_code = ? AND local_day >= ? AND kind != 'intro' GROUP BY kind, cur`,
    current,
    language,
    from,
  )) {
    const key = SESSION_SKILL[r.kind as Exclude<ExerciseKind, 'intro'>];
    if (key) add(key, r.cur === 1, r.n, r.ok);
  }
  for (const r of db.all<{ mode: string; cur: number; n: number; ok: number }>(
    `SELECT mode, local_day >= ? AS cur, COUNT(*) AS n, COALESCE(SUM(grade = CASE WHEN mode = 'read' THEN 'understood' ELSE 'correct' END), 0) AS ok
       FROM practice_attempts WHERE language_code = ? AND local_day >= ? GROUP BY mode, cur`,
    current,
    language,
    from,
  )) {
    const key = PRACTICE_SKILL[r.mode];
    if (key) add(key, r.cur === 1, r.n, r.ok);
  }
  // Writing sentences (1.9.0) join typed recall on the Writing card.
  for (const r of db.all<{ cur: number; n: number; ok: number }>(
    `SELECT local_day >= ? AS cur, COUNT(*) AS n, COALESCE(SUM(correct), 0) AS ok FROM writing_attempts WHERE language_code = ? AND local_day >= ? GROUP BY cur`,
    current,
    language,
    from,
  )) {
    add('writing', r.cur === 1, r.n, r.ok);
  }
  // Reading texts: every question answered (from the time index; the day decides the period).
  for (const r of db.all<{ cur: number; q: number; ok: number }>(
    `SELECT local_day >= ? AS cur, COALESCE(SUM(total), 0) AS q, COALESCE(SUM(correct), 0) AS ok
       FROM comprehension_attempts WHERE language_code = ? AND answered_at >= ? GROUP BY cur`,
    current,
    language,
    startOfLocalDay(from, tz),
  )) {
    add('reading', r.cur === 1, r.q, r.ok);
  }

  const answered = (key: ProgressSkillKey) => {
    const s = sums.get(key);
    return !!s && s.cur[0] + s.prev[0] > 0;
  };
  const shown: Record<ProgressSkillKey, () => boolean> = {
    words: () => true,
    listening: () => true,
    writing: () => true,
    sentences: () => true,
    speaking: () => true,
    grammar: () => hasParadigms(language) || answered('grammar'),
    pictures: () => !!loadIdentify(app) || answered('pictures'),
    reading: () =>
      (loadComprehension(app, language)?.passages.length ?? 0) > 0 ||
      answered('reading') ||
      !!db.get(
        "SELECT 1 WHERE EXISTS (SELECT 1 FROM comprehension_attempts WHERE language_code = ?) OR EXISTS (SELECT 1 FROM practice_attempts WHERE language_code = ? AND mode = 'read')",
        language,
        language,
      ),
  };
  const skills: ProgressSkill[] = PROGRESS_SKILLS.filter((key) => shown[key]()).map((key) => {
    const s = sums.get(key) ?? { cur: [0, 0], prev: [0, 0] };
    const cur = tally(s.cur[0], s.cur[1]);
    const previous = previousFirst ? tally(s.prev[0], s.prev[1]) : null;
    const skill: ProgressSkill = { key, ...cur, previous, trend: trendPoints(cur, previous) };
    if (key === 'reading') {
      const p = comprehensionSummary(app, language).progress;
      skill.reading = { level: p.level, levelTexts: p.total, levelRead: p.read };
    }
    return skill;
  });

  // Study time: minutes per day (sessions, their rounds, and the Practice pages) against the daily goal, counted from the
  // period's first day or, when the language was first studied later, from that day: the days before it were not missed.
  const goalMinutes = getLanguageSettings(db, language).dailyGoalMinutes;
  const begun = firstStudyDay(db, language);
  const counted = countedFrom(firstDay, begun, today);
  const activity = activityByDay(db, language, counted, tz);
  const span = daysBetween(counted, today) + 1;
  const days = Array.from({ length: span }, (_, i) => {
    const day = addDays(counted, i);
    return { day, minutes: minutesOf(activity.get(day)?.studyMs ?? 0) };
  });
  const totalMs = [...activity.values()].filter((d) => d.day >= counted && d.day <= today).reduce((s, d) => s + d.studyMs, 0);
  return {
    language,
    window,
    firstDay,
    skills,
    weakest: weakestSkill(skills),
    time: {
      goalMinutes,
      unit: firstDay ? 'day' : 'week',
      bars: firstDay ? days : weeklyBars(days, counted, today),
      from: counted,
      shortened: firstDay != null && counted > firstDay,
      begun,
      totalMs,
      days: span,
      averageMinutes: Math.round(totalMs / 60_000 / span),
      goal: goalDays(days, goalMinutes, today),
      streakDays: streakDays(db, language, today, tz),
    },
  };
}
