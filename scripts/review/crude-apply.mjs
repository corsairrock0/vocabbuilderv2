// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Turn reviewed decisions into the app's decision files, and list the sentences they remove.
// Usage: node apply.mjs [langs]   → /home/claude/vocabbuilder/data/review/crude/<lang>.jsonl, grammar-exclude.tsv
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { readJsonl, ROOT, candidates } from './crude-lib.mjs';
import { crudeHits } from '/home/claude/vocabbuilder/scripts/freq/crude.mjs';
const OUT = '/home/claude/vocabbuilder/data/review/crude';
mkdirSync(OUT, { recursive: true });
const langs = (process.argv[2] ?? 'es,pt,vi,ru,uk,pl').split(',');
const exclude = [];
for (const lang of langs) {
  const file = `${ROOT}/out/${lang}.jsonl`;
  if (!existsSync(file)) { console.log(`${lang}: no decisions yet`); continue; }
  const items = new Map([...candidates(lang), ...readJsonl(`${ROOT}/skim/${lang}.jsonl`)].map((c) => [c.id, c]));
  const last = new Map();
  for (const r of readJsonl(file)) last.set(r.id, r);
  // A read-through sentence that is also a candidate has the same word and text: the candidate's decision counts.
  const byKey = new Set();
  const keyOf = (c) => `${c.lemma}\t${c.text.normalize('NFC').replace(/\u0301/g, '').replace(/\s+/g, ' ').trim()}`;
  const ordered = [...last.entries()].sort(([a], [b]) => (a.includes('-t') === b.includes('-t') ? 0 : a.includes('-t') ? 1 : -1));
  last.clear();
  for (const [id, r] of ordered) { const c = items.get(id); if (!c) continue; const k = keyOf(c); if (byKey.has(k)) continue; byKey.add(k); last.set(id, r); }
  const recs = [];
  const n = { keep: 0, replace: 0, drop: 0 };
  for (const [id, r] of last) {
    const c = items.get(id);
    if (!c) continue;
    if (r.d === 'keep') {
      if (Number.isInteger(r.sense)) recs.push({ lemma: c.lemma, text: c.text, keep: true, sense: r.sense });
      else if (crudeHits(lang, c.text, c.translation).length) recs.push({ lemma: c.lemma, text: c.text, keep: true });
      else { n.keep++; continue; } // nothing to override
    } else if (r.d === 'drop') {
      recs.push({ lemma: c.lemma, text: c.text, drop: true });
      exclude.push([lang, c.lemma, c.text]);
    } else if (r.d === 'replace') {
      const replace = { text: r.text.trim(), translation: r.translation.trim(), target: r.target.trim() };
      if (Number.isInteger(r.sense)) replace.sense = r.sense;
      recs.push({ lemma: c.lemma, text: c.text, replace });
      exclude.push([lang, c.lemma, c.text]);
    } else continue;
    n[r.d]++;
  }
  recs.sort((a, b) => (a.lemma === b.lemma ? (a.text < b.text ? -1 : 1) : a.lemma < b.lemma ? -1 : 1));
  writeFileSync(`${OUT}/${lang}.jsonl`, recs.map((x) => JSON.stringify(x)).join('\n') + '\n');
  console.log(`${lang}: ${recs.length} decisions written (${n.replace} replace, ${n.drop} drop, ${n.keep} keep incl. ones needing no record)`);
}
writeFileSync(`${ROOT}/grammar-exclude.tsv`, exclude.map((x) => x.join('\t')).join('\n') + '\n');
