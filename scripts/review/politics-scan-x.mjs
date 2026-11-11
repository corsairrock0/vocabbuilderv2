// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Second scan for a language whose review has started: sentences the detector matches now (after keywords were added)
// that the first scan did not list → cand/<lang>-x.jsonl, ids <lang>-xNNN, kept stable across reruns.
// Usage: node scan-x.mjs es,pt
import { existsSync, writeFileSync } from 'node:fs';
import { politicsHits } from '/home/claude/vocabbuilder/scripts/freq/politics.mjs';
import { set, ROOT, readJsonl } from './politics-lib.mjs';
const key = (lemma, t) => `${lemma}\t${t.normalize('NFC').replace(/́/g, '').replace(/\s+/g, ' ').trim()}`;
for (const lang of process.argv[2].split(',')) {
  const first = new Set(readJsonl(`${ROOT}/cand/${lang}.jsonl`).map((c) => key(c.lemma, c.text)));
  const file = `${ROOT}/cand/${lang}-x.jsonl`;
  const prev = existsSync(file) ? readJsonl(file) : [];
  const prevId = new Map(prev.map((c) => [key(c.lemma, c.text), c.id]));
  let next = Math.max(0, ...prev.map((c) => Number(c.id.slice(-3))));
  const out = [];
  const by = {};
  for (const e of set(lang).doc.entries) for (const x of e.examples ?? []) {
    const k = key(e.lemma, x.text);
    if (first.has(k)) continue;
    const hits = politicsHits(lang, x.text, x.translation);
    if (!hits.length) continue;
    out.push({ id: prevId.get(k) ?? `${lang}-x${String(++next).padStart(3, '0')}`, lemma: e.lemma, pos: e.pos, rank: e.frequencyRank,
      gloss: (e.senses?.[x.sense ?? 0] ?? e.senses?.[0])?.gloss ?? null, glosses: (e.senses ?? []).map((s) => s.gloss), text: x.text,
      translation: x.translation ?? null, target: x.target, sense: x.sense ?? null, source: x.source,
      lemmaHit: politicsHits(lang, e.lemma, '').length > 0, mainHit: false, hits });
    for (const h of hits) by[h] = (by[h] ?? 0) + 1;
  }
  out.sort((a, b) => (a.id < b.id ? -1 : 1));
  writeFileSync(file, out.map((c) => JSON.stringify(c)).join('\n') + (out.length ? '\n' : ''));
  console.log(lang, 'second-scan candidates', out.length, '|', Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([h, n]) => `${h}:${n}`).join(' '));
}
