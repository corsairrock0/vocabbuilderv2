// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Check a reviewer's decisions: node check.mjs <lang>
// out/<lang>.jsonl: one decision per line —
//   {"id":"es-0001","d":"keep","why":"…"}
//   {"id":"es-0002","d":"drop","why":"…"}
//   {"id":"es-0003","d":"replace","why":"…","text":"…","translation":"…","target":"…","sense":0}
// Every candidate (cand/<lang>.jsonl) needs a decision; read-through sentences (skim/<lang>.jsonl, ids <lang>-tNNNN)
// need one only when they are crude (replace or drop; keep is not used for them).
import { existsSync } from 'node:fs';
import { readJsonl, entryOf, formsOf, norm, ROOT, candidates } from './crude-lib.mjs';
import { crudeHits } from '/home/claude/vocabbuilder/scripts/freq/crude.mjs';
import { topicHits } from '/home/claude/vocabbuilder/scripts/freq/topics.mjs';
const lang = process.argv[2];
const file = `${ROOT}/out/${lang}.jsonl`;
if (!existsSync(file)) { console.log(`no ${file} yet`); process.exit(1); }
const cand = candidates(lang);
const skim = readJsonl(`${ROOT}/skim/${lang}.jsonl`);
const items = new Map([...cand, ...skim].map((c) => [c.id, c]));
const problems = [], warnings = [];
const seen = new Map();
let lines;
try { lines = readJsonl(file); } catch (err) { console.log(`not valid JSON lines: ${err.message}`); process.exit(1); }
const WORD = /[\p{L}\p{M}]+(?:['’ʼ-][\p{L}\p{M}]+)*/gu;
const tokens = (s) => [...s.matchAll(WORD)].map((m) => m[0]);
function count(text, target) {
  // How often the target (one or more words) occurs as whole words.
  const t = tokens(target).map((w) => norm(w, lang));
  const s = tokens(text).map((w) => norm(w, lang));
  let n = 0;
  for (let i = 0; i + t.length <= s.length; i++) if (t.every((w, j) => s[i + j] === w)) n++;
  return n;
}
const counts = { keep: 0, replace: 0, drop: 0 };
for (const r of lines) {
  const at = r.id ?? '(no id)';
  const c = items.get(r.id);
  if (!c) { problems.push(`${at}: unknown id`); continue; }
  if (seen.has(r.id)) problems.push(`${at}: decided twice (the last line counts)`);
  seen.set(r.id, r);
  if (!['keep', 'replace', 'drop'].includes(r.d)) { problems.push(`${at}: d must be keep, replace or drop`); continue; }
  counts[r.d]++;
  if (typeof r.why !== 'string' || r.why.trim().length < 3) problems.push(`${at}: why is missing`);
  if (r.id.includes('-t') && r.d === 'keep') problems.push(`${at}: read-through sentences need no keep line; leave clean ones out`);
  const e = entryOf(lang, c);
  if (r.d === 'keep' && r.sense !== undefined && (!Number.isInteger(r.sense) || r.sense < 0 || r.sense >= (e?.senses?.length ?? 0))) problems.push(`${at}: sense must be a meaning number from 0 to ${(e?.senses?.length ?? 1) - 1}`);
  if (r.d !== 'replace') continue;
  for (const k of ['text', 'translation', 'target']) if (typeof r[k] !== 'string' || !r[k].trim()) problems.push(`${at}: ${k} is missing`);
  if (problems.length && problems[problems.length - 1].startsWith(`${at}: `) && /is missing/.test(problems[problems.length - 1])) continue;
  if (r.sense !== undefined && (!Number.isInteger(r.sense) || r.sense < 0 || r.sense >= (e?.senses?.length ?? 0))) problems.push(`${at}: sense must be a meaning number from 0 to ${(e?.senses?.length ?? 1) - 1}`);
  const n = count(r.text, r.target);
  if (n !== 1) problems.push(`${at}: the target «${r.target}» must appear exactly once as a whole word (found ${n})`);
  const forms = e ? formsOf(e) : [c.lemma];
  const fset = new Set(forms.map((f) => norm(f, lang)));
  if (!fset.has(norm(r.target, lang))) {
    if (forms.length > 1) problems.push(`${at}: «${r.target}» is not one of the word's forms (${forms.slice(0, 12).join(', ')}…)`);
    else warnings.push(`${at}: «${r.target}» is not the dictionary form «${c.lemma}» and the word has no form list; check it is a form of this word`);
  }
  const others = tokens(r.text).filter((w) => fset.has(norm(w, lang)));
  if (others.length > tokens(r.target).length) warnings.push(`${at}: another form of the word appears too (${others.join(', ')}); the blank may be ambiguous`);
  if (/\d/.test(r.text)) problems.push(`${at}: no digits; write numbers as words`);
  const words = tokens(r.text).length;
  if (words < 3 || words > (lang === 'vi' ? 24 : 16)) warnings.push(`${at}: ${words} words; aim for 4–12`);
  // A hit that is the target itself, or the English for it (a word in its own meanings: "condom" for condón), is the
  // word being taught; the sentence around it is what must be clean.
  const glossWords = new Set((e?.senses ?? []).flatMap((s) => (s.gloss ?? '').toLowerCase().match(/[a-z]+(?:-[a-z]+)*/g) ?? []));
  const own = (h) => norm(h, lang) === norm(r.target, lang) || tokens(r.target).some((w) => norm(w, lang) === norm(h, lang)) || h.split(/\s+/).every((w) => glossWords.has(w) || glossWords.has(w.replace(/s$/, '')));
  const ch = crudeHits(lang, r.text, r.translation).filter((h) => !own(h));
  if (ch.length) problems.push(`${at}: the replacement still matches the crude-word list: ${ch.join(', ')} (if it is a clean meaning, say so in why and it will be checked)`);
  if (crudeHits(lang, r.target, '').length) warnings.push(`${at}: the target «${r.target}» is itself on the crude-word list; make sure this sentence uses a clean meaning (${r.why})`);
  if ((r.translation.match(/[A-Za-z]+/g) ?? []).length < 2) problems.push(`${at}: the translation should be a full English sentence`);
  const th = topicHits(lang, r.text, r.translation);
  if (th.length) problems.push(`${at}: left-out topic: ${th.join(', ')}`);
  if ((e?.examples ?? []).some((x) => norm(x.text, lang) === norm(r.text, lang))) problems.push(`${at}: the word already has this sentence`);
  if (lang === 'es' && /(?<![\p{L}\p{M}])(vosotr[oa]s|vuestr[oa]s?|sois|os)(?![\p{L}\p{M}])/iu.test(r.text)) problems.push(`${at}: Colombian Spanish uses ustedes, not vosotros`);
  if (lang === 'pt' && /(?<![\p{L}\p{M}])(est(ou|ás|á|amos|ão|ava|avam)) a \p{L}+(ar|er|ir)(?![\p{L}\p{M}])/iu.test(r.text)) problems.push(`${at}: Brazilian Portuguese uses estar + gerund, not estar a + infinitive`);
}
const missing = cand.filter((c) => !seen.has(c.id)).map((c) => c.id);
console.log(`${lang}: ${seen.size} decisions (${counts.keep} keep, ${counts.replace} replace, ${counts.drop} drop; ${[...seen.keys()].filter((k) => k.includes('-t')).length} from the read-through); candidates without a decision: ${missing.length}${missing.length ? ` (first: ${missing.slice(0, 5).join(', ')})` : ''}`);
console.log(`problems (${problems.length}):`);
for (const p of problems) console.log('- ' + p);
if (warnings.length) { console.log(`warnings (${warnings.length}):`); for (const w of warnings) console.log('- ' + w); }
