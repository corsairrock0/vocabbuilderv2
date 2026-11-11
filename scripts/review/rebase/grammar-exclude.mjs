// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// The annotations in data/grammar/src whose sentence is no longer an example of its word in the sets (the meaning
// review of 2026-11-10 dropped or replaced it): written as lang, lemma, sentence to rebase/grammar-exclude.tsv, which
// /home/claude/grammar/merge.mjs leaves out.
import { readFileSync, writeFileSync } from 'node:fs';
const { exactKey } = await import('/home/claude/vocabbuilder/shared/grammar.ts');
const out = [];
for (const lang of ['uk', 'ru', 'pl', 'es', 'pt']) {
  const d = JSON.parse(readFileSync(`/home/claude/vocabbuilder/data/frequency/${lang}.json`, 'utf8'));
  const have = new Set();
  for (const e of d.entries) for (const x of e.examples ?? []) if (x.target) have.add(exactKey(lang, e.lemma, x.target, x.text));
  let n = 0;
  for (const l of readFileSync(`/home/claude/vocabbuilder/data/grammar/src/${lang}.jsonl`, 'utf8').split('\n')) {
    if (!l.trim()) continue;
    const r = JSON.parse(l);
    if (have.has(exactKey(lang, r.lemma, r.target, r.sentence))) continue;
    out.push([lang, r.lemma, r.sentence].join('\t'));
    n++;
  }
  console.log(lang, n);
}
writeFileSync('/home/claude/review/rebase/grammar-exclude.tsv', [...new Set(out)].join('\n') + '\n');
