// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Check a review output file against its input chunk.
//   node /home/claude/review/check.mjs es-01          (reads in/es-01.txt and out/es-01.txt)
// Prints every problem; exit code 1 when there are problems.
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const DIR = '/home/claude/review';
const REASONS = new Set(['combination', 'other word', 'dropped meaning', 'bad']);
const CYRILLIC = /[\u0400-\u04FF]/;
const norm = (x) => x.normalize('NFC').toLowerCase().replace(/\u0301/g, '').replace(/ё/g, 'е').replace(/[’ʼ]/g, "'");
/** The form appears in the sentence as a whole word (or phrase), not inside another word. */
export function hasWord(sentence, form) {
  const esc = norm(form).replace(/[.*+?^${}()|[\]\\]/g, (c) => '\\' + c);
  return new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])${esc}(?![\\p{L}\\p{M}\\p{N}])`, 'u').test(norm(sentence));
}
/** A gloss or note without its usage examples "(… = …)" and «…» parts, which the app keeps off quiz screens. */
export function quizText(x) {
  return x
    .replace(/«[^»]*»/g, ' ')
    .replace(/\(([^()]*)\)/g, (_, inner) => {
      const kept = inner.split(/;\s*/).map((seg) => (seg.includes('=') ? seg.replace(/:?[^:]*=.*$/, '') : seg)).map((x) => x.trim()).filter(Boolean);
      return kept.length ? `(${kept.join('; ')})` : ' ';
    });
}

export function parseInput(text) {
  const words = [];
  let cur = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('@')) {
      cur = { id: Number(line.slice(1).split(' ')[0]), senses: 0, examples: [] };
      words.push(cur);
    } else if (cur && /^S\d+ /.test(line)) cur.senses++;
    else if (cur && /^E\d+ /.test(line)) cur.examples.push(line.replace(/^E\d+ /, '').split(' | ')[0].replace(/ \[[^\]]+\].*$/, ''));
  }
  return words;
}

export function parseOutput(text) {
  const blocks = new Map();
  const stray = [];
  let cur = null;
  text.split('\n').forEach((raw, i) => {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) return;
    if (line.startsWith('@')) {
      const id = Number(line.slice(1).trim().split(/\s/)[0]);
      cur = { id, senses: [], e: new Map(), t: new Map(), c: [], n: [], notes: [], bad: [], line: i + 1 };
      if (blocks.has(id)) cur.bad.push(`duplicate block @${id}`);
      blocks.set(id, cur);
      return;
    }
    if (!cur) return stray.push(`line ${i + 1}: text before the first @ block`);
    let m;
    if ((m = line.match(/^S (.+?) <- (new|\d+(?:\s*,\s*\d+)*)$/))) {
      const from = m[2] === 'new' ? [] : m[2].split(',').map((x) => Number(x.trim()));
      const gm = m[1].match(/^(.*?)(?:\s*\[([^\]]+)\])?$/);
      cur.senses.push({ gloss: gm[1].trim(), note: gm[2]?.trim() ?? null, from, isNew: m[2] === 'new' });
    } else if ((m = line.match(/^E(\d+) (\d+)$/))) cur.e.set(Number(m[1]), { sense: Number(m[2]) });
    else if ((m = line.match(/^E(\d+) x(?: (.+))?$/))) cur.e.set(Number(m[1]), { drop: (m[2] ?? '').trim() });
    else if ((m = line.match(/^T(\d+) (.+)$/))) cur.t.set(Number(m[1]), m[2].trim());
    else if ((m = line.match(/^C (.+?) = (.+)$/))) cur.c.push({ text: m[1].trim(), translation: m[2].trim() });
    else if ((m = line.match(/^N(\d+) (.+?) \| (.+?) \{([^}]+)\}$/))) cur.n.push({ sense: Number(m[1]), text: m[2].trim(), translation: m[3].trim(), form: m[4].trim() });
    else if ((m = line.match(/^! (.+)$/))) cur.notes.push(m[1].trim());
    else cur.bad.push(`line ${i + 1}: not understood: ${line.slice(0, 80)}`);
  });
  return { blocks, stray };
}

export function checkChunk(name) {
  const input = parseInput(readFileSync(path.join(DIR, 'in', `${name}.txt`), 'utf8'));
  const outFile = path.join(DIR, 'out', `${name}.txt`);
  if (!existsSync(outFile)) return { problems: [`no output file out/${name}.txt`], stats: {} };
  const { blocks, stray } = parseOutput(readFileSync(outFile, 'utf8'));
  const problems = [...stray];
  const cyr = /^(ru|uk)-/.test(name);
  const stats = { words: input.length, senses: 0, kept: 0, dropped: 0, newSentences: 0, combos: 0, newMeanings: 0 };
  const ids = new Set(input.map((w) => w.id));
  for (const id of blocks.keys()) if (!ids.has(id)) problems.push(`@${id}: not in the input`);
  for (const w of input) {
    const b = blocks.get(w.id);
    if (!b) {
      problems.push(`@${w.id}: missing block`);
      continue;
    }
    const p = (msg) => problems.push(`@${w.id}: ${msg}`);
    b.bad.forEach(p);
    if (!b.senses.length) p('no S lines');
    if (b.senses.length > 5) p(`${b.senses.length} meanings (at most 5)`);
    b.senses.forEach((s, k) => {
      if (!s.gloss) p(`S${k + 1} has no gloss`);
      if (cyr && CYRILLIC.test(quizText(s.gloss) + ' ' + (s.note ?? ''))) {
        p(`S${k + 1}: target-language text in the gloss or note; put it in a usage example "(<phrase> = <English>)" or leave it out`);
      }
      for (const f of s.from) if (f < 1 || f > w.senses) p(`S${k + 1} refers to input meaning ${f}, which does not exist`);
      if (s.isNew) stats.newMeanings++;
    });
    const covered = new Set();
    w.examples.forEach((text, k0) => {
      const k = k0 + 1;
      const e = b.e.get(k);
      if (!e) return p(`no E${k} line`);
      if ('drop' in e) {
        if (!REASONS.has(e.drop)) p(`E${k} x needs a reason: combination, other word, dropped meaning or bad`);
        stats.dropped++;
      } else if (e.sense < 1 || e.sense > b.senses.length) p(`E${k} refers to meaning ${e.sense}, which does not exist`);
      else {
        covered.add(e.sense);
        stats.kept++;
      }
    });
    for (const k of b.e.keys()) if (k < 1 || k > w.examples.length) p(`E${k}: the input has no sentence ${k}`);
    for (const [k] of b.t) {
      const e = b.e.get(k);
      if (!e || 'drop' in e) p(`T${k}: only a kept input sentence can get a corrected translation`);
    }
    for (const n of b.n) {
      if (n.sense < 1 || n.sense > b.senses.length) p(`N${n.sense} refers to a meaning that does not exist`);
      else covered.add(n.sense);
      if (!hasWord(n.text, n.form)) p(`N${n.sense}: the form {${n.form}} does not appear in the sentence as a word`);
      if (!n.translation) p(`N${n.sense}: no translation`);
      stats.newSentences++;
    }
    for (let s = 1; s <= b.senses.length; s++) if (!covered.has(s)) p(`meaning ${s} (${b.senses[s - 1].gloss}) has no sentence`);
    if (b.c.length > 3) p(`${b.c.length} combinations (at most 3)`);
    stats.senses += b.senses.length;
    stats.combos += b.c.length;
  }
  return { problems, stats };
}

if (process.argv[1] && process.argv[1].endsWith('check.mjs')) {
  const name = process.argv[2];
  if (!name) {
    console.log('Usage: node check.mjs <chunk>   e.g. es-01');
    process.exit(2);
  }
  const { problems, stats } = checkChunk(name);
  console.log(`${name}: ${JSON.stringify(stats)}`);
  console.log(`problems (${problems.length}):`);
  for (const x of problems.slice(0, 200)) console.log('  ' + x);
  if (problems.length > 200) console.log(`  … and ${problems.length - 200} more`);
  process.exit(problems.length ? 1 : 0);
}
