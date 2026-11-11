// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Politics/war/living-people candidates: keyword hits (sentence or translation) → cand/<lang>.jsonl; untranslated
// treebank sentences without a hit → skim/<lang>.jsonl (to read through).
import { writeFileSync } from 'node:fs';
import { politicsHits } from '/home/claude/vocabbuilder/scripts/freq/politics.mjs';
import { set, ROOT } from './politics-lib.mjs';
// Usage: node scan.mjs [langs]   (default all; never rerun for a language whose review has started: it renumbers)
for (const lang of (process.argv[2] ?? 'es,pt,vi,ru,uk,pl').split(',')) {
  const cand = [], skim = [];
  const by = {};
  for (const e of set(lang).doc.entries) for (const x of e.examples ?? []) {
    const hits = politicsHits(lang, x.text, x.translation);
    const base = { lemma: e.lemma, pos: e.pos, rank: e.frequencyRank, gloss: (e.senses?.[x.sense ?? 0] ?? e.senses?.[0])?.gloss ?? null,
      glosses: (e.senses ?? []).map((s) => s.gloss), text: x.text, translation: x.translation ?? null, target: x.target, sense: x.sense ?? null, source: x.source };
    if (hits.length) { cand.push({ ...base, lemmaHit: politicsHits(lang, e.lemma, '').length > 0, mainHit: false, hits }); for (const h of hits) by[h] = (by[h] ?? 0) + 1; }
    else if (!x.translation && x.source !== 'ai-claude') skim.push(base);
  }
  cand.forEach((c, i) => (c.id = `${lang}-${String(i + 1).padStart(4, '0')}`));
  skim.forEach((c, i) => (c.id = `${lang}-t${String(i + 1).padStart(4, '0')}`));
  writeFileSync(`${ROOT}/cand/${lang}.jsonl`, cand.map((c) => JSON.stringify(c)).join('\n') + '\n');
  writeFileSync(`${ROOT}/skim/${lang}.jsonl`, skim.map((c) => JSON.stringify(c)).join('\n') + '\n');
  console.log(lang, 'candidates', cand.length, 'read-through', skim.length, '|', Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([h, n]) => `${h}:${n}`).join(' '));
}
