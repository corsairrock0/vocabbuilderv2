// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// The Identify minimum of a Comprehensive session (shared/activity.ts): how many Identify questions a session still
// owes, how an Identify slot of the mix asks for pictures (filled up from the words being learned, then all the
// learner's words) and when the learner's words have no more to give; the order in which a filled-up batch takes its
// pictures (server/learning/identify.ts, pickObjects); and the practice's answers as the session keeps them
// (mergeRound: each answer once, however often an event is sent, a resumed slot going on from where it was).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addRound, IDENTIFY_FILL, IDENTIFY_MIN, identifyExhausted, identifyOwed, identifyRoundPlan, mergeRound, ROUND_MAX_ANSWERS, ROUND_SIZE, roundTotals, type RoundRecord, type RoundTallies } from '../../shared/activity.ts';
import { pickObjects } from '../../server/learning/identify.ts';

/** The tallies after `n` Identify questions answered in a session's practice (some right, some not). */
const answered = (n: number, tallies: RoundTallies = {}): RoundTallies => addRound(tallies, 'identify', Array.from({ length: n }, (_, i) => (i % 2 ? 'incorrect' : 'correct')));

test('a session owes five Identify questions, less those answered in its practice; other skills do not count', () => {
  assert.equal(IDENTIFY_MIN, 5);
  assert.equal(identifyOwed({}), 5);
  assert.equal(identifyOwed(answered(3)), 2);
  assert.equal(identifyOwed(answered(2, answered(3))), 0, 'two slots together');
  assert.equal(identifyOwed(answered(7)), 0);
  // Wrong and revealed answers were shown too; sentence gaps and forms are not Identify.
  assert.equal(identifyOwed(addRound(addRound({}, 'cloze', ['correct', 'correct', 'correct']), 'identify', ['incorrect', 'revealed'])), 3);
  assert.equal(identifyOwed(addRound({}, 'forms', ['correct', 'correct', 'correct', 'correct', 'correct'])), 5);
  assert.equal(identifyOwed(addRound({}, 'identify', [])), 5, 'a round with no answers adds nothing');
});

test('an Identify slot asks for its planned size, at least what is owed, filled up from the words being learned, then all words', () => {
  assert.deepEqual(IDENTIFY_FILL, ['learning', 'all']);
  // The mix's first Identify slot: five pictures, filled up in that order when the session's own words name fewer.
  assert.deepEqual(identifyRoundPlan({}, false, 5), { size: 5, fill: ['learning', 'all'] });
  // A slot of three while five are still owed (the first came to nothing, offline say): it asks for the five.
  assert.deepEqual(identifyRoundPlan({}, false, 3), { size: 5, fill: ['learning', 'all'] });
  assert.deepEqual(identifyRoundPlan(answered(3), false, 3), { size: ROUND_SIZE, fill: ['learning', 'all'] });
  // A resumed slot with one question left, two owed: the two.
  assert.deepEqual(identifyRoundPlan(answered(3), false, 1), { size: 2, fill: ['learning', 'all'] });
  // The minimum met, or no more pictures to give: the planned size on the session's own words.
  assert.deepEqual(identifyRoundPlan(answered(5), false, 3), { size: 3, fill: [] });
  assert.deepEqual(identifyRoundPlan(answered(2), true, 3), { size: 3, fill: [] });
  assert.deepEqual(identifyRoundPlan(answered(5), false), { size: ROUND_SIZE, fill: [] });
});

test('a filled-up round that comes back short means the learner’s words have no more pictures; a usual one says nothing', () => {
  const first = identifyRoundPlan({}, false, 5);
  assert.equal(identifyExhausted(first, 5), false);
  assert.equal(identifyExhausted(first, 2), true);
  assert.equal(identifyExhausted({ size: 3, fill: [] }, 1), false, 'the session’s own words had one picture; others may have more');
});

const obj = (key: string, entry: number) => ({ key, scene: key.split(':')[0], entry });
const keys = (xs: Array<{ key: string }>) => xs.map((x) => x.key);

test('a filled-up batch takes the session’s words first, then the words being learned, then all the learner’s words', () => {
  const session = [obj('S1:1', 1), obj('S2:1', 2)];
  const learning = [obj('S3:1', 3), obj('S4:1', 4), obj('S5:1', 5)];
  const all = [obj('S6:1', 6), obj('S7:1', 7), obj('S8:1', 8)];
  assert.deepEqual(keys(pickObjects([session, learning, all], 5)), ['S1:1', 'S2:1', 'S3:1', 'S4:1', 'S5:1']);
  // One picture from the words being learned: all words fill the rest, in their order.
  assert.deepEqual(keys(pickObjects([session, learning.slice(0, 1), all], 5)), ['S1:1', 'S2:1', 'S3:1', 'S6:1', 'S7:1']);
  // The session's words name nothing: the fill-up tiers alone.
  assert.deepEqual(keys(pickObjects([[], [], all], 5)), ['S6:1', 'S7:1', 'S8:1']);
  // Without fill-up tiers, only the session's words (a usual round).
  assert.deepEqual(keys(pickObjects([session], 3)), ['S1:1', 'S2:1']);
});

test('each word once and each picture at most twice; relaxed when that leaves the batch short; one word has no limits', () => {
  // One word in three pictures, then three objects of one picture.
  const tiers = [
    [obj('S1:1', 1), obj('S2:1', 1), obj('S3:1', 1)],
    [obj('S9:1', 2), obj('S9:2', 3), obj('S9:3', 4)],
  ];
  assert.deepEqual(keys(pickObjects(tiers, 5)), ['S1:1', 'S9:1', 'S9:2']);
  // Relaxed (filling up for a session's minimum): the objects left over follow in tier order, each object once.
  assert.deepEqual(keys(pickObjects(tiers, 5, { relax: true })), ['S1:1', 'S9:1', 'S9:2', 'S2:1', 'S3:1']);
  assert.equal(pickObjects(tiers, 10, { relax: true }).length, 6, 'as many as there are');
  assert.equal(new Set(keys(pickObjects(tiers, 10, { relax: true }))).size, 6, 'no object twice');
  // Practicing one word: its pictures in turn.
  assert.deepEqual(keys(pickObjects([tiers[0]], 5, { single: true })), ['S1:1', 'S2:1', 'S3:1']);
});

// ------------------------------------------------------------------ the practice's answers kept with the session

test('a round’s events add each answer once: the first counts a round, later ones only their new answers, replays nothing', () => {
  let rec: RoundRecord = {};
  rec = mergeRound(rec, { roundId: 'r1', skill: 'cloze', grades: ['correct'] });
  assert.deepEqual(rec, { rounds: { cloze: { rounds: 1, answered: 1, correct: 1 } }, roundAnswers: { r1: 1 } });
  // The round's answers so far, sent after the next answer: one more answer, still one round.
  rec = mergeRound(rec, { roundId: 'r1', skill: 'cloze', grades: ['correct', 'incorrect'] });
  assert.deepEqual(rec.rounds, { cloze: { rounds: 1, answered: 2, correct: 1 } });
  // The same event again (the outbox resending it, or the device counting its queue on top of the server's copy), or an
  // older one arriving late: nothing changes, and the record itself comes back.
  assert.equal(mergeRound(rec, { roundId: 'r1', skill: 'cloze', grades: ['correct', 'incorrect'] }), rec);
  assert.equal(mergeRound(rec, { roundId: 'r1', skill: 'cloze', grades: ['correct'] }), rec);
  rec = mergeRound(rec, { roundId: 'r1', skill: 'cloze', grades: ['correct', 'incorrect', 'close'] });
  // Another round, of another skill; a sentence understood in full is right.
  rec = mergeRound(rec, { roundId: 'r2', skill: 'read', grades: ['understood', 'partly'] });
  assert.deepEqual(rec, {
    rounds: { cloze: { rounds: 1, answered: 3, correct: 1 }, read: { rounds: 1, answered: 2, correct: 1 } },
    roundAnswers: { r1: 3, r2: 2 },
  });
  assert.deepEqual(roundTotals(rec.rounds!), { answered: 5, correct: 2 });
  // Other fields of the plan meta stay as they are.
  const meta = mergeRound({ budgetSeconds: 600, adaptations: ['x'] } as RoundRecord & { budgetSeconds: number; adaptations: string[] }, { roundId: 'r3', skill: 'identify', grades: ['correct'] });
  assert.deepEqual([meta.budgetSeconds, meta.adaptations, meta.rounds], [600, ['x'], { identify: { rounds: 1, answered: 1, correct: 1 } }]);
});

test('merging the same events in any order, or twice, gives the same tallies; an event counts at most ten answers', () => {
  const events = [
    { roundId: 'a', skill: 'identify' as const, grades: ['correct'] },
    { roundId: 'a', skill: 'identify' as const, grades: ['correct', 'revealed'] },
    { roundId: 'b', skill: 'comprehension' as const, grades: ['correct', 'correct', 'incorrect'] },
  ];
  const forward = events.reduce<RoundRecord>(mergeRound, {});
  const twice = [...events, ...events].reduce<RoundRecord>(mergeRound, {});
  const backward = [...events].reverse().reduce<RoundRecord>(mergeRound, {});
  assert.deepEqual(twice, forward);
  assert.deepEqual(backward.rounds, forward.rounds, 'the longer event first: the shorter one adds nothing');
  assert.deepEqual(forward.rounds, { identify: { rounds: 1, answered: 2, correct: 1 }, comprehension: { rounds: 1, answered: 3, correct: 2 } });
  const many = mergeRound<RoundRecord>({}, { roundId: 'c', skill: 'forms', grades: Array.from({ length: 14 }, () => 'correct') });
  assert.deepEqual([many.rounds?.forms?.answered, many.roundAnswers?.c], [ROUND_MAX_ANSWERS, ROUND_MAX_ANSWERS]);
  // A round id is text from the device: names of built-in properties are ids like any other.
  for (const id of ['constructor', 'toString', '__proto__']) {
    const r = mergeRound<RoundRecord>({}, { roundId: id, skill: 'say', grades: ['correct'] });
    assert.deepEqual(r.rounds, { say: { rounds: 1, answered: 1, correct: 1 } }, id);
    assert.equal(Object.getPrototypeOf(r.roundAnswers), Object.prototype, id);
  }
  // addRound: further answers of a round already counted do not count another round.
  assert.deepEqual(addRound(addRound({}, 'cloze', ['correct']), 'cloze', ['incorrect'], true), { cloze: { rounds: 1, answered: 2, correct: 1 } });
});

test('a resumed slot goes on from the answers it had; an ended slot is kept as over, with or without answers', () => {
  let rec: RoundRecord = mergeRound({}, { roundId: 'p3', skill: 'identify', grades: ['correct', 'incorrect'] });
  // A reload in the middle: the device knows two were counted and sends only the answers given since, from 2.
  rec = mergeRound(rec, { roundId: 'p3', skill: 'identify', grades: ['correct'], from: 2 });
  assert.deepEqual([rec.rounds?.identify, rec.roundAnswers?.p3], [{ rounds: 1, answered: 3, correct: 2 }, 3]);
  // The same event again, and an older one, add nothing.
  assert.equal(mergeRound(rec, { roundId: 'p3', skill: 'identify', grades: ['correct'], from: 2 }), rec);
  assert.equal(mergeRound(rec, { roundId: 'p3', skill: 'identify', grades: ['correct', 'incorrect'] }), rec);
  // Over: kept as such once; an end event with nothing new changes nothing more.
  rec = mergeRound(rec, { roundId: 'p3', skill: 'identify', grades: ['correct'], from: 2, end: true });
  assert.deepEqual(rec.roundsEnded, { p3: true });
  assert.equal(mergeRound(rec, { roundId: 'p3', skill: 'identify', grades: [], from: 3, end: true }), rec);
  // A slot with nothing to ask: over with no answers, not a round in the tallies.
  rec = mergeRound(rec, { roundId: 'p4', skill: 'forms', grades: [], end: true });
  assert.deepEqual([rec.roundsEnded, rec.rounds?.forms, rec.roundAnswers?.p4], [{ p3: true, p4: true }, undefined, undefined]);
  // A gap (an event that never arrived) is closed up: the answers sent are counted after those the record has.
  const gap = mergeRound(mergeRound<RoundRecord>({}, { roundId: 'q', skill: 'say', grades: ['correct'] }), { roundId: 'q', skill: 'say', grades: ['close'], from: 2 });
  assert.deepEqual([gap.rounds?.say, gap.roundAnswers?.q], [{ rounds: 1, answered: 2, correct: 1 }, 2]);
  // At most ten answers a round, counted from where the event starts.
  const capped = mergeRound(mergeRound<RoundRecord>({}, { roundId: 'r', skill: 'cloze', grades: Array(6).fill('correct') }), { roundId: 'r', skill: 'cloze', grades: Array(8).fill('correct'), from: 6 });
  assert.equal(capped.roundAnswers?.r, ROUND_MAX_ANSWERS);
});
