#!/usr/bin/env node
// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Extract one language from a Kaikki.org / Wiktextract JSONL dump, optionally keeping only words
// that appear in the top N of a frequency list, so the result is small enough to import.
// Zero dependencies; streams input of any size (plain or gzip-compressed).
//
//   node scripts/kaikki-filter.mjs <dump.jsonl[.gz]|-> --lang <code> [options] > uk-dictionary.jsonl
//
// Options
//   --lang <code>       language code to keep: es, pt, vi, ru, uk, pl (Wiktextract "lang_code")
//   --freq <file>       frequency list: "word count" or "rank word" lines, or CSV/TSV with a header
//                       (word/lemma column, optional rank/count column)
//   --top <N>           keep only words within the top N of the frequency list (default 20000)
//   --no-forms          match the frequency list against headwords only (default also matches the
//                       entry's inflected forms, because frequency lists count surface forms)
//   --pos noun,verb     keep only these parts of speech
//   --all-entries       keep "form-of" entries too (by default only entries with real senses)
//   --max <N>           stop after writing N entries
//   --out <file>        write here instead of stdout
//
// Import the result in the app (Settings → Data and backups → Import vocabulary) or with the CLI:
//   docker compose exec app node server/cli.ts import /data/imports/uk-dictionary.jsonl --lang uk
// Kaikki data is licensed CC BY-SA (and GFDL); keep attribution with your imported data.
import { createReadStream, createWriteStream, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';
import { Readable } from 'node:stream';

function parseArgs(argv) {
  const opts = { input: null, lang: null, freq: null, top: 20000, forms: true, pos: null, allEntries: false, max: Infinity, out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`${a} needs a value`);
      return argv[++i];
    };
    if (a === '--lang') opts.lang = next();
    else if (a === '--freq') opts.freq = next();
    else if (a === '--top') opts.top = Number(next());
    else if (a === '--no-forms') opts.forms = false;
    else if (a === '--pos') opts.pos = new Set(next().split(',').map((s) => s.trim()).filter(Boolean));
    else if (a === '--all-entries') opts.allEntries = true;
    else if (a === '--max') opts.max = Number(next());
    else if (a === '--out') opts.out = next();
    else if (a === '-h' || a === '--help') opts.help = true;
    else if (!opts.input) opts.input = a;
    else throw new Error(`Unexpected argument: ${a}`);
  }
  return opts;
}

/**
 * Same normalisation idea as the app's match keys: NFC, lowercase, ё→е, and no stress marks. Only marks after a
 * Cyrillic letter are stress marks; Latin accents and Vietnamese tones are part of the spelling (más ≠ mas).
 */
export function key(word) {
  return String(word)
    .normalize('NFC')
    .replace(/[ѐѝЀЍ]/g, (c) => ({ ѐ: 'е', ѝ: 'и', Ѐ: 'Е', Ѝ: 'И' })[c])
    .replace(/([Ѐ-ӿ])[́̀]+/g, '$1')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[’ʼ']/g, "'")
    .trim();
}

export function loadFrequency(text, top) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return new Set();
  let rows;
  const first = lines[0];
  const delim = first.includes('\t') ? '\t' : first.includes(',') ? ',' : null;
  if (delim && /[a-z]/i.test(first) && !/^\S+\s+\d+$/.test(first.trim())) {
    const header = first.split(delim).map((h) => h.trim().toLowerCase());
    const wi = Math.max(0, header.findIndex((h) => ['word', 'lemma', 'form', 'term'].includes(h)));
    const ri = header.findIndex((h) => ['rank', 'position'].includes(h));
    const ci = header.findIndex((h) => ['count', 'frequency', 'freq', 'occurrences'].includes(h));
    rows = lines.slice(1).map((l, i) => {
      const c = l.split(delim);
      return { word: (c[wi] ?? '').replace(/^"|"$/g, ''), rank: ri >= 0 ? Number(c[ri]) : NaN, count: ci >= 0 ? Number(c[ci]) : NaN, order: i };
    });
  } else {
    rows = lines.map((l, i) => {
      const parts = l.trim().split(/\s+/);
      if (/^\d+$/.test(parts[0]) && parts.length > 1 && !/^\d+$/.test(parts[1])) return { word: parts.slice(1).join(' '), rank: Number(parts[0]), count: NaN, order: i };
      return { word: parts.slice(0, -1).join(' ') || parts[0], rank: NaN, count: Number(parts[parts.length - 1]), order: i };
    });
  }
  rows = rows.filter((r) => r.word);
  if (rows.every((r) => Number.isFinite(r.rank))) rows.sort((a, b) => a.rank - b.rank);
  else if (rows.every((r) => Number.isFinite(r.count))) rows.sort((a, b) => b.count - a.count);
  else rows.sort((a, b) => a.order - b.order);
  return new Set(rows.slice(0, top).map((r) => key(r.word)));
}

async function inputStream(path) {
  const raw = path === '-' ? process.stdin : createReadStream(path);
  // Detect gzip by magic bytes rather than file name.
  const it = raw[Symbol.asyncIterator]();
  const first = await it.next();
  if (first.done) return Readable.from([]);
  const head = Buffer.from(first.value);
  async function* rest() {
    yield head;
    for (;;) {
      const r = await it.next();
      if (r.done) return;
      yield r.value;
    }
  }
  const stream = Readable.from(rest());
  return head[0] === 0x1f && head[1] === 0x8b ? stream.pipe(createGunzip()) : stream;
}

export async function filterDump(opts, write = (s) => process.stdout.write(s)) {
  const allowed = opts.freq ? loadFrequency(readFileSync(opts.freq, 'utf8'), opts.top) : null;
  const needles = [`"lang_code": "${opts.lang}"`, `"lang_code":"${opts.lang}"`];
  const rl = createInterface({ input: await inputStream(opts.input), crlfDelay: Infinity });
  const stats = { lines: 0, language: 0, kept: 0, skippedFormOf: 0, skippedFrequency: 0, skippedPos: 0, invalid: 0 };
  for await (const line of rl) {
    stats.lines++;
    if (stats.lines % 200000 === 0) process.stderr.write(`  …${stats.lines} lines, ${stats.kept} kept\n`);
    if (!needles.some((n) => line.includes(n))) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      stats.invalid++;
      continue;
    }
    if (o.lang_code !== opts.lang) continue;
    stats.language++;
    if (opts.pos && !opts.pos.has(o.pos)) {
      stats.skippedPos++;
      continue;
    }
    if (!opts.allEntries) {
      const real = (o.senses ?? []).some((s) => !s.form_of && !(s.tags ?? []).includes('form-of') && (s.glosses ?? []).length);
      if (!real) {
        stats.skippedFormOf++;
        continue;
      }
    }
    if (allowed) {
      const keys = [key(o.word ?? '')];
      if (opts.forms) for (const f of o.forms ?? []) if (f?.form) keys.push(key(f.form));
      if (!keys.some((k) => allowed.has(k))) {
        stats.skippedFrequency++;
        continue;
      }
    }
    await write(line + '\n');
    stats.kept++;
    if (stats.kept >= opts.max) break;
  }
  return stats;
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
  if (opts.help || !opts.input || !opts.lang) {
    console.error(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 23).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
    process.exit(opts.help ? 0 : 2);
  }
  let out = null;
  let write = (s) => process.stdout.write(s);
  if (opts.out) {
    out = createWriteStream(opts.out);
    write = (s) => {
      if (!out.write(s)) return new Promise((r) => out.once('drain', r));
    };
  }
  const stats = await filterDump(opts, write);
  if (out) await new Promise((r) => out.end(r));
  process.stderr.write(`kaikki-filter: ${JSON.stringify(stats)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
