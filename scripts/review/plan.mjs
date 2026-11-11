// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Review plan: chunk list with status, kept in plan.json so work survives interruptions.
//   node plan.mjs init            write plan.json (top 1000 per language in 100s, the rest in 250s)
//   node plan.mjs status          summary
//   node plan.mjs set <name> <status> [agentId]
//   node plan.mjs next <n> [maxRank]   names of the next n chunks to run (todo), lowest ranks first, languages interleaved
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const FILE = '/home/claude/review/plan.json';
const LANGS = ['es', 'pt', 'vi', 'ru', 'uk', 'pl'];
const load = () => JSON.parse(readFileSync(FILE, 'utf8'));
const save = (p) => writeFileSync(FILE, JSON.stringify(p, null, 1));
const [cmd, ...args] = process.argv.slice(2);
const name = (l, a, b) => `${l}-${String(a).padStart(4, '0')}-${String(b).padStart(4, '0')}`;
if (cmd === 'init') {
  if (existsSync(FILE)) throw new Error('plan.json exists');
  const chunks = [];
  for (const l of LANGS) {
    for (let a = 1; a <= 1000; a += 100) chunks.push({ name: name(l, a, a + 99), lang: l, from: a, to: a + 99, status: 'todo' });
    for (let a = 1001; a <= 6000; a += 250) chunks.push({ name: name(l, a, a + 249), lang: l, from: a, to: a + 249, status: 'todo' });
  }
  for (const c of chunks) if (c.name === 'es-0401-0500' || c.name === 'ru-0001-0100') c.status = 'done';
  save({ chunks });
  console.log(chunks.length, 'chunks');
} else if (cmd === 'status') {
  const p = load();
  const by = {};
  for (const c of p.chunks) by[c.status] = (by[c.status] ?? 0) + 1;
  console.log(JSON.stringify(by));
  for (const c of p.chunks.filter((c) => c.status === 'running')) console.log('running', c.name, c.agent ?? '');
} else if (cmd === 'set') {
  const p = load();
  const c = p.chunks.find((x) => x.name === args[0]);
  if (!c) throw new Error('no chunk ' + args[0]);
  c.status = args[1];
  if (args[2]) c.agent = args[2];
  save(p);
} else if (cmd === 'next') {
  const p = load();
  const n = Number(args[0] ?? 4);
  const max = Number(args[1] ?? 1e9);
  const todo = p.chunks.filter((c) => c.status === 'todo' && c.from <= max).sort((a, b) => a.from - b.from || LANGS.indexOf(a.lang) - LANGS.indexOf(b.lang));
  const pick = todo.slice(0, n);
  for (const c of pick) execFileSync(process.execPath, ['/home/claude/review/slice.mjs', c.lang, String(c.from), String(c.to)]);
  console.log(pick.map((c) => c.name).join(' '));
}
