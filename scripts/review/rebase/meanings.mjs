// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
import { readFileSync, existsSync } from 'node:fs';
const ROOT = '/home/claude/vocabbuilder';
const BEFORE = '/home/claude/review/rebase/before-2026-11-10/review';
const lines = (f) => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)) : []);
for (const lang of ['es', 'pt', 'vi', 'ru', 'uk', 'pl']) {
  const before = new Set(lines(`${BEFORE}/${lang}.jsonl`).map((r) => `${r.lemma}|${r.pos}|${r.rank}`));
  const fresh = new Map(lines(`${ROOT}/data/review/${lang}.jsonl`).filter((r) => !before.has(`${r.lemma}|${r.pos}|${r.rank}`)).map((r) => [`${r.lemma}|${r.pos}|${r.rank}`, r]));
  const base = new Map(JSON.parse(readFileSync(`/home/claude/review/base/${lang}.json`, 'utf8')).entries.map((e) => [`${e.lemma}|${e.pos}|${e.frequencyRank}`, e]));
  for (const d of lines(`${BEFORE}/crude/${lang}-meanings.jsonl`)) {
    const k = `${d.lemma}|${d.pos}|${d.rank}`;
    const r = fresh.get(k);
    if (!r) continue;
    const e = base.get(k);
    console.log(`\n${lang} ${d.lemma} (${d.pos}, ${d.rank}) — old decision: drop ${JSON.stringify(d.drop)} gloss ${JSON.stringify(d.gloss)}${d.note ? ' note ' + JSON.stringify(d.note) : ''}${d.retag ? ' retag ' + JSON.stringify(d.retag) : ''}${d.display ? ' display ' + d.display : ''} — ${d.why}`);
    console.log('  old: ' + e.senses.map((s, i) => `${i}=${s.gloss}`).join(' | ').slice(0, 600));
    console.log('  new: ' + r.senses.map((s, i) => `${i}=${s.gloss}${s.note ? ` [${s.note}]` : ''}${s.usage ? ` {${s.usage}}` : ''} <from ${s.from}>`).join(' | '));
    for (const a of r.add) console.log(`     N${a.sense}: ${a.text} [${a.translation}]`);
    for (const a of r.keep) console.log(`     K${a.sense}: ${a.text}`);
  }
}
