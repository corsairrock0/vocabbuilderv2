// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
/**
 * Reading comprehension rules shared by the server and the browser: the levels, the two kinds of passage, the pass
 * mark, the level a learner reaches after a passage, and what passes between them. The browser shows a result at once
 * with these rules; the server grades the attempt again and its result is the one stored.
 *
 * Two kinds of passage share one reading level per language:
 *   long   about 150 words on literature, history, the humanities or science, four questions; served in id order
 *   short  about 75 words of everyday life (a dialogue, a chat message, a notice…), three questions; served in
 *          `step` order, easiest first within the level. Study sessions use these between exercises.
 *
 * The level moves up only when every text of the learner's level, of both kinds, has been read (pass or fail: a text
 * read once never comes back), one level at a time and never past a level that has no texts yet.
 */

export const READING_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1'] as const;
export type ReadingLevel = (typeof READING_LEVELS)[number];

export type ComprehensionKind = 'long' | 'short';
export const COMPREHENSION_KINDS: readonly ComprehensionKind[] = ['long', 'short'];

/** A short passage's id carries its batch as S<n>: "es-A2-S1-07"; a long one's is "es-A2-1-07". */
export function kindOfId(id: string): ComprehensionKind {
  return /-S\d+-\d+$/.test(id) ? 'short' : 'long';
}

export const SHORT_FORMATS = ['story', 'dialogue', 'message', 'email', 'notice', 'diary', 'instructions', 'advert', 'description'] as const;
export type ShortFormat = (typeof SHORT_FORMATS)[number];

export function isReadingLevel(x: unknown): x is ReadingLevel {
  return typeof x === 'string' && (READING_LEVELS as readonly string[]).includes(x);
}

/** A stored or requested level; A1 when the value is not a level. */
export function readingLevel(x: unknown): ReadingLevel {
  return isReadingLevel(x) ? x : 'A1';
}

export function levelRank(level: ReadingLevel): number {
  return READING_LEVELS.indexOf(level);
}

/** Right answers needed to pass a passage: all but one (3 of 4 for a long passage, 2 of 3 for a short one). */
export function passMark(total: number): number {
  return Math.max(1, total - 1);
}

export function isPass(correct: number, total: number): boolean {
  return total > 0 && correct >= passMark(total);
}

/** The level after this one; C1 stays C1. */
export function levelAbove(level: ReadingLevel): ReadingLevel {
  return READING_LEVELS[Math.min(levelRank(level) + 1, READING_LEVELS.length - 1)];
}

/** How far the learner is through a level: its texts of both kinds in the language's data, and how many were read. */
export interface LevelProgress {
  level: ReadingLevel;
  total: number;
  read: number;
}

/** The texts at `level`, of both kinds, and how many of them are in `read` (the ids of the texts read). */
export function levelProgress(level: ReadingLevel, passages: ReadonlyArray<{ id: string; level: ReadingLevel }>, read: { has(id: string): boolean }): LevelProgress {
  let total = 0;
  let done = 0;
  for (const p of passages) {
    if (p.level !== level) continue;
    total++;
    if (read.has(p.id)) done++;
  }
  return { level, total, read: done };
}

/** Every text of the level has been read. A level without texts is never done, so it can't push the learner on. */
export function levelDone(p: { total: number; read: number }): boolean {
  return p.total > 0 && p.read >= p.total;
}

/**
 * The learner's level after a text is read. It moves up one level (C1 at most) only when every text of the current
 * level in the data, of both kinds, is among `read` (this text included; a text read once counts whatever the result),
 * and on from there while the next level's texts were all read before (as fallbacks, or while that level was set). A
 * pass or fail changes nothing by itself; texts at other levels never count toward the current one; it never lowers.
 */
export function levelAfter(current: ReadingLevel, passages: ReadonlyArray<{ id: string; level: ReadingLevel }>, read: { has(id: string): boolean }): ReadingLevel {
  let level = current;
  while (level !== 'C1' && levelDone(levelProgress(level, passages, read))) level = levelAbove(level);
  return level;
}

/**
 * The level the browser shows at once after a text, from the progress the server sent with it (the learner's level
 * before this text): one up when this text was the last unread one of that level. The server's result then replaces it.
 * Null progress (the learner's level changed meanwhile) predicts no change.
 */
export function predictedLevel(current: ReadingLevel, progress: LevelProgress | null | undefined, passage: ReadingLevel): { level: ReadingLevel; progress: LevelProgress | null } {
  if (!progress || progress.level !== current) return { level: current, progress: null };
  const counted = { ...progress, read: progress.read + (passage === current ? 1 : 0) };
  if (current === 'C1' || !levelDone(counted)) return { level: current, progress: counted };
  const up = levelAbove(current);
  // The next level's counts are not known here: the server's result says how far through it the learner is.
  return { level: up, progress: null };
}

/** Where to look for the next passage: the requested level, then the higher levels, then the lower ones, nearest first. */
export function levelSearchOrder(requested: ReadingLevel): ReadingLevel[] {
  const i = levelRank(requested);
  return [requested, ...READING_LEVELS.slice(i + 1), ...READING_LEVELS.slice(0, i).reverse()];
}

/** Questions are in English up to B1 and in the passage's language at B2 and C1. */
export function questionsInLanguage(level: ReadingLevel): boolean {
  return levelRank(level) >= levelRank('B2');
}

/** Long passages have one of the first four; short ones are all "everyday". */
export type Genre = 'literature' | 'history' | 'humanities' | 'science' | 'everyday';

export interface ComprehensionQuestion {
  q: string;
  options: string[];
  /** The right option's index in `options`. */
  answer: number;
  /** One sentence in English pointing to the words in the passage that settle the answer. */
  explain: string;
}

export interface ComprehensionPassage {
  id: string;
  kind: ComprehensionKind;
  level: ReadingLevel;
  genre: Genre;
  /** Short passages: what kind of text it is (a dialogue, a chat message…). */
  format?: ShortFormat;
  /** Short passages: the place in the level's sequence, easiest first (1–40). */
  step?: number;
  topic: string;
  title: string;
  titleEn: string;
  /** Paragraphs separated by a blank line; inside a paragraph a single line break separates lines (dialogues, lists). */
  text: string;
  translation: string;
  /** Four for a long passage, three for a short one. */
  questions: ComprehensionQuestion[];
}

/** POST /api/practice/comprehension/next */
export interface ComprehensionNext {
  /** The passage to read, with right answers and explanations (the browser grades at once); null when none is left. */
  passage: ComprehensionPassage | null;
  kind: ComprehensionKind;
  requested: ReadingLevel;
  /** The passage's level: the requested one, or the nearest with a passage of this kind left when it is used up. */
  level: ReadingLevel | null;
  fallback: boolean;
  /** Passages of this kind in this language, and those not read yet. */
  total: number;
  available: number;
  /**
   * How far the learner is through the requested level (theirs unless the device asked for another), both kinds; the
   * texts the device asked to skip count as read. Lets the browser show at once whether this text moves the level up.
   */
  progress: LevelProgress;
}

/** POST /api/practice/comprehension/attempts */
export interface ComprehensionResult {
  passageId: string;
  correct: number;
  total: number;
  passed: boolean;
  levelBefore: ReadingLevel;
  levelAfter: ReadingLevel;
  levelUp: boolean;
  /**
   * How far the learner is through `levelAfter` now, this text counted. From the server always; in the browser's
   * immediate result null when it can't tell (after a level up, or when the learner's level changed meanwhile).
   */
  progress: LevelProgress | null;
  /** Per question: the option chosen (its stored index, -1 for none), the right one, and whether they match. */
  results: Array<{ chosen: number; answer: number; correct: boolean }>;
  /** The same opId was saved before: this is the stored result. */
  duplicate?: boolean;
}

export interface ComprehensionLevelCount {
  level: ReadingLevel;
  total: number;
  read: number;
  passed: number;
}

export interface ComprehensionKindSummary {
  total: number;
  read: number;
  passed: number;
  /** Passages not read yet. */
  available: number;
  levels: ComprehensionLevelCount[];
}

/** GET /api/practice/comprehension/summary/:code */
export interface ComprehensionSummary {
  language: string;
  /** The learner's reading level (the language setting readingLevel), shared by both kinds. */
  level: ReadingLevel;
  /** How far the learner is through their level: its texts of both kinds and those read (all of them move it up). */
  progress: LevelProgress;
  /** Both kinds together. */
  total: number;
  read: number;
  passed: number;
  available: number;
  kinds: Record<ComprehensionKind, ComprehensionKindSummary>;
}
