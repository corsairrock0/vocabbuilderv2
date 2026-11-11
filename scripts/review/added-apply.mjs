// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Save the written sentences as the app's decisions: data/review/added/<lang>.jsonl (both lists of a language).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
const ROOT = '/home/claude/added';
const OUT = '/home/claude/vocabbuilder/data/review/added';
mkdirSync(OUT, { recursive: true });
const read = (f) => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)) : []);
for (const lang of (process.argv[2] ?? 'es,pt,vi,ru,uk,pl').split(',')) {
  const recs = [...read(`${ROOT}/out/${lang}.jsonl`), ...read(`${ROOT}/out/${lang}-topics.jsonl`)].map((r) => ({
    lemma: r.lemma, pos: r.pos, rank: r.rank, text: r.text.trim(), translation: r.translation.trim(), target: r.target.trim(), sense: r.sense,
  }));
  // Stable order: by rank, keeping each word's sentences in the order written.
  recs.sort((a, b) => a.rank - b.rank);
  writeFileSync(`${OUT}/${lang}.jsonl`, recs.map((r) => JSON.stringify(r)).join('\n') + (recs.length ? '\n' : ''));
  console.log(`${lang}: ${recs.length} sentences for ${new Set(recs.map((r) => `${r.lemma}|${r.pos}|${r.rank}`)).size} words`);
}
