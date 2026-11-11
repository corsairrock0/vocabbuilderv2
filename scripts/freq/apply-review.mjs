#!/usr/bin/env node
// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Apply the meaning review (data/review/<lang>.jsonl) to already built sets, without a full rebuild.
//
//   node scripts/freq/apply-review.mjs --base <dir> [--lang es,pt,…] [--out data/frequency]
//
// <dir> holds the sets as built without the review (<lang>.json and <lang>-sentence-credits.tsv, for example from
// `build.mjs --no-review --out <dir>`). Writes <out>/<lang>.json, the credits, the report's review section and the
// set's version in <out>/index.json. A full `build.mjs` run applies the review itself and gives the same result.
import { existsSync, readFileSync, renameSync, writeFileSync as writeNow } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { applyReview, loadReview, reviewReport } from './review.mjs';
import { applyTopics, loadTopicDecisions, topicsReport } from './topics.mjs';
import { applyCrude, applyCrudeMeanings, applyCrudeWords, crudeMeaningsReport, crudeReport, crudeWordsReport, loadCrudeDecisions, loadCrudeMeanings, loadCrudeWords } from './crude.mjs';
import { applyPolitics, loadPoliticsDecisions, politicsReport } from './politics.mjs';
import { addedReport, applyAdded, loadAdded } from './added.mjs';
import { SENTENCE_SOURCES } from './sentences.mjs';
import { respellSet } from './spelling.mjs';

const o = { base: null, langs: ['es', 'pt', 'vi', 'ru', 'uk', 'pl'], out: 'data/frequency' };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--base') o.base = argv[++i];
  else if (argv[i] === '--lang') o.langs = argv[++i].split(',');
  else if (argv[i] === '--out') o.out = argv[++i];
  else throw new Error(`Unexpected argument: ${argv[i]}`);
}
if (!o.base) throw new Error('--base <dir> is required: the sets as built without the review');
if (path.resolve(o.base) === path.resolve(o.out)) throw new Error('--base and --out must differ, so the review is never applied twice');

// Written to a temporary file and renamed, so a reader never sees half a set.
function writeFileSync(file, data) {
  writeNow(`${file}.tmp`, data);
  renameSync(`${file}.tmp`, file);
}

const indexFile = path.join(o.out, 'index.json');
const index = existsSync(indexFile) ? JSON.parse(readFileSync(indexFile, 'utf8')) : {};
for (const lang of o.langs) {
  const doc = JSON.parse(readFileSync(path.join(o.base, `${lang}.json`), 'utf8'));
  const creditFile = path.join(o.base, `${lang}-sentence-credits.tsv`);
  const credits = existsSync(creditFile)
    ? readFileSync(creditFile, 'utf8')
        .split('\n')
        .slice(1)
        .filter(Boolean)
        .map((l) => {
          const [lemma, text, credit] = l.split('\t');
          return { lemma, text, credit };
        })
    : [];
  const r = applyReview(doc.entries, loadReview(lang), credits);
  const t = applyTopics(lang, doc.entries, loadTopicDecisions(lang), r.credits);
  const c = applyCrude(lang, doc.entries, loadCrudeDecisions(lang), t.credits);
  const m = applyCrudeMeanings(lang, doc.entries, loadCrudeMeanings(lang));
  // After the meanings step, so politics decisions use the meaning numbers the set shows.
  const pol = applyPolitics(lang, doc.entries, loadPoliticsDecisions(lang), c.credits);
  const w = applyCrudeWords(doc.entries, loadCrudeWords(lang), pol.credits);
  doc.entries = w.entries;
  const a = applyAdded(doc.entries, loadAdded(lang), w.credits);
  r.credits = a.credits;
  if ((r.stats.added || t.stats.replaced || c.stats.replaced || pol.stats.replaced || a.stats.sentences) && !doc.sentenceSources['ai-claude']) {
    const s = SENTENCE_SOURCES['ai-claude'];
    doc.sentenceSources['ai-claude'] = { name: s.name, license: s.license, url: s.url, ai: true };
  }
  // Last, so every way of making the set gives the same bytes: the app's spelling in the English of the set.
  respellSet(doc);
  const json = JSON.stringify(doc);
  writeFileSync(path.join(o.out, `${lang}.json`), json);
  writeFileSync(path.join(o.out, `${lang}-sentence-credits.tsv`), ['lemma\tsentence\tsource', ...r.credits.map((c) => `${c.lemma}\t${c.text}\t${c.credit}`)].join('\n') + '\n');
  const reportFile = path.join(o.out, 'reports', `${lang}.md`);
  if (existsSync(reportFile)) {
    const report = readFileSync(reportFile, 'utf8')
      .replace(/\n## Meaning review\n[\s\S]*?(?=\n## |$)/, '')
      .replace(/\n## Sentences on left-out topics\n[\s\S]*?(?=\n## |$)/, '')
      .replace(/\n## Crude sentences\n[\s\S]*?(?=\n## |$)/, '')
      .replace(/\n## Crude meanings\n[\s\S]*?(?=\n## |$)/, '')
      .replace(/\n## Sentences on politics, war or living people\n[\s\S]*?(?=\n## |$)/, '')
      .replace(/\n## Words left out as crude\n[\s\S]*?(?=\n## |$)/, '')
      .replace(/\n## Sentences for words left without any\n[\s\S]*?(?=\n## |$)/, '');
    writeFileSync(reportFile, report.replace(/\s*$/, '\n\n') + [...reviewReport(r.stats), ...topicsReport(t.stats), ...crudeReport(c.stats), ...politicsReport(pol.stats), ...crudeMeaningsReport(m), ...crudeWordsReport(w.removed), ...addedReport(a.stats)].join('\n'));
  }
  if (index[lang]) {
    index[lang].version = createHash('sha256').update(json).digest('hex').slice(0, 12);
    index[lang].words = doc.entries.length;
  }
  console.log(`${lang}: review ${JSON.stringify(r.stats)}\n${lang}: topics ${JSON.stringify(t.stats)}\n${lang}: crude ${JSON.stringify(c.stats)}, politics ${JSON.stringify(pol.stats)}, meanings ${JSON.stringify(m)}, words left out ${w.removed.length}, added ${JSON.stringify(a.stats)}`);
}
writeFileSync(indexFile, JSON.stringify(Object.fromEntries(Object.entries(index).sort()), null, 2) + '\n');
