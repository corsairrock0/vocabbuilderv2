// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Second scan, after the keyword lists grew: sentences the detector now matches that have no candidate id yet.
// Usage: node scan2.mjs → cand/<lang>-x.jsonl (ids <lang>-xNNN). Never rewrites cand/<lang>.jsonl (its ids are in use).
import { existsSync, writeFileSync } from 'node:fs';
import { crudeHits } from '/home/claude/vocabbuilder/scripts/freq/crude.mjs';
import { set, readJsonl, ROOT } from './crude-lib.mjs';
const key = (lemma, text) => `${lemma}\t${text.normalize('NFC').replace(/́/g, '').replace(/\s+/g, ' ').trim()}`;
for (const lang of ['es', 'pt', 'vi', 'ru', 'uk', 'pl']) {
  const xfile = `${ROOT}/cand/${lang}-x.jsonl`;
  if (existsSync(xfile)) { console.log(`${lang}: ${xfile} exists, left alone`); continue; }
  const known = new Set(readJsonl(`${ROOT}/cand/${lang}.jsonl`).map((c) => key(c.lemma, c.text)));
  // Read-through sentences already decided (replace/drop) need nothing more.
  const skim = new Map(readJsonl(`${ROOT}/skim/${lang}.jsonl`).map((c) => [c.id, c]));
  if (existsSync(`${ROOT}/out/${lang}.jsonl`)) for (const r of readJsonl(`${ROOT}/out/${lang}.jsonl`)) { const c = skim.get(r.id); if (c) known.add(key(c.lemma, c.text)); }
  const out = [];
  for (const e of set(lang).doc.entries) {
    const lemmaHit = crudeHits(lang, e.lemma, '').length > 0;
    const mainHit = crudeHits(lang, '', e.senses?.[0]?.gloss ?? '').length > 0;
    for (const x of e.examples ?? []) {
      const hits = crudeHits(lang, x.text, x.translation);
      if (!hits.length || known.has(key(e.lemma, x.text))) continue;
      out.push({ lemma: e.lemma, pos: e.pos, rank: e.frequencyRank, gloss: (e.senses?.[x.sense ?? 0] ?? e.senses?.[0])?.gloss ?? null,
        glosses: (e.senses ?? []).map((s) => s.gloss), text: x.text, translation: x.translation, target: x.target, sense: x.sense ?? null,
        source: x.source, lemmaHit, mainHit, hits });
    }
  }
  out.forEach((c, i) => (c.id = `${lang}-x${String(i + 1).padStart(3, '0')}`));
  writeFileSync(xfile, out.map((c) => JSON.stringify(c)).join('\n') + (out.length ? '\n' : ''));
  const by = {};
  for (const c of out) for (const h of c.hits) by[h] = (by[h] ?? 0) + 1;
  console.log(lang, out.length, Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 18).map(([h, n]) => `${h}:${n}`).join(' '));
}
