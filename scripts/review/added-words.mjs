// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// List the words of each set that have no example sentence once every other pass has run (the input of the pass that
// writes sentences for them): node words.mjs [--base /home/claude/review/base] [langs]
// Writes words/<lang>.jsonl: lemma, pos, rank, glosses (numbered from 0) and forms. The words that name a left-out
// subject themselves (árabe, біблія, Ukrainian російський, Russian украинский) were then moved by hand to
// words/<lang>-topics.jsonl, for the owner to decide how to treat them (1.8.3: neutral, plain-fact sentences).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { applyReview, loadReview } from '/home/claude/vocabbuilder/scripts/freq/review.mjs';
import { applyTopics, loadTopicDecisions } from '/home/claude/vocabbuilder/scripts/freq/topics.mjs';
import { applyCrude, applyCrudeMeanings, applyCrudeWords, loadCrudeDecisions, loadCrudeMeanings, loadCrudeWords } from '/home/claude/vocabbuilder/scripts/freq/crude.mjs';
import { applyPolitics, loadPoliticsDecisions } from '/home/claude/vocabbuilder/scripts/freq/politics.mjs';

const args = process.argv.slice(2);
const at = args.indexOf('--base');
const base = at >= 0 ? args[at + 1] : '/home/claude/review/base';
const langs = (args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--base') ?? 'es,pt,vi,ru,uk,pl').split(',');
const ROOT = '/home/claude/added';
mkdirSync(path.join(ROOT, 'words'), { recursive: true });
for (const lang of langs) {
  const doc = JSON.parse(readFileSync(path.join(base, `${lang}.json`), 'utf8'));
  // The same order as scripts/freq/apply-review.mjs, up to (not including) the sentences this pass writes.
  applyReview(doc.entries, loadReview(lang), []);
  applyTopics(lang, doc.entries, loadTopicDecisions(lang), []);
  applyCrude(lang, doc.entries, loadCrudeDecisions(lang), []);
  applyCrudeMeanings(lang, doc.entries, loadCrudeMeanings(lang));
  applyPolitics(lang, doc.entries, loadPoliticsDecisions(lang), []);
  const entries = applyCrudeWords(doc.entries, loadCrudeWords(lang), []).entries;
  const bare = entries
    .filter((e) => !(e.examples ?? []).length)
    .map((e) => ({ lemma: e.lemma, pos: e.pos, rank: e.frequencyRank, glosses: e.senses.map((s) => s.gloss), forms: [...new Set([e.lemma, ...(e.forms ?? []).map((f) => f.form)])] }));
  writeFileSync(path.join(ROOT, 'words', `${lang}.all.jsonl`), bare.map((w) => JSON.stringify(w)).join('\n') + (bare.length ? '\n' : ''));
  console.log(`${lang}: ${bare.length} words without a sentence -> words/${lang}.all.jsonl`);
}
