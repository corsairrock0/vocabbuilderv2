// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
/**
 * Adaptive session planner (pure function; no database access).
 *
 * Builds one coherent session through stages A–H:
 *   A review due words (retrieval first)      B introduce new words
 *   C immediate recall                         D contextual application
 *   E listening recognition                    F productive recall
 *   G pronunciation shadowing                  H reinforcement (+ dynamic remediation)
 *
 * Review/new balance and exercise formats adapt to the due backlog, recent accuracy, the
 * gap between recognition and production, listening weakness and inflection errors.
 * No fixed allocation is claimed to be optimal; these are evidence-informed defaults.
 */
import { FEEDBACK_OVERHEAD_S, KINDS, type CardSkill, type ExerciseKind, type Stage } from '../../shared/exercises.ts';
import { inflectionSummary, type Paradigm } from '../../shared/paradigms.ts';
import { seededRandom } from '../../shared/fsrs.ts';
import type { LanguageCode } from '../../shared/languages.ts';
import type { LanguageSettings } from '../../shared/settings.ts';
import type { ExercisePayload, ItemResource, PlanMeta, SessionConfig } from '../../shared/types.ts';
import { planPractice, WRITING_SECONDS, writingCount } from '../../shared/mix.ts';
import { buildPayload, shuffle, type BuildContext, type PoolEntry } from './payloads.ts';
import type { ExactLookup } from './grammar.ts';

/** Server-side view of an item: the client resource plus the word's table (kept out of session payloads). */
export type StudyEntry = Omit<ItemResource, 'variants'> & { paradigm?: Paradigm | null };

export interface DueCardInfo {
  cardId: number;
  itemId: number;
  skill: CardSkill;
  state: number;
  stability: number;
  difficulty: number;
  due: number;
  lastReview: number | null;
  lapses: number;
  reps: number;
  retrievability: number;
  isDifficult: boolean;
}

export interface Performance {
  attemptsLast14d: number;
  reviewAccuracy: number | null;
  recognition: number | null;
  listening: number | null;
  recall: number | null;
  production: number | null;
  inflectionErrorRate: number | null;
  latencyMsByKind: Partial<Record<ExerciseKind, number>>;
  /**
   * How much longer than the time model this learner's sessions take in real life (1.8.4; sessions.ts sessionPace):
   * a session of m minutes is planned with m / pace minutes of model time. 1 when not given.
   */
  pace?: number;
}

export interface PlannerInput {
  sessionId: string;
  now: number;
  language: LanguageCode;
  config: SessionConfig;
  settings: LanguageSettings;
  forvoEnabled: boolean;
  due: DueCardInfo[];
  /** Items whose receptive memory is established but whose productive card is still new. */
  productiveUnlock: number[];
  /** New items in preferred order (previously introduced-but-unscheduled first). */
  newCandidates: number[];
  entries: Map<number, StudyEntry>;
  pool: PoolEntry[];
  performance: Performance;
  /** New words already introduced today (counts toward the daily target). */
  introducedToday: number;
  /** The annotated cells of example sentences (data/grammar/), carried by sentence exercises as `exact`. */
  exact?: ExactLookup;
  /** The language has Writing sentences left to write (Comprehensive sessions plan some). */
  writing?: boolean;
}

export interface PlannedExercise {
  id: string;
  seq: number;
  stage: Stage;
  kind: ExerciseKind;
  itemId: number;
  cardSkill: CardSkill | null;
  priority: 'core' | 'optional';
  payload: ExercisePayload;
}

export interface PlanResult {
  exercises: PlannedExercise[];
  meta: PlanMeta;
  items: Map<number, ItemResource>;
}

const REMEDIATION_KINDS: ExerciseKind[] = [
  'meaning_choice', 'cloze_choice', 'listen_meaning', 'context_meaning', 'meaning_typed', 'word_choice', 'cloze_typed', 'recall_typed', 'speak_flashcard',
];

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function weightedPick<T extends string>(weights: Partial<Record<T, number>>, rand: () => number): T | null {
  const entries = Object.entries(weights).filter(([, w]) => (w as number) > 0) as Array<[T, number]>;
  const total = entries.reduce((s, [, w]) => s + w, 0);
  if (!total) return null;
  let x = rand() * total;
  for (const [k, w] of entries) {
    x -= w;
    if (x <= 0) return k;
  }
  return entries[entries.length - 1][0];
}

export function planSession(input: PlannerInput): PlanResult {
  const { config, settings, performance: perf } = input;
  const rand = seededRandom(hashString(input.sessionId));
  const totalSeconds = Math.max(60, Math.round(config.minutes * 60));
  // Real sessions take longer than the time model (feedback, explanations, tables, typing): plan the model time that
  // fits the minutes in real life.
  const pace = Math.min(3, Math.max(1, Number(perf.pace) || 1));
  const modelSeconds = Math.max(60, Math.round(totalSeconds / pace));
  // Comprehensive sessions leave about a third of the time for the practice rounds the app runs in between, and the time
  // of their Writing sentences besides.
  const writingSeconds = config.mode === 'comprehensive' && input.writing ? writingCount(config.minutes / pace) * WRITING_SECONDS : 0;
  const budget = config.mode === 'comprehensive' ? Math.max(60, Math.round(modelSeconds * 0.65) - writingSeconds) : modelSeconds;
  const adaptations: string[] = [];
  const secondsFor = (k: ExerciseKind) => (perf.latencyMsByKind[k] ?? KINDS[k].seconds * 1000) / 1000 + (k === 'intro' ? 0 : FEEDBACK_OVERHEAD_S);
  const audioOk = (e: StudyEntry) => (input.forvoEnabled && e.audio.forvo) || e.audio.user || settings.ttsFallback;
  const ctxFor = (e: StudyEntry): BuildContext => ({ rand, pool: input.pool, language: input.language, audioOk: audioOk(e), exact: input.exact });
  const payloadCache = new Map<string, ExercisePayload | null>();
  const build = (kind: ExerciseKind, e: StudyEntry) => {
    const key = `${e.itemId}:${kind}`;
    if (!payloadCache.has(key)) payloadCache.set(key, buildPayload(kind, e, ctxFor(e)));
    return payloadCache.get(key) ?? null;
  };

  const focus = config.focus;
  const difficulty = config.difficulty;
  const listeningWeak = perf.listening != null && perf.recognition != null && perf.listening < perf.recognition - 0.1;
  const productionGap = perf.production != null && perf.recognition != null && perf.production < perf.recognition - 0.15;
  const inflectionWeak = (perf.inflectionErrorRate ?? 0) > 0.25;
  if (listeningWeak) adaptations.push('Listening accuracy trails reading — extra listening practice.');
  if (productionGap) adaptations.push('You recognise more than you can produce — extra production practice.');
  if (inflectionWeak) adaptations.push('Inflected forms are causing errors — more contextual grammar practice.');
  if (focus !== 'balanced') adaptations.push(`Focus: ${focus}.`);

  // ------------------------------------------------------------ A: due reviews
  const bySibling = new Map<number, DueCardInfo>();
  for (const c of input.due) {
    if (!input.entries.has(c.itemId)) continue;
    const prev = bySibling.get(c.itemId);
    // Siblings (receptive + productive of the same word) never both on one day: review the weaker one.
    if (!prev || c.retrievability < prev.retrievability) bySibling.set(c.itemId, c);
  }
  let dueCards = [...bySibling.values()];
  const score = (c: DueCardInfo) => {
    const overdue = Math.max(0, (input.now - c.due) / 86_400_000) / Math.max(1, c.stability);
    return (1 - c.retrievability) * 2 + (c.isDifficult || c.lapses >= 3 ? 0.6 : 0) + Math.min(overdue, 2) * 0.2 + (productionGap && c.skill === 'productive' ? 0.3 : 0);
  };
  if (settings.reviewPriority === 'due_first') dueCards.sort((a, b) => a.due - b.due);
  else if (settings.reviewPriority === 'difficult_first') dueCards.sort((a, b) => b.difficulty - a.difficulty || score(b) - score(a));
  else dueCards.sort((a, b) => score(b) - score(a));

  const receptiveKindFor = (c: DueCardInfo, e: StudyEntry): ExerciseKind => {
    const w: Partial<Record<ExerciseKind, number>> = { meaning_choice: 3, cloze_choice: 2, context_meaning: 1, meaning_typed: 1.2 };
    if (audioOk(e)) Object.assign(w, { listen_meaning: 1.6, listen_choice: 1, dictation: difficulty === 'easy' ? 0 : 0.8 });
    if (e.imageUrl) w.picture_choice = 0.8;
    const choice: ExerciseKind[] = ['meaning_choice', 'cloze_choice', 'context_meaning', 'listen_meaning', 'listen_choice', 'picture_choice'];
    const typed: ExerciseKind[] = ['meaning_typed', 'dictation'];
    const mult = (ks: ExerciseKind[], m: number) => ks.forEach((k) => w[k] != null && (w[k] = w[k]! * m));
    if (c.stability < 3) {
      mult(choice, 1.5);
      mult(typed, 0.5);
    } else if (c.stability > 21) {
      mult(['meaning_typed', 'dictation', 'listen_meaning', 'listen_choice'], 1.6);
      mult(['meaning_choice'], 0.6);
    }
    if (focus === 'listening' || listeningWeak) mult(['listen_meaning', 'listen_choice', 'dictation'], focus === 'listening' ? 2.5 : 1.8);
    if (focus === 'reading') mult(['cloze_choice', 'context_meaning'], 2);
    if (difficulty === 'easy') {
      mult(choice, 1.5);
      mult(typed, 0.4);
    }
    if (difficulty === 'challenging') {
      mult(typed, 2);
      mult(['meaning_choice'], 0.6);
    }
    for (const k of Object.keys(w) as ExerciseKind[]) if (!build(k, e)) delete w[k];
    return weightedPick(w, rand) ?? 'speak_flashcard';
  };

  const productiveKindFor = (c: DueCardInfo | null, e: StudyEntry): ExerciseKind => {
    const w: Partial<Record<ExerciseKind, number>> = { recall_typed: 3, cloze_typed: 2, form_typed: 0.8, speak_flashcard: 0.6 };
    if (focus === 'speaking') w.speak_flashcard = 3;
    if (focus === 'writing') {
      w.recall_typed! *= 1.5;
      w.cloze_typed! *= 1.5;
    }
    if (inflectionWeak) {
      w.cloze_typed! *= 2;
      w.form_typed! *= 2;
    }
    if (difficulty === 'easy') w.speak_flashcard = (w.speak_flashcard ?? 0) + 1;
    if (c && c.stability < 2) w.form_typed = 0;
    for (const k of Object.keys(w) as ExerciseKind[]) if (!build(k, e)) delete w[k];
    return weightedPick(w, rand) ?? 'speak_flashcard';
  };

  const plannedReviews: Array<{ card: DueCardInfo; kind: ExerciseKind; cost: number }> = [];
  const reviewShare = config.mode === 'review' ? 1 : config.newWords > 0 ? 0.75 : 1;
  let reviewSeconds = 0;
  for (const c of dueCards) {
    const e = input.entries.get(c.itemId)!;
    const kind = c.skill === 'receptive' ? receptiveKindFor(c, e) : productiveKindFor(c, e);
    const cost = secondsFor(kind) + (1 - c.retrievability) * 12;
    if (reviewSeconds + cost > budget * reviewShare && plannedReviews.length > 0) break;
    plannedReviews.push({ card: c, kind, cost });
    reviewSeconds += cost;
  }
  const backlog = dueCards.length - plannedReviews.length;
  if (backlog > 0) adaptations.push(`${backlog} due review(s) did not fit and stay due for the next session.`);

  // ------------------------------------------------------------ B–H: new words
  const perNewCost =
    secondsFor('intro') + secondsFor('meaning_choice') + secondsFor('word_choice') + secondsFor('cloze_choice') + secondsFor('recall_typed') + 0.6 * secondsFor('listen_meaning') + 0.3 * 12;
  let newCount = 0;
  if (config.mode !== 'review') {
    let n = config.newWords;
    const reviewLoad = reviewSeconds / budget;
    if (dueCards.length > 0 && reviewLoad > 0.6) {
      n = Math.round(n * 0.3);
      adaptations.push('Many reviews are due — fewer new words today to protect retention.');
    } else if (dueCards.length > 0 && reviewLoad > 0.4) {
      n = Math.round(n * 0.6);
      adaptations.push('Review load is high — slightly fewer new words.');
    }
    if (perf.reviewAccuracy != null && perf.attemptsLast14d >= 20) {
      if (perf.reviewAccuracy < 0.7) {
        n = Math.round(n * 0.4);
        adaptations.push('Recent recall accuracy is low — consolidating before adding much new vocabulary.');
      } else if (perf.reviewAccuracy < 0.8) {
        n = Math.round(n * 0.7);
        adaptations.push('Recall accuracy dipped — introducing fewer new words.');
      } else if (perf.reviewAccuracy > 0.92 && reviewLoad < 0.3 && n > 0) {
        n = Math.min(Math.round(n * 1.2), config.newWords + 3);
        adaptations.push('Strong recall — a few extra new words.');
      }
    }
    const fit = Math.floor(Math.max(0, budget - reviewSeconds) / perNewCost);
    if (fit < n) adaptations.push(`Time allows ${fit} new word(s) in ${config.minutes} minutes.`);
    n = Math.min(n, fit);
    newCount = Math.max(0, Math.min(n, input.newCandidates.length));
  }
  const newItems = input.newCandidates.slice(0, newCount).map((id) => input.entries.get(id)!).filter(Boolean);
  const unlockItems = config.mode === 'review' ? [] : input.productiveUnlock.map((id) => input.entries.get(id)!).filter(Boolean).slice(0, productionGap ? 6 : 3);

  // ------------------------------------------------------------ assemble
  const seq: Array<Omit<PlannedExercise, 'id' | 'seq'>> = [];
  const push = (stage: Stage, kind: ExerciseKind, e: StudyEntry, priority: 'core' | 'optional', cardSkill?: CardSkill | null) => {
    const payload = build(kind, e);
    if (!payload) return false;
    seq.push({ stage, kind, itemId: e.itemId, cardSkill: cardSkill === undefined ? KINDS[kind].card : cardSkill, priority, payload });
    return true;
  };
  const reviewExercise = (r: (typeof plannedReviews)[number]) => {
    const e = input.entries.get(r.card.itemId)!;
    if (!push('A', r.kind, e, 'core', r.card.skill)) push('A', 'speak_flashcard', e, 'core', r.card.skill);
  };

  const firstReviews = plannedReviews.slice(0, Math.ceil(plannedReviews.length * (newItems.length ? 0.6 : 1)));
  const laterReviews = plannedReviews.slice(firstReviews.length);
  shuffle(firstReviews, rand).forEach(reviewExercise);

  const batchSize = difficulty === 'challenging' ? 4 : 3;
  const batches: StudyEntry[][] = [];
  for (let i = 0; i < newItems.length; i += batchSize) batches.push(newItems.slice(i, i + batchSize));
  const interleave = [...laterReviews];
  for (const batch of batches) {
    for (const e of batch) push('B', 'intro', e, 'core', null);
    for (const e of shuffle(batch, rand)) push('C', 'meaning_choice', e, 'core');
    for (const e of shuffle(batch, rand)) push('C', 'word_choice', e, 'core');
    for (let i = 0; i < 2 && interleave.length; i++) reviewExercise(interleave.shift()!);
    for (const e of shuffle(batch, rand)) {
      // cloze_choice automatically tests the inflected form when the word has stored forms.
      if (!push('D', 'cloze_choice', e, focus === 'reading' || inflectionWeak ? 'core' : 'optional')) {
        if (!push('D', 'context_meaning', e, 'optional')) push('D', 'meaning_typed', e, 'optional');
      }
    }
    for (const e of shuffle(batch, rand)) {
      if (!audioOk(e)) continue;
      const kind: ExerciseKind = rand() < 0.5 ? 'listen_meaning' : 'listen_choice';
      if (!push('E', kind, e, focus === 'listening' || listeningWeak ? 'core' : 'optional')) push('E', 'listen_meaning', e, 'optional');
    }
    for (let i = 0; i < 2 && interleave.length; i++) reviewExercise(interleave.shift()!);
  }
  interleave.forEach(reviewExercise);

  // F: productive recall, spaced after the other activities.
  for (const e of shuffle(newItems, rand)) {
    push('F', 'recall_typed', e, 'core') || push('F', 'speak_flashcard', e, 'core');
    if (settings.repetitions !== 'fewer' && (focus === 'writing' || inflectionWeak || settings.repetitions === 'more')) push('F', 'cloze_typed', e, 'optional');
  }
  for (const e of unlockItems) {
    push('F', 'word_choice', e, 'core');
    push('F', 'recall_typed', e, 'core') || push('F', 'speak_flashcard', e, 'core');
  }
  if (settings.includeSentenceCreation || focus === 'writing') {
    for (const e of newItems.slice(0, 2)) push('F', 'sentence_create', e, 'optional');
  }

  // G: pronunciation shadowing (practice; never auto-scored).
  if (settings.includeShadowing) {
    const withAudio = [...newItems, ...unlockItems].filter(audioOk).slice(0, focus === 'speaking' ? 5 : 3);
    for (const e of withAudio) push('G', 'shadowing', e, focus === 'speaking' ? 'core' : 'optional');
  }

  // H: reinforcement with a different prompt than stage F.
  if (settings.repetitions !== 'fewer') {
    for (const e of shuffle(newItems, rand)) {
      if (!push('H', 'cloze_typed', e, 'optional')) push('H', settings.repetitions === 'more' ? 'meaning_typed' : 'speak_flashcard', e, 'optional');
    }
  }

  // Trim optional exercises from the end if the estimate exceeds the budget.
  const estimate = () => seq.reduce((s, x) => s + secondsFor(x.kind), 0);
  let total = estimate();
  for (let i = seq.length - 1; i >= 0 && total > budget * 1.1; i--) {
    if (seq[i].priority === 'optional') {
      total -= secondsFor(seq[i].kind);
      seq.splice(i, 1);
    }
  }

  const exercises: PlannedExercise[] = seq.map((x, i) => ({ ...x, id: `${input.sessionId}:${i + 1}`, seq: i + 1 }));

  // Item resources with remediation variants.
  const items = new Map<number, ItemResource>();
  for (const x of exercises) {
    if (items.has(x.itemId)) continue;
    const e = input.entries.get(x.itemId)!;
    const variants: Partial<Record<ExerciseKind, ExercisePayload>> = {};
    for (const k of REMEDIATION_KINDS) {
      const p = build(k, e);
      if (p) variants[k] = p;
    }
    const { paradigm, ...resource } = e;
    items.set(x.itemId, { ...resource, paradigm: paradigm ?? null, inflection: inflectionSummary(input.language, paradigm ?? null), variants });
  }

  const stages: Partial<Record<Stage, number>> = {};
  for (const x of exercises) stages[x.stage] = (stages[x.stage] ?? 0) + 1;
  const meta: PlanMeta = {
    budgetSeconds: totalSeconds,
    estimatedSeconds: Math.round(estimate()),
    pace: Math.round(pace * 100) / 100,
    dueAvailable: dueCards.length,
    reviewsPlanned: plannedReviews.length,
    newRequested: config.newWords,
    newPlanned: newItems.length,
    adaptations,
    stages,
    audioAvailable: [...items.values()].some((e) => audioOk(e)),
    // The practice of a Comprehensive session is planned now, with its exercises, so every device shows one mix.
    ...(config.mode === 'comprehensive' ? { practice: planPractice({ language: input.language, minutes: config.minutes / pace, realMinutes: config.minutes, exercises: exercises.length, writing: !!input.writing }) } : {}),
  };
  return { exercises, meta, items };
}
