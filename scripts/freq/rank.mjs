// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Stage 1 of the frequency-set build: lemma ranks.
// Reads a frequency list and produces lemmas ordered by estimated frequency, with the word forms
// that contributed and part-of-speech evidence. Definitions are attached in stage 2 (attach.mjs).
import { key, lines, round } from './common.mjs';
import { lemmatize } from './lemmatize.mjs';
import { appPos, lookup, pointerTargets, usableBlocks } from './wiktionary.mjs';

/** Which app parts of speech a Universal Dependencies tag can correspond to in Wiktionary. */
export const UPOS_FAMILY = {
  NOUN: ['noun'], VERB: ['verb'], AUX: ['verb'], ADJ: ['adjective'], ADV: ['adverb', 'particle'],
  PART: ['particle', 'adverb', 'interjection'], INTJ: ['interjection', 'particle'], PRON: ['pronoun', 'determiner'],
  DET: ['determiner', 'pronoun', 'adjective'], ADP: ['preposition'], CCONJ: ['conjunction', 'particle'],
  SCONJ: ['conjunction', 'particle'], NUM: ['numeral', 'determiner', 'adjective'], CLF: ['classifier', 'noun'],
};

/** doozan/spanish_data es_allforms.csv ("form,pos,lemma", from English Wiktionary) → lexicon. */
export async function lexiconFromAllforms(file) {
  const forms = new Map();
  const spelling = new Map();
  for await (const line of lines(file)) {
    const a = line.split(',');
    if (a.length < 3) continue;
    const form = a[0];
    const lemma = a.slice(2).join(',');
    if (!form || !lemma || /\s/.test(form)) continue;
    const lk = key(lemma, 'es');
    spelling.set(lk, lemma);
    for (const [f, l] of [[key(form, 'es'), lk], [lk, lk]]) {
      let set = forms.get(f);
      if (!set) forms.set(f, (set = new Set()));
      set.add(l);
    }
  }
  return { forms, spelling };
}

/** OpenRussian inflection tables → lexicon (form → lemma), the lemma itself included. */
export function lexiconFromOpenRussian(openRussian) {
  const forms = new Map();
  const spelling = new Map();
  const add = (f, l) => {
    let set = forms.get(f);
    if (!set) forms.set(f, (set = new Set()));
    set.add(l);
  };
  for (const [lk, items] of openRussian) {
    for (const it of items) {
      spelling.set(lk, it.bare);
      add(lk, lk);
      for (const f of it.forms) add(key(f.form, 'ru'), lk);
    }
  }
  return { forms, spelling };
}

/**
 * Film subtitles share their characters' names across languages, so a name such as "jack" or "bob"
 * is about as frequent in Spanish subtitles as in Brazilian ones. Where the reference list has the
 * word but it is not a word of the reference language, its expected name frequency (scaled by corpus
 * size) is subtracted, leaving only genuine uses (Portuguese tom "tone" keeps its surplus over "Tom").
 */
export function subtractSharedNames(list, refList, isRefWord, lang, refLang) {
  const total = list.reduce((a, b) => a + b.count, 0);
  const refTotal = refList.reduce((a, b) => a + b.count, 0);
  const ref = new Map();
  for (const r of refList) {
    const k = key(r.word, refLang);
    ref.set(k, (ref.get(k) ?? 0) + r.count);
  }
  let removed = 0;
  const out = [];
  for (const row of list) {
    const k = key(row.word, lang);
    const rc = ref.get(k);
    if (rc && !isRefWord(k)) {
      const expected = (rc / refTotal) * total;
      const left = row.count - expected;
      removed += Math.min(row.count, expected);
      if (left > 0) out.push({ word: row.word, count: left });
      continue;
    }
    out.push(row);
  }
  return { list: out, removedShare: removed / total };
}

/** Resolver for stage 1: a lemma is known if Wiktionary, the lexicon or the treebank knows it. */
export function knownLemmaResolver(dict, lang, lexicon, treebank) {
  const known = new Set();
  const defined = new Set();
  for (const [k, headwords] of dict) if (usableBlocks(headwords).length) defined.add(k);
  for (const k of defined) known.add(k);
  if (lang === 'pl') for (const k of defined) if (k.endsWith(' się')) known.add(k.slice(0, -4)); // bać → bać się
  for (const k of lexicon?.spelling.keys() ?? []) known.add(k);
  for (const k of treebank?.lemmaPos.keys() ?? []) known.add(k);
  const pointerCache = new Map();
  const posCache = new Map();
  const lowerHeadwords = (k) => lookup(dict, k, lang).filter((h) => h.word === h.word.toLowerCase());
  const pointersOf = (k) => {
    let v = pointerCache.get(k);
    if (v === undefined) {
      const hw = lowerHeadwords(k);
      v = hw.length ? pointerTargets(hw).map((t) => key(t, lang)) : [];
      pointerCache.set(k, v);
    }
    return v;
  };
  /**
   * The lemma a treebank token belongs to, given its part of speech: the lemma itself when Wiktionary
   * defines it in that part of speech; the target when Wiktionary's entry in that part of speech only
   * points elsewhere ("apocopic form of mío"); otherwise a lexicon lemma of the form that Wiktionary
   * defines in that part of speech (Russian это as a pronoun → этот).
   */
  const resolvePos = (l, upos, fk) => {
    const family = UPOS_FAMILY[upos];
    if (!family) {
      const p = pointersOf(l);
      return p.length ? p : [l];
    }
    const ck = `${l}\t${upos}\t${fk}`;
    let v = posCache.get(ck);
    if (v !== undefined) return v;
    const hws = lowerHeadwords(l);
    if (usableBlocks(hws).some((u) => family.includes(u.pos))) v = [l];
    else {
      const targets = new Set();
      for (const h of hws)
        for (const b of h.blocks)
          if (family.includes(appPos(b.pos)) && b.senses.length && b.senses.every((x) => x.pointer)) for (const x of b.senses) targets.add(key(x.pointer, lang));
      if (targets.size) v = [...targets];
      else {
        const lex = [...(lexicon?.forms.get(fk) ?? [])].filter((x) => x !== l && usableBlocks(lowerHeadwords(x)).some((u) => family.includes(u.pos)));
        if (lex.length) v = lex;
        else {
          const p = pointersOf(l);
          v = p.length ? p : [l];
        }
      }
    }
    posCache.set(ck, v);
    return v;
  };
  return {
    known,
    resolvePos,
    has: (k) => known.has(k),
    hasEntry: (k) => defined.has(k) || (lang === 'pl' && defined.has(`${k} się`)),
    resolve: (k) => (known.has(k) ? k : null),
    pointers: pointersOf,
  };
}

/**
 * Rank lemmas from a surface-form frequency list.
 * @returns {ranked: [{lemma, spelling, count, forms: [[form, count]], upos: {UPOS: n}}], stats, unassigned}
 */
export function rankFromForms(lang, list, { dict, lexicon, treebank, maxForms = 40 }) {
  const resolver = knownLemmaResolver(dict, lang, lexicon, treebank);
  const r = lemmatize(list, { lang, lexicon, treebank, resolver });
  const ranked = [];
  for (const [lk, e] of r.lemmas) {
    const hw = lookup(dict, lk, lang).find((h) => h.word === h.word.toLowerCase());
    const forms = [...e.forms]
      .map(([f, c]) => [f, c, c / r.counts.get(f)])
      .filter(([, , share]) => share >= 0.2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, maxForms)
      .map(([f, c, share]) => [f, round(c, 1), round(share, 2)]);
    const upos = treebank?.lemmaPos.get(lk);
    ranked.push({
      lemma: lk,
      spelling: hw?.word ?? lexicon?.spelling.get(lk) ?? lk,
      count: round(e.count, 1),
      forms,
      upos: upos ? Object.fromEntries([...upos].sort((a, b) => b[1] - a[1])) : null,
    });
  }
  ranked.sort((a, b) => b.count - a.count || a.lemma.localeCompare(b.lemma));
  return { ranked, stats: r.stats, unassigned: r.unassigned };
}

/**
 * Vietnamese: tabidots/vn-freqs is already word-segmented; names (capitalised) are left out.
 * A treebank, when given, adds part-of-speech evidence (là is mostly the copula, not "fine silk").
 */
export function rankVietnamese(rows, treebank = null) {
  const byKey = new Map();
  for (const row of rows) {
    if (row.word !== row.word.toLowerCase()) continue; // proper nouns such as Việt Nam, Gia
    const k = key(row.word, 'vi');
    const e = byKey.get(k);
    if (e) e.count += row.count;
    else {
      const upos = treebank?.lemmaPos.get(k);
      byKey.set(k, { lemma: k, spelling: row.word, count: row.count, forms: [], upos: upos ? Object.fromEntries([...upos].sort((a, b) => b[1] - a[1])) : null });
    }
  }
  return { ranked: [...byKey.values()].sort((a, b) => b.count - a.count || a.lemma.localeCompare(b.lemma)) };
}
