// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// The Progress page's pure helpers (shared/progress.ts): the words-known history rebuilt from the review log, marked and
// suspended words, milestones and the pace to them, a skill's trend against the period before, the weakest skill, the
// daily goal's days, the weekly bars of all time, and the minutes a day that keep up with the coming reviews.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  countedFrom,
  goalDays,
  knownHistory,
  knownRanges,
  minutesOf,
  minutesToKeepUp,
  nextMilestone,
  pacePerDay,
  trendPoints,
  trendText,
  weakestSkill,
  weekProgress,
  weekStart,
  weeklyBars,
  type KnownItem,
} from '../../shared/progress.ts';
import { tally } from '../../shared/stats.ts';

const item = (reviews: Array<[string, number]>, extra: Partial<KnownItem> = {}): KnownItem => ({
  reviews: reviews.map(([day, stability]) => ({ day, stability })),
  knownFrom: null,
  until: null,
  ...extra,
});

test('a word is learned from the day of its second review with a stability of 3 days or more, and not after a lapse below that', () => {
  // The first rating (a new word's) never makes it learned, whatever its stability.
  assert.deepEqual(knownRanges(item([['2026-11-01', 8]])), []);
  assert.deepEqual(knownRanges(item([['2026-11-01', 2.3], ['2026-11-04', 9.5]])), [['2026-11-04', null]]);
  // Forgotten on the 10th (stability drops to 1.2), learned again on the 12th.
  assert.deepEqual(
    knownRanges(item([['2026-11-01', 2.3], ['2026-11-04', 9.5], ['2026-11-10', 1.2], ['2026-11-12', 4]])),
    [
      ['2026-11-04', '2026-11-10'],
      ['2026-11-12', null],
    ],
  );
  // A second review that stays under 3 days does not count; a third that reaches it does.
  assert.deepEqual(knownRanges(item([['2026-11-01', 0.4], ['2026-11-02', 1.8], ['2026-11-05', 3]])), [['2026-11-05', null]]);
});

test('marked known counts from its day whatever the reviews say; suspended and deleted words stop counting on their day', () => {
  assert.deepEqual(knownRanges(item([], { knownFrom: '2026-10-20' })), [['2026-10-20', null]]);
  // Learned first, then marked known: one unbroken stretch.
  assert.deepEqual(knownRanges(item([['2026-10-01', 2], ['2026-10-05', 8]], { knownFrom: '2026-10-20' })), [
    ['2026-10-05', '2026-10-20'],
    ['2026-10-20', null],
  ]);
  // Learned, then suspended on the 15th.
  assert.deepEqual(knownRanges(item([['2026-10-01', 2], ['2026-10-05', 8]], { until: '2026-10-15' })), [['2026-10-05', '2026-10-15']]);
  // Suspended before it was ever learned: nothing.
  assert.deepEqual(knownRanges(item([['2026-10-01', 2], ['2026-10-20', 8]], { until: '2026-10-15' })), []);
});

test('the history counts every word known at the end of each day, clipped to the window', () => {
  const items = [
    item([['2026-10-28', 2], ['2026-11-02', 9]]), // learned from Nov 2
    item([['2026-10-30', 3], ['2026-11-03', 10], ['2026-11-05', 1]]), // Nov 3 and 4 only
    item([], { knownFrom: '2026-09-01' }), // marked known before the window
    item([['2026-10-01', 2], ['2026-10-05', 8]], { until: '2026-11-04' }), // suspended (or deleted) on Nov 4
    item([['2026-11-06', 2]]), // only a first rating
  ];
  const h = knownHistory(items, '2026-11-01', '2026-11-06');
  assert.deepEqual(h, [2, 3, 4, 3, 2, 2]);
  assert.equal(knownHistory(items, '2026-11-06', '2026-11-05').length, 0, 'an empty window');
  assert.deepEqual(knownHistory([], '2026-11-01', '2026-11-03'), [0, 0, 0]);
});

test('the next milestone and how many weeks it is away at the last 30 days’ pace', () => {
  assert.deepEqual(nextMilestone(0, null), { target: 100, weeks: null });
  assert.deepEqual(nextMilestone(317, 6.5), { target: 500, weeks: 4 }, '183 words at 6.5 a day is 28 days');
  assert.deepEqual(nextMilestone(500, 2), { target: 1000, weeks: 36 }, 'a milestone reached counts as passed');
  assert.deepEqual(nextMilestone(95, 10), { target: 100, weeks: 1 }, 'at least a week');
  assert.deepEqual(nextMilestone(120, 0), { target: 250, weeks: null }, 'no pace, no estimate');
  assert.deepEqual(nextMilestone(4999, 1), { target: 5000, weeks: 1 });
  assert.equal(nextMilestone(5000, 3), null, 'past the last milestone');
  const history = Array.from({ length: 90 }, (_, i) => (i < 59 ? 100 : 100 + (i - 59) * 2));
  assert.equal(pacePerDay(history), 2, '60 words in the last 30 days');
  assert.equal(pacePerDay(Array(90).fill(40)), null, 'no growth');
  assert.equal(pacePerDay([...Array(60).fill(50), ...Array(30).fill(45)]), null, 'words forgotten: no pace');
  assert.equal(pacePerDay([1, 2, 3]), null, 'too short a history');
});

test('a trend compares the share right with the period before, in whole points, only with enough answers in both', () => {
  assert.equal(trendPoints(tally(100, 84), tally(100, 81)), 3);
  assert.equal(trendPoints(tally(40, 20), tally(50, 30)), -10);
  assert.equal(trendPoints(tally(9, 9), tally(50, 10)), null, 'too few answers now');
  assert.equal(trendPoints(tally(50, 10), tally(9, 9)), null, 'too few before');
  assert.equal(trendPoints(tally(50, 10), null), null, 'all time has no period before');
  assert.equal(trendText(3), 'up 3 points');
  assert.equal(trendText(-2), 'down 2 points');
  assert.equal(trendText(1), 'about the same');
  assert.equal(trendText(-1), 'about the same');
  assert.equal(trendText(0), 'about the same');
});

test('the weakest skill needs enough answers, and another skill to compare with', () => {
  const s = (key: any, answers: number, correct: number) => ({ key, ...tally(answers, correct) });
  assert.equal(weakestSkill([s('words', 200, 170), s('sentences', 40, 24), s('pictures', 10, 2)]), 'sentences', 'pictures has too few answers');
  assert.equal(weakestSkill([s('words', 200, 170), s('pictures', 10, 2)]), null, 'only one skill to rate');
  assert.equal(weakestSkill([s('words', 30, 15), s('listening', 60, 30)]), 'listening', 'more answers first among equals');
});

test('the goal counts every day but today, and today once it is met', () => {
  const week = [
    { day: '2026-11-02', minutes: 22 },
    { day: '2026-11-03', minutes: 25 },
    { day: '2026-11-04', minutes: 18 },
    { day: '2026-11-05', minutes: 31 },
    { day: '2026-11-06', minutes: 20 },
    { day: '2026-11-07', minutes: 24 },
    { day: '2026-11-08', minutes: 0 },
  ];
  assert.deepEqual(goalDays(week, 20, '2026-11-08'), { met: 5, of: 6 }, 'Sunday is still going on');
  assert.deepEqual(goalDays(week.map((d) => (d.day === '2026-11-08' ? { ...d, minutes: 20 } : d)), 20, '2026-11-08'), { met: 6, of: 7 });
  assert.deepEqual(goalDays(week, 20, '2026-11-09'), { met: 5, of: 7 }, 'a past week counts every day');
  assert.equal(minutesOf(89_999), 1);
  assert.equal(minutesOf(29_999), 0);
});

test('weeks run Monday to Sunday; all time has one bar per week, each the minutes a day of its days in the range', () => {
  assert.equal(weekStart('2026-11-09'), '2026-11-09', 'a Monday');
  assert.equal(weekStart('2026-11-08'), '2026-11-02', 'a Sunday');
  assert.equal(weekStart('2026-03-04'), '2026-03-02');
  const days = [
    { day: '2026-10-29', minutes: 14 }, // Thursday: the first day studied
    { day: '2026-10-31', minutes: 7 },
    { day: '2026-11-02', minutes: 70 },
    { day: '2026-11-09', minutes: 30 },
  ];
  assert.deepEqual(weeklyBars(days, '2026-10-29', '2026-11-10'), [
    { day: '2026-10-26', minutes: 5 }, // 21 minutes over Thursday to Sunday (4 days)
    { day: '2026-11-02', minutes: 10 }, // 70 over 7 days
    { day: '2026-11-09', minutes: 15 }, // 30 over Monday and Tuesday so far
  ]);
});

test('the minutes a day that keep up with the coming reviews', () => {
  assert.equal(minutesToKeepUp(68, 62), 10, '68 reviews of about a minute over 7 days');
  assert.equal(minutesToKeepUp(3, 15), 0);
  assert.equal(minutesToKeepUp(0, 15), 0);
});

test('a period counts from its first day, or from the first day studied when that is later; never studied counts from today', () => {
  assert.equal(countedFrom('2026-10-11', '2026-08-01', '2026-11-09'), '2026-10-11', 'studied long before: the whole period');
  assert.equal(countedFrom('2026-10-11', '2026-11-06', '2026-11-09'), '2026-11-06', 'begun three days ago');
  assert.equal(countedFrom('2026-11-03', '2026-11-09', '2026-11-09'), '2026-11-09', 'begun today');
  assert.equal(countedFrom('2026-10-11', null, '2026-11-09'), '2026-11-09', 'never studied');
  assert.equal(countedFrom(null, '2026-08-01', '2026-11-09'), '2026-08-01', 'all time starts at the first day studied');
  assert.equal(countedFrom('2026-10-11', '2026-11-12', '2026-11-09'), '2026-11-09', 'a first day after today (the timezone moved) is today');
});

test('Home’s week counts the goal from the day the language was first studied when that falls in the week', () => {
  // Saturday 2026-11-14; Polish begun on Thursday the 12th: 25 minutes, then 10 on Friday, 5 so far today.
  const activity = [
    { day: '2026-11-12', minutes: 25 },
    { day: '2026-11-13', minutes: 10 },
    { day: '2026-11-14', minutes: 5 },
  ];
  const w = weekProgress(activity, 20, '2026-11-14', '2026-11-12');
  assert.deepEqual(
    w.days.map((d) => [d.day, d.state, d.minutes]),
    [
      ['2026-11-09', 'before', null],
      ['2026-11-10', 'before', null],
      ['2026-11-11', 'before', null],
      ['2026-11-12', 'counted', 25],
      ['2026-11-13', 'counted', 10],
      ['2026-11-14', 'counted', 5],
      ['2026-11-15', 'future', null],
    ],
  );
  assert.deepEqual([w.from, w.startedThisWeek, w.totalMinutes, w.goal], ['2026-11-12', true, 40, { met: 1, of: 2 }], 'Thursday and Friday; today is still going on');
  // Begun on Thursday, seen on Thursday: nothing missed yet.
  assert.deepEqual(weekProgress([{ day: '2026-11-12', minutes: 5 }], 20, '2026-11-12', '2026-11-12').goal, { met: 0, of: 0 });
  // Studied before this week: every day from Monday counts.
  const before = weekProgress(activity, 20, '2026-11-14', '2026-10-01');
  assert.deepEqual([before.from, before.startedThisWeek, before.goal], ['2026-11-09', false, { met: 1, of: 5 }]);
  // Never studied: nothing before today is a missed day.
  assert.deepEqual([weekProgress([], 20, '2026-11-14', null).goal, weekProgress([], 20, '2026-11-14', null).from], [{ met: 0, of: 0 }, '2026-11-14']);
  // A bootstrap from before the first day was sent: the whole week counts, as before.
  assert.deepEqual(weekProgress(activity, 20, '2026-11-14', undefined).goal, { met: 1, of: 5 });
});
