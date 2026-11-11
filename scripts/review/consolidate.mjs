// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Turn the checked review outputs (out/<lang>-*.txt) into the review files the set build applies:
//   /home/claude/vocabbuilder/data/review/<lang>.jsonl   one word per line, in frequency order
// Each line: { lemma, pos, rank, senses: [{ gloss, note, usage, from }], keep: [{ text, sense, translation? }],
//              drop: [{ text, reason }], add: [{ text, translation, target, sense }], combos: [{ text, translation }],
//              notes: [] }
// Usage examples are taken out of glosses and notes here: "(на почте = at the post office)", Cyrillic text in
// Russian and Ukrainian glosses, and parts naming the word itself, so quizzes that show a gloss never show the word.
//   node consolidate.mjs [es,pt,…]
import { existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { checkChunk, parseInput, parseOutput } from './check.mjs';

const DIR = '/home/claude/review';
const OUT = '/home/claude/vocabbuilder/data/review';
const LANGS = process.argv[2] ? process.argv[2].split(',') : ['es', 'pt', 'vi', 'ru', 'uk', 'pl'];
const CYR = /[Ѐ-ӿ]/;
const norm = (x) => x.normalize('NFC').toLowerCase().replace(/́/g, '').replace(/ё/g, 'е');
const wordRe = (w) => new RegExp(`(?<![\\p{L}\\p{M}])${norm(w).replace(/[.*+?^${}()|[\]\\]/g, (c) => '\\' + c)}(?![\\p{L}\\p{M}])`, 'u');

/** Split a gloss or note into the part quizzes may show and the usage examples (shown on the word page only). */
export function splitUsage(text, lang, forms) {
  const usage = [];
  const isUsage = (seg) => seg.includes('=') || ((lang === 'ru' || lang === 'uk') && CYR.test(seg)) || forms.some((f) => f && wordRe(f).test(norm(seg)));
  const segOut = (seg) => {
    const s = seg.trim();
    if (!s) return null;
    if (!isUsage(s)) return s;
    // "certain places: на почте = at the post office" keeps its English label.
    const m = s.match(/^([^:=]*[A-Za-z][^:=]*):\s*(.+)$/);
    if (m && !isUsage(m[1])) {
      usage.push(m[2].trim());
      return m[1].trim();
    }
    usage.push(s);
    return null;
  };
  // Parenthesised parts first (outside «…»).
  let rest = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '«') {
      const j = text.indexOf('»', i);
      const end = j < 0 ? text.length : j + 1;
      rest += text.slice(i, end);
      i = end;
    } else if (ch === '(') {
      let depth = 1;
      let j = i + 1;
      while (j < text.length && depth) {
        if (text[j] === '(') depth++;
        else if (text[j] === ')') depth--;
        j++;
      }
      const inner = text.slice(i + 1, depth ? text.length : j - 1);
      const kept = inner.split(/;\s*/).map(segOut).filter(Boolean);
      if (kept.length) rest += `(${kept.join('; ')})`;
      i = j;
    } else {
      rest += ch;
      i++;
    }
  }
  // Russian and Ukrainian text left outside parentheses and «…» (rare after the checker).
  if (lang === 'ru' || lang === 'uk') {
    rest = rest
      .split(/;\s*/)
      .map((seg) => (CYR.test(seg.replace(/«[^»]*»/g, '')) ? (usage.push(seg.trim()), null) : seg))
      .filter((x) => x != null)
      .join('; ');
  }
  rest = rest.replace(/\s+/g, ' ').replace(/\s+([,;)])/g, '$1').replace(/\(\s*\)/g, '').replace(/[;,]\s*$/, '').trim();
  return { text: rest, usage };
}

function noteOut(note, lang, forms) {
  if (!note) return { note: null, usage: [] };
  const parts = note.split(/;\s*/);
  const usage = [];
  const kept = [];
  for (const p of parts) {
    if (p.includes('=') || ((lang === 'ru' || lang === 'uk') && CYR.test(p)) || forms.some((f) => f && wordRe(f).test(norm(p)))) usage.push(p.trim());
    else kept.push(p.trim());
  }
  return { note: kept.filter(Boolean).join('; ') || null, usage };
}

mkdirSync(OUT, { recursive: true });
for (const lang of LANGS) {
  const words = new Map(JSON.parse(readFileSync(path.join(DIR, 'data', `${lang}.json`), 'utf8')).map((w) => [w.id, w]));
  const chunks = readdirSync(path.join(DIR, 'out')).filter((f) => f.startsWith(`${lang}-`) && f.endsWith('.txt')).map((f) => f.slice(0, -4)).sort();
  const records = [];
  let skippedChunks = 0;
  for (const name of chunks) {
    const { problems } = checkChunk(name);
    if (problems.length) {
      console.log(`${name}: ${problems.length} problems, not used`);
      skippedChunks++;
      continue;
    }
    const input = parseInput(readFileSync(path.join(DIR, 'in', `${name}.txt`), 'utf8'));
    const { blocks } = parseOutput(readFileSync(path.join(DIR, 'out', `${name}.txt`), 'utf8'));
    for (const iw of input) {
      const w = words.get(iw.id);
      const b = blocks.get(iw.id);
      const forms = [w.lemma, ...(w.forms ?? [])].filter((f) => f && f.length > 1);
      const senses = b.senses.map((s) => {
        const g = splitUsage(s.gloss, lang, forms);
        const n = noteOut(s.note, lang, forms);
        const usage = [...g.usage, ...n.usage];
        return { gloss: g.text || s.gloss, note: n.note, usage: usage.length ? usage.join('; ') : null, from: s.from };
      });
      const keep = [];
      const drop = [];
      w.examples.forEach((x, k0) => {
        const e = b.e.get(k0 + 1);
        if ('drop' in e) drop.push({ text: x.text, reason: e.drop });
        else keep.push({ text: x.text, sense: e.sense - 1, ...(b.t.has(k0 + 1) ? { translation: b.t.get(k0 + 1) } : {}) });
      });
      records.push({
        lemma: w.lemma,
        pos: w.pos,
        rank: w.rank,
        senses,
        keep,
        drop,
        add: b.n.map((n) => ({ text: n.text, translation: n.translation, target: n.form, sense: n.sense - 1 })),
        combos: b.c,
        notes: b.notes,
      });
    }
  }
  // Words reviewed one by one outside the chunks (fixes to single words: es excitar and ponerle, pl francuz): one
  // record per line in extra/<lang>.jsonl, in the same format; a word of a chunk is replaced by its record here.
  const extraFile = path.join(DIR, 'extra', `${lang}.jsonl`);
  let extra = 0;
  if (existsSync(extraFile)) {
    for (const line of readFileSync(extraFile, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      const r = JSON.parse(line);
      const at = records.findIndex((x) => x.lemma === r.lemma && x.pos === r.pos && x.rank === r.rank);
      if (at >= 0) records[at] = r;
      else records.push(r);
      extra++;
    }
  }
  records.sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9));
  writeFileSync(path.join(OUT, `${lang}.jsonl`), records.map((r) => JSON.stringify(r)).join('\n') + (records.length ? '\n' : ''));
  console.log(`${lang}: ${records.length} words from ${chunks.length - skippedChunks} chunks${extra ? ` and ${extra} single words` : ''}`);
}
