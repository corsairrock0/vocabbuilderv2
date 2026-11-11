// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
/** Settings defaults shared by server and client. Stored values override these per key. */
import type { LanguageCode } from './languages.ts';
import { LANGUAGES } from './languages.ts';
import type { Strictness } from './answer.ts';
import type { ReadingLevel } from './comprehension.ts';

export type Theme = 'system' | 'light' | 'dark';
export type Focus = 'balanced' | 'listening' | 'speaking' | 'reading' | 'writing';
export type Difficulty = 'easy' | 'normal' | 'challenging';
export type HintBehavior = 'on_request' | 'after_error' | 'never';
export type RatingMode = 'auto' | 'confirm';
export type ReviewPriority = 'balanced' | 'due_first' | 'difficult_first';
export type Repetitions = 'fewer' | 'normal' | 'more';

export interface GlobalSettings {
  theme: Theme;
  timezone: string;
  activeLanguage: LanguageCode;
  interfaceLanguage: 'en';
  keyboardShortcuts: boolean;
  reducedMotion: boolean;
  fontScale: number;
  highContrast: boolean;
  ratingMode: RatingMode;
  hintBehavior: HintBehavior;
  showStressMarks: boolean;
  audioAutoplay: boolean;
  recordingEnabled: boolean;
  onScreenKeyboard: boolean;
}

export const GLOBAL_DEFAULTS: GlobalSettings = {
  theme: 'system',
  timezone: 'UTC',
  activeLanguage: 'es',
  interfaceLanguage: 'en',
  keyboardShortcuts: true,
  reducedMotion: false,
  fontScale: 1,
  highContrast: false,
  ratingMode: 'auto',
  hintBehavior: 'on_request',
  showStressMarks: true,
  audioAutoplay: false,
  recordingEnabled: true,
  onScreenKeyboard: false,
};

/**
 * What the last fit of the memory model to the learner's reviews found (2.0.0; shared/fsrs-optimizer.ts). The fitted
 * parameters are judged on the latest reviews, which the fit has not seen, against the standard parameters.
 */
export interface MemoryFit {
  /** When it ran. */
  at: number;
  /**
   * better: the fitted parameters predicted those reviews better and are in use since. not_better: they did not, and
   * the standard parameters are in use (also when fitted ones were in use before the check).
   */
  status: 'better' | 'not_better';
  /** Reviews the fit learned from, and the latest ones it was judged on. */
  reviews: number;
  judgedOn: number;
  /** On those: the share remembered, and the share each model expected to be remembered. */
  recalled: number;
  standardPredicted: number;
  fittedPredicted: number;
  /** Their prediction error there (log loss; lower is better). */
  standardLoss: number;
  fittedLoss: number;
}

/** The memory model of one language, as GET /api/languages/:code/memory-model gives it. */
export interface MemoryModelStatus {
  language: LanguageCode;
  /** Which parameters schedule this language now. */
  model: 'standard' | 'personal';
  /** Reviews that test the model (each at least a day after the review before it), and how many a fit needs. */
  reviews: number;
  needed: number;
  /** What the last fit found (null: none was run, or the standard model was chosen again since). */
  lastFit: MemoryFit | null;
  /** The parameters in use. */
  parameters: number[];
}

/** The answer to fitting the model or going back to the standard one. */
export interface MemoryModelChange extends MemoryModelStatus {
  /**
   * fitted: the fit is in use now. kept: it was not better and the standard model stays. reverted: it was not better,
   * and the standard model replaces an earlier fit. too_few: not enough reviews. reset: the learner chose the standard
   * model.
   */
  outcome: 'fitted' | 'kept' | 'reverted' | 'too_few' | 'reset';
  /** Cards rescheduled, and the words due by the end of today before and after. */
  rescheduled: number;
  dueBefore: number;
  dueAfter: number;
  settings: LanguageSettings;
}

export interface LanguageSettings {
  accent: string;
  playbackRate: number;
  dailyNewTarget: number;
  sessionMinutes: number;
  desiredRetention: number;
  spellingStrictness: Strictness;
  focus: Focus;
  difficulty: Difficulty;
  frequencyMin: number | null;
  frequencyMax: number | null;
  ttsFallback: boolean;
  ttsVoice: string | null;
  reviewPriority: ReviewPriority;
  repetitions: Repetitions;
  frequencySourceId: number | null;
  includeShadowing: boolean;
  includeSentenceCreation: boolean;
  /** Reading comprehension: the level passages come from; passing one raises it (shared/comprehension.ts). */
  readingLevel: ReadingLevel;
  /** Writing: the level sentences come from; it rises once every sentence of the level is written right (shared/writing.ts). */
  writingLevel: ReadingLevel;
  /** Minutes of study a day the learner aims for in this language (Today's week, the Progress page's study time). */
  dailyGoalMinutes: number;
  /**
   * The memory model's 21 parameters fitted to the learner's own reviews in this language (null: the standard FSRS-6
   * parameters), and what the last fit found. Only the server sets these (server/learning/memory-model.ts).
   */
  fsrsParameters: number[] | null;
  fsrsFit: MemoryFit | null;
}

export function languageDefaults(code: LanguageCode): LanguageSettings {
  return {
    accent: LANGUAGES[code].defaultAccent,
    playbackRate: 1,
    dailyNewTarget: 10,
    sessionMinutes: 30,
    desiredRetention: 0.9,
    spellingStrictness: 'normal',
    focus: 'balanced',
    difficulty: 'normal',
    frequencyMin: null,
    frequencyMax: null,
    ttsFallback: false,
    ttsVoice: null,
    reviewPriority: 'balanced',
    repetitions: 'normal',
    frequencySourceId: null,
    includeShadowing: true,
    includeSentenceCreation: false,
    readingLevel: 'A1',
    writingLevel: 'A1',
    dailyGoalMinutes: 20,
    fsrsParameters: null,
    fsrsFit: null,
  };
}

/**
 * What a study session practices. comprehensive: reviews and new words with short practice rounds in between (forms,
 * sentence gaps, Identify, Read and say, a text to read); mixed: reviews and new words only; review: due words only.
 */
export const STUDY_MODES = ['comprehensive', 'mixed', 'review', 'new'] as const;
export type StudyMode = (typeof STUDY_MODES)[number];
/** The mode of every one-tap start (Start studying, Quick study, Study more) and of a session that names none. */
export const DEFAULT_STUDY_MODE: StudyMode = 'comprehensive';

export const SESSION_MINUTE_OPTIONS = [10, 15, 20, 30, 45, 60];
/** The daily goal's choices in Settings → Learning (minutes a day, per language; 20 by default). */
export const DAILY_GOAL_OPTIONS = [10, 15, 20, 30, 45, 60];
export const NEW_WORD_OPTIONS = [0, 5, 10, 15, 20];
export const RETENTION_OPTIONS = [0.8, 0.85, 0.9, 0.93, 0.95, 0.97];
