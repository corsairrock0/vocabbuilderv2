#!/usr/bin/env node
// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Download the Tatoeba sentence decks used for cloze sentences (Vuizur/tatoeba-to-anki release "latest").
//
//   node scripts/freq/fetch-tatoeba-decks.mjs <sources-dir>
//
// Each deck is an Anki package (a zip) that is mostly audio; only its collection database holds the sentences.
// HTTP range requests read the zip's central directory from the end of the file and then download that one
// entry, so about 25–140 MB per language arrive instead of the whole package. Needs curl.
// The release is updated in place, so each database is checked against the SHA-256 the shipped sets were
// built from; a different file still works, but the sentences chosen will differ.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';

const BASE = 'https://github.com/Vuizur/tatoeba-to-anki/releases/download/latest';
const DECKS = {
  es: { file: 'spa_eng.apkg', sha256: '98280d9a19a38c230cbf20c2fd0d7a0d801f89db091892e99073751d26e3b0aa' },
  pt: { file: 'por_eng.apkg', sha256: '95fba7f4d10c453a6ad86084c8cb10a9bf15ff95c8a04cc5429191254993518f' },
  pl: { file: 'pol_eng.apkg', sha256: 'f6d5d81161b296a549d3bc11fb38a61570cbc2ebd9977d26efa64a6dad6516ac' },
  ru: { file: 'rus_eng.apkg', sha256: '77be8a79e901e39a62021e6c7fa09ca509e3ac901a1022db24e5fd30360177fa' },
  uk: { file: 'ukr_eng.apkg', sha256: '0b0f7fbc0f2f9ff39b28146bf70d9bf89fa955a558a5acc8b4b25fc0218cfa9d' },
  vi: { file: 'vie_eng.apkg', sha256: 'ee02d2a6246cd1bc8bda83ad5fb91e59d8c3d841567f72243c2159e20704bcea' },
};

const curl = (args) => execFileSync('curl', ['-sS', '-L', '--fail', '--max-time', '900', ...args], { maxBuffer: 1 << 30 });
const range = (url, start, end) => curl(['-r', `${start}-${end}`, url]);

function size(url) {
  const head = curl(['-r', '0-0', '-D', '-', '-o', '/dev/null', url]).toString('latin1');
  const m = /content-range:\s*bytes \d+-\d+\/(\d+)/i.exec(head);
  if (!m) throw new Error(`${url}: the server does not support range requests`);
  return Number(m[1]);
}

function collection(url) {
  const total = size(url);
  const tailLen = Math.min(total, 1 << 20);
  const tail = range(url, total - tailLen, total - 1);
  const eocd = tail.lastIndexOf(Buffer.from('PK\x05\x06', 'latin1'));
  if (eocd < 0) throw new Error(`${url}: end of central directory not found`);
  const entries = tail.readUInt16LE(eocd + 10);
  const cdSize = tail.readUInt32LE(eocd + 12);
  const cdOffset = tail.readUInt32LE(eocd + 16);
  if (cdOffset === 0xffffffff || entries === 0xffff) throw new Error(`${url}: zip64 archives are not supported`);
  const cd = range(url, cdOffset, cdOffset + cdSize - 1);
  const found = new Map();
  for (let p = 0; p + 46 <= cd.length && cd.readUInt32LE(p) === 0x02014b50; ) {
    const method = cd.readUInt16LE(p + 10);
    const csize = cd.readUInt32LE(p + 20);
    const nlen = cd.readUInt16LE(p + 28);
    const xlen = cd.readUInt16LE(p + 30);
    const clen = cd.readUInt16LE(p + 32);
    const local = cd.readUInt32LE(p + 42);
    found.set(cd.toString('utf8', p + 46, p + 46 + nlen), { method, csize, local });
    p += 46 + nlen + xlen + clen;
  }
  const name = ['collection.anki21', 'collection.anki2'].find((n) => found.has(n));
  if (!name) throw new Error(`${url}: no SQLite collection in the package (${[...found.keys()].filter((n) => n.startsWith('collection')).join(', ')})`);
  const e = found.get(name);
  const header = range(url, e.local, e.local + 29);
  const start = e.local + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
  const data = range(url, start, start + e.csize - 1);
  if (e.method === 8) return inflateRawSync(data);
  if (e.method === 0) return data;
  throw new Error(`${url}: unsupported compression method ${e.method}`);
}

const dest = process.argv[2];
if (!dest) {
  process.stderr.write('usage: fetch-tatoeba-decks.mjs <sources-dir>\n');
  process.exit(2);
}
const dir = path.join(dest, 'tatoeba-decks');
mkdirSync(dir, { recursive: true });
for (const [lang, d] of Object.entries(DECKS)) {
  const db = collection(`${BASE}/${d.file}`);
  const sha = createHash('sha256').update(db).digest('hex');
  writeFileSync(path.join(dir, `${lang}.sqlite`), db);
  const note = sha === d.sha256 ? 'same file the shipped sets used' : `CHANGED since the shipped sets were built (sha256 ${sha})`;
  process.stdout.write(`  ${d.file}: ${(db.length / 1e6).toFixed(1)} MB, ${note}\n`);
}
