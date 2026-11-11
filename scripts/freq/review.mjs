// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Apply the meaning review (data/review/<lang>.jsonl) to a built set.
//
// The review checked every word's meanings against its example sentences: meanings were merged and trimmed (one to
// five, most common first), missing common meanings added, meanings of other words with the same spelling dropped;
// each sentence was linked to the meaning it shows, or dropped (the word sits in a fixed combination with another
// meaning there, it is another word, it shows a dropped meaning, or it is unnatural); every meaning without a
// sentence got a new AI-written one; fixed combinations with their own meaning (Spanish sin embargo) are listed
// under the word instead of being treated as its meanings. See docs/FREQUENCY_SETS.md#meaning-review.
//
// Each line of a review file is one word: { lemma, pos, rank, senses: [{ gloss, note, usage, from }],
// keep: [{ text, sense, translation? }], drop: [{ text, reason }], add: [{ text, translation, target, sense }],
// combos: [{ text, translation }], notes }. Sentences are matched by text, so the file stays valid when a
// rebuild finds the same sentences in another order. A reviewed word keeps only reviewed sentences.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const REVIEW_CREDIT = 'Written by AI (Claude) in November 2026 for the meaning review; not checked by a native speaker';

const key = (lemma, pos) => `${lemma.normalize('NFC')}|${pos}`;
const textKey = (s) => s.normalize('NFC').replace(/́/g, '').replace(/\s+/g, ' ').trim();

export function reviewFile(lang) {
  return fileURLToPath(new URL(`../../data/review/${lang}.jsonl`, import.meta.url));
}

/** The review of one language: lemma|pos → records (more than one for words listed twice). */
export function loadReview(lang, file = reviewFile(lang)) {
  const map = new Map();
  if (!existsSync(file)) return map;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    const k = key(r.lemma, r.pos);
    (map.get(k) ?? map.set(k, []).get(k)).push(r);
  }
  return map;
}

/**
 * Apply a review to the entries of a set (in place). credits: the build's sentence credits ({ lemma, text, credit }),
 * returned without the dropped sentences and with the new ones. Returns { credits, stats }.
 */
export function applyReview(entries, review, credits = []) {
  const stats = { words: entries.length, reviewed: 0, sensesBefore: 0, sensesAfter: 0, kept: 0, dropped: 0, added: 0, unreviewedSentences: 0, combinations: 0, dropReasons: {} };
  const added = [];
  for (const e of entries) {
    const recs = review.get(key(e.lemma, e.pos));
    if (!recs?.length) continue;
    const rec = recs.find((r) => r.rank === e.frequencyRank) ?? recs[0];
    stats.reviewed++;
    stats.sensesBefore += e.senses.length;
    const old = e.senses;
    e.senses = rec.senses.map((s) => {
      // A meaning copied unchanged from one old meaning keeps that meaning's extra answers and definition.
      const same = s.from.length === 1 ? old[s.from[0] - 1] : null;
      const carried = same && same.gloss === s.gloss ? same : null;
      return { gloss: s.gloss, translations: carried?.translations ?? [], definition: s.usage ?? carried?.definition ?? null, note: s.note ?? null };
    });
    stats.sensesAfter += e.senses.length;
    const keep = new Map(rec.keep.map((k) => [textKey(k.text), k]));
    const drop = new Map(rec.drop.map((d) => [textKey(d.text), d.reason]));
    const examples = [];
    for (const x of e.examples ?? []) {
      const t = textKey(x.text);
      const k = keep.get(t);
      if (k && e.senses[k.sense]) {
        examples.push({ ...x, translation: k.translation ?? x.translation, sense: k.sense });
        stats.kept++;
      } else if (drop.has(t)) {
        stats.dropped++;
        stats.dropReasons[drop.get(t)] = (stats.dropReasons[drop.get(t)] ?? 0) + 1;
      } else stats.unreviewedSentences++;
    }
    for (const a of rec.add) {
      if (!e.senses[a.sense] || examples.some((x) => textKey(x.text) === textKey(a.text))) continue;
      examples.push({ text: a.text, translation: a.translation, target: a.target, source: 'ai-claude', ref: null, sense: a.sense });
      added.push({ lemma: e.lemma, text: a.text, credit: REVIEW_CREDIT });
      stats.added++;
    }
    e.examples = examples;
    e.expressions = rec.combos.map((c) => ({ text: c.text, translation: c.translation, kind: 'combination' }));
    stats.combinations += e.expressions.length;
  }
  // Credits list only the sentences that are still there, then the new ones.
  const present = new Set(entries.flatMap((e) => (e.examples ?? []).map((x) => `${e.lemma}\t${textKey(x.text)}`)));
  const kept = credits.filter((c) => present.has(`${c.lemma}\t${textKey(c.text)}`));
  return { credits: [...kept, ...added], stats };
}

/** A section for the build report. */
export function reviewReport(stats) {
  if (!stats.reviewed) return ['## Meaning review', '', 'No review file for this language: meanings and sentences are as built.', ''];
  const reasons = Object.entries(stats.dropReasons)
    .sort((a, b) => b[1] - a[1])
    .map(([r, n]) => `${n.toLocaleString('en')} ${r}`)
    .join(', ');
  return [
    '## Meaning review',
    '',
    `${stats.reviewed.toLocaleString('en')} of ${stats.words.toLocaleString('en')} words were reviewed (data/review/): meanings ${stats.sensesBefore.toLocaleString('en')} → ${stats.sensesAfter.toLocaleString('en')}, ` +
      `sentences kept ${stats.kept.toLocaleString('en')}, dropped ${stats.dropped.toLocaleString('en')}${reasons ? ` (${reasons})` : ''}, ` +
      `added ${stats.added.toLocaleString('en')} (AI-written, one for each meaning that had none), fixed combinations listed ${stats.combinations.toLocaleString('en')}.`,
    stats.unreviewedSentences ? `${stats.unreviewedSentences.toLocaleString('en')} sentences of reviewed words were not in the review and were left out.` : null,
    '',
  ].filter((x) => x != null);
}
