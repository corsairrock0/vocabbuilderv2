// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// The mix of a Comprehensive session (shared/mix.ts): the practice planned with the session (every kind, a few at a
// time, spread between the exercises, the text in the second half), where each slot stands, the questions left for the
// counter, the slot due next, the types coming up, and the counts per type the start screen and Home show.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeRound, skillOf, type RoundRecord } from '../../shared/activity.ts';
import { comingUp, exerciseType, mixCounts, planFromHere, planPractice, practiceLeft, QUESTION_TYPES, roundType, slotDue, slotState, type PracticeSlot } from '../../shared/mix.ts';
import type { LanguageCode } from '../../shared/languages.ts';

const sizes = (slots: PracticeSlot[]) => slots.reduce((n, s) => n + s.size, 0);
const of = (slots: PracticeSlot[], kind: string) => slots.filter((s) => s.kind === kind || (kind === 'cloze' && s.kind === 'cloze-typed')).reduce((n, s) => n + s.size, 0);

test('twenty minutes of Polish: six grammar, six sentences, five pictures, three to say and one text, as in the plan shown', () => {
  const slots = planPractice({ language: 'pl', minutes: 20, exercises: 47 });
  assert.deepEqual(
    slots.map((s) => [s.id, s.kind, s.size]),
    [
      ['p1', 'forms', 3],
      ['p2', 'cloze', 3],
      ['p3', 'identify', 5],
      ['p4', 'say', 3],
      ['p5', 'comprehension', 3],
      ['p6', 'forms', 3],
      ['p7', 'cloze-typed', 3],
    ],
  );
  assert.equal(sizes(slots), 23, 'with 47 exercises, about 70 questions');
  // Spread evenly between the exercises, in order; the text in the second half.
  assert.deepEqual(slots.map((s) => s.after), [6, 12, 18, 24, 29, 35, 41]);
  assert.ok(slots.find((s) => s.kind === 'comprehension')!.after > 47 / 2);
});

test('the plan follows the length and the language: no grammar without tables, no text under ten minutes, more pictures when long', () => {
  const vi = planPractice({ language: 'vi', minutes: 20, exercises: 40 });
  assert.equal(of(vi, 'forms'), 0);
  assert.equal(of(vi, 'cloze'), 9, 'Vietnamese has no tables: more sentences instead');
  const count = (language: LanguageCode, minutes: number) => {
    const p = planPractice({ language, minutes, exercises: 30 });
    return { forms: of(p, 'forms'), cloze: of(p, 'cloze'), identify: of(p, 'identify'), say: of(p, 'say'), text: of(p, 'comprehension') };
  };
  assert.deepEqual(count('es', 10), { forms: 3, cloze: 3, identify: 5, say: 2, text: 3 });
  assert.deepEqual(count('es', 30), { forms: 9, cloze: 9, identify: 8, say: 5, text: 3 });
  assert.deepEqual(count('ru', 5), { forms: 3, cloze: 3, identify: 5, say: 2, text: 0 });
  // Every plan asks the Identify minimum in its first pictures slot, and no slot asks more than five.
  for (const m of [3, 10, 15, 20, 30, 45, 60, 180]) {
    const p = planPractice({ language: 'uk', minutes: m, exercises: 20 });
    assert.equal(p.find((s) => s.kind === 'identify')!.size, 5, `${m} min`);
    assert.ok(p.every((s) => s.size >= 1 && s.size <= 5), `${m} min`);
    // No kind twice in a row while another kind is still to come.
    for (let i = 1; i < p.length; i++) {
      const later = new Set(p.slice(i).map((s) => roundType(s.kind)));
      if (roundType(p[i].kind) === roundType(p[i - 1].kind)) assert.equal(later.size, 1, `${m} min: ${p.map((s) => s.kind).join(', ')}`);
    }
    assert.deepEqual(p.map((s) => s.id), p.map((_, i) => `p${i + 1}`));
  }
});

test('a slot is over when answered in full or ended; the counter counts what each slot has left, the one on screen as loaded', () => {
  const slots = planPractice({ language: 'pl', minutes: 20, exercises: 47 });
  let rec: RoundRecord = {};
  assert.equal(practiceLeft(slots, rec), 23);
  rec = mergeRound(rec, { roundId: 'p1', skill: 'forms', grades: ['correct', 'incorrect'] });
  assert.deepEqual(slotState(slots[0], rec), { answers: 2, ended: false });
  assert.equal(practiceLeft(slots, rec), 21);
  rec = mergeRound(rec, { roundId: 'p1', skill: 'forms', grades: ['correct', 'incorrect', 'correct'] });
  assert.deepEqual(slotState(slots[0], rec), { answers: 3, ended: true });
  // Pictures came back with three of five: once those are answered and the slot ends, two fewer to go.
  rec = mergeRound(rec, { roundId: 'p3', skill: 'identify', grades: ['correct'] });
  assert.equal(practiceLeft(slots, rec, { id: 'p3', questions: 3 }), 2 + 3 + 3 + 3 + 3 + 3);
  rec = mergeRound(rec, { roundId: 'p3', skill: 'identify', grades: ['correct', 'correct', 'revealed'], end: true });
  assert.equal(practiceLeft(slots, rec), 3 + 3 + 3 + 3 + 3);
  // A longer passage asks four: the slot on screen counts them.
  assert.equal(practiceLeft(slots, rec, { id: 'p5', questions: 4 }), 3 + 3 + 4 + 3 + 3);
  // Nothing to ask (or offline): over with no answers.
  rec = mergeRound(rec, { roundId: 'p4', skill: 'say', grades: [], end: true });
  assert.equal(practiceLeft(slots, rec), 3 + 3 + 3 + 3);
});

test('the slot due: the first open one once its exercises are done, and at the end every one left, in order', () => {
  const slots = planPractice({ language: 'pl', minutes: 20, exercises: 47 });
  let rec: RoundRecord = {};
  assert.equal(slotDue(slots, rec, 5, false), null);
  assert.equal(slotDue(slots, rec, 6, false)?.id, 'p1');
  rec = mergeRound(rec, { roundId: 'p1', skill: 'forms', grades: ['correct'], end: true });
  assert.equal(slotDue(slots, rec, 6, false), null, 'ended early: over');
  assert.equal(slotDue(slots, rec, 30, false)?.id, 'p2', 'skipped exercises brought several due: one after another');
  assert.equal(slotDue(slots, rec, 9, true)?.id, 'p2', 'no exercise left: the rest come now');
  for (const s of slots) rec = mergeRound(rec, { roundId: s.id, skill: skillOf(s.kind), grades: [], end: true });
  assert.equal(slotDue(slots, rec, 47, true), null);
});

test('coming up: the next types after the question on screen, a run shown once, slots placed after their exercises', () => {
  const slots = [
    { after: 3, type: 'grammar' as const },
    { after: 5, type: 'pictures' as const },
  ];
  // Three done; the review on screen is the first pending one: grammar comes after it, then a review, new words…
  assert.deepEqual(comingUp(['review', 'review', 'new', 'new', 'listening'], slots, 2, true), ['grammar', 'review', 'new']);
  assert.deepEqual(comingUp(['review', 'review', 'new', 'new', 'listening'], slots, 2, true, 6), ['grammar', 'review', 'new', 'pictures', 'new', 'listening']);
  // A slot on screen (or an exercise already answered): nothing to leave out, and slots due now come first.
  assert.deepEqual(comingUp(['new'], slots, 3, false), ['grammar', 'new', 'pictures']);
  // The end: the slots left.
  assert.deepEqual(comingUp([], slots, 40, false), ['grammar', 'pictures']);
});

test('types: by ear is listening, else a new word’s or a review; practice by what it asks; counts per type in order', () => {
  assert.equal(exerciseType('listen_choice', true), 'listening');
  assert.equal(exerciseType('dictation', false), 'listening');
  assert.equal(exerciseType('intro', true), 'new');
  assert.equal(exerciseType('cloze_typed', false), 'review');
  assert.deepEqual(
    (['forms', 'cloze', 'cloze-typed', 'identify', 'say', 'read', 'comprehension'] as const).map(roundType),
    ['grammar', 'sentences', 'sentences', 'pictures', 'speaking', 'reading', 'reading'],
  );
  const slots = planPractice({ language: 'pl', minutes: 20, exercises: 6 });
  const counts = mixCounts(
    [
      { kind: 'meaning_choice', isNew: false },
      { kind: 'recall_typed', isNew: false },
      { kind: 'intro', isNew: true },
      { kind: 'word_choice', isNew: true },
      { kind: 'listen_meaning', isNew: true },
      { kind: 'listen_choice', isNew: false },
    ],
    slots,
  );
  assert.deepEqual(counts, [
    { type: 'review', count: 2 },
    { type: 'new', count: 2 },
    { type: 'listening', count: 2 },
    { type: 'grammar', count: 6 },
    { type: 'sentences', count: 6 },
    { type: 'pictures', count: 5 },
    { type: 'speaking', count: 3 },
    { type: 'reading', count: 3 },
  ]);
  assert.deepEqual(counts.map((c) => c.type), QUESTION_TYPES.filter((t) => counts.some((c) => c.type === t)));
});

test('played through with every slot full, the counter’s total stays the same from the first question to the last', () => {
  for (const [language, minutes, exercises] of [['pl', 20, 47], ['vi', 10, 23], ['es', 30, 70], ['uk', 5, 4], ['ru', 20, 1]] as Array<[LanguageCode, number, number]>) {
    const slots = planPractice({ language, minutes, exercises });
    let rec: RoundRecord = {};
    let done = 0;
    let pending = exercises;
    let answers = 0;
    const totals = new Set<number>();
    const total = (current: { id: string; questions: number } | null = null) => totals.add(done + answers + pending + practiceLeft(slots, rec, current));
    const runDue = () => {
      for (let slot = slotDue(slots, rec, done, pending === 0); slot; slot = slotDue(slots, rec, done, pending === 0)) {
        const grades: string[] = [];
        for (let q = 0; q < slot.size; q++) {
          total({ id: slot.id, questions: slot.size });
          grades.push('correct');
          rec = mergeRound(rec, { roundId: slot.id, skill: skillOf(slot.kind), grades });
          answers++;
        }
        rec = mergeRound(rec, { roundId: slot.id, skill: skillOf(slot.kind), grades, end: true });
        total();
      }
    };
    total();
    while (pending > 0) {
      pending--;
      done++;
      total();
      runDue();
    }
    runDue();
    assert.deepEqual([...totals], [exercises + sizes(slots)], `${language}, ${minutes} min, ${exercises} exercises`);
  }
});

test('a session planned before the mix, resumed: its practice from where it is, spread over the exercises left', () => {
  // Thirty of 47 exercises done in a 20-minute session: what seven minutes plan, between exercise 30 and the end.
  const slots = planFromHere({ language: 'pl', minutes: 20, done: 30, left: 17 });
  assert.deepEqual(slots.map((s) => [s.kind, s.size]), planPractice({ language: 'pl', minutes: 7, exercises: 17 }).map((s) => [s.kind, s.size]));
  assert.ok(slots.every((s) => s.after > 30 && s.after <= 47), JSON.stringify(slots.map((s) => s.after)));
  assert.equal(slotDue(slots, {}, 30, false), null, 'nothing due at once');
  assert.equal(new Set(slots.map((s) => s.after)).size, slots.length, 'one at a time');
  // Not begun: the plan a session gets today; nothing left: none.
  assert.deepEqual(planFromHere({ language: 'es', minutes: 20, done: 0, left: 47 }), planPractice({ language: 'es', minutes: 20, exercises: 47 }));
  assert.deepEqual(planFromHere({ language: 'es', minutes: 20, done: 47, left: 0 }), []);
});
