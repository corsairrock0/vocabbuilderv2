#!/usr/bin/env node
// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Build the "most frequent words" sets in data/frequency/ from open frequency lists and English Wiktionary.
//
//   node scripts/freq/build.mjs --sources <dir> [--lang es,pt,…] [--top 6000] [--out data/frequency]
//   node scripts/freq/build.mjs --from-ranks --kaikki <lang>=<kaikki.jsonl[.gz]> … [--lang uk]
//
// --commercial-safe leaves out sentences from treebanks under non-commercial licences (SynTagRus, PDB, IU).
// --no-ai-sentences leaves out the AI-written sentences (data/ai-sentences/) for words no collection covers.
// --no-review builds without the meaning review (data/review/, see scripts/freq/review.mjs).
//
// Stage 1 (needs --sources, see fetch-sources.sh) turns a frequency list into lemma ranks and writes
//   <out>/ranks/<lang>.json.gz
// Stage 2 attaches definitions and parts of speech from English Wiktionary (and, for Ukrainian words
// that Wiktionary data lacks, from the dmklinger/ukrainian dictionary), then inflection tables
// (scripts/freq/paradigms/), cloze sentences (scripts/freq/sentences.mjs), the conjugation tables of
// Russian, Ukrainian and Polish verbs (scripts/freq/paradigms/verbs.mjs) and the gender and number tables of Spanish
// and Portuguese nouns, adjectives and determiners, with every language's forms lists cleaned
// (scripts/freq/paradigms/romance-nominal.mjs), and writes
//   <out>/<lang>.json                    vocabbuilder-v1 import file (the app's "Load the most frequent words")
//   <out>/reports/<lang>.md              what was used, coverage, and every word that was skipped
//   <out>/<lang>-sentence-credits.tsv    the source of every example sentence
// With --from-ranks, stage 1 is skipped and the shipped rank files are used, so a rebuild with a
// current Kaikki.org (Wiktextract) download needs only the Kaikki files.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { log } from './common.mjs';
import { loadDoozanDictionary, loadKaikkiDictionary, loadTsvDictionary, parseSense } from './wiktionary.mjs';
import { readDmklinger, readFrequencyWords, readMichmech, readOpenRussian, readSpacyPolish, readTreebank, readVnFreqs, readWordfreq } from './sources.mjs';
import { attachParadigms, paradigmReport, PARADIGM_DESCRIPTIONS } from './paradigms/index.mjs';
import { attachSentences, sentenceReport, SENTENCE_SOURCES } from './sentences.mjs';
import { respellSet } from './spelling.mjs';
import { lexiconFromAllforms, lexiconFromOpenRussian, rankFromForms, rankVietnamese, subtractSharedNames } from './rank.mjs';
import { attach } from './attach.mjs';
import { LANGUAGE_INFO } from './languages.mjs';
import { applyReview, loadReview, reviewReport } from './review.mjs';
import { applyTopics, loadTopicDecisions, topicsReport } from './topics.mjs';
import { applyCrude, applyCrudeMeanings, applyCrudeWords, crudeMeaningsReport, crudeReport, crudeWordsReport, loadCrudeDecisions, loadCrudeMeanings, loadCrudeWords } from './crude.mjs';
import { applyPolitics, loadPoliticsDecisions, politicsReport } from './politics.mjs';
import { addedReport, applyAdded, loadAdded } from './added.mjs';
import { attachVerbTables, verbTableReport } from './paradigms/verbs.mjs';
import { attachNominalTables, nominalReport, polishFormsOf } from './paradigms/romance-nominal.mjs';

function parseArgs(argv) {
  const o = { sources: null, langs: Object.keys(LANGUAGE_INFO), top: 6000, out: 'data/frequency', fromRanks: false, kaikki: {}, rankLimit: 15000 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`${a} needs a value`);
      return argv[++i];
    };
    if (a === '--sources') o.sources = next();
    else if (a === '--lang') o.langs = next().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--top') o.top = Number(next());
    else if (a === '--out') o.out = next();
    else if (a === '--from-ranks') o.fromRanks = true;
    else if (a === '--commercial-safe') o.commercialSafe = true;
    else if (a === '--no-ai-sentences') o.noAiSentences = true;
    else if (a === '--no-review') o.noReview = true;
    else if (a === '--kaikki') {
      const [lang, file] = next().split('=');
      if (!file) throw new Error('--kaikki takes <lang>=<file>');
      o.kaikki[lang] = file;
    } else if (a === '-h' || a === '--help') o.help = true;
    else throw new Error(`Unexpected argument: ${a}`);
  }
  for (const l of o.langs) if (!LANGUAGE_INFO[l]) throw new Error(`Unknown language: ${l}`);
  return o;
}

const src = (o, p) => {
  if (!o.sources) throw new Error('Stage 1 needs --sources <dir> (see scripts/freq/fetch-sources.sh), or use --from-ranks');
  return path.join(o.sources, p);
};

async function loadWiktionary(o, lang, info) {
  if (o.kaikki[lang]) return { dict: await loadKaikkiDictionary(o.kaikki[lang], lang), description: `Kaikki.org extraction of English Wiktionary (${path.basename(o.kaikki[lang])})` };
  const w = info.wiktionary;
  if (w.type === 'doozan') return { dict: await loadDoozanDictionary(src(o, w.path)), description: w.description };
  return { dict: await loadTsvDictionary(src(o, w.path), lang), description: w.description };
}

async function stage1(o, lang, info, dict, fallback) {
  const f = info.frequency;
  let list;
  if (f.type === 'vnfreqs') {
    const treebank = info.treebank ? await readTreebank(info.treebank.files.map((p) => src(o, p)), lang) : null;
    return { ...rankVietnamese(await readVnFreqs(src(o, f.path)), treebank), treebankTokens: treebank?.tokens ?? 0 };
  }
  if (f.type === 'wordfreq') list = readWordfreq(src(o, f.path), f.limit ?? 200000);
  else list = await readFrequencyWords(src(o, f.path));
  let lexicon = null;
  const lx = info.lexicon;
  if (lx.type === 'michmech') lexicon = await readMichmech(src(o, lx.path), lang);
  else if (lx.type === 'spacy-pl') lexicon = readSpacyPolish(src(o, lx.path));
  else if (lx.type === 'allforms') lexicon = await lexiconFromAllforms(src(o, lx.path));
  else if (lx.type === 'openrussian') lexicon = lexiconFromOpenRussian(await readOpenRussian(src(o, lx.path)));
  if (fallback?.lexicon) {
    // The fallback dictionary's inflection tables extend the lexicon (Ukrainian).
    for (const [fk, set] of fallback.lexicon.forms) {
      const cur = lexicon.forms.get(fk);
      if (cur) for (const l of set) cur.add(l);
      else lexicon.forms.set(fk, new Set(set));
    }
    for (const [k, v] of fallback.lexicon.spelling) if (!lexicon.spelling.has(k)) lexicon.spelling.set(k, v);
  }
  let namesRemoved = 0;
  if (info.names) {
    const n = info.names;
    const refList = await readFrequencyWords(src(o, n.list));
    const refWords = await referenceWords(o, n.lang);
    const r = subtractSharedNames(list, refList, (k) => refWords.has(k), lang, n.lang);
    list = r.list;
    namesRemoved = r.removedShare;
    log(`[${lang}] removed ${(100 * namesRemoved).toFixed(2)}% of tokens as names shared with ${n.lang} subtitles`);
  }
  const treebank = info.treebank ? await readTreebank(info.treebank.files.map((p) => src(o, p)), lang) : null;
  const rankDict = fallback ? mergeDicts(dict, fallback.dict) : dict;
  const r = rankFromForms(lang, list, { dict: rankDict, lexicon, treebank });
  return { ...r, stats: { ...r.stats, namesRemoved }, treebankTokens: treebank?.tokens ?? 0 };
}

/** Every word form of a reference language (to tell its own words from foreign names in its subtitles). */
async function referenceWords(o, lang) {
  const info = LANGUAGE_INFO[lang];
  const words = new Set();
  const dict = info.wiktionary.type === 'doozan' ? await loadDoozanDictionary(src(o, info.wiktionary.path)) : await loadTsvDictionary(src(o, info.wiktionary.path), lang);
  for (const k of dict.keys()) words.add(k);
  const lx = info.lexicon;
  const lexicon = lx.type === 'michmech' ? await readMichmech(src(o, lx.path), lang) : lx.type === 'allforms' ? await lexiconFromAllforms(src(o, lx.path)) : null;
  for (const k of lexicon?.forms.keys() ?? []) words.add(k);
  return words;
}

function mergeDicts(a, b) {
  const out = new Map(a);
  for (const [k, v] of b) out.set(k, [...(out.get(k) ?? []), ...v]);
  return out;
}

function writeGzJson(file, data) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, gzipSync(JSON.stringify(data)));
}

function readGzJson(file) {
  return JSON.parse(gunzipSync(readFileSync(file)).toString('utf8'));
}

function report(lang, info, { ranksMeta, result, wiktionaryDescription, top, fallbackDescription, extraSections = [] }) {
  const L = [];
  L.push(`# ${info.name}: the ${top.toLocaleString('en')} most frequent words`);
  L.push('');
  L.push('Generated by `scripts/freq/build.mjs`. Do not edit by hand; rebuild instead.');
  L.push('');
  L.push('## Sources');
  L.push('');
  L.push(`- **Frequency:** ${info.frequency.description}`);
  if (info.lexicon) L.push(`- **Lemmatization:** ${info.lexicon.description}`);
  if (info.treebank) L.push(`- **Disambiguation:** ${info.treebank.description}`);
  L.push(`- **Definitions and parts of speech:** ${wiktionaryDescription}`);
  if (fallbackDescription) L.push(`- **Definitions where Wiktionary data has no entry:** ${fallbackDescription}`);
  for (const extra of info.extras ?? []) L.push(`- ${extra}`);
  L.push('');
  L.push('## Coverage');
  L.push('');
  L.push(`- Words in the set: ${result.entries.length.toLocaleString('en')}`);
  for (const [s, n] of Object.entries(result.stats.bySource)) L.push(`- Definitions from ${s}: ${n.toLocaleString('en')}`);
  L.push(`- Ranked lemmas considered: ${result.stats.considered.toLocaleString('en')}`);
  L.push(`- Skipped because no dictionary had an entry: ${result.skipped.length.toLocaleString('en')}`);
  if (ranksMeta?.stats?.total) {
    const s = ranksMeta.stats;
    const pct = (x) => `${((100 * x) / s.total).toFixed(1)}%`;
    L.push(`- Frequency-list tokens assigned to lemmas: ${pct(s.total - s.unassignedMass - (s.properMass ?? 0))} (decided by the treebank ${pct(s.viaTreebank)}, shared by evidence ${pct(s.viaEm)}); proper nouns ${pct(s.properMass ?? 0)}; no lemma found ${pct(s.unassignedMass)}`);
    if (s.namesRemoved) L.push(`- Character names shared with other languages' subtitles, removed before ranking: ${(100 * s.namesRemoved).toFixed(1)}% of tokens`);
  }
  L.push('');
  L.push('Proper nouns, letters, affixes, abbreviations and symbols are never included.');
  if (result.excludedNames?.length) L.push(`Left out as subtitle character names that are also rare dictionary words: ${result.excludedNames.join(', ')}.`);
  L.push('');
  L.push(...extraSections);
  if (result.skipped.length) {
    L.push('## Skipped words');
    L.push('');
    L.push('Frequent lemmas that were left out because no dictionary used here has an entry for them. Many are names,');
    L.push('abbreviations or foreign words; the rest are real words a newer dictionary may define.');
    L.push('');
    L.push('| Position | Lemma | Estimated frequency |');
    L.push('|---:|---|---:|');
    for (const s of result.skipped) L.push(`| ${s.position} | ${s.lemma} | ${Math.round(s.count).toLocaleString('en')} |`);
    L.push('');
  }
  return L.join('\n');
}

async function buildLanguage(o, lang) {
  const info = LANGUAGE_INFO[lang];
  log(`\n[${lang}] ${info.name}`);
  const { dict, description: wiktionaryDescription } = await loadWiktionary(o, lang, info);
  log(`[${lang}] dictionary headwords: ${dict.size}`);
  let fallback = null;
  if (info.fallback && o.sources && existsSync(src(o, info.fallback.path))) {
    if (info.fallback.type === 'tsv') fallback = { dict: await loadTsvDictionary(src(o, info.fallback.path), lang), lexicon: null };
    else fallback = readDmklinger(src(o, info.fallback.path), parseSense);
    log(`[${lang}] fallback dictionary headwords: ${fallback.dict.size}`);
  }
  const ranksFile = path.join(o.out, 'ranks', `${lang}.json.gz`);
  let ranks;
  if (o.fromRanks) {
    ranks = readGzJson(ranksFile);
    log(`[${lang}] read ${ranks.ranked.length} ranked lemmas from ${ranksFile}`);
  } else {
    const r = await stage1(o, lang, info, dict, fallback);
    ranks = { language: lang, frequency: info.frequency.description, stats: r.stats ?? null, treebankTokens: r.treebankTokens ?? 0, ranked: r.ranked.slice(0, o.rankLimit) };
    writeGzJson(ranksFile, ranks);
    log(`[${lang}] ranked ${r.ranked.length} lemmas; wrote ${ranksFile}`);
    if (r.unassigned?.length) log(`[${lang}] most frequent unassigned forms: ${r.unassigned.slice(0, 40).map((x) => x.word).join(' ')}`);
  }
  let openRussian = null;
  if (lang === 'ru' && o.sources && !o.kaikki.ru) openRussian = await readOpenRussian(src(o, info.openRussian));
  const dicts = [{ name: 'wiktionary', dict, tag: null }];
  if (fallback) dicts.push({ name: info.fallback.name, dict: fallback.dict, tag: info.fallback.tag ?? null });
  const excluded = new Set(info.excludeAsNames ?? []);
  const ranked = ranks.ranked.filter((r) => !excluded.has(r.lemma));
  const result = attach(lang, ranked, { dicts, top: o.top, openRussian });
  result.excludedNames = [...excluded];
  log(`[${lang}] entries ${result.entries.length}, skipped ${result.skipped.length}, by source ${JSON.stringify(result.stats.bySource)}`);

  // Inflection tables and cloze sentences need the sources directory.
  const extraSections = [];
  let credits = [];
  let sentenceIds = [];
  if (o.sources) {
    const at = (p) => src(o, p);
    const pStats = await attachParadigms(lang, result.entries, at, ranks);
    log(`[${lang}] inflection tables: ${pStats.withTable} of ${pStats.wanted}`);
    extraSections.push(...paradigmReport(lang, pStats));
    const aiFile = o.noAiSentences ? null : fileURLToPath(new URL(`../../data/ai-sentences/${lang}.tsv`, import.meta.url));
    const { stats: sStats, credits: sentenceCredits } = await attachSentences(lang, result.entries, at, ranks, { nonCommercial: !o.commercialSafe, aiFile });
    credits = sentenceCredits;
    sentenceIds = Object.keys(sStats.bySource);
    log(`[${lang}] cloze sentences for ${sStats.withSentences} of ${sStats.entries} words`);
    extraSections.push(...sentenceReport(lang, sStats, result.entries));
    // Russian, Ukrainian and Polish verbs get their tables after the sentences are chosen, so they never widen the
    // sentence search (the reviewed sentences stay) (1.8.4).
    const vStats = await attachVerbTables(lang, result.entries, at, ranks);
    if (vStats.wanted) log(`[${lang}] verb tables: ${vStats.withTable} of ${vStats.wanted}`);
    extraSections.push(...verbTableReport(lang, vStats));
    // Spanish and Portuguese nouns, adjectives, determiners and pronouns get gender and number tables, and every
    // language's forms lists lose misspelt copies and forms of other words (1.8.5).
    const formsOf = lang === 'pl' ? polishFormsOf(at, result.entries.map((e) => e.lemma), existsSync) : null;
    const nStats = attachNominalTables(lang, result.entries, { formsOf });
    if (nStats.tables || nStats.formsDropped) log(`[${lang}] gender and number tables: ${nStats.tables}; forms left out: ${nStats.formsDropped}`);
    extraSections.push(...nominalReport(lang, nStats));
    // The meaning review: meanings checked against sentences, a sentence for every meaning, combinations listed.
    if (!o.noReview) {
      const r = applyReview(result.entries, loadReview(lang), credits);
      credits = r.credits;
      if (r.stats.added && !sentenceIds.includes('ai-claude')) sentenceIds.push('ai-claude');
      log(`[${lang}] meaning review: ${r.stats.reviewed} words, ${r.stats.dropped} sentences dropped, ${r.stats.added} added`);
      extraSections.push(...reviewReport(r.stats));
    }
    // Sentences on topics left out of the app are replaced (or dropped when no replacement is written yet).
    const t = applyTopics(lang, result.entries, loadTopicDecisions(lang), credits);
    credits = t.credits;
    if (t.stats.replaced && !sentenceIds.includes('ai-claude')) sentenceIds.push('ai-claude');
    log(`[${lang}] left-out topics: ${t.stats.replaced} replaced, ${t.stats.dropped + t.stats.undecided} dropped${t.stats.undecided ? ` (${t.stats.undecided} without a decision yet)` : ''}`);
    extraSections.push(...topicsReport(t.stats));
    // Crude sentences are replaced by clean ones (or dropped when the word itself is crude).
    const c = applyCrude(lang, result.entries, loadCrudeDecisions(lang), credits);
    credits = c.credits;
    if (c.stats.replaced && !sentenceIds.includes('ai-claude')) sentenceIds.push('ai-claude');
    log(`[${lang}] crude sentences: ${c.stats.replaced} replaced, ${c.stats.dropped + c.stats.undecided} dropped${c.stats.undecided ? ` (${c.stats.undecided} without a decision yet)` : ''}`);
    extraSections.push(...crudeReport(c.stats));
    // Crude slang meanings of other words are dropped and offensive glosses reworded.
    const m = applyCrudeMeanings(lang, result.entries, loadCrudeMeanings(lang));
    if (m.words) log(`[${lang}] crude meanings: ${m.dropped} dropped, ${m.reworded} glosses reworded`);
    extraSections.push(...crudeMeaningsReport(m));
    // Sentences on politics, war or living people are replaced (and the other country in the Ukrainian and Russian sets).
    const pol = applyPolitics(lang, result.entries, loadPoliticsDecisions(lang), credits);
    credits = pol.credits;
    if (pol.stats.replaced && !sentenceIds.includes('ai-claude')) sentenceIds.push('ai-claude');
    if (pol.stats.replaced || pol.stats.dropped || pol.stats.undecided) log(`[${lang}] politics, war, living people: ${pol.stats.replaced} replaced, ${pol.stats.dropped + pol.stats.undecided} dropped`);
    extraSections.push(...politicsReport(pol.stats));
    // Words that are crude in every meaning are left out of the set.
    const w = applyCrudeWords(result.entries, loadCrudeWords(lang), credits);
    result.entries = w.entries;
    credits = w.credits;
    if (w.removed.length) log(`[${lang}] crude words left out: ${w.removed.length}`);
    extraSections.push(...crudeWordsReport(w.removed));
    // Words left without any sentence get the ones written for them.
    const a = applyAdded(result.entries, loadAdded(lang), credits);
    credits = a.credits;
    if (a.stats.sentences && !sentenceIds.includes('ai-claude')) sentenceIds.push('ai-claude');
    if (a.stats.sentences) log(`[${lang}] sentences for words without any: ${a.stats.sentences} for ${a.stats.words} words`);
    extraSections.push(...addedReport(a.stats));
  }

  const doc = {
    format: 'vocabbuilder-v1',
    language: lang,
    source: {
      name: info.setName,
      kind: info.frequency.kind,
      license: 'CC-BY-SA-4.0',
      url: null,
      notes: [
        `The ${o.top.toLocaleString('en')} most frequent ${info.name} words, in frequency order.`,
        `Frequency: ${info.frequency.description}`,
        info.lexicon ? `Lemmatization: ${info.lexicon.description}` : null,
        info.treebank ? `Disambiguation: ${info.treebank.description}` : null,
        `Definitions and parts of speech: ${wiktionaryDescription}`,
        fallback ? `Words without an entry in the main dictionary${info.fallback.tag ? ` (tagged ${info.fallback.tag})` : ''}: ${info.fallback.description}` : null,
        ...(info.extras ?? []),
        o.sources && PARADIGM_DESCRIPTIONS[lang] ? PARADIGM_DESCRIPTIONS[lang] : null,
        sentenceIds.length ? `Example sentences: ${sentenceIds.map((id) => `${SENTENCE_SOURCES[id].name} (${SENTENCE_SOURCES[id].license}${SENTENCE_SOURCES[id].nonCommercial ? ', non-commercial use only' : ''})`).join('; ')}; the source of every sentence is listed in ${lang}-sentence-credits.tsv.` : null,
        'See docs/VOCABULARY_SOURCES.md for licences and attribution.',
      ]
        .filter(Boolean)
        .join('\n'),
    },
    // Where each example sentence comes from (examples refer to these ids).
    sentenceSources: Object.fromEntries(sentenceIds.map((id) => [id, { name: SENTENCE_SOURCES[id].name, license: SENTENCE_SOURCES[id].license, url: SENTENCE_SOURCES[id].url, ...(SENTENCE_SOURCES[id].ai ? { ai: true } : {}) }])),
    entries: result.entries,
  };
  mkdirSync(o.out, { recursive: true });
  // Last, so every way of making the set gives the same bytes: the app's spelling in the English of the set.
  respellSet(doc);
  const json = JSON.stringify(doc);
  writeFileSync(path.join(o.out, `${lang}.json`), json);
  mkdirSync(path.join(o.out, 'reports'), { recursive: true });
  writeFileSync(
    path.join(o.out, 'reports', `${lang}.md`),
    report(lang, info, { ranksMeta: ranks, result, wiktionaryDescription, top: o.top, fallbackDescription: fallback ? info.fallback.description : null, extraSections }),
  );
  if (credits.length) {
    const lines = ['lemma\tsentence\tsource', ...credits.map((c) => `${c.lemma}\t${c.text}\t${c.credit}`)];
    writeFileSync(path.join(o.out, `${lang}-sentence-credits.tsv`), lines.join('\n') + '\n');
  }
  // Summary the app reads to offer the set (server/vocab/importer.ts frequencySetIndex).
  const indexFile = path.join(o.out, 'index.json');
  const index = existsSync(indexFile) ? JSON.parse(readFileSync(indexFile, 'utf8')) : {};
  // version: the app offers an update to people who loaded an earlier version of the set.
  const version = createHash('sha256').update(json).digest('hex').slice(0, 12);
  index[lang] = { words: result.entries.length, name: info.setName, bySource: result.stats.bySource, skipped: result.skipped.length, builtAt: new Date().toISOString().slice(0, 10), version };
  writeFileSync(indexFile, JSON.stringify(Object.fromEntries(Object.entries(index).sort()), null, 2) + '\n');
  return result;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help) {
    process.stdout.write(readFileSync(new URL(import.meta.url)).toString().split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n') + '\n');
    return;
  }
  for (const lang of o.langs) await buildLanguage(o, lang);
}

main().catch((err) => {
  process.stderr.write(`${err.stack ?? err}\n`);
  process.exit(1);
});
