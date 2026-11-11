// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
/**
 * Answer checking for typed responses.
 *
 * Goals (from the specification): never mark valid answers wrong because of Unicode form,
 * capitalisation, punctuation, learner stress marks or apostrophe variants; handle
 * diacritics per language and per strictness; accept listed synonyms and alternative
 * translations; recognise "right word, wrong inflected form"; and avoid accepting a
 * *different* word just because it is a small edit away (confusables). When automatic
 * evaluation is uncertain the UI offers a manual "I was right" override.
 */
import type { LanguageCode } from './languages.ts';
import { LANGUAGES } from './languages.ts';
import {
  canonical,
  vietnameseSpellingKey,
  editDistance,
  englishCore,
  englishSpellingKey,
  expandEnglishVariants,
  foldLatinDiacritics,
  type AnyLanguage,
} from './text.ts';

export type Strictness = 'strict' | 'normal' | 'lenient';
export type Grade = 'correct' | 'close' | 'incorrect';

export type FeedbackCode =
  | 'exact'
  | 'accepted_variant'
  | 'formatting'
  | 'yo_e'
  | 'missing_diacritics'
  | 'wrong_diacritics'
  | 'spacing'
  | 'typo'
  | 'wrong_form'
  | 'other_meaning'
  | 'synonym'
  | 'different_word'
  | 'empty'
  | 'incorrect';

export interface AnswerSpec {
  /** Language of the expected answer ('en' for meaning recall). */
  lang: AnyLanguage;
  /** Accepted answers; the first is the canonical one shown in feedback. */
  accepted: string[];
  /** Other inflected forms of the same lemma: a match means "right word, wrong form". */
  otherForms?: Array<{ form: string; tags?: string[] }>;
  /** English meanings of the word's other senses (accepted, flagged as another meaning). */
  otherMeanings?: string[];
  /** Different words close to the answer; never accepted as typos. */
  confusables?: string[];
  /** Other target-language words with the same English meaning (e.g. Vietnamese anh/chị/em = "you"). */
  sameMeaning?: string[];
  /** Replaces "This sentence needs “…”." after a right word in another form (Identify asks for the dictionary form). */
  wrongFormNote?: string;
}

export interface CheckResult {
  grade: Grade;
  code: FeedbackCode;
  /** The accepted answer that matched (or the canonical expected answer). */
  expected: string;
  /** Human-readable explanation suitable for feedback. */
  message: string;
  /** Form tags when code is wrong_form. */
  formTags?: string[];
  distance?: number;
}

function typoAllowance(len: number, strictness: Strictness, lang: AnyLanguage): number {
  if (strictness === 'strict') return 0;
  if (lang === 'en') {
    // English is the reference language: only tolerate typos in longer words, as short
    // English words are often different words one letter apart (house/horse).
    if (len >= 10) return strictness === 'lenient' ? 2 : 1;
    if (len >= 6) return 1;
    return 0;
  }
  if (len <= 3) return 0;
  if (len <= 7) return 1;
  return strictness === 'lenient' ? 3 : 2;
}

function keyVariants(answer: string, lang: AnyLanguage): string[] {
  if (lang !== 'en') return [canonical(answer, lang)];
  const set = new Set<string>();
  for (const v of expandEnglishVariants(answer)) {
    set.add(englishSpellingKey(canonical(v, 'en')));
    set.add(englishSpellingKey(englishCore(v)));
  }
  return [...set].filter(Boolean);
}

function responseKeys(response: string, lang: AnyLanguage): string[] {
  if (lang !== 'en') return [canonical(response, lang)];
  return [...new Set([canonical(response, 'en'), englishCore(response)].map(englishSpellingKey))].filter(Boolean);
}

const spaceless = (s: string) => s.replace(/[\s\-]+/g, '');

export function checkAnswer(rawResponse: string, spec: AnswerSpec, strictness: Strictness = 'normal'): CheckResult {
  const lang = spec.lang;
  const expected = spec.accepted[0] ?? '';
  const response = (rawResponse ?? '').normalize('NFC').trim();
  if (!response) return { grade: 'incorrect', code: 'empty', expected, message: 'No answer given.' };

  const accepted = spec.accepted.filter((a) => a && a.trim());
  const respKeys = responseKeys(response, lang);
  const profile = lang === 'en' ? null : LANGUAGES[lang as LanguageCode];

  // 1. Exact (after NFC/trim) and formatting-insensitive matches.
  for (const a of accepted) {
    if (a.normalize('NFC').trim() === response) return { grade: 'correct', code: 'exact', expected: a, message: 'Correct.' };
  }
  for (let i = 0; i < accepted.length; i++) {
    const a = accepted[i];
    const keys = keyVariants(a, lang);
    if (keys.some((k) => respKeys.includes(k))) {
      return {
        grade: 'correct',
        code: i === 0 ? 'formatting' : 'accepted_variant',
        expected: a,
        message: i === 0 ? 'Correct.' : `Correct — also accepted: ${expected}.`,
      };
    }
  }

  // Vietnamese words have two accepted spellings (công ty / công ti, hóa / hoá): both are right.
  if (lang === 'vi') {
    const rk = vietnameseSpellingKey(response);
    const hit = accepted.find((a) => vietnameseSpellingKey(a) === rk);
    if (hit) return { grade: 'correct', code: 'accepted_variant', expected: hit, message: `Correct — also written ${hit}.` };
  }

  // 2. Other meanings of the same word (English answers).
  if (lang === 'en' && spec.otherMeanings?.length) {
    for (const m of spec.otherMeanings) {
      if (keyVariants(m, 'en').some((k) => respKeys.includes(k))) {
        return { grade: 'correct', code: 'other_meaning', expected: m, message: `Correct — that is another meaning of this word. In this context: ${expected}.` };
      }
    }
  }

  const resp = respKeys[0];
  const confusableKeys = new Set((spec.confusables ?? []).flatMap((c) => keyVariants(c, lang)));
  const isConfusable = respKeys.some((k) => confusableKeys.has(k));

  // 3. Right word, wrong inflected form (target languages).
  if (lang !== 'en' && spec.otherForms?.length) {
    for (const f of spec.otherForms) {
      if (canonical(f.form, lang) === resp && !accepted.some((a) => canonical(a, lang) === resp)) {
        return {
          grade: 'close',
          code: 'wrong_form',
          expected,
          formTags: f.tags,
          message: `Right word, different form: “${f.form}”${f.tags?.length ? ` (${f.tags.join(', ')})` : ''}. ${spec.wrongFormNote ?? `This sentence needs “${expected}”.`}`,
        };
      }
    }
  }

  // A real word with the same English meaning: knowledge shown, but not the word this card asks for.
  if (lang !== 'en' && spec.sameMeaning?.length) {
    const hit = spec.sameMeaning.find((w) => canonical(w, lang) === resp);
    if (hit) {
      return { grade: 'close', code: 'synonym', expected, message: `“${hit}” has the same English meaning, but this card asks for “${expected}” — check the usage note.` };
    }
  }

  if (isConfusable) {
    return { grade: 'incorrect', code: 'different_word', expected, message: `That is a different word. Expected: ${expected}.` };
  }

  // 4. Russian ё/е.
  if (lang === 'ru') {
    for (const a of accepted) {
      if (canonical(a, 'ru').replace(/ё/g, 'е') === resp.replace(/ё/g, 'е')) {
        return { grade: 'correct', code: 'yo_e', expected: a, message: `Correct (written with ё: ${a}).` };
      }
    }
  }

  // 5. Diacritics / tones (Latin-script languages only; Cyrillic letters are never folded).
  if (profile && profile.script === 'latin') {
    for (const a of accepted) {
      const ak = canonical(a, lang);
      if (foldLatinDiacritics(ak) === foldLatinDiacritics(resp)) {
        const missing = foldLatinDiacritics(resp) === resp; // learner typed no diacritics at all
        if (lang === 'vi' && !missing) {
          // Different tone marks usually mean a different word in Vietnamese.
          return strictness === 'lenient'
            ? { grade: 'close', code: 'wrong_diacritics', expected: a, message: `Check the tone marks: ${a}.` }
            : { grade: 'incorrect', code: 'wrong_diacritics', expected: a, message: `Wrong tone or vowel marks — ${a}. In Vietnamese, tones change the word.` };
        }
        if (strictness === 'strict') {
          return { grade: 'incorrect', code: missing ? 'missing_diacritics' : 'wrong_diacritics', expected: a, message: `Accents are required in strict mode: ${a}.` };
        }
        const grade: Grade = strictness === 'lenient' && missing ? 'correct' : 'close';
        return {
          grade,
          code: missing ? 'missing_diacritics' : 'wrong_diacritics',
          expected: a,
          message: missing ? `Almost — add the accents/tones: ${a}.` : `Check the accents: ${a}.`,
        };
      }
    }
  }

  // 6. Spacing / hyphenation (e.g. multi-syllable Vietnamese words, кто-то).
  for (const a of accepted) {
    if (spaceless(canonical(a, lang)) === spaceless(resp)) {
      return strictness === 'lenient'
        ? { grade: 'correct', code: 'spacing', expected: a, message: `Correct — note the spacing: ${a}.` }
        : { grade: 'close', code: 'spacing', expected: a, message: `Almost — check the spacing: ${a}.` };
    }
  }

  // 7. Typos (whole-answer edit distance; never substring matching).
  let best: { a: string; d: number } | null = null;
  for (const a of accepted) {
    for (const k of keyVariants(a, lang)) {
      const allowance = typoAllowance([...k].length, strictness, lang);
      if (allowance === 0) continue;
      for (const r of respKeys) {
        const d = editDistance(k, r, allowance);
        if (d <= allowance && (!best || d < best.d)) best = { a, d };
      }
    }
  }
  if (best) {
    return { grade: 'close', code: 'typo', expected: best.a, distance: best.d, message: `Close — check the spelling: ${best.a}.` };
  }

  return { grade: 'incorrect', code: 'incorrect', expected, message: `Expected: ${expected}.` };
}

/** Grade for multiple-choice answers. */
export function checkChoice(selectedId: string | null | undefined, correctId: string): CheckResult {
  if (!selectedId) return { grade: 'incorrect', code: 'empty', expected: correctId, message: 'No option selected.' };
  return selectedId === correctId
    ? { grade: 'correct', code: 'exact', expected: correctId, message: 'Correct.' }
    : { grade: 'incorrect', code: 'incorrect', expected: correctId, message: 'Not quite.' };
}
