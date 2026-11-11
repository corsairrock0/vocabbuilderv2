// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
import type { LegalInfo, TermsStatus } from './legal.ts';
/** API contract shared by server and web client. Timestamps are epoch milliseconds (UTC). */
import type { RoundTallies } from './activity.ts';
import type { PracticeSlot, QuestionType } from './mix.ts';
import type { AnswerSpec, CheckResult, Grade } from './answer.ts';
import type { Paradigm } from './paradigms.ts';
import type { ExactCell } from './grammar.ts';
import type { CardSkill, ExerciseKind, MasteryLevels, Skill, Stage } from './exercises.ts';
import type { Rating } from './fsrs.ts';
import type { LanguageCode } from './languages.ts';
import type { Difficulty, Focus, GlobalSettings, LanguageSettings, StudyMode } from './settings.ts';

export interface ApiError {
  error: { code: string; message: string; details?: unknown };
}

export interface AuthStatus {
  setupRequired: boolean;
  authenticated: boolean;
  user?: { username: string };
  csrfToken?: string;
}

export interface LanguageStats {
  total: number;
  introduced: number;
  learned: number;
  /** Words known (learned, or marked as known) and being learned (introduced, not yet learned): see shared/progress.ts. */
  known: number;
  learning: number;
  mature: number;
  mastered: number;
  due: number;
  dueReceptive: number;
  dueProductive: number;
  newAvailable: number;
  difficult: number;
  /** Active study time today: sessions (their practice rounds included) and the Practice pages. */
  studiedTodayMs: number;
  reviewsToday: number;
  introducedToday: number;
  /** Practice answers today (forms, sentence gaps, Identify, Read and Say it; Practice pages and session rounds). */
  practiceToday: number;
  /** Reading comprehension texts read today. */
  textsToday: number;
  /** Session answers in the last 7 days answered right (practice is not part of this figure). */
  accuracy7d: number | null;
  listeningAccuracy: number | null;
  recognitionAccuracy: number | null;
  productionAccuracy: number | null;
  lastStudiedAt: number | null;
  /** Days in a row with any study: session answers, practice answers or texts read. */
  streakDays: number;
  /** The first local day anything was studied in this language, or null (Home's week counts the goal from then). */
  firstStudyDay: string | null;
  /** answers: session answers, practice answers and reading questions of the day. */
  activity14d: Array<{ day: string; minutes: number; reviews: number; answers: number }>;
}

export interface ActiveSessionInfo {
  id: string;
  language: LanguageCode;
  status: 'prepared' | 'active' | 'paused';
  /** Questions done and in all, as the session's counter shows them (exercises, and practice in Comprehensive mode). */
  done: number;
  total: number;
  lastActivityAt: number | null;
  createdAt: number;
}

export interface LanguageSummary {
  code: LanguageCode;
  name: string;
  nativeName: string;
  flag: string;
  variety: string;
  stats: LanguageStats;
  activeSession: ActiveSessionInfo | null;
  /** The bundled "most frequent words" set, when one exists for this language. */
  /** updateAvailable: the bundled set is newer than the version loaded (corrections shipped with an update). */
  frequencySet: { words: number; name: string; loaded: boolean; updateAvailable: boolean } | null;
}

export interface Bootstrap {
  user: { username: string };
  settings: GlobalSettings;
  languageSettings: Record<LanguageCode, LanguageSettings>;
  languages: LanguageSummary[];
  forvo: { configured: boolean; quotaRemaining: number | null };
  overview: { todayMs: number; weekMs: number; streakDays: number; reviewsToday: number; introducedToday: number; practiceToday: number; textsToday: number; dueTotal: number };
  serverTime: number;
  version: string;
  revision: number;
  legal: LegalInfo;
  terms: TermsStatus;
}

export interface Option {
  id: string;
  text: string;
  sub?: string;
}

export interface SentenceParts {
  before: string;
  after: string;
  /** Display versions with stress marks (ru/uk), when available. */
  beforeDisplay?: string;
  afterDisplay?: string;
  translation: string;
  /** The sentence was written by an AI (shown as such). */
  ai?: boolean;
  /** The meaning of the word in this sentence, when known (shown with the answer). */
  meaning?: string;
  /**
   * The cell of the word's table the target fills in this sentence, and why (AI-annotated, data/grammar/), when there
   * is an annotation that the table confirms. The answer feedback then names that cell alone (shared/grammar.ts).
   */
  exact?: ExactCell;
}

export type ExercisePayload =
  | { kind: 'intro'; entryId: number }
  | { kind: 'meaning_choice'; entryId: number; word: string; plain: string; pos: string; options: Option[]; correctId: string }
  | { kind: 'meaning_typed'; entryId: number; word: string; plain: string; pos: string; answer: AnswerSpec }
  | { kind: 'context_meaning'; entryId: number; sentence: string; sentenceDisplay?: string; highlight: [number, number]; translation: string; ai?: boolean; options: Option[]; correctId: string }
  | { kind: 'word_choice'; entryId: number; gloss: string; note?: string | null; pos: string; gender?: string | null; options: Option[]; correctId: string }
  | { kind: 'recall_typed'; entryId: number; gloss: string; note?: string | null; pos: string; gender?: string | null; aspect?: string | null; hint: { first: string; length: number }; answer: AnswerSpec }
  | ({ kind: 'cloze_choice'; entryId: number; options: Option[]; correctId: string; mode: 'word' | 'form'; lemmaHint?: string } & SentenceParts)
  | ({ kind: 'cloze_typed'; entryId: number; lemmaHint: string; answer: AnswerSpec; tags?: string[] } & SentenceParts)
  | { kind: 'form_typed'; entryId: number; lemma: string; display: string; tags: string[]; cell?: string; answer: AnswerSpec }
  | { kind: 'listen_meaning'; entryId: number; options: Option[]; correctId: string; word: string }
  | { kind: 'listen_choice'; entryId: number; options: Option[]; correctId: string; contrast: boolean; gloss: string }
  | { kind: 'dictation'; entryId: number; answer: AnswerSpec; gloss: string }
  | { kind: 'speak_flashcard'; entryId: number; gloss: string; pos: string; word: string; plain: string }
  | { kind: 'sentence_create'; entryId: number; word: string; gloss: string; examples: Array<{ text: string; translation: string; ai?: boolean }> }
  | { kind: 'shadowing'; entryId: number; word: string; gloss: string }
  | { kind: 'picture_choice'; entryId: number; imageUrl: string; options: Option[]; correctId: string };

export interface ExerciseResult {
  attemptId: number;
  grade: Grade | 'self';
  code: string;
  message: string;
  expected: string;
  response: string | null;
  rating: Rating | null;
  countedAsReview: boolean;
  answeredAt: number;
}

export interface SessionExercise {
  id: string;
  seq: number;
  stage: Stage;
  kind: ExerciseKind;
  itemId: number;
  cardSkill: CardSkill | null;
  priority: 'core' | 'optional';
  origin: 'plan' | 'remediation';
  parentId: string | null;
  status: 'pending' | 'done' | 'skipped';
  payload: ExercisePayload;
  result: ExerciseResult | null;
}

export interface ItemResource {
  itemId: number;
  entryId: number;
  lemma: string;
  display: string;
  pos: string;
  gender: string | null;
  aspect: string | null;
  aspectPair: string | null;
  pronunciation: string | null;
  senses: Array<{ gloss: string; translations: string[]; definition: string | null; note: string | null }>;
  forms: Array<{ form: string; display: string | null; tags: string[] }>;
  /** sense: index into senses of the meaning the sentence shows (null when not linked to one). */
  examples: Array<{ text: string; display: string | null; translation: string | null; target: string | null; start: number | null; end: number | null; sense?: number | null; ai?: boolean }>;
  /** kind 'combination': a fixed combination with its own meaning, never quizzed as the word's meaning. */
  expressions: Array<{ text: string; translation: string | null; kind?: 'combination' | 'expression' }>;
  grammarNotes: string | null;
  regionalNote: string | null;
  register: string | null;
  tags: string[];
  frequencyRank: number | null;
  curatedOrder: number | null;
  imageUrl: string | null;
  isNew: boolean;
  audio: { forvo: boolean; user: boolean };
  /** Key forms from the word's declension or conjugation table (kept for sessions planned before 1.5.0). */
  inflection?: { title: string; rows: Array<{ label: string; forms: string[] }> } | null;
  /** The word's whole declension or conjugation table, shown on the new-word card and with answers. */
  paradigm?: Paradigm | null;
  /** Alternative exercise payloads used for deterministic in-session remediation. */
  variants: Partial<Record<ExerciseKind, ExercisePayload>>;
}

export interface SessionConfig {
  language: LanguageCode;
  minutes: number;
  newWords: number;
  difficulty: Difficulty;
  focus: Focus;
  /**
   * comprehensive (the default): reviews and new words, with practice rounds (forms, gaps, Identify, Read and say, a
   * text to read) in between; mixed: reviews and new words; review: due words only.
   */
  mode: StudyMode;
  frequencyMin: number | null;
  frequencyMax: number | null;
  tag: string | null;
  quick: boolean;
}

export interface PlanMeta {
  /** The session's length (its minutes, in seconds of real time). */
  budgetSeconds: number;
  /** The time model's estimate of its reviews and new words (model seconds: real time ≈ this × pace). */
  estimatedSeconds: number;
  /**
   * How much longer than the time model this learner's questions take (1.8.4): the plan fills budgetSeconds / pace of
   * model time, so the session takes about its minutes in real life. Absent in sessions planned before (pace 1).
   */
  pace?: number;
  dueAvailable: number;
  reviewsPlanned: number;
  newRequested: number;
  newPlanned: number;
  adaptations: string[];
  stages: Partial<Record<Stage, number>>;
  audioAvailable: boolean;
  /**
   * Comprehensive sessions: the answers given in the practice rounds, per skill, from the session's `round` events
   * (mergeRound in shared/activity.ts), so a resumed session keeps its count, summary and Identify minimum.
   */
  rounds?: RoundTallies;
  /** The rounds counted in `rounds`, by round id, with how many of their answers (a replayed event adds nothing). */
  roundAnswers?: Record<string, number>;
  /** Rounds over (done, ended early, or with nothing to ask), by round id. */
  roundsEnded?: Record<string, true>;
  /** Comprehensive sessions: the practice planned with the session, in order (shared/mix.ts, planPractice). */
  practice?: PracticeSlot[];
}

export interface SessionSummary {
  introduced: Array<{ itemId: number; lemma: string; gloss: string }>;
  reviewed: number;
  attempts: number;
  correctFirstTry: number;
  retrievalAccuracy: number | null;
  listening: { attempts: number; correct: number };
  production: { attempts: number; correct: number };
  difficult: Array<{ itemId: number; lemma: string; gloss: string; misses: number }>;
  scheduleChanges: Array<{ itemId: number; lemma: string; skill: CardSkill; rating: Rating; scheduledDays: number; dueAfter: number }>;
  activeMs: number;
  next: { dueTomorrow: number; dueThisWeek: number; suggestion: string };
}

/**
 * What a session started now would hold, per type of question (GET /api/sessions/preview): the start screen's mix and
 * Home's "Today's session". Planned like a real session, then discarded.
 */
export interface StudyPreview {
  language: LanguageCode;
  mode: StudyMode;
  /** The length planned for, in minutes. */
  minutes: number;
  /** Every question planned: the session's exercises and its practice. */
  total: number;
  /** Questions per type, in the order the start screen lists them; types with none are left out. */
  parts: Array<{ type: QuestionType; count: number }>;
  /** Words: due reviews and new words planned. */
  reviews: number;
  newWords: number;
  /** Nothing could be planned: the reason, as Start would give it. */
  empty: string | null;
}

export interface StudySession {
  id: string;
  language: LanguageCode;
  status: 'prepared' | 'active' | 'paused' | 'completed' | 'abandoned';
  mode: string;
  config: SessionConfig;
  meta: PlanMeta;
  createdAt: number;
  startedAt: number | null;
  lastActivityAt: number | null;
  endedAt: number | null;
  activeMs: number;
  exercises: SessionExercise[];
  items: Record<string, ItemResource>;
  summary: SessionSummary | null;
}

export interface AttemptRequest {
  opId: string;
  exerciseId: string;
  response?: string | null;
  choiceId?: string | null;
  hintsUsed?: number;
  revealed?: boolean;
  latencyMs?: number | null;
  answeredAt: number;
  selfRating?: Rating | null;
  /** Learner says an automatically rejected typed answer was right. */
  override?: boolean;
  /** Learner adjusted the suggested rating. */
  ratingOverride?: Rating | null;
  /** Intro only: learner already knows the word (excluded from new-word learning). */
  markKnown?: boolean;
  /** The exercise kind the learner answered (lets the server adopt a follow-up exercise planned offline). */
  kind?: ExerciseKind;
  activeMsDelta?: number;
  deviceId?: string;
  offline?: boolean;
}

export interface ReviewChange {
  cardSkill: CardSkill;
  rating: Rating;
  scheduledDays: number;
  dueAfter: number;
  retrievabilityBefore: number | null;
  stabilityAfter: number;
}

export interface AttemptResponse {
  exerciseId: string;
  result: ExerciseResult;
  check: CheckResult | null;
  review: ReviewChange | null;
  finalized: Array<{ itemId: number; changes: ReviewChange[] }>;
  inserted: SessionExercise[];
  skipped: string[];
  alreadyCompleted: boolean;
  session: { status: StudySession['status']; done: number; total: number; activeMs: number };
}

export interface VocabListItem {
  entryId: number;
  language: LanguageCode;
  lemma: string;
  display: string;
  pos: string;
  gloss: string;
  frequencyRank: number | null;
  curatedOrder: number | null;
  tags: string[];
  status: 'new' | 'introduced' | 'active' | 'known' | 'suspended';
  learnState: 'new' | 'learning' | 'learned' | 'mature' | 'mastered' | 'known' | 'suspended';
  favorite: boolean;
  difficult: boolean;
  receptiveDue: number | null;
  productiveDue: number | null;
  receptiveStability: number | null;
  lapses: number;
  isCustom: boolean;
}

export interface VocabListResponse {
  items: VocabListItem[];
  total: number;
  offset: number;
  limit: number;
}

export interface CardInfo {
  skill: CardSkill;
  state: number;
  stability: number | null;
  difficulty: number | null;
  due: number | null;
  lastReview: number | null;
  reps: number;
  lapses: number;
  retrievability: number | null;
}

export interface VocabDetail extends VocabListItem {
  gender: string | null;
  aspect: string | null;
  aspectPair: string | null;
  pronunciation: string | null;
  register: string | null;
  regionalNote: string | null;
  grammarNotes: string | null;
  imageUrl: string | null;
  senses: Array<{ id: number; gloss: string; definition: string | null; note: string | null; translations: string[] }>;
  forms: Array<{ id: number; form: string; display: string | null; tags: string[] }>;
  /** senseId: the meaning (in senses) the sentence shows, or null when not linked to one. */
  examples: Array<{ id: number; text: string; display: string | null; translation: string | null; target: string | null; senseId: number | null; source: { name: string; license: string | null; url: string | null; ai?: boolean } | null }>;
  /** Declension or conjugation table, where the word has one. */
  paradigm: Paradigm | null;
  expressions: Array<{ id: number; text: string; translation: string | null; kind: 'combination' | 'expression' }>;
  frequencies: Array<{ source: string; kind: string; rank: number | null; count: number | null }>;
  source: { name: string; kind: string; license: string | null } | null;
  note: string | null;
  mnemonic: string | null;
  cards: CardInfo[];
  evidence: Array<{ skill: Skill; attempts: number; correct: number; delayedCorrect: number; streak: number; lastAttemptAt: number | null }>;
  mastery: MasteryLevels;
  reviews: Array<{ id: number; skill: CardSkill; rating: Rating; reviewedAt: number; scheduledDays: number; stabilityAfter: number; retrievabilityBefore: number | null; exerciseKind: string | null }>;
  recentAttempts: Array<{ kind: ExerciseKind; grade: string; answeredAt: number; response: string | null }>;
  version: number;
  /** How many pictured objects the word names in the Identify practice (sent by GET /api/vocab/:id). */
  identifyCount?: number;
}

export interface AudioSource {
  id: string;
  provider: 'forvo' | 'user' | 'tts';
  kind: 'human' | 'synthesized' | 'user' | 'unverified';
  url: string | null;
  urlExpiresAt: number | null;
  speaker: string | null;
  sex: string | null;
  country: string | null;
  accentLabel: string;
  verification: 'variety_verified' | 'country_verified' | 'user_verified' | 'unverified';
  votes: number | null;
  preferred: boolean;
  sourceUrl: string | null;
  attribution: string | null;
  word: string;
}

export interface AudioLookup {
  entryId: number;
  word: string;
  status: 'ok' | 'not_configured' | 'none_found' | 'quota_exceeded' | 'error' | 'offline';
  message: string | null;
  sources: AudioSource[];
  forvoPageUrl: string;
  tts: { enabled: boolean; locales: string[]; voice: string | null };
}
