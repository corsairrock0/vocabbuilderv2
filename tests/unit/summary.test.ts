// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// What a session's summary counts (shared/summary.ts): every question answered, the session's own exercises and its
// practice rounds' answers; the share answered right; and one line per kind of question, every answer in exactly one
// row and the rows adding up to the total, which is the counter's final count less the exercises skipped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addRound, roundTotals, type RoundTallies } from '../../shared/activity.ts';
import { KINDS, type ExerciseKind } from '../../shared/exercises.ts';
import { EXERCISE_GROUPS, exerciseGroup, sessionCounts, type CountedExercise, type ExerciseGroup } from '../../shared/summary.ts';

const done = (kind: ExerciseKind, grade: string, extra: { rating?: number; code?: string } = {}): CountedExercise => ({ kind, status: 'done', result: { grade: grade as never, code: extra.code ?? '', rating: extra.rating ?? null } });
const skipped = (kind: ExerciseKind): CountedExercise => ({ kind, status: 'skipped', result: null });
const pending = (kind: ExerciseKind): CountedExercise => ({ kind, status: 'pending', result: null });

test('every exercise kind is in exactly one row of the summary: new word cards, by ear, or the rest of the words', () => {
  const kinds = Object.keys(KINDS) as ExerciseKind[];
  const byGroup = new Map<ExerciseGroup, ExerciseKind[]>();
  for (const k of kinds) {
    const g = exerciseGroup(k);
    assert.ok(EXERCISE_GROUPS.includes(g), k);
    byGroup.set(g, [...(byGroup.get(g) ?? []), k]);
  }
  assert.deepEqual(Object.fromEntries(byGroup), {
    cards: ['intro'],
    words: ['meaning_choice', 'meaning_typed', 'context_meaning', 'word_choice', 'recall_typed', 'cloze_choice', 'cloze_typed', 'form_typed', 'speak_flashcard', 'sentence_create', 'shadowing', 'picture_choice'],
    listening: ['listen_meaning', 'listen_choice', 'dictation'],
  });
  assert.equal(kinds.length, 16, 'a new kind needs a row');
});

/** A Comprehensive session ended early: exercises of every group, some skipped and some never reached, and rounds. */
function sample(): { exercises: CountedExercise[]; rounds: RoundTallies } {
  const exercises: CountedExercise[] = [
    done('intro', 'self'),
    done('intro', 'self', { code: 'marked_known' }),
    done('meaning_choice', 'correct'),
    done('picture_choice', 'incorrect'),
    done('context_meaning', 'correct'),
    done('listen_choice', 'correct'),
    done('dictation', 'close'), // "almost" is not right
    done('word_choice', 'correct'),
    done('recall_typed', 'incorrect'), // revealed answers are stored as incorrect
    done('cloze_typed', 'correct'),
    done('form_typed', 'close'),
    done('speak_flashcard', 'self', { rating: 3 }),
    done('shadowing', 'self', { rating: 1 }), // Again
    done('sentence_create', 'self', { rating: 2 }), // Hard counts as right, as in the statistics
    skipped('listen_meaning'),
    skipped('meaning_typed'),
    pending('cloze_choice'),
  ];
  let rounds: RoundTallies = {};
  rounds = addRound(rounds, 'forms', ['correct', 'incorrect', 'correct']);
  rounds = addRound(rounds, 'read', ['understood', 'partly', 'not', 'understood']);
  rounds = addRound(rounds, 'comprehension', ['correct', 'correct', 'incorrect']);
  rounds = addRound(rounds, 'comprehension', ['correct', 'correct', 'correct']);
  return { exercises, rounds };
}

test('the summary counts every answer: the session’s exercises answered (cards too, not skipped ones) and every round answer', () => {
  const { exercises, rounds } = sample();
  const c = sessionCounts(exercises, rounds);
  assert.equal(c.answered, 14 + 13);
  assert.equal(c.skipped, 2);
  assert.equal(c.known, 1);
  assert.deepEqual(c.exercises, {
    cards: { answered: 2, right: 0 },
    words: { answered: 10, right: 6 },
    listening: { answered: 2, right: 1 },
  });
  // The lines add up to the total: every answer is in exactly one of them.
  const lines = Object.values(c.exercises).reduce((s, t) => s + t.answered, 0) + roundTotals(c.rounds).answered;
  assert.equal(lines, c.answered);
  // The counter's final count is the exercises answered or skipped and the round answers: the total and the skipped.
  const counter = exercises.filter((e) => e.status !== 'pending').length + roundTotals(rounds).answered;
  assert.equal(counter, c.answered + c.skipped);
});

test('the share answered right covers every question that can be right: exercises at their first try and round answers', () => {
  const { exercises, rounds } = sample();
  const c = sessionCounts(exercises, rounds);
  // New word cards have no right answer: all the rest is graded, a sentence read in full and a rating of Hard or better
  // counting as right.
  assert.equal(c.graded, c.answered - c.exercises.cards!.answered);
  const exercisesRight = Object.values(c.exercises).reduce((s, t) => s + t.right, 0);
  assert.equal(exercisesRight, 7);
  assert.equal(roundTotals(rounds).correct, 2 + 2 + 5);
  assert.equal(c.right, exercisesRight + roundTotals(rounds).correct);
  assert.equal(c.accuracy, 16 / 25);
});

test('a session without rounds counts its exercises alone; nothing answered has no accuracy', () => {
  const { exercises } = sample();
  const c = sessionCounts(exercises);
  assert.deepEqual([c.answered, c.graded, c.right, c.rounds], [14, 12, 7, {}]);
  assert.deepEqual(sessionCounts([pending('intro'), skipped('meaning_choice')]), { answered: 0, graded: 0, right: 0, accuracy: null, skipped: 1, known: 0, exercises: {}, rounds: {} });
  // Only rounds answered (every exercise skipped): the rounds still count.
  const only = sessionCounts([skipped('meaning_choice')], addRound({}, 'identify', ['correct', 'revealed']));
  assert.deepEqual([only.answered, only.graded, only.right, only.accuracy], [2, 2, 1, 0.5]);
});
