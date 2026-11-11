// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Shared helpers for the frequency-set build (scripts/freq/build.mjs).
// Uses the app's own normalisation so build-time keys match the database's match keys exactly.
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { foldLatinDiacritics, matchKey, stripStress } from '../../shared/text.ts';

export { foldLatinDiacritics, matchKey, stripStress };

/** Lowercased, stress-free, apostrophe-normalised key (ru also folds ё→е), as the app stores it. */
export function key(word, lang) {
  return matchKey(String(word ?? ''), lang);
}

/** Stream a text file line by line (.gz via zlib, .xz via the system `xz` tool). */
export async function* lines(file) {
  if (!existsSync(file)) throw new Error(`Missing source file: ${file}`);
  let input;
  if (file.endsWith('.gz')) input = createReadStream(file).pipe(createGunzip());
  else if (file.endsWith('.xz')) {
    const child = spawn('xz', ['-dc', file], { stdio: ['ignore', 'pipe', 'inherit'] });
    input = child.stdout;
  } else input = createReadStream(file);
  const rl = createInterface({ input: input instanceof Readable ? input : Readable.from(input), crlfDelay: Infinity });
  let first = true;
  for await (let line of rl) {
    if (first) {
      line = line.replace(/^﻿/, '');
      first = false;
    }
    yield line;
  }
}

export function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

/** Decode the few HTML entities that occur in the Wiktionary tab files. */
export function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

export const CYRILLIC_LANGS = new Set(['ru', 'uk']);

/** Letters a word of this language may contain (plus apostrophe and hyphen). */
export const WORD_RE = {
  es: /^[a-záéíóúüñ]+(?:[-'][a-záéíóúüñ]+)*$/u,
  pt: /^[a-záàâãéêíóôõúüç]+(?:[-'][a-záàâãéêíóôõúüç]+)*$/u,
  pl: /^[a-ząćęłńóśźżqvx]+(?:-[a-ząćęłńóśźżqvx]+)*$/u,
  ru: /^[а-яё]+(?:-[а-яё]+)*$/u,
  uk: /^[а-щьюяєіїґ']+(?:-[а-щьюяєіїґ']+)*$/u,
  vi: /^[\p{L}]+(?: [\p{L}]+)*$/u,
};

export function isWord(k, lang) {
  return WORD_RE[lang].test(k);
}

export function round(n, digits = 3) {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

export function log(...args) {
  process.stderr.write(args.join(' ') + '\n');
}
