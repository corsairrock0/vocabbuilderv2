// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Sentences on topics left out of the app (scripts/freq/topics.mjs): what is caught, what is not, and how a set build
// replaces or drops them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error plain JavaScript build script
import { applyTopics, topicHits } from '../../scripts/freq/topics.mjs';

test('sentences about Africa, India, the Middle East, Islam or the Bible are caught in the sentence or its translation', () => {
  assert.deepEqual(topicHits('es', 'Fui a Turquía.', 'I went to Turkey.'), ['Turkey', 'Turquía']);
  assert.ok(topicHits('es', '¡Dios mío!', 'My God!').length, 'God counts as a biblical word');
  assert.ok(topicHits('ru', 'Мы ехали через Сахару.', null).length, 'untranslated sentences are checked in the language itself');
  assert.ok(topicHits('pl', 'O Boże!', null).length);
  assert.ok(topicHits('vi', 'Anh ấy đến từ Ấn Độ.', null).length);
  assert.ok(topicHits('uk', 'Він читає Біблію.', null).length);
  assert.ok(topicHits('es', 'Ellos reparten biblias gratuitas.', 'They give bibles for free.').length, 'the plural, in lower case');
  assert.ok(topicHits('pt', 'Eles distribuem bíblias.', 'They hand out bibles.').length);
  assert.ok(topicHits('pl', 'Przed świętem Matki Boskiej Gromnicznej.', null).length, 'the Mother of God in Polish');
});

test('ordinary words that look like those names are not caught', () => {
  assert.deepEqual(topicHits('ru', 'Дай мне сахара.', 'Give me some sugar.'), [], 'сахара is "of sugar"');
  assert.deepEqual(topicHits('ru', 'Сахара нет.', 'There is no sugar.'), [], 'a capital at the start of a sentence says nothing');
  assert.deepEqual(topicHits('uk', 'Немає газу.', 'There is no gas.'), [], 'газу is "of gas"');
  assert.deepEqual(topicHits('ru', 'Он в библиотеке.', 'He is in the library.'), []);
  assert.deepEqual(topicHits('pl', 'Boże Narodzenie jest w grudniu.', 'Christmas is in December.'), []);
  assert.deepEqual(topicHits('es', 'Adiós, señor García.', 'Goodbye, Mr. García.'), [], 'adiós contains dios, señor is "sir"');
  assert.deepEqual(topicHits('es', 'El imán atrae el hierro.', 'The magnet attracts iron.'), []);
  assert.deepEqual(topicHits('es', 'Comimos pavo.', 'We ate turkey.'), [], 'turkey the bird');
});

test('a set build replaces a sentence with its listed replacement, keeps false matches, and drops the rest', () => {
  const entries: any[] = [
    {
      lemma: 'ir',
      pos: 'verb',
      frequencyRank: 30,
      senses: [{ gloss: 'to go' }],
      examples: [
        { text: 'Fui a Turquía.', translation: 'I went to Turkey.', target: 'Fui', source: 'tatoeba', ref: 'tatoeba:1', sense: 0 },
        { text: 'Fui a Egipto.', translation: 'I went to Egypt.', target: 'Fui', source: 'tatoeba', ref: 'tatoeba:2', sense: 0 },
        { text: 'Fui a casa.', translation: 'I went home.', target: 'Fui', source: 'tatoeba', ref: 'tatoeba:3', sense: 0 },
      ],
    },
    { lemma: 'belén', pos: 'noun', frequencyRank: 900, senses: [{ gloss: 'nativity scene' }], examples: [{ text: 'Belén es mi amiga.', translation: 'Belén is my friend.', target: 'Belén' }] },
  ];
  const decisions = new Map<string, any>([
    ['ir\tFui a Turquía.', { lemma: 'ir', text: 'Fui a Turquía.', replace: { text: 'Fui a Japón.', translation: 'I went to Japan.', target: 'Fui' } }],
    ['belén\tBelén es mi amiga.', { lemma: 'belén', text: 'Belén es mi amiga.', keep: true }],
  ]);
  const credits = entries[0].examples.map((x: any) => ({ lemma: 'ir', text: x.text, credit: x.ref }));
  const r = applyTopics('es', entries, decisions, credits);
  assert.deepEqual(entries[0].examples.map((x: any) => [x.text, x.source, x.sense]), [
    ['Fui a Japón.', 'ai-claude', 0],
    ['Fui a casa.', 'tatoeba', 0],
  ]);
  assert.equal(entries[1].examples.length, 1, 'the name Belén is not Bethlehem');
  assert.deepEqual(r.stats, { checked: 4, replaced: 1, dropped: 0, kept: 1, undecided: 1 });
  assert.equal(r.open[0].text, 'Fui a Egipto.', 'a sentence with no decision is dropped and listed');
  assert.deepEqual(r.credits.map((c: any) => c.text), ['Fui a casa.', 'Fui a Japón.']);
});
