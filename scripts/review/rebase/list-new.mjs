// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// The AI-written sentences of the newly reviewed words that reach the set, with their translations, for a read.
import { readFileSync, existsSync } from 'node:fs';
const F = '/home/claude/vocabbuilder/scripts/freq';
const { applyReview, loadReview } = await import(`${F}/review.mjs`);
const { applyTopics, loadTopicDecisions } = await import(`${F}/topics.mjs`);
const { applyCrude, applyCrudeMeanings, applyCrudeWords, loadCrudeDecisions, loadCrudeMeanings, loadCrudeWords } = await import(`${F}/crude.mjs`);
const { applyPolitics, loadPoliticsDecisions } = await import(`${F}/politics.mjs`);
const BEFORE = '/home/claude/review/rebase/before-2026-11-10/review';
const lines = (f) => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)) : []);
const lang = process.argv[2];
const mode = process.argv[3] ?? 'en';
const before = new Set(lines(`${BEFORE}/${lang}.jsonl`).map((r) => `${r.lemma}|${r.pos}|${r.rank}`));
const review = loadReview(lang);
const fresh = new Map([...review.values()].flat().filter((r) => !before.has(`${r.lemma}|${r.pos}|${r.rank}`)).map((r) => [`${r.lemma}|${r.pos}|${r.rank}`, r]));
const doc = JSON.parse(readFileSync(`/home/claude/review/base/${lang}.json`, 'utf8'));
const r = applyReview(doc.entries, review, []);
const t = applyTopics(lang, doc.entries, loadTopicDecisions(lang), r.credits);
const c = applyCrude(lang, doc.entries, loadCrudeDecisions(lang), t.credits);
applyCrudeMeanings(lang, doc.entries, loadCrudeMeanings(lang));
const pol = applyPolitics(lang, doc.entries, loadPoliticsDecisions(lang), c.credits);
const w = applyCrudeWords(doc.entries, loadCrudeWords(lang), pol.credits);
let n = 0;
for (const e of w.entries) {
  const rec = fresh.get(`${e.lemma}|${e.pos}|${e.frequencyRank}`);
  if (!rec) continue;
  const added = new Set(rec.add.map((a) => a.text));
  for (const x of e.examples ?? []) {
    if (!added.has(x.text)) continue;
    n++;
    console.log(mode === 'en' ? `${e.frequencyRank} ${e.lemma}: ${x.translation}` : `${e.frequencyRank} ${e.lemma} [${e.senses[x.sense]?.gloss}] ${x.text} | ${x.translation}`);
  }
}
console.error(`${lang}: ${n} new sentences`);
