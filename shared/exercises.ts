// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
/**
 * Exercise catalogue, skill model, rating policy and remediation rules.
 * Pure functions shared by the server (authoritative) and the client (instant feedback,
 * offline sessions). Both sides must produce identical results for the same inputs.
 */
import type { Rating } from './fsrs.ts';
import type { CheckResult, Grade } from './answer.ts';

export type CardSkill = 'receptive' | 'productive';

/** The six vocabulary abilities tracked independently (+ self-assessed speaking practice). */
export type Skill =
  | 'recognition' // written word recognition
  | 'listening' // listening comprehension
  | 'recall' // English -> target-language recall
  | 'comprehension' // target-language -> English comprehension
  | 'sentence' // sentence completion
  | 'production' // productive vocabulary usage
  | 'speaking' // self-assessed spoken practice (never counted as verified mastery)
  | 'exposure'; // introduction (not a retrieval)

export const SKILLS: Skill[] = ['recognition', 'listening', 'recall', 'comprehension', 'sentence', 'production', 'speaking'];

/** What each skill is called on the word page and in Progress, in the learner's words. */
export const SKILL_LABELS: Record<Skill, string> = {
  recognition: 'Recognising the word',
  listening: 'Listening',
  recall: 'Recalling from English',
  comprehension: 'Giving the meaning',
  sentence: 'Sentence gaps',
  production: 'Writing sentences',
  speaking: 'Speaking (self-rated)',
  exposure: 'Introduced',
};

export type ExerciseKind =
  | 'intro'
  | 'meaning_choice'
  | 'meaning_typed'
  | 'context_meaning'
  | 'word_choice'
  | 'recall_typed'
  | 'cloze_choice'
  | 'cloze_typed'
  | 'form_typed'
  | 'listen_meaning'
  | 'listen_choice'
  | 'dictation'
  | 'speak_flashcard'
  | 'sentence_create'
  | 'shadowing'
  | 'picture_choice';

export type ResponseMode = 'none' | 'choice' | 'typed' | 'self';

export interface KindInfo {
  skill: Skill;
  card: CardSkill | null;
  response: ResponseMode;
  /** Requires playable audio for the word. */
  audio: boolean;
  /** Recognition-assisted production (choosing among options): evidence only, never a productive scheduling event. */
  assisted: boolean;
  /** Practice only: never an FSRS scheduling event. */
  practiceOnly: boolean;
  label: string;
  /** Default time estimate in seconds, refined from the learner's own latencies. */
  seconds: number;
}

export const KINDS: Record<ExerciseKind, KindInfo> = {
  intro: { skill: 'exposure', card: null, response: 'none', audio: false, assisted: false, practiceOnly: true, label: 'New word', seconds: 25 },
  meaning_choice: { skill: 'recognition', card: 'receptive', response: 'choice', audio: false, assisted: false, practiceOnly: false, label: 'What does it mean?', seconds: 8 },
  meaning_typed: { skill: 'comprehension', card: 'receptive', response: 'typed', audio: false, assisted: false, practiceOnly: false, label: 'Type the meaning', seconds: 13 },
  context_meaning: { skill: 'comprehension', card: 'receptive', response: 'choice', audio: false, assisted: false, practiceOnly: false, label: 'Meaning in context', seconds: 13 },
  word_choice: { skill: 'recall', card: 'productive', response: 'choice', audio: false, assisted: true, practiceOnly: false, label: 'Choose the word', seconds: 9 },
  recall_typed: { skill: 'recall', card: 'productive', response: 'typed', audio: false, assisted: false, practiceOnly: false, label: 'Recall the word', seconds: 15 },
  cloze_choice: { skill: 'sentence', card: 'receptive', response: 'choice', audio: false, assisted: false, practiceOnly: false, label: 'Complete the sentence', seconds: 12 },
  cloze_typed: { skill: 'sentence', card: 'productive', response: 'typed', audio: false, assisted: false, practiceOnly: false, label: 'Type the missing word', seconds: 17 },
  form_typed: { skill: 'production', card: 'productive', response: 'typed', audio: false, assisted: false, practiceOnly: false, label: 'Produce the form', seconds: 16 },
  listen_meaning: { skill: 'listening', card: 'receptive', response: 'choice', audio: true, assisted: false, practiceOnly: false, label: 'Listen: meaning', seconds: 10 },
  listen_choice: { skill: 'listening', card: 'receptive', response: 'choice', audio: true, assisted: false, practiceOnly: false, label: 'Listen: which word?', seconds: 10 },
  dictation: { skill: 'listening', card: 'receptive', response: 'typed', audio: true, assisted: false, practiceOnly: false, label: 'Listen and type', seconds: 15 },
  speak_flashcard: { skill: 'speaking', card: 'productive', response: 'self', audio: false, assisted: false, practiceOnly: false, label: 'Say it aloud', seconds: 11 },
  sentence_create: { skill: 'production', card: 'productive', response: 'self', audio: false, assisted: false, practiceOnly: true, label: 'Make a sentence', seconds: 60 },
  shadowing: { skill: 'speaking', card: null, response: 'self', audio: true, assisted: false, practiceOnly: true, label: 'Shadowing', seconds: 25 },
  picture_choice: { skill: 'recognition', card: 'receptive', response: 'choice', audio: false, assisted: false, practiceOnly: false, label: 'Picture', seconds: 8 },
};

/** Seconds of feedback/transition overhead added to each graded exercise in time estimates. */
export const FEEDBACK_OVERHEAD_S = 3;

/** Session stages (A–H) of the integrated session. */
export type Stage = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H';
export const STAGE_LABELS: Record<Stage, string> = {
  A: 'Review',
  B: 'New words',
  C: 'Recall',
  D: 'Context',
  E: 'Listening',
  F: 'Production',
  G: 'Pronunciation',
  H: 'Reinforcement',
};

export interface AttemptFacts {
  kind: ExerciseKind;
  grade: Grade | 'self';
  hintsUsed: number;
  revealed?: boolean;
  selfRating?: Rating | null;
}

/**
 * Suggested FSRS rating from objective performance.
 * - wrong / revealed → Again; close (typo, accents, wrong form) or any hint → Hard;
 * - correct unaided → Good. Easy is only ever given by the learner (self-rating/adjust),
 *   because objective formats cannot distinguish "easy" from "good" reliably.
 */
export function suggestRating(f: AttemptFacts): Rating {
  if (KINDS[f.kind].response === 'self') return (f.selfRating ?? 3) as Rating;
  if (f.revealed || f.grade === 'incorrect') return 1;
  if (f.grade === 'close') return 2;
  if (f.hintsUsed > 0) return 2;
  return 3;
}

export function attemptScore(grade: Grade | 'self', selfRating?: number | null): number {
  if (grade === 'self') return selfRating == null ? 0.5 : selfRating === 1 ? 0 : selfRating === 2 ? 0.6 : 1;
  return grade === 'correct' ? 1 : grade === 'close' ? 0.5 : 0;
}

export function isSuccess(grade: Grade | 'self', selfRating?: number | null): boolean {
  if (grade === 'self') return (selfRating ?? 0) >= 2;
  return grade === 'correct';
}

/**
 * Initial FSRS rating for a newly introduced word from all of its in-session retrieval
 * attempts for one card (receptive or productive). Immediate recall right after exposure
 * is easy, so a single scheduling event summarises the whole learning sequence.
 */
export function aggregateInitialRating(
  attempts: Array<{ grade: Grade | 'self'; hintsUsed: number; selfRating?: number | null; at: number }>,
  opts: { claimedKnown?: boolean } = {},
): Rating | null {
  if (!attempts.length) return null;
  const sorted = [...attempts].sort((a, b) => a.at - b.at);
  const last = sorted[sorted.length - 1];
  const failures = sorted.filter((a) => !isSuccess(a.grade, a.selfRating) && a.grade !== 'close').length;
  const partial = sorted.filter((a) => a.grade === 'close' || (a.hintsUsed > 0 && isSuccess(a.grade, a.selfRating))).length;
  const lastOk = isSuccess(last.grade, last.selfRating) || last.grade === 'close';
  if (!lastOk) return 1;
  if (failures >= 2) return 1;
  if (failures === 1 || partial > 0) return 2;
  return opts.claimedKnown ? 4 : 3;
}

export interface RemediationExercise {
  id: string;
  kind: ExerciseKind;
  itemId: number;
  cardSkill: CardSkill | null;
  stage: Stage;
  priority: 'core' | 'optional';
  origin: 'remediation';
  parentId: string;
  seq: number;
}

const RECEPTIVE_FIX: ExerciseKind[] = ['meaning_choice', 'cloze_choice', 'listen_meaning', 'context_meaning', 'meaning_typed'];
const PRODUCTIVE_FIX: ExerciseKind[] = ['word_choice', 'cloze_typed', 'recall_typed', 'speak_flashcard'];

/**
 * Deterministic remediation: after a wrong or partially correct answer, revisit the same
 * word later in the session using a *different* exercise format (max two per word).
 * `pending` must be the session's pending exercises sorted by seq (excluding the current one).
 */
export function planRemediation(input: {
  exercise: { id: string; kind: ExerciseKind; itemId: number; seq: number };
  grade: Grade | 'self';
  selfRating?: number | null;
  remediationsSoFar: number;
  availableKinds: ExerciseKind[];
  pending: Array<{ seq: number }>;
}): RemediationExercise | null {
  const { exercise, grade } = input;
  const info = KINDS[exercise.kind];
  if (info.response === 'none' || exercise.kind === 'shadowing' || exercise.kind === 'sentence_create') return null;
  if (isSuccess(grade, input.selfRating)) return null;
  if (input.remediationsSoFar >= 2) return null;
  const family = info.card === 'productive' ? PRODUCTIVE_FIX : RECEPTIVE_FIX;
  const kind = family.find((k) => k !== exercise.kind && input.availableKinds.includes(k));
  if (!kind) return null;
  const p = input.pending;
  let seq: number;
  if (p.length >= 4) seq = (p[2].seq + p[3].seq) / 2;
  else if (p.length > 0) seq = p[p.length - 1].seq + 1;
  else seq = exercise.seq + 1;
  return {
    id: `${exercise.id}~r${input.remediationsSoFar + 1}`,
    kind,
    itemId: exercise.itemId,
    cardSkill: KINDS[kind].card,
    stage: 'H',
    priority: 'core',
    origin: 'remediation',
    parentId: exercise.id,
    seq,
  };
}

/** Feedback codes that indicate inflection difficulty (drives extra contextual grammar practice). */
export function isInflectionError(result: Pick<CheckResult, 'code'>): boolean {
  return result.code === 'wrong_form';
}

/** Knowledge levels (specification §3). Each is demonstrated by evidence, not exposure count. */
export interface MasteryInput {
  status: string;
  introducedAt: number | null;
  receptiveStability: number | null;
  productiveStability: number | null;
  receptiveState: number | null;
  evidence: Partial<Record<Skill, { delayedCorrect: number; correct: number; attempts: number }>>;
  audioAvailable: boolean;
}

export interface MasteryLevels {
  encountered: boolean;
  recognizesWritten: boolean;
  understandsListening: boolean | null; // null = no audio available to test
  retrievesFromEnglish: boolean;
  usesInSentence: boolean;
  productiveMastery: boolean;
  stage: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  label: string;
}

export const MATURE_STABILITY_DAYS = 21;

export function masteryLevels(m: MasteryInput): MasteryLevels {
  const ev = (s: Skill) => m.evidence[s]?.delayedCorrect ?? 0;
  const encountered = m.introducedAt != null || m.status === 'active';
  const recognizesWritten = ev('recognition') + ev('comprehension') > 0;
  const understandsListening = m.audioAvailable ? ev('listening') > 0 : null;
  const retrievesFromEnglish = ev('recall') > 0;
  const usesInSentence = ev('sentence') + ev('production') > 0;
  const productiveMastery = usesInSentence && retrievesFromEnglish && (m.productiveStability ?? 0) >= MATURE_STABILITY_DAYS;
  let stage: MasteryLevels['stage'] = 0;
  if (encountered) stage = 1;
  if (stage === 1 && recognizesWritten) stage = 2;
  if (stage === 2 && understandsListening !== false) stage = 3;
  if (stage === 3 && retrievesFromEnglish) stage = 4;
  if (stage === 4 && usesInSentence) stage = 5;
  if (stage === 5 && productiveMastery) stage = 6;
  const labels = ['New', 'Encountered', 'Recognizes in writing', 'Understands by ear', 'Retrieves from English', 'Uses in sentences', 'Productive mastery'];
  return { encountered, recognizesWritten, understandsListening, retrievesFromEnglish, usesInSentence, productiveMastery, stage, label: labels[stage] };
}
