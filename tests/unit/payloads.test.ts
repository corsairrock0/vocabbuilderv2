// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Exercise payload helpers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchCase } from '../../server/learning/payloads.ts';

test('cloze options copy the capitalisation of the blank, so a sentence-initial answer is not given away', () => {
  assert.equal(matchCase('привет', 'Здравствуйте', 'ru'), 'Привет');
  assert.equal(matchCase('спасибо', 'здравствуйте', 'ru'), 'спасибо');
  assert.equal(matchCase('ćma', 'Dzień', 'pl'), 'Ćma');
  assert.equal(matchCase('ăn', 'Uống', 'vi'), 'Ăn');
  assert.equal(matchCase('їжа', 'ВОДА', 'uk'), 'ЇЖА');
  assert.equal(matchCase('agua', '¿Qué', 'es'), 'agua', 'leading punctuation is not a capital letter');
  assert.equal(matchCase('', 'Abc', 'es'), '');
});

// ------------------------------------------------------------------ sentences and their meanings

import { buildPayload, meaningOf, type BuildContext } from '../../server/learning/payloads.ts';
import type { ItemResource } from '../../shared/types.ts';

function entry(over: Partial<ItemResource> = {}): Omit<ItemResource, 'variants'> {
  return {
    itemId: 1,
    entryId: 1,
    lemma: 'embargo',
    display: 'embargo',
    pos: 'noun',
    gender: 'm',
    aspect: null,
    aspectPair: null,
    pronunciation: null,
    senses: [
      { gloss: 'used in «sin embargo» (however)', translations: ['however'], definition: null, note: null },
      { gloss: 'trade embargo', translations: ['embargo'], definition: null, note: 'now usually written embargo' },
    ],
    forms: [{ form: 'embargos', display: null, tags: ['plural'] }],
    examples: [
      { text: 'El país vive bajo un embargo comercial.', display: null, translation: 'The country lives under a trade embargo.', target: 'embargo', start: 23, end: 30, sense: 1 },
      { text: 'Es caro y sin embargo lo compré.', display: null, translation: 'It is expensive, and yet I bought it.', target: 'embargo', start: 14, end: 21, sense: 0 },
    ],
    expressions: [{ text: 'sin embargo', translation: 'however', kind: 'combination' }],
    grammarNotes: null,
    regionalNote: null,
    register: null,
    tags: [],
    frequencyRank: 424,
    curatedOrder: null,
    imageUrl: null,
    isNew: false,
    difficulty: null,
    due: null,
    lastReview: null,
    reps: 0,
    lapses: 0,
    retrievability: null,
    audio: { forvo: false, user: false },
    ...over,
  } as Omit<ItemResource, 'variants'>;
}

const pool = ['casa:house', 'perro:dog', 'libro:book', 'agua:water', 'mesa:table'].map((x, i) => {
  const [lemma, gloss] = x.split(':');
  return { entryId: 100 + i, lemma, display: lemma, pos: 'noun', gloss };
});
const ctxWith = (seed: number): BuildContext => {
  let s = seed;
  return { rand: () => ((s = (s * 9301 + 49297) % 233280) / 233280), pool, language: 'es', audioOk: false };
};

test('a sentence question quizzes the meaning that sentence shows, not the first meaning', () => {
  for (let seed = 1; seed < 40; seed++) {
    const e = entry();
    const p = buildPayload('context_meaning', e, ctxWith(seed)) as any;
    assert.ok(p, 'built');
    const right = p.options.find((o: any) => o.id === p.correctId).text;
    const shown = e.examples.find((x) => x.text === p.sentence)!;
    assert.equal(right, e.senses[shown.sense!].gloss, `seed ${seed}: the answer is the sentence's own meaning`);
  }
});

test('a multi-meaning word without linked sentences gets no "what does it mean here" question', () => {
  const e = entry({ examples: entry().examples.map((x) => ({ ...x, sense: null })) });
  assert.equal(buildPayload('context_meaning', e, ctxWith(3)), null);
  // A one-meaning word needs no link: its sentences can only show that meaning.
  const one = entry({ senses: [entry().senses[1]], examples: entry().examples.slice(0, 1).map((x) => ({ ...x, sense: null })) });
  assert.equal(meaningOf(one, one.examples[0]), 0);
  assert.ok(buildPayload('context_meaning', one, ctxWith(3)));
});

test('gap questions carry the meaning of their sentence for the answer screen', () => {
  for (let seed = 1; seed < 20; seed++) {
    const p = buildPayload('cloze_typed', entry(), ctxWith(seed)) as any;
    const e = entry();
    const shown = e.examples.find((x) => x.text.startsWith(p.before))!;
    assert.equal(p.meaning, e.senses[shown.sense!].gloss);
  }
});

test('"write a sentence" shows only example sentences of the meaning it names', () => {
  const p = buildPayload('sentence_create', entry(), ctxWith(5)) as any;
  assert.equal(p.gloss, 'used in «sin embargo» (however)');
  assert.deepEqual(p.examples.map((x: any) => x.text), ['Es caro y sin embargo lo compré.']);
});

test('questions that ask for the word hide it inside the meaning they show', () => {
  const p = buildPayload('recall_typed', entry(), ctxWith(5)) as any;
  assert.equal(p.gloss, 'used in «sin …» (however)');
  const w = buildPayload('word_choice', entry({ senses: [entry().senses[1]] }), ctxWith(5)) as any;
  assert.equal(w.gloss, 'trade embargo', 'outside «…» a Latin-script gloss is left alone (cognates are the same word)');
  assert.equal(w.note, 'now usually written …', 'notes hide the word anywhere');
  const ru = buildPayload(
    'recall_typed',
    entry({ lemma: 'быть', display: 'быть', forms: [{ form: 'есть', display: null, tags: [] }], senses: [{ gloss: 'there is (у меня есть)', translations: [], definition: null, note: null }] }),
    { ...ctxWith(5), language: 'ru' },
  ) as any;
  assert.equal(ru.gloss, 'there is (у меня …)', 'Cyrillic forms are hidden anywhere');
});

test('a "give this form" question names the table cell it asks for, so the answer screen can mark it', () => {
  const ctx: BuildContext = { ...ctxWith(3), language: 'ru' };
  const e = entry({
    lemma: 'книга',
    display: 'кни́га',
    pos: 'noun',
    gender: 'f',
    senses: [{ gloss: 'book', translations: ['book'], definition: null, note: null }],
    forms: [],
    examples: [],
    expressions: [],
    paradigm: { kind: 'noun', cells: { 'nom|sg': ['кни́га'], 'gen|sg': ['кни́ги'], 'gen|pl': ['книг'], 'nom|pl': ['кни́ги'] } },
  } as Partial<ItemResource>);
  const p = buildPayload('form_typed', e as any, ctx) as any;
  assert.ok(p, 'a word with a table gets a form question');
  assert.ok(['gen|sg', 'gen|pl', 'nom|pl'].includes(p.cell), p.cell);
  assert.equal(p.tags[0].split(' ')[0] === 'genitive' || p.tags[0].startsWith('nominative'), true);
});
