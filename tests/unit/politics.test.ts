// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Sentences on politics, war or living people (scripts/freq/politics.mjs): what the detector catches, and how a set
// build applies the reviewed decisions once a language has them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error plain JavaScript build script
import { applyPolitics, politicsHits } from '../../scripts/freq/politics.mjs';

test('politics, war and the other country are caught in the sentence or its translation', () => {
  assert.ok(politicsHits('es', 'El presidente habló ayer.', 'The president spoke yesterday.').length);
  assert.ok(politicsHits('ru', 'Они живут в Крыму.', 'They live in Crimea.').length, 'Ukraine in the Russian set');
  assert.ok(politicsHits('uk', 'Він переїхав до Москви.', null).length, 'Russia in the Ukrainian set, untranslated');
  assert.ok(politicsHits('pl', 'Wojna skończyła się w maju.', null).length);
  assert.ok(politicsHits('vi', 'Chiến tranh đã kết thúc.', 'The war is over.').length);
  assert.deepEqual(politicsHits('ru', 'Мэри любит Тома.', 'Mary loves Tom.'), [], 'Мэри is Mary, not a mayor');
  assert.deepEqual(politicsHits('es', 'Fuimos al cine.', 'We went to the cinema.'), []);
});

test('a set build applies politics decisions, and drops unreviewed matches only once a language has decisions', () => {
  const make = () => [
    {
      lemma: 'presidente',
      pos: 'noun',
      frequencyRank: 300,
      senses: [{ gloss: 'president' }],
      examples: [
        { text: 'El presidente ganó las elecciones.', translation: 'The president won the election.', target: 'presidente', source: 'tatoeba', ref: 'tatoeba:1' },
        { text: 'El presidente del club es mi tío.', translation: 'The president of the club is my uncle.', target: 'presidente', source: 'tatoeba', ref: 'tatoeba:2' },
        { text: 'El presidente visitó el ejército.', translation: 'The president visited the army.', target: 'presidente', source: 'tatoeba', ref: 'tatoeba:3' },
      ],
    },
  ];
  const before = make();
  const none = applyPolitics('es', before, new Map());
  assert.equal(before[0].examples.length, 3, 'no decisions yet: nothing is dropped');
  assert.equal(none.stats.undecided, 0);
  const entries = make();
  const decisions = new Map<string, any>([
    ['presidente\tEl presidente ganó las elecciones.', { lemma: 'presidente', text: 'El presidente ganó las elecciones.', replace: { text: 'Nuestra clase eligió un nuevo presidente.', translation: 'Our class elected a new president.', target: 'presidente' } }],
    ['presidente\tEl presidente del club es mi tío.', { lemma: 'presidente', text: 'El presidente del club es mi tío.', keep: true }],
  ]);
  const r = applyPolitics('es', entries, decisions);
  assert.deepEqual(entries[0].examples.map((x: any) => [x.text, x.source]), [
    ['Nuestra clase eligió un nuevo presidente.', 'ai-claude'],
    ['El presidente del club es mi tío.', 'tatoeba'],
  ]);
  assert.deepEqual(r.stats, { checked: 3, replaced: 1, dropped: 0, kept: 1, undecided: 1 });
  assert.equal(r.open[0].text, 'El presidente visitó el ejército.');
});
