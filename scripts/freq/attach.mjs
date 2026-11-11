// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Stage 2 of the frequency-set build: attach dictionary data to ranked lemmas.
// Every definition and part of speech comes from the dictionaries passed in, in order
// (English Wiktionary first; a fallback dictionary only where Wiktionary has no entry).
import { foldLatinDiacritics, key, stripStress } from './common.mjs';
import { UPOS_FAMILY } from './rank.mjs';
import { chooseSenses, lookup, usableBlocks } from './wiktionary.mjs';

/** Sections tried, in order, after the preposition section for a word the treebank tags ADP. */
const ADP_FALLBACK = ['adverb', 'conjunction'];

const VOWELS = { ru: /[аеёиоуыэюя]/gi, uk: /[аеєиіїоуюя]/gi };

/** Russian and Ukrainian mark stress only on words of two or more syllables. */
function stressOrNull(display, lang) {
  if (!display || !VOWELS[lang]) return display ?? null;
  const vowels = stripStress(display).match(VOWELS[lang]);
  return vowels && vowels.length > 1 ? display : null;
}

/**
 * Vietnamese spellings differ in tone-mark placement (hoà/hòa) and final i/y (lí/lý, kĩ/kỹ).
 * This key ignores both, but keeps the tones themselves (ma, má, mà stay different).
 */
export function vietnameseKey(word) {
  return word
    .normalize('NFC')
    .toLowerCase()
    .split(' ')
    .map((syl) => {
      const d = syl.normalize('NFD');
      const tone = (d.match(/[\u0300\u0301\u0303\u0309\u0323]/) ?? [''])[0];
      let base = d.replace(/[\u0300\u0301\u0303\u0309\u0323]/g, '').normalize('NFC');
      base = base.replace(/^([bcdđghklmnprstvx]+)y$/, '$1i');
      return base + tone;
    })
    .join(' ');
}

/** Map Vietnamese spelling keys → headword keys, including same-letter variants from the inflection lists. */
function vietnameseIndex(dict) {
  const index = new Map();
  const add = (k, target) => {
    if (!index.has(k)) index.set(k, target);
  };
  for (const [k, headwords] of dict) {
    add(vietnameseKey(k), k);
    for (const h of headwords)
      for (const f of h.forms ?? []) {
        const fk = f.normalize('NFC').toLowerCase();
        if (fk !== k && foldLatinDiacritics(fk) === foldLatinDiacritics(k)) add(vietnameseKey(fk), k);
      }
  }
  return index;
}

function normGender(g) {
  if (!g) return null;
  const s = String(g).toLowerCase();
  const m = /\bm/.test(s) || s === 'm';
  const f = /\bf/.test(s) || s === 'f';
  const n = /\bn/.test(s);
  if (m + f + n !== 1) return null;
  return m ? 'm' : f ? 'f' : 'n';
}

/** Stressed display form for Russian/Ukrainian: a stressed variant of the headword in its form list. */
function stressedDisplay(lemma, headword, extra = []) {
  if (headword.display && headword.display !== lemma && stripStress(headword.display) === lemma) return headword.display;
  for (const f of [...extra, ...(headword.forms ?? [])]) {
    if (f && f !== lemma && /[́̀]/.test(f.normalize('NFD')) && stripStress(f) === lemma) return f.normalize('NFC');
  }
  return null;
}

function pickExamples(sentences, lemma, wiktPos, max = 2) {
  if (!sentences) return [];
  const list = sentences.get(`${lemma}|${wiktPos}`) ?? [];
  const picked = [];
  const seen = new Set();
  const scored = list
    .filter((s) => s.words >= 3 && s.words <= 12 && s.text.toLowerCase().includes(s.target.toLowerCase()))
    .sort((a, b) => Math.abs(a.words - 7) - Math.abs(b.words - 7) || a.text.length - b.text.length);
  for (const s of scored) {
    if (picked.length >= max) break;
    if (seen.has(s.text)) continue;
    seen.add(s.text);
    picked.push({ text: s.text, translation: s.translation, target: s.target, credit: s.credit });
  }
  return picked;
}

/**
 * Portuguese spelling variants to try when a frequent word has no entry of its own:
 *   - the 2009 reform spelling (idéia → ideia, jóia → joia, freqüente → frequente, vôo → voo), shown as the lemma;
 *   - the European spelling of a Brazilian word (gênero → género, prêmio → prémio), whose entry defines the
 *     Brazilian word, which keeps its Brazilian spelling.
 */
export function portugueseVariants(word) {
  const out = [];
  const reformed = word
    .replace(/éi(a|as|o|os)$/, 'ei$1')
    .replace(/ói(a|as|o|os|ca|cas|co|cos)$/, 'oi$1')
    .replace(/ü/g, 'u')
    .replace(/ôo(s?)$/, 'oo$1')
    .replace(/êem$/, 'eem');
  if (reformed !== word) out.push({ k: reformed, keepSpelling: false, note: `Older spelling: ${word}.` });
  const european = word.replace(/ê/g, 'é').replace(/ô/g, 'ó');
  if (european !== word) out.push({ k: european, keepSpelling: true, note: `Brazilian spelling; European Portuguese writes ${european}.` });
  return out;
}

function grammarNotes(usage, extra) {
  const parts = [];
  if (extra) parts.push(extra);
  if (usage) parts.push(usage.length > 1200 ? usage.slice(0, 1197) + '…' : usage);
  return parts.length ? { notes: parts.join('\n\n') } : null;
}

/**
 * @param lang     language code
 * @param ranked   stage-1 lemmas, most frequent first
 * @param opts     {dicts: [{name, dict}], top, openRussian?, sentences?, maxForms?}
 * @returns {entries, skipped, credits, stats}
 */
export function attach(lang, ranked, { dicts, top = 6000, openRussian = null, sentences = null, maxForms = 24 }) {
  const entries = [];
  const skipped = [];
  const credits = [];
  const used = new Map(); // headword key → entry (two ranked lemmas can share one dictionary headword)
  const bySource = {};
  const viIndexes = lang === 'vi' ? dicts.map(({ dict }) => vietnameseIndex(dict)) : null;
  let position = 0;
  for (const item of ranked) {
    if (entries.length >= top) break;
    position++;
    const keys = [{ k: item.lemma }];
    if (lang === 'pl') keys.push({ k: `${item.lemma} się` });
    if (lang === 'pt') keys.push(...portugueseVariants(item.spelling ?? item.lemma));
    let found = null;
    // Lowercase headwords in every dictionary first; a capitalised one (OK, TV) only as a last resort.
    for (const lowercaseOnly of [true, false]) {
      for (let d = 0; d < dicts.length && !found; d++) {
        const { name, dict, tag } = dicts[d];
        const variants = [...keys];
        if (viIndexes) {
          const alias = viIndexes[d].get(vietnameseKey(item.spelling ?? item.lemma));
          if (alias) variants.push({ k: alias });
        }
        for (const v of variants) {
          const usable = usableBlocks(lookup(dict, v.k, lang), { lowercaseOnly });
          if (usable.length) {
            found = { source: name, tag, usable, ...v };
            break;
          }
        }
      }
      if (found) break;
    }
    if (!found) {
      skipped.push({ position, lemma: item.spelling ?? item.lemma, count: item.count });
      continue;
    }
    const hk = key(found.usable[0].headword.word, lang);
    if (used.has(hk)) continue;

    let preferredFamily = null;
    if (item.upos) {
      const top = Object.entries(item.upos).sort((a, b) => b[1] - a[1])[0];
      preferredFamily = top ? UPOS_FAMILY[top[0]] ?? null : null;
      // Where Wiktionary has no preposition section for a word the treebank tags as one, its adverb or
      // conjunction section carries that use (Vietnamese của "of", Spanish salvo "except"), not a noun or verb.
      if (top?.[0] === 'ADP') preferredFamily = [...preferredFamily, ...ADP_FALLBACK];
    }
    const chosen = chooseSenses(found.usable, lang, { preferredFamily });
    if (!chosen?.senses.length) {
      skipped.push({ position, lemma: item.spelling ?? item.lemma, count: item.count, reason: 'no usable senses' });
      continue;
    }
    const { main, senses } = chosen;
    const headword = main.headword;
    // Brazilian spellings defined under the European entry keep the Brazilian spelling (gênero, not género).
    const lemma = found.keepSpelling ? stripStress(item.spelling ?? item.lemma) : stripStress(headword.word);
    // Abbreviations written with a full stop (ул., etc., S.) are shorthand for writing, not words to learn.
    if (/\./.test(lemma)) {
      skipped.push({ position, lemma, count: item.count, reason: 'abbreviation' });
      continue;
    }

    // Russian: OpenRussian supplies stress, gender, aspect and tagged inflection tables.
    let orItem = null;
    if (lang === 'ru' && openRussian) {
      const items = openRussian.get(key(lemma, 'ru')) ?? [];
      const kind = { noun: 'nouns', verb: 'verbs', adjective: 'adjectives' }[main.pos] ?? 'others';
      orItem = items.find((i) => i.kind === kind && stripStress(i.accented) === lemma) ?? items.find((i) => stripStress(i.accented) === lemma) ?? null;
    }

    let display = null;
    if (lang === 'ru') display = stressOrNull((orItem?.accented && orItem.accented !== lemma ? orItem.accented : null) ?? stressedDisplay(lemma, headword), lang);
    else if (lang === 'uk') display = stressOrNull(stressedDisplay(lemma, headword), lang);

    // Forms: tagged tables where a source has them, otherwise the forms the frequency list attested.
    let forms = [];
    const seenForms = new Set([key(lemma, lang)]);
    const pushForm = (form, displayForm, tags) => {
      const k = key(form, lang);
      if (!k || seenForms.has(k) || forms.length >= maxForms) return;
      seenForms.add(k);
      const disp = displayForm && displayForm !== stripStress(displayForm) ? stressOrNull(displayForm, lang) : null;
      forms.push({ form: stripStress(form), display: disp, tags });
    };
    if (orItem) for (const f of orItem.forms) pushForm(f.form, f.display, f.tags);
    else if (lang === 'uk' && headword.source === 'dmklinger') for (const f of headword.forms) pushForm(f, f, []);
    for (const [f] of item.forms ?? []) {
      let disp = null;
      if (lang === 'uk' || lang === 'ru') disp = (headword.forms ?? []).find((x) => key(x, lang) === f && /[\u0301\u0300]/.test(x.normalize('NFD'))) ?? null;
      pushForm(f, disp, []);
    }

    const block = main.block;
    const examples = sentences ? pickExamples(sentences, headword.word, main.wiktPos) : (block.examples ?? []).slice(0, 2);
    for (const x of examples) if (x.credit) credits.push({ lemma, text: x.text, credit: x.credit });

    const entry = {
      lemma,
      display,
      pos: main.pos,
      gender: lang === 'ru' ? normGender(orItem?.gender) : normGender(block.gender),
      aspect: lang === 'ru' ? (orItem?.aspect === 'imperfective' || orItem?.aspect === 'perfective' ? orItem.aspect : null) : block.aspect ?? null,
      aspectPair: lang === 'ru' && orItem?.partner ? orItem.partner.split(/[;,]/)[0].trim() || null : null,
      pronunciation: block.ipa ?? null,
      register: null,
      regionalNote: null,
      senses,
      forms,
      examples: examples.map(({ text, translation, target }) => ({ text, translation, target })),
      expressions: [],
      grammar: grammarNotes(block.usage, found.note),
      tags: found.tag ? [found.tag] : [],
      frequencyRank: entries.length + 1,
      curatedOrder: null,
      imageUrl: null,
    };
    entries.push(entry);
    used.set(hk, entry);
    bySource[found.source] = (bySource[found.source] ?? 0) + 1;
  }
  return { entries, skipped, credits, stats: { considered: position, bySource, skipped: skipped.length } };
}
