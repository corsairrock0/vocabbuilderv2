// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Declension tables for Russian, Ukrainian and Polish nouns, adjectives, pronouns and numerals.
//
//   Russian    OpenRussian.org tables (Badestrand/russian-dictionary, CC BY-SA 4.0) for nouns and adjectives,
//              with stress; pronouns, numerals and words OpenRussian lacks from the forms and features attested
//              in the UD SynTagRus treebank (its annotations only; no text is copied).
//   Ukrainian  dmklinger/ukrainian (CC BY-SA 3.0; tables from the ULIF grammatical dictionary), with stress.
//   Polish     PoliMorf as packaged in the Morfologik Polish dictionary (BSD-2-Clause), read by morfologik.mjs.
//
// Cell keys are "<case>|<column>" (shared/paradigms.ts lays them out and labels them):
//   cases    nom gen dat acc ins loc voc, and acc.anim / acc.inan where animacy decides the accusative
//   columns  sg pl (nouns); m n f pl (Russian/Ukrainian adjectives and adjectival pronouns);
//            m n f pl.vir pl.nvir (Polish); - (case only: personal pronouns, most numerals)
//   extras   short|m short|f short|n short|pl (Russian short adjectives), comp|- and sup|- (degrees)
import { lines, key, stripStress } from '../common.mjs';
import { openRussianStress } from '../sources.mjs';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const CASES = ['nom', 'gen', 'dat', 'acc', 'ins', 'loc', 'voc'];

function add(cells, k, form) {
  const f = String(form ?? '').normalize('NFC').trim();
  if (!f || f === '-' || f === '—') return;
  const list = cells[k] ?? (cells[k] = []);
  if (!list.includes(f)) list.push(f);
}

const plainKey = (f, lang) => key(f, lang);

/**
 * Accusative forms of an animacy-sensitive column → acc.inan (= nominative) and acc.anim (= genitive).
 * Forms that match neither (a source's odd variant) stay with the matching side of the first form.
 */
function splitAccusative(cells, col, lang) {
  const acc = cells[`acc|${col}`];
  if (!acc) return;
  const nom = new Set((cells[`nom|${col}`] ?? []).map((f) => plainKey(f, lang)));
  const gen = new Set((cells[`gen|${col}`] ?? []).map((f) => plainKey(f, lang)));
  const inan = acc.filter((f) => nom.has(plainKey(f, lang)));
  const anim = acc.filter((f) => gen.has(plainKey(f, lang)));
  if (!inan.length || !anim.length) return; // one form for both: keep a single accusative
  delete cells[`acc|${col}`];
  cells[`acc.inan|${col}`] = inan;
  cells[`acc.anim|${col}`] = anim;
}

/** Every form is the dictionary form: an indeclinable word (кофе, кіно, kakao). */
function allSame(cells, lemma, lang) {
  const k = plainKey(lemma, lang);
  const forms = Object.entries(cells)
    .filter(([c]) => !c.startsWith('comp|') && !c.startsWith('sup|') && !c.startsWith('short|'))
    .flatMap(([, f]) => f);
  return forms.length > 0 && forms.every((f) => plainKey(f, lang) === k);
}

/**
 * Drop very rare spelling variants inside a cell (Polish mię beside mnie, kakaa beside kakao) using the
 * frequency list's counts: a variant under 1% of the cell's most frequent one goes, when that one is common.
 */
export function pruneVariants(cells, counts, lang, { sort = false } = {}) {
  if (!counts) return cells;
  for (const [k, forms] of Object.entries(cells)) {
    if (forms.length < 2) continue;
    const count = (f) => counts.get(plainKey(f, lang)) ?? 0;
    const best = Math.max(...forms.map(count));
    let kept = best < 200 ? forms : forms.filter((f) => count(f) >= best * 0.01);
    if (!kept.length) kept = forms.slice(0, 1);
    // Polish variants come in dictionary order, which means nothing: most frequent first (go, jego, niego).
    if (sort) kept = [...kept].sort((a, b) => count(b) - count(a));
    cells[k] = kept;
  }
  return cells;
}

const VOWELS = { ru: /[аеёиоуыэюя]/giu, uk: /[аеєиіїоуюя]/giu };

/** A stress mark on a one-vowel word tells the learner nothing (мо́й, ве́сь): drop it. */
function unstressMonosyllables(cells, lang) {
  if (!VOWELS[lang]) return;
  for (const [k, forms] of Object.entries(cells)) {
    cells[k] = [...new Set(forms.map((f) => ((stripStress(f).match(VOWELS[lang]) ?? []).length <= 1 ? stripStress(f) : f)))];
  }
}

function finish(kind, source, cells, lemma, lang, extra = {}) {
  if (!Object.keys(cells).length) return null;
  unstressMonosyllables(cells, lang);
  if (allSame(cells, lemma, lang)) return { kind, source, indeclinable: true, cells: {}, ...extra };
  return { kind, source, cells, ...extra };
}

export function nominalKind(pos) {
  return pos === 'noun' ? 'noun' : pos === 'adjective' ? 'adjective' : pos === 'numeral' ? 'numeral' : pos === 'pronoun' || pos === 'determiner' ? 'pronoun' : null;
}

// ------------------------------------------------------------------ Russian

/** OpenRussian nouns.csv and adjectives.csv rows by stress-free key. */
export async function readOpenRussianTables(dir) {
  const out = new Map();
  for (const kind of ['nouns', 'adjectives']) {
    let header = null;
    for await (const line of lines(path.join(dir, `${kind}.csv`))) {
      const cols = line.split('\t');
      if (!header) {
        header = cols;
        continue;
      }
      const row = Object.fromEntries(header.map((h, i) => [h, cols[i] ?? '']));
      if (!row.bare) continue;
      const k = key(row.bare, 'ru');
      const list = out.get(k) ?? [];
      list.push({ kind, row });
      out.set(k, list);
    }
  }
  return out;
}

const OR_CASE = { nom: 'nom', gen: 'gen', dat: 'dat', acc: 'acc', inst: 'ins', prep: 'loc' };
const orForms = (v) =>
  String(v ?? '')
    .split(/\s*[,;]\s*/)
    .map((x) => openRussianStress(x.replace(/[()*]/g, '')))
    .filter((x) => x && /^[а-яё́-]+$/iu.test(x));

export function russianFromOpenRussian(entry, rows) {
  const kind = nominalKind(entry.pos);
  const want = kind === 'noun' ? 'nouns' : 'adjectives';
  let hit = rows?.find((r) => r.kind === want);
  if (!hit && (kind === 'numeral' || kind === 'pronoun')) hit = rows?.find((r) => r.kind === 'nouns');
  if (!hit) return null;
  const r = hit.row;
  const asNoun = hit.kind === 'nouns';
  const cells = {};
  if (asNoun) {
    if (r.indeclinable === '1' || r.indeclinable === 'True' || r.indeclinable === 'true') return { kind, source: 'OpenRussian', indeclinable: true, cells: {} };
    for (const [c, ck] of Object.entries(OR_CASE)) {
      for (const n of ['sg', 'pl']) for (const f of orForms(r[`${n}_${c}`])) add(cells, `${ck}|${n}`, f);
    }
    const notes = [];
    if (r.animate === '1' || r.animate === 'True') notes.push('animate');
    if (r.sg_only === '1' || r.sg_only === 'True') notes.push('singular only');
    if (r.pl_only === '1' || r.pl_only === 'True') notes.push('plural only');
    return finish(kind, 'OpenRussian', cells, entry.lemma, 'ru', notes.length ? { notes } : {});
  }
  for (const [c, ck] of Object.entries(OR_CASE)) {
    for (const g of ['m', 'f', 'n', 'pl']) for (const f of orForms(r[`decl_${g}_${c}`])) add(cells, `${ck}|${g}`, f);
  }
  splitAccusative(cells, 'm', 'ru');
  splitAccusative(cells, 'pl', 'ru');
  for (const g of ['m', 'f', 'n', 'pl']) for (const f of orForms(r[`short_${g}`])) add(cells, `short|${g}`, f);
  for (const f of orForms(r.comparative)) add(cells, 'comp|-', f);
  for (const f of orForms(r.superlative)) add(cells, 'sup|-', f);
  return finish(kind, 'OpenRussian', cells, entry.lemma, 'ru');
}

/**
 * Forms of the wanted lemmas as annotated in UD CoNLL-U files → Map<lemmaKey, [{form, upos, feats, n}]>.
 * Only the annotation of single tokens is used (lemma, part of speech, Case/Number/Gender/Animacy).
 */
export async function readAttestations(files, wanted, lang) {
  const counts = new Map();
  for (const file of files) {
    for await (const line of lines(file)) {
      if (!line || line[0] === '#') continue;
      const cols = line.split('\t');
      if (cols.length < 6 || !/^\d+$/.test(cols[0])) continue;
      const lk = key(cols[2], lang);
      if (!wanted.has(lk)) continue;
      const form = cols[1].toLowerCase().normalize('NFC');
      const id = `${lk}\t${form}\t${cols[3]}\t${cols[5]}`;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  const out = new Map();
  for (const [id, n] of counts) {
    const [lk, form, upos, feats] = id.split('\t');
    const f = Object.fromEntries(
      feats === '_'
        ? []
        : feats.split('|').map((x) => x.split('=')),
    );
    const list = out.get(lk) ?? [];
    list.push({ form, upos, feats: f, n });
    out.set(lk, list);
  }
  return out;
}

const UD_CASE = { Nom: 'nom', Gen: 'gen', Dat: 'dat', Acc: 'acc', Ins: 'ins', Loc: 'loc', Voc: 'voc' };
const UD_COL = (f) => (f.Number === 'Plur' ? 'pl' : f.Gender === 'Masc' ? 'm' : f.Gender === 'Fem' ? 'f' : f.Gender === 'Neut' ? 'n' : null);

/** A table from treebank attestations: kept forms are frequent enough in their cell to be more than an annotation slip. */
export function fromAttestations(entry, atts, lang, source, yo = null) {
  const kind = nominalKind(entry.pos);
  if (!kind || !atts?.length) return null;
  const uposOk = kind === 'noun' ? ['NOUN'] : kind === 'adjective' ? ['ADJ'] : ['PRON', 'DET', 'NUM', 'ADJ'];
  const usable = atts.filter((a) => uposOk.includes(a.upos) && UD_CASE[a.feats.Case]);
  if (!usable.length) return null;
  const columns = new Set(usable.map((a) => (kind === 'noun' ? (a.feats.Number === 'Plur' ? 'pl' : 'sg') : UD_COL(a.feats) ?? '-')));
  const adjectival = kind !== 'noun' && [...columns].filter((c) => c !== '-').length > 1;
  const tally = {};
  for (const a of usable) {
    let col = kind === 'noun' ? (a.feats.Number === 'Plur' ? 'pl' : 'sg') : adjectival ? UD_COL(a.feats) : '-';
    if (!col) col = adjectival ? 'pl' : '-'; // oblique cases of два, три carry no gender
    let c = UD_CASE[a.feats.Case];
    if (c === 'acc' && adjectival && (col === 'm' || col === 'pl') && a.feats.Animacy) c = a.feats.Animacy === 'Anim' ? 'acc.anim' : 'acc.inan';
    const k = `${c}|${col}`;
    (tally[k] ??= new Map()).set(a.form, ((tally[k].get(a.form) ?? 0) + a.n));
  }
  const cells = {};
  for (const [k, m] of Object.entries(tally)) {
    const total = [...m.values()].reduce((x, y) => x + y, 0);
    const best = Math.max(...m.values());
    for (const [form, n] of [...m].sort((a, b) => b[1] - a[1])) if (n === best || (n >= 2 && n >= total * 0.1)) add(cells, k, form);
  }
  for (const col of ['m', 'pl']) if (cells[`acc.anim|${col}`] && cells[`acc.inan|${col}`]) delete cells[`acc|${col}`];
  // Treebank text often writes е for ё: take the ё spelling from the word's dictionary forms (её, неё, нём).
  if (yo) for (const [k, forms] of Object.entries(cells)) cells[k] = [...new Set(forms.map((f) => yo.get(f) ?? f))];
  return finish(kind, source, cells, entry.lemma, lang);
}

/** е → ё spellings known from the set's words and tables (её, всё, нём), for forms read from treebank text. */
export function yoSpellings(entries, tables) {
  const yo = new Map();
  const note = (f) => {
    const p = stripStress(String(f ?? '')).toLowerCase();
    if (/ё/.test(p)) yo.set(p.replace(/ё/g, 'е'), p);
  };
  for (const e of entries) {
    note(e.lemma);
    note(e.display);
    for (const f of e.forms ?? []) note(f.display ?? f.form);
  }
  for (const rows of tables.values()) for (const { row } of rows) for (const v of Object.values(row)) for (const f of String(v).split(/\s*[,;]\s*/)) note(openRussianStress(f));
  return yo;
}

// ------------------------------------------------------------------ Ukrainian

/** dmklinger/ukrainian words.json → Map<stress-free key, [{pos, forms}]> for words that have inflection tables. */
export function readDmklingerTables(file) {
  const out = new Map();
  for (const w of JSON.parse(readFileSync(file, 'utf8'))) {
    if (!w.forms || typeof w.forms !== 'object' || !Object.keys(w.forms).length) continue;
    const k = key(stripStress(String(w.word ?? '')), 'uk');
    const list = out.get(k) ?? [];
    list.push({ pos: w.pos, word: w.word, forms: w.forms });
    out.set(k, list);
  }
  return out;
}

const DMK_COL = { ns: 'sg', np: 'pl', am: 'm', an: 'n', af: 'f', ap: 'pl', n: '-' };
const DMK_POS = { noun: ['noun'], adjective: ['adjective', 'adj', 'participle'], numeral: ['numeral'], pronoun: ['pronoun', 'particle', 'noun', 'adjective'] };

export function ukrainianFromDmklinger(entry, rows) {
  const kind = nominalKind(entry.pos);
  if (!kind || !rows?.length) return null;
  const order = DMK_POS[kind] ?? [];
  const usable = rows.filter((r) => Object.keys(r.forms).some((k) => /^(nom|gen|dat|acc|ins|loc|voc) /.test(k)));
  const hit = order.map((p) => usable.find((r) => r.pos === p)).find(Boolean) ?? usable[0];
  if (!hit) return null;
  const keys = Object.keys(hit.forms).filter((k) => /^(nom|gen|dat|acc|ins|loc|voc) /.test(k));
  const hasGender = keys.some((k) => / a[mnfp]$/.test(k));
  const hasNumber = keys.some((k) => / n[sp]$/.test(k));
  // Nouns use the singular/plural columns; anything with gendered forms the adjective columns (два, сам).
  const layout = kind === 'noun' && hasNumber ? 'noun' : hasGender ? 'adjective' : 'case';
  const cells = {};
  for (const k of keys) {
    const [c, col] = k.split(' ');
    let ck;
    if (layout === 'noun') ck = col === 'ns' ? 'sg' : col === 'np' ? 'pl' : null;
    else if (layout === 'adjective') ck = /^a[mnfp]$/.test(col) ? DMK_COL[col] : null;
    else ck = col === 'n' || col === 'ns' ? '-' : null;
    if (!ck) continue;
    for (const f of hit.forms[k]) add(cells, `${c}|${ck}`, f);
  }
  if (layout === 'adjective') {
    splitAccusative(cells, 'm', 'uk');
    splitAccusative(cells, 'pl', 'uk');
    const addl = hit.forms.addl ?? {};
    for (const f of addl.comp ?? []) add(cells, 'comp|-', f);
    for (const f of addl.super ?? []) add(cells, 'sup|-', f);
  }
  return finish(kind, 'dmklinger/ukrainian', cells, entry.lemma, 'uk');
}

/** UniMorph "N;GEN;PL" style rows → cells (Ukrainian words dmklinger lacks). */
export function fromUnimorphNominal(entry, rows, lang) {
  const kind = nominalKind(entry.pos);
  if (!kind || !rows?.length) return null;
  const tag = kind === 'noun' ? 'N' : kind === 'adjective' ? 'ADJ' : null;
  const cells = {};
  for (const [form, f] of rows) {
    if (tag && !f.has(tag)) continue;
    const c = CASES.find((x) => f.has({ nom: 'NOM', gen: 'GEN', dat: 'DAT', acc: 'ACC', ins: 'INS', loc: 'ESS', voc: 'VOC' }[x]) || (x === 'loc' && f.has('LOC')));
    if (!c) continue;
    let col;
    if (kind === 'noun') col = f.has('PL') ? 'pl' : 'sg';
    else col = f.has('PL') ? 'pl' : f.has('MASC') ? 'm' : f.has('FEM') ? 'f' : f.has('NEUT') ? 'n' : '-';
    let ck = c;
    if (c === 'acc' && (f.has('ANIM') || f.has('INAN')) && col !== 'sg') ck = f.has('ANIM') ? 'acc.anim' : 'acc.inan';
    add(cells, `${ck}|${col}`, form);
  }
  return finish(kind, 'UniMorph', cells, entry.lemma, lang);
}

// ------------------------------------------------------------------ Polish

const PL_CASE = { nom: 'nom', gen: 'gen', dat: 'dat', acc: 'acc', inst: 'ins', loc: 'loc', voc: 'voc' };

/** One Morfologik tag ("adj:sg:nom.voc:m1.m2.m3:pos") → its class and the expanded attribute lists. */
function parseTag(tag) {
  const parts = tag.split(':');
  return { cls: parts[0], parts: parts.slice(1).map((p) => p.split('.')) };
}

/** Columns of a tag's genders: sg m/n/f; pl virile (m1, p1) and non-virile; numerals also a feminine column. */
function polishColumns(cls, number, genders) {
  const out = new Set();
  for (const g of genders) {
    if (cls === 'num') out.add(g === 'm1' || g === 'p1' ? 'pl.vir' : g === 'f' ? 'f' : 'pl.nvir');
    else if (number === 'sg') out.add(/^m/.test(g) ? 'm' : /^n/.test(g) ? 'n' : g === 'f' ? 'f' : 'm');
    else out.add(g === 'm1' || g === 'p1' ? 'pl.vir' : 'pl.nvir');
  }
  return [...out];
}

/**
 * Polish cells from Morfologik lines of one lemma ([form, tags][]). Nouns use subst tags, adjectives and
 * adjectival pronouns adj tags (positive degree; com/sup give the comparative and superlative), personal
 * pronouns ppron12/ppron3/siebie, numerals num (collective forms such as dwoje are left out).
 */
export function polishFromMorfologik(entry, rows, counts = null) {
  const kind = nominalKind(entry.pos);
  if (!kind || !rows?.length) return null;
  let tagged = rows.flatMap(([form, tags]) => tags.split('+').map((t) => ({ form, ...parseTag(t) })));
  const n = (cls) => tagged.filter((t) => t.cls === cls).length;
  let use;
  if (kind === 'noun') use = ['subst'];
  else if (kind === 'adjective') use = ['adj'];
  else if (n('ppron12') || n('ppron3') || n('siebie')) use = ['ppron12', 'ppron3', 'siebie'];
  else if (n('num') && n('num') >= n('adj')) use = ['num']; // dwa, pięć; jeden declines as an adjective
  else if (n('adj')) use = ['adj'];
  else if (n('subst')) use = ['subst'];
  else return null;
  if (use[0] === 'subst') {
    // Homonyms share a lemma (dzień "day" and a rare feminine dzień): keep the gender whose forms are the most
    // frequent, which counts() measures when the caller passes form counts.
    // Each form counts once per gender: an indeclinable reading (pani adwokat, feminine) has many tags but one form.
    const byGender = new Map();
    const seen = new Set();
    for (const t of tagged) {
      if (t.cls !== 'subst' || !t.parts[2]) continue;
      for (const g of t.parts[2]) {
        if (seen.has(`${t.form}|${g}`)) continue;
        seen.add(`${t.form}|${g}`);
        byGender.set(g, (byGender.get(g) ?? 0) + (counts?.get(key(t.form, 'pl')) ?? 1));
      }
    }
    const best = [...byGender].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (best) tagged = tagged.filter((t) => t.cls !== 'subst' || t.parts[2]?.includes(best));
  }
  const cells = {};
  let gender = null;
  for (const t of tagged) {
    if (!use.includes(t.cls)) continue;
    let numbers, cases, genders, degree;
    if (t.cls === 'siebie') [cases] = t.parts;
    else [numbers, cases, genders, degree] = t.parts;
    if (!cases) continue;
    if (t.cls === 'adj' && degree && degree[0] !== 'pos') {
      // Comparative and superlative: the masculine nominative singular stands for each.
      if (numbers.includes('sg') && cases.includes('nom') && genders.some((g) => /^m/.test(g))) add(cells, degree[0] === 'com' ? 'comp|-' : 'sup|-', t.form);
      continue;
    }
    if (t.cls === 'num' && genders.every((g) => /^(n1|p1|p2|p3)$/.test(g))) continue; // collective dwoje, dwojga
    if (t.cls === 'subst' && !gender) gender = genders?.[0] ?? null;
    for (const number of numbers ?? ['sg']) {
      const cols = t.cls === 'ppron12' || t.cls === 'siebie' ? ['-'] : t.cls === 'subst' ? [number === 'pl' ? 'pl' : 'sg'] : polishColumns(t.cls, number, genders);
      for (const c of cases) {
        const ck = PL_CASE[c];
        if (!ck) continue;
        for (const col of cols) {
          let caseKey = ck;
          if (ck === 'acc' && col === 'm') caseKey = genders.some((g) => g === 'm1' || g === 'm2') && !genders.includes('m3') ? 'acc.anim' : genders.includes('m3') && !genders.some((g) => g === 'm1' || g === 'm2') ? 'acc.inan' : 'acc';
          add(cells, `${caseKey}|${col}`, t.form);
        }
      }
    }
  }
  // Masculine accusatives: one cell when animate and inanimate agree (jego, go, niego), else the split pair.
  const anim = cells['acc.anim|m'];
  const inan = cells['acc.inan|m'];
  const both = cells['acc|m'];
  if (anim || inan) {
    const a = [...new Set([...(anim ?? []), ...(both ?? [])])];
    const i = [...new Set([...(inan ?? []), ...(both ?? [])])];
    delete cells['acc|m'];
    delete cells['acc.anim|m'];
    delete cells['acc.inan|m'];
    if (a.join() === i.join()) cells['acc|m'] = a;
    else {
      cells['acc.anim|m'] = a;
      cells['acc.inan|m'] = i;
    }
  }
  // Numerals: drop the feminine column where it only repeats the non-virile one (pięć).
  if (use[0] === 'num' && CASES.every((c) => (cells[`${c}|f`] ?? []).join() === (cells[`${c}|pl.nvir`] ?? []).join() || !cells[`${c}|f`])) {
    for (const c of CASES) delete cells[`${c}|f`];
  }
  // Variants in dictionary order mean nothing: most frequent first, the post-prepositional niego, nią, nich last.
  const praepOnly = new Set(tagged.filter((t) => t.cls === 'ppron3' && t.parts[5]?.length === 1 && t.parts[5][0] === 'praep').map((t) => t.form));
  const count = (f) => counts?.get(key(f, 'pl')) ?? 0;
  for (const [k, forms] of Object.entries(cells)) cells[k] = [...forms].sort((a, b) => Number(praepOnly.has(a)) - Number(praepOnly.has(b)) || count(b) - count(a));
  if (kind === 'pronoun' || kind === 'numeral') {
    // Pronouns and numerals: no vocative, and a single "sg" column is just the case column (kto, co, nic).
    for (const k of Object.keys(cells)) if (k.startsWith('voc|')) delete cells[k];
    const cols = new Set(Object.keys(cells).map((k) => k.split('|')[1]));
    if (cols.size === 1 && cols.has('sg')) for (const k of Object.keys(cells)) if (k.endsWith('|sg')) {
      cells[k.replace(/\|sg$/, '|-')] = cells[k];
      delete cells[k];
    }
  }
  const extra = kind === 'noun' && gender ? { gender } : {};
  return finish(kind, 'Morfologik (PoliMorf)', cells, entry.lemma, 'pl', extra);
}
