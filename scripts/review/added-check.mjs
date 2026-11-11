// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Check sentences written for words left without any: node check.mjs <lang> [--topics]
// out/<lang>.jsonl (or out/<lang>-topics.jsonl): {"lemma","pos","rank","text","translation","target","sense"} per line.
import { existsSync, readFileSync } from 'node:fs';
import { canonical } from '/home/claude/vocabbuilder/shared/text.ts';
import { crudeHits } from '/home/claude/vocabbuilder/scripts/freq/crude.mjs';
import { politicsHits } from '/home/claude/vocabbuilder/scripts/freq/politics.mjs';
import { topicHits } from '/home/claude/vocabbuilder/scripts/freq/topics.mjs';
const lang = process.argv[2];
const topics = process.argv.includes('--topics');
const ROOT = '/home/claude/added';
const read = (f) => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)) : []);
const words = read(`${ROOT}/words/${lang}${topics ? '-topics' : ''}.jsonl`);
const byKey = new Map(words.map((w) => [`${w.lemma}|${w.pos}|${w.rank}`, w]));
const norm = (s) => { const k = canonical(s, lang); return lang === 'ru' ? k.replace(/ё/g, 'е') : k; };
const WORD = /[\p{L}\p{M}]+(?:['’ʼ-][\p{L}\p{M}]+)*/gu;
const tokens = (s) => [...s.matchAll(WORD)].map((m) => m[0]);
const count = (text, target) => { const t = tokens(target).map(norm); const s = tokens(text).map(norm); let n = 0; for (let i = 0; i + t.length <= s.length; i++) if (t.every((w, j) => s[i + j] === w)) n++; return n; };
const file = `${ROOT}/out/${lang}${topics ? '-topics' : ''}.jsonl`;
let lines = [];
try { lines = read(file); } catch (err) { console.log(`not valid JSON lines: ${err.message}`); process.exit(1); }
const problems = [], warnings = [], per = new Map(), seenText = new Set();
lines.forEach((r, i) => {
  const at = `line ${i + 1} (${r.lemma})`;
  const w = byKey.get(`${r.lemma}|${r.pos}|${r.rank}`);
  if (!w) { problems.push(`${at}: lemma|pos|rank is not one of the listed words`); return; }
  for (const k of ['text', 'translation', 'target']) if (typeof r[k] !== 'string' || !r[k].trim()) problems.push(`${at}: ${k} is missing`);
  if (problems.length && problems.at(-1).startsWith(at)) return;
  per.set(`${r.lemma}|${r.pos}|${r.rank}`, (per.get(`${r.lemma}|${r.pos}|${r.rank}`) ?? 0) + 1);
  if (seenText.has(`${r.lemma}\t${norm(r.text)}`)) problems.push(`${at}: the same sentence twice`);
  seenText.add(`${r.lemma}\t${norm(r.text)}`);
  if (!Number.isInteger(r.sense) || r.sense < 0 || r.sense >= w.glosses.length) problems.push(`${at}: sense must be a meaning number from 0 to ${w.glosses.length - 1}`);
  if (count(r.text, r.target) !== 1) problems.push(`${at}: the target «${r.target}» must appear exactly once as a whole word`);
  const fset = new Set(w.forms.map(norm));
  if (!fset.has(norm(r.target))) (w.forms.length > 1 ? problems : warnings).push(`${at}: «${r.target}» is not one of the word's listed forms (${w.forms.slice(0, 12).join(', ')})`);
  if (/\d/.test(r.text)) problems.push(`${at}: no digits; write numbers as words`);
  const n = tokens(r.text).length;
  if (n < 3 || n > (lang === 'vi' ? 24 : 16)) warnings.push(`${at}: ${n} words; aim for 4–12`);
  if ((r.translation.match(/[A-Za-z]+/g) ?? []).length < 2) problems.push(`${at}: the translation should be a full English sentence`);
  const glossWords = new Set(w.glosses.flatMap((g) => g.toLowerCase().match(/[a-z]+(?:-[a-z]+)*/g) ?? []));
  const own = (h) => tokens(r.target).some((t) => norm(t) === norm(h)) || norm(h) === norm(r.target) || h.toLowerCase().split(/\s+/).every((x) => glossWords.has(x) || glossWords.has(x.replace(/s$/, '')));
  const ch = crudeHits(lang, r.text, r.translation).filter((h) => !own(h));
  if (ch.length) problems.push(`${at}: crude-word list: ${ch.join(', ')}`);
  const th = topicHits(lang, r.text, r.translation).filter((h) => !own(h));
  if (th.length) problems.push(`${at}: left-out topic: ${th.join(', ')}`);
  const ph = politicsHits(lang, r.text, r.translation).filter((h) => !own(h));
  if (ph.length) warnings.push(`${at}: politics/violence keywords: ${ph.join(', ')} (fine only if calm and general)`);
  if (lang === 'es' && /(?<![\p{L}\p{M}])(vosotr[oa]s|vuestr[oa]s?|sois|os)(?![\p{L}\p{M}])/iu.test(r.text)) problems.push(`${at}: Colombian Spanish uses ustedes, not vosotros`);
  if (lang === 'pt' && /(?<![\p{L}\p{M}])(est(ou|ás|á|amos|ão|ava|avam)) a \p{L}+(ar|er|ir)(?![\p{L}\p{M}])/iu.test(r.text)) problems.push(`${at}: Brazilian Portuguese uses estar + gerund`);
});
for (const [k, n] of per) if (n > 2) problems.push(`${k}: ${n} sentences; at most two per word`);
const missing = words.filter((w) => !per.has(`${w.lemma}|${w.pos}|${w.rank}`)).map((w) => w.lemma);
console.log(`${lang}${topics ? ' (topics)' : ''}: ${lines.length} sentences for ${per.size} of ${words.length} words; without any yet: ${missing.length}${missing.length ? ` (${missing.slice(0, 8).join(', ')}${missing.length > 8 ? ', …' : ''})` : ''}`);
console.log(`problems (${problems.length}):`); for (const p of problems) console.log('- ' + p);
if (warnings.length) { console.log(`warnings (${warnings.length}):`); for (const w of warnings) console.log('- ' + w); }
