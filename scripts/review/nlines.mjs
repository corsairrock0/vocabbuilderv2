// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Second pass over the review's new sentences (N lines) and corrected translations (T lines), by a reviewer that did
// not write them.
//   node nlines.mjs export <lang> [perFile=400]   -> nreview/in/<lang>-NN.txt (only chunks that pass check.mjs)
//   node nlines.mjs apply <lang>                  <- nreview/out/<lang>-NN.txt, rewrites the N/T lines in out/*.txt
//
// Input line:  <key> | <word> | <meaning> | <sentence> | <translation> | {<form>}
//   key = <chunk>@<id>:N<k> (new sentence for meaning k) or <chunk>@<id>:T<k> (corrected translation of sentence k)
// Output line: <key> ok
//          or  <key> fix <sentence> | <translation> {<form>}     (N lines; T lines: <key> fix <translation>)
//          or  <key> drop <reason>                               (N lines only; the meaning then loses its sentence)
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { checkChunk, parseInput, parseOutput, hasWord } from './check.mjs';

const DIR = '/home/claude/review';
const [cmd, lang, per = '400'] = process.argv.slice(2);
const chunksOf = (l) => readdirSync(path.join(DIR, 'out')).filter((f) => f.startsWith(`${l}-`) && f.endsWith('.txt')).map((f) => f.slice(0, -4)).sort();

if (cmd === 'export') {
  const words = new Map(JSON.parse(readFileSync(path.join(DIR, 'data', `${lang}.json`), 'utf8')).map((w) => [w.id, w]));
  const lines = [];
  for (const name of chunksOf(lang)) {
    if (checkChunk(name).problems.length) continue;
    const { blocks } = parseOutput(readFileSync(path.join(DIR, 'out', `${name}.txt`), 'utf8'));
    for (const [id, b] of blocks) {
      const w = words.get(id);
      const word = w.display || w.lemma;
      b.n.forEach((n) => lines.push(`${name}@${id}:N${n.sense} | ${word} | ${b.senses[n.sense - 1]?.gloss} | ${n.text} | ${n.translation} | {${n.form}}`));
      for (const [k, tr] of b.t) {
        const e = b.e.get(k);
        lines.push(`${name}@${id}:T${k} | ${word} | ${b.senses[e.sense - 1]?.gloss} | ${w.examples[k - 1].text} | ${tr} | {${w.examples[k - 1].target ?? ''}}`);
      }
    }
  }
  mkdirSync(path.join(DIR, 'nreview', 'in'), { recursive: true });
  const n = Math.ceil(lines.length / Number(per));
  for (let i = 0; i < n; i++) {
    writeFileSync(path.join(DIR, 'nreview', 'in', `${lang}-${String(i + 1).padStart(2, '0')}.txt`), lines.slice(i * Number(per), (i + 1) * Number(per)).join('\n') + '\n');
  }
  console.log(`${lang}: ${lines.length} lines in ${n} files`);
} else if (cmd === 'apply') {
  const files = existsSync(path.join(DIR, 'nreview', 'out')) ? readdirSync(path.join(DIR, 'nreview', 'out')).filter((f) => f.startsWith(`${lang}-`)) : [];
  const fixes = new Map();
  for (const f of files) {
    for (const line of readFileSync(path.join(DIR, 'nreview', 'out', f), 'utf8').split('\n')) {
      const m = line.match(/^(\S+@\d+:[NT]\d+) (ok|fix|drop)\s*(.*)$/);
      if (m && m[2] !== 'ok') fixes.set(m[1], { kind: m[2], rest: m[3].trim() });
    }
  }
  let applied = 0;
  for (const name of chunksOf(lang)) {
    const file = path.join(DIR, 'out', `${name}.txt`);
    let id = null;
    const out = [];
    let nCount = new Map();
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (line.startsWith('@')) {
        id = Number(line.slice(1).trim().split(/\s/)[0]);
        nCount = new Map();
      }
      let m;
      if (id != null && (m = line.match(/^N(\d+) (.+?) \| (.+?) \{([^}]+)\}$/))) {
        const fx = fixes.get(`${name}@${id}:N${m[1]}`);
        if (fx?.kind === 'drop') {
          applied++;
          continue;
        }
        if (fx?.kind === 'fix') {
          const f = fx.rest.match(/^(.+?) \| (.+?) \{([^}]+)\}$/);
          if (f && hasWord(f[1], f[3])) {
            out.push(`N${m[1]} ${f[1].trim()} | ${f[2].trim()} {${f[3].trim()}}`);
            applied++;
            continue;
          }
          console.log(`${name}@${id}:N${m[1]}: fix not understood or form missing: ${fx.rest}`);
        }
      } else if (id != null && (m = line.match(/^T(\d+) (.+)$/))) {
        const fx = fixes.get(`${name}@${id}:T${m[1]}`);
        if (fx?.kind === 'fix' && fx.rest) {
          out.push(`T${m[1]} ${fx.rest}`);
          applied++;
          continue;
        }
      }
      out.push(line);
    }
    writeFileSync(file, out.join('\n'));
  }
  console.log(`${lang}: ${fixes.size} fixes read, ${applied} applied; run check.mjs on every chunk (a dropped sentence can leave a meaning without one)`);
} else {
  console.log('usage: node nlines.mjs export|apply <lang> [perFile]');
}
