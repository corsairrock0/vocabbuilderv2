// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
/**
 * FSRS integration with the database.
 *
 * Scheduling policy (docs/LEARNING_ENGINE.md):
 *  - Every answered exercise is stored as a practice attempt.
 *  - A card receives at most ONE scheduling event (review_logs row) per local day; the
 *    unique index uq_reviews_card_day enforces this even under concurrent devices.
 *  - New words get a single initial event summarising their in-session learning sequence.
 *  - Late (offline) events dated before the card's latest review are inserted and the card
 *    is recomputed by replaying its complete history in chronological order.
 *  - Since 2.0.0 practice answers schedule too (scheduleFromPractice): every kind of question tests a word's memory.
 */
import type { Db } from '../db/database.ts';
import { CardState, FsrsScheduler, fuzzSeed, seededRandom, type FsrsCardState, type Rating } from '../../shared/fsrs.ts';
import { PARAMETER_LOWER, PARAMETER_UPPER } from '../../shared/fsrs-optimizer.ts';
import type { CardSkill } from '../../shared/exercises.ts';
import type { LanguageCode } from '../../shared/languages.ts';
import type { ReviewChange } from '../../shared/types.ts';
import { getLanguageSettings } from '../services/settings.ts';
import { endOfLocalDay, localDay } from '../../shared/time.ts';

export interface CardRow {
  id: number;
  item_id: number;
  language_code: LanguageCode;
  skill: CardSkill;
  state: number;
  step: number | null;
  stability: number | null;
  difficulty: number | null;
  due: number | null;
  last_review: number | null;
  reps: number;
  lapses: number;
  scheduled_days: number;
  version: number;
}

const schedulers = new Map<string, FsrsScheduler>();

/**
 * The language's scheduler: its desired retention and, since 2.0.0, the parameters fitted to the learner's reviews
 * when there are any (server/learning/memory-model.ts); the standard FSRS-6 parameters otherwise.
 */
export function schedulerFor(db: Db, language: LanguageCode): FsrsScheduler {
  const settings = getLanguageSettings(db, language);
  const retention = settings.desiredRetention;
  const parameters = validParameters(settings.fsrsParameters);
  const key = `${retention}|${parameters ? parameters.join(',') : ''}`;
  let s = schedulers.get(key);
  if (!s) {
    // A handful of models at most (six languages, a few retention targets): the old ones are dropped.
    if (schedulers.size > 50) schedulers.clear();
    s = new FsrsScheduler({ desiredRetention: retention, ...(parameters ? { parameters } : {}) });
    schedulers.set(key, s);
  }
  return s;
}

/** Stored parameters when they are 21 finite numbers within FSRS-6's ranges, else null (the standard ones are used). */
export function validParameters(p: unknown): number[] | null {
  if (!Array.isArray(p) || p.length !== 21) return null;
  for (let i = 0; i < 21; i++) {
    const v = p[i];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < PARAMETER_LOWER[i] || v > PARAMETER_UPPER[i]) return null;
  }
  return p as number[];
}

export function toFsrs(c: Pick<CardRow, 'state' | 'step' | 'stability' | 'difficulty' | 'due' | 'last_review'>): FsrsCardState {
  return {
    state: c.state as FsrsCardState['state'],
    step: c.step,
    stability: c.stability,
    difficulty: c.difficulty,
    due: c.due,
    lastReview: c.last_review,
  };
}

export function ensureCards(db: Db, itemId: number, language: LanguageCode, now: number): void {
  for (const skill of ['receptive', 'productive'] as const) {
    db.run(
      `INSERT INTO fsrs_cards (item_id, language_code, skill, state, updated_at) VALUES (?, ?, ?, 0, ?)
       ON CONFLICT(item_id, skill) DO NOTHING`,
      itemId,
      language,
      skill,
      now,
    );
  }
}

export function getCard(db: Db, itemId: number, skill: CardSkill): CardRow | undefined {
  return db.get<CardRow>('SELECT * FROM fsrs_cards WHERE item_id = ? AND skill = ?', itemId, skill);
}

/** When the card was due at a past moment (its history replayed up to then), or now; null before its first event. */
export function dueAsOf(db: Db, card: CardRow, at: number): number | null {
  if (card.last_review == null || at >= card.last_review) return card.due;
  const prior = db.all<{ rating: Rating; reviewed_at: number }>('SELECT rating, reviewed_at FROM review_logs WHERE card_id = ? AND reviewed_at < ? ORDER BY reviewed_at, id', card.id, at);
  if (!prior.length) return null; // not yet scheduled at that time (its first event is the aggregated initial rating)
  const { card: state } = schedulerFor(db, card.language_code).replay(
    prior.map((p) => ({ rating: p.rating, reviewedAt: p.reviewed_at })),
    (_i, t) => seededRandom(fuzzSeed(card.id, t)),
  );
  return state.due;
}

/** One more answer as evidence of a skill (the knowledge levels on the word page; never a scheduling event). */
export function updateEvidence(db: Db, itemId: number, skill: string, success: boolean, score: number, at: number, delayed: boolean) {
  db.run('INSERT INTO skill_evidence (item_id, skill) VALUES (?, ?) ON CONFLICT DO NOTHING', itemId, skill);
  db.run(
    `UPDATE skill_evidence SET attempts = attempts + 1, correct = correct + ?, delayed_correct = delayed_correct + ?,
       streak = CASE WHEN ? THEN streak + 1 ELSE 0 END,
       ewma = CASE WHEN attempts = 0 THEN ? ELSE ewma * 0.7 + ? * 0.3 END,
       last_attempt_at = ?, last_correct_at = CASE WHEN ? THEN ? ELSE last_correct_at END,
       last_incorrect_at = CASE WHEN ? THEN last_incorrect_at ELSE ? END
     WHERE item_id = ? AND skill = ?`,
    success ? 1 : 0,
    success && delayed ? 1 : 0,
    success ? 1 : 0,
    score,
    score,
    at,
    success ? 1 : 0,
    at,
    success ? 1 : 0,
    at,
    itemId,
    skill,
  );
}

/**
 * How much each word's memory needs a test now (2.0.0), for ordering practice: 0 for a word due by the end of today
 * (then earlier due first), 1 for a word scheduled later, 2 for a word not scheduled yet. Practice that asks the due
 * words first does their reviews (scheduleFromPractice).
 */
export function practiceUrgency(db: Db, entryIds: number[], now: number, timezone: string): (entryId: number) => [number, number] {
  const end = endOfLocalDay(now, timezone);
  const due = new Map<number, number>();
  for (let i = 0; i < entryIds.length; i += 500) {
    const part = entryIds.slice(i, i + 500);
    for (const r of db.all<{ entry_id: number; due: number }>(
      `SELECT li.entry_id, MIN(c.due) AS due FROM learning_items li JOIN fsrs_cards c ON c.item_id = li.id
        WHERE li.status = 'active' AND c.state != 0 AND c.due IS NOT NULL AND li.entry_id IN (SELECT value FROM json_each(?)) GROUP BY li.entry_id`,
      JSON.stringify(part),
    ))
      due.set(r.entry_id, r.due);
  }
  return (entryId) => {
    const d = due.get(entryId);
    if (d == null) return [2, 0];
    return d < end ? [0, d] : [1, 0];
  };
}

export interface PracticeReviewInput {
  language: LanguageCode;
  entryId: number;
  /** The memory the question tests: the word's meaning from the word (receptive) or the word itself (productive). */
  skill: CardSkill;
  rating: Rating;
  answeredAt: number;
  timezone: string;
  /** Unique per answer and word, so a retried upload schedules once. */
  opId: string;
  /** What asked, such as practice:forms or practice:writing (kept with the event). */
  exerciseKind: string;
  sessionId?: string | null;
  deviceId?: string | null;
  now: number;
}

/**
 * A practice answer as a scheduling event (2.0.0): grammar forms, sentence gaps, pictures and Writing test a word's
 * memory like a session exercise does, so they count the same way. The rules stay those of the review log: at most one
 * event per memory per local day, never both memories of a word on one day, and never a word's first event (a new
 * word's first session rates it as a whole). A card due today takes the answer as its review. A card not due yet takes
 * it too (FSRS weighs an early review by how likely recall still was, and a word missed early comes back soon), unless
 * the word's other memory is due today: practice never holds back a due review. Returns the change, or null.
 */
export function scheduleFromPractice(db: Db, input: PracticeReviewInput): ReviewChange | null {
  const item = db.get<{ id: number; status: string }>('SELECT id, status FROM learning_items WHERE entry_id = ? AND language_code = ?', input.entryId, input.language);
  if (!item || item.status !== 'active') return null;
  const card = getCard(db, item.id, input.skill);
  if (!card || card.state === CardState.New) return null;
  const dueThen = dueAsOf(db, card, input.answeredAt);
  if (dueThen == null) return null;
  const end = endOfLocalDay(input.answeredAt, input.timezone);
  if (dueThen >= end) {
    const other = getCard(db, item.id, input.skill === 'receptive' ? 'productive' : 'receptive');
    const otherDue = other && other.state !== CardState.New ? dueAsOf(db, other, input.answeredAt) : null;
    if (otherDue != null && otherDue < end) return null;
  }
  if (db.get('SELECT 1 FROM review_logs WHERE op_id = ?', input.opId)) return null;
  return applyReview(db, {
    card,
    rating: input.rating,
    reviewedAt: input.answeredAt,
    timezone: input.timezone,
    opId: input.opId,
    ratingSource: 'auto',
    exerciseKind: input.exerciseKind,
    attemptId: null,
    sessionId: input.sessionId ?? null,
    deviceId: input.deviceId ?? null,
    now: input.now,
  });
}

/**
 * Change the rating of practice events after the fact ("I was right" turns a wrong Writing answer right): each
 * event of this answer rated Again becomes Good, and its card is recomputed from its whole history.
 */
export function rerateEvents(db: Db, opIdPrefix: string, from: Rating, to: Rating): number {
  const logs = db.all<{ id: number; card_id: number; item_id: number; language_code: string; local_day: string }>(
    "SELECT id, card_id, item_id, language_code, local_day FROM review_logs WHERE op_id LIKE ? ESCAPE '\\' AND rating = ?",
    opIdPrefix.replace(/[\\%_]/g, (c) => '\\' + c) + '%',
    from,
  );
  for (const l of logs) {
    db.run('UPDATE review_logs SET rating = ? WHERE id = ?', to, l.id);
    replayCard(db, l.card_id);
    db.run('UPDATE learning_items SET times_forgotten = (SELECT COALESCE(SUM(lapses), 0) FROM fsrs_cards WHERE item_id = ?) WHERE id = ?', l.item_id, l.item_id);
    if (from === 1 && to > 1) bumpDaily(db, l.language_code, l.local_day, { reviews_passed: 1 });
  }
  return logs.length;
}

export interface ApplyReviewInput {
  card: CardRow;
  rating: Rating;
  reviewedAt: number;
  timezone: string;
  opId: string;
  ratingSource: 'auto' | 'self' | 'adjusted' | 'aggregate';
  exerciseKind: string | null;
  attemptId: number | null;
  sessionId: string | null;
  deviceId: string | null;
  now: number;
}

/**
 * Returns the schedule change, or null when the answer stays practice: the card already had today's scheduling
 * event, or the word's other memory did. The one exception is a new word's first session, where each memory gets
 * its aggregated initial rating on the same day.
 */
export function applyReview(db: Db, input: ApplyReviewInput): ReviewChange | null {
  const { card, rating, timezone } = input;
  const day = localDay(input.reviewedAt, timezone);
  const exists = db.get('SELECT id FROM review_logs WHERE card_id = ? AND local_day = ?', card.id, day);
  if (exists) return null;
  const siblingToday = db.all<{ rating_source: string }>(
    'SELECT r.rating_source FROM review_logs r WHERE r.item_id = ? AND r.card_id != ? AND r.local_day = ?',
    card.item_id,
    card.id,
    day,
  );
  if (siblingToday.length && !(input.ratingSource === 'aggregate' && siblingToday.every((r) => r.rating_source === 'aggregate'))) return null;
  const sched = schedulerFor(db, card.language_code);
  const outOfOrder = card.last_review != null && input.reviewedAt < card.last_review;
  const before = toFsrs(card);
  const out = sched.review(outOfOrder ? toFsrs({ ...card, state: 0, step: null, stability: null, difficulty: null, due: null, last_review: null }) : before, rating, input.reviewedAt, seededRandom(fuzzSeed(card.id, input.reviewedAt)));
  const res = db.run(
    `INSERT INTO review_logs (op_id, card_id, item_id, language_code, skill, rating, rating_source, reviewed_at, local_day,
       state_before, stability_before, difficulty_before, due_before, elapsed_days, retrievability_before,
       state_after, stability_after, difficulty_after, due_after, scheduled_days, exercise_kind, attempt_id, session_id, device_id, received_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    input.opId,
    card.id,
    card.item_id,
    card.language_code,
    card.skill,
    rating,
    input.ratingSource,
    input.reviewedAt,
    day,
    before.state,
    before.stability,
    before.difficulty,
    before.due,
    out.elapsedDays,
    out.retrievability,
    out.card.state,
    out.card.stability!,
    out.card.difficulty!,
    out.card.due!,
    out.scheduledDays,
    input.exerciseKind,
    input.attemptId,
    input.sessionId,
    input.deviceId,
    input.now,
  );
  let change: ReviewChange;
  if (outOfOrder) {
    replayCard(db, card.id);
    // Keep the item's forgotten count equal to its cards' lapse counts after recomputation.
    db.run('UPDATE learning_items SET times_forgotten = (SELECT COALESCE(SUM(lapses), 0) FROM fsrs_cards WHERE item_id = ?) WHERE id = ?', card.item_id, card.item_id);
    const log = db.get<{ scheduled_days: number; due_after: number; retrievability_before: number | null; stability_after: number }>(
      'SELECT scheduled_days, due_after, retrievability_before, stability_after FROM review_logs WHERE id = ?',
      res.lastInsertRowid,
    )!;
    change = { cardSkill: card.skill, rating, scheduledDays: log.scheduled_days, dueAfter: log.due_after, retrievabilityBefore: log.retrievability_before, stabilityAfter: log.stability_after };
  } else {
    const lapse = rating === 1 && card.state === CardState.Review ? 1 : 0;
    db.run(
      `UPDATE fsrs_cards SET state = ?, step = ?, stability = ?, difficulty = ?, due = ?, last_review = ?, reps = reps + 1,
         lapses = lapses + ?, scheduled_days = ?, version = version + 1, updated_at = ? WHERE id = ?`,
      out.card.state,
      out.card.step,
      out.card.stability,
      out.card.difficulty,
      out.card.due,
      out.card.lastReview,
      lapse,
      out.scheduledDays,
      input.now,
      card.id,
    );
    if (lapse) db.run('UPDATE learning_items SET times_forgotten = times_forgotten + 1 WHERE id = ?', card.item_id);
    change = { cardSkill: card.skill, rating, scheduledDays: out.scheduledDays, dueAfter: out.card.due!, retrievabilityBefore: out.retrievability, stabilityAfter: out.card.stability! };
  }
  db.run(
    `UPDATE learning_items SET status = CASE WHEN status IN ('new', 'introduced') THEN 'active' ELSE status END,
       first_scheduled_at = COALESCE(first_scheduled_at, ?), last_studied_at = MAX(COALESCE(last_studied_at, 0), ?),
       version = version + 1, updated_at = ? WHERE id = ?`,
    input.reviewedAt,
    input.reviewedAt,
    input.now,
    card.item_id,
  );
  // A new word's aggregated initial rating is not a review of something learned earlier, so it is not counted as one.
  if (input.ratingSource !== 'aggregate') bumpDaily(db, card.language_code, day, { reviews: 1, reviews_passed: rating > 1 ? 1 : 0 });
  return change;
}

/** Recompute a card and its logs' before/after fields from the complete review history. */
export function replayCard(db: Db, cardId: number): void {
  const card = db.get<CardRow>('SELECT * FROM fsrs_cards WHERE id = ?', cardId);
  if (!card) return;
  const logs = db.all<{ id: number; rating: Rating; reviewed_at: number }>(
    'SELECT id, rating, reviewed_at FROM review_logs WHERE card_id = ? ORDER BY reviewed_at, id',
    cardId,
  );
  const sched = schedulerFor(db, card.language_code);
  let state: FsrsCardState = { state: 0, step: null, stability: null, difficulty: null, due: null, lastReview: null };
  let reps = 0;
  let lapses = 0;
  let scheduledDays = 0;
  for (const l of logs) {
    const out = sched.review(state, l.rating, l.reviewed_at, seededRandom(fuzzSeed(cardId, l.reviewed_at)));
    if (l.rating === 1 && state.state === CardState.Review) lapses++;
    db.run(
      `UPDATE review_logs SET state_before = ?, stability_before = ?, difficulty_before = ?, due_before = ?, elapsed_days = ?,
         retrievability_before = ?, state_after = ?, stability_after = ?, difficulty_after = ?, due_after = ?, scheduled_days = ? WHERE id = ?`,
      state.state,
      state.stability,
      state.difficulty,
      state.due,
      out.elapsedDays,
      out.retrievability,
      out.card.state,
      out.card.stability!,
      out.card.difficulty!,
      out.card.due!,
      out.scheduledDays,
      l.id,
    );
    state = out.card;
    reps++;
    scheduledDays = out.scheduledDays;
  }
  db.run(
    `UPDATE fsrs_cards SET state = ?, step = ?, stability = ?, difficulty = ?, due = ?, last_review = ?, reps = ?, lapses = ?,
       scheduled_days = ?, version = version + 1, updated_at = ? WHERE id = ?`,
    state.state,
    state.step,
    state.stability,
    state.difficulty,
    state.due,
    state.lastReview,
    reps,
    lapses,
    scheduledDays,
    Date.now(),
    cardId,
  );
}

/** Recompute all cards of a language (e.g. after changing desired retention, intervals adjust). */
export function rescheduleLanguage(db: Db, language: LanguageCode): number {
  const ids = db.all<{ id: number }>('SELECT id FROM fsrs_cards WHERE language_code = ? AND state != 0', language);
  for (const { id } of ids) replayCard(db, id);
  return ids.length;
}

/**
 * Active time from the Practice pages, sent with a practice answer, added to the day's study time (daily totals only).
 * Callers add it only when the attempt was newly stored, so a retried upload counts once; practice rounds inside a
 * session send none, because the session counts their time.
 */
export function addPracticeTime(db: Db, language: LanguageCode, day: string, activeMs: number | null | undefined, max: number): void {
  const ms = Math.min(Math.max(Math.round(Number(activeMs) || 0), 0), max);
  if (ms > 0) bumpDaily(db, language, day, { study_ms: ms });
}

export function bumpDaily(db: Db, language: string, day: string, inc: Partial<Record<string, number>>): void {
  const cols = Object.keys(inc).filter((k) => /^[a-z_]+$/.test(k) && inc[k]);
  db.run('INSERT INTO daily_stats (language_code, local_day) VALUES (?, ?) ON CONFLICT DO NOTHING', language, day);
  if (!cols.length) return;
  db.run(
    `UPDATE daily_stats SET ${cols.map((c) => `${c} = ${c} + ?`).join(', ')} WHERE language_code = ? AND local_day = ?`,
    ...cols.map((c) => inc[c]!),
    language,
    day,
  );
}
