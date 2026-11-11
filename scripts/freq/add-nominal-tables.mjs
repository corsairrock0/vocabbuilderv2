// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Give sets built before 1.8.5 the gender and number tables of their Spanish and Portuguese nouns, adjectives,
// determiners and pronouns, and clean every language's forms lists, exactly as build.mjs now does (after the
// sentences and the verb tables, so nothing else changes):
//
//   node scripts/freq/add-nominal-tables.mjs --sources <dir> --dir <folder with <lang>.json> [--lang es,pt,vi,ru,uk,pl]
//        [--reports data/frequency/reports]
//
// Rewrites <dir>/<lang>.json in place. With --reports, puts the "Gender and number tables" (es, pt) and "Forms lists"
// sections into each report after its "Conjugation tables" section, or after "Cloze sentences" when it has none (older
// sections of those names are replaced). Run it on the sets built with --no-review that apply-review.mjs starts from,
// then run apply-review.mjs.
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { attachNominalTables, nominalReport, polishFormsOf } from './paradigms/romance-nominal.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback = null) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const sources = opt('--sources');
const dir = opt('--dir');
if (!sources || !dir) {
  process.stderr.write('usage: node scripts/freq/add-nominal-tables.mjs --sources <dir> --dir <folder> [--lang es,pt,vi,ru,uk,pl] [--reports <folder>]\n');
  process.exit(2);
}
const reports = opt('--reports');
const write = (file, text) => {
  writeFileSync(`${file}.tmp`, text);
  renameSync(`${file}.tmp`, file);
};

for (const lang of opt('--lang', 'es,pt,vi,ru,uk,pl').split(',')) {
  const file = path.join(dir, `${lang}.json`);
  const doc = JSON.parse(readFileSync(file, 'utf8'));
  const formsOf = lang === 'pl' ? polishFormsOf((p) => path.join(sources, p), doc.entries.map((e) => e.lemma), existsSync) : null;
  if (lang === 'pl' && !formsOf) throw new Error('the Morfologik dictionary is not under --sources');
  const stats = attachNominalTables(lang, doc.entries, { formsOf });
  write(file, JSON.stringify(doc));
  console.log(`${lang}: gender and number tables ${stats.tables}; forms left out ${stats.formsDropped} ${JSON.stringify(stats.droppedBy)}`);
  if (reports) {
    const reportFile = path.join(reports, `${lang}.md`);
    if (!existsSync(reportFile)) continue;
    const section = nominalReport(lang, stats).join('\n');
    let text = readFileSync(reportFile, 'utf8')
      .replace(/\n## Gender and number tables\n[\s\S]*?(?=\n## |$)/, '')
      .replace(/\n## Forms lists\n[\s\S]*?(?=\n## |$)/, '');
    const anchor = text.includes('\n## Conjugation tables\n') ? '\n## Conjugation tables\n' : '\n## Cloze sentences\n';
    const at = text.indexOf(anchor);
    if (at < 0) text = `${text.replace(/\s*$/, '\n\n')}${section}`;
    else {
      const next = text.indexOf('\n## ', at + 1);
      text = next < 0 ? `${text.replace(/\s*$/, '\n\n')}${section}` : `${text.slice(0, next + 1)}${section}\n${text.slice(next + 1)}`;
    }
    write(reportFile, text);
  }
}
