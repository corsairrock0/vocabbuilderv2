// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// How the decision files made on the old meaning lists (crude sentences and meanings, politics, added) meet the words
// newly covered by the meaning review. Report only.
import { readFileSync, existsSync } from 'node:fs';
const ROOT = '/home/claude/vocabbuilder';
const LANGS = ['es', 'pt', 'vi', 'ru', 'uk', 'pl'];
const lines = (f) => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)) : []);
const textKey = (s) => s.normalize('NFC').replace(/́/g, '').replace(/\s+/g, ' ').trim();
for (const lang of LANGS) {
  const before = new Set(lines(`/tmp/review-before/review/${lang}.jsonl`).map((r) => `${r.lemma}|${r.pos}|${r.rank}`));
  const review = lines(`${ROOT}/data/review/${lang}.jsonl`);
  const fresh = review.filter((r) => !before.has(`${r.lemma}|${r.pos}|${r.rank}`));
  const base = new Map(JSON.parse(readFileSync(`/home/claude/review/base/${lang}.json`, 'utf8')).entries.map((e) => [`${e.lemma}|${e.pos}|${e.frequencyRank}`, e]));
  const freshByLemma = new Map();
  for (const r of fresh) (freshByLemma.get(r.lemma) ?? freshByLemma.set(r.lemma, []).get(r.lemma)).push(r);
  const out = { lang, fresh: fresh.length, noBase: 0 };
  for (const r of fresh) if (!base.has(`${r.lemma}|${r.pos}|${r.rank}`)) out.noBase++;
  // Crude meanings decisions on fresh words.
  const cm = lines(`${ROOT}/data/review/crude/${lang}-meanings.jsonl`).filter((d) => fresh.some((r) => r.lemma === d.lemma && r.pos === d.pos && r.rank === d.rank));
  out.crudeMeanings = cm.length;
  out.crudeMeaningsList = cm.map((d) => `${d.lemma}(${d.rank}) drop ${JSON.stringify(d.drop)} gloss ${JSON.stringify(d.gloss)}${d.retag ? ' retag' : ''}${d.note ? ' note' : ''}${d.display ? ' display' : ''}`);
  // Sentence decisions (keyed by lemma + text; a lemma can be several entries).
  for (const [name, file] of [['crude', `crude/${lang}.jsonl`], ['politics', `politics/${lang}.jsonl`], ['topics', `topics/${lang}.jsonl`]]) {
    const ds = lines(`${ROOT}/data/review/${file}`).filter((d) => freshByLemma.has(d.lemma));
    const c = { all: ds.length, replaceWithSense: 0, keepWithSense: 0, origKept: 0, origDropped: 0, origUnknown: 0 };
    for (const d of ds) {
      if (d.replace && Number.isInteger(d.replace.sense)) c.replaceWithSense++;
      if (d.keep && Number.isInteger(d.sense)) c.keepWithSense++;
      const recs = freshByLemma.get(d.lemma);
      const t = textKey(d.text);
      if (recs.some((r) => r.keep.some((k) => textKey(k.text) === t))) c.origKept++;
      else if (recs.some((r) => r.drop.some((k) => textKey(k.text) === t))) c.origDropped++;
      else c.origUnknown++;
    }
    out[name] = c;
  }
  const added = lines(`${ROOT}/data/review/added/${lang}.jsonl`).filter((d) => fresh.some((r) => r.lemma === d.lemma && r.pos === d.pos && r.rank === d.rank));
  out.added = added.length;
  console.log(JSON.stringify(out, null, 1));
}
