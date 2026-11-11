// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Sentences reviewers noted outside the lists → cand/<lang>-m.jsonl (ids <lang>-mNNN, stable across reruns).
// Usage: node make-m.mjs <lang> <file with one "lemma<TAB>sentence" per line>
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { politicsHits } from '/home/claude/vocabbuilder/scripts/freq/politics.mjs';
import { set, ROOT, readJsonl, candidates } from './politics-lib.mjs';
const [lang, listFile] = process.argv.slice(2);
const key = (lemma, t) => `${lemma}\t${t.normalize('NFC').replace(/́/g, '').replace(/\s+/g, ' ').trim()}`;
const file = `${ROOT}/cand/${lang}-m.jsonl`;
const prev = existsSync(file) ? readJsonl(file) : [];
const listed = new Set(candidates(lang).filter((c) => !c.id.includes('-m')).map((c) => key(c.lemma, c.text)));
const out = [...prev];
const have = new Set(prev.map((c) => key(c.lemma, c.text)));
let next = Math.max(0, ...prev.map((c) => Number(c.id.slice(-3))));
for (const line of readFileSync(listFile, 'utf8').split('\n').filter((l) => l.trim())) {
  const [lemma, text] = line.split('\t');
  const e = set(lang).doc.entries.find((x) => x.lemma === lemma && (x.examples ?? []).some((y) => y.text === text));
  if (!e) { console.log(`not found: ${lemma} | ${text}`); continue; }
  const x = e.examples.find((y) => y.text === text);
  const k = key(lemma, text);
  if (listed.has(k) || have.has(k)) continue;
  have.add(k);
  out.push({ id: `${lang}-m${String(++next).padStart(3, '0')}`, lemma, pos: e.pos, rank: e.frequencyRank, gloss: (e.senses?.[x.sense ?? 0] ?? e.senses?.[0])?.gloss ?? null,
    glosses: (e.senses ?? []).map((s) => s.gloss), text: x.text, translation: x.translation ?? null, target: x.target, sense: x.sense ?? null, source: x.source,
    lemmaHit: false, mainHit: false, hits: politicsHits(lang, x.text, x.translation).length ? politicsHits(lang, x.text, x.translation) : ['(noted by a reviewer)'] });
}
writeFileSync(file, out.map((c) => JSON.stringify(c)).join('\n') + (out.length ? '\n' : ''));
console.log(`${lang}: ${out.length} noted sentences (${out.length - prev.length} new)`);
