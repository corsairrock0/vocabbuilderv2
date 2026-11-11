// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Third-party notices for VocabBuilder: the licence texts of the software and type shipped to the browser and the
// server, the code the review scheduler was ported from, and the licences of the word data.
//
// The web build writes them to /third-party-notices.txt (scripts/build-web.mjs). Run
//   node scripts/legal/notices.mjs --write
// to refresh THIRD_PARTY_NOTICES.md in the repository after changing dependencies.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Packages whose code ends up in the web bundle or runs on the server. */
const PACKAGES = ['react', 'react-dom', 'scheduler', '@tanstack/react-virtual', '@tanstack/virtual-core', 'react-icons', 'tailwindcss', 'clsx', 'tailwind-merge', 'class-variance-authority', 'zod'];

const PY_FSRS_COPYRIGHT = 'Copyright (c) 2022 Open Spaced Repetition';
/** The interface components (web/src/components/ui/) follow shadcn/ui's: their names, parts and styles. */
const SHADCN_COPYRIGHT = 'Copyright (c) 2023 shadcn';

/** Data sources and their licences (docs/FREQUENCY_SETS.md has the detail; the app shows the same list at /notices). */
const DATA = [
  ['English Wiktionary via Kaikki.org / Wiktextract', 'CC BY-SA 4.0 and GFDL', 'Word meanings, adapted. Credit: Wiktionary contributors; Tatu Ylonen, Wiktextract (LREC 2022).'],
  ['dmklinger/ukrainian', 'CC BY-SA 3.0', 'Fallback Ukrainian meanings and tables.'],
  ['Tatoeba (Vuizur/tatoeba-to-anki, Tatoeba Translation Challenge)', 'CC BY 2.0 FR', 'Example sentences and translations. Credit: Tatoeba contributors; each sentence source is in data/frequency/<lang>-sentence-credits.tsv.'],
  ['Universal Dependencies treebanks', 'AnCora CC BY 4.0; Porttinari, VTB, Taiga, GSD, PUD CC BY-SA 4.0; LFG GPL-3.0; PDB, SynTagRus, IU CC BY-NC-SA 4.0', 'Example sentences; forms.'],
  ['wordfreq data', 'CC BY-SA 4.0', 'Polish, Russian and Ukrainian frequencies. Credit: Robyn Speer; SUBTLEX; OpenSubtitles.'],
  ['FrequencyWords (hermitdave)', 'CC BY-SA 4.0 (content)', 'Portuguese and Spanish frequencies from OpenSubtitles (OPUS, Lison & Tiedemann 2016).'],
  ['doozan/spanish_data', 'CC BY-SA; Tatoeba sentences CC BY 2.0 FR', 'Spanish frequencies and data.'],
  ['tabidots/vn-freqs', 'no licence stated', 'Vietnamese frequencies.'],
  ['UniMorph (Spanish, Portuguese, Ukrainian)', 'CC BY-SA 3.0', 'Word tables.'],
  ['verbecc (from Verbiste)', 'GPL-2.0-or-later', 'Spanish and Portuguese conjugation tables, partly derived from its data files.'],
  ['OpenRussian (Badestrand/russian-dictionary)', 'CC BY-SA 4.0', 'Russian word tables.'],
  ['PoliMorf / Morfologik', 'BSD 2-Clause', 'Polish word tables.'],
  ['michmech lemmatization lists', 'ODbL 1.0', 'Matching forms to dictionary forms.'],
  ['Forvo', "Forvo's terms", 'Pronunciations are played from Forvo when a key is configured and are not stored.'],
];

function read(file) {
  return readFileSync(file, 'utf8').replace(/\r\n/g, '\n').trim();
}

function pkgInfo(name) {
  const dir = path.join(root, 'node_modules', name);
  const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const file = ['LICENSE', 'LICENSE.md', 'license', 'license.md'].map((f) => path.join(dir, f)).find((f) => existsSync(f));
  if (!file) throw new Error(`${name}: no licence file in node_modules`);
  return { name, version: pkg.version, license: pkg.license ?? 'see licence text', text: read(file) };
}

/** The MIT licence body (everything after the copyright line), taken from a shipped MIT package. */
function mitBody() {
  const text = read(path.join(root, 'node_modules', 'react', 'LICENSE'));
  return text.slice(text.indexOf('Permission is hereby granted'));
}

export function thirdPartyNotices() {
  const out = [];
  const rule = '-'.repeat(78);
  out.push('VocabBuilder by Lango: third-party notices');
  out.push('');
  out.push('VocabBuilder is © 2026 Lango. All rights reserved (see LICENSE and the Terms of Service at /terms).');
  out.push('It includes the third-party software, type and data below, which remain under their own licences.');
  out.push('Nothing in Lango\'s licence or terms restricts the rights these licences grant.');
  out.push('');
  out.push(rule);
  out.push('SOFTWARE');
  out.push(rule);
  for (const p of PACKAGES.map(pkgInfo)) {
    out.push('');
    out.push(`${p.name} ${p.version} (${p.license})`);
    out.push('');
    out.push(p.text);
  }
  out.push('');
  out.push('Lucide icons (through react-icons), ISC License: https://github.com/lucide-icons/lucide/blob/main/LICENSE');
  out.push('');
  out.push(`shadcn/ui (MIT). VocabBuilder's interface components (web/src/components/ui/) follow its components: their`);
  out.push('names, parts and styles, written again on native browser features.');
  out.push('https://ui.shadcn.com');
  out.push('');
  out.push('MIT License');
  out.push('');
  out.push(SHADCN_COPYRIGHT);
  out.push('');
  out.push(mitBody());
  out.push('');
  out.push(`py-fsrs 6.3.0 (MIT). VocabBuilder's review scheduler (shared/fsrs.ts) is a TypeScript port of it.`);
  out.push('https://github.com/open-spaced-repetition/py-fsrs');
  out.push('');
  out.push('MIT License');
  out.push('');
  out.push(PY_FSRS_COPYRIGHT);
  out.push('');
  out.push(mitBody());
  out.push('');
  out.push("FSRS Optimizer and fsrs-rs, by Open Spaced Repetition (BSD 3-Clause License). The fit of the memory model to a");
  out.push("learner's reviews (shared/fsrs-optimizer.ts) follows their method and uses their figures for how far each");
  out.push('parameter usually varies. It was written for this app and contains none of their code.');
  out.push('https://github.com/open-spaced-repetition/fsrs-optimizer');
  out.push('https://github.com/open-spaced-repetition/fsrs-rs');
  out.push('');
  out.push(rule);
  out.push('TYPE');
  out.push(rule);
  out.push('');
  out.push('Lora (web/public/fonts/vb-serif.woff), SIL Open Font License 1.1');
  out.push('');
  out.push(read(path.join(root, 'web', 'public', 'fonts', 'OFL.txt')));
  out.push('');
  out.push(rule);
  out.push('DATA');
  out.push(rule);
  out.push('');
  for (const [name, licence, what] of DATA) out.push(`* ${name}: ${licence}. ${what}`);
  out.push('');
  out.push('Licence texts: CC BY-SA 4.0 https://creativecommons.org/licenses/by-sa/4.0/legalcode ;');
  out.push('CC BY-SA 3.0 https://creativecommons.org/licenses/by-sa/3.0/legalcode ; CC BY 2.0 FR');
  out.push('https://creativecommons.org/licenses/by/2.0/fr/legalcode ; CC BY-NC-SA 4.0');
  out.push('https://creativecommons.org/licenses/by-nc-sa/4.0/legalcode ; GPL https://www.gnu.org/licenses/ ;');
  out.push('ODbL 1.0 https://opendatacommons.org/licenses/odbl/1-0/ ; BSD 2-Clause https://opensource.org/license/bsd-2-clause');
  out.push('');
  out.push('The Docker image also contains Node.js (MIT), SQLite (public domain) and Caddy (Apache 2.0), with their');
  out.push('licence files as their own images ship them.');
  return out.join('\n') + '\n';
}

if (process.argv.includes('--write')) {
  const md = '# Third-party notices\n\n```text\n' + thirdPartyNotices() + '```\n';
  writeFileSync(path.join(root, 'THIRD_PARTY_NOTICES.md'), md);
  console.log('wrote THIRD_PARTY_NOTICES.md');
}
