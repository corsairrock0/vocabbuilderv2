// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Cut a review chunk: node slice.mjs <lang> <fromId> <toId>   -> in/<lang>-<from>-<to>.txt (ids inclusive)
import { readFileSync, writeFileSync } from 'node:fs';
const [lang, a, b] = process.argv.slice(2);
const from = Number(a), to = Number(b);
const blocks = readFileSync(`/home/claude/review/in/${lang}.all.txt`, 'utf8').split('\n\n').filter((x) => x.startsWith('@'));
const pick = blocks.filter((x) => { const id = Number(x.slice(1).split(' ')[0]); return id >= from && id <= to; });
const name = `${lang}-${String(from).padStart(4, '0')}-${String(to).padStart(4, '0')}`;
writeFileSync(`/home/claude/review/in/${name}.txt`, pick.join('\n\n') + '\n');
console.log(name, pick.length, 'words', Buffer.byteLength(pick.join('\n\n')), 'bytes');
