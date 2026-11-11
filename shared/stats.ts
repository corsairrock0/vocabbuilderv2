// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
/**
 * Statistics shared by the server and the web app: what counts as a day of study, the windows of the Skills section,
 * the shapes of its figures, and the pure helpers behind them (streaks, accuracy, the weakest cases or tenses).
 *
 * Study on a day is made of three kinds of answers, each stored once in its own table, so adding them up never counts
 * anything twice:
 *   - answers in study sessions (exercise_attempts, totalled per day in daily_stats; reviews are some of these);
 *   - practice answers (practice_attempts: forms, sentence gaps, Identify, Read and Say it), from the Practice pages
 *     and from the practice rounds of Comprehensive sessions;
 *   - reading comprehension texts (comprehension_attempts, one row per text with its questions).
 * Study time is the active time measured on the device: a session sends its own (practice rounds included), and the
 * Practice pages send theirs with each answer (shared/activity.ts).
 */
import type { ComprehensionKind, ReadingLevel } from './comprehension.ts';
import type { LanguageCode } from './languages.ts';
import { caseLabel, CONJUGATION_LANGS, DECLENSION_LANGS, isSlavicVerbCell, tenses } from './paradigms.ts';
import { addDays } from './time.ts';

// ------------------------------------------------------------------ windows

export const STATS_WINDOWS = ['7', '30', 'all'] as const;
export type StatsWindow = (typeof STATS_WINDOWS)[number];
export const DEFAULT_STATS_WINDOW: StatsWindow = '30';

export function statsWindow(raw: unknown): StatsWindow {
  return STATS_WINDOWS.includes(raw as StatsWindow) ? (raw as StatsWindow) : DEFAULT_STATS_WINDOW;
}

/** The first local day a window covers (today is one of its days), or null for all time. */
export function windowFirstDay(window: StatsWindow, today: string): string | null {
  return window === 'all' ? null : addDays(today, -(Number(window) - 1));
}

/** "in the last 7 days", "in the last 30 days", "so far". */
export function windowPhrase(window: StatsWindow): string {
  return window === 'all' ? 'so far' : `in the last ${window} days`;
}

// ------------------------------------------------------------------ days of study

/** The practice modes stored in practice_attempts. */
export const PRACTICE_MODES = ['forms', 'cloze', 'identify', 'read', 'say'] as const;
export type PracticeAttemptMode = (typeof PRACTICE_MODES)[number];

/** What was done on one local day, in one language or in all of them. */
export interface DayActivity {
  day: string;
  studyMs: number;
  /** Answers in study sessions (new-word cards not counted); reviews are some of them. */
  sessionAnswers: number;
  sessionCorrect: number;
  reviews: number;
  introduced: number;
  /** Practice answers: forms, sentence gaps, Identify, Read and Say it (Practice pages and Comprehensive rounds). */
  practice: number;
  /** Reading comprehension texts read, and their questions. */
  texts: number;
  questions: number;
}

export function emptyDay(day: string): DayActivity {
  return { day, studyMs: 0, sessionAnswers: 0, sessionCorrect: 0, reviews: 0, introduced: 0, practice: 0, texts: 0, questions: 0 };
}

/** Every answer of the day: session answers, practice answers and reading questions (each counted once). */
export function dayAnswers(d: DayActivity): number {
  return d.sessionAnswers + d.practice + d.questions;
}

/** A day counts towards the streak when anything was studied: time, a new word, an answer or a text. */
export function isStudyDay(d: DayActivity): boolean {
  return d.studyMs > 0 || d.introduced > 0 || dayAnswers(d) > 0 || d.texts > 0;
}

/** Days in a row with study, ending today, or yesterday when nothing has been studied yet today. */
export function streak(days: Set<string>, today: string): number {
  let d = days.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (days.has(d)) {
    n++;
    d = addDays(d, -1);
  }
  return n;
}

// ------------------------------------------------------------------ figures

/** Answers and how many were right. `accuracy` is null when there was nothing to count. */
export interface Tally {
  answers: number;
  correct: number;
  accuracy: number | null;
}

export function tally(answers: number | null | undefined, correct: number | null | undefined): Tally {
  const n = answers ?? 0;
  const ok = correct ?? 0;
  return { answers: n, correct: ok, accuracy: n > 0 ? ok / n : null };
}

/** A case or a tense with its answers, for the weakest list of word forms. */
export interface GroupTally extends Tally {
  key: string;
  label: string;
}

/** The fewest answers a case or tense needs before it can be called weak. */
export const WEAKEST_MIN_ANSWERS = 5;

const NONFINITE_GROUPS: Record<string, string> = { 'nfin|inf': 'infinitive', 'nfin|ger': 'gerund' };
const NOMINAL_GROUPS: Record<string, string> = { short: 'short form', comp: 'comparative', sup: 'superlative' };
/** Russian, Ukrainian and Polish verb cells (1.8.4), grouped by tense. */
const SLAVIC_VERB_GROUPS: Record<string, string> = { pres: 'present tense', fut: 'future tense', past: 'past tense', cond: 'conditional', imp: 'imperative', nfin: 'participles', part: 'participles' };

/**
 * What a cell of a word's table is grouped under in the weakest list: its case in Polish, Russian and Ukrainian
 * ("acc.anim|sg" → accusative) or, for their verbs, its tense ("past|f" → past tense), its tense in Spanish and
 * Portuguese ("ind.pret|1s" → preterite). Null for a language without tables or an empty cell.
 */
export function formsGroup(language: LanguageCode, cell: string | null | undefined): { key: string; label: string } | null {
  if (!cell) return null;
  const [row] = cell.split('|');
  if (!row) return null;
  if (CONJUGATION_LANGS.includes(language)) {
    if (NONFINITE_GROUPS[cell]) return { key: cell, label: NONFINITE_GROUPS[cell] };
    if (row === 'part') return { key: 'part', label: 'past participle' };
    const t = tenses(language).find((x) => x.key === row);
    return { key: row, label: (t?.label ?? row).toLowerCase() };
  }
  if (DECLENSION_LANGS.includes(language)) {
    if (isSlavicVerbCell(language, cell)) return { key: `v.${row === 'part' ? 'nfin' : row}`, label: SLAVIC_VERB_GROUPS[row] ?? row };
    if (NOMINAL_GROUPS[row]) return { key: row, label: NOMINAL_GROUPS[row] };
    const base = row.split('.')[0];
    return { key: base, label: caseLabel(language, base) };
  }
  return null;
}

/** Answers per cell summed into their cases or tenses (cells of no group, or of a language without tables, are left out). */
export function groupTallies(language: LanguageCode, rows: Array<{ cell: string | null; answers: number; correct: number }>): GroupTally[] {
  const groups = new Map<string, { label: string; answers: number; correct: number }>();
  for (const r of rows) {
    const g = formsGroup(language, r.cell);
    if (!g) continue;
    const sum = groups.get(g.key) ?? groups.set(g.key, { label: g.label, answers: 0, correct: 0 }).get(g.key)!;
    sum.answers += r.answers;
    sum.correct += r.correct;
  }
  return [...groups.entries()].map(([key, g]) => ({ key, label: g.label, ...tally(g.answers, g.correct) }));
}

/**
 * The cases or tenses answered worst: only groups with at least `min` answers and at least one miss, lowest accuracy
 * first (more answers first among equals), at most `limit`.
 */
export function weakestGroups(groups: GroupTally[], opts: { min?: number; limit?: number } = {}): GroupTally[] {
  const min = opts.min ?? WEAKEST_MIN_ANSWERS;
  return groups
    .filter((g) => g.answers >= min && g.correct < g.answers)
    .sort((a, b) => a.accuracy! - b.accuracy! || b.answers - a.answers || a.label.localeCompare(b.label))
    .slice(0, opts.limit ?? 3);
}

/** Observed retention of one memory: due reviews (a day or more after the previous one) and how many were recalled. */
export interface RetentionFigure {
  reviews: number;
  recalled: number;
  retention: number | null;
  /** The FSRS model's average predicted recall now, over words in review (not limited to the window). */
  estimated: number | null;
}

/** The Skills section: what Comprehensive study trains, per language, over a window (GET /api/stats/skills/:code). */
export interface SkillStats {
  language: LanguageCode;
  window: StatsWindow;
  /** The window's first local day, or null for all time. */
  firstDay: string | null;
  /** Nothing at all studied in this language yet (all time): no words met, no answers, no texts. */
  nothingYet: boolean;
  vocabulary: {
    /** Words now being learned, learned (recognised after a delay, as in the summary figures) and marked as known. */
    learning: number;
    learned: number;
    known: number;
    recognition: RetentionFigure;
    recall: RetentionFigure;
  };
  /** Session exercises by ear (listen for the meaning, which word, dictation), with the due reviews among them. */
  listening: Tally & { reviews: Tally };
  /** Session exercises said aloud (say it, shadowing), self-rated: right = rated Hard or better. */
  speaking: Tally & { reviews: Tally };
  /**
   * Declension or conjugation practice; null for a language without tables. `weakest`: the cases or tenses answered
   * worst with at least `minAnswers` answers each; `rated`: how many cases or tenses have that many.
   */
  forms: (Tally & { weakest: GroupTally[]; minAnswers: number; rated: number }) | null;
  /** Sentence gaps practice. */
  cloze: Tally;
  /** Identify; null when this installation has no pictures. `named`: different things named right. */
  identify: (Tally & { named: number }) | null;
  /** Read: right = understood in full; `partly` = understood in part. */
  read: Tally & { partly: number };
  /** Say it: right = said right. */
  say: Tally;
  /** Reading comprehension; null when this language has no texts. Texts count once each, questions every answer. */
  reading: {
    level: ReadingLevel;
    texts: number;
    passed: number;
    questions: Tally;
    byKind: Array<{ kind: ComprehensionKind; texts: number; passed: number; levels: Array<{ level: ReadingLevel; texts: number; passed: number }> }>;
  } | null;
}

/** "a, b and c". */
export function listJoin(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}
