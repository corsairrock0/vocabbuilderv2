// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Turn a surface-form frequency list into lemma frequencies.
//
// Frequency lists count word forms (Polish "roku", "lat", "lata" …); learners study lemmas ("rok").
// Each form's count is shared among the lemmas it can belong to:
//   1. candidates come from a morphological lexicon (PoliMorf for Polish, michmech lists for
//      Portuguese and Ukrainian), from Wiktionary itself (the form is a headword, or a Wiktionary
//      "plural of …"/"inflection of …" entry points to the lemma) and, as a fallback, from the
//      inflection lists in the Wiktionary data;
//   2. when a hand-annotated Universal Dependencies treebank has seen the form often enough, its
//      share of each lemma is used (Polish "nie" is mostly the particle, not the pronoun "on");
//   3. otherwise the count is split in proportion to each lemma's overall evidence, iterated to a
//      fixed point (expectation-maximisation), with a small preference for the form's own headword.
import { foldLatinDiacritics, isWord, key } from './common.mjs';
import { PROPER_NOUN } from './sources.mjs';
import { lookup, pointerTargets, usableBlocks } from './wiktionary.mjs';

const TB_MIN = 3; // treebank occurrences needed before the treebank decides a form's lemmas
const TB_PRIOR = 1; // pseudo-count spread over lexicon candidates when the treebank decides
const IDENTITY_BOOST = 2; // weight of "the form is its own dictionary headword" in the EM split
const EM_ROUNDS = 25;
/** Languages whose frequency lists contain unaccented spellings of accented words (moze → może, policia → polícia). */
const FOLD_LANGS = new Set(['es', 'pt', 'pl']);

export function makeResolver(dict, lang) {
  const usableCache = new Map();
  const has = (k) => {
    let v = usableCache.get(k);
    if (v === undefined) {
      v = usableBlocks(lookup(dict, k, lang)).length > 0;
      usableCache.set(k, v);
    }
    return v;
  };
  /** Lemma key with a usable Wiktionary entry, or null. Polish reflexive verbs live under "… się". */
  const resolve = (k) => {
    if (has(k)) return k;
    if (lang === 'pl' && has(`${k} się`)) return `${k} się`;
    return null;
  };
  const pointerCache = new Map();
  const pointers = (k) => {
    let v = pointerCache.get(k);
    if (v === undefined) {
      const hw = lookup(dict, k, lang).filter((h) => h.word === h.word.toLowerCase());
      v = hw.length ? pointerTargets(hw).map((t) => key(t, lang)) : [];
      pointerCache.set(k, v);
    }
    return v;
  };
  return { has, resolve, pointers };
}

/** Map<formKey, Set<lemmaKey>> from the inflection lists in the Wiktionary data (fallback only). */
export function wiktionaryFormIndex(dict, lang, resolver) {
  const index = new Map();
  for (const [lk, headwords] of dict) {
    if (!resolver.has(lk)) continue;
    for (const h of headwords) {
      if (h.word !== h.word.toLowerCase()) continue;
      for (const f of h.forms) {
        const fk = key(f, lang);
        if (!fk || fk === lk || fk[0] !== lk[0]) continue; // unlabeled lists mix in table text; keep same-initial forms
        let set = index.get(fk);
        if (!set) index.set(fk, (set = new Set()));
        set.add(lk);
      }
    }
  }
  return index;
}

/**
 * @param list      [{word, count}] surface forms with counts (any order)
 * @param res       {lang, dict, lexicon?: {forms}, treebank?: {formLemma, mwt}, wiktForms?}
 * @returns {lemmas: Map<lemmaKey, {count, forms: Map<formKey, share>}>, stats, unassigned}
 */
export function lemmatize(list, res) {
  const { lang, lexicon, treebank, wiktForms } = res;
  const resolver = res.resolver;
  const counts = new Map();
  let skippedTokens = 0;
  for (const { word, count } of list) {
    const fk = key(word, lang);
    if (!fk || !isWord(fk, lang)) {
      skippedTokens += count;
      continue;
    }
    counts.set(fk, (counts.get(fk) ?? 0) + count);
  }

  /** A lemma whose dictionary entry only points elsewhere (проект → проєкт) is replaced by its targets. */
  const expand = (l) => {
    const t = resolver.pointers(l);
    return t.length ? t : [l];
  };
  // How often a lemma's own dictionary form occurs: a lemma never seen in its citation form
  // ("adir", "rosar") is an unlikely owner of an ambiguous form ("adia", "rosa").
  const citationPrior = (l) => Math.log10(10 + (counts.get(l) ?? 0));
  const fixed = new Map(); // formKey → Map<lemmaKey, share fraction>
  const em = new Map(); // formKey → [{lemma, boost}]
  const unassigned = [];
  const pendingFold = [];
  let viaFold = 0;
  let total = 0;
  let viaTreebank = 0;
  let viaEm = 0;

  for (const [fk, c] of counts) {
    total += c;
    const raw = new Set();
    for (const l of lexicon?.forms.get(fk) ?? []) raw.add(l);
    raw.add(fk); // the form may be its own headword
    // A headword that only points elsewhere ("alternative form of проєкт", "plural of casa") is not a lemma.
    const pointers = resolver.pointers(fk);
    if (pointers.length) {
      raw.delete(fk);
      for (const t of pointers) raw.add(t);
    }
    let cands = new Set([...raw].flatMap((l) => expand(l)).map((l) => resolver.resolve(l)).filter(Boolean));
    if (!cands.size && wiktForms?.has(fk)) cands = new Set([...wiktForms.get(fk)].map((l) => resolver.resolve(l)).filter(Boolean));

    // Treebank evidence, per lemma and part of speech (contractions are multiword tokens: do = de + o).
    const tb = new Map(); // "lemma\tUPOS" (UPOS may be empty) → n
    for (const [lp, n] of treebank?.formLemmaPos?.get(fk) ?? []) tb.set(lp, n);
    const propn = treebank?.formLemma.get(fk)?.get(PROPER_NOUN);
    if (propn) tb.set(`${PROPER_NOUN}\t`, propn);
    const mwt = treebank?.mwt.get(fk);
    if (mwt) {
      const n = [...mwt.values()].reduce((a, b) => a + b, 0);
      if (resolver.has(fk)) tb.set(`${fk}\t`, (tb.get(`${fk}\t`) ?? 0) + n);
      else for (const [l, m] of mwt) tb.set(`${l}\t`, (tb.get(`${l}\t`) ?? 0) + m);
    }
    const tbTotal = [...tb.values()].reduce((a, b) => a + b, 0);
    if (tbTotal >= TB_MIN) {
      const dist = new Map();
      for (const [lp, n] of tb) {
        const [l, upos] = lp.split('\t');
        if (l === PROPER_NOUN) {
          dist.set(PROPER_NOUN, (dist.get(PROPER_NOUN) ?? 0) + n);
          continue;
        }
        // The treebank's lemma in this part of speech may be a Wiktionary pointer (Spanish mi → mío).
        const raw = upos && resolver.resolvePos ? resolver.resolvePos(l, upos, fk) : expand(l);
        const targets = raw.map((x) => resolver.resolve(x)).filter(Boolean);
        for (const r of targets) dist.set(r, (dist.get(r) ?? 0) + n / targets.length);
      }
      if (cands.size) for (const l of cands) dist.set(l, (dist.get(l) ?? 0) + TB_PRIOR / cands.size);
      const sum = [...dist.values()].reduce((a, b) => a + b, 0);
      if (sum > 0) {
        for (const [l, n] of dist) dist.set(l, n / sum);
        fixed.set(fk, dist);
        viaTreebank += c;
        continue;
      }
    }
    if (!cands.size || (resolver.hasEntry && ![...cands].some((l) => resolver.hasEntry(l)))) {
      pendingFold.push({ fk, c, cands });
      continue;
    }
    em.set(fk, [...cands].map((l) => ({ lemma: l, boost: (l === fk ? IDENTITY_BOOST : 1) * citationPrior(l) })));
    viaEm += c;
  }

  // Unaccented spellings (moze, policia) borrow the candidates of the accented form the list also contains.
  if (FOLD_LANGS.has(lang)) {
    const byFold = new Map();
    const index = (fk, entry) => {
      const f = foldLatinDiacritics(fk);
      if (f === fk) return;
      let list = byFold.get(f);
      if (!list) byFold.set(f, (list = []));
      list.push({ fk, c: counts.get(fk), ...entry });
    };
    for (const [fk, cands] of em) index(fk, { cands });
    for (const [fk, dist] of fixed) index(fk, { dist });
    for (const p of pendingFold) {
      if (foldLatinDiacritics(p.fk) !== p.fk) continue; // only unaccented spellings borrow
      const options = (byFold.get(p.fk) ?? []).sort((a, b) => b.c - a.c);
      const best = options[0];
      if (!best || (options.length > 1 && best.c < 5 * options[1].c)) continue;
      if (best.dist) {
        fixed.set(p.fk, best.dist);
        viaTreebank += p.c;
      } else {
        em.set(p.fk, best.cands);
        viaEm += p.c;
      }
      viaFold += p.c;
      p.done = true;
    }
  }
  for (const p of pendingFold) {
    if (p.done) continue;
    if (p.cands.size) {
      em.set(p.fk, [...p.cands].map((l) => ({ lemma: l, boost: (l === p.fk ? IDENTITY_BOOST : 1) * citationPrior(l) })));
      viaEm += p.c;
    } else unassigned.push({ word: p.fk, count: p.c });
  }

  // Expectation-maximisation over the ambiguous forms; treebank-decided shares stay fixed.
  const fixedMass = new Map();
  let properMass = 0;
  for (const [fk, dist] of fixed)
    for (const [l, p] of dist) {
      if (l === PROPER_NOUN) properMass += p * counts.get(fk);
      else fixedMass.set(l, (fixedMass.get(l) ?? 0) + p * counts.get(fk));
    }
  let weight = new Map(fixedMass);
  for (const [fk, cands] of em) for (const { lemma } of cands) weight.set(lemma, (weight.get(lemma) ?? 0) + counts.get(fk) / cands.length);
  for (let round = 0; round < EM_ROUNDS; round++) {
    const next = new Map(fixedMass);
    for (const [fk, cands] of em) {
      const c = counts.get(fk);
      if (cands.length === 1) {
        next.set(cands[0].lemma, (next.get(cands[0].lemma) ?? 0) + c);
        continue;
      }
      let z = 0;
      for (const x of cands) z += (weight.get(x.lemma) ?? 0) * x.boost;
      for (const x of cands) {
        const p = z > 0 ? ((weight.get(x.lemma) ?? 0) * x.boost) / z : 1 / cands.length;
        next.set(x.lemma, (next.get(x.lemma) ?? 0) + p * c);
      }
    }
    weight = next;
  }

  // Final shares per lemma and form.
  const lemmas = new Map();
  const add = (l, fk, amount) => {
    if (amount <= 0) return;
    let e = lemmas.get(l);
    if (!e) lemmas.set(l, (e = { count: 0, forms: new Map() }));
    e.count += amount;
    e.forms.set(fk, (e.forms.get(fk) ?? 0) + amount);
  };
  for (const [fk, dist] of fixed) for (const [l, p] of dist) if (l !== PROPER_NOUN) add(l, fk, p * counts.get(fk));
  for (const [fk, cands] of em) {
    const c = counts.get(fk);
    let z = 0;
    for (const x of cands) z += (weight.get(x.lemma) ?? 0) * x.boost;
    for (const x of cands) add(x.lemma, fk, z > 0 ? (((weight.get(x.lemma) ?? 0) * x.boost) / z) * c : c / cands.length);
  }
  unassigned.sort((a, b) => b.count - a.count);
  const unassignedMass = unassigned.reduce((a, b) => a + b.count, 0);
  return {
    lemmas,
    counts,
    unassigned,
    stats: { forms: counts.size, total, viaTreebank, viaEm, viaFold, unassignedMass, properMass, skippedTokens },
  };
}
