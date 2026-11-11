// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Rating policy, initial-rating aggregation, remediation and knowledge levels.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateInitialRating,
  attemptScore,
  isSuccess,
  KINDS,
  masteryLevels,
  MATURE_STABILITY_DAYS,
  planRemediation,
  suggestRating,
  type ExerciseKind,
} from '../../shared/exercises.ts';

test('suggested ratings: wrong/revealed → Again, close or hinted → Hard, unaided correct → Good', () => {
  assert.equal(suggestRating({ kind: 'recall_typed', grade: 'incorrect', hintsUsed: 0 }), 1);
  assert.equal(suggestRating({ kind: 'recall_typed', grade: 'correct', hintsUsed: 0, revealed: true }), 1);
  assert.equal(suggestRating({ kind: 'recall_typed', grade: 'close', hintsUsed: 0 }), 2);
  assert.equal(suggestRating({ kind: 'recall_typed', grade: 'correct', hintsUsed: 1 }), 2, 'a correct answer that needed hints is not rated like an unaided one');
  assert.equal(suggestRating({ kind: 'recall_typed', grade: 'correct', hintsUsed: 0 }), 3);
  assert.equal(suggestRating({ kind: 'meaning_choice', grade: 'correct', hintsUsed: 0 }), 3);
});

test('Easy (4) is never suggested for objective formats — only learners give it', () => {
  const objective = (Object.keys(KINDS) as ExerciseKind[]).filter((k) => KINDS[k].response === 'choice' || KINDS[k].response === 'typed');
  for (const kind of objective) {
    for (const g of ['correct', 'close', 'incorrect'] as const) {
      assert.notEqual(suggestRating({ kind, grade: g, hintsUsed: 0 }), 4, `${kind}/${g}`);
    }
  }
  assert.equal(suggestRating({ kind: 'speak_flashcard', grade: 'self', hintsUsed: 0, selfRating: 4 }), 4);
  assert.equal(suggestRating({ kind: 'speak_flashcard', grade: 'self', hintsUsed: 0, selfRating: 1 }), 1);
});

test('scores and success flags', () => {
  assert.equal(attemptScore('correct'), 1);
  assert.equal(attemptScore('close'), 0.5);
  assert.equal(attemptScore('incorrect'), 0);
  assert.equal(isSuccess('close'), false, 'a near miss is not counted as a demonstrated success');
  assert.equal(isSuccess('self', 2), true);
  assert.equal(isSuccess('self', 1), false);
});

test('initial rating for a new word summarises the whole in-session sequence', () => {
  const at = (i: number) => 1000 + i;
  const ok = (i: number) => ({ grade: 'correct' as const, hintsUsed: 0, at: at(i) });
  const bad = (i: number) => ({ grade: 'incorrect' as const, hintsUsed: 0, at: at(i) });
  const close = (i: number) => ({ grade: 'close' as const, hintsUsed: 0, at: at(i) });
  assert.equal(aggregateInitialRating([]), null);
  assert.equal(aggregateInitialRating([ok(1), ok(2), ok(3)]), 3);
  assert.equal(aggregateInitialRating([ok(1), ok(2)], { claimedKnown: true }), 4);
  assert.equal(aggregateInitialRating([bad(1), ok(2), ok(3)]), 2, 'one early failure then success → Hard');
  assert.equal(aggregateInitialRating([ok(1), close(2), ok(3)]), 2, 'a near miss → Hard');
  assert.equal(aggregateInitialRating([{ grade: 'correct', hintsUsed: 1, at: at(1) }, ok(2)]), 2, 'hints → Hard');
  assert.equal(aggregateInitialRating([bad(1), bad(2), ok(3)]), 1, 'two failures → Again');
  assert.equal(aggregateInitialRating([ok(1), ok(2), bad(3)]), 1, 'last attempt failed → Again');
  // Order is by time, not array position.
  assert.equal(aggregateInitialRating([bad(3), ok(1), ok(2)]), 1);
});

test('remediation revisits a missed word later with a different format', () => {
  const pending = [10, 11, 12, 13, 14].map((seq) => ({ seq }));
  const base = { exercise: { id: 's:5', kind: 'meaning_choice' as ExerciseKind, itemId: 7, seq: 5 }, remediationsSoFar: 0, pending };
  const avail: ExerciseKind[] = ['meaning_choice', 'cloze_choice', 'listen_meaning', 'word_choice', 'recall_typed'];
  const r = planRemediation({ ...base, grade: 'incorrect', availableKinds: avail })!;
  assert.ok(r);
  assert.notEqual(r.kind, 'meaning_choice');
  assert.equal(r.kind, 'cloze_choice');
  assert.equal(r.itemId, 7);
  assert.equal(r.stage, 'H');
  assert.equal(r.parentId, 's:5');
  assert.equal(r.id, 's:5~r1');
  assert.equal(r.seq, (12 + 13) / 2, 'placed after three pending exercises (spacing)');
  // Deterministic.
  assert.deepEqual(planRemediation({ ...base, grade: 'incorrect', availableKinds: avail }), r);
  // Productive failures are scaffolded with productive formats.
  const p = planRemediation({ ...base, exercise: { ...base.exercise, kind: 'recall_typed' }, grade: 'close', availableKinds: avail })!;
  assert.equal(p.kind, 'word_choice');
  assert.equal(p.cardSkill, 'productive');
});

test('remediation limits: none after success, none for intros, at most two per word', () => {
  const pending = [{ seq: 9 }];
  const ex = { id: 'x', kind: 'meaning_choice' as ExerciseKind, itemId: 1, seq: 3 };
  const avail: ExerciseKind[] = ['meaning_choice', 'cloze_choice'];
  assert.equal(planRemediation({ exercise: ex, grade: 'correct', remediationsSoFar: 0, availableKinds: avail, pending }), null);
  assert.equal(planRemediation({ exercise: { ...ex, kind: 'intro' }, grade: 'incorrect', remediationsSoFar: 0, availableKinds: avail, pending }), null);
  assert.equal(planRemediation({ exercise: { ...ex, kind: 'shadowing' }, grade: 'self', selfRating: 1, remediationsSoFar: 0, availableKinds: avail, pending }), null);
  assert.equal(planRemediation({ exercise: ex, grade: 'incorrect', remediationsSoFar: 2, availableKinds: avail, pending }), null);
  assert.equal(planRemediation({ exercise: ex, grade: 'incorrect', remediationsSoFar: 0, availableKinds: ['meaning_choice'], pending }), null, 'no different format available');
  // Few pending exercises: appended after the last one; none pending: right after the current one.
  assert.equal(planRemediation({ exercise: ex, grade: 'incorrect', remediationsSoFar: 1, availableKinds: avail, pending })!.seq, 10);
  assert.equal(planRemediation({ exercise: ex, grade: 'incorrect', remediationsSoFar: 1, availableKinds: avail, pending: [] })!.seq, 4);
});

test('recognition formats are never productive scheduling events; assisted production is evidence only', () => {
  assert.equal(KINDS.word_choice.assisted, true);
  assert.equal(KINDS.word_choice.card, 'productive');
  for (const k of ['meaning_choice', 'listen_meaning', 'listen_choice', 'cloze_choice', 'context_meaning'] as ExerciseKind[]) {
    assert.equal(KINDS[k].card, 'receptive', k);
  }
  for (const k of ['recall_typed', 'cloze_typed', 'form_typed'] as ExerciseKind[]) {
    assert.equal(KINDS[k].card, 'productive', k);
    assert.equal(KINDS[k].assisted, false, k);
  }
  assert.equal(KINDS.shadowing.practiceOnly, true);
  assert.equal(KINDS.sentence_create.practiceOnly, true);
});

test('knowledge levels reflect demonstrated abilities, not exposure counts', () => {
  const base = { status: 'active', introducedAt: 1, receptiveStability: 30, productiveStability: 30, receptiveState: 2, audioAvailable: true };
  const ev = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).map(([k, n]) => [k, { delayedCorrect: n, correct: n + 5, attempts: n + 10 }]));
  // Lots of same-day exposure but no delayed success: still only "Encountered".
  const exposureOnly = masteryLevels({ ...base, evidence: { recognition: { delayedCorrect: 0, correct: 40, attempts: 40 } } });
  assert.equal(exposureOnly.stage, 1);
  assert.equal(exposureOnly.recognizesWritten, false);
  // Recognition alone never yields productive mastery.
  const recog = masteryLevels({ ...base, evidence: ev({ recognition: 3, listening: 2 }) });
  assert.equal(recog.recognizesWritten, true);
  assert.equal(recog.understandsListening, true);
  assert.equal(recog.retrievesFromEnglish, false);
  assert.equal(recog.productiveMastery, false);
  assert.equal(recog.stage, 3);
  // Assisted recall (choosing the word) is stored separately and does not count as recall.
  const assisted = masteryLevels({ ...base, evidence: { ...ev({ recognition: 3, listening: 2 }), recall_assisted: { delayedCorrect: 5, correct: 5, attempts: 5 } } as any });
  assert.equal(assisted.retrievesFromEnglish, false);
  // Productive mastery needs typed recall + sentence use after a delay AND mature productive stability.
  const notStable = masteryLevels({ ...base, productiveStability: MATURE_STABILITY_DAYS - 1, evidence: ev({ recognition: 3, listening: 2, recall: 2, sentence: 1 }) });
  assert.equal(notStable.usesInSentence, true);
  assert.equal(notStable.productiveMastery, false);
  assert.equal(notStable.stage, 5);
  const full = masteryLevels({ ...base, evidence: ev({ recognition: 3, listening: 2, recall: 2, sentence: 1 }) });
  assert.equal(full.productiveMastery, true);
  assert.equal(full.stage, 6);
  // Without audio, listening is untestable (null) and does not block later stages.
  const noAudio = masteryLevels({ ...base, audioAvailable: false, evidence: ev({ recognition: 1, recall: 1 }) });
  assert.equal(noAudio.understandsListening, null);
  assert.equal(noAudio.stage, 4);
  assert.equal(masteryLevels({ ...base, status: 'new', introducedAt: null, evidence: {} }).stage, 0);
});
