// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
/**
 * Active study time; the tally of a Comprehensive session's practice (kept with the session, so it survives a reload or
 * another device; the practice itself is planned with the session, shared/mix.ts); and the session's Identify minimum.
 *
 * Active time is measured on the device: it runs while the page is visible and the learner did something (a tap, a
 * click, a key) in the last 90 seconds, so a phone left on the table does not count. A study session sends it with
 * every answer and event, practice rounds included; the Practice pages send it with each practice answer. A practice
 * round inside a session sends none of its own, so no minute is counted twice.
 */

/** Time without any input after which the clock stops. */
export const IDLE_AFTER_MS = 90_000;
/** The most active time one answer or event can carry (the server caps it too). */
export const MAX_ANSWER_ACTIVE_MS = 5 * 60_000;
/** A reading comprehension text is read and then answered: it may carry more. */
export const MAX_TEXT_ACTIVE_MS = 10 * 60_000;
/** Writing sentences planned in a Comprehensive session: at least this many when there are sentences to write. */
export const WRITING_MIN = 2;

/**
 * A stopwatch of active time. Call `input()` on every tap or key and `setVisible()` when the page is shown or hidden;
 * `take()` returns the active time since the last take and starts again. Exact without a timer: between two calls,
 * time counts up to 90 seconds after the latest input, and only while the page was visible.
 */
export class ActiveClock {
  private last: number;
  private lastInput: number;
  private visible: boolean;
  private pending = 0;
  private readonly now: () => number;
  private readonly idleMs: number;

  /** Starting counts as an input: the learner just opened the page or pressed Start. */
  constructor(now: () => number = Date.now, visible = true, idleMs = IDLE_AFTER_MS) {
    this.now = now;
    this.idleMs = idleMs;
    this.visible = visible;
    this.last = now();
    this.lastInput = this.last;
  }

  private tick(): void {
    const t = this.now();
    if (this.visible && t > this.last) this.pending += Math.max(0, Math.min(t, this.lastInput + this.idleMs) - this.last);
    this.last = Math.max(this.last, t);
  }

  input(): void {
    this.tick();
    this.lastInput = this.last;
  }

  setVisible(visible: boolean): void {
    this.tick();
    this.visible = visible;
  }

  /** Active time not taken yet. */
  peek(): number {
    this.tick();
    return this.pending;
  }

  take(): number {
    const ms = this.peek();
    this.pending = 0;
    return ms;
  }
}

/** Active time split into parts of at most `max` each, as the server accepts them (whole milliseconds, no zeros). */
export function splitActiveMs(ms: number, max = MAX_ANSWER_ACTIVE_MS): number[] {
  const out: number[] = [];
  let left = Math.max(0, Math.round(ms));
  while (left > 0) {
    const part = Math.min(left, max);
    out.push(part);
    left -= part;
  }
  return out;
}

// ------------------------------------------------------------------ practice rounds in a session

/** The skills a Comprehensive session's practice rounds train, in the order the summary lists them. */
export const ROUND_SKILLS = ['forms', 'cloze', 'identify', 'read', 'say', 'comprehension', 'writing'] as const;
export type RoundSkill = (typeof ROUND_SKILLS)[number];

/** A round: its practice mode and how it asks (sentence gaps with four choices or typed; Read or Say it). */
export type RoundKind = 'forms' | 'cloze' | 'cloze-typed' | 'identify' | 'read' | 'say' | 'comprehension' | 'writing';
/** The skill a round trains, as the session summary lists them (Read and Say it apart). */
export const skillOf = (k: RoundKind): RoundSkill => (k === 'cloze-typed' ? 'cloze' : k);

/** Per skill: rounds run, answers given and answers right (comprehension: one text a round, answers are questions). */
export interface RoundTally {
  rounds: number;
  answered: number;
  correct: number;
}
export type RoundTallies = Partial<Record<RoundSkill, RoundTally>>;

/** What counts as right in a round: a correct answer, or a sentence read and understood in full. */
export function isRoundRight(grade: string): boolean {
  return grade === 'correct' || grade === 'understood';
}

/**
 * The tallies with a round's answers added; a round with no answers (skipped at once) adds nothing. `more`: further
 * answers of a round already counted, which is not counted as a round again.
 */
export function addRound(tallies: RoundTallies, skill: RoundSkill, grades: string[], more = false): RoundTallies {
  if (!grades.length) return tallies;
  const t = tallies[skill] ?? { rounds: 0, answered: 0, correct: 0 };
  return { ...tallies, [skill]: { rounds: t.rounds + (more ? 0 : 1), answered: t.answered + grades.length, correct: t.correct + grades.filter(isRoundRight).length } };
}

/** The most answers a `round` event can carry (a round asks five questions at most). */
export const ROUND_MAX_ANSWERS = 10;

/**
 * A `round` session event: the answers given in one practice round (a slot of the session's mix) of a Comprehensive
 * session. The device sends one after each answer, and one with `end` when the round is over, so the session keeps its
 * count, its summary and its Identify minimum wherever it is resumed.
 */
export interface RoundEvent {
  /** The slot's id (shared/mix.ts), or one made on the device for a round of an older session. */
  roundId: string;
  skill: RoundSkill;
  /** The grade of each answer, in order, from answer number `from` (0: the round's first). */
  grades: string[];
  /** Answers of the round counted before these: a round resumed after a reload goes on from there. */
  from?: number;
  /** The round is over: done, ended early, or with nothing to ask (then `grades` may be empty). */
  end?: boolean;
}

/** What a session keeps of its rounds (in its plan meta): the tallies, how many answers each round has, and the rounds over. */
export interface RoundRecord {
  rounds?: RoundTallies;
  roundAnswers?: Record<string, number>;
  roundsEnded?: Record<string, true>;
}

/**
 * The record with a round event merged in, the same way on the server and on the device. An event adds only the
 * answers beyond those already counted for its round, so a replayed, repeated or late event adds nothing and a round
 * counts once however many events it sends. The record itself is returned when nothing changes.
 */
export function mergeRound<T extends RoundRecord>(record: T, ev: RoundEvent): T {
  // Own keys only: a round id is text from the device.
  const counted = record.roundAnswers ?? {};
  const seen = Object.hasOwn(counted, ev.roundId) ? Number(counted[ev.roundId]) || 0 : null;
  const have = seen ?? 0;
  // The event's answers run from `from`; a gap before them (an event that never arrived) is closed up.
  const start = Math.min(Math.max(0, Math.floor(Number(ev.from) || 0)), have);
  const grades = ev.grades.slice(have - start, Math.max(0, ROUND_MAX_ANSWERS - start));
  const ending = !!ev.end && !(record.roundsEnded && Object.hasOwn(record.roundsEnded, ev.roundId));
  if (!grades.length && !ending) return record;
  const out = { ...record };
  if (grades.length) {
    out.rounds = addRound(record.rounds ?? {}, ev.skill, grades, seen != null);
    out.roundAnswers = { ...counted, [ev.roundId]: have + grades.length };
  }
  if (ending) out.roundsEnded = { ...record.roundsEnded, [ev.roundId]: true };
  return out;
}

/** All answers of the rounds, and how many were right. */
export function roundTotals(tallies: RoundTallies): { answered: number; correct: number } {
  let answered = 0;
  let correct = 0;
  for (const s of ROUND_SKILLS) {
    answered += tallies[s]?.answered ?? 0;
    correct += tallies[s]?.correct ?? 0;
  }
  return { answered, correct };
}

// ------------------------------------------------------------------ the Identify minimum of a Comprehensive session

/** Questions in a usual practice round. */
export const ROUND_SIZE = 3;
/** Every Comprehensive session asks at least this many Identify questions when the learner's words have pictures. */
export const IDENTIFY_MIN = 5;
/** Where Identify fills up from, in order, when the session's own words name too few pictures. */
export const IDENTIFY_FILL = ['learning', 'all'] as const;
export type IdentifyFillScope = (typeof IDENTIFY_FILL)[number];

/** Identify questions the session still owes: the minimum less the Identify questions answered in its rounds so far. */
export function identifyOwed(tallies: RoundTallies): number {
  return Math.max(0, IDENTIFY_MIN - (tallies.identify?.answered ?? 0));
}

/** How the session's next Identify round asks for its pictures. */
export interface IdentifyRoundPlan {
  /** Questions to ask for. */
  size: number;
  /** After the session's own words, the scopes to fill up from, in order; none for a usual round. */
  fill: IdentifyFillScope[];
}

/**
 * How an Identify round of the session's mix asks for its pictures: its planned size, at least what the session still
 * owes while the learner's words have pictures to give (`exhausted`: a filled-up round came back short), and then filled
 * up past the session's own words, from the words being learned and then all the learner's words. Once the minimum is
 * met, just the planned size on the session's own words.
 */
export function identifyRoundPlan(tallies: RoundTallies, exhausted: boolean, size = ROUND_SIZE): IdentifyRoundPlan {
  const owed = exhausted ? 0 : identifyOwed(tallies);
  if (owed === 0) return { size, fill: [] };
  return { size: Math.max(size, owed), fill: [...IDENTIFY_FILL] };
}

/** A filled-up round that came back with fewer pictures than it asked for: the learner's words have no more to give. */
export function identifyExhausted(plan: IdentifyRoundPlan, received: number): boolean {
  return plan.fill.length > 0 && received < plan.size;
}

// ------------------------------------------------------------------ round sizes

/** The fewest sentences a session's speaking practice asks for (shared/mix.ts). */
export const READ_ROUND_SIZE = 2;
/** Questions on a round's reading text: a short everyday text has three (a longer passage, when no short one is left, four). */
export const TEXT_ROUND_SIZE = 3;
