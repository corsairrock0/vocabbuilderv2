// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Builds data/reading/<lang>.json, the passages of the Reading comprehension practice, from the reviewed batches in
// data/reading/src/ (JSON Lines, one batch per file). See data/reading/README.md. Two kinds of passage:
//   long   <lang>-<level>-<batch>.jsonl, ids like es-B1-1-07: about 150 words, a genre, four questions
//   short  <lang>-<level>-S<batch>.jsonl, ids like es-B1-S1-07: about 75 words of everyday life, a format, a step
//          (1–40, easiest first within the level) and three questions
//
//   node scripts/reading/build.mjs                  check every passage in data/reading/src/ and write the files
//   node scripts/reading/build.mjs --import <dir>   first copy <dir>/*.jsonl into data/reading/src/ (a file of the
//                                                   same name is replaced), then check and write
//
// Re-runnable as batches arrive: the output depends only on data/reading/src/, and the same batches give the same
// bytes. When any passage has a problem, every problem is listed and nothing is written.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const OUT_DIR = path.join(root, 'data', 'reading');
export const SRC_DIR = path.join(OUT_DIR, 'src');
export const LANGS = ['es', 'pt', 'vi', 'ru', 'uk', 'pl'];
export const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1'];
export const GENRES = ['literature', 'history', 'humanities', 'science'];
export const FORMATS = ['story', 'dialogue', 'message', 'email', 'notice', 'diary', 'instructions', 'advert', 'description'];
export const KINDS = ['long', 'short'];
export const QUESTIONS = { long: 4, short: 3 };
export const FORMAT = 'vocabbuilder-reading-v1';
export const COPYRIGHT = '© 2026 Lango. All rights reserved.';
export const CREDIT = 'AI-written passages (Claude), each checked by a second AI review';

const clean = (s) => s.normalize('NFC').replace(/\r\n?/g, '\n').trim();
const same = (s) => clean(s).toLowerCase().replace(/\s+/g, ' ');
const filled = (s) => typeof s === 'string' && s.trim() !== '';
/** Natural id order, so batch 10 sorts after batch 9. */
export const byId = (a, b) => a.id.localeCompare(b.id, 'en', { numeric: true });
/** A short passage's id carries its batch as S<n>. */
export const kindOfId = (id) => (/-S\d+-\d+$/.test(id) ? 'short' : 'long');

/** The serving order: by level, then kind (long first); long passages by id, short ones by step, then id. */
export function passageOrder(a, b) {
  return LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level) || KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) || (a.kind === 'short' ? a.step - b.step : 0) || byId(a, b);
}

/** What a batch file is for, from its name ("es-A1-1.jsonl", "es-A1-S1.jsonl"); null where the name doesn't say. */
export function fileTarget(file) {
  const [lang, level, batch] = path.basename(file, '.jsonl').split('-');
  return {
    lang: LANGS.includes(lang) ? lang : null,
    level: LEVELS.includes(level) ? level : null,
    kind: /^S\d+$/.test(batch ?? '') ? 'short' : /^\d+$/.test(batch ?? '') ? 'long' : null,
  };
}

/** The problems of one passage (an empty list when it is fine). */
export function checkPassage(p, target) {
  const out = [];
  if (!p || typeof p !== 'object' || Array.isArray(p)) return ['not a JSON object'];
  const validId = filled(p.id) && /^[a-z]{2}-(A1|A2|B1|B2|C1)-S?\d+-\d+$/.test(p.id);
  if (!validId) out.push('id must look like es-B1-1-07 (long) or es-B1-S1-07 (short)');
  const kind = validId ? kindOfId(p.id) : target.kind;
  if (validId && target.kind && kind !== target.kind) out.push(`a ${kind} passage in a file of ${target.kind} passages`);
  if (!LANGS.includes(p.lang)) out.push(`unknown lang ${JSON.stringify(p.lang)}`);
  else if (target.lang && p.lang !== target.lang) out.push(`lang ${p.lang} in a ${target.lang} file`);
  if (!LEVELS.includes(p.level)) out.push(`level must be one of ${LEVELS.join(', ')}`);
  else if (target.level && p.level !== target.level) out.push(`level ${p.level} in a ${target.level} file`);
  if (validId && LANGS.includes(p.lang) && LEVELS.includes(p.level) && !p.id.startsWith(`${p.lang}-${p.level}-`)) out.push('id does not match lang and level');
  if (kind === 'short') {
    if (p.genre !== 'everyday') out.push('genre must be "everyday" for a short passage');
    if (!FORMATS.includes(p.format)) out.push(`format must be one of ${FORMATS.join(', ')}`);
    if (!Number.isInteger(p.step) || p.step < 1 || p.step > 40) out.push('step must be a whole number from 1 to 40');
  } else if (!GENRES.includes(p.genre)) out.push(`genre must be one of ${GENRES.join(', ')}`);
  for (const k of ['topic', 'title', 'titleEn', 'text', 'translation']) if (!filled(p[k])) out.push(`${k} is missing`);
  const wanted = QUESTIONS[kind] ?? 4;
  if (!Array.isArray(p.questions) || p.questions.length !== wanted) {
    out.push(`needs exactly ${wanted} questions`);
    return out;
  }
  p.questions.forEach((q, i) => {
    const at = `question ${i + 1}`;
    if (!q || typeof q !== 'object') return out.push(`${at}: not an object`);
    if (!filled(q.q)) out.push(`${at}: no question text`);
    if (!Array.isArray(q.options) || q.options.length !== 4 || !q.options.every(filled)) out.push(`${at}: needs 4 options, none empty`);
    else if (new Set(q.options.map(same)).size !== 4) out.push(`${at}: two options are the same`);
    if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer > 3) out.push(`${at}: answer must be 0–3`);
    if (!filled(q.explain)) out.push(`${at}: no explanation`);
  });
  return out;
}

/** The passage as the app stores it: known fields only, its kind, text in NFC, no `lang` (the file says it). */
export function storedPassage(p) {
  const kind = kindOfId(p.id);
  return {
    id: p.id,
    kind,
    level: p.level,
    genre: p.genre,
    ...(kind === 'short' ? { format: p.format, step: p.step } : {}),
    topic: clean(p.topic),
    title: clean(p.title),
    titleEn: clean(p.titleEn),
    text: clean(p.text),
    translation: clean(p.translation),
    questions: p.questions.map((q) => ({ q: clean(q.q), options: q.options.map(clean), answer: q.answer, explain: clean(q.explain) })),
  };
}

/** Read and check every batch file; returns the passages per language, the problems found and warnings. */
export function readBatches(files) {
  const byLang = new Map(LANGS.map((l) => [l, []]));
  const problems = [];
  const warnings = [];
  const seen = new Map();
  for (const file of files) {
    const name = path.basename(file);
    const target = fileTarget(file);
    if (!target.lang) {
      problems.push(`${name}: the file name must start with a language code (${LANGS.join(', ')})`);
      continue;
    }
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        if (!line.trim()) return;
        let p;
        try {
          p = JSON.parse(line);
        } catch (e) {
          problems.push(`${name} line ${i + 1}: not valid JSON (${e.message})`);
          return;
        }
        const where = `${name} line ${i + 1}${filled(p?.id) ? ` (${p.id})` : ''}`;
        const bad = checkPassage(p, target);
        if (filled(p?.id)) {
          if (seen.has(p.id)) bad.push(`duplicate id, also in ${seen.get(p.id)}`);
          else seen.set(p.id, name);
        }
        for (const b of bad) problems.push(`${where}: ${b}`);
        if (!bad.length) byLang.get(target.lang).push(storedPassage(p));
      });
  }
  // Two short passages on the same step of a level: they are served in id order, but the steps were meant to differ.
  for (const [lang, passages] of byLang) {
    const steps = new Map();
    for (const p of passages.filter((x) => x.kind === 'short')) {
      const k = `${p.level} step ${p.step}`;
      if (steps.has(k)) warnings.push(`${lang} ${k}: ${steps.get(k)} and ${p.id}`);
      else steps.set(k, p.id);
    }
  }
  return { byLang, problems, warnings };
}

/** The file for one language: passages in serving order; the version is a hash of the passages. */
export function languageFile(lang, passages) {
  const body = [...passages].sort(passageOrder).map((p) => JSON.stringify(p));
  const version = createHash('sha256').update(body.join('\n')).digest('hex').slice(0, 12);
  const head = JSON.stringify({ format: FORMAT, language: lang, version, copyright: COPYRIGHT, credit: CREDIT });
  // One passage per line, so a new batch shows up as added lines.
  return `${head.slice(0, -1)},"passages":[\n${body.join(',\n')}\n]}\n`;
}

export function importBatches(dir) {
  const files = readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort();
  mkdirSync(SRC_DIR, { recursive: true });
  for (const f of files) copyFileSync(path.join(dir, f), path.join(SRC_DIR, f));
  return files;
}

function main(argv) {
  const at = argv.indexOf('--import');
  if (at >= 0) {
    const dir = argv[at + 1];
    if (!dir || !existsSync(dir)) {
      console.error('usage: node scripts/reading/build.mjs [--import <folder with .jsonl batches>]');
      return 2;
    }
    const copied = importBatches(path.resolve(dir));
    console.log(`imported ${copied.length} batch files from ${dir}`);
  }
  const files = existsSync(SRC_DIR) ? readdirSync(SRC_DIR).filter((f) => f.endsWith('.jsonl')).sort().map((f) => path.join(SRC_DIR, f)) : [];
  if (!files.length) {
    console.log('no batches in data/reading/src: nothing to build');
    return 0;
  }
  const { byLang, problems, warnings } = readBatches(files);
  for (const w of warnings) console.log(`warning: ${w}`);
  if (problems.length) {
    console.error(`${problems.length} problems; nothing was written:`);
    for (const p of problems) console.error(`- ${p}`);
    return 1;
  }
  console.log(`checked ${files.length} batch files`);
  console.log(`lang  kind   ${LEVELS.map((l) => l.padStart(4)).join(' ')}  total`);
  for (const lang of LANGS) {
    const passages = byLang.get(lang);
    for (const kind of KINDS) {
      const ofKind = passages.filter((p) => p.kind === kind);
      const counts = LEVELS.map((l) => String(ofKind.filter((p) => p.level === l).length).padStart(4));
      console.log(`${lang.padEnd(4)}  ${kind.padEnd(5)}  ${counts.join(' ')}  ${String(ofKind.length).padStart(5)}`);
    }
    if (passages.length) writeFileSync(path.join(OUT_DIR, `${lang}.json`), languageFile(lang, passages));
    else console.log(`${lang.padEnd(4)}  no passages yet: no file written`);
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
