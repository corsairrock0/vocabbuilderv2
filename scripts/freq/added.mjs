// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Sentences written for words left without any: their sentences were dropped by the passes on left-out topics, crude
// content and politics, war or living people, or no source had one. At the owner's request (1.8.3) Claude wrote
// sentences for them: calm, general ones for words about terrorism, Nazism and the like, and neutral facts for words
// that name a left-out subject. Decisions: data/review/added/<lang>.jsonl, one per line:
//   { lemma, pos, rank, text, translation, target, sense }
// They are applied last in the build, and only to a word that has no sentence at that point, so a rebuild that gives
// a word sentences of its own never stacks these on top.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function addedFile(lang) {
  return fileURLToPath(new URL(`../../data/review/added/${lang}.jsonl`, import.meta.url));
}

/** lemma|pos|rank → the sentences written for that word, in file order. */
export function loadAdded(lang, file = addedFile(lang)) {
  const map = new Map();
  if (!existsSync(file)) return map;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    const key = `${r.lemma}|${r.pos}|${r.rank}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(r);
  }
  return map;
}

export const ADDED_CREDIT = 'Written by AI (Claude) in November 2026 for a word left without sentences; not checked by a native speaker';

/** Add the written sentences to the words that have none (in place). Returns { credits, stats }. */
export function applyAdded(entries, decisions, credits = []) {
  const stats = { words: 0, sentences: 0 };
  const added = [];
  for (const e of entries) {
    if ((e.examples ?? []).length) continue;
    const list = decisions.get(`${e.lemma}|${e.pos}|${e.frequencyRank}`);
    if (!list?.length) continue;
    e.examples = list.map((r) => ({
      text: r.text,
      translation: r.translation,
      target: r.target,
      ...(Number.isInteger(r.sense) && r.sense < (e.senses?.length ?? 0) ? { sense: r.sense } : {}),
      source: 'ai-claude',
      ref: null,
    }));
    for (const r of list) added.push({ lemma: e.lemma, text: r.text, credit: ADDED_CREDIT });
    stats.words++;
    stats.sentences += list.length;
  }
  return { credits: [...credits, ...added], stats };
}

export function addedReport(stats) {
  if (!stats.sentences) return [];
  return [
    '## Sentences for words left without any',
    '',
    `${stats.words.toLocaleString('en')} words that had no example sentence got ${stats.sentences.toLocaleString('en')} AI-written ones: calm, general sentences for words about subjects the app otherwise leaves out, and neutral facts for words that name such a subject.`,
    '',
  ];
}
