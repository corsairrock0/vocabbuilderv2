// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Sentences on left-out topics, for the replacement pass.
//   node topic-export.mjs export <applied-dir>   -> topics/in/<lang>.txt (from sets with the meaning review applied)
//   node topic-export.mjs check <lang>           checks topics/out/<lang>.txt
//   node topic-export.mjs save                   -> /home/claude/vocabbuilder/data/review/topics/<lang>.jsonl (merged with earlier decisions)
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { topicHits } from '/home/claude/vocabbuilder/scripts/freq/topics.mjs';
import { hasWord } from './check.mjs';

const DIR = '/home/claude/review/topics';
const LANGS = ['es', 'pt', 'vi', 'ru', 'uk', 'pl'];
const [cmd, arg] = process.argv.slice(2);
const parseIn = (lang) =>
  readFileSync(path.join(DIR, 'in', `${lang}.txt`), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [id, word, meaning, text, translation, target] = l.split(' | ');
      return { id, lemma: word.replace(/ \(.*\)$/, ''), meaning, text, translation, target: target.replace(/^\{|\}.*$/g, '') };
    });
function parseOut(lang) {
  const out = new Map();
  const problems = [];
  const file = path.join(DIR, 'out', `${lang}.txt`);
  if (!existsSync(file)) return { out, problems: ['no output file'] };
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const m = line.match(/^(T\d+) (keep|drop|replace)\s*(.*)$/);
    if (!m) {
      problems.push(`cannot read: ${line.slice(0, 80)}`);
      continue;
    }
    if (m[2] !== 'replace') out.set(m[1], { kind: m[2] });
    else {
      const r = m[3].match(/^(.+?) \| (.+?) \{([^}]+)\}\s*$/);
      if (!r) problems.push(`${m[1]}: replace needs "<sentence> | <translation> {<form>}"`);
      else out.set(m[1], { kind: 'replace', text: r[1].trim(), translation: r[2].trim(), target: r[3].trim() });
    }
  }
  return { out, problems };
}
if (cmd === 'export-open') {
  // Only the sentences that have no decision yet (a later round).
  const { loadTopicDecisions } = await import('/home/claude/vocabbuilder/scripts/freq/topics.mjs');
  for (const lang of LANGS) {
    const decisions = loadTopicDecisions(lang);
    const d = JSON.parse(readFileSync(path.join(arg, `${lang}.json`), 'utf8'));
    const lines = [];
    let n = 0;
    for (const e of d.entries) {
      for (const x of e.examples) {
        const hits = topicHits(lang, x.text, x.translation);
        if (!hits.length || decisions.has(`${e.lemma}\t${x.text.normalize('NFC').replace(/\u0301/g, '').replace(/\s+/g, ' ').trim()}`)) continue;
        const gloss = x.sense != null ? e.senses[x.sense]?.gloss : e.senses.length === 1 ? e.senses[0].gloss : e.senses.map((s, i) => `${i + 1}. ${s.gloss}`).join('; ');
        lines.push(`T${++n} | ${e.lemma} (${e.pos}) | ${gloss} | ${x.text} | ${x.translation ?? '(no translation)'} | {${x.target ?? ''}} | hits: ${hits.join(', ')}`);
      }
    }
    writeFileSync(path.join(DIR, 'in', `${lang}.txt`), lines.join('\n') + (lines.length ? '\n' : ''));
    console.log(lang, lines.length);
  }
} else if (cmd === 'export') {
  mkdirSync(path.join(DIR, 'in'), { recursive: true });
  for (const lang of LANGS) {
    const d = JSON.parse(readFileSync(path.join(arg, `${lang}.json`), 'utf8'));
    const lines = [];
    let n = 0;
    for (const e of d.entries) {
      for (const x of e.examples) {
        const hits = topicHits(lang, x.text, x.translation);
        if (!hits.length) continue;
        const gloss = x.sense != null ? e.senses[x.sense]?.gloss : e.senses.length === 1 ? e.senses[0].gloss : e.senses.map((s, i) => `${i + 1}. ${s.gloss}`).join('; ');
        lines.push(`T${++n} | ${e.lemma} (${e.pos}) | ${gloss} | ${x.text} | ${x.translation ?? '(no translation)'} | {${x.target ?? ''}} | hits: ${hits.join(', ')}`);
      }
    }
    writeFileSync(path.join(DIR, 'in', `${lang}.txt`), lines.join('\n') + '\n');
    console.log(lang, lines.length);
  }
} else if (cmd === 'check') {
  const input = parseIn(arg);
  const { out, problems } = parseOut(arg);
  for (const c of input) {
    const d = out.get(c.id);
    if (!d) problems.push(`${c.id}: no decision`);
    else if (d.kind === 'replace') {
      if (!hasWord(d.text, d.target)) problems.push(`${c.id}: {${d.target}} is not a word of the new sentence`);
      const h = topicHits(arg, d.text, d.translation);
      if (h.length) problems.push(`${c.id}: the new sentence is still on a left-out topic (${h.join(', ')})`);
      if (d.text === c.text) problems.push(`${c.id}: the new sentence is the old one`);
    }
  }
  const kinds = {};
  for (const d of out.values()) kinds[d.kind] = (kinds[d.kind] ?? 0) + 1;
  console.log(arg, JSON.stringify(kinds), `problems (${problems.length}):`);
  for (const p of problems.slice(0, 60)) console.log('  ' + p);
} else if (cmd === 'save') {
  const OUT = '/home/claude/vocabbuilder/data/review/topics';
  mkdirSync(OUT, { recursive: true });
  for (const lang of LANGS) {
    if (!existsSync(path.join(DIR, 'out', `${lang}.txt`))) continue;
    const file = path.join(OUT, `${lang}.jsonl`);
    const all = new Map();
    if (existsSync(file)) for (const l of readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
      const r = JSON.parse(l);
      all.set(`${r.lemma}\t${r.text}`, r);
    }
    const input = parseIn(lang);
    const { out } = parseOut(lang);
    for (const c of input) {
      const d = out.get(c.id);
      if (!d) continue;
      const rec = { lemma: c.lemma, text: c.text };
      if (d.kind === 'keep') rec.keep = true;
      else if (d.kind === 'drop') rec.drop = true;
      else rec.replace = { text: d.text, translation: d.translation, target: d.target };
      all.set(`${c.lemma}\t${c.text}`, rec);
    }
    writeFileSync(file, [...all.values()].map((r) => JSON.stringify(r)).join('\n') + '\n');
    console.log(lang, all.size, 'decisions');
  }
}
