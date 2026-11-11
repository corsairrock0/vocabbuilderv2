// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Conjugation tables for Russian, Ukrainian and Polish verbs (1.8.4).
//
//   Russian    OpenRussian.org verbs.csv (Badestrand/russian-dictionary, CC BY-SA 4.0), with stress
//   Ukrainian  dmklinger/ukrainian (CC BY-SA 3.0; tables from the ULIF grammatical dictionary), with stress
//   Polish     PoliMorf as packaged in the Morfologik Polish dictionary (BSD-2-Clause), read by morfologik.mjs
//
// Cell keys are "<row>|<column>" (shared/paradigms.ts lays them out and labels them):
//   pres|1s … pres|3p        present (imperfective verbs)
//   fut|1s … fut|3p          future: the simple future of a perfective verb, the one-word future of a Ukrainian
//                            imperfective (писатиму), the future of Russian быть, Ukrainian бути and Polish być
//   past|m past|f past|n past|pl                 past (Russian, Ukrainian)
//   past|1s.m past|1s.f past|2s.m past|2s.f past|3s.m past|3s.f past|3s.n
//   past|1p.vir past|1p.nvir past|2p.vir past|2p.nvir past|3p.vir past|3p.nvir      past (Polish)
//   cond|…                   conditional (Polish), the same columns as its past
//   imp|2s imp|1p imp|2p     imperative
//   nfin|inf  infinitive; nfin|adv  adverbial participle (mając, маючи); nfin|adv.past  past adverbial participle
//   (napisawszy, написавши); nfin|imps  impersonal form (pisano, писано); part|act  active participle (mający);
//   part|pass  passive participle (pisany, писаний)
//
// build.mjs attaches them after the cloze sentences are chosen, so a verb's table never widens the sentence search
// and a rebuilt set keeps the sentences that were reviewed. add-verb-tables.mjs gives an already built set the same.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { foldLatinDiacritics, key, lines, log, stripStress } from '../common.mjs';
import { openRussianStress } from '../sources.mjs';
import { readMorfologik } from './morfologik.mjs';
import { pruneVariants } from './nominal.mjs';

const MORFOLOGIK = 'morfologik/morfologik-polish/src/main/resources/morfologik/stemming/polish';

/** Where each language's verb sources live inside the sources directory (scripts/freq/fetch-sources.sh). */
export const VERB_SOURCES = {
  ru: { openRussian: 'russian-dictionary' },
  uk: { dmklinger: 'dmklinger-ukrainian/words.json' },
  pl: { morfologik: { dict: `${MORFOLOGIK}/polish.dict`, info: `${MORFOLOGIK}/polish.info` } },
};

export const VERB_DESCRIPTIONS = {
  ru: 'Conjugation tables: OpenRussian.org verbs (Badestrand/russian-dictionary, CC BY-SA 4.0), with stress: the present or simple future, the past, the imperative and the infinitive. The future of an imperfective verb is буду + infinitive.',
  uk: 'Conjugation tables: dmklinger/ukrainian (CC BY-SA 3.0; tables from the ULIF grammatical dictionary), with stress: the present, the future (simple, or the one-word future of imperfective verbs), the past, the imperative, the infinitive and the participles; short colloquial forms (пишем, писать) are left out.',
  pl: 'Conjugation tables: PoliMorf 2.1 in the Morfologik Polish dictionary (morfologik/morfologik-stemming, BSD-2-Clause), read by our own decoder: the present or simple future, the past and the conditional by person and gender, the imperative, the infinitive and the participles; emphatic imperatives (bądźże) and spelling variants under 1% of the main form\'s frequency are left out.',
};

const PERSONS = ['1s', '2s', '3s', '1p', '2p', '3p'];

function add(cells, k, form) {
  const f = String(form ?? '').normalize('NFC').trim();
  if (!f || f === '-' || f === '—') return;
  const list = cells[k] ?? (cells[k] = []);
  if (!list.includes(f)) list.push(f);
}

const ASPECT_NOTE = { imperf: 'imperfective', perf: 'perfective', both: 'imperfective and perfective' };
const FUTURE_NOTE = { ru: 'future: буду + infinitive', uk: 'future: буду + infinitive', pl: 'future: będę + infinitive' };
const CONDITIONAL_NOTE = { ru: 'conditional: past + бы', uk: 'conditional: past + б or би' };

function notesFor(lang, aspect, cells) {
  const notes = [];
  const has = (row) => Object.keys(cells).some((k) => k.startsWith(`${row}|`));
  if (ASPECT_NOTE[aspect]) notes.push(ASPECT_NOTE[aspect]);
  // The compound future, for imperfective verbs only (a perfective verb's present forms are its future).
  // Ukrainian imperfectives also have a one-word future (писатиму), shown in the table.
  if ((aspect === 'imperf' || aspect === 'both') && has('pres') && (!has('fut') || lang === 'uk')) notes.push(has('fut') ? 'future also: буду + infinitive' : FUTURE_NOTE[lang]);
  if (CONDITIONAL_NOTE[lang] && has('past')) notes.push(CONDITIONAL_NOTE[lang]);
  return notes;
}

function finish(lang, source, cells, aspect) {
  if (!Object.keys(cells).some((k) => !k.startsWith('nfin|'))) return null;
  const notes = notesFor(lang, aspect, cells);
  return { kind: 'verb', source, cells, ...(notes.length ? { notes } : {}) };
}

// ------------------------------------------------------------------ Russian

/** OpenRussian verbs.csv rows by stress-free key. */
export async function readOpenRussianVerbs(dir) {
  const out = new Map();
  let header = null;
  for await (const line of lines(path.join(dir, 'verbs.csv'))) {
    const cols = line.split('\t');
    if (!header) {
      header = cols;
      continue;
    }
    const row = Object.fromEntries(header.map((h, i) => [h, cols[i] ?? '']));
    if (!row.bare) continue;
    const k = key(row.bare, 'ru');
    const list = out.get(k) ?? [];
    list.push(row);
    out.set(k, list);
  }
  return out;
}

const RU_ASPECT = { imperfective: 'imperf', perfective: 'perf', both: 'both' };
const orForms = (v) =>
  String(v ?? '')
    .split(/\s*[,;]\s*/)
    .map((x) => openRussianStress(x.replace(/[()*]/g, '')))
    .filter((x) => x && /^[а-яё́-]+$/iu.test(x));

/** The future of быть, which OpenRussian files as its present (есть in every person). */
const RU_BYT_FUTURE = ['бу́ду', 'бу́дешь', 'бу́дет', 'бу́дем', 'бу́дете', 'бу́дут'];

export function russianVerbFromOpenRussian(entry, rows) {
  if (!rows?.length) return null;
  const want = entry.aspect === 'perfective' ? 'perfective' : entry.aspect === 'imperfective' ? 'imperfective' : null;
  const row = (want && rows.find((r) => r.aspect === want)) ?? rows[0];
  const aspect = RU_ASPECT[row.aspect] ?? null;
  const cells = {};
  for (const f of orForms(row.accented || row.bare)) add(cells, 'nfin|inf', f);
  const tense = aspect === 'perf' ? 'fut' : 'pres';
  const presfut = { '1s': row.presfut_sg1, '2s': row.presfut_sg2, '3s': row.presfut_sg3, '1p': row.presfut_pl1, '2p': row.presfut_pl2, '3p': row.presfut_pl3 };
  if (stripStress(entry.lemma) === 'быть') PERSONS.forEach((p, i) => add(cells, `fut|${p}`, RU_BYT_FUTURE[i]));
  else for (const p of PERSONS) for (const f of orForms(presfut[p])) add(cells, `${tense}|${p}`, f);
  for (const [col, v] of [['m', row.past_m], ['f', row.past_f], ['n', row.past_n], ['pl', row.past_pl]]) for (const f of orForms(v)) add(cells, `past|${col}`, f);
  for (const f of orForms(row.imperative_sg)) add(cells, 'imp|2s', f);
  for (const f of orForms(row.imperative_pl)) add(cells, 'imp|2p', f);
  return finish('ru', 'OpenRussian.org', cells, stripStress(entry.lemma) === 'быть' ? null : aspect);
}

// ------------------------------------------------------------------ Ukrainian

/** dmklinger verbs by stress-free key: [{ word, info, forms }]. */
export function readDmklingerVerbs(file) {
  const out = new Map();
  for (const w of JSON.parse(readFileSync(file, 'utf8'))) {
    if (w.pos !== 'verb' || !w.forms || typeof w.forms !== 'object' || !Object.keys(w.forms).length) continue;
    const k = key(stripStress(String(w.word ?? '')), 'uk');
    const list = out.get(k) ?? [];
    list.push({ word: w.word, info: w.info ?? null, forms: w.forms });
    out.set(k, list);
  }
  return out;
}

const UK_ASPECT = { imperfective: 'imperf', perfective: 'perf', 'imperfective or perfective': 'both' };

/** мати "to have": dmklinger files only the noun мати "mother". */
const UK_BUILT_IN = {
  мати: {
    info: 'imperfective',
    forms: {
      inf: ['ма́ти'],
      pres: { '1s': ['ма́ю'], '2s': ['ма́єш'], '3s': ['ма́є'], '1p': ['ма́ємо'], '2p': ['ма́єте'], '3p': ['ма́ють'], pp: { adv: ['ма́ючи'] } },
      fut: { '1s': ['ма́тиму'], '2s': ['ма́тимеш'], '3s': ['ма́тиме'], '1p': ['ма́тимемо'], '2p': ['ма́тимете'], '3p': ['ма́тимуть'] },
      past: { ms: ['мав'], fs: ['ма́ла'], ns: ['ма́ло'], p: ['ма́ли'], pp: { adv: ['ма́вши'] } },
      imp: { '2s': ['май'], '1p': ['ма́ймо'], '2p': ['ма́йте'] },
    },
  },
};

/**
 * Ukrainian short colloquial forms beside the literary ones: a first person plural without its final -о (пишем beside
 * пишемо, пишім beside пишімо) and an infinitive in -ть beside the one in -ти (писать beside писати).
 */
function dropColloquial(cells) {
  for (const [k, forms] of Object.entries(cells)) {
    const plain = new Set(forms.map((f) => stripStress(f)));
    const kept = forms.filter((f) => {
      const p = stripStress(f);
      if (k.endsWith('|1p') && !p.endsWith('о') && plain.has(`${p}о`)) return false;
      if (k === 'nfin|inf' && p.endsWith('ть') && plain.has(`${p.slice(0, -2)}ти`)) return false;
      return true;
    });
    cells[k] = kept.length ? kept : forms;
  }
}

/** Archaic forms of бути (єси, суть): the present is є in every person. */
const UK_ARCHAIC = new Set(['єси', 'суть']);

export function ukrainianVerbFromDmklinger(entry, rows) {
  const plainLemma = stripStress(entry.lemma);
  const hit = UK_BUILT_IN[plainLemma] ?? rows?.find((r) => !entry.aspect || UK_ASPECT[r.info] === RU_ASPECT[entry.aspect]) ?? rows?.[0];
  if (!hit) return null;
  const f = hit.forms;
  const cells = {};
  for (const x of f.inf ?? []) add(cells, 'nfin|inf', x);
  for (const tense of ['pres', 'fut']) for (const p of PERSONS) for (const x of f[tense]?.[p] ?? []) if (!UK_ARCHAIC.has(stripStress(x))) add(cells, `${tense}|${p}`, x);
  for (const [src, col] of [['ms', 'm'], ['fs', 'f'], ['ns', 'n'], ['p', 'pl']]) for (const x of f.past?.[src] ?? []) add(cells, `past|${col}`, x);
  for (const p of ['2s', '1p', '2p']) for (const x of f.imp?.[p] ?? []) add(cells, `imp|${p}`, x);
  for (const x of f.pres?.pp?.adv ?? []) add(cells, 'nfin|adv', x);
  for (const x of f.past?.pp?.adv ?? []) add(cells, 'nfin|adv.past', x);
  for (const x of f.past?.pp?.imp ?? []) add(cells, 'nfin|imps', x);
  for (const x of f.past?.pp?.pas ?? []) add(cells, 'part|pass', x);
  dropColloquial(cells);
  // бути has its own future (буду), so neither an aspect nor "буду + infinitive" is noted.
  return finish('uk', UK_BUILT_IN[plainLemma] ? 'VocabBuilder' : 'dmklinger/ukrainian', cells, plainLemma === 'бути' ? null : (UK_ASPECT[hit.info] ?? null));
}

// ------------------------------------------------------------------ Polish

const PL_PERSON = { pri: '1', sec: '2', ter: '3' };

/** The column of a past or conditional form: person, number and gender (1s.m, 3s.n, 2p.vir). Null for 1st/2nd person neuter. */
function polishPastColumn(number, genders, person) {
  const p = PL_PERSON[person];
  if (!p) return null;
  const g = genders.split('.');
  if (number === 'sg') {
    const gender = g.includes('m1') ? 'm' : g.includes('f') ? 'f' : g.includes('n1') || g.includes('n2') ? 'n' : null;
    if (!gender || (gender === 'n' && p !== '3')) return null;
    return `${p}s.${gender}`;
  }
  if (number === 'pl') return `${p}p.${g.includes('m1') ? 'vir' : 'nvir'}`;
  return null;
}

/** One Morfologik tag (verb:praet:sg:m1.m2.m3:pri:imperf:nonrefl, pcon:imperf:nonrefl …) → its cell, or null. */
export function polishVerbCell(tag) {
  const t = tag.split(':');
  const aspect = t.find((x) => x === 'imperf' || x === 'perf' || x === 'imperf.perf') ?? null;
  if (t.includes('neg')) return null;
  if (t[0] === 'verb') {
    if (t[1] === 'inf') return { cell: 'nfin|inf', aspect };
    if (t[1] === 'imps') return { cell: 'nfin|imps', aspect };
    if (t[1] === 'fin' || t[1] === 'bedzie') {
      const person = PL_PERSON[t[3]];
      if (!person || (t[2] !== 'sg' && t[2] !== 'pl')) return null;
      const tense = t[1] === 'bedzie' || aspect === 'perf' ? 'fut' : 'pres';
      return { cell: `${tense}|${person}${t[2] === 'sg' ? 's' : 'p'}`, aspect };
    }
    if (t[1] === 'praet' || t[1] === 'pot') {
      const col = polishPastColumn(t[2], t[3] ?? '', t[4]);
      return col ? { cell: `${t[1] === 'praet' ? 'past' : 'cond'}|${col}`, aspect } : null;
    }
    if (t[1] === 'impt') {
      const cell = t[2] === 'sg' && t[3] === 'sec' ? 'imp|2s' : t[2] === 'pl' && t[3] === 'pri' ? 'imp|1p' : t[2] === 'pl' && t[3] === 'sec' ? 'imp|2p' : null;
      return cell ? { cell, aspect } : null;
    }
    return null;
  }
  if (t[0] === 'pcon') return { cell: 'nfin|adv', aspect };
  if (t[0] === 'pant') return { cell: 'nfin|adv.past', aspect };
  // Participles: the nominative singular masculine stands for the whole adjective-like declension.
  if ((t[0] === 'pact' || t[0] === 'ppas') && t[1] === 'sg' && t[2]?.split('.').includes('nom') && t[3]?.split('.').includes('m1')) return { cell: t[0] === 'pact' ? 'part|act' : 'part|pass', aspect };
  return null;
}

/** Emphatic imperatives (bądźże, bądźmyż) beside the plain ones. */
function dropEmphatic(cells) {
  for (const k of ['imp|2s', 'imp|1p', 'imp|2p']) {
    const forms = cells[k];
    if (!forms) continue;
    const kept = forms.filter((f) => !((f.endsWith('że') && forms.includes(f.slice(0, -2))) || (f.endsWith('ż') && forms.includes(f.slice(0, -1)))));
    cells[k] = kept.length ? kept : forms;
  }
}

export function polishVerbFromMorfologik(entry, rows, counts = null) {
  if (!rows?.length) return null;
  const cells = {};
  const aspects = new Set();
  for (const [form, tags] of rows) {
    for (const tag of String(tags).split('+')) {
      const hit = polishVerbCell(tag);
      if (!hit) continue;
      add(cells, hit.cell, form);
      if (hit.aspect) aspects.add(hit.aspect);
    }
  }
  dropEmphatic(cells);
  if (counts) pruneVariants(cells, counts, 'pl', { sort: true });
  const aspect = aspects.has('imperf.perf') || (aspects.has('imperf') && aspects.has('perf')) ? 'both' : aspects.has('perf') ? 'perf' : aspects.has('imperf') ? 'imperf' : null;
  return finish('pl', 'PoliMorf (Morfologik)', cells, entry.lemma === 'być' ? null : aspect);
}

// ------------------------------------------------------------------ forms

/**
 * A Polish word's dictionary forms without their diacritics (miec beside mieć, mial beside miał: typed without Polish
 * letters in the corpora behind the frequency lists): dropped when the table spells them properly. Returns the count.
 */
export function dropUndiacritised(entry, cells) {
  if (!entry.forms?.length) return 0;
  const inTable = new Set(Object.values(cells).flat().map((f) => stripStress(f).toLowerCase()));
  const folded = new Set([...inTable].map((f) => foldLatinDiacritics(f)));
  const before = entry.forms.length;
  entry.forms = entry.forms.filter((f) => {
    const form = String(f.form ?? '').toLowerCase();
    if (inTable.has(form)) return true;
    return !(foldLatinDiacritics(form) === form && folded.has(form));
  });
  return before - entry.forms.length;
}

// ------------------------------------------------------------------ attaching

/** Form counts from the stage-1 rank file (form → occurrences), for pruning rare spelling variants. */
export function verbFormCounts(ranks, lang) {
  if (!ranks?.ranked) return null;
  const counts = new Map();
  for (const r of ranks.ranked) for (const [form, n] of r.forms ?? []) counts.set(key(form, lang), (counts.get(key(form, lang)) ?? 0) + n);
  return counts;
}

/**
 * Give every verb of a Russian, Ukrainian or Polish set its conjugation table, where a source has one. `src(p)`
 * resolves a path inside the sources directory. Returns stats for the build report.
 */
export async function attachVerbTables(lang, entries, src, ranks) {
  const conf = VERB_SOURCES[lang];
  const stats = { wanted: 0, withTable: 0, bySource: {}, missing: [], formsDropped: 0 };
  if (!conf) return stats;
  const wanted = entries.filter((e) => e.pos === 'verb');
  stats.wanted = wanted.length;
  const counts = verbFormCounts(ranks, lang);
  const put = (e, p) => {
    if (!p) return false;
    if (lang !== 'pl' && counts) pruneVariants(p.cells, counts, lang);
    e.paradigm = p;
    stats.withTable++;
    stats.bySource[p.source] = (stats.bySource[p.source] ?? 0) + 1;
    if (lang === 'pl') stats.formsDropped += dropUndiacritised(e, p.cells);
    return true;
  };
  if (lang === 'ru') {
    const rows = await readOpenRussianVerbs(src(conf.openRussian));
    for (const e of wanted) if (!put(e, russianVerbFromOpenRussian(e, rows.get(key(e.lemma, 'ru'))))) stats.missing.push({ lemma: e.lemma, rank: e.frequencyRank });
  } else if (lang === 'uk') {
    const rows = readDmklingerVerbs(src(conf.dmklinger));
    for (const e of wanted) if (!put(e, ukrainianVerbFromDmklinger(e, rows.get(key(stripStress(e.lemma), 'uk'))))) stats.missing.push({ lemma: e.lemma, rank: e.frequencyRank });
  } else if (lang === 'pl') {
    const t0 = Date.now();
    const rows = readMorfologik(src(conf.morfologik.dict), src(conf.morfologik.info), new Set(wanted.map((e) => e.lemma)));
    log(`[pl] Morfologik dictionary decoded for verbs in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    for (const e of wanted) if (!put(e, polishVerbFromMorfologik(e, rows.get(e.lemma), counts))) stats.missing.push({ lemma: e.lemma, rank: e.frequencyRank });
  }
  return stats;
}

/** Report lines for the build report. */
export function verbTableReport(lang, stats) {
  if (!VERB_DESCRIPTIONS[lang] || !stats.wanted) return [];
  const L = ['## Conjugation tables', '', VERB_DESCRIPTIONS[lang], ''];
  L.push(`- Verbs in the set: ${stats.wanted.toLocaleString('en')}`);
  L.push(`- With a table: ${stats.withTable.toLocaleString('en')}`);
  for (const [s, n] of Object.entries(stats.bySource)) L.push(`- From ${s}: ${n.toLocaleString('en')}`);
  if (stats.formsDropped) L.push(`- Dictionary forms dropped as copies of a table form without its Polish letters (miec, mial): ${stats.formsDropped.toLocaleString('en')}`);
  if (stats.missing.length) {
    L.push('');
    L.push(`Without a table (${stats.missing.length}): ${stats.missing.map((m) => m.lemma).join(', ')}.`);
  }
  L.push('');
  return L;
}
