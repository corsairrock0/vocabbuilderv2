// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Crude sentences (scripts/freq/crude.mjs): what the detector catches, what it leaves alone, and how a set build
// replaces, keeps or drops sentences by the reviewed decisions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error plain JavaScript build script
import { applyCrude, applyCrudeMeanings, applyCrudeWords, crudeHits } from '../../scripts/freq/crude.mjs';

test('swearing, sex and slurs are caught in the sentence or its English translation', () => {
  assert.ok(crudeHits('pl', 'Kurwa, nie wiem.', null).length, 'untranslated sentences are checked in the language itself');
  assert.ok(crudeHits('es', '¡Que se joda!', 'Screw him!').length);
  assert.ok(crudeHits('pt', 'Que porra é essa?', 'What the hell is this?').length);
  assert.ok(crudeHits('ru', 'Ты, долбоёб, опять опоздал.', null).length, 'a prefixed form of a vulgar root');
  assert.ok(crudeHits('uk', 'Ну ти й підар.', null).length);
  assert.ok(crudeHits('vi', 'Đéo biết.', null).length);
  assert.ok(crudeHits('es', 'Él es un buen tipo.', "He's a son of a bitch.").length, 'a crude translation is enough');
});

test('ordinary words that contain or resemble those words are not caught', () => {
  assert.deepEqual(crudeHits('ru', 'Он сидит на небе и ест хлеб у себя.', 'He sits in the sky and eats bread at home.'), [], 'небе, хлеб, себя');
  assert.deepEqual(crudeHits('ru', 'Похуже не бывает, ухо болит.', null), [], 'похуже "a bit worse", ухо "ear"');
  assert.deepEqual(crudeHits('uk', 'Об’єкт з’їли, вухо болить, хустка лежить.', null), [], 'об’єкт, з’їли, хустка');
  assert.deepEqual(crudeHits('es', 'La culebra no tiene la culpa.', 'The snake is not to blame.'), []);
  assert.deepEqual(crudeHits('pt', 'Hoje é sexta-feira e a transação foi feita.', 'Today is Friday and the transaction went through.'), []);
  assert.deepEqual(crudeHits('vi', 'Mọi người đều ăn cơm.', 'Everyone is eating.'), [], 'mọi "every"');
  assert.deepEqual(crudeHits('pl', 'Kupiłem duplikat klucza.', 'I bought a duplicate key.'), []);
  assert.deepEqual(crudeHits('es', 'La casa está más lejos.', 'The house is farther away.'), [], 'farther');
  assert.deepEqual(crudeHits('ru', 'Он работает в Херсоне.', null), []);
});

test('a set build applies replace, drop and keep decisions, and drops detector matches that have none', () => {
  const entries: any[] = [
    {
      lemma: 'perro',
      pos: 'noun',
      frequencyRank: 300,
      senses: [{ gloss: 'dog' }, { gloss: 'jerk (insult)' }],
      examples: [
        { text: 'Mi perro es un hijo de puta.', translation: 'My dog is a son of a bitch.', target: 'perro', source: 'tatoeba', ref: 'tatoeba:1', sense: 1 },
        { text: 'El perro duerme.', translation: 'The dog is sleeping.', target: 'perro', source: 'tatoeba', ref: 'tatoeba:2', sense: 0 },
        { text: 'Ese perro de mierda.', translation: 'That shitty dog.', target: 'perro', source: 'tatoeba', ref: 'tatoeba:3', sense: 0 },
        { text: 'El perro es de Andrés.', translation: 'The dog is Andrés’s.', target: 'perro', source: 'tatoeba', ref: 'tatoeba:4', sense: 0 },
      ],
    },
    { lemma: 'gallo', pos: 'noun', frequencyRank: 900, senses: [{ gloss: 'rooster' }], examples: [{ text: 'El gallo canta.', translation: 'The cock crows.', target: 'gallo' }] },
    {
      lemma: 'violentar',
      pos: 'verb',
      frequencyRank: 4000,
      senses: [{ gloss: 'to rape' }, { gloss: 'to force' }, { gloss: 'to spoil, to distort' }],
      examples: [{ text: 'La torre violenta el paisaje.', translation: 'The tower spoils the landscape.', target: 'violenta', sense: 0 }],
    },
  ];
  const decisions = new Map<string, any>([
    ['perro\tMi perro es un hijo de puta.', { lemma: 'perro', text: 'Mi perro es un hijo de puta.', replace: { text: 'Mi perro come mucho.', translation: 'My dog eats a lot.', target: 'perro', sense: 0 } }],
    ['perro\tEl perro es de Andrés.', { lemma: 'perro', text: 'El perro es de Andrés.', drop: true }],
    ['gallo\tEl gallo canta.', { lemma: 'gallo', text: 'El gallo canta.', keep: true }],
    ['violentar\tLa torre violenta el paisaje.', { lemma: 'violentar', text: 'La torre violenta el paisaje.', keep: true, sense: 2 }],
  ]);
  const credits = entries[0].examples.map((x: any) => ({ lemma: 'perro', text: x.text, credit: x.ref }));
  const r = applyCrude('es', entries, decisions, credits);
  assert.deepEqual(entries[0].examples.map((x: any) => [x.text, x.source, x.sense]), [
    ['Mi perro come mucho.', 'ai-claude', 0],
    ['El perro duerme.', 'tatoeba', 0],
  ], 'replaced (with its meaning set), kept, dropped without a decision, dropped by a decision even with no keyword');
  assert.equal(entries[1].examples.length, 1, 'a cock that crows is a rooster');
  assert.equal(entries[2].examples[0].sense, 2, 'a kept sentence is moved off a crude meaning it does not show');
  assert.deepEqual(r.stats, { checked: 6, replaced: 1, dropped: 1, kept: 1, undecided: 1 });
  assert.equal(r.open[0].text, 'Ese perro de mierda.', 'a matched sentence with no decision is dropped and listed');
  assert.deepEqual(r.credits.map((c: any) => c.text), ['El perro duerme.', 'Mi perro come mucho.']);
});

test('words that are crude in every meaning are left out of the set, homographs told apart by rank', () => {
  const entries: any[] = [
    { lemma: 'mierda', pos: 'noun', frequencyRank: 209, senses: [{ gloss: 'shit' }], examples: [] },
    { lemma: 'casa', pos: 'noun', frequencyRank: 50, senses: [{ gloss: 'house' }], examples: [{ text: 'Mi casa es azul.' }] },
    { lemma: 'cura', pos: 'noun', frequencyRank: 900, senses: [{ gloss: 'priest' }], examples: [] },
    { lemma: 'cura', pos: 'noun', frequencyRank: 1200, senses: [{ gloss: 'cure' }], examples: [] },
  ];
  const words = new Set(['mierda\tnoun\t209', 'cura\tnoun\t1200']);
  const credits = [{ lemma: 'casa', text: 'Mi casa es azul.', credit: 'tatoeba:1' }, { lemma: 'mierda', text: '¡Qué mierda!', credit: 'tatoeba:2' }];
  const r = applyCrudeWords(entries, words, credits);
  assert.deepEqual(r.entries.map((e: any) => `${e.lemma}#${e.frequencyRank}`), ['casa#50', 'cura#900']);
  assert.deepEqual(r.removed, ['mierda', 'cura']);
  assert.deepEqual(r.credits.map((c: any) => c.text), ['Mi casa es azul.'], 'credits keep only sentences still in the set');
});

test('crude slang meanings are dropped and offensive glosses reworded; sentences follow their meaning', () => {
  const entries: any[] = [
    {
      lemma: 'leche',
      pos: 'noun',
      frequencyRank: 600,
      senses: [{ gloss: 'milk', translations: [] }, { gloss: 'cum, semen', translations: ['cum'] }, { gloss: 'luck', translations: [] }],
      examples: [
        { text: 'La leche está fría.', sense: 0 },
        { text: '¡Qué leche tienes!', sense: 2 },
        { text: 'Compré leche.', sense: 1 },
        { text: 'Me gusta la leche.' },
      ],
    },
    { lemma: 'enano', pos: 'noun', frequencyRank: 3000, senses: [{ gloss: 'dwarf, midget', translations: ['midget', 'dwarf'] }], examples: [] },
    { lemma: 'mierda', pos: 'noun', frequencyRank: 209, senses: [{ gloss: 'shit' }], examples: [] },
  ];
  const decisions = new Map<string, any>([
    ['leche\tnoun\t600', { drop: [1], retag: { 'Compré leche.': 0 } }],
    ['enano\tnoun\t3000', { gloss: { 0: 'dwarf' } }],
    ['mierda\tnoun\t209', { drop: [0] }],
  ]);
  const stats = applyCrudeMeanings('es', entries, decisions);
  assert.deepEqual(entries[0].senses.map((s: any) => s.gloss), ['milk', 'luck']);
  assert.deepEqual(entries[0].examples.map((x: any) => x.sense), [0, 1, 0, undefined], 'renumbered, retagged, and "all meanings" left alone');
  assert.deepEqual(entries[1].senses, [{ gloss: 'dwarf', translations: ['dwarf'] }], 'the gloss is reworded and a crude extra answer goes');
  assert.equal(entries[2].senses.length, 1, 'a decision that would leave no meaning is ignored (such words are left out instead)');
  assert.deepEqual(stats, { words: 2, dropped: 1, reworded: 1 });
});

test('a meanings decision can give a word matched to an offensive homograph its real meaning and spelling', () => {
  const entries: any[] = [
    {
      lemma: 'москва',
      display: 'москва́',
      pos: 'noun',
      frequencyRank: 997,
      senses: [{ gloss: 'Muscovites, Russians', note: 'collective', translations: [] }],
      examples: [{ text: 'Москва — дуже велике місто.', sense: 0 }],
    },
    { lemma: 'київський', display: null, pos: 'adjective', frequencyRank: 261, senses: [{ gloss: 'Kiev, Kievan', note: 'relational' }], examples: [] },
  ];
  const decisions = new Map<string, any>([
    ['москва\tnoun\t997', { drop: [], gloss: { 0: 'Moscow (the capital of Russia)' }, note: { 0: null }, display: 'Москва́' }],
    ['київський\tadjective\t261', { gloss: { 0: 'Kyiv; Kyivan' } }],
  ]);
  const stats = applyCrudeMeanings('uk', entries, decisions);
  assert.deepEqual(entries[0].senses, [{ gloss: 'Moscow (the capital of Russia)', note: null, translations: [] }], 'gloss reworded, usage note cleared');
  assert.equal(entries[0].display, 'Москва́');
  assert.equal(entries[0].examples[0].sense, 0, 'its sentence keeps its meaning');
  assert.deepEqual(entries[1].senses, [{ gloss: 'Kyiv; Kyivan', note: 'relational', translations: [] }], 'a note the decision does not name stays');
  assert.equal(entries[1].display, null, 'no display in the decision, none set');
  assert.deepEqual(stats, { words: 2, dropped: 0, reworded: 2 });
});
