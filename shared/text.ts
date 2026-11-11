// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
/** Text normalisation helpers shared by the server and the web client. */
import type { LanguageCode } from './languages.ts';

export type AnyLanguage = LanguageCode | 'en';

const APOSTROPHES = /[’ʼ‘`´ʹ՚＇]/g;
/** A combining acute/grave stress mark directly after a Cyrillic letter (learner notation in ru/uk). */
const CYRILLIC_STRESS = /([Ѐ-ӿ])[́̀]+/g;
/** NFC composes е/и + grave into ѐ/ѝ; in Russian/Ukrainian learner text those are stress marks. */
const COMPOSED_GRAVE: Record<string, string> = { ѐ: 'е', ѝ: 'и', Ѐ: 'Е', Ѝ: 'И' };

export function nfc(s: string): string {
  return s.normalize('NFC');
}

/**
 * Remove learner stress marks used in Russian/Ukrainian display forms (вода́ → вода).
 * Only marks that follow a Cyrillic letter are removed: Latin accents (á, ó, ś) and
 * Vietnamese tones (à, ả, ạ) are part of the spelling and are never touched.
 */
export function stripStress(s: string): string {
  return s
    .normalize('NFC')
    .replace(/[ѐѝЀЍ]/g, (c) => COMPOSED_GRAVE[c])
    .replace(CYRILLIC_STRESS, '$1');
}

export function normalizeApostrophes(s: string): string {
  return s.replace(APOSTROPHES, "'");
}

export function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

const LOWER_LOCALE: Record<AnyLanguage, string> = { en: 'en', es: 'es', pt: 'pt', vi: 'vi', ru: 'ru', uk: 'uk', pl: 'pl' };

export function lower(s: string, lang: AnyLanguage): string {
  return s.toLocaleLowerCase(LOWER_LOCALE[lang] ?? 'en');
}

/** Strip punctuation but keep word-internal apostrophes and hyphens. */
export function stripPunctuation(s: string): string {
  return s
    .replace(/[^\p{L}\p{N}\p{M}\s'\-]/gu, ' ')
    .replace(/(^|\s)['\-]+/g, '$1')
    .replace(/['\-]+(?=\s|$)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Fold Latin diacritics/tones (á→a, ơ→o, đ→d, ł→l). Never used for Cyrillic letters. */
export function foldLatinDiacritics(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/ł/g, 'l')
    .replace(/Ł/g, 'L')
    .normalize('NFC');
}

export function hasLatinDiacritics(s: string): boolean {
  return foldLatinDiacritics(s) !== s;
}

/** Canonical comparison form: NFC, no stress marks, lowercase, unified apostrophes, single spaces, no punctuation. */
export function canonical(s: string, lang: AnyLanguage): string {
  let out = stripStress(s);
  out = normalizeApostrophes(out);
  out = lower(out, lang);
  out = stripPunctuation(out);
  return collapseWhitespace(out);
}

/** Database matching key (also folds Russian ё→е, since ordinary Russian text often omits ё). */
export function matchKey(s: string, lang: AnyLanguage): string {
  let k = canonical(s, lang);
  if (lang === 'ru') k = k.replace(/ё/g, 'е');
  return k;
}

const VI_TONES = /[\u0300\u0301\u0303\u0309\u0323]/g;

/**
 * Vietnamese spelling key: the same for the two accepted spellings of a word — tone mark on either vowel
 * (hoá/hóa, khoẻ/khỏe) and final i or y after a consonant (công ti/công ty, kĩ/kỹ, quí/quý).
 */
export function vietnameseSpellingKey(s: string): string {
  return canonical(s, 'vi')
    .split(' ')
    .map((syllable) => {
      const d = syllable.normalize('NFD');
      const tone = (d.match(VI_TONES) ?? []).join('');
      const base = d.replace(VI_TONES, '').normalize('NFC').replace(/^([bcdđghklmnpqrstvx]+|qu)y$/, '$1i');
      return base + tone;
    })
    .join(' ');
}

/** English answer variants: "to look (at)" -> ["to look (at)", "to look", "to look at"], "glass/cup" -> both. */
export function expandEnglishVariants(answer: string): string[] {
  const out = new Set<string>();
  const parts = answer.split(/\s*[/;|]\s*|\s*,\s+(?![^(]*\))/).filter(Boolean);
  for (const p of parts.length ? parts : [answer]) {
    out.add(p);
    if (/\(.*\)/.test(p)) {
      out.add(p.replace(/\s*\([^)]*\)\s*/g, ' ').trim());
      out.add(p.replace(/[()]/g, '').trim());
    }
  }
  return [...out].filter((s) => s.trim().length > 0);
}

/** English canonical form for meaning answers: drops articles, infinitive "to", "be". */
export function englishCore(s: string): string {
  let k = canonical(s, 'en');
  k = k.replace(/^(to be|to|a|an|the|be)\s+/, '');
  k = k.replace(/^(a|an|the)\s+/, '');
  k = k.replace(/\b(something|someone|somebody|sth|sb|smth)\b/g, '').replace(/\s+/g, ' ').trim();
  return k;
}

/**
 * English words with two spellings count as one in answers: the app writes "practice" for the noun and the verb, and a
 * dictionary meaning or an answer spelled "practise" (practised, practises, practising) is the same word.
 */
export function englishSpellingKey(key: string): string {
  return key.replace(/\bpractis(e|ed|es|ing)\b/g, 'practic$1');
}

/** Optimal-string-alignment (Damerau–Levenshtein) distance with an optional early cut-off. */
export function editDistance(a: string, b: string, max = Number.POSITIVE_INFINITY): number {
  const A = [...a];
  const B = [...b];
  if (Math.abs(A.length - B.length) > max) return max + 1;
  const n = A.length;
  const m = B.length;
  if (n === 0) return m;
  if (m === 0) return n;
  let prevPrev: number[] = new Array(m + 1).fill(0);
  let prev: number[] = Array.from({ length: m + 1 }, (_, j) => j);
  for (let i = 1; i <= n; i++) {
    const cur: number[] = new Array(m + 1);
    cur[0] = i;
    let rowMin = cur[0];
    for (let j = 1; j <= m; j++) {
      const cost = A[i - 1] === B[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && A[i - 1] === B[j - 2] && A[i - 2] === B[j - 1]) v = Math.min(v, prevPrev[j - 2] + 1);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prevPrev = prev;
    prev = cur;
  }
  return prev[m];
}

/** Find the [start, end) range of `target` in `text` (exact, then case-insensitive, then stress-insensitive). */
export function findTarget(text: string, target: string): [number, number] | null {
  if (!target) return null;
  // A whole word first: "la" in "Ella era la Primera Dama" is the third word, not the end of "Ella".
  const word = new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])${escapeRegExp(target)}(?![\\p{L}\\p{M}\\p{N}])`, 'u');
  const m = word.exec(text) ?? new RegExp(word.source, 'iu').exec(text);
  if (m) return [m.index, m.index + m[0].length];
  // Then anywhere (a clitic or compound: the target written inside a longer word).
  let i = text.indexOf(target);
  if (i >= 0) return [i, i + target.length];
  i = text.toLowerCase().indexOf(target.toLowerCase());
  if (i >= 0) return [i, i + target.length];
  return null;
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Short words with a variant chosen for sound, not grammar. Ukrainian alternates freely (в/у, і/й, з/із/зі), so a
 * variant is as right as the word it replaces. Russian and Polish variants depend on the next word (во время,
 * we wtorek); they are only kept out of multiple-choice options, where they would look like a second right answer.
 */
const SOUND_VARIANTS: Partial<Record<AnyLanguage, { free: boolean; groups: string[][] }>> = {
  uk: { free: true, groups: [['в', 'у'], ['і', 'й'], ['з', 'із', 'зі'], ['вже', 'уже'], ['вві', 'уві']] },
  ru: { free: false, groups: [['в', 'во'], ['с', 'со'], ['к', 'ко'], ['о', 'об', 'обо'], ['от', 'ото'], ['из', 'изо'], ['под', 'подо'], ['над', 'надо'], ['перед', 'передо'], ['без', 'безо'], ['через', 'чрез']] },
  pl: { free: false, groups: [['w', 'we'], ['z', 'ze'], ['od', 'ode'], ['nad', 'nade'], ['pod', 'pode'], ['przed', 'przede'], ['przez', 'przeze'], ['bez', 'beze']] },
};

/** The sound variants of a word (lower case), and whether they may replace it anywhere. */
export function soundVariants(word: string, lang: AnyLanguage): { variants: string[]; free: boolean } {
  const conf = SOUND_VARIANTS[lang];
  const k = canonical(word, lang);
  const group = conf?.groups.find((g) => g.includes(k));
  return { variants: group ? group.filter((v) => v !== k) : [], free: !!conf?.free };
}

/**
 * Hide a word inside a meaning shown by a question that asks for that word, so the meaning does not give the answer
 * away: inside «…» everywhere ("used in «sin embargo»"), and anywhere for Russian and Ukrainian, whose words cannot be
 * mistaken for English ones. everywhere: hide it anywhere in the text (for usage notes, which are not glosses that
 * may legitimately be the same word, like Spanish hotel "hotel"). words: the word's dictionary form and other forms.
 */
export function hideWord(text: string, words: string[], lang: AnyLanguage, everywhere = false): string {
  if (!text) return text;
  const keys = new Set(words.filter(Boolean).map((w) => canonical(w, lang)));
  const mask = (s: string) => s.replace(/[\p{L}\p{M}]+(?:['’ʼ-][\p{L}\p{M}]+)*/gu, (t) => (keys.has(canonical(t, lang)) ? '…' : t));
  const out = text.replace(/«[^»]*»/g, mask);
  return everywhere || lang === 'ru' || lang === 'uk' ? mask(out) : out;
}
