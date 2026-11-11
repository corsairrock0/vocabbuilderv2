// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Builds data/grammar/<lang>.json, the exact cells of example sentences that grammar explanations name
// (shared/grammar.ts), from the annotations in data/grammar/src/<lang>.jsonl, one JSON object per line:
//   {"lemma": "український", "target": "українське", "sentence": "У нього українське громадянство.", "cell": "nom|n",
//    "why": "it describes “громадянство” (citizenship), …"}
// See data/grammar/README.md.
//
//   node scripts/grammar/build.mjs                  check every record against data/frequency/<lang>.json and write
//   node scripts/grammar/build.mjs --import <dir>   first copy <dir>/<lang>.jsonl into data/grammar/src/ (a file of
//                                                   the same name is replaced), then check and write
//
// A record is kept when its lemma has a table in the frequency set (or a built-in one: paradigmFor), the table has the
// cell, the cell holds the target (for a negative imperative, no/não + the target) and `why` is not empty. Any other
// record is reported and dropped; the rest are written. A record whose sentence is not one of the word's example
// sentences in the set is kept but counted as unmatched: the app only meets a sentence written that way. When the same
// sentence and target come twice, the later line wins. The output depends only on data/grammar/src/ and
// data/frequency/, and the same input always gives the same bytes.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exactCellOf, exactKey, NO_NOTE, paradigmFor } from '../../shared/grammar.ts';
import { matchKey, stripStress } from '../../shared/text.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const OUT_DIR = path.join(root, 'data', 'grammar');
export const SRC_DIR = path.join(OUT_DIR, 'src');
export const FREQ_DIR = path.join(root, 'data', 'frequency');
/** The languages with tables: cases in Ukrainian, Russian and Polish, verbs in Spanish and Portuguese. */
export const LANGS = ['uk', 'ru', 'pl', 'es', 'pt'];
export const FORMAT = 'vocabbuilder-grammar-v1';
export const CREDIT = 'Cells and reasons annotated by AI (Claude) for Lango, not checked by a native speaker; the sentences are those of the frequency sets';

const filled = (s) => typeof s === 'string' && s.trim() !== '';
const clean = (s) => s.normalize('NFC').replace(/\s+/g, ' ').trim();

/** What the checks need from a frequency set: the tables of each lemma, and the key of every example sentence. */
export function frequencyIndex(lang, doc) {
  const tables = new Map();
  const examples = new Set();
  for (const e of doc?.entries ?? []) {
    if (!filled(e?.lemma)) continue;
    const k = matchKey(e.lemma, lang);
    if (!tables.has(k)) tables.set(k, []);
    tables.get(k).push(e.paradigm ?? null);
    for (const x of e.examples ?? []) if (filled(x?.text) && filled(x?.target)) examples.add(exactKey(lang, e.lemma, x.target, x.text));
  }
  return { lang, tables, examples };
}

/** Why a record can't be used, or null when it can. */
export function checkRecord(rec, index) {
  const lang = index.lang;
  if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return 'not a JSON object';
  for (const k of ['lemma', 'target', 'sentence', 'cell']) if (!filled(rec[k])) return `${k} is missing`;
  if (!filled(rec.why)) return 'why is missing or empty';
  const entries = index.tables.get(matchKey(rec.lemma, lang));
  // A lemma without a table of its own may have a built-in one (Ukrainian що, Russian что).
  const tables = (entries ?? [null]).map((p) => paradigmFor(lang, rec.lemma, p)).filter(Boolean);
  if (!tables.length) return entries ? `“${rec.lemma}” has no table` : `“${rec.lemma}” is not a word of data/frequency/${lang}.json`;
  const cell = rec.cell.trim();
  // NO_NOTE: the sentence gets no grammar note (its word only looks like a form of this one); `why` says why.
  if (cell === NO_NOTE) return null;
  if (tables.every((p) => p.indeclinable)) return `“${rec.lemma}” is indeclinable`;
  if (tables.some((p) => exactCellOf(lang, p, rec.lemma, rec.target, { cell }))) return null;
  const withCell = tables.filter((p) => !p.indeclinable && Object.prototype.hasOwnProperty.call(p.cells, cell));
  if (!withCell.length) return `the table of “${rec.lemma}” has no cell ${cell}`;
  const forms = [...new Set(withCell.flatMap((p) => p.cells[cell] ?? []).map((f) => stripStress(f)))];
  if (forms.some((f) => matchKey(f, lang) === matchKey(rec.target, lang))) return `cell ${cell} is not one the explanations name`;
  return `cell ${cell} of “${rec.lemma}” holds “${forms.join(', ')}”, not “${rec.target}”`;
}

/**
 * Read one language's records: the usable ones by key (the later line wins), the problems of the others, warnings
 * (a later line that changes an earlier one), and how many records were read, replaced and left unmatched.
 */
export function readRecords(lang, text, index, name = `${lang}.jsonl`) {
  const cells = new Map();
  const problems = [];
  const warnings = [];
  let records = 0;
  let replaced = 0;
  text.split('\n').forEach((line, i) => {
    if (!line.trim()) return;
    records++;
    const at = `${name} line ${i + 1}`;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch (e) {
      problems.push(`${at}: not valid JSON (${e.message})`);
      return;
    }
    const bad = checkRecord(rec, index);
    if (bad) {
      problems.push(`${at}${filled(rec?.target) ? ` (${rec.target})` : ''}: ${bad}`);
      return;
    }
    const key = exactKey(lang, rec.lemma, rec.target, rec.sentence);
    const value = { cell: rec.cell.trim(), why: clean(rec.why), line: i + 1 };
    const prev = cells.get(key);
    if (prev) {
      replaced++;
      if (prev.cell !== value.cell || prev.why !== value.why) {
        warnings.push(`${at} replaces line ${prev.line} for “${rec.target}” in “${clean(rec.sentence)}”${prev.cell !== value.cell ? ` (${prev.cell} → ${value.cell})` : ''}`);
      }
    }
    cells.set(key, value);
  });
  const unmatched = [...cells.keys()].filter((k) => !index.examples.has(k)).length;
  return { cells: new Map([...cells].map(([k, v]) => [k, [v.cell, v.why]])), records, replaced, unmatched, problems, warnings };
}

/** The file for one language: one entry per line, keys sorted, so the same records give the same bytes. */
export function languageFile(lang, cells) {
  const keys = [...cells.keys()].sort();
  const body = keys.map((k) => `${JSON.stringify(k)}:${JSON.stringify(cells.get(k))}`);
  const version = createHash('sha256').update(body.join('\n')).digest('hex').slice(0, 12);
  const head = JSON.stringify({ format: FORMAT, language: lang, version, credit: CREDIT, count: keys.length });
  return `${head.slice(0, -1)},"cells":{\n${body.join(',\n')}\n}}\n`;
}

/** Copy <dir>/<lang>.jsonl into the source folder; returns the files copied. */
export function importAnnotations(dir, srcDir = SRC_DIR) {
  const files = LANGS.map((l) => `${l}.jsonl`).filter((f) => existsSync(path.join(dir, f)));
  mkdirSync(srcDir, { recursive: true });
  for (const f of files) copyFileSync(path.join(dir, f), path.join(srcDir, f));
  return files;
}

/**
 * Check and write every language that has a source file. Returns one summary per language: records read, kept,
 * dropped, replaced and unmatched, the problems and warnings, and whether a file was written.
 */
export function build({ srcDir = SRC_DIR, freqDir = FREQ_DIR, outDir = OUT_DIR, langs = LANGS } = {}) {
  const out = [];
  for (const lang of langs) {
    const src = path.join(srcDir, `${lang}.jsonl`);
    if (!existsSync(src)) {
      out.push({ lang, source: false, written: false, records: 0, kept: 0, dropped: 0, replaced: 0, unmatched: 0, problems: [], warnings: [] });
      continue;
    }
    const freq = path.join(freqDir, `${lang}.json`);
    if (!existsSync(freq)) {
      out.push({ lang, source: true, written: false, records: 0, kept: 0, dropped: 0, replaced: 0, unmatched: 0, problems: [`data/frequency/${lang}.json is missing: nothing to check ${lang}.jsonl against, so nothing was written`], warnings: [] });
      continue;
    }
    const index = frequencyIndex(lang, JSON.parse(readFileSync(freq, 'utf8')));
    const r = readRecords(lang, readFileSync(src, 'utf8'), index);
    mkdirSync(outDir, { recursive: true });
    writeFileSync(path.join(outDir, `${lang}.json`), languageFile(lang, r.cells));
    out.push({ lang, source: true, written: true, records: r.records, kept: r.cells.size, dropped: r.problems.length, replaced: r.replaced, unmatched: r.unmatched, problems: r.problems, warnings: r.warnings });
  }
  return out;
}

function main(argv) {
  const at = argv.indexOf('--import');
  if (at >= 0) {
    const dir = argv[at + 1];
    if (!dir || !existsSync(dir)) {
      console.error('usage: node scripts/grammar/build.mjs [--import <folder with uk.jsonl, ru.jsonl, pl.jsonl, es.jsonl, pt.jsonl>]');
      return 2;
    }
    const copied = importAnnotations(path.resolve(dir));
    const others = readdirSync(dir).filter((f) => f.endsWith('.jsonl') && !copied.includes(f));
    console.log(`imported ${copied.length ? copied.join(', ') : 'nothing'} from ${dir}`);
    if (others.length) console.log(`ignored (not <lang>.jsonl for ${LANGS.join(', ')}): ${others.join(', ')}`);
  }
  const results = build();
  for (const r of results) {
    for (const w of r.warnings) console.log(`warning: ${w}`);
    for (const p of r.problems) console.log(`dropped: ${p}`);
  }
  const columns = ['records', 'kept', 'dropped', 'replaced', 'unmatched'];
  const width = (h) => Math.max(h.length, 6);
  console.log(`lang  ${columns.map((h) => h.padStart(width(h))).join('  ')}`);
  for (const r of results) {
    if (!r.source) console.log(`${r.lang.padEnd(4)}  no data/grammar/src/${r.lang}.jsonl: nothing written`);
    else if (!r.written) console.log(`${r.lang.padEnd(4)}  no data/frequency/${r.lang}.json: nothing written`);
    else console.log(`${r.lang.padEnd(4)}  ${columns.map((h) => String(r[h]).padStart(width(h))).join('  ')}`);
  }
  return results.some((r) => r.source && !r.written) ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
