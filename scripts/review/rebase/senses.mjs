// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// For crude and politics decisions with a meaning number on newly reviewed words: where does the old number lead in
// the reviewed meaning list (through each new meaning's `from`), and does it agree with the meaning the review linked
// the original sentence to?
import { readFileSync, existsSync } from 'node:fs';
const ROOT = '/home/claude/vocabbuilder';
const LANGS = process.argv[2] ? process.argv[2].split(',') : ['es', 'pt', 'vi', 'ru', 'uk', 'pl'];
const SHOW = process.argv.includes('--show');
const lines = (f) => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)) : []);
const textKey = (s) => s.normalize('NFC').replace(/́/g, '').replace(/\s+/g, ' ').trim();
for (const lang of LANGS) {
  const before = new Set(lines(`/tmp/review-before/review/${lang}.jsonl`).map((r) => `${r.lemma}|${r.pos}|${r.rank}`));
  const fresh = lines(`${ROOT}/data/review/${lang}.jsonl`).filter((r) => !before.has(`${r.lemma}|${r.pos}|${r.rank}`));
  const base = new Map(JSON.parse(readFileSync(`/home/claude/review/base/${lang}.json`, 'utf8')).entries.map((e) => [`${e.lemma}|${e.pos}|${e.frequencyRank}`, e]));
  const cm = new Map(lines(`${ROOT}/data/review/crude/${lang}-meanings.jsonl`).map((d) => [`${d.lemma}|${d.pos}|${d.rank}`, d]));
  const byLemma = new Map();
  for (const r of fresh) (byLemma.get(r.lemma) ?? byLemma.set(r.lemma, []).get(r.lemma)).push(r);
  const tally = {};
  const bump = (k) => (tally[k] = (tally[k] ?? 0) + 1);
  for (const [name, file] of [['crude', `crude/${lang}.jsonl`], ['politics', `politics/${lang}.jsonl`]]) {
    for (const d of lines(`${ROOT}/data/review/${file}`)) {
      const recs = byLemma.get(d.lemma);
      if (!recs) continue;
      const n = d.replace && Number.isInteger(d.replace.sense) ? d.replace.sense : d.keep && Number.isInteger(d.sense) ? d.sense : null;
      if (n == null) continue;
      const t = textKey(d.text);
      const rec = recs.find((r) => r.keep.some((k) => textKey(k.text) === t));
      if (!rec) {
        bump(`${name}: original not kept`);
        continue;
      }
      const linked = rec.keep.find((k) => textKey(k.text) === t).sense;
      const e = base.get(`${rec.lemma}|${rec.pos}|${rec.rank}`);
      // Politics numbers count the meanings left after the crude ones were dropped; crude numbers are the base's.
      let baseIndex = n;
      if (name === 'politics') {
        const drop = new Set(cm.get(`${rec.lemma}|${rec.pos}|${rec.rank}`)?.drop ?? []);
        const left = e.senses.map((_, i) => i).filter((i) => !drop.has(i));
        baseIndex = left[n] ?? null;
      }
      const mapped = baseIndex == null ? [] : rec.senses.map((s, j) => (s.from.includes(baseIndex + 1) ? j : -1)).filter((j) => j >= 0);
      const kind = !mapped.length ? 'old meaning not in the review' : mapped.includes(linked) ? (mapped.length === 1 ? 'same' : 'same (one of several)') : 'different';
      bump(`${name}: ${kind}`);
      if (SHOW && kind !== 'same' && kind !== 'same (one of several)')
        console.log(`  ${name} ${lang} ${rec.lemma}(${rec.rank}) "${d.text}" → "${d.replace?.text ?? '(kept)'}" [${d.replace?.translation ?? ''}]\n      old ${n}: ${e.senses[baseIndex]?.gloss}\n      mapped ${JSON.stringify(mapped)}; original linked to ${linked}: ${rec.senses[linked]?.gloss}\n      new list: ${rec.senses.map((s, j) => `${j}=${s.gloss} <${s.from}>`).join(' | ')}`);
    }
  }
  console.log(lang, JSON.stringify(tally));
}
