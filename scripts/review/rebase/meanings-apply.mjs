// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// The crude-meaning decisions name meanings by their number in the list the set had then. For the words the meaning
// review now covers, those numbers no longer fit: the decisions are taken out, and the two meanings the owner had
// dropped that the review kept (the curse "damn" of Spanish and Portuguese maldito) are dropped by new decisions on
// the reviewed lists. The reviewed lists of the other words were read one by one (rebase/meanings.mjs): none holds
// the crude meaning or wording its old decision was about.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const ROOT = '/home/claude/vocabbuilder';
const BEFORE = '/home/claude/review/rebase/before-2026-11-10/review';
const lines = (f) => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)) : []);
const NEW = {
  es: [{ lemma: 'maldito', pos: 'adjective', rank: 322, drop: [0], gloss: {}, why: 'meaning 0 (damn, damned before a noun) is the curse the owner had dropped; keeps cursed (numbers of the reviewed list)' }],
  pt: [{ lemma: 'maldito', pos: 'adjective', rank: 484, drop: [0], gloss: {}, why: 'meaning 0 (damn, damned, bloody) is the curse the owner had dropped; keeps cursed (numbers of the reviewed list)' }],
};
for (const lang of ['es', 'pt', 'vi', 'ru', 'uk', 'pl']) {
  const before = new Set(lines(`${BEFORE}/${lang}.jsonl`).map((r) => `${r.lemma}|${r.pos}|${r.rank}`));
  const fresh = new Set(lines(`${ROOT}/data/review/${lang}.jsonl`).filter((r) => !before.has(`${r.lemma}|${r.pos}|${r.rank}`)).map((r) => `${r.lemma}|${r.pos}|${r.rank}`));
  const old = lines(`${BEFORE}/crude/${lang}-meanings.jsonl`);
  const kept = old.filter((d) => !fresh.has(`${d.lemma}|${d.pos}|${d.rank}`));
  // In the old order, a new decision in the place of the word's old one.
  const out = old.flatMap((d) => (!fresh.has(`${d.lemma}|${d.pos}|${d.rank}`) ? [d] : (NEW[lang] ?? []).filter((n) => n.lemma === d.lemma && n.pos === d.pos && n.rank === d.rank)));
  writeFileSync(`${ROOT}/data/review/crude/${lang}-meanings.jsonl`, out.map((d) => JSON.stringify(d)).join('\n') + '\n');
  console.log(lang, `${old.length} decisions → ${out.length} (${old.length - kept.length} of reviewed words taken out, ${(NEW[lang] ?? []).length} new)`);
}
