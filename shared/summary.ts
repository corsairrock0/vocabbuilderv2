// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
/**
 * What a study session's summary counts (web/src/pages/session/Summary.tsx): every question answered in it, the
 * session's own exercises and the answers of its practice rounds alike; how many were right; and one line per kind of
 * question, so that every answer is in exactly one line and the lines add up to the total. It is worked out from the
 * session itself (each exercise's kind and result, and the round tallies kept with the session), the same data as the
 * session's counter, so the two agree after a reload, on another device and offline.
 */
import type { Grade } from './answer.ts';
import { isSuccess, KINDS, type ExerciseKind } from './exercises.ts';
import { roundTotals, type RoundTallies } from './activity.ts';

/**
 * The session's own exercises as the summary lists them ("Every skill today"), with the practice skills after them:
 *   cards      new word cards, which have no right or wrong answer
 *   words      everything else about the words, reviews and new words alike (meanings, recall, sentences, forms, saying them)
 *   listening  by ear: the meaning, which word, dictation
 */
export const EXERCISE_GROUPS = ['cards', 'words', 'listening'] as const;
export type ExerciseGroup = (typeof EXERCISE_GROUPS)[number];

export function exerciseGroup(kind: ExerciseKind): ExerciseGroup {
  const skill = KINDS[kind].skill;
  return skill === 'exposure' ? 'cards' : skill === 'listening' ? 'listening' : 'words';
}

/** Answers given and how many were right. */
export interface AnswerTally {
  answered: number;
  right: number;
}

export interface SessionCounts {
  /** Every answer: the session's exercises answered (new word cards too; a skipped exercise is not an answer) and the rounds' answers. */
  answered: number;
  /** The answers that can be right or wrong: all but new word cards. */
  graded: number;
  /**
   * Of those, the ones right: a session exercise right the first time (a rated one rated Hard or better), a round
   * answer right or a sentence understood in full (isRoundRight).
   */
  right: number;
  /** right / graded; null with nothing graded. */
  accuracy: number | null;
  /** Exercises skipped, not answers (the counter counts them as done). */
  skipped: number;
  /** New word cards answered "I already know this word". */
  known: number;
  /** The session's own exercises per group, the groups with answers only. */
  exercises: Partial<Record<ExerciseGroup, AnswerTally>>;
  /** The rounds' answers per skill. */
  rounds: RoundTallies;
}

/** The parts of a session exercise the counts need (SessionExercise). */
export interface CountedExercise {
  kind: ExerciseKind;
  status: 'pending' | 'done' | 'skipped';
  result: { grade: Grade | 'self'; code?: string; rating?: number | null } | null;
}

export function sessionCounts(exercises: readonly CountedExercise[], rounds: RoundTallies = {}): SessionCounts {
  const groups: Partial<Record<ExerciseGroup, AnswerTally>> = {};
  let answered = 0;
  let graded = 0;
  let right = 0;
  let skipped = 0;
  let known = 0;
  for (const e of exercises) {
    if (e.status === 'skipped') skipped++;
    if (e.status !== 'done') continue;
    const group = exerciseGroup(e.kind);
    const tally = groups[group] ?? (groups[group] = { answered: 0, right: 0 });
    tally.answered++;
    answered++;
    if (group === 'cards') {
      if (e.result?.code === 'marked_known') known++;
      continue;
    }
    // Each exercise is answered once: its result is its first try (a self-rated one carries the rating given).
    const ok = !!e.result && isSuccess(e.result.grade, e.result.grade === 'self' ? e.result.rating : null);
    graded++;
    if (ok) {
      tally.right++;
      right++;
    }
  }
  const r = roundTotals(rounds);
  answered += r.answered;
  graded += r.answered;
  right += r.correct;
  return { answered, graded, right, accuracy: graded ? right / graded : null, skipped, known, exercises: groups, rounds };
}
