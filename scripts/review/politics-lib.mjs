// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Shared helpers for the politics, war and living-people review.
import { readFileSync } from 'node:fs';
import { canonical } from '/home/claude/vocabbuilder/shared/text.ts';
export const APP = '/home/claude/vocabbuilder/data';
export const ROOT = '/home/claude/politics';
const sets = {};
export function set(lang) {
  if (!sets[lang]) {
    const d = JSON.parse(readFileSync(`${APP}/frequency/${lang}.json`, 'utf8'));
    const byKey = new Map();
    for (const e of d.entries) byKey.set(`${e.lemma}|${e.pos}|${e.frequencyRank}`, e);
    sets[lang] = { doc: d, byKey };
  }
  return sets[lang];
}
export const entryOf = (lang, c) => set(lang).byKey.get(`${c.lemma}|${c.pos}|${c.rank}`);
export const norm = (s, lang) => { const k = canonical(s, lang); return lang === 'ru' ? k.replace(/ё/g, 'е') : k; };
/** Every written form of a word: the lemma, its listed forms and its table's cells. */
export function formsOf(e) {
  const out = new Set([e.lemma]);
  for (const f of e.forms ?? []) if (f?.form) out.add(f.form);
  for (const fs of Object.values(e.paradigm?.cells ?? {})) for (const f of fs ?? []) if (f) out.add(f);
  return [...out];
}
export function readJsonl(file) {
  return readFileSync(file, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
}

import { existsSync } from 'node:fs';
/**
 * Candidates to decide: the first scan's, then the later scans' (cand/<lang>-x.jsonl, ids <lang>-xNNN), then sentences
 * reviewers noted outside the lists (cand/<lang>-m.jsonl, ids <lang>-mNNN).
 */
export function candidates(lang) {
  const more = ['x', 'm'].map((k) => `${ROOT}/cand/${lang}-${k}.jsonl`).filter((f) => existsSync(f));
  return [...readJsonl(`${ROOT}/cand/${lang}.jsonl`), ...more.flatMap((f) => readJsonl(f))];
}
