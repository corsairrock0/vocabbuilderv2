// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Comparing a sentence the learner said or typed with the original, word by word (Read and say practice).
import { matchKey, type AnyLanguage } from './text.ts';

/** Word-by-word comparison: the original's words marked found or missing, and the words added that it lacks. */
export function compareWords(said: string, original: string, language: AnyLanguage) {
  const words = (s: string) => s.match(/[\p{L}\p{M}\p{N}]+(?:['’ʼ-][\p{L}\p{M}\p{N}]+)*/gu) ?? [];
  const a = words(original);
  const b = words(said);
  const ka = a.map((w) => matchKey(w, language));
  const kb = b.map((w) => matchKey(w, language));
  // Longest common subsequence, so word order counts but one slip does not mark the rest wrong.
  const L = Array.from({ length: ka.length + 1 }, () => new Array<number>(kb.length + 1).fill(0));
  for (let x = ka.length - 1; x >= 0; x--) for (let y = kb.length - 1; y >= 0; y--) L[x][y] = ka[x] === kb[y] ? L[x + 1][y + 1] + 1 : Math.max(L[x + 1][y], L[x][y + 1]);
  const found = new Array<boolean>(a.length).fill(false);
  const used = new Array<boolean>(b.length).fill(false);
  for (let x = 0, y = 0; x < ka.length && y < kb.length; ) {
    if (ka[x] === kb[y]) {
      found[x] = true;
      used[y] = true;
      x++;
      y++;
    } else if (L[x + 1][y] >= L[x][y + 1]) x++;
    else y++;
  }
  const hits = found.filter(Boolean).length;
  const extra = b.filter((_, y) => !used[y]);
  const score = a.length ? hits / Math.max(a.length, hits + extra.length) : 0;
  return { original: a.map((w, x) => ({ w, ok: found[x] })), extra, score };
}
