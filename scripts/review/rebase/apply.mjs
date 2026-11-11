// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// The crude and politics decisions were written against the meaning lists the sets had then. For the words the
// meaning review now covers (the 25 batches applied on 2026-11-10), their meaning numbers are moved to the reviewed
// lists: an old number leads to the reviewed meaning that was made from it (`from` in the review record). Politics
// numbers counted the meanings left after the crude ones were dropped, crude numbers the dictionary's own.
//   node rebase/apply.mjs            report only
//   node rebase/apply.mjs --write    rewrite data/review/crude/<lang>.jsonl and data/review/politics/<lang>.jsonl
// Decisions it cannot move (the old meaning is not in the review, or leads to several) are listed for a decision by
// hand in rebase/hand.json: { "<lang>|<kind>|<lemma>|<text>": { sense: n } | { drop: true } | { replace: {...} } }.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const ROOT = '/home/claude/vocabbuilder';
const BEFORE = '/home/claude/review/rebase/before-2026-11-10/review';
const LANGS = ['es', 'pt', 'vi', 'ru', 'uk', 'pl'];
const WRITE = process.argv.includes('--write');
const lines = (f) => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)) : []);
const textKey = (s) => s.normalize('NFC').replace(/́/g, '').replace(/\s+/g, ' ').trim();
const handFile = '/home/claude/review/rebase/hand.json';
const hand = existsSync(handFile) ? JSON.parse(readFileSync(handFile, 'utf8')) : {};
const extra = JSON.parse(readFileSync('/home/claude/review/rebase/new-decisions.json', 'utf8'));
const todo = [];
for (const lang of LANGS) {
  const before = new Set(lines(`${BEFORE}/${lang}.jsonl`).map((r) => `${r.lemma}|${r.pos}|${r.rank}`));
  const fresh = lines(`${ROOT}/data/review/${lang}.jsonl`).filter((r) => !before.has(`${r.lemma}|${r.pos}|${r.rank}`));
  const base = new Map(JSON.parse(readFileSync(`/home/claude/review/base/${lang}.json`, 'utf8')).entries.map((e) => [`${e.lemma}|${e.pos}|${e.frequencyRank}`, e]));
  // The crude-meanings decisions as they were when the politics numbers were given.
  const cm = new Map(lines(`${BEFORE}/crude/${lang}-meanings.jsonl`).map((d) => [`${d.lemma}|${d.pos}|${d.rank}`, d]));
  const byLemma = new Map();
  for (const r of fresh) (byLemma.get(r.lemma) ?? byLemma.set(r.lemma, []).get(r.lemma)).push(r);
  const tally = { moved: 0, same: 0, hand: 0, 'by hand': 0, moot: 0, chained: 0 };
  // A decision may be about a sentence an earlier pass put there (topics, then crude, then politics): its sentence then
  // stands where that pass's original stood, so it is traced back to the sentence the review saw.
  const earlier = new Map();
  const origin = (lemma, text) => {
    let t = textKey(text);
    for (let i = 0; i < 4 && earlier.has(`${lemma}\t${t}`); i++) t = earlier.get(`${lemma}\t${t}`);
    return t;
  };
  for (const d of lines(`${BEFORE}/topics/${lang}.jsonl`)) if (d.replace && byLemma.has(d.lemma)) earlier.set(`${d.lemma}\t${textKey(d.replace.text)}`, textKey(d.text));
  for (const kind of ['crude', 'politics']) {
    const file = `${ROOT}/data/review/${kind}/${lang}.jsonl`;
    // Always from the decisions as shipped, so a second run gives the same result.
    const out = lines(`${BEFORE}/${kind}/${lang}.jsonl`).map((d) => {
      const recs = byLemma.get(d.lemma);
      if (!recs) return d;
      const n = d.replace && Number.isInteger(d.replace.sense) ? d.replace.sense : d.keep && Number.isInteger(d.sense) ? d.sense : null;
      const t = origin(d.lemma, d.text);
      if (t !== textKey(d.text)) tally.chained++;
      const rec = recs.find((r) => r.keep.some((k) => textKey(k.text) === t));
      const hk = `${lang}|${kind}|${d.lemma}|${d.text}`;
      const set = (sense) => (d.replace ? { ...d, replace: { ...d.replace, sense } } : { ...d, sense });
      if (hand[hk]) {
        tally['by hand']++;
        const h = hand[hk];
        if (h.drop) return { lemma: d.lemma, text: d.text, drop: true };
        if (h.replace) return { lemma: d.lemma, text: d.text, replace: h.replace };
        return set(h.sense);
      }
      if (!rec) {
        tally.moot++;
        return d;
      }
      const linked = rec.keep.find((k) => textKey(k.text) === t).sense;
      if (n == null) return d; // no number: the sentence keeps the meaning the review linked its original to
      const e = base.get(`${rec.lemma}|${rec.pos}|${rec.rank}`);
      let baseIndex = n;
      if (kind === 'politics') {
        const drop = new Set(cm.get(`${rec.lemma}|${rec.pos}|${rec.rank}`)?.drop ?? []);
        baseIndex = e.senses.map((_, i) => i).filter((i) => !drop.has(i))[n] ?? null;
      }
      const mapped = baseIndex == null ? [] : rec.senses.map((s, j) => (s.from.includes(baseIndex + 1) ? j : -1)).filter((j) => j >= 0);
      const to = mapped.length === 1 ? mapped[0] : mapped.includes(linked) ? linked : null;
      if (to == null) {
        tally.hand++;
        todo.push({ key: hk, old: `${n}: ${e.senses[baseIndex]?.gloss ?? '?'}`, replacement: d.replace ? `${d.replace.text} [${d.replace.translation}]` : '(kept as it is)', linked, mapped, list: rec.senses.map((s, j) => `${j}=${s.gloss}`) });
        return d;
      }
      if (to === n) tally.same++;
      else tally.moved++;
      return set(to);
    });
    for (const d of out) if (d.replace && byLemma.has(d.lemma)) earlier.set(`${d.lemma}\t${textKey(d.replace.text)}`, origin(d.lemma, d.text));
    // Then the decisions made when the batches were applied (rebase/new-decisions.json): sentences of the newly
    // reviewed words that a detector matches, each read and kept (calm and general, or a false match) or dropped.
    for (const d of extra[kind]?.[lang] ?? []) {
      const at = out.findIndex((x) => x.lemma === d.lemma && textKey(x.text) === textKey(d.text));
      if (at >= 0) out[at] = d;
      else out.push(d);
    }
    if (WRITE) writeFileSync(file, out.map((d) => JSON.stringify(d)).join('\n') + '\n');
  }
  console.log(lang, JSON.stringify(tally));
}
if (todo.length) {
  console.log(`\n${todo.length} to decide by hand:`);
  for (const t of todo) console.log(JSON.stringify(t, null, 1));
}
