// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// One spelling for the English in a set. The app writes "practice" for the noun and the verb (2.0.0), so the meanings,
// definitions, notes and translations of a set do too: practise → practice, practised → practiced, practises →
// practices, practising → practicing. Dictionaries and sentence collections use both spellings; a meaning that lists
// both ("to practice, to practise") keeps one.
//
// It is the last step of every way a set is made (build.mjs, apply-review.mjs), so all of them give the same bytes.
// To bring already built sets in line and restamp their versions:
//
//   node scripts/freq/spelling.mjs [--out data/frequency] [--lang es,pt,…]
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WORD = /\b([Pp])ractis(e|ed|es|ing)\b/;
const WORDS = new RegExp(WORD.source, 'g');

/** "to practice, to practise" → "to practice": a plain list of alternatives keeps each one once. */
function once(text) {
  if (/[()]/.test(text)) return text;
  const parts = text.split(/([,;] )/);
  if (parts.length < 3) return text;
  const seen = new Set();
  const out = [];
  for (let i = 0; i < parts.length; i += 2) {
    const k = parts[i].trim().toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    if (out.length) out.push(parts[i - 1]);
    out.push(parts[i]);
  }
  return out.join('');
}

/** English text in the app's spelling; anything else (null, a string without the word) comes back as it is. */
export function spellEnglish(text) {
  return typeof text === 'string' && WORD.test(text) ? once(text.replace(WORDS, '$1ractic$2')) : text;
}

/** The English fields of a set's entries, in place. Returns how many strings changed. */
export function respellSet(doc) {
  let changed = 0;
  const fix = (obj, key) => {
    const next = spellEnglish(obj[key]);
    if (next !== obj[key]) {
      obj[key] = next;
      changed++;
    }
  };
  for (const e of doc.entries) {
    fix(e, 'regionalNote');
    fix(e, 'grammar');
    for (const s of e.senses ?? []) {
      const before = changed;
      fix(s, 'gloss');
      fix(s, 'definition');
      fix(s, 'note');
      if (Array.isArray(s.translations) && s.translations.some((t) => spellEnglish(t) !== t)) {
        s.translations = s.translations.map(spellEnglish);
        changed++;
      }
      // An answer accepted beside the meaning is dropped when the new spelling makes it repeat the meaning or another.
      if (changed > before && Array.isArray(s.translations) && s.translations.length) {
        const seen = new Set([String(s.gloss).toLowerCase()]);
        s.translations = s.translations.filter((t) => !seen.has(String(t).toLowerCase()) && seen.add(String(t).toLowerCase()));
      }
    }
    for (const x of e.examples ?? []) fix(x, 'translation');
    for (const x of e.expressions ?? []) fix(x, 'translation');
  }
  return changed;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const o = { out: 'data/frequency', langs: ['es', 'pt', 'vi', 'ru', 'uk', 'pl'] };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') o.out = argv[++i];
    else if (argv[i] === '--lang') o.langs = argv[++i].split(',');
    else throw new Error(`Unexpected argument: ${argv[i]}`);
  }
  const write = (file, data) => {
    writeFileSync(`${file}.tmp`, data);
    renameSync(`${file}.tmp`, file);
  };
  const indexFile = path.join(o.out, 'index.json');
  const index = existsSync(indexFile) ? JSON.parse(readFileSync(indexFile, 'utf8')) : {};
  for (const lang of o.langs) {
    const file = path.join(o.out, `${lang}.json`);
    const doc = JSON.parse(readFileSync(file, 'utf8'));
    const changed = respellSet(doc);
    if (changed) {
      const json = JSON.stringify(doc);
      write(file, json);
      if (index[lang]) index[lang].version = createHash('sha256').update(json).digest('hex').slice(0, 12);
    }
    console.log(`${lang}: ${changed} ${changed === 1 ? 'string' : 'strings'} respelled${changed && index[lang] ? `, version ${index[lang].version}` : ''}`);
  }
  write(indexFile, JSON.stringify(Object.fromEntries(Object.entries(index).sort()), null, 2) + '\n');
}
