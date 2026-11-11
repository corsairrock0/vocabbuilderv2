// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Example sentences for every word of a frequency set, chosen for cloze (fill-in-the-blank) practice.
//
// Candidates, best first:
//   1. Tatoeba (tatoeba.org, CC BY 2.0 FR): conversational sentences with English translations, from the
//      Vuizur/tatoeba-to-anki decks (the 9,000 most common, easiest sentences per language), the development
//      and test sets of Helsinki-NLP/Tatoeba-Challenge (released under Tatoeba's own CC BY 2.0 FR licence)
//      and, for Spanish, the 160,000 pairs tagged in doozan/spanish_data.
//   2. Universal Dependencies treebanks, whose lemmas are hand-checked: short sentences only, without
//      translations. Each sentence keeps its treebank's licence (some are non-commercial; see SENTENCE_SOURCES).
// A sentence is scored by how common its other words are (the rarest one decides) and by its length, so the
// chosen sentences are short and made of everyday words. Up to three per word, with different forms of the
// word where possible. Sentences with vulgar or distressing words are never used.
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync } from 'node:fs';
import { foldLatinDiacritics, key as matchKey, lines, log } from './common.mjs';
import { vietnameseSpellingKey } from '../../shared/text.ts';

// Vietnamese is matched on its spelling key, so công ty in a sentence finds the entry công ti.
const key = (s, lang) => (lang === 'vi' ? vietnameseSpellingKey(String(s ?? '')) : matchKey(s, lang));

const ud = (repo, prefix, parts) => parts.map((p) => `ud/${repo}/${prefix}-ud-${p}.conllu`);

/** Sentence sources: id → {name, license, url, files, kind}. Ids are stored with each example. */
export const SENTENCE_SOURCES = {
  tatoeba: { name: 'Tatoeba', license: 'CC-BY-2.0-FR', url: 'https://tatoeba.org', kind: 'tatoeba' },
  // Written for this app by an AI (Claude), only for words that no collection has a sentence for. They come from
  // data/ai-sentences/<lang>.tsv in the repository; the app labels them as AI-written.
  'ai-claude': { name: 'AI-written (Claude)', license: 'AI-generated, not checked by a native speaker', url: null, kind: 'ai', ai: true },
  'es-ancora': { lang: 'es', name: 'UD Spanish AnCora', license: 'CC-BY-4.0', url: 'https://github.com/UniversalDependencies/UD_Spanish-AnCora', files: ud('UD_Spanish-AnCora', 'es_ancora', ['train', 'dev', 'test']) },
  'pt-porttinari': { lang: 'pt', name: 'UD Portuguese Porttinari', license: 'CC-BY-SA-4.0', url: 'https://github.com/UniversalDependencies/UD_Portuguese-Porttinari', files: ud('UD_Portuguese-Porttinari', 'pt_porttinari', ['train', 'dev', 'test']) },
  // VTB's sentence text has a space before every punctuation mark ("đảm bảo ."); it is closed up for display.
  'vi-vtb': { lang: 'vi', name: 'UD Vietnamese VTB', license: 'CC-BY-SA-4.0', url: 'https://github.com/UniversalDependencies/UD_Vietnamese-VTB', files: ud('UD_Vietnamese-VTB', 'vi_vtb', ['train', 'dev', 'test']), spacedPunctuation: true },
  'ru-taiga': { lang: 'ru', name: 'UD Russian Taiga', license: 'CC-BY-SA-4.0', url: 'https://github.com/UniversalDependencies/UD_Russian-Taiga', files: ud('UD_Russian-Taiga', 'ru_taiga', ['train-a', 'train-b', 'train-c', 'train-d', 'train-e', 'dev', 'test']) },
  'ru-gsd': { lang: 'ru', name: 'UD Russian GSD', license: 'CC-BY-SA-4.0', url: 'https://github.com/UniversalDependencies/UD_Russian-GSD', files: ud('UD_Russian-GSD', 'ru_gsd', ['train', 'dev', 'test']) },
  'ru-syntagrus': { lang: 'ru', name: 'UD Russian SynTagRus', license: 'CC-BY-NC-SA-4.0', url: 'https://github.com/UniversalDependencies/UD_Russian-SynTagRus', files: ud('UD_Russian-SynTagRus', 'ru_syntagrus', ['train-a', 'train-b', 'train-c', 'dev', 'test']), nonCommercial: true },
  'pl-pud': { lang: 'pl', name: 'UD Polish PUD', license: 'CC-BY-SA-4.0', url: 'https://github.com/UniversalDependencies/UD_Polish-PUD', files: ud('UD_Polish-PUD', 'pl_pud', ['test']) },
  'pl-lfg': { lang: 'pl', name: 'UD Polish LFG', license: 'GPL-3.0', url: 'https://github.com/UniversalDependencies/UD_Polish-LFG', files: ud('UD_Polish-LFG', 'pl_lfg', ['train', 'dev', 'test']) },
  'pl-pdb': { lang: 'pl', name: 'UD Polish PDB', license: 'CC-BY-NC-SA-4.0', url: 'https://github.com/UniversalDependencies/UD_Polish-PDB', files: ud('UD_Polish-PDB', 'pl_pdb', ['train', 'dev', 'test']), nonCommercial: true },
  'uk-iu': { lang: 'uk', name: 'UD Ukrainian IU', license: 'CC-BY-NC-SA-4.0', url: 'https://github.com/UniversalDependencies/UD_Ukrainian-IU', files: ud('UD_Ukrainian-IU', 'uk_iu', ['train', 'dev', 'test']), nonCommercial: true },
};

/** Treebanks per language, most everyday first (Taiga is largely social media and fiction). */
const TREEBANKS = { es: ['es-ancora'], pt: ['pt-porttinari'], vi: ['vi-vtb'], ru: ['ru-taiga', 'ru-gsd', 'ru-syntagrus'], pl: ['pl-lfg', 'pl-pud', 'pl-pdb'], uk: ['uk-iu'] };
export const TATOEBA_DECK = (lang) => `tatoeba-decks/${lang}.sqlite`;
const ISO3 = { es: 'spa', pt: 'por', pl: 'pol', ru: 'rus', uk: 'ukr', vi: 'vie' };
/** Tatoeba-Challenge development and test sets (CC BY 2.0 FR; its training data, CC BY-NC-SA, is not used). */
export const TATOEBA_CHALLENGE = (lang) => [
  `tatoeba-challenge/data/dev/eng-${ISO3[lang]}/dev.txt`,
  ...['test-v2020-05-31', 'test-v2021-03-10', 'test-v2021-07-22', 'test-v2023-04-12'].map((t) => `tatoeba-challenge/data/devtest/eng-${ISO3[lang]}/${t}.txt`),
];

// Sentences that read as another variety than the one taught rank lower (still used when nothing else has the
// word): European Portuguese for Brazilian, Spain's vosotros for Colombian Spanish.
const OTHER_VARIETY = {
  pt: (text, keys) =>
    /\b(estou|estás|está|estamos|estão|estava|estavas|estávamos|estavam|estive|esteve|ando|andas|anda|andam) a [a-zà-ú]+(ar|er|ir)\b/i.test(text) ||
    keys.some((k) => /^(rapariga|raparigas|comboio|comboios|autocarro|autocarros|telemóvel|telemóveis|frigorífico|ecrã|facto|factos|connosco|convosco|registo|equipa|equipas|miúdo|miúda|miúdos|bué|fixe|gajo|gaja|vós|vosso|vossa|vossos|vossas)$/.test(k)),
  es: (text, keys) => keys.some((k) => /^(vosotros|vosotras|vuestro|vuestra|vuestros|vuestras|os|sois|vais|dais|veis|[a-zñ]+(áis|éis))$/.test(k)),
};

// Words that keep a sentence out of practice: vulgar or offensive words, and suicide or sexual violence.
const BLOCK = {
  es: /^(putas?|put[oi]s?|putita|hij[oa]e?puta|hijodeputa|malparid[oa]s?|mierdas?|joder|jodid[oa]s?|jódete|coño|carajo|pendej[oa]s?|vergas?|culos?|maric[oó]n(es)?|maricas?|gonorrea|gilipollas|pollas?|follar|folla[rnds]?\w*|cojones|cabr[oó]n(a|es)?|ching\w+|zorras?|mamadas?|pajer[oa]s?|suicid\w*|viol[oó]|violaron|violad[oa]|violación|negrata|sudaca)$/u,
  pt: /^(porra|caralho|merdas?|putas?|put[oa]s?|foder|fod[ae]\w*|fodid[oa]s?|buceta|cu|cuzão|cacete|viado|piroca|bosta|arrombad[oa]s?|vagabunda|corno|punheta|suicid\w*|estupr\w*)$/u,
  pl: /^(kurw\w*|chuj\w*|huj\w*|pierd[oa]l\w*|spierd\w*|zapierd\w*|jeb\w*|zajeb\w*|wyjeb\w*|pizd\w*|skurwy\w*|cip(a|y|ka|ki)|dup(a|y|ę|ie)|pedał\w*|ciot(a|y)|samobój\w*|gwałt|gwałcić|zgwałc\w*)$/u,
  ru: /^(ху[йяеюи]\w*|нахуй|похуй|пизд\w*|бля\w*|сук(а|и|у|ой)|[её]бать|[её]бал\w*|[её]бан\w*|[её]бну\w*|заеб\w*|наеб\w*|уеб\w*|у[её]бок|отъеб\w*|ебло|ебуч\w*|муда\w*|мудил\w*|залуп\w*|пид[оа]р\w*|гандон\w*|жоп(а|у|ы|е|ой)|говн\w*|дерьм\w*|самоубийств\w*|изнасил\w*)$/u,
  uk: /^(ху[йяєюї]\w*|пизд\w*|бля\w*|сук(а|и|у|ою)|[ї]бати|йоба\w*|єба\w*|муда\w*|підор\w*|гандон\w*|срак\w*|гівн\w*|самогубств\w*|зґвалт\w*)$/u,
  vi: /^(đụ|địt|đéo|lồn|cặc|buồi|đĩ|cứt)$/u,
};

const WORD_RE = /[\p{L}\p{M}]+(?:['’ʼ-][\p{L}\p{M}]+)*/gu;

function unescapeHtml(s) {
  return String(s ?? '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Word tokens of a sentence with their offsets (Vietnamese: syllables, joined later by segmentation). */
export function tokenize(text) {
  return [...text.matchAll(WORD_RE)].map((m) => ({ form: m[0], start: m.index, end: m.index + m[0].length }));
}

// ------------------------------------------------------------------ readers

/** A Vuizur/tatoeba-to-anki deck (its collection database) → [{text, translation, ref}] in deck order. */
export function readTatoebaDeck(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const rows = db.prepare('SELECT flds FROM notes ORDER BY id').all();
    return rows.map(({ flds }) => {
      const [q = '', a = '', media = ''] = String(flds).split('\x1f');
      const id = /\[sound:(\d+)\.mp3\]/.exec(media)?.[1] ?? null;
      return { text: unescapeHtml(q), translation: unescapeHtml(a.split(/<p>\s*<details>/i)[0]), ref: id ? `tatoeba:${id}` : null };
    });
  } finally {
    db.close();
  }
}

/** doozan/spanish_data sentences.tsv → [{text, translation, credit, native, tags: [{pos, form, lemma}]}]. */
export async function readDoozan(file) {
  const out = [];
  for await (const line of lines(file)) {
    const cols = line.split('\t');
    if (cols.length < 6) continue;
    const [en, es, credit, , spaLevel, tagText] = cols;
    const tags = [];
    for (const t of tagText.split(' ')) {
      const m = /^:([a-z-]+),(.+)$/.exec(t);
      if (!m) continue;
      for (const item of m[2].split(',')) {
        const [form, lemma = form] = item.split('|');
        if (!form.includes(' ')) tags.push({ pos: m[1].replace(/^phrase-/, ''), form, lemma });
      }
    }
    const ids = [...credit.matchAll(/#(\d+)/g)].map((x) => x[1]);
    out.push({ text: es, translation: en, credit, native: spaLevel === '5', ref: ids[0] ? `tatoeba:${ids[0]}` : null, tags });
  }
  return out;
}

/** Tatoeba-Challenge "eng <tab> xxx <tab> English <tab> sentence" lines → {text, translation}. */
export async function* readTatoebaChallenge(files) {
  for (const file of files) {
    if (!existsSync(file)) continue;
    for await (const line of lines(file)) {
      const cols = line.split('\t');
      if (cols.length < 4 || cols[0] !== 'eng') continue;
      yield { text: cols[3].trim(), translation: cols[2].trim() };
    }
  }
}

/** CoNLL-U sentences, one at a time → {text, ref, tokens: [{form, lemma, upos}]} (multiword tokens stay unanalysed). */
export async function* readConllu(files) {
  for (const file of files) {
    if (!existsSync(file)) continue;
    let cur = null;
    let mwtEnd = 0;
    for await (const line of lines(file)) {
      if (!line) {
        if (cur?.text) yield cur;
        cur = null;
        mwtEnd = 0;
        continue;
      }
      if (!cur) cur = { text: '', ref: null, tokens: [] };
      if (line[0] === '#') {
        const t = /^# text\s*=\s*(.*)$/.exec(line);
        if (t) cur.text = t[1].trim();
        const id = /^# sent_id\s*=\s*(.*)$/.exec(line);
        if (id) cur.ref = id[1].trim();
        continue;
      }
      const cols = line.split('\t');
      if (/^\d+-\d+$/.test(cols[0])) {
        mwtEnd = Number(cols[0].split('-')[1]);
        cur.tokens.push({ form: cols[1], lemma: null, upos: 'MWT' });
        continue;
      }
      if (!/^\d+$/.test(cols[0]) || Number(cols[0]) <= mwtEnd) continue;
      cur.tokens.push({ form: cols[1], lemma: cols[2], upos: cols[3] });
    }
    if (cur?.text) yield cur;
  }
}

// ------------------------------------------------------------------ choosing

const DOOZAN_POS = { verb: ['v'], noun: ['n'], adjective: ['adj'], adverb: ['adv'], pronoun: ['pron'], determiner: ['art', 'determiner', 'adj', 'pron'], preposition: ['prep'], conjunction: ['conj'], numeral: ['num'], interjection: ['interj'], particle: ['part'], contraction: ['contraction', 'prep'] };
const UPOS = {
  noun: ['NOUN'], verb: ['VERB', 'AUX'], adjective: ['ADJ'], adverb: ['ADV'], pronoun: ['PRON', 'DET'], determiner: ['DET', 'PRON'], preposition: ['ADP'],
  conjunction: ['CCONJ', 'SCONJ'], numeral: ['NUM'], interjection: ['INTJ'], particle: ['PART', 'ADV'], phrase: [], contraction: ['ADP'],
};

/** Every form a word can take in a sentence, as match keys: lemma, table cells and dictionary forms. */
function formKeys(e, lang) {
  const out = new Set([key(e.lemma, lang)]);
  for (const forms of Object.values(e.paradigm?.cells ?? {})) for (const f of forms) if (!f.includes(' ')) out.add(key(f, lang));
  for (const f of e.forms ?? []) out.add(key(f.form, lang));
  return out;
}

/** "Trong khi , tương lai ... \" có chồn \" ." → "Trong khi, tương lai ... \"có chồn\"." */
export function closeUpPunctuation(text) {
  let open = true;
  const quoted = text.replace(/ ?" ?/g, (m) => {
    const out = open ? (m.startsWith(' ') ? ' "' : '"') : m.endsWith(' ') ? '" ' : '"';
    open = !open;
    return out;
  });
  return quoted.replace(/ +([,.:;!?…%)\]»”])/g, '$1').replace(/([(\[«“]) +/g, '$1').replace(/ {2,}/g, ' ').trim();
}

// Longest sentences used, in words: from conversational sources (14) and from treebanks (22). A word with no such
// sentence at all may get treebank sentences of up to 30 words or with numbers in them, as a last resort.
// Vietnamese is written in syllables, about one and a half to a word, so its limits count syllables.
const MAX_WORDS = { loose: 14, strict: 22, lastResort: 30 };
const wordLimit = (lang, kind) => MAX_WORDS[kind] * (lang === 'vi' ? 1.5 : 1);
const LAST_RESORT = 3; // added to a treebank sentence's tier

function sentenceOk(text, lang, { strict }) {
  if (!text || text.length > (strict ? 260 : 160) || /https?:|www\.|@|#|[<>{}[\]|_]/.test(text)) return false;
  if (!strict && /\d/.test(text)) return false;
  if (strict && !/^[\p{Lu}"«„¿¡–—-]/u.test(text)) return false;
  if (strict && !/[.!?…»"”]$/.test(text)) return false;
  const words = text.match(WORD_RE) ?? [];
  return words.length >= 3 && words.length <= wordLimit(lang, strict ? 'lastResort' : 'loose');
}

const lastResort = (text, lang) => /\d/.test(text) || text.length > 200 || (text.match(WORD_RE) ?? []).length > wordLimit(lang, 'strict');

function lengthPenalty(n) {
  return n >= 4 && n <= 10 ? 0 : n === 3 || n <= 12 ? 1 : n <= 16 ? 2 : 3;
}

function byScore(a, b) {
  for (let j = 0; j < a.score.length; j++) if (a.score[j] !== b.score[j]) return a.score[j] - b.score[j];
  return a.s.text.length - b.s.text.length;
}

function rankBucket(r) {
  return r <= 500 ? 0 : r <= 1500 ? 1 : r <= 3000 ? 2 : r <= 6000 ? 3 : r <= 15000 ? 4 : 5;
}

/**
 * Attach up to `max` cloze sentences to every entry (replacing entry.examples). `src(p)` resolves paths in
 * the sources directory; `ranks` is the stage-1 rank file (for how common each sentence's words are).
 * Returns {stats, credits}.
 */
export async function attachSentences(lang, entries, src, ranks, { max = 3, nonCommercial = true, aiFile = null } = {}) {
  // How common each word form is: the best frequency rank of any lemma it belongs to.
  const formRank = new Map();
  const noteRank = (k, r) => {
    if (!formRank.has(k) || formRank.get(k) > r) formRank.set(k, r);
  };
  (ranks?.ranked ?? []).forEach((r, i) => {
    noteRank(key(r.lemma, lang), i + 1);
    for (const [f] of r.forms ?? []) noteRank(key(f, lang), i + 1);
  });
  // Which entries each form can belong to, and how sure: the rank file's share of the form for that lemma.
  const share = new Map(); // "formKey\tlemmaKey" → share
  for (const r of ranks?.ranked ?? []) for (const [f, , s] of r.forms ?? []) share.set(`${key(f, lang)}\t${key(r.lemma, lang)}`, s);
  const byForm = new Map();
  entries.forEach((e, i) => {
    for (const k of formKeys(e, lang)) {
      const list = byForm.get(k) ?? [];
      list.push(i);
      byForm.set(k, list);
      noteRank(k, e.frequencyRank ?? 99999);
    }
  });
  const lemmaKeys = entries.map((e) => key(e.lemma, lang));
  const confident = (fk, i) => {
    const owners = byForm.get(fk) ?? [];
    if (!owners.includes(i)) return false;
    if (owners.length === 1 || lemmaKeys[i] === fk) return true; // the headword itself (esto, sé, un)
    const s = share.get(`${fk}\t${lemmaKeys[i]}`);
    return s !== undefined && s >= 0.75;
  };
  /** Matches by spelling alone, for untagged sentences (and tagged ones the tags missed). */
  const lexical = (tokens) => {
    const out = [];
    tokens.forEach((t, ti) => {
      const fk = key(t.form, lang);
      for (const i of byForm.get(fk) ?? []) if (confident(fk, i)) out.push([i, ti]);
    });
    return out;
  };

  // Vietnamese words span syllables: segment sentences greedily into the longest known words.
  const viWords = lang === 'vi' ? new Set(entries.map((e) => key(e.lemma, 'vi'))) : null;
  const segment = (tokens) => {
    if (!viWords) return tokens;
    const out = [];
    for (let i = 0; i < tokens.length; ) {
      let took = 1;
      for (let n = Math.min(4, tokens.length - i); n > 1; n--) {
        const k = tokens.slice(i, i + n).map((t) => t.form).join(' ');
        if (viWords.has(key(k, 'vi'))) {
          took = n;
          break;
        }
      }
      const span = tokens.slice(i, i + took);
      out.push({ form: span.map((t) => t.form).join(' '), start: span[0].start, end: span[span.length - 1].end });
      i += took;
    }
    return out;
  };

  const candidates = entries.map(() => []); // per entry: [{s, target, score}]
  const seenPair = new Set();
  const consider = (s, tokens, matches, tier) => {
    // tokens: [{form, start, end}] of the sentence text; matches: [[entryIndex, tokenIndex]]
    const keys = tokens.map((t) => key(t.form, lang));
    // A vulgar or distressing word keeps the sentence away from every word but itself.
    const blocked = keys.map((k, j) => (BLOCK[lang].test(k) ? j : -1)).filter((j) => j >= 0);
    seenPair.clear();
    for (const [i, ti] of matches) {
      const t = tokens[ti];
      if (!t || seenPair.has(`${i}:${ti}`)) continue;
      seenPair.add(`${i}:${ti}`);
      if (blocked.some((j) => j !== ti)) continue;
      const tk = keys[ti];
      if (keys.filter((k) => k === tk).length !== 1) continue; // the blank must be unambiguous
      let rarest = 0;
      let logSum = 0;
      let n = 0;
      tokens.forEach((o, j) => {
        if (j === ti) return;
        if (j > 0 && /^\p{Lu}/u.test(o.form) && lang !== 'vi') return; // names (Tom, Mary) say nothing about difficulty
        const r = formRank.get(keys[j]) ?? 50000;
        rarest = Math.max(rarest, r);
        logSum += Math.log(r);
        n++;
      });
      const variety = OTHER_VARIETY[lang]?.(s.text, keys) ? 0.5 : 0;
      const score = [tier + variety, rankBucket(rarest), lengthPenalty(tokens.length), n ? logSum / n : 0];
      const list = candidates[i];
      list.push({ s, target: t.form, score });
      if (list.length > 150) {
        // Common words match tens of thousands of sentences: keep the best 60 as we go.
        list.sort(byScore);
        list.length = 60;
      }
    }
  };

  const stats = { entries: entries.length, bySource: {}, withSentences: 0, withTranslation: 0, candidates: 0, aiWords: 0, aiRejected: [] };
  const seenText = new Set();
  const take = (s) => {
    const k = s.text.toLowerCase().replace(/[^\p{L}\p{M}]+/gu, ' ').trim();
    if (seenText.has(k)) return false;
    seenText.add(k);
    return true;
  };

  // 1. Tatoeba
  if (lang === 'es') {
    const file = src('doozan-spanish_data/sentences.tsv');
    if (existsSync(file)) {
      const byLemmaKey = new Map();
      entries.forEach((e, i) => {
        const list = byLemmaKey.get(key(e.lemma, lang)) ?? [];
        list.push(i);
        byLemmaKey.set(key(e.lemma, lang), list);
      });
      for (const d of await readDoozan(file)) {
        if (!sentenceOk(d.text, lang, { strict: false }) || !take(d)) continue;
        const tokens = tokenize(d.text);
        const matches = [];
        for (const tag of d.tags) {
          for (const i of byLemmaKey.get(key(tag.lemma, lang)) ?? []) {
            if (!(DOOZAN_POS[entries[i].pos] ?? []).includes(tag.pos)) continue;
            const ti = tokens.findIndex((t) => t.form === tag.form);
            if (ti >= 0) matches.push([i, ti]);
          }
        }
        matches.push(...lexical(tokens));
        consider({ text: d.text, translation: d.translation, source: 'tatoeba', ref: d.ref, credit: d.credit }, tokens, matches, d.native ? 0 : 0.5);
      }
    }
  }
  const deck = src(TATOEBA_DECK(lang));
  if (existsSync(deck)) {
    for (const d of readTatoebaDeck(deck)) {
      if (!sentenceOk(d.text, lang, { strict: false }) || !take(d)) continue;
      const tokens = segment(tokenize(d.text));
      const matches = lexical(tokens);
      consider({ text: d.text, translation: d.translation || null, source: 'tatoeba', ref: d.ref, credit: d.ref ? `Tatoeba sentence #${d.ref.slice(8)}` : 'Tatoeba' }, tokens, matches, 0);
    }
  } else log(`[${lang}] no Tatoeba deck at ${deck}`);
  let tc = 0;
  for await (const d of readTatoebaChallenge(TATOEBA_CHALLENGE(lang).map(src))) {
    if (!sentenceOk(d.text, lang, { strict: false }) || !take(d)) continue;
    tc++;
    const tokens = segment(tokenize(d.text));
    const matches = lexical(tokens);
    if (matches.length) consider({ text: d.text, translation: d.translation || null, source: 'tatoeba', ref: null, credit: 'Tatoeba (Helsinki-NLP Tatoeba-Challenge development and test sets)' }, tokens, matches, 0.25);
  }
  if (!tc) log(`[${lang}] no Tatoeba-Challenge sentences found`);

  // 2. Treebanks (gold lemmas; no translations)
  const lemmaIndex = new Map();
  entries.forEach((e, i) => {
    const list = lemmaIndex.get(key(e.lemma, lang)) ?? [];
    list.push(i);
    lemmaIndex.set(key(e.lemma, lang), list);
  });
  for (const id of TREEBANKS[lang] ?? []) {
    const conf = SENTENCE_SOURCES[id];
    if (conf.nonCommercial && !nonCommercial) continue;
    const files = conf.files.map(src).filter(existsSync);
    if (!files.length) {
      log(`[${lang}] treebank ${conf.name} not found; skipped`);
      continue;
    }
    for await (const s of readConllu(files)) {
      if (conf.spacedPunctuation) s.text = closeUpPunctuation(s.text);
      if (!sentenceOk(s.text, lang, { strict: true })) continue;
      const tokens = tokenize(s.text);
      if (lang === 'vi') {
        // VTB tokens are whole words: re-segment the text into them.
        tokens.length = 0;
        let pos = 0;
        for (const t of s.tokens) {
          const at = s.text.indexOf(t.form, pos);
          if (at < 0 || !/\p{L}/u.test(t.form)) continue;
          tokens.push({ form: t.form, start: at, end: at + t.form.length });
          pos = at + t.form.length;
        }
      }
      const matches = [];
      const loose = []; // Vietnamese only: the right word, tagged with another part of speech than the entry's
      for (const t of s.tokens) {
        if (!t.lemma || t.upos === 'MWT' || t.upos === 'PROPN') continue;
        const owners = lemmaIndex.get(key(t.lemma, lang)) ?? [];
        for (const i of owners) {
          const want = UPOS[entries[i].pos] ?? [];
          const ti = tokens.findIndex((x) => x.form === t.form);
          if (ti < 0) continue;
          if (!want.length || want.includes(t.upos)) matches.push([i, ti]);
          // Words do not inflect, so the spelling is the word; VTB often tags as nouns what Wiktionary calls
          // adverbs (hiện nay "nowadays"). Such sentences rank below correctly tagged ones of the same length.
          else if (lang === 'vi' && owners.length === 1 && t.upos !== 'PUNCT') loose.push([i, ti]);
        }
      }
      // Every openly licensed treebank ranks alike; non-commercial ones only stand in where nothing else has the word.
      if ((matches.length || loose.length) && take(s)) {
        const sentence = { text: s.text, translation: null, source: id, ref: s.ref ? `${id}:${s.ref}` : null, credit: `${conf.name}${s.ref ? `, sentence ${s.ref}` : ''} (${conf.license})` };
        const tier = (conf.nonCommercial ? 2 : 1) + (lastResort(s.text, lang) ? LAST_RESORT : 0);
        if (matches.length) consider(sentence, tokens, matches, tier);
        if (loose.length) consider(sentence, tokens, loose, tier + 0.25);
      }
    }
  }

  const credits = [];
  entries.forEach((e, i) => {
    const list = candidates[i].sort(byScore);
    stats.candidates += list.length;
    const picked = [];
    const forms = new Set();
    // Two sentences that share most of their words (Você tem um calendário? / Vocês têm um calendário?) teach little
    // more than one. Words are compared by their first four letters without accents, so forms of a word match.
    const words = (c) => (c.words ??= new Set(tokenize(c.s.text).map((t) => foldLatinDiacritics(key(t.form, lang)).slice(0, 4))));
    const similar = (a, b) => {
      const A = words(a);
      const B = words(b);
      let both = 0;
      for (const w of A) if (B.has(w)) both++;
      return both / (A.size + B.size - both) >= 0.5;
    };
    // Conversational sources (Tatoeba, doozan) come before treebank text even when that means a near-duplicate:
    // an everyday sentence still beats one from the news. Treebank sentences only fill places left over.
    const band = (c) => (c.score[0] < 1 ? 0 : 1);
    const topBand = list.length ? band(list[0]) : 0;
    const distinct = (c) => !picked.some((p) => similar(p, c));
    // Last-resort sentences (long, or with numbers) only stand in for a word that has nothing else.
    const spare = (c) => c.score[0] >= LAST_RESORT;
    const passes = [
      (c) => band(c) === topBand && !forms.has(key(c.target, lang)) && distinct(c),
      (c) => band(c) === topBand && distinct(c),
      (c) => band(c) === topBand,
      (c) => distinct(c),
      () => true,
    ];
    for (const ok of passes) {
      for (const c of list) {
        if (picked.length >= max) break;
        if (picked.includes(c) || !ok(c)) continue;
        if (spare(c) && picked.some((p) => !spare(p))) continue;
        picked.push(c);
        forms.add(key(c.target, lang));
      }
    }
    e.examples = picked.map((c) => ({ text: c.s.text, translation: c.s.translation, target: c.target, source: c.s.source, ref: c.s.ref }));
    if (picked.length) stats.withSentences++;
    if (picked.some((c) => c.s.translation)) stats.withTranslation++;
    for (const c of picked) {
      stats.bySource[c.s.source] = (stats.bySource[c.s.source] ?? 0) + 1;
      credits.push({ lemma: e.lemma, text: c.s.text, credit: c.s.credit });
    }
  });

  // Words that no collection has a sentence for get the sentences an AI (Claude) wrote for them.
  if (aiFile && existsSync(aiFile)) {
    const written = readAiSentences(aiFile);
    for (const e of entries) {
      if (e.examples?.length) continue;
      const mine = [];
      for (const r of written.get(e.lemma) ?? []) {
        const why = aiSentenceProblem(r, e, lang);
        if (why) stats.aiRejected.push(`${e.lemma}: ${why} (${r.text})`);
        else if (mine.length < max) mine.push(r);
      }
      if (!mine.length) continue;
      e.examples = mine.map((r) => ({ text: r.text, translation: r.translation, target: r.target, source: 'ai-claude', ref: null }));
      stats.withSentences++;
      stats.withTranslation++;
      stats.aiWords++;
      stats.bySource['ai-claude'] = (stats.bySource['ai-claude'] ?? 0) + mine.length;
      for (const r of mine) credits.push({ lemma: e.lemma, text: r.text, credit: 'Written by AI (Claude) in November 2026; not checked by a native speaker' });
    }
  }
  return { stats, credits };
}

/** data/ai-sentences/<lang>.tsv: lemma, pos, sentence, target (as written in the sentence), translation. */
export function readAiSentences(file) {
  const out = new Map();
  for (const line of readFileSync(file, 'utf8').split('\n').slice(1)) {
    const [lemma, pos, text, target, translation] = line.split('\t');
    if (!lemma || !text || !target) continue;
    if (!out.has(lemma)) out.set(lemma, []);
    out.get(lemma).push({ pos, text: text.trim(), target: target.trim(), translation: translation?.trim() || null });
  }
  return out;
}

/** Why an AI-written sentence cannot be used for this word, or null: the blank must be unambiguous and a real form. */
export function aiSentenceProblem(r, e, lang) {
  const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const around = (t, flags) => new RegExp(`(?<![\\p{L}\\p{M}])${esc(t)}(?![\\p{L}\\p{M}])`, flags);
  if ((r.text.match(around(r.target, 'gu')) ?? []).length !== 1) return 'the target is not in the sentence exactly once';
  if ((r.text.toLowerCase().match(around(r.target.toLowerCase(), 'gu')) ?? []).length !== 1) return 'the target appears more than once';
  const p = e.paradigm;
  if (lang === 'vi' || p?.indeclinable) return key(r.target, lang) === key(e.lemma, lang) ? null : 'the target is not the word';
  if (p && !formKeys(e, lang).has(key(r.target, lang))) return 'the target is not in the word\'s table';
  return null;
}

/** Report lines for the build report. */
export function sentenceReport(lang, stats, entries) {
  const L = ['## Cloze sentences', ''];
  L.push('Example sentences for fill-in-the-blank practice: Tatoeba first (everyday, conversational, with English translations), then hand-annotated treebank sentences, and AI-written sentences only for words that none of these covers. Each sentence is scored by its rarest word and its length, so short sentences of common words win. Up to three per word.');
  L.push('');
  L.push(`- Words with at least one sentence: ${stats.withSentences.toLocaleString('en')} of ${stats.entries.toLocaleString('en')}`);
  L.push(`- Words with a sentence that has an English translation: ${stats.withTranslation.toLocaleString('en')}`);
  for (const [s, n] of Object.entries(stats.bySource)) {
    const c = SENTENCE_SOURCES[s];
    L.push(`- Sentences from ${c?.name ?? s}${c ? ` (${c.license}${c.nonCommercial ? ', non-commercial use only' : ''})` : ''}: ${n.toLocaleString('en')}`);
  }
  if (stats.aiWords) {
    L.push('');
    L.push(`Sentences for ${stats.aiWords.toLocaleString('en')} words were written by an AI (Claude), because no collection has a sentence for them. The app labels them as AI-written; build with --no-ai-sentences to leave them out.`);
  }
  if (stats.aiRejected?.length) {
    L.push('');
    L.push(`AI-written sentences not used (${stats.aiRejected.length}): ${stats.aiRejected.join('; ')}.`);
  }
  const without = entries.filter((e) => !e.examples?.length);
  if (without.length) {
    L.push('');
    L.push(`Words without a sentence (${without.length.toLocaleString('en')}), most frequent first: ${without.slice(0, 300).map((e) => e.lemma).join(', ')}${without.length > 300 ? ', …' : ''}.`);
  }
  L.push('');
  return L;
}
