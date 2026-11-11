// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Adaptive session planner (pure function) with synthetic vocabulary and learner states.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planSession, type DueCardInfo, type Performance, type PlannerInput, type StudyEntry } from '../../server/learning/planner.ts';
import { KINDS } from '../../shared/exercises.ts';
import { languageDefaults } from '../../shared/settings.ts';
import type { SessionConfig } from '../../shared/types.ts';

const NOW = Date.parse('2026-11-05T10:00:00Z');
const WORDS = ['casa', 'perro', 'gato', 'libro', 'mesa', 'silla', 'agua', 'pan', 'leche', 'calle', 'ciudad', 'tienda', 'dinero', 'trabajo', 'amigo', 'familia',
  'madre', 'padre', 'hermano', 'carro', 'bus', 'tren', 'playa', 'sol', 'luna', 'cielo', 'mar', 'río', 'montaña', 'flor', 'árbol', 'fruta', 'manzana', 'arroz',
  'carne', 'pollo', 'pescado', 'queso', 'huevo', 'sal', 'azúcar', 'café', 'té', 'jugo', 'vino', 'cerveza', 'mañana', 'noche', 'semana', 'mes', 'año', 'hora',
  'minuto', 'día', 'hoy', 'ayer', 'cama', 'puerta', 'ventana', 'cocina', 'baño', 'jardín', 'escuela', 'hospital', 'banco', 'iglesia', 'parque', 'museo',
  'teatro', 'cine', 'hotel', 'restaurante', 'mercado', 'farmacia', 'oficina', 'computador', 'teléfono', 'camisa', 'zapato', 'sombrero', 'reloj', 'llave',
  'bolsa', 'papel', 'lápiz', 'cuaderno', 'ropa', 'color', 'rojo', 'azul', 'verde', 'blanco', 'negro', 'grande', 'pequeño', 'nuevo', 'viejo', 'bueno', 'malo',
  'feliz', 'triste', 'rápido', 'lento', 'fácil', 'difícil', 'caliente', 'frío', 'limpio', 'sucio', 'barato', 'caro', 'cerca', 'lejos', 'siempre', 'nunca',
  'ahora', 'después', 'antes', 'mucho', 'poco', 'bien', 'mal', 'aquí', 'allí', 'también', 'tampoco', 'quizás', 'todavía', 'ya', 'pronto', 'tarde'];

function entry(i: number, opts: { audio?: boolean; isNew?: boolean } = {}): StudyEntry {
  const lemma = WORDS[i % WORDS.length] + (i >= WORDS.length ? String(Math.floor(i / WORDS.length)) : '');
  const text = `Mira, ${lemma} aquí.`;
  return {
    itemId: i + 1,
    entryId: i + 1,
    lemma,
    display: lemma,
    pos: 'noun',
    gender: 'm',
    aspect: null,
    aspectPair: null,
    pronunciation: null,
    senses: [{ gloss: `meaning number ${i + 1}`, translations: [`meaning number ${i + 1}`], definition: null, note: null }],
    forms: [{ form: `${lemma}s`, display: null, tags: ['plural'] }],
    examples: [{ text, display: null, translation: `Look, meaning ${i + 1} here.`, target: lemma, start: 6, end: 6 + lemma.length }],
    expressions: [],
    grammarNotes: null,
    regionalNote: null,
    register: null,
    tags: [],
    frequencyRank: i + 1,
    curatedOrder: null,
    imageUrl: null,
    isNew: opts.isNew ?? true,
    audio: { forvo: false, user: opts.audio ?? false },
  };
}

function due(itemId: number, skill: 'receptive' | 'productive', o: Partial<DueCardInfo> = {}): DueCardInfo {
  return {
    cardId: itemId * 10 + (skill === 'receptive' ? 1 : 2),
    itemId,
    skill,
    state: 2,
    stability: 8,
    difficulty: 5,
    due: NOW - 3600_000,
    lastReview: NOW - 8 * 86_400_000,
    lapses: 0,
    reps: 3,
    retrievability: 0.88,
    isDifficult: false,
    ...o,
  };
}

const PERF: Performance = { attemptsLast14d: 0, reviewAccuracy: null, recognition: null, listening: null, recall: null, production: null, inflectionErrorRate: null, latencyMsByKind: {} };

function input(o: {
  sessionId?: string;
  config?: Partial<SessionConfig>;
  due?: DueCardInfo[];
  newIds?: number[];
  unlock?: number[];
  perf?: Partial<Performance>;
  entries?: StudyEntry[];
  settings?: Partial<ReturnType<typeof languageDefaults>>;
}): PlannerInput {
  const entries = o.entries ?? Array.from({ length: 160 }, (_, i) => entry(i));
  const map = new Map(entries.map((e) => [e.itemId, e]));
  return {
    sessionId: o.sessionId ?? '11111111-2222-3333-4444-555555555555',
    now: NOW,
    language: 'es',
    config: { language: 'es', minutes: 30, newWords: 10, difficulty: 'normal', focus: 'balanced', mode: 'mixed', frequencyMin: null, frequencyMax: null, tag: null, quick: false, ...o.config },
    settings: { ...languageDefaults('es'), ...o.settings },
    forvoEnabled: false,
    due: o.due ?? [],
    productiveUnlock: o.unlock ?? [],
    newCandidates: o.newIds ?? Array.from({ length: 20 }, (_, i) => 101 + i),
    entries: map,
    pool: entries.map((e) => ({ entryId: e.entryId, lemma: e.lemma, display: e.display, pos: e.pos, gloss: e.senses[0].gloss })),
    performance: { ...PERF, ...o.perf },
    introducedToday: 0,
  };
}

const LISTENING = new Set(['listen_meaning', 'listen_choice', 'dictation']);

test('baseline: requested new words fit in a 30-minute session with all stages', () => {
  const plan = planSession(input({}));
  assert.equal(plan.meta.newPlanned, 10);
  const stages = new Set(plan.exercises.map((e) => e.stage));
  for (const s of ['B', 'C', 'D', 'F', 'H']) assert.ok(stages.has(s as any), `stage ${s}`);
  assert.equal(plan.exercises.filter((e) => e.kind === 'intro').length, 10);
  // Exercise ids and seqs are unique and ordered.
  assert.equal(new Set(plan.exercises.map((e) => e.id)).size, plan.exercises.length);
  plan.exercises.forEach((e, i) => assert.equal(e.seq, i + 1));
  // Intro precedes every other exercise of the same word.
  for (const e of plan.exercises.filter((x) => x.kind === 'intro')) {
    const first = plan.exercises.find((x) => x.itemId === e.itemId)!;
    assert.equal(first.kind, 'intro');
  }
});

test('many due reviews reduce the number of new words (retention first)', () => {
  const dueCards = Array.from({ length: 90 }, (_, i) => due(i + 1, 'receptive'));
  const plan = planSession(input({ due: dueCards }));
  assert.ok(plan.meta.newPlanned <= 3, `newPlanned=${plan.meta.newPlanned}`);
  assert.ok(plan.meta.reviewsPlanned > 40);
  assert.ok(plan.meta.adaptations.some((a) => /reviews are due|Review load/.test(a)), plan.meta.adaptations.join(' | '));
});

test('low recent recall accuracy reduces new words; strong accuracy allows slightly more', () => {
  const low = planSession(input({ perf: { attemptsLast14d: 60, reviewAccuracy: 0.6 } }));
  assert.equal(low.meta.newPlanned, 4);
  assert.ok(low.meta.adaptations.some((a) => /accuracy is low/.test(a)));
  const dip = planSession(input({ perf: { attemptsLast14d: 60, reviewAccuracy: 0.75 } }));
  assert.equal(dip.meta.newPlanned, 7);
  const high = planSession(input({ perf: { attemptsLast14d: 60, reviewAccuracy: 0.96 } }));
  assert.equal(high.meta.newPlanned, 12);
  assert.ok(high.meta.newPlanned <= 10 + 3, 'never more than three extra words');
  // Too little evidence: no accuracy-based adjustment.
  assert.equal(planSession(input({ perf: { attemptsLast14d: 5, reviewAccuracy: 0.5 } })).meta.newPlanned, 10);
});

test('review-only mode introduces no new words', () => {
  const plan = planSession(input({ config: { mode: 'review' }, due: [due(1, 'receptive'), due(2, 'productive'), due(3, 'receptive')] }));
  assert.equal(plan.meta.newPlanned, 0);
  assert.equal(plan.exercises.filter((e) => e.kind === 'intro').length, 0);
  assert.ok(plan.exercises.every((e) => e.stage === 'A'));
  assert.equal(plan.exercises.length, 3);
});

test('receptive and productive cards of the same word are never both reviewed on one day', () => {
  const dueCards = [due(1, 'receptive', { retrievability: 0.9 }), due(1, 'productive', { retrievability: 0.7 }), due(2, 'receptive'), due(2, 'productive', { retrievability: 0.95 })];
  const plan = planSession(input({ config: { mode: 'review' }, due: dueCards }));
  const reviews = plan.exercises.filter((e) => e.stage === 'A');
  assert.equal(reviews.length, 2);
  assert.equal(reviews.find((e) => e.itemId === 1)!.cardSkill, 'productive', 'the weaker sibling is reviewed');
  assert.equal(reviews.find((e) => e.itemId === 2)!.cardSkill, 'receptive');
});

test('review exercise formats match the card being scheduled', () => {
  const dueCards = Array.from({ length: 30 }, (_, i) => due(i + 1, i % 2 ? 'productive' : 'receptive'));
  const plan = planSession(input({ config: { mode: 'review', minutes: 60 }, due: dueCards }));
  for (const e of plan.exercises) {
    const card = dueCards.find((c) => c.itemId === e.itemId)!;
    assert.equal(e.cardSkill, card.skill);
    if (e.kind !== 'speak_flashcard') assert.equal(KINDS[e.kind].card, card.skill, `${e.kind} for ${card.skill}`);
    assert.equal(KINDS[e.kind].assisted, false, 'assisted formats are never used to schedule a review');
  }
});

test('weak listening increases listening practice when audio exists', () => {
  const entries = Array.from({ length: 160 }, (_, i) => entry(i, { audio: true }));
  const dueCards = Array.from({ length: 120 }, (_, i) => due(i + 1, 'receptive'));
  const count = (p: ReturnType<typeof planSession>) => p.exercises.filter((e) => e.stage === 'A' && LISTENING.has(e.kind)).length;
  const base = planSession(input({ entries, due: dueCards, config: { minutes: 120, newWords: 0 } }));
  const weak = planSession(input({ entries, due: dueCards, config: { minutes: 120, newWords: 0 }, perf: { recognition: 0.9, listening: 0.55 } }));
  assert.ok(count(weak) > count(base), `weak=${count(weak)} base=${count(base)}`);
  assert.ok(weak.meta.adaptations.some((a) => /Listening/.test(a)));
  // New words get a core (not optional) listening exercise when listening is weak.
  const withNew = planSession(input({ entries, perf: { recognition: 0.9, listening: 0.55 } }));
  const listen = withNew.exercises.filter((e) => e.stage === 'E');
  assert.ok(listen.length > 0);
  assert.ok(listen.every((e) => e.priority === 'core'));
  // Without any audio source, no listening exercises are planned at all.
  const noAudio = planSession(input({ perf: { recognition: 0.9, listening: 0.55 } }));
  assert.equal(noAudio.exercises.filter((e) => LISTENING.has(e.kind) || e.kind === 'shadowing').length, 0);
  assert.equal(noAudio.meta.audioAvailable, false);
});

test('a recognition–production gap adds production practice', () => {
  const entries = Array.from({ length: 160 }, (_, i) => entry(i, { isNew: false }));
  const unlock = [21, 22, 23, 24, 25, 26, 27, 28];
  const base = planSession(input({ entries, unlock }));
  const gap = planSession(input({ entries, unlock, perf: { recognition: 0.92, production: 0.6 } }));
  const unlocked = (p: ReturnType<typeof planSession>) => new Set(p.exercises.filter((e) => e.stage === 'F' && unlock.includes(e.itemId)).map((e) => e.itemId)).size;
  assert.equal(unlocked(base), 3);
  assert.equal(unlocked(gap), 6);
  assert.ok(gap.meta.adaptations.some((a) => /produce/.test(a)));
  // Unlocked words practice production with a scaffold first, then typed recall.
  const first = gap.exercises.filter((e) => e.itemId === 21).map((e) => e.kind);
  assert.deepEqual(first.slice(0, 2), ['word_choice', 'recall_typed']);
});

test('the time budget limits new words and trims optional work first', () => {
  const short = planSession(input({ config: { minutes: 5 } }));
  assert.ok(short.meta.newPlanned <= 3, `newPlanned=${short.meta.newPlanned}`);
  const optional = (p: ReturnType<typeof planSession>) => p.exercises.filter((e) => e.priority === 'optional').length;
  if (short.meta.estimatedSeconds > short.meta.budgetSeconds * 1.1) assert.equal(optional(short), 0, 'over budget only if nothing optional is left');
  const long = planSession(input({ config: { minutes: 60, newWords: 3 } }));
  assert.ok(optional(long) >= optional(short));
  // Every planned word keeps its core sequence.
  for (const id of new Set(short.exercises.filter((e) => e.kind === 'intro').map((e) => e.itemId))) {
    const kinds = short.exercises.filter((e) => e.itemId === id).map((e) => e.kind);
    assert.ok(kinds.includes('meaning_choice') && kinds.includes('recall_typed'), kinds.join(','));
  }
});

test('planning is deterministic for a session id and varies between sessions', () => {
  const a = planSession(input({}));
  const b = planSession(input({}));
  assert.deepEqual(a.exercises, b.exercises);
  assert.deepEqual([...a.items.entries()], [...b.items.entries()]);
  const c = planSession(input({ sessionId: '99999999-8888-7777-6666-555555555555' }));
  assert.notDeepEqual(
    a.exercises.map((e) => e.payload),
    c.exercises.map((e) => e.payload),
  );
});

test('every planned item carries remediation variants that never repeat the failed format', () => {
  const plan = planSession(input({}));
  for (const [id, item] of plan.items) {
    const kinds = Object.keys(item.variants);
    assert.ok(kinds.length >= 3, `item ${id} has ${kinds.length} variants`);
    for (const k of kinds) assert.equal((item.variants as any)[k].kind, k);
  }
});

test('multiple-choice options always contain exactly one correct answer and no duplicates', () => {
  const plan = planSession(input({}));
  for (const e of plan.exercises) {
    const p = e.payload as any;
    if (!p.options) continue;
    const texts = p.options.map((o: any) => o.text.toLowerCase());
    assert.equal(new Set(texts).size, texts.length, `${e.kind} duplicates: ${texts}`);
    assert.equal(p.options.filter((o: any) => o.id === p.correctId).length, 1);
    assert.ok(p.options.length >= 2);
  }
});

test('focus and difficulty settings change the format mix', () => {
  const entries = Array.from({ length: 160 }, (_, i) => entry(i, { audio: true }));
  const dueCards = Array.from({ length: 80 }, (_, i) => due(i + 1, 'receptive'));
  const typed = (p: ReturnType<typeof planSession>) => p.exercises.filter((e) => e.stage === 'A' && KINDS[e.kind].response === 'typed').length;
  const easy = planSession(input({ entries, due: dueCards, config: { minutes: 90, newWords: 0, difficulty: 'easy' } }));
  const hard = planSession(input({ entries, due: dueCards, config: { minutes: 90, newWords: 0, difficulty: 'challenging' } }));
  assert.ok(typed(hard) > typed(easy), `challenging=${typed(hard)} easy=${typed(easy)}`);
  const listening = planSession(input({ entries, due: dueCards, config: { minutes: 90, newWords: 0, focus: 'listening' } }));
  const listenCount = listening.exercises.filter((e) => LISTENING.has(e.kind)).length;
  assert.ok(listenCount > dueCards.length * 0.4, `listening focus: ${listenCount}`);
});

test('when the estimate exceeds the budget, optional exercises are trimmed from the end first', () => {
  // Make optional reinforcement extremely slow for this learner so the plan must be trimmed.
  const plan = planSession(input({ config: { minutes: 15, newWords: 4 }, perf: { latencyMsByKind: { cloze_typed: 240_000, shadowing: 240_000, cloze_choice: 120_000 } } }));
  const untrimmed = planSession(input({ config: { minutes: 15, newWords: 4 } }));
  assert.ok(plan.exercises.length < untrimmed.exercises.length);
  const slowOptional = plan.exercises.filter((e) => e.priority === 'optional' && ['cloze_typed', 'shadowing', 'cloze_choice'].includes(e.kind));
  assert.ok(plan.meta.estimatedSeconds <= plan.meta.budgetSeconds * 1.1 || slowOptional.length === 0, `estimate ${plan.meta.estimatedSeconds}s for ${plan.meta.budgetSeconds}s`);
  // Core work for every introduced word is never trimmed.
  for (const id of new Set(plan.exercises.filter((e) => e.kind === 'intro').map((e) => e.itemId))) {
    const core = plan.exercises.filter((e) => e.itemId === id && e.priority === 'core').map((e) => e.kind);
    assert.ok(core.includes('meaning_choice') && core.includes('word_choice') && core.includes('recall_typed'), core.join(','));
  }
});
