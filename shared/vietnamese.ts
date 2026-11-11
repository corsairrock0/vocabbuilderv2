// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
/**
 * Vietnamese tone keys for the on-screen typing helper (1.8.4). A tone key puts its mark on the syllable just before
 * the caret, on the vowel that carries it in modern spelling: a vowel with its own mark (ă â ê ô ơ ư; the ơ of ươ), the
 * middle one of three, the first of two in an open syllable and the second in a closed one; the u of qu- and the i of
 * gi- belong to the consonant. Answers are accepted whichever vowel holds the tone (vietnameseSpellingKey), so the
 * helper's choice never makes an answer wrong. The same key again takes the tone off; another key replaces it.
 */

export interface ToneKey {
  /** The combining mark (U+0301 …). */
  mark: string;
  /** The tone's Vietnamese name. */
  name: string;
  /** What it sounds like, for the button's title. */
  sound: string;
}

export const VI_TONE_KEYS: readonly ToneKey[] = [
  { mark: '́', name: 'sắc', sound: 'rising' },
  { mark: '̀', name: 'huyền', sound: 'falling' },
  { mark: '̉', name: 'hỏi', sound: 'dipping' },
  { mark: '̃', name: 'ngã', sound: 'broken rising' },
  { mark: '̣', name: 'nặng', sound: 'heavy, low' },
];

const TONES = /[̣̀́̃̉]/g;
const VOWELS = 'aăâeêioôơuưy';
const OWN_MARK = 'ăâêôơư';

/** The index of the letter that takes the tone in a toneless syllable, or -1 when it has no vowel. */
export function toneIndex(syllable: string): number {
  const s = syllable.toLowerCase();
  let vowels = [...s].map((c, i) => (VOWELS.includes(c) ? i : -1)).filter((i) => i >= 0);
  // qu- and gi- before another vowel: quá, già (but gì keeps its i).
  if ((s.startsWith('qu') || s.startsWith('gi')) && vowels.length > 1 && vowels[0] === 1) vowels = vowels.slice(1);
  if (!vowels.length) return -1;
  const marked = vowels.filter((i) => OWN_MARK.includes(s[i]));
  if (marked.length) return marked[marked.length - 1];
  if (vowels.length >= 3) return vowels[1];
  if (vowels.length === 2) return vowels[1] < s.length - 1 ? vowels[1] : vowels[0];
  return vowels[0];
}

/**
 * The text after pressing a tone key with the caret at `caret`: the syllable before the caret gets the tone (or loses
 * it, when it already has this one). Returns the new text and caret; the text is unchanged when no vowel is there.
 */
export function applyTone(text: string, caret: number, mark: string): { text: string; caret: number } {
  const at = Math.max(0, Math.min(caret, text.length));
  let start = at;
  while (start > 0 && /[\p{L}\p{M}]/u.test(text[start - 1])) start--;
  const syllable = text.slice(start, at);
  if (!syllable) return { text, caret: at };
  const d = syllable.normalize('NFD');
  const base = d.replace(TONES, '').normalize('NFC');
  const i = toneIndex(base);
  if (i < 0) return { text, caret: at };
  const chars = [...base];
  const next = d.includes(mark) ? base : chars.map((c, j) => (j === i ? (c + mark).normalize('NFC') : c)).join('');
  return { text: text.slice(0, start) + next + text.slice(at), caret: start + next.length };
}
