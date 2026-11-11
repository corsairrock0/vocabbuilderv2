// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
/**
 * Writing practice: the learner translates an English sentence into the language they are learning, and every word
 * must be right. Each sentence lists its accepted translations as patterns:
 *
 *   {a|b}   one of the alternatives; an alternative may hold several words and further groups
 *   {a|}    a is optional
 *
 * "Ayer {fui|me fui} al mercado." accepts both verbs; "{Yo |}vivo en Bogotá." accepts it with or without "Yo". Spaces
 * are tidied after expansion, so "{Yo|} vivo" works as well.
 *
 * Grading compares words, not characters: capitals, punctuation and Russian/Ukrainian stress marks never count,
 * Russian ё may be written е, apostrophes may be any of ' ’ ʼ, a Vietnamese tone may sit on either vowel of a pair
 * (hoá/hóa, as the dictionaries allow) and final i/y follow the same rule, and the Ukrainian words у/в, і/й and
 * з/із/зі, whose shape only follows the sounds around them, count as one, and so do a Ukrainian reflexive's -ся and -сь
 * after a vowel. Nothing else is forgiven: a missing accent,
 * a wrong ending, a missing or extra word, or words in an order the sentence does not accept make the answer wrong.
 */
import { READING_LEVELS, type LevelProgress, type ReadingLevel } from './comprehension.ts';
import type { LanguageCode } from './languages.ts';
import { matchKey, vietnameseSpellingKey, type AnyLanguage } from './text.ts';

/** The levels are the reading levels, A1–C1; the learner's writing level is a language setting of its own. */
export const WRITING_LEVELS = READING_LEVELS;
export type WritingLevel = ReadingLevel;

export interface WritingSentence {
  id: string;
  level: WritingLevel;
  /** Order of difficulty within the level, easiest first (1–200). */
  step: number;
  /** The English sentence to translate. */
  en: string;
  /** A short note on what the English leaves open, such as "to a friend" for "you". */
  context?: string | null;
  /** Accepted translations as patterns; the first one's first expansion is the translation shown. */
  answers: string[];
}

/** The most translations one sentence may accept (the content checker allows far fewer). */
export const MAX_EXPANSIONS = 1000;

/** A parsed pattern: text pieces and groups of alternative sequences. */
type Piece = string | Piece[][];

export class PatternError extends Error {}

export function parsePattern(pattern: string): Piece[] {
  let i = 0;
  const seq = (depth: number): Piece[] => {
    const out: Piece[] = [];
    let text = '';
    while (i < pattern.length) {
      const c = pattern[i];
      if (c === '{') {
        if (text) out.push(text);
        text = '';
        i++;
        const alts: Piece[][] = [seq(depth + 1)];
        while (pattern[i] === '|') {
          i++;
          alts.push(seq(depth + 1));
        }
        if (pattern[i] !== '}') throw new PatternError(`a { is not closed in "${pattern}"`);
        i++;
        if (alts.length < 2) throw new PatternError(`a group needs two alternatives (write {a|} for an optional part) in "${pattern}"`);
        out.push(alts);
      } else if (c === '|' || c === '}') {
        if (depth === 0) throw new PatternError(`a stray ${c} in "${pattern}"`);
        break;
      } else {
        text += c;
        i++;
      }
    }
    if (text) out.push(text);
    return out;
  };
  const result = seq(0);
  if (i !== pattern.length) throw new PatternError(`unexpected ${pattern[i]} in "${pattern}"`);
  return result;
}

function expandSeq(seq: Piece[], limit: number): string[] {
  let acc = [''];
  for (const p of seq) {
    if (typeof p === 'string') {
      acc = acc.map((a) => a + p);
      continue;
    }
    const options = p.flatMap((alt) => expandSeq(alt, limit));
    const next: string[] = [];
    for (const a of acc) {
      for (const o of options) {
        next.push(a + o);
        if (next.length > limit) throw new PatternError(`more than ${limit} translations`);
      }
    }
    acc = next;
  }
  return acc;
}

/** Single spaces, none before closing punctuation or after opening punctuation, none at the ends. */
export function tidySentence(s: string): string {
  return s
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,!?;:…»)\]])/g, '$1')
    .replace(/([¿¡«(\[])\s+/g, '$1')
    .trim();
}

/** Upper-case the first letter (after any opening ¿ ¡ « punctuation). */
export function capitalizeFirst(s: string): string {
  return s.replace(/\p{L}/u, (c) => c.toLocaleUpperCase());
}

/** Every sentence a pattern accepts, tidied, without repeats, in pattern order. */
export function expandPattern(pattern: string, limit = MAX_EXPANSIONS): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of expandSeq(parsePattern(pattern), limit)) {
    const s = capitalizeFirst(tidySentence(raw));
    if (s && !seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  return out;
}

/** Every sentence a list of patterns accepts; the first is the translation to show. */
export function expandAnswers(answers: readonly string[], limit = MAX_EXPANSIONS): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of answers) {
    for (const s of expandPattern(p, limit)) {
      if (!seen.has(s)) {
        seen.add(s);
        out.push(s);
        if (out.length > limit) throw new PatternError(`more than ${limit} translations`);
      }
    }
  }
  return out;
}

const WORD = /[\p{L}\p{M}\p{N}]+(?:['’ʼ-][\p{L}\p{M}\p{N}]+)*/gu;

/** The words of a sentence, keeping word-inner apostrophes and hyphens (п’ять, guarda-chuva, кто-то). */
export function writingWords(text: string): string[] {
  return text.normalize('NFC').match(WORD) ?? [];
}

/** Ukrainian words that are one word in two or three sound-fitting shapes (у/в "in", і/й "and", з/із/зі "with"). */
const UK_SAME: Record<string, string> = { у: 'в', й: 'і', із: 'з', зі: 'з' };

/** How one word is compared. Ukrainian: у/в, і/й, з/із/зі as one word, and -ся/-сь after a vowel (втомилася, втомилась). */
export function wordKey(word: string, lang: AnyLanguage): string {
  if (lang === 'vi') return vietnameseSpellingKey(word);
  const k = matchKey(word, lang);
  return lang === 'uk' ? (UK_SAME[k] ?? k.replace(/([аеєиіїоуюя])сь$/u, '$1ся')) : k;
}

/** How a whole answer is compared: its words' keys, in order. */
export function writingKey(text: string, lang: AnyLanguage): string {
  return writingWords(text)
    .map((w) => wordKey(w, lang))
    .filter(Boolean)
    .join(' ');
}

export interface WritingMark {
  w: string;
  ok: boolean;
}

/** Word-by-word alignment (longest common subsequence): which words of each side the other one has, in order. */
export function alignWords(answer: string, target: string, lang: AnyLanguage) {
  const a = writingWords(answer);
  const t = writingWords(target);
  const ka = a.map((w) => wordKey(w, lang));
  const kt = t.map((w) => wordKey(w, lang));
  const L = Array.from({ length: ka.length + 1 }, () => new Array<number>(kt.length + 1).fill(0));
  for (let x = ka.length - 1; x >= 0; x--) {
    for (let y = kt.length - 1; y >= 0; y--) L[x][y] = ka[x] === kt[y] ? L[x + 1][y + 1] + 1 : Math.max(L[x + 1][y], L[x][y + 1]);
  }
  const okA = new Array<boolean>(a.length).fill(false);
  const okT = new Array<boolean>(t.length).fill(false);
  for (let x = 0, y = 0; x < ka.length && y < kt.length; ) {
    if (ka[x] === kt[y]) {
      okA[x] = okT[y] = true;
      x++;
      y++;
    } else if (L[x + 1][y] >= L[x][y + 1]) x++;
    else y++;
  }
  return {
    common: L[0][0],
    answer: a.map((w, i) => ({ w, ok: okA[i] })),
    target: t.map((w, i) => ({ w, ok: okT[i] })),
  };
}

export interface WritingGrade {
  correct: boolean;
  /** The main translation. */
  expected: string;
  /** The accepted translation nearest to the answer (the answer's own wording when it is right). */
  closest: string;
  /** The learner's words; ok when the nearest translation has them in that order. */
  answerWords: WritingMark[];
  /** The nearest translation's words; ok when the answer has them. */
  closestWords: WritingMark[];
}

/**
 * Grade an answer. `extra` holds translations the learner told the app were right ("I was right"); they count
 * like the sentence's own.
 */
export function gradeWriting(answer: string, sentence: Pick<WritingSentence, 'answers'>, lang: AnyLanguage, extra: readonly string[] = []): WritingGrade {
  const own = expandAnswers(sentence.answers);
  const all = [...own, ...extra.filter((e) => !own.includes(e))];
  const key = writingKey(answer, lang);
  const expected = own[0] ?? '';
  let best = { text: expected, common: -1, diff: Number.POSITIVE_INFINITY, al: alignWords(answer, expected, lang) };
  let correct = false;
  for (const text of all) {
    if (key && writingKey(text, lang) === key) {
      correct = true;
      best = { text, common: 0, diff: 0, al: alignWords(answer, text, lang) };
      break;
    }
    const al = alignWords(answer, text, lang);
    const diff = Math.abs(al.answer.length - al.target.length);
    if (al.common > best.common || (al.common === best.common && diff < best.diff)) best = { text, common: al.common, diff, al };
  }
  return { correct, expected, closest: best.text, answerWords: best.al.answer, closestWords: best.al.target };
}

// ------------------------------------------------------------------ what the server and the device exchange
//
// The level rules are those of reading (shared/comprehension.ts: levelProgress, levelAfter, levelSearchOrder), with
// "done" for "read": a sentence is done once it has been translated right (or the learner said their answer was), the
// level rises one step only when every sentence of it is done, a level without sentences never counts as done, and C1
// is the top.

/** A sentence as the device gets it, with the wordings the learner told the app were right ("I was right"). */
export interface WritingItem extends WritingSentence {
  accepted: string[];
}

export interface WritingNext {
  sentence: WritingItem | null;
  /** The level asked for (the learner's writing level unless the request named one). */
  requested: WritingLevel;
  /** The sentence's level: the one asked for, or the nearest with a sentence left when that one has none. */
  level: WritingLevel | null;
  fallback: boolean;
  /** The sentence was answered wrong before and comes back. */
  again: boolean;
  /** Sentences in the language, and how many are not done yet. */
  total: number;
  available: number;
  /** How far through the level asked for the learner is (`read`: sentences done). */
  progress: LevelProgress;
  /** Asked with a study session's words: those the sentence's usual translation uses (none: it uses none of them). */
  uses?: number[];
}

/** What the server says about an answer. */
export interface WritingAttemptResult {
  sentenceId: string;
  correct: boolean;
  /** The learner said the answer was right (it counts as right). */
  accepted: boolean;
  grade: WritingGrade;
  levelBefore: WritingLevel;
  levelAfter: WritingLevel;
  levelUp: boolean;
  progress: LevelProgress;
  duplicate?: boolean;
  /** How many of the learner's words this answer reviewed (2.0.0). */
  reviews?: number;
}

export interface WritingSummary {
  language: LanguageCode;
  level: WritingLevel;
  progress: LevelProgress;
  total: number;
  done: number;
  available: number;
  levels: Array<{ level: WritingLevel; total: number; done: number }>;
}
