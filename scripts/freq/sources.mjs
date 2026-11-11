// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Readers for the frequency lists, lexicons and treebanks used by scripts/freq/build.mjs.
// Every reader takes a path inside the sources directory created by scripts/freq/fetch-sources.sh.
import { readFileSync, readdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { decode } from './msgpack.mjs';
import { key, lines, stripStress } from './common.mjs';

// ------------------------------------------------------------------ frequency lists

/** wordfreq "large" cBpack list → [{word, freq}] with freq = occurrences per billion words. */
export function readWordfreq(file, limit = 200000) {
  const [header, ...buckets] = decode(gunzipSync(readFileSync(file)));
  if (!header || header.format !== 'cB') throw new Error(`${file} is not a wordfreq cBpack file`);
  const out = [];
  for (let b = 0; b < buckets.length && out.length < limit; b++) {
    const freq = 10 ** ((900 - b) / 100); // bucket b holds words with frequency 10^(-b/100) per word
    for (const word of buckets[b]) {
      out.push({ word, count: freq });
      if (out.length >= limit) break;
    }
  }
  return out;
}

/** FrequencyWords "word count" lines → [{word, count}]. */
export async function readFrequencyWords(file) {
  const out = [];
  for await (const line of lines(file)) {
    const m = /^(\S+)\s+(\d+)$/.exec(line.trim());
    if (m) out.push({ word: m[1], count: Number(m[2]) });
  }
  return out;
}

/** Sharoff's robust lemma lists: "lemma_pos raw adjusted clipped docs" → [{lemma, pos, raw, count, docs}]. */
export async function readSharoff(file) {
  const out = [];
  for await (const line of lines(file)) {
    const [lp, raw, adjusted, , docs] = line.split('\t');
    if (!lp || !adjusted) continue;
    const us = lp.lastIndexOf('_');
    if (us <= 0) continue;
    out.push({ lemma: lp.slice(0, us), pos: lp.slice(us + 1), raw: Number(raw), count: Number(adjusted), docs: Number(docs) });
  }
  return out;
}

/** doozan/spanish_data frequency.csv: count,spanish,pos,flags,usage → rows with per-form counts. */
export async function readDoozanFrequency(file) {
  const out = [];
  let header = true;
  for await (const line of lines(file)) {
    if (header) {
      header = false;
      continue;
    }
    const parts = line.split(',');
    if (parts.length < 5) continue;
    const [count, lemma, pos, flags] = parts;
    const usage = parts.slice(4).join(',');
    const forms = [];
    for (const u of usage.split('|')) {
      const i = u.indexOf(':');
      if (i > 0) forms.push({ form: u.slice(i + 1), count: Number(u.slice(0, i)) });
    }
    out.push({ count: Number(count), lemma, pos, flags: flags ? flags.split(/\s+/) : [], forms });
  }
  return out;
}

/** tabidots/vn-freqs: rank, count, word, comma-separated Wiktionary POS. */
export async function readVnFreqs(file) {
  const out = [];
  for await (const line of lines(file)) {
    const [rank, count, word, pos] = line.split('\t');
    if (!word) continue;
    out.push({ rank: Number(rank), count: Number(count), word: word.normalize('NFC'), pos: (pos ?? '').split(/\s*,\s*/).filter(Boolean) });
  }
  return out;
}

// ------------------------------------------------------------------ lexicons (form → lemma)

function addPair(map, form, lemma) {
  let set = map.get(form);
  if (!set) map.set(form, (set = new Set()));
  set.add(lemma);
}

/** michmech/lemmatization-lists: "lemma<TAB>form" lines → Map<formKey, Set<lemmaKey>> (+ lemma spellings). */
export async function readMichmech(file, lang) {
  const forms = new Map();
  const spelling = new Map();
  for await (const line of lines(file)) {
    const [lemma, form] = line.split('\t');
    if (!lemma || !form) continue;
    const lk = key(lemma, lang);
    spelling.set(lk, lemma.trim());
    addPair(forms, key(form, lang), lk);
    addPair(forms, lk, lk);
  }
  return { forms, spelling };
}

/** spaCy's Polish lookup tables (PoliMorf/SGJP): pl_lemma_lookup_<pos>.json → Map<formKey, Set<lemmaKey>>. */
export function readSpacyPolish(dir) {
  const forms = new Map();
  const spelling = new Map();
  for (const f of readdirSync(dir).filter((n) => /^pl_lemma_lookup_\w+\.json$/.test(n))) {
    const table = JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
    for (const [form, lemma] of Object.entries(table)) {
      if (!lemma || lemma.startsWith('+')) continue; // "+że" style clitic entries
      const lk = key(lemma, 'pl');
      spelling.set(lk, lemma);
      addPair(forms, key(form, 'pl'), lk);
      addPair(forms, lk, lk);
    }
  }
  return { forms, spelling };
}

// ------------------------------------------------------------------ treebanks

/** Pseudo-lemma for proper-noun uses of a form; its share of a form's count is not given to any word. */
export const PROPER_NOUN = '\u0000proper-noun';

/**
 * Universal Dependencies CoNLL-U files → how often each surface form is each lemma, and the
 * part of speech of each lemma. Punctuation, symbols and foreign words are ignored; proper-noun
 * uses are counted under PROPER_NOUN (frequency lists are lowercased, and names are not studied).
 */
export async function readTreebank(files, lang) {
  const formLemma = new Map(); // formKey → Map<lemmaKey, n>
  const formLemmaPos = new Map(); // formKey → Map<"lemmaKey\tUPOS", n>
  const lemmaPos = new Map(); // lemmaKey → Map<UPOS, n>
  const mwt = new Map(); // surface key → Map<first-part lemmaKey, n> (contractions such as do = de + o)
  const bump = (map, a, b, n = 1) => {
    let m = map.get(a);
    if (!m) map.set(a, (m = new Map()));
    m.set(b, (m.get(b) ?? 0) + n);
  };
  let tokens = 0;
  for (const file of files) {
    let mwtEnd = -1;
    let mwtSurface = null;
    let mwtSeen = false;
    for await (const line of lines(file)) {
      if (!line || line.startsWith('#')) {
        mwtEnd = -1;
        continue;
      }
      const cols = line.split('\t');
      if (cols.length < 4) continue;
      const [id, form, lemma, upos] = cols;
      if (/^\d+-\d+$/.test(id)) {
        mwtEnd = Number(id.split('-')[1]);
        mwtSurface = key(form, lang);
        mwtSeen = false;
        continue;
      }
      if (!/^\d+$/.test(id)) continue; // empty nodes such as 8.1
      if (Number(id) <= mwtEnd) {
        // Parts of a multiword token (do = de + o): record the first part's lemma for the surface form.
        if (!mwtSeen) bump(mwt, mwtSurface, key(lemma, lang));
        mwtSeen = true;
        continue;
      }
      if (['PUNCT', 'SYM', 'X'].includes(upos) || lemma === '_') continue;
      const fk = key(form, lang);
      if (!/\p{L}/u.test(fk)) continue;
      if (upos === 'PROPN') {
        // Frequency lists are lowercased: count how often a form is a name (Україна, Polska, São).
        bump(formLemma, fk, PROPER_NOUN);
        continue;
      }
      // AnCora writes ambiguous lemmas as "crear,creer": share the token between them.
      const alternatives = lemma.includes(',') && lemma !== ',' ? lemma.split(',').filter(Boolean) : [lemma];
      for (const alt of alternatives) {
        const lk = key(alt, lang);
        bump(formLemma, fk, lk, 1 / alternatives.length);
        bump(formLemmaPos, fk, `${lk}\t${upos}`, 1 / alternatives.length);
        bump(lemmaPos, lk, upos, 1 / alternatives.length);
      }
      tokens++;
    }
  }
  return { formLemma, formLemmaPos, lemmaPos, mwt, tokens };
}

// ------------------------------------------------------------------ OpenRussian (stress and inflection tables)

const OR_TAGS = {
  sg_nom: ['nominative', 'singular'], sg_gen: ['genitive', 'singular'], sg_dat: ['dative', 'singular'],
  sg_acc: ['accusative', 'singular'], sg_inst: ['instrumental', 'singular'], sg_prep: ['prepositional', 'singular'],
  pl_nom: ['nominative', 'plural'], pl_gen: ['genitive', 'plural'], pl_dat: ['dative', 'plural'],
  pl_acc: ['accusative', 'plural'], pl_inst: ['instrumental', 'plural'], pl_prep: ['prepositional', 'plural'],
  imperative_sg: ['imperative', 'singular'], imperative_pl: ['imperative', 'plural'],
  past_m: ['past', 'masculine'], past_f: ['past', 'feminine'], past_n: ['past', 'neuter'], past_pl: ['past', 'plural'],
  presfut_sg1: ['1sg'], presfut_sg2: ['2sg'], presfut_sg3: ['3sg'], presfut_pl1: ['1pl'], presfut_pl2: ['2pl'], presfut_pl3: ['3pl'],
  comparative: ['comparative'], superlative: ['superlative'],
  short_m: ['short', 'masculine'], short_f: ['short', 'feminine'], short_n: ['short', 'neuter'], short_pl: ['short', 'plural'],
  decl_m_nom: ['masculine', 'nominative'], decl_m_gen: ['masculine', 'genitive'], decl_m_dat: ['masculine', 'dative'],
  decl_m_acc: ['masculine', 'accusative'], decl_m_inst: ['masculine', 'instrumental'], decl_m_prep: ['masculine', 'prepositional'],
  decl_f_nom: ['feminine', 'nominative'], decl_f_gen: ['feminine', 'genitive'], decl_f_dat: ['feminine', 'dative'],
  decl_f_acc: ['feminine', 'accusative'], decl_f_inst: ['feminine', 'instrumental'], decl_f_prep: ['feminine', 'prepositional'],
  decl_n_nom: ['neuter', 'nominative'], decl_n_gen: ['neuter', 'genitive'], decl_n_dat: ['neuter', 'dative'],
  decl_n_acc: ['neuter', 'accusative'], decl_n_inst: ['neuter', 'instrumental'], decl_n_prep: ['neuter', 'prepositional'],
  decl_pl_nom: ['plural', 'nominative'], decl_pl_gen: ['plural', 'genitive'], decl_pl_dat: ['plural', 'dative'],
  decl_pl_acc: ['plural', 'accusative'], decl_pl_inst: ['plural', 'instrumental'], decl_pl_prep: ['plural', 'prepositional'],
};

/** OpenRussian uses an apostrophe after the stressed vowel (челове'к) → combining acute (челове́к). */
export function openRussianStress(s) {
  return String(s ?? '')
    .replace(/'/g, '́')
    .normalize('NFC')
    .trim();
}

/** OpenRussian CSVs → Map<bareKey, [{bare, accented, kind, gender, aspect, partner, forms}]>. */
export async function readOpenRussian(dir) {
  const out = new Map();
  for (const kind of ['nouns', 'verbs', 'adjectives', 'others']) {
    let header = null;
    for await (const line of lines(path.join(dir, `${kind}.csv`))) {
      const cols = line.split('\t');
      if (!header) {
        header = cols;
        continue;
      }
      const row = Object.fromEntries(header.map((h, i) => [h, cols[i] ?? '']));
      if (!row.bare) continue;
      const forms = [];
      for (const [col, tags] of Object.entries(OR_TAGS)) {
        const v = row[col];
        if (!v) continue;
        for (const variant of v.split(/\s*[,;]\s*/)) {
          const display = openRussianStress(variant.replace(/[()*]/g, ''));
          const form = stripStress(display);
          if (form && /^[а-яё-]+$/i.test(form)) forms.push({ form, display: display !== form ? display : null, tags });
        }
      }
      const item = {
        bare: row.bare,
        accented: openRussianStress(row.accented),
        kind,
        gender: row.gender || null,
        aspect: row.aspect || null,
        partner: row.partner || null,
        forms,
      };
      const k = key(row.bare, 'ru');
      const list = out.get(k);
      if (list) list.push(item);
      else out.set(k, [item]);
    }
  }
  return out;
}

// ------------------------------------------------------------------ dmklinger/ukrainian (Ukrainian fallback dictionary)

const DMK_POS = {
  noun: 'noun', verb: 'verb', adjective: 'adj', adj: 'adj', adverb: 'adv', pronoun: 'pron', numeral: 'num',
  particle: 'particle', phrase: 'phrase', proverb: 'proverb', participle: 'adj',
  preposition: 'prep', postposition: 'postp', conjunction: 'conj', interjection: 'intj', determiner: 'det',
  predicative: 'adv', 'prepositional phrase': 'prep_phrase',
};
const DMK_TAIL = /\s*\((preposition|postposition|conjunction|interjection|determiner|numeral|predicative|prepositional phrase|phrase|proper noun)\)$/;

/**
 * dmklinger/ukrainian words.json (Ukrainian→English, compiled from English Wiktionary and DBnary)
 * → the same Map<key, Headword[]> shape as the Wiktionary readers, plus a form → lemma lexicon.
 * Each definition may end with its own part of speech ("… (preposition)"); those become blocks.
 */
export function readDmklinger(file, parseSense) {
  const words = JSON.parse(readFileSync(file, 'utf8'));
  const dict = new Map();
  const lexicon = { forms: new Map(), spelling: new Map() };
  for (const w of words) {
    const display = String(w.word ?? '').normalize('NFC').trim();
    const word = stripStress(display);
    if (!word || !Array.isArray(w.defs)) continue;
    const basePos = DMK_POS[w.pos];
    if (!basePos) continue;
    const blocks = new Map();
    for (const raw of w.defs) {
      let text = String(raw);
      let pos = basePos;
      let note = null;
      const tail = DMK_TAIL.exec(text);
      if (tail) {
        text = text.slice(0, tail.index).trim();
        if (tail[1] === 'proper noun') note = 'from the English proper noun';
        else pos = DMK_POS[tail[1]] ?? basePos;
        if (tail[1] === 'predicative') note = 'predicative';
      }
      if (!text || /^\([^()]*\)$/.test(text)) continue; // grammar-only notes such as "(with genitive case)"
      const sense = parseSense(text);
      if (note) sense.labels.push(note);
      if (tail?.[1] === 'proper noun') sense.properNoun = true;
      if (!blocks.has(pos)) blocks.set(pos, { pos, senses: [], gender: null, usage: null, aspect: null });
      blocks.get(pos).senses.push(sense);
    }
    if (!blocks.size) continue;
    const info = String(w.info ?? '');
    const gender = /\bmale\b/.test(info) && !/\bfemale\b/.test(info) ? 'm' : /\bfemale\b/.test(info) ? 'f' : /\bneuter\b/.test(info) ? 'n' : null;
    const aspect = /\bimperfective\b/.test(info) ? 'imperfective' : /\bperfective\b/.test(info) ? 'perfective' : null;
    for (const b of blocks.values()) {
      if (b.pos === 'noun') b.gender = gender;
      if (b.pos === 'verb') b.aspect = aspect;
    }
    // Inflection tables (from the ULIF grammatical dictionary), flattened with their stress marks.
    const forms = [];
    const walk = (node) => {
      if (Array.isArray(node)) for (const f of node) forms.push(String(f).normalize('NFC'));
      else if (node && typeof node === 'object') for (const v of Object.values(node)) walk(v);
    };
    walk(w.forms);
    const k = key(word, 'uk');
    const entry = { word, display, forms: [...new Set(forms)], blocks: [...blocks.values()], source: 'dmklinger' };
    const list = dict.get(k);
    if (list) list.push(entry);
    else dict.set(k, [entry]);
    lexicon.spelling.set(k, word);
    addPair(lexicon.forms, k, k);
    for (const f of entry.forms) {
      const fk = key(f, 'uk');
      if (fk && !/\s/.test(fk)) addPair(lexicon.forms, fk, k);
    }
  }
  return { dict, lexicon };
}

// ------------------------------------------------------------------ Tatoeba sentences (via doozan/spanish_data)

/** sentences.tsv: English, Spanish, credit, eng level, spa level, ":pos,form|lemma …" annotations. */
export async function readDoozanSentences(file) {
  const byLemma = new Map(); // "lemma|pos" → [{text, translation, target, credit, words}]
  for await (const line of lines(file)) {
    const cols = line.split('\t');
    if (cols.length < 6) continue;
    const [en, es, credit, , , tags] = cols;
    const words = es.split(/\s+/).length;
    for (const t of tags.split(' ')) {
      const m = /^:([a-z-]+),(.+)$/.exec(t);
      if (!m) continue;
      const pos = m[1].replace(/^phrase-/, '');
      for (const item of m[2].split(',')) {
        const [form, lemma = form] = item.split('|');
        const k = `${lemma}|${pos}`;
        let list = byLemma.get(k);
        if (!list) byLemma.set(k, (list = []));
        if (list.length < 40) list.push({ text: es, translation: en, target: form, credit, words });
      }
    }
  }
  return byLemma;
}
