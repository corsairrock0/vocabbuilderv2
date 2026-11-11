// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Sentences written for words left without any (scripts/freq/added.mjs): only a word with no sentence gets them,
// each labelled AI-written and credited, and a meaning number outside the word's list is left off.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
// @ts-expect-error plain JavaScript build script
import { ADDED_CREDIT, addedReport, applyAdded, loadAdded } from '../../scripts/freq/added.mjs';

test('written sentences go only to words without any, labelled and credited', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'vb-added-'));
  const file = path.join(dir, 'es.jsonl');
  writeFileSync(
    file,
    [
      { lemma: 'terrorismo', pos: 'noun', rank: 2731, text: 'El terrorismo es un delito grave.', translation: 'Terrorism is a serious crime.', target: 'terrorismo', sense: 0 },
      { lemma: 'terrorismo', pos: 'noun', rank: 2731, text: 'Leí un libro sobre el terrorismo.', translation: 'I read a book about terrorism.', target: 'terrorismo', sense: 7 },
      { lemma: 'agua', pos: 'noun', rank: 120, text: 'El agua está fría.', translation: 'The water is cold.', target: 'agua', sense: 0 },
    ]
      .map((r) => JSON.stringify(r))
      .join('\n') + '\n',
  );
  const decisions = loadAdded('es', file);
  assert.equal(decisions.get('terrorismo|noun|2731')?.length, 2);
  const entries: any[] = [
    { lemma: 'terrorismo', pos: 'noun', frequencyRank: 2731, senses: [{ gloss: 'terrorism' }], examples: [] },
    { lemma: 'agua', pos: 'noun', frequencyRank: 120, senses: [{ gloss: 'water' }], examples: [{ text: 'Bebo agua.', translation: 'I drink water.', target: 'agua', source: 'tatoeba' }] },
  ];
  const r = applyAdded(entries, decisions, [{ lemma: 'agua', text: 'Bebo agua.', credit: 'Tatoeba' }]);
  assert.deepEqual(r.stats, { words: 1, sentences: 2 });
  assert.equal(entries[0].examples.length, 2);
  assert.deepEqual(entries[0].examples[0], { text: 'El terrorismo es un delito grave.', translation: 'Terrorism is a serious crime.', target: 'terrorismo', sense: 0, source: 'ai-claude', ref: null });
  assert.equal('sense' in entries[0].examples[1], false, 'a meaning the word does not have is left off');
  assert.equal(entries[1].examples.length, 1, 'a word that has a sentence gets none of these');
  assert.deepEqual(
    r.credits.map((c: any) => c.credit),
    ['Tatoeba', ADDED_CREDIT, ADDED_CREDIT],
  );
  assert.match(addedReport(r.stats).join('\n'), /1 words that had no example sentence got 2 AI-written ones/);
  assert.deepEqual(addedReport({ words: 0, sentences: 0 }), []);
});
