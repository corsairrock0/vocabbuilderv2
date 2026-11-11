// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
/**
 * The mix of a Comprehensive session: reviews and new words (each met a few ways), listening, and practice of every
 * kind, a few questions at a time: grammar (forms), sentence gaps, pictures (Identify, at least five), speaking (Say
 * it), one short text to read and, since 1.9.0, sentences to write (Writing, one at a time). The practice is planned with the session (planPractice, stored in its plan meta, so
 * every device shows the same mix and the counter a steady total) and each slot is filled when the session reaches
 * it; a slot with nothing to ask (no content, offline) is skipped and the total shrinks. Since 2.0.0 the practice
 * answers count toward the words they test (server/learning/scheduling.ts, scheduleFromPractice).
 */
import { IDENTIFY_MIN, READ_ROUND_SIZE, ROUND_SIZE, TEXT_ROUND_SIZE, WRITING_MIN, type RoundKind, type RoundRecord } from './activity.ts';
import type { ExerciseKind } from './exercises.ts';
import type { LanguageCode } from './languages.ts';
import { hasParadigms } from './paradigms.ts';

/** The kinds of question the session's screens name, in the order the start screen lists them. */
export const QUESTION_TYPES = ['review', 'new', 'listening', 'grammar', 'sentences', 'pictures', 'speaking', 'reading', 'writing'] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

/** Each type's name (on a question, singular) and the start screen's line (plural, with what it asks). */
export const TYPE_INFO: Record<QuestionType, { name: string; plural: string; what: string }> = {
  review: { name: 'Review', plural: 'Reviews', what: 'words due today' },
  new: { name: 'New word', plural: 'New words', what: 'each met a few ways' },
  listening: { name: 'Listening', plural: 'Listening', what: 'hear it, pick or type it' },
  grammar: { name: 'Grammar', plural: 'Grammar', what: 'the right form' },
  sentences: { name: 'Sentences', plural: 'Sentences', what: 'fill the gap' },
  pictures: { name: 'Pictures', plural: 'Pictures', what: 'name what you see' },
  speaking: { name: 'Speaking', plural: 'Speaking', what: 'say a sentence' },
  reading: { name: 'Reading', plural: 'Reading', what: 'one short text' },
  writing: { name: 'Writing', plural: 'Writing', what: 'translate a sentence, every word right' },
};

const LISTENING_KINDS: readonly ExerciseKind[] = ['listen_meaning', 'listen_choice', 'dictation'];

/** A session exercise's type: by ear is Listening; otherwise a new word's, or a review. */
export function exerciseType(kind: ExerciseKind, isNew: boolean): QuestionType {
  return LISTENING_KINDS.includes(kind) ? 'listening' : isNew ? 'new' : 'review';
}

/** A practice slot's type (Read sentences, the fallback of a speaking slot, count as reading). */
export function roundType(kind: RoundKind): QuestionType {
  switch (kind) {
    case 'forms':
      return 'grammar';
    case 'cloze':
    case 'cloze-typed':
      return 'sentences';
    case 'identify':
      return 'pictures';
    case 'say':
      return 'speaking';
    case 'read':
    case 'comprehension':
      return 'reading';
    case 'writing':
      return 'writing';
  }
}

/** Model seconds a Writing sentence takes (reading the English, typing the sentence, the feedback). */
export const WRITING_SECONDS = 30;

/** Writing sentences in a Comprehensive session of `minutes` model minutes: about one per five, two to eight. */
export function writingCount(minutes: number): number {
  return Math.min(8, Math.max(WRITING_MIN, Math.round(Math.max(1, minutes) / 5) + 1));
}

/** Practice planned with a session: one round of questions of one kind. */
export interface PracticeSlot {
  /** Its round id (the `round` events of the session carry it). */
  id: string;
  /** What it asks; a speaking slot reads instead when no sentence can be said. */
  kind: RoundKind;
  /** Questions planned (a reading text asks its own: three, four for a longer passage). */
  size: number;
  /** It comes once this many of the session's exercises are done (answered or skipped); at the end, all that are left. */
  after: number;
}

/**
 * The practice of a Comprehensive session of `minutes` with `exercises` planned (the reviews and new words take about
 * two thirds of the time, less the writing). `minutes` are minutes of the time model: the session's real minutes divided
 * by the learner's pace (planner.ts), while the text comes from ten real minutes up (`realMinutes`, the same when not
 * given). Per 20 model minutes about six grammar and six sentence questions (sentences only where words have no
 * tables), three to say, the Identify minimum of five (more in long sessions), and one short text; with `writing` (the
 * language has sentences left to write) writingCount sentences, one per round; in rounds of three or fewer (Identify's
 * first is the five), the kinds taking turns, spread evenly between the exercises, the text in the second half.
 */
export function planPractice(input: { language: LanguageCode; minutes: number; exercises: number; realMinutes?: number; writing?: boolean }): PracticeSlot[] {
  const m = Math.max(1, input.minutes);
  const tables = hasParadigms(input.language);
  const rounds = (n: number) => Math.max(1, Math.round(n));
  const queues: Record<'forms' | 'cloze' | 'identify' | 'say' | 'writing', Array<{ kind: RoundKind; size: number }>> = { forms: [], cloze: [], identify: [], say: [], writing: [] };
  if (tables) for (let i = 0; i < rounds(m / 10); i++) queues.forms.push({ kind: 'forms', size: ROUND_SIZE });
  for (let i = 0; i < rounds(m / 10) + (tables ? 0 : Math.round(m / 20)); i++) queues.cloze.push({ kind: i % 2 ? 'cloze-typed' : 'cloze', size: ROUND_SIZE });
  queues.identify.push({ kind: 'identify', size: IDENTIFY_MIN });
  for (let i = 0; i < Math.max(0, Math.round((m - 20) / 15)); i++) queues.identify.push({ kind: 'identify', size: ROUND_SIZE });
  for (let left = Math.max(READ_ROUND_SIZE, Math.round((3 * m) / 20)); left > 0; left -= ROUND_SIZE) queues.say.push({ kind: 'say', size: Math.min(ROUND_SIZE, left) });
  if (input.writing) for (let i = 0; i < writingCount(m); i++) queues.writing.push({ kind: 'writing', size: 1 });
  // Turns: grammar, sentences, pictures, speaking, writing, and again, so no kind comes twice in a row while others are left.
  const order: Array<{ kind: RoundKind; size: number }> = [];
  while (Object.values(queues).some((q) => q.length)) {
    for (const k of ['forms', 'cloze', 'identify', 'say', 'writing'] as const) {
      const next = queues[k].shift();
      if (next) order.push(next);
    }
  }
  if ((input.realMinutes ?? m) >= 10) order.splice(Math.ceil(order.length * 0.6), 0, { kind: 'comprehension', size: TEXT_ROUND_SIZE });
  const exercises = Math.max(0, input.exercises);
  return order.map((x, i) => ({ id: `p${i + 1}`, kind: x.kind, size: x.size, after: Math.round(((i + 1) * exercises) / (order.length + 1)) }));
}

/**
 * The practice of a session planned before the mix (by an earlier version) when it is resumed: what its length would
 * plan for the part still to come (`left` of `done + left` exercises), spread over the exercises left, so nothing comes
 * back to back for the part already behind it.
 */
export function planFromHere(input: { language: LanguageCode; minutes: number; done: number; left: number }): PracticeSlot[] {
  if (input.left <= 0) return [];
  const minutes = Math.max(1, Math.round((input.minutes * input.left) / (input.done + input.left)));
  return planPractice({ language: input.language, minutes, exercises: input.left }).map((p) => ({ ...p, after: p.after + input.done }));
}

/** Where a slot stands: answers given in it so far, and whether it is over (done, ended early, or with nothing to ask). */
export function slotState(slot: PracticeSlot, record: RoundRecord): { answers: number; ended: boolean } {
  const answers = record.roundAnswers && Object.hasOwn(record.roundAnswers, slot.id) ? record.roundAnswers[slot.id] : 0;
  const ended = !!(record.roundsEnded && Object.hasOwn(record.roundsEnded, slot.id)) || answers >= slot.size;
  return { answers, ended };
}

/**
 * The questions the practice still has to ask: every slot not over, less the answers it has; the slot on screen counts
 * what it actually asks (`current`, its questions as loaded).
 */
export function practiceLeft(slots: readonly PracticeSlot[], record: RoundRecord, current?: { id: string; questions: number } | null): number {
  let left = 0;
  for (const s of slots) {
    const { answers, ended } = slotState(s, record);
    if (current && current.id === s.id) left += Math.max(0, current.questions - answers);
    else if (!ended) left += Math.max(0, s.size - answers);
  }
  return left;
}

/** The first slot due when `done` of the session's exercises are done (`end`: none is left), or null. */
export function slotDue(slots: readonly PracticeSlot[], record: RoundRecord, done: number, end: boolean): PracticeSlot | null {
  return slots.find((s) => !slotState(s, record).ended && (end || s.after <= done)) ?? null;
}

/**
 * The types coming up after the question on screen, a run of one type shown once: the pending exercises in order, with
 * the open slots due after each (`done`: the session's exercises done). `onScreenListed`: the question on screen is the
 * first pending exercise (not a slot, nor an exercise already answered), so it is not coming up.
 */
export function comingUp(exercises: readonly QuestionType[], slots: ReadonlyArray<Pick<PracticeSlot, 'after'> & { type: QuestionType }>, done: number, onScreenListed: boolean, max = 3): QuestionType[] {
  const queue = [...slots].sort((a, b) => a.after - b.after);
  const timeline: QuestionType[] = [];
  const flush = (upTo: number) => {
    while (queue.length && queue[0].after <= upTo) timeline.push(queue.shift()!.type);
  };
  if (!onScreenListed) flush(done); // slots due now come before the next exercise
  exercises.forEach((t, i) => {
    timeline.push(t);
    flush(done + i + 1);
  });
  timeline.push(...queue.map((s) => s.type));
  const runs: QuestionType[] = [];
  for (const t of timeline.slice(onScreenListed ? 1 : 0)) if (runs[runs.length - 1] !== t) runs.push(t);
  return runs.slice(0, max);
}

/** The counts per type of a planned session, for the start screen and Home (types with none left out, in order). */
export function mixCounts(exercises: ReadonlyArray<{ kind: ExerciseKind; isNew: boolean }>, slots: readonly PracticeSlot[]): Array<{ type: QuestionType; count: number }> {
  const n = new Map<QuestionType, number>();
  for (const e of exercises) n.set(exerciseType(e.kind, e.isNew), (n.get(exerciseType(e.kind, e.isNew)) ?? 0) + 1);
  for (const s of slots) n.set(roundType(s.kind), (n.get(roundType(s.kind)) ?? 0) + s.size);
  return QUESTION_TYPES.filter((t) => n.get(t)).map((t) => ({ type: t, count: n.get(t)! }));
}
