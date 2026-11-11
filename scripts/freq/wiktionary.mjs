// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Readers for English Wiktionary data, and the rules that turn Wiktionary senses into app senses.
//
// Two inputs are supported:
//   * Vuizur/Wiktionary-Dictionaries tab files ("<Language>-English Wiktionary dictionary.tsv"),
//     built from Kaikki.org/Wiktextract extractions of English Wiktionary.
//     Line format: headword|form|form…<TAB><i>pos</i><br><ol><li>gloss</li>…</ol><br><i>pos</i>…
//   * doozan/spanish_data "es-en.data", built from English Wiktionary by doozan's wordlist tools.
// Both carry English Wiktionary content (CC BY-SA 4.0 / GFDL).
import { CYRILLIC_LANGS, decodeEntities, key, lines, stripStress } from './common.mjs';

// ------------------------------------------------------------------ parts of speech

/** Wiktionary part-of-speech labels (both readers) → app part of speech; null = not a vocabulary word. */
const POS_MAP = {
  noun: 'noun', n: 'noun',
  verb: 'verb', v: 'verb',
  adj: 'adjective', adjective: 'adjective',
  adv: 'adverb', adverb: 'adverb',
  pron: 'pronoun', pronoun: 'pronoun',
  prep: 'preposition', preposition: 'preposition', postp: 'preposition', ambiposition: 'preposition', prep_phrase: 'phrase',
  conj: 'conjunction', conjunction: 'conjunction',
  num: 'numeral', numeral: 'numeral',
  particle: 'particle',
  intj: 'interjection', interj: 'interjection', interjection: 'interjection',
  det: 'determiner', determiner: 'determiner', article: 'determiner', art: 'determiner',
  classifier: 'classifier',
  contraction: 'contraction',
  phrase: 'phrase', proverb: 'phrase',
  // Not studied as vocabulary words: proper nouns, letters and characters, affixes, symbols.
  name: null, prop: null, character: null, letter: null, prefix: null, suffix: null, affix: null, infix: null,
  interfix: null, circumfix: null, symbol: null, punct: null, romanization: null, syllable: null, diacrit: null,
  part: null, // doozan: participle endings such as -ado

  abbrev: 'abbrev', // resolved per sense: "Contraction of …" is a word, "Abbreviation of …" is not
};

/** Wiktionary label shown to the learner for the part of speech. */
const POS_LABEL = {
  noun: 'noun', n: 'noun', verb: 'verb', v: 'verb', adj: 'adjective', adv: 'adverb', pron: 'pronoun',
  prep: 'preposition', postp: 'postposition', ambiposition: 'ambiposition', prep_phrase: 'prepositional phrase',
  conj: 'conjunction', num: 'numeral', particle: 'particle', intj: 'interjection', interj: 'interjection',
  det: 'determiner', determiner: 'determiner', article: 'article', art: 'article', classifier: 'classifier',
  contraction: 'contraction', phrase: 'phrase', proverb: 'proverb', abbrev: 'contraction',
};

export function appPos(wiktPos) {
  return POS_MAP[wiktPos] ?? null;
}

export function posLabel(wiktPos) {
  return POS_LABEL[wiktPos] ?? wiktPos;
}

// ------------------------------------------------------------------ senses

/** Form-of glosses whose entry is only a pointer to another lemma (used to re-route counts). */
const POINTER_RE = new RegExp(
  '^(?:' +
    [
      'inflection of',
      '(?:the )?(?:(?:first|second|third)[- ]person|impersonal|infinitive|gerund|supine|imperative|subjunctive|conditional)\\b[^.;]*\\bof',
      '(?:(?:short|masculine|feminine|neuter|common|animate|inanimate|personal|virile|nonvirile)\\s+(?:and\\s+\\w+\\s+)?)*(?:singular|plural|dual)\\b[^.;]*\\bof',
      '(?:nominative|genitive|dative|accusative|instrumental|locative|prepositional|vocative|partitive)\\b[^.;]*\\bof',
      '(?:masculine|feminine|neuter) (?:form )?of',
      '(?:alternative|alternate|obsolete|archaic|dated|nonstandard|non-standard|informal|rare|uncommon|superseded|deprecated|pre-reform|pre-\\d{4}|standard|eye[- ]dialect|pronunciation|apocopic|elided|syncopic|aphetic|prothetic)(?:[ -][\\w-]+){0,3} (?:form|spelling|letter-case form) of',
      'misspelling of',
      'gerund of',
      'abbreviation of',
      'initialism of',
      'acronym of',
      'clipping of',
      'ellipsis of',
      'short form of',
      'apocopic form of',
    ].join('|') +
    ')\\s+["“]?([^\\s",;:()“”]+)',
  'iu',
);

/** "The ninth letter of the Ukrainian alphabet …": letters are not studied as words. */
const LETTER_RE = /^(?:(?:the )?(?:\w+[- ])?(?:\w+ )?letter of the [\w -]+ alphabet\b|(?:the )?name of the (?:(?:Latin|Cyrillic|Greek)[- ]script )?letter\b|the (?:Greek )?letter\b|\S+ \(name of the letter\b|the (?:[\w-]+ )+(?:vowel|consonant)\.?$)/i;

/**
 * A gloss that is only a Latin letter: a letter name ("X, x" for Russian экс), a musical note ("C" for до)
 * or a chess piece ("Q" for Spanish D). None of these is a meaning to learn. The bare pronoun "I" is a meaning.
 */
function isLetterSymbol(text) {
  const m = /^(\p{Lu})(?:\s*,\s*(\p{Ll}))?\.?$/u.exec(text);
  if (!m) return false;
  return m[2] ? m[2] === m[1].toLowerCase() : m[1] !== 'I';
}

/** Wiktionary's sum-of-parts note ("Used other than figuratively or idiomatically: see một, cách") is not a definition. */
const NON_DEFINITION_RE = /^used other than figuratively or idiomatically\b/i;

/** Glosses must be English: a gloss written mostly in another script ("ма́сової інформа́ції") is not one. */
function isEnglishGloss(text) {
  if (/^[\s"“(]*[\u0400-\u04FF\u0370-\u03FF\u4E00-\u9FFF]/.test(text)) return false; // starts in another script
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  const other = (text.match(/[\u0400-\u04FF\u0370-\u03FF\u4E00-\u9FFF]/g) ?? []).length;
  return latin > 0 && latin >= other;
}

/** A gloss that is only a grammar label ("(with a, para, or an indirect objective pronoun)", "[+prepositional]"). */
const LABEL_ONLY_RE = /^(?:\([^()]*\)|\[[^\[\]]*\])\.?$/;

/** Entry-level contraction glosses ("Contraction of de + o"): these are words learners study. */
const CONTRACTION_RE = /^contraction of\b/i;
const ABBREVIATION_RE = /^(?:abbreviation|initialism|acronym) of\b/i;

/** Labels that mark a sense as not current: dropped unless nothing else is left. */
const DROP_LABELS = /\b(?:obsolete|archaic|historical|no longer used|pre-reform|Old )\b/i;
/** Labels that move a sense to the end: still Wiktionary senses, but not the first thing to learn. */
const LATER_LABELS = /\b(?:rare|dated|dialectal|dialect|regional|nonstandard|non-standard|proscribed|poetic|literary|archaic|obsolete|uncommon|nonce|humorous|Internet slang|euphemistic|jargon)\b/i;

/** Regions per language: target regions for this app, and other regions Wiktionary labels with. */
const REGIONS = {
  es: {
    target: /\b(?:Colombia|Colombian|Latin America|Latin-American|Americas|South America|Spanish America|Hispanic America|Andes|Andean|Caribbean|Bogotá|Antioquia|Paisa|Medellín|Cali|Barranquilla|Cartagena)\b/i,
    other: /\b(?:Spain|Spanish of Spain|Peninsular|Castile|Andalusia|Canary Islands|Aragon|Asturias|Murcia|Extremadura|Navarre|Galicia|Catalonia|Valencia|Balearic|Mexico|Mexican|Argentina|Rioplatense|River Plate|Uruguay|Paraguay|Chile|Peru|Bolivia|Ecuador|Venezuela|Cuba|Puerto Rico|Dominican Republic|Central America|Guatemala|Honduras|El Salvador|Nicaragua|Costa Rica|Panama|Philippines|Equatorial Guinea|US|United States|New Mexico|Texas|California|Louisiana)\b/,
  },
  pt: {
    target: /\b(?:Brazil|Brazilian|São Paulo|Rio de Janeiro|Rio Grande do Sul|Minas Gerais|Bahia|Pernambuco|Ceará|Northeast Brazil|Southern Brazil|Northern Brazil|Paraná|Santa Catarina|Goiás|Amazonas|Pará)\b/i,
    other: /\b(?:Portugal|European Portuguese|Lisbon|Porto|Madeira|Azores|Angola|Mozambique|Cape Verde|Guinea-Bissau|São Tomé|Timor|Macau|Goa|Galicia)\b/,
  },
  vi: {
    target: /\b(?:Southern Vietnam|South Vietnam|Southern|Saigon|Ho Chi Minh City|Mekong)\b/i,
    other: /\b(?:Northern Vietnam|North Vietnam|Northern|Hanoi|Central Vietnam|Central|Huế|Nghệ An)\b/,
  },
  ru: { target: /\bMoscow\b/, other: /\b(?:Ukraine|Belarus|Siberia|Southern Russia|Northern Russia|Saint Petersburg|Kuban|Don|Ural|Caucasus|Central Asia|Odessa|Pskov|Novgorod)\b/ },
  uk: { target: /\bKyiv\b/, other: /\b(?:Western Ukraine|Galicia|Bukovina|Transcarpathia|Volhynia|Polesia|Lemko|Hutsul|Boyko|Podolia|Slobozhanshchyna|Southern Ukraine|Eastern Ukraine)\b/ },
  pl: { target: /\bWarsaw\b/, other: /\b(?:Upper Silesia|Silesia|Silesian|Kraków|Cracow|Lesser Poland|Greater Poland|Poznań|Podhale|Kashubia|Masovia|Podlachia|Borderlands|Kresy|Lwów)\b/ },
};

/** Split leading "(label, label) " groups from a gloss. Nested parentheses are kept intact. */
export function splitLabels(text) {
  const labels = [];
  let rest = text.trim();
  while (rest.startsWith('(') || rest.startsWith('[')) {
    const open = rest[0];
    const close = open === '(' ? ')' : ']';
    let depth = 0;
    let end = -1;
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === open) depth++;
      else if (rest[i] === close) {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end < 0) break;
    const inner = rest.slice(1, end).trim();
    const after = rest.slice(end + 1).trim();
    if (!after) break; // the whole gloss is parenthesised: keep it as text
    labels.push(...inner.split(/\s*,\s*/).filter(Boolean));
    rest = after;
  }
  return { labels, text: rest };
}

function cleanGloss(raw) {
  let s = decodeEntities(String(raw).replace(/<[^>]+>/g, ''));
  s = s.replace(/\{\{[^}]*\}\}/g, ' ').replace(/\{\{.*$/, ' ').replace(/\}\}/g, ' ');
  s = s.replace(/\(#\s*/g, '('); // a stray list marker in doozan's text: "dog (# Any member of …)"
  // Leftover wiki links: "[[[Appendix:Glossary#transitive_verb|transitive]]]" → "[transitive]", "[[house]]" → "house".
  s = s.replace(/\[\[\[(?:[^[\]|]*\|)?([^[\]|]*)\]\]\]/g, '[$1]').replace(/\[\[(?:[^[\]|]*\|)?([^[\]|]*)\]\]/g, '$1');
  s = s.replace(/\s+([,;.:])/g, '$1').replace(/\s+/g, ' ').trim();
  return s;
}

/** "third-person singular present indicative": the rest of an inflection pointer, not a meaning. */
const GRAMMAR_DESCRIPTION_RE = /^(?:(?:first|second|third)[- ]person|singular|plural|dual|masculine|feminine|neuter|animate|inanimate|nominative|genitive|dative|accusative|instrumental|locative|prepositional|vocative|partitive|present|past|future|imperfect|preterite|perfect|pluperfect|conditional|subjunctive|imperative|infinitive|gerund|participle|indicative|comparative|superlative|short|long|definite|indefinite)\b/i;

/** Pointers to a spelling variant are always re-routed (проект → проєкт, idéia → ideia). */
const SPELLING_POINTER_RE = /^(?:alternative|alternate|obsolete|archaic|dated|nonstandard|non-standard|superseded|deprecated|pre-reform|pre-\d{4}|standard|eye[- ]dialect|pronunciation|misspelling)\b/i;

export function parseSense(raw) {
  const text = cleanGloss(raw);
  const { labels, text: rest } = splitLabels(text);
  const contraction = CONTRACTION_RE.test(rest);
  const m = contraction ? null : POINTER_RE.exec(rest);
  let pointer = m ? m[1].replace(/[.,;:]+$/, '') : null;
  let meaning = null;
  let glue = false;
  if (m && !SPELLING_POINTER_RE.test(rest)) {
    // A trailing meaning makes a form-of gloss a real sense: "apocopic form of "mío", my",
    // "acronym of вы́сшее уче́бное заведе́ние (…): university, college". The meaning follows the last
    // colon, or a comma straight after the (quoted) target word.
    const tail = rest.slice(m.index + m[0].length);
    let after = null;
    const colon = tail.lastIndexOf(':');
    if (colon >= 0) after = tail.slice(colon + 1);
    else {
      const comma = /^["”]?\s*,\s*(.+)$/.exec(tail);
      if (comma) after = comma[1];
    }
    // The 2022–23 extraction glues an apocope's meaning straight onto its target:
    // "Apocopic form of suyo His, her, its, one's, their, your (formal)".
    if (after === null && /^apocopic form of\b/i.test(rest)) {
      const glued = /^["”]?\s+(\p{Lu}[\p{Ll}’'].*)$/u.exec(tail);
      if (glued) {
        after = glued[1];
        glue = true;
      }
    }
    after = after?.trim().replace(/^[“"]|[”"]$/g, '') ?? '';
    if (after && /\p{L}/u.test(after) && !/^(?:and|or|\+|&)\b/i.test(after) && !GRAMMAR_DESCRIPTION_RE.test(after)) meaning = after;
  }
  // A contraction's meaning: "Contraction of em o (“in the (masculine singular)”)." → "in the (masculine
  // singular)"; "Contraction of de o (“…”); of the; from the" → "of the; from the". With one quoted gloss per
  // part ("Contraction of de (“of”) and ele (“him”)") there is no single meaning, and the text stays.
  if (contraction) {
    const quoted = [...rest.matchAll(/\((?:“([^”]*)”|"([^"]*)")\)/g)];
    if (quoted.length <= 1) {
      let head;
      let after;
      if (quoted.length) {
        head = rest.slice(0, quoted[0].index);
        after = rest.slice(quoted[0].index + quoted[0][0].length);
      } else {
        const sep = rest.search(/[;:]/);
        head = sep >= 0 ? rest.slice(0, sep) : rest;
        after = sep >= 0 ? rest.slice(sep + 1) : '';
      }
      after = after.replace(/^[\s.;:,]+/, '').replace(/\.$/, '').trim();
      // "Contraction of em uma (“in a”). (feminine of num)": a trailing parenthesis is a label, not the meaning.
      const extra = LABEL_ONLY_RE.test(after) ? after.slice(1, after.endsWith('.') ? -2 : -1).trim() : null;
      if (extra !== null) after = '';
      const own = /\p{L}/u.test(after) ? after : quoted.length ? (quoted[0][1] ?? quoted[0][2]).trim() : '';
      if (own) {
        const more = [head.replace(/[\s.;:,]+$/, '').trim(), ...(extra ? [extra] : [])];
        return { text: own, labels: [...labels, ...more], pointer: null, contraction, abbreviation: false };
      }
    }
  }
  return {
    text: meaning ? (glue ? meaning.replace(/^\p{Lu}(?=\p{Ll})/u, (c) => c.toLowerCase()) : meaning) : rest,
    labels: meaning ? [...labels, rest.slice(0, rest.lastIndexOf(meaning)).replace(/["“”]/g, '').replace(/[,:;\s]+$/, '')] : labels,
    pointer: meaning ? null : pointer,
    contraction,
    abbreviation: ABBREVIATION_RE.test(rest),
  };
}

// ------------------------------------------------------------------ Vuizur tab files

/** Inflected forms in the tab files are unlabeled and mixed with romanisations and table text. */
function cleanForm(form, head, lang) {
  const f = form.trim().normalize('NFC');
  if (!f || f === head) return null;
  if ((lang === 'vi' ? /[()[\]{}:;,/0-9^*!?.=+]/ : /[\s()[\]{}:;,/0-9^*!?.=+]/).test(f)) return null;
  if (CYRILLIC_LANGS.has(lang)) {
    if (/[A-Za-zÀ-ɏ]/.test(f)) return null; // romanisation
    if (lang === 'ru' && (/[ѣѳѵіІѢѲѴ]/.test(f) || /ъ$/.test(f))) return null; // pre-1918 spelling
  } else if (/[Ѐ-ӿ]/.test(f)) return null;
  return f;
}

/** Load a Vuizur tab file: Map<key, Headword[]>; Headword = {word, forms, blocks:[{pos, senses}]}. */
export async function loadTsvDictionary(file, lang) {
  const dict = new Map();
  for await (const line of lines(file)) {
    const tab = line.indexOf('\t');
    if (tab < 0) continue;
    const heads = line.slice(0, tab).split('|');
    const word = heads[0].trim().normalize('NFC');
    if (!word) continue;
    const forms = [];
    const seen = new Set();
    for (const h of heads.slice(1)) {
      const f = cleanForm(h, word, lang);
      if (f && !seen.has(f)) {
        seen.add(f);
        forms.push(f);
      }
    }
    const blocks = [];
    const html = line.slice(tab + 1);
    const re = /<i>([^<]*)<\/i><br><ol>(.*?)<\/ol>/g;
    let m;
    while ((m = re.exec(html))) {
      const pos = m[1].trim();
      const senses = [];
      const li = /<li>(.*?)<\/li>/g;
      let s;
      while ((s = li.exec(m[2]))) {
        const sense = parseSense(s[1]);
        if (sense.text) senses.push(sense);
      }
      if (senses.length) blocks.push({ pos, senses, gender: null, usage: null });
    }
    if (!blocks.length) continue;
    const k = key(word, lang);
    const entry = { word, forms, blocks };
    const list = dict.get(k);
    if (list) list.push(entry);
    else dict.set(k, [entry]);
  }
  return dict;
}

// ------------------------------------------------------------------ doozan es-en.data

/** Load doozan's es-en.data: the same Headword shape, with gender, usage notes and qualifiers. */
export async function loadDoozanDictionary(file) {
  const dict = new Map();
  let cur = null;
  let block = null;
  let sense = null;
  const flush = () => {
    if (cur && cur.blocks.length) {
      const k = key(cur.word, 'es');
      const list = dict.get(k);
      if (list) list.push(cur);
      else dict.set(k, [cur]);
    }
    cur = null;
    block = null;
    sense = null;
  };
  for await (const line of lines(file)) {
    if (line === '_____') {
      flush();
      continue;
    }
    if (!cur) {
      cur = { word: line.trim().normalize('NFC'), forms: [], blocks: [] };
      continue;
    }
    const m = /^(\s*)([_a-z]+):\s?(.*)$/.exec(line);
    if (!m) continue;
    const [, indent, field, value] = m;
    if (field === 'pos' && indent.length === 0) {
      block = { pos: value.trim(), senses: [], gender: null, usage: null };
      cur.blocks.push(block);
      sense = null;
    } else if (!block) continue;
    else if (field === 'g' && indent.length === 2) block.gender = value.trim();
    else if (field === 'usage' && indent.length === 2) block.usage = value.replace(/\\n/g, '\n').trim();
    else if (field === 'gloss' && indent.length === 2) {
      sense = parseSense(value);
      block.senses.push(sense);
    } else if (field === 'q' && indent.length === 4 && sense) {
      sense.labels.push(...value.split(/\s*,\s*/).filter(Boolean));
    } else if (field === '_gloss' && indent.length === 4 && sense) {
      (sense.sub ??= []).push(cleanGloss(value));
    }
  }
  flush();
  // Drop blocks whose glosses are all empty after cleaning.
  for (const list of dict.values()) for (const h of list) h.blocks = h.blocks.filter((b) => b.senses.some((s) => s.text));
  return dict;
}

// ------------------------------------------------------------------ Kaikki.org (Wiktextract) JSONL

/** Wiktextract sense tags worth showing as labels (regions, register, currency of use). */
const KAIKKI_LABEL_TAGS = new Set([
  'colloquial', 'informal', 'formal', 'slang', 'vulgar', 'derogatory', 'offensive', 'humorous', 'literary', 'poetic',
  'archaic', 'obsolete', 'dated', 'rare', 'dialectal', 'regional', 'nonstandard', 'proscribed', 'euphemistic', 'figuratively',
  'Brazil', 'Portugal', 'Spain', 'Latin-America', 'Colombia', 'Mexico', 'Argentina', 'Northern-Vietnam', 'Southern-Vietnam',
  'Central-Vietnam', 'Hanoi', 'Saigon',
]);

const IPA_PREFERENCE = {
  es: [/Latin-America|Colombia|Americas/i],
  pt: [/Brazil/i, /São-Paulo|Rio-de-Janeiro/i],
  vi: [/Saigon|Southern|Ho-Chi-Minh/i],
  ru: [], uk: [], pl: [],
};

function pickIpa(sounds, lang) {
  const withIpa = (sounds ?? []).filter((s) => s.ipa);
  if (!withIpa.length) return null;
  for (const re of IPA_PREFERENCE[lang] ?? []) {
    const hit = withIpa.find((s) => (s.tags ?? []).some((t) => re.test(t)) || (s.raw_tags ?? []).some((t) => re.test(t)));
    if (hit) return hit.ipa;
  }
  return withIpa[0].ipa;
}

/**
 * Load a Kaikki.org per-language JSONL file (English Wiktionary via Wiktextract) into the same
 * Headword shape as the other readers. Sub-senses keep their parent gloss ("house (structure …)").
 */
export async function loadKaikkiDictionary(file, lang) {
  const dict = new Map();
  const byWord = new Map();
  for await (const line of lines(file)) {
    if (!line || line[0] !== '{') continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (e.lang_code && e.lang_code !== lang) continue;
    const word = String(e.word ?? '').normalize('NFC').trim();
    if (!word || !e.pos) continue;
    const senses = [];
    const examples = [];
    for (const s of e.senses ?? []) {
      const glosses = (s.raw_glosses?.length ? s.raw_glosses : s.glosses) ?? [];
      if (!glosses.length) continue;
      const last = String(glosses[glosses.length - 1]).trim();
      let text = last;
      if (glosses.length > 1) {
        const parent = String(glosses[0]).trim();
        text = parent.endsWith(':') ? `${parent} ${last}` : `${parent} (${last})`;
      }
      const sense = parseSense(text);
      const target = s.form_of?.[0]?.word ?? s.alt_of?.[0]?.word ?? null;
      if (target && !sense.contraction) sense.pointer = target;
      for (const t of s.tags ?? []) {
        if (!KAIKKI_LABEL_TAGS.has(t)) continue;
        const label = t.replace(/-/g, ' ');
        if (!sense.labels.some((l) => l.toLowerCase() === label.toLowerCase())) sense.labels.push(label);
      }
      if (sense.text) senses.push(sense);
      for (const x of s.examples ?? []) {
        const tr = x.translation ?? x.english ?? null;
        if (x.text && tr && x.type !== 'quotation' && x.text.length <= 160) examples.push({ text: x.text, translation: tr, target: null });
      }
    }
    if (!senses.length) continue;
    const forms = [];
    let display = null;
    let gender = null;
    let aspect = null;
    for (const f of e.forms ?? []) {
      const tags = f.tags ?? [];
      if (!f.form || tags.includes('romanization') || tags.includes('table-tags') || tags.includes('inflection-template') || tags.includes('class')) continue;
      if (tags.includes('canonical')) {
        display = String(f.form).normalize('NFC');
        if (tags.includes('masculine')) gender = 'm';
        else if (tags.includes('feminine')) gender = 'f';
        else if (tags.includes('neuter')) gender = 'n';
        if (tags.includes('imperfective')) aspect = 'imperfective';
        else if (tags.includes('perfective')) aspect = 'perfective';
        continue;
      }
      const form = String(f.form).normalize('NFC');
      if (!/\s/.test(form) || lang === 'vi') forms.push(form);
    }
    const block = { pos: e.pos, senses, gender, aspect, usage: null, ipa: pickIpa(e.sounds, lang), examples: examples.slice(0, 3) };
    let h = byWord.get(word);
    if (!h) {
      h = { word, display: display && stripStress(display) === word ? display : null, forms: [], blocks: [] };
      byWord.set(word, h);
      const k = key(word, lang);
      const list = dict.get(k);
      if (list) list.push(h);
      else dict.set(k, [h]);
    }
    if (!h.display && display && stripStress(display) === word) h.display = display;
    h.blocks.push(block);
    for (const f of forms) if (!h.forms.includes(f)) h.forms.push(f);
  }
  return dict;
}

// ------------------------------------------------------------------ lookups

/** Headwords for a lemma key; prefers an exact-case lowercase headword over capitalised ones. */
export function lookup(dict, lemma, lang) {
  const list = dict.get(key(lemma, lang));
  if (!list) return [];
  const lower = stripStress(lemma).normalize('NFC');
  return [...list].sort((a, b) => Number(stripStress(b.word) === lower) - Number(stripStress(a.word) === lower));
}

/** Blocks usable for vocabulary (proper nouns, letters, affixes and abbreviation-only blocks removed). */
export function usableBlocks(headwords, { lowercaseOnly = false } = {}) {
  const lower = headwords.filter((h) => h.word === h.word.toLowerCase());
  const fromLower = blocksOf(lower);
  // An all-capitals headword (OK, TV) is used only when no lowercase one is usable; other capitalised
  // headwords are names (Віктор), which are not studied as vocabulary.
  if (fromLower.length || lowercaseOnly) return fromLower;
  return blocksOf(headwords.filter((h) => h.word !== h.word.toLowerCase() && h.word === h.word.toUpperCase() && h.word.length >= 2 && h.word.length <= 5 && !/[\u0400-\u04FF]/.test(h.word)));
}

/**
 * A single letter is studied only for what it means as a word (Spanish y "and", Vietnamese \u1EDF "at"). Its senses
 * as an abbreviation or symbol (Spanish t for tiempo, Portuguese h "used to indicate time \u2026") are dropped.
 */
const SYMBOL_GLOSS_RE = /^used to indicate\b/i;

function blocksOf(headwords) {
  const out = [];
  for (const h of headwords) {
    const capitalised = h.word !== h.word.toLowerCase();
    const singleLetter = [...stripStress(h.word).normalize('NFC')].length === 1;
    for (const b of h.blocks) {
      let pos = appPos(b.pos);
      if (pos === null || pos === undefined) continue;
      let senses = b.senses;
      if (pos === 'abbrev') {
        if (senses.some((s) => s.contraction)) pos = 'contraction';
        else continue;
        senses = senses.filter((s) => s.contraction);
      }
      const real = senses.filter(
        (s) =>
          !s.pointer &&
          !LETTER_RE.test(s.text) &&
          !isLetterSymbol(s.text) &&
          !NON_DEFINITION_RE.test(s.text) &&
          !(s.contraction && /^contraction of -/i.test(s.text)) &&
          !(singleLetter && (s.abbreviation || SYMBOL_GLOSS_RE.test(s.text))) &&
          !LABEL_ONLY_RE.test(s.text) &&
          !(capitalised && s.properNoun) &&
          isEnglishGloss(s.text),
      );
      if (!real.length) continue;
      out.push({ headword: h, wiktPos: b.pos, pos, block: b, senses: real });
    }
  }
  return out;
}

/** True when every sense of every block points to another lemma ("plural of …", "inflection of …"). */
export function pointerTargets(headwords) {
  const targets = new Set();
  let real = 0;
  for (const h of headwords)
    for (const b of h.blocks)
      for (const s of b.senses) {
        if (s.pointer) targets.add(s.pointer);
        else if (!s.abbreviation || s.contraction) real++;
      }
  return real === 0 ? [...targets] : [];
}

// ------------------------------------------------------------------ choosing and shaping senses

function regionClass(labels, lang) {
  const r = REGIONS[lang];
  const joined = labels.join(', ');
  if (!r || !joined) return 'none';
  if (r.target.test(joined)) return 'target';
  if (r.other.test(joined)) return 'other';
  return 'none';
}

/**
 * Grammar annotations in square brackets ("to wait [+ na (accusative)]", "[(optionally) +de]"), first-use dates
 * ("[from 16th c.]") and transitivity labels belong in the definition, not on the flashcard.
 */
function stripGrammarBrackets(text) {
  let removed = false;
  let s = text.replace(/\s*\[([^[\]]*)\]/g, (all, inner) => {
    const grammar = /\+/.test(inner) || /^from\b.*\d/i.test(inner) || /^(?:in)?transitive$/i.test(inner.trim());
    if (grammar) removed = true;
    return grammar ? '' : all;
  });
  if (!removed) return text;
  // "to link (objects into one mass) [+accusative] or [+ z (instrumental)]" leaves a dangling "or".
  // "… [+infinitive] or [+genitive] or [+ na …]" leaves two in a row, so repeat until none is left.
  for (let prev = ''; prev !== s; ) {
    prev = s;
    s = s.replace(/\s+(?:or|and)(?=\s*(?:[,;.)]|$))/g, '');
  }
  s = s.replace(/\s+([,;.)])/g, '$1');
  return s.trim();
}

/**
 * Shorten glosses for the flashcard; the full Wiktionary text goes to `definition` whenever the gloss differs.
 * 1. A short text (up to 40 characters) before a long explanation in parentheses is the translation:
 *    "dog (Any member of the subspecies …)" → "dog". Short parentheses inside a phrase ("to put (something) on
 *    (oneself), …") are not cut points.
 * 2. Otherwise the text is cut at the last top-level separator, then at the first parenthesis, then at a word
 *    boundary with "…". A cut that would leave only a heading ("used to express necessity:") uses rule 1's text.
 * A trailing colon (a heading whose sub-senses the extraction lost), comma or semicolon is dropped.
 */
export function shapeGloss(text, max = 90) {
  const tidy = (s) => s.trim().replace(/\s*[,;:]$/, '');
  const result = (gloss) => ({ gloss, definition: gloss === text ? null : text });
  const base = stripGrammarBrackets(text) || text;
  if (base.length <= max) return result(tidy(base));
  let depth = 0;
  let cut = -1;
  let explained = -1;
  for (let i = 0; i < base.length && i <= max; i++) {
    const c = base[i];
    if (c === '(') {
      if (depth === 0 && explained < 0 && i > 0 && base[i - 1] === ' ') {
        let d = 0;
        let close = -1;
        for (let j = i; j < base.length; j++) {
          if (base[j] === '(') d++;
          else if (base[j] === ')' && --d === 0) {
            close = j;
            break;
          }
        }
        const long = close < 0 || close > max || close - i - 1 >= 20;
        if (long && /\p{L}/u.test(base.slice(0, i))) explained = i - 1;
      }
      depth++;
    } else if (c === ')') depth = Math.max(0, depth - 1);
    else if (depth === 0 && (c === ';' || c === ',')) cut = i;
  }
  const head = explained > 0 ? tidy(base.slice(0, explained)) : '';
  if (head && head.length <= 40) return result(head);
  if (cut < 12) {
    const paren = base.indexOf(' (');
    if (paren >= 12 && paren <= max) cut = paren;
  }
  if (cut >= 12) {
    const piece = base.slice(0, cut).trim();
    return result(head && /:$/.test(piece) ? head : tidy(piece));
  }
  if (head) return result(head);
  const words = base.slice(0, max).split(' ');
  words.pop();
  return { gloss: words.join(' ').replace(/[,;:]$/, '') + '…', definition: text };
}

/**
 * Turn the Wiktionary blocks of one word into app senses.
 * The block matching `preferredPos` (app POS) comes first; other parts of speech follow with a note.
 */
export function chooseSenses(usable, lang, { preferredFamily = null, maxMain = 6, maxOther = 2, maxOtherBlocks = 3 } = {}) {
  if (!usable.length) return null;
  // The main part of speech: the first Wiktionary block (in Wiktionary's order) of the family the
  // corpus evidence points to, so Russian да (tagged PART) opens with "yes", not "let".
  // Families list parts of speech in order of preference (DET: determiner before pronoun before adjective,
  // so Portuguese este is "this", not "eastern"); for particles Wiktionary's own order decides.
  let main = null;
  if (preferredFamily?.length) {
    if (preferredFamily[0] === 'particle') main = usable.find((u) => preferredFamily.includes(u.pos)) ?? null;
    else for (const p of preferredFamily) if ((main = usable.find((u) => u.pos === p) ?? null)) break;
  }
  main ??= usable[0];
  const ordered = [main, ...usable.filter((u) => u !== main)];
  const senses = [];
  const seenText = new Set();
  const take = (u, limit, isMain) => {
    const scored = u.senses
      .map((s, i) => {
        const joined = s.labels.join(', ');
        const region = regionClass(s.labels, lang);
        let tier = 0;
        if (DROP_LABELS.test(joined)) tier = 3;
        else if (region === 'other' || LATER_LABELS.test(joined)) tier = 2;
        else if (region === 'target') tier = 0;
        return { s, i, tier, region };
      })
      .sort((a, b) => a.tier - b.tier || a.i - b.i);
    const usableSenses = scored.filter((x) => x.tier < 3);
    const pool = usableSenses.length ? usableSenses : scored.slice(0, 1);
    let n = 0;
    for (const { s, region } of pool) {
      if (n >= limit) break;
      const k = s.text.toLowerCase();
      if (seenText.has(k)) continue;
      seenText.add(k);
      // A heading gloss ("Senses relating to literal movement:") is shown through its first sub-sense.
      const headed = /:$/.test(s.text) && s.sub?.length;
      const shaped = shapeGloss(headed ? s.sub[0] : s.text);
      const gloss = shaped.gloss;
      const definition = headed ? `${s.text} ${s.sub.join('; ')}` : shaped.definition;
      const notes = [];
      if (!isMain && u.pos !== main.pos) notes.push(`As ${/^[aeiou]/i.test(posLabel(u.wiktPos)) ? 'an' : 'a'} ${posLabel(u.wiktPos)}`);
      if (s.labels.length) notes.push(s.labels.join(', '));
      if (s.sub?.length && !headed) notes.push(s.sub.slice(0, 3).join('; '));
      senses.push({ gloss, translations: [], definition, note: notes.length ? notes.join(' · ') : null });
      n++;
    }
  };
  take(main, maxMain, true);
  for (const u of ordered.slice(1, 1 + maxOtherBlocks)) take(u, maxOther, false);
  return { main, senses };
}
