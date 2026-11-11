// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Inflection tables for the frequency sets: conjugations of Spanish and Portuguese verbs, declensions of
// Russian, Ukrainian and Polish nouns, adjectives, pronouns and numerals. Each entry that gets a table gains
//   entry.paradigm = { kind, source, cells: { "<row>|<column>": [forms…] }, indeclinable?, notes?, gender? }
// (shared/paradigms.ts lays the cells out, labels them and picks the ones to drill).
import { existsSync } from 'node:fs';
import { key, log } from '../common.mjs';
import { readUnimorph, readVerbecc, verbTable } from './romance.mjs';
import {
  fromAttestations,
  fromUnimorphNominal,
  nominalKind,
  polishFromMorfologik,
  pruneVariants,
  readAttestations,
  readDmklingerTables,
  readOpenRussianTables,
  russianFromOpenRussian,
  ukrainianFromDmklinger,
  yoSpellings,
} from './nominal.mjs';
import { readMorfologik } from './morfologik.mjs';

const ud = (repo, prefix, parts) => parts.map((p) => `ud/${repo}/${prefix}-ud-${p}.conllu`);
const VERBECC = (lang) => ({
  conjugations: `verbecc/verbecc/data/xml/conjugations/conjugations-${lang}.xml`,
  verbs: `verbecc/verbecc/data/xml/verbs/verbs-${lang}.xml`,
});
const MORFOLOGIK = 'morfologik/morfologik-polish/src/main/resources/morfologik/stemming/polish';

/** Where each language's table sources live inside the sources directory (scripts/freq/fetch-sources.sh). */
export const PARADIGM_SOURCES = {
  es: { unimorph: 'unimorph-spa/spa', verbecc: VERBECC('es') },
  pt: { unimorph: 'unimorph-por/por', verbecc: VERBECC('pt') },
  ru: { openRussian: 'russian-dictionary', treebank: ud('UD_Russian-SynTagRus', 'ru_syntagrus', ['train-a', 'train-b', 'train-c', 'dev', 'test']) },
  uk: { dmklinger: 'dmklinger-ukrainian/words.json', unimorph: 'unimorph-ukr/ukr', treebank: ud('UD_Ukrainian-IU', 'uk_iu', ['train', 'dev', 'test']) },
  pl: { morfologik: { dict: `${MORFOLOGIK}/polish.dict`, info: `${MORFOLOGIK}/polish.info` } },
};

export const PARADIGM_DESCRIPTIONS = {
  es: 'Conjugation tables: UniMorph Spanish (unimorph/spa, generated from English Wiktionary; CC BY-SA 3.0); verbs that UniMorph lacks (its file stops after 2^20 verb rows) from the verbecc templates (bretttolbert/verbecc, GPL-2.0-or-later, derived from Verbiste), read by our own parser. Compound tenses are haber + participle; voseo forms that a source lacks are derived from the vosotros forms (habláis → hablás).',
  pt: 'Conjugation tables: UniMorph Portuguese (unimorph/por, from English Wiktionary; CC BY-SA 3.0) and the verbecc templates (bretttolbert/verbecc, GPL-2.0-or-later), compared cell by cell; Brazilian spelling of the 1990 Orthographic Agreement; imperatives derived from the present tenses; compound tenses are ter + participle.',
  ru: 'Declension tables: OpenRussian.org (Badestrand/russian-dictionary, CC BY-SA 4.0) for nouns and adjectives, with stress; pronouns and numerals from the forms annotated in the UD SynTagRus treebank (annotations only, no text; unstressed).',
  uk: 'Declension tables: dmklinger/ukrainian (CC BY-SA 3.0; tables from the ULIF grammatical dictionary), with stress; else UniMorph Ukrainian (CC BY-SA 3.0) or the forms annotated in the UD IU treebank (annotations only, no text).',
  pl: 'Declension tables: PoliMorf 2.1 in the Morfologik Polish dictionary (morfologik/morfologik-stemming, BSD-2-Clause), read by our own decoder; spelling variants under 1% of the main form\'s frequency are left out.',
};

/** Form counts from the stage-1 rank file (form → occurrences), for pruning rare spelling variants. */
function formCounts(ranks, lang) {
  if (!ranks?.ranked) return null;
  const counts = new Map();
  for (const r of ranks.ranked) for (const [form, n] of r.forms ?? []) counts.set(key(form, lang), (counts.get(key(form, lang)) ?? 0) + n);
  return counts;
}

const needsTable = (lang, e) => (lang === 'es' || lang === 'pt' ? e.pos === 'verb' : lang === 'ru' || lang === 'uk' || lang === 'pl' ? !!nominalKind(e.pos) : false);
const isInfinitive = (lang, lemma) => (lang === 'es' ? /(ar|er|ir|ír)$/.test(lemma) : /(ar|er|ir|or|ôr)$/.test(lemma));

/**
 * Give every entry that inflects a table, where a source has one. `src(p)` resolves a path inside the sources
 * directory. Returns stats for the build report.
 */
export async function attachParadigms(lang, entries, src, ranks) {
  const conf = PARADIGM_SOURCES[lang];
  const stats = { wanted: 0, withTable: 0, indeclinable: 0, bySource: {}, rules: {}, missing: [] };
  if (!conf) return stats;
  const wanted = entries.filter((e) => needsTable(lang, e));
  stats.wanted = wanted.length;
  const counts = formCounts(ranks, lang);
  const put = (e, p) => {
    if (!p) return false;
    if (p.cells && counts && lang !== 'es' && lang !== 'pt') pruneVariants(p.cells, counts, lang);
    e.paradigm = p;
    stats.withTable++;
    if (p.indeclinable) stats.indeclinable++;
    stats.bySource[p.source] = (stats.bySource[p.source] ?? 0) + 1;
    return true;
  };

  if (lang === 'es' || lang === 'pt') {
    const lemmas = new Set(wanted.map((e) => e.lemma));
    const um = existsSync(src(conf.unimorph)) ? await readUnimorph(src(conf.unimorph), lemmas) : new Map();
    const vc = readVerbecc(src(conf.verbecc.conjugations), src(conf.verbecc.verbs), lang);
    for (const e of wanted) {
      if (!isInfinitive(lang, e.lemma)) {
        stats.missing.push({ lemma: e.lemma, rank: e.frequencyRank, why: 'not an infinitive' });
        continue;
      }
      const t = verbTable(lang, e.lemma, um.get(e.lemma), vc.conjugate(e.lemma));
      if (!t) {
        stats.missing.push({ lemma: e.lemma, rank: e.frequencyRank, why: 'no source' });
        continue;
      }
      for (const [r, n] of Object.entries(t.rules)) stats.rules[r] = (stats.rules[r] ?? 0) + n;
      const source = { unimorph: 'UniMorph (Wiktionary)', verbecc: 'verbecc', 'unimorph+verbecc': 'UniMorph (Wiktionary) and verbecc' }[t.source];
      put(e, { kind: 'verb', source, cells: t.cells });
    }
    return stats;
  }

  if (lang === 'ru') {
    const tables = await readOpenRussianTables(src(conf.openRussian));
    const later = [];
    for (const e of wanted) if (!put(e, russianFromOpenRussian(e, tables.get(key(e.lemma, 'ru'))))) later.push(e);
    const atts = await readAttestations(conf.treebank.map(src), new Set(later.map((e) => key(e.lemma, 'ru'))), 'ru');
    const yo = yoSpellings(entries, tables);
    for (const e of later) if (!put(e, fromAttestations(e, atts.get(key(e.lemma, 'ru')), 'ru', 'SynTagRus annotations', yo))) stats.missing.push({ lemma: e.lemma, rank: e.frequencyRank, why: 'no source' });
    return stats;
  }

  if (lang === 'uk') {
    const tables = readDmklingerTables(src(conf.dmklinger));
    let later = [];
    for (const e of wanted) if (!put(e, ukrainianFromDmklinger(e, tables.get(key(e.lemma, 'uk'))))) later.push(e);
    if (existsSync(src(conf.unimorph))) {
      const um = await readUnimorph(src(conf.unimorph), new Set(later.map((e) => e.lemma)));
      later = later.filter((e) => !put(e, fromUnimorphNominal(e, um.get(e.lemma), 'uk')));
    }
    const atts = await readAttestations(conf.treebank.map(src), new Set(later.map((e) => key(e.lemma, 'uk'))), 'uk');
    for (const e of later) if (!put(e, fromAttestations(e, atts.get(key(e.lemma, 'uk')), 'uk', 'IU treebank annotations'))) stats.missing.push({ lemma: e.lemma, rank: e.frequencyRank, why: 'no source' });
    return stats;
  }

  if (lang === 'pl') {
    const t0 = Date.now();
    // PoliMorf files the reflexive pronoun under się.
    const lemmaOf = (e) => (e.lemma === 'siebie' ? 'się' : e.lemma);
    const rows = readMorfologik(src(conf.morfologik.dict), src(conf.morfologik.info), new Set(wanted.map(lemmaOf)));
    log(`[pl] Morfologik dictionary decoded in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    for (const e of wanted) if (!put(e, polishFromMorfologik(e, rows.get(lemmaOf(e)), counts))) stats.missing.push({ lemma: e.lemma, rank: e.frequencyRank, why: 'no source' });
    return stats;
  }
  return stats;
}

/** Report lines for the build report. */
export function paradigmReport(lang, stats) {
  if (!PARADIGM_DESCRIPTIONS[lang]) return [];
  const L = [];
  L.push(lang === 'es' || lang === 'pt' ? '## Conjugation tables' : '## Declension tables');
  L.push('');
  L.push(PARADIGM_DESCRIPTIONS[lang]);
  L.push('');
  const what = lang === 'es' || lang === 'pt' ? 'verbs' : 'nouns, adjectives, pronouns and numerals';
  L.push(`- ${what[0].toUpperCase() + what.slice(1)} in the set: ${stats.wanted.toLocaleString('en')}`);
  L.push(`- With a table: ${stats.withTable.toLocaleString('en')}${stats.indeclinable ? ` (${stats.indeclinable} of them indeclinable)` : ''}`);
  for (const [s, n] of Object.entries(stats.bySource)) L.push(`- From ${s}: ${n.toLocaleString('en')}`);
  if (Object.keys(stats.rules).length) {
    const r = stats.rules;
    const disagree = (r['split concatenation'] ?? 0) + (r.ending ?? 0) + (r.accents ?? 0) + (r['unimorph preferred'] ?? 0);
    L.push(`- Cells both sources have: ${((r.agree ?? 0) + disagree).toLocaleString('en')}, agreeing on ${(r.agree ?? 0).toLocaleString('en')}; of the ${disagree} others, ${r.ending ?? 0} were decided by the ending every verb has there, ${r.accents ?? 0} by accents, ${r['split concatenation'] ?? 0} were UniMorph cells holding two forms run together, and ${r['unimorph preferred'] ?? 0} kept UniMorph's form.`);
  }
  if (stats.missing.length) {
    L.push('');
    L.push(`Without a table (${stats.missing.length}): ${stats.missing.map((m) => m.lemma).join(', ')}.`);
  }
  L.push('');
  return L;
}

