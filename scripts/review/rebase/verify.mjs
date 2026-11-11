// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Run the set build's steps after the review on the review bases, as apply-review.mjs does, and report what needs
// attention in the words the review newly covers: sentences a pass would leave out for want of a decision, crude or
// left-out wording in meanings and combinations, meanings left without a sentence, sentences without a meaning.
//   node rebase/verify.mjs [--lang es,pt] [--all]     --all: every reviewed word, not only the newly reviewed
import { readFileSync, existsSync } from 'node:fs';
const F = '/home/claude/vocabbuilder/scripts/freq';
const { applyReview, loadReview } = await import(`${F}/review.mjs`);
const { applyTopics, loadTopicDecisions, topicHits } = await import(`${F}/topics.mjs`);
const { applyCrude, applyCrudeMeanings, applyCrudeWords, crudeHits, loadCrudeDecisions, loadCrudeMeanings, loadCrudeWords } = await import(`${F}/crude.mjs`);
const { applyPolitics, loadPoliticsDecisions, politicsHits } = await import(`${F}/politics.mjs`);
const { applyAdded, loadAdded } = await import(`${F}/added.mjs`);
const BEFORE = '/home/claude/review/rebase/before-2026-11-10/review';
const args = process.argv.slice(2);
const LANGS = args.includes('--lang') ? args[args.indexOf('--lang') + 1].split(',') : ['es', 'pt', 'vi', 'ru', 'uk', 'pl'];
const ALL = args.includes('--all');
const lines = (f) => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)) : []);
const key = (e) => `${e.lemma}|${e.pos}|${e.frequencyRank}`;
let problems = 0;
const say = (lang, what, e, detail) => {
  problems++;
  console.log(`${lang} ${what}: ${e.lemma} (${e.pos}, ${e.frequencyRank}) ${detail}`);
};
for (const lang of LANGS) {
  const before = new Set(lines(`${BEFORE}/${lang}.jsonl`).map((r) => `${r.lemma}|${r.pos}|${r.rank}`));
  const review = loadReview(lang);
  const reviewed = new Set([...review.values()].flat().map((r) => `${r.lemma}|${r.pos}|${r.rank}`));
  const mine = (e) => reviewed.has(key(e)) && (ALL || !before.has(key(e)));
  const doc = JSON.parse(readFileSync(`/home/claude/review/base/${lang}.json`, 'utf8'));
  const r = applyReview(doc.entries, review, []);
  const t = applyTopics(lang, doc.entries, loadTopicDecisions(lang), r.credits);
  const c = applyCrude(lang, doc.entries, loadCrudeDecisions(lang), t.credits);
  const m = applyCrudeMeanings(lang, doc.entries, loadCrudeMeanings(lang));
  const pol = applyPolitics(lang, doc.entries, loadPoliticsDecisions(lang), c.credits);
  const w = applyCrudeWords(doc.entries, loadCrudeWords(lang), pol.credits);
  doc.entries = w.entries;
  const a = applyAdded(doc.entries, loadAdded(lang), w.credits);
  console.log(`${lang}: review ${JSON.stringify(r.stats)}`);
  console.log(`${lang}: topics ${JSON.stringify(t.stats)} crude ${JSON.stringify(c.stats)} politics ${JSON.stringify(pol.stats)} meanings ${JSON.stringify(m)} left out ${w.removed.length} added ${JSON.stringify(a.stats)}`);
  const freshKeys = new Set(doc.entries.filter(mine).map(key));
  for (const [name, open] of [['topics', t.open], ['crude', c.open], ['politics', pol.open]])
    for (const o of open) if (ALL || freshKeys.has(`${o.lemma}|${o.pos}|${o.rank}`)) say(lang, `${name}: no decision`, { lemma: o.lemma, pos: o.pos, frequencyRank: o.rank }, `"${o.text}" [${o.translation}] hits ${JSON.stringify(o.hits)}`);
  let noSentence = 0;
  for (const e of doc.entries) {
    if (!mine(e)) continue;
    e.senses.forEach((s, i) => {
      for (const [field, text] of [['gloss', s.gloss], ['note', s.note], ['definition', s.definition], ...((s.translations ?? []).map((x) => ['translation', x]))]) {
        if (!text) continue;
        const hits = [...crudeHits(lang, '', text).map((h) => `crude:${h}`), ...topicHits(lang, '', text).map((h) => `topic:${h}`), ...politicsHits(lang, '', text).map((h) => `politics:${h}`)];
        if (hits.length) say(lang, `meaning ${i} ${field}`, e, `"${text}" ${JSON.stringify(hits)}`);
      }
      if (!(e.examples ?? []).some((x) => x.sense === i)) {
        noSentence++;
        say(lang, 'meaning without a sentence', e, `${i}=${s.gloss} | has ${(e.examples ?? []).length} sentences: ${(e.examples ?? []).map((x) => `[${x.sense}] ${x.text}`).join(' / ').slice(0, 300)}`);
      }
    });
    for (const x of e.examples ?? []) if (!Number.isInteger(x.sense) || x.sense < 0 || x.sense >= e.senses.length) say(lang, 'sentence without a meaning', e, `"${x.text}" sense ${x.sense}`);
    if (!(e.examples ?? []).length) say(lang, 'no sentence at all', e, '');
    const texts = (e.examples ?? []).map((x) => x.text.normalize('NFC').replace(/\s+/g, ' ').trim());
    for (const t of new Set(texts.filter((t, i) => texts.indexOf(t) !== i))) say(lang, 'sentence twice', e, `"${t}"`);
    for (const x of e.examples ?? []) if (!x.target || !x.text.normalize('NFC').toLowerCase().includes(x.target.normalize('NFC').toLowerCase())) say(lang, 'target not in sentence', e, `"${x.text}" {${x.target}}`);
    for (const x of e.expressions ?? []) {
      const hits = [...crudeHits(lang, x.text, x.translation).map((h) => `crude:${h}`), ...topicHits(lang, x.text, x.translation).map((h) => `topic:${h}`), ...politicsHits(lang, x.text, x.translation).map((h) => `politics:${h}`)];
      if (hits.length) say(lang, 'combination', e, `"${x.text}" = "${x.translation}" ${JSON.stringify(hits)}`);
    }
  }
  console.log(`${lang}: ${freshKeys.size} words checked, ${noSentence} meanings without a sentence\n`);
}
console.log(`${problems} to look at`);
