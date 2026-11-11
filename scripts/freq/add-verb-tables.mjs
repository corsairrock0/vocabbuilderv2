// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Give sets built before 1.8.4 the conjugation tables of their Russian, Ukrainian and Polish verbs, exactly as
// build.mjs now attaches them (after the sentences are chosen, so nothing else changes):
//
//   node scripts/freq/add-verb-tables.mjs --sources <dir> --dir <folder with <lang>.json> [--lang ru,uk,pl]
//        [--ranks data/frequency/ranks] [--reports data/frequency/reports]
//
// Rewrites <dir>/<lang>.json in place. With --reports, puts the "Conjugation tables" section into each report after
// its "Cloze sentences" section, where a build puts it (an older section of that name is replaced). Run it on the
// sets built with --no-review that apply-review.mjs starts from, then run apply-review.mjs.
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { attachVerbTables, verbTableReport } from './paradigms/verbs.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback = null) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const sources = opt('--sources');
const dir = opt('--dir');
if (!sources || !dir) {
  process.stderr.write('usage: node scripts/freq/add-verb-tables.mjs --sources <dir> --dir <folder> [--lang ru,uk,pl] [--ranks <folder>] [--reports <folder>]\n');
  process.exit(2);
}
const ranksDir = opt('--ranks', path.join(path.dirname(new URL(import.meta.url).pathname), '../../data/frequency/ranks'));
const reports = opt('--reports');
const write = (file, text) => {
  writeFileSync(`${file}.tmp`, text);
  renameSync(`${file}.tmp`, file);
};

for (const lang of opt('--lang', 'ru,uk,pl').split(',')) {
  const file = path.join(dir, `${lang}.json`);
  const doc = JSON.parse(readFileSync(file, 'utf8'));
  const ranksFile = path.join(ranksDir, `${lang}.json.gz`);
  const ranks = existsSync(ranksFile) ? JSON.parse(gunzipSync(readFileSync(ranksFile)).toString('utf8')) : null;
  const stats = await attachVerbTables(lang, doc.entries, (p) => path.join(sources, p), ranks);
  write(file, JSON.stringify(doc));
  console.log(`${lang}: verb tables ${stats.withTable} of ${stats.wanted}; without: ${stats.missing.map((m) => m.lemma).join(', ') || 'none'}${stats.formsDropped ? `; forms dropped ${stats.formsDropped}` : ''}`);
  if (reports) {
    const reportFile = path.join(reports, `${lang}.md`);
    if (!existsSync(reportFile)) continue;
    const section = verbTableReport(lang, stats).join('\n');
    let text = readFileSync(reportFile, 'utf8').replace(/\n## Conjugation tables\n[\s\S]*?(?=\n## |$)/, '');
    const at = text.indexOf('\n## Cloze sentences\n');
    if (at < 0) text = `${text.replace(/\s*$/, '\n\n')}${section}`;
    else {
      const next = text.indexOf('\n## ', at + 1);
      text = next < 0 ? `${text.replace(/\s*$/, '\n\n')}${section}` : `${text.slice(0, next + 1)}${section}\n${text.slice(next + 1)}`;
    }
    write(reportFile, text);
  }
}
