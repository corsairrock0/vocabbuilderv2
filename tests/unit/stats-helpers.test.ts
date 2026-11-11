// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Pure helpers behind the statistics and study time (shared/stats.ts, shared/activity.ts): windows, streaks, what a
// day of study is, the weakest cases or tenses, the active-time clock, splitting long stretches, and round tallies.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dayAnswers,
  emptyDay,
  formsGroup,
  groupTallies,
  isStudyDay,
  listJoin,
  statsWindow,
  streak,
  tally,
  weakestGroups,
  windowFirstDay,
  windowPhrase,
} from '../../shared/stats.ts';
import { ActiveClock, addRound, isRoundRight, MAX_ANSWER_ACTIVE_MS, roundTotals, splitActiveMs } from '../../shared/activity.ts';
import { DEFAULT_STUDY_MODE, STUDY_MODES } from '../../shared/settings.ts';

test('Comprehensive is the default study mode, and the other modes stay available', () => {
  assert.equal(DEFAULT_STUDY_MODE, 'comprehensive');
  assert.deepEqual([...STUDY_MODES].sort(), ['comprehensive', 'mixed', 'new', 'review']);
});

test('a window is 7 days, 30 days or all time; today is one of its days', () => {
  assert.equal(statsWindow('7'), '7');
  assert.equal(statsWindow('all'), 'all');
  assert.equal(statsWindow(null), '30');
  assert.equal(statsWindow('365'), '30', 'anything else is the default');
  assert.equal(windowFirstDay('7', '2026-11-08'), '2026-11-02');
  assert.equal(windowFirstDay('30', '2026-03-01'), '2026-01-31');
  assert.equal(windowFirstDay('all', '2026-11-08'), null);
  assert.equal(windowPhrase('7'), 'in the last 7 days');
  assert.equal(windowPhrase('all'), 'so far');
});

test('a day counts as study with time, a new word, an answer of any kind or a text; answers add up once each', () => {
  assert.equal(isStudyDay(emptyDay('2026-11-08')), false);
  assert.equal(isStudyDay({ ...emptyDay('d'), practice: 3 }), true, 'only practice rounds');
  assert.equal(isStudyDay({ ...emptyDay('d'), texts: 1, questions: 3 }), true, 'only a text read');
  assert.equal(isStudyDay({ ...emptyDay('d'), studyMs: 20_000 }), true);
  assert.equal(isStudyDay({ ...emptyDay('d'), introduced: 1 }), true);
  // Reviews are session answers already: they are not added again.
  assert.equal(dayAnswers({ ...emptyDay('d'), sessionAnswers: 30, reviews: 12, practice: 9, texts: 1, questions: 3 }), 42);
});

test('the streak runs back from today, or from yesterday when today has nothing yet, and stops at a gap', () => {
  const days = new Set(['2026-11-08', '2026-11-07', '2026-11-06', '2026-11-04']);
  assert.equal(streak(days, '2026-11-08'), 3);
  assert.equal(streak(days, '2026-11-09'), 3, 'nothing yet today');
  assert.equal(streak(days, '2026-11-10'), 0);
  assert.equal(streak(new Set(['2026-03-01', '2026-02-28']), '2026-03-01'), 2, 'across a month end');
});

test('tally: accuracy is the share right, null when there is nothing to count', () => {
  assert.deepEqual(tally(4, 3), { answers: 4, correct: 3, accuracy: 0.75 });
  assert.deepEqual(tally(0, 0), { answers: 0, correct: 0, accuracy: null });
  assert.deepEqual(tally(undefined, null), { answers: 0, correct: 0, accuracy: null });
});

test('a forms cell is grouped by its case or its tense', () => {
  assert.deepEqual(formsGroup('ru', 'gen|pl'), { key: 'gen', label: 'genitive' });
  assert.deepEqual(formsGroup('ru', 'acc.anim|m'), { key: 'acc', label: 'accusative' }, 'animate and inanimate are one case');
  assert.deepEqual(formsGroup('ru', 'loc|sg'), { key: 'loc', label: 'prepositional' }, 'Russian names the locative so');
  assert.deepEqual(formsGroup('uk', 'loc|sg'), { key: 'loc', label: 'locative' });
  assert.deepEqual(formsGroup('pl', 'comp|-'), { key: 'comp', label: 'comparative' });
  assert.deepEqual(formsGroup('es', 'ind.pret|1s'), { key: 'ind.pret', label: 'preterite' });
  assert.deepEqual(formsGroup('pt', 'sbjv.fut|3p'), { key: 'sbjv.fut', label: 'future subjunctive' });
  assert.deepEqual(formsGroup('es', 'nfin|ger'), { key: 'nfin|ger', label: 'gerund' });
  assert.deepEqual(formsGroup('es', 'part|f.pl'), { key: 'part', label: 'past participle' });
  assert.equal(formsGroup('vi', 'x|y'), null, 'no tables in Vietnamese');
  assert.equal(formsGroup('ru', null), null);
});

test('the weakest cases need enough answers and a miss; lowest accuracy first, more answers first among equals', () => {
  const groups = groupTallies('ru', [
    { cell: 'gen|sg', answers: 3, correct: 1 },
    { cell: 'gen|pl', answers: 3, correct: 0 }, // genitive: 6 answers, 1 right
    { cell: 'ins|sg', answers: 5, correct: 3 }, // instrumental: 60%
    { cell: 'dat|pl', answers: 10, correct: 6 }, // dative: 60%, more answers
    { cell: 'acc.anim|sg', answers: 2, correct: 0 },
    { cell: 'acc.inan|sg', answers: 2, correct: 0 }, // accusative: 4 answers, too few
    { cell: 'nom|sg', answers: 8, correct: 8 }, // no miss
    { cell: null, answers: 4, correct: 0 }, // no cell: not grouped
  ]);
  const gen = groups.find((g) => g.key === 'gen')!;
  assert.deepEqual([gen.answers, gen.correct], [6, 1]);
  const weakest = weakestGroups(groups);
  assert.deepEqual(
    weakest.map((g) => [g.label, g.answers, Math.round(g.accuracy! * 100)]),
    [
      ['genitive', 6, 17],
      ['dative', 10, 60],
      ['instrumental', 5, 60],
    ],
  );
  assert.equal(weakestGroups(groups, { limit: 1 }).length, 1);
  assert.deepEqual(
    weakestGroups(groups, { min: 4 }).map((g) => g.key),
    ['acc', 'gen', 'dat'],
    'with a lower minimum the accusative counts',
  );
});

test('listJoin writes lists as the app does', () => {
  assert.equal(listJoin(['a']), 'a');
  assert.equal(listJoin(['a', 'b']), 'a and b');
  assert.equal(listJoin(['reviewed 3 words', 'met 1 new word', 'read 1 text']), 'reviewed 3 words, met 1 new word and read 1 text');
  assert.equal(listJoin([]), '');
});

test('the active clock counts up to 90 seconds after each input, only while the page is visible', () => {
  let t = 1_000_000;
  const clock = new ActiveClock(() => t, true);
  t += 30_000;
  assert.equal(clock.peek(), 30_000, 'starting counts as activity');
  t += 200_000; // idle: only 60 s more count (90 s after the start)
  assert.equal(clock.take(), 90_000);
  assert.equal(clock.take(), 0, 'taken time starts again');
  clock.input(); // back after the long pause
  t += 10_000;
  clock.input();
  t += 5_000;
  assert.equal(clock.take(), 15_000);
  clock.setVisible(false);
  t += 60_000; // hidden: nothing counts
  clock.setVisible(true);
  clock.input();
  t += 20_000;
  assert.equal(clock.take(), 20_000);
  t -= 5_000; // a clock that goes back adds nothing
  assert.equal(clock.take(), 0);
});

test('long active stretches are split into parts the server accepts', () => {
  assert.deepEqual(splitActiveMs(0), []);
  assert.deepEqual(splitActiveMs(-5), []);
  assert.deepEqual(splitActiveMs(1234.6), [1235]);
  assert.deepEqual(splitActiveMs(7 * 60_000), [MAX_ANSWER_ACTIVE_MS, 2 * 60_000]);
  assert.deepEqual(splitActiveMs(10 * 60_000), [MAX_ANSWER_ACTIVE_MS, MAX_ANSWER_ACTIVE_MS]);
  assert.deepEqual(splitActiveMs(90_000, 60_000), [60_000, 30_000]);
});

test('round tallies add up per skill; a sentence understood in full counts as right; an empty round adds nothing', () => {
  let t = addRound({}, 'forms', ['correct', 'close', 'incorrect']);
  t = addRound(t, 'forms', ['correct']);
  t = addRound(t, 'read', ['understood', 'partly']);
  t = addRound(t, 'comprehension', ['correct', 'correct', 'incorrect']);
  t = addRound(t, 'identify', []);
  assert.deepEqual(t.forms, { rounds: 2, answered: 4, correct: 2 });
  assert.deepEqual(t.read, { rounds: 1, answered: 2, correct: 1 });
  assert.deepEqual(t.comprehension, { rounds: 1, answered: 3, correct: 2 });
  assert.equal(t.identify, undefined);
  assert.deepEqual(roundTotals(t), { answered: 9, correct: 5 });
  assert.equal(isRoundRight('revealed'), false);
});
