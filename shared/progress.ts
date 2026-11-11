// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
/**
 * The Progress page and Home: the shapes of their figures and the pure helpers behind them (the words-known history,
 * milestones and pace, the trend of a skill against the period before, the study-time goal, the weekly bars), shared by
 * the server (server/services/progress.ts) and the web app.
 *
 * Words, in the app's own statuses (as on the Words page):
 *   known          learned (the recognition memory has at least two reviews and a stability of at least 3 days; well
 *                  known and mastered words are learned too) or marked as known by the learner;
 *   being learned  introduced but not yet learned ("Learning" on the Words page);
 *   not started    new: never introduced.
 * Suspended and deleted words are in none of the three.
 */
import type { ReadingLevel } from './comprehension.ts';
import type { LanguageCode } from './languages.ts';
import type { StatsWindow, Tally } from './stats.ts';
import { addDays, daysBetween } from './time.ts';

// ------------------------------------------------------------------ words known

/** Learned: at least this many reviews of the recognition memory (a new word's first rating is one)... */
export const LEARNED_MIN_REVIEWS = 2;
/** ...and a stability of at least this many days after the latest. */
export const LEARNED_MIN_STABILITY = 3;

/** How many days the words-known chart covers, today included. */
export const HISTORY_DAYS = 90;

/** One word's past, as far as the words-known history needs it. Days are local days (YYYY-MM-DD). */
export interface KnownItem {
  /** The recognition memory's reviews in order (one per day at most): the day and the stability after it. */
  reviews: Array<{ day: string; stability: number }>;
  /** Marked as known on this day: known from then on, whatever its reviews say. */
  knownFrom: string | null;
  /** From this day on it counts no more (suspended or deleted). */
  until: string | null;
}

/** The days a word was known, as [from, to) ranges of days; `to` null when it still is. */
export function knownRanges(item: KnownItem): Array<[string, string | null]> {
  const ranges: Array<[string, string | null]> = [];
  let from: string | null = null;
  item.reviews.forEach((r, i) => {
    // Learned at the end of a review's day exactly when the card would be learned now with that many reviews.
    const learned = i + 1 >= LEARNED_MIN_REVIEWS && r.stability >= LEARNED_MIN_STABILITY;
    if (learned && from == null) from = r.day;
    else if (!learned && from != null) {
      ranges.push([from, r.day]);
      from = null;
    }
  });
  if (from != null) ranges.push([from, null]);
  const cut = (xs: Array<[string, string | null]>, day: string) =>
    xs.filter(([a]) => a < day).map(([a, b]): [string, string | null] => [a, b == null || b > day ? day : b]);
  let out = ranges;
  if (item.knownFrom) out = [...cut(out, item.knownFrom), [item.knownFrom, null]];
  if (item.until) out = cut(out, item.until);
  return out;
}

/** Words known at the end of each day from `firstDay` to `lastDay` (both included). */
export function knownHistory(items: KnownItem[], firstDay: string, lastDay: string): number[] {
  const n = daysBetween(firstDay, lastDay) + 1;
  if (n <= 0) return [];
  const diff = new Array<number>(n + 1).fill(0);
  for (const item of items) {
    for (const [from, to] of knownRanges(item)) {
      const a = Math.max(0, daysBetween(firstDay, from));
      const b = to == null ? n : Math.min(n, daysBetween(firstDay, to));
      if (a < b) {
        diff[a]++;
        diff[b]--;
      }
    }
  }
  const out: number[] = [];
  let run = 0;
  for (let i = 0; i < n; i++) out.push((run += diff[i]));
  return out;
}

/** Words-known milestones, in order. */
export const MILESTONES = [100, 250, 500, 1000, 2000, 3000, 4000, 5000] as const;

/**
 * The next milestone above `known` and, at `pacePerDay` words a day (the last 30 days), about how many weeks it is away
 * (at least one); weeks is null without a pace. Null past the last milestone.
 */
export function nextMilestone(known: number, pacePerDay: number | null): { target: number; weeks: number | null } | null {
  const target = MILESTONES.find((m) => m > known);
  if (target == null) return null;
  const weeks = pacePerDay != null && pacePerDay > 0 ? Math.max(1, Math.round((target - known) / pacePerDay / 7)) : null;
  return { target, weeks };
}

/** Words learned a day over the last 30 days of a history (net of words forgotten); null when it did not grow. */
export function pacePerDay(history: number[], days = 30): number | null {
  if (history.length <= days) return null;
  const pace = (history[history.length - 1] - history[history.length - 1 - days]) / days;
  return pace > 0 ? pace : null;
}

// ------------------------------------------------------------------ skills

/** The skill cards, in the order the page shows them. */
export const PROGRESS_SKILLS = ['words', 'listening', 'grammar', 'sentences', 'pictures', 'speaking', 'reading', 'writing'] as const;
export type ProgressSkillKey = (typeof PROGRESS_SKILLS)[number];

export const SKILL_NAMES: Record<ProgressSkillKey, string> = {
  words: 'Words',
  listening: 'Listening',
  grammar: 'Grammar',
  sentences: 'Sentences',
  pictures: 'Pictures',
  speaking: 'Speaking',
  reading: 'Reading',
  writing: 'Writing',
};

/** The fewest answers in each of two periods before their accuracies are compared. */
export const TREND_MIN_ANSWERS = 10;
/** The fewest answers in the period before a skill can be named the weakest. */
export const WEAKEST_SKILL_MIN_ANSWERS = 20;

/**
 * The change in percentage points from the period before (rounded), or null: all time has no period before, and a
 * period with fewer than TREND_MIN_ANSWERS answers says too little.
 */
export function trendPoints(current: Tally, previous: Tally | null): number | null {
  if (!previous || current.answers < TREND_MIN_ANSWERS || previous.answers < TREND_MIN_ANSWERS) return null;
  if (current.accuracy == null || previous.accuracy == null) return null;
  return Math.round((current.accuracy - previous.accuracy) * 100);
}

/** "up 3 points", "down 2 points", "about the same" (within one point either way). */
export function trendText(points: number): string {
  if (Math.abs(points) <= 1) return 'about the same';
  return points > 0 ? `up ${points} points` : `down ${-points} points`;
}

/** The skill answered worst in the period, among those with enough answers; null unless at least two can be compared. */
export function weakestSkill(skills: Array<{ key: ProgressSkillKey; answers: number; accuracy: number | null }>, min = WEAKEST_SKILL_MIN_ANSWERS): ProgressSkillKey | null {
  const rated = skills.filter((s) => s.answers >= min && s.accuracy != null);
  if (rated.length < 2) return null;
  return [...rated].sort((a, b) => a.accuracy! - b.accuracy! || b.answers - a.answers)[0].key;
}

/** A skill card: answers and the share right in the period, the period before, and the trend between them. */
export interface ProgressSkill extends Tally {
  key: ProgressSkillKey;
  /** The period before, of the same length; null for all time. */
  previous: Tally | null;
  /** Percentage points against the period before (trendPoints). */
  trend: number | null;
  /** Reading: the level, and how many of its texts have been read (both kinds; all of them move it up). */
  reading?: { level: ReadingLevel; levelTexts: number; levelRead: number };
}

// ------------------------------------------------------------------ study time

/** A day's minutes as the charts show them (rounded), and whether they meet the goal. */
export function minutesOf(ms: number): number {
  return Math.round(ms / 60_000);
}

/**
 * Days the goal was met, of the days counted: every day of `days` but today, and today too once its goal is met (a day
 * still going on has not missed it yet).
 */
export function goalDays(days: Array<{ day: string; minutes: number }>, goal: number, today: string): { met: number; of: number } {
  const met = days.filter((d) => d.minutes >= goal).length;
  const todayOpen = days.some((d) => d.day === today && d.minutes < goal);
  return { met, of: days.length - (todayOpen ? 1 : 0) };
}

/**
 * The first day a period counts for study time and the goal: its own first day, or the day the language was first
 * studied when that is later, since the days before it are not days missed. A language never studied counts from today
 * (`periodFirst` null: all time, which always starts at the first day studied).
 */
export function countedFrom(periodFirst: string | null, firstStudied: string | null, today: string): string {
  const begun = firstStudied == null || firstStudied > today ? today : firstStudied;
  return periodFirst != null && periodFirst > begun ? periodFirst : begun;
}

/** The Monday of a day's week (weeks run Monday to Sunday). */
export function weekStart(day: string): string {
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay(); // 0 Sunday … 6 Saturday
  return addDays(day, -((dow + 6) % 7));
}

/** A day of Home's week: counted towards the goal, before the language was first studied, or still to come. */
export interface WeekDay {
  day: string;
  state: 'counted' | 'before' | 'future';
  /** The day's minutes (rounded); null for a day not counted. */
  minutes: number | null;
}

/**
 * Home's week, Monday to Sunday: each day's minutes from the bootstrap's last 14 days, the minutes so far, and the days
 * the goal was met (goalDays) counted from the day the language was first studied when that falls in this week.
 * `firstStudied` undefined (a bootstrap from before it was sent) counts the whole week, as before.
 */
export function weekProgress(
  activity: Array<{ day: string; minutes: number }>,
  goal: number,
  today: string,
  firstStudied: string | null | undefined,
): { days: WeekDay[]; from: string; startedThisWeek: boolean; totalMinutes: number; goal: { met: number; of: number } } {
  const minutes = new Map(activity.map((d) => [d.day, d.minutes]));
  const monday = weekStart(today);
  const from = firstStudied === undefined ? monday : countedFrom(monday, firstStudied, today);
  const days = Array.from({ length: 7 }, (_, i): WeekDay => {
    const day = addDays(monday, i);
    const state = day > today ? 'future' : day < from ? 'before' : 'counted';
    return { day, state, minutes: state === 'counted' ? (minutes.get(day) ?? 0) : null };
  });
  const counted = days.filter((d) => d.state === 'counted').map((d) => ({ day: d.day, minutes: d.minutes ?? 0 }));
  return { days, from, startedThisWeek: from > monday, totalMinutes: counted.reduce((s, d) => s + d.minutes, 0), goal: goalDays(counted, goal, today) };
}

/**
 * Minutes a day, averaged per week, from `firstDay` to `lastDay`: one bar per week (keyed by its Monday), each the
 * week's minutes over its days in that range (the first and the current week can be shorter).
 */
export function weeklyBars(days: Array<{ day: string; minutes: number }>, firstDay: string, lastDay: string): Array<{ day: string; minutes: number }> {
  const byDay = new Map(days.map((d) => [d.day, d.minutes]));
  const out: Array<{ day: string; minutes: number }> = [];
  for (let monday = weekStart(firstDay); monday <= lastDay; monday = addDays(monday, 7)) {
    let sum = 0;
    let n = 0;
    for (let i = 0; i < 7; i++) {
      const d = addDays(monday, i);
      if (d < firstDay || d > lastDay) continue;
      sum += byDay.get(d) ?? 0;
      n++;
    }
    out.push({ day: monday, minutes: n ? Math.round(sum / n) : 0 });
  }
  return out;
}

/** Minutes a day that keep up with `reviews` over `days` days at `secondsPerReview` each (rounded). */
export function minutesToKeepUp(reviews: number, secondsPerReview: number, days = 7): number {
  return Math.round((reviews * secondsPerReview) / days / 60);
}

// ------------------------------------------------------------------ API shapes

/** GET /api/stats/progress/:code — what does not depend on the period. */
export interface ProgressOverview {
  language: LanguageCode;
  words: {
    known: number;
    learning: number;
    notStarted: number;
    /** Words known at the end of each of the last HISTORY_DAYS days, the first of them `firstDay`, today last. */
    history: { firstDay: string; known: number[] };
    /** The (up to) 1,000 most frequent words of the set by frequency rank, and how many are known; null without ranks. */
    common: { size: number; known: number } | null;
    /** Words a day over the last 30 days (net), or null when the count did not grow. */
    pacePerDay: number | null;
    milestone: { target: number; weeks: number | null } | null;
  };
  /** Reviews due on each of the next 7 days (today with the overdue ones), each word once a day. */
  comingUp: {
    days: Array<{ day: string; due: number }>;
    total: number;
    /** The learner's own time per review (median answer time of recent reviews, plus feedback), or a default. */
    secondsPerReview: number;
    ownTiming: boolean;
    minutesPerDay: number;
  };
  /** The words missed most in the last 30 days, at most five. */
  needWork: Array<{ entryId: number; lemma: string; gloss: string; misses: number; answers: number }>;
}

/** GET /api/stats/progress/:code/period?window=7|30|all — the skills and study time of a period. */
export interface ProgressPeriod {
  language: LanguageCode;
  window: StatsWindow;
  /** The period's first local day, or null for all time. */
  firstDay: string | null;
  skills: ProgressSkill[];
  weakest: ProgressSkillKey | null;
  time: {
    goalMinutes: number;
    /** One bar per day (7 and 30 days) or per week (all time: minutes a day, averaged over the week), from `from`. */
    unit: 'day' | 'week';
    bars: Array<{ day: string; minutes: number }>;
    /** The first day counted (countedFrom): the period's first day, or the first day studied when that is later. */
    from: string;
    /** 7 or 30 days that start before the language was first studied: fewer days are counted than the period has. */
    shortened: boolean;
    /** The first day anything was studied in this language, or null when nothing has been yet. */
    begun: string | null;
    totalMs: number;
    /** The days counted, from `from` to today. */
    days: number;
    averageMinutes: number;
    goal: { met: number; of: number };
    streakDays: number;
  };
}
