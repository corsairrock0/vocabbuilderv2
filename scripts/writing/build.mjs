// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Builds data/writing/<lang>.json, the sentences of the Writing practice, from the reviewed batches in
// data/writing/src/ (JSON Lines, one batch per file, named <lang>-<level>-<batch>.jsonl: batch 1 holds steps 1–100
// of the level and batch 2 steps 101–200). See data/writing/README.md.
//
//   node scripts/writing/build.mjs                  check every sentence in data/writing/src/ and write the files
//   node scripts/writing/build.mjs --import <dir>   first copy <dir>/*.jsonl into data/writing/src/ (a file of the
//                                                   same name is replaced), then check and write
//
// Re-runnable as batches arrive: the output depends only on data/writing/src/, and the same batches give the same
// bytes. When any sentence has a problem, every problem is listed and nothing is written.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expandAnswers, PatternError, writingKey, writingWords } from '../../shared/writing.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const OUT_DIR = path.join(root, 'data', 'writing');
export const SRC_DIR = path.join(OUT_DIR, 'src');
export const LANGS = ['es', 'pt', 'vi', 'ru', 'uk', 'pl'];
export const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1'];
export const BATCH_SIZE = 100;
export const STEPS_PER_LEVEL = 200;
/** The most accepted translations one sentence may list (each one must be read by the reviewer). */
export const MAX_TRANSLATIONS = 120;
export const FORMAT = 'vocabbuilder-writing-v1';
export const COPYRIGHT = '© 2026 Lango. All rights reserved.';
export const CREDIT = 'AI-written sentences and translations (Claude), each checked by a second AI review';

/** Words in the main translation (Vietnamese: syllables) and in the English sentence, per level. */
export const WORDS = {
  A1: { target: [2, 9], vi: [2, 14], en: [2, 10] },
  A2: { target: [4, 13], vi: [5, 18], en: [4, 14] },
  B1: { target: [6, 18], vi: [8, 26], en: [6, 20] },
  B2: { target: [8, 24], vi: [10, 34], en: [8, 26] },
  C1: { target: [10, 30], vi: [12, 42], en: [10, 32] },
};

/** Letters each language's translations may use (besides the apostrophe and hyphen inside words). */
const LETTERS = {
  es: /^[a-záéíóúüñ]+$/,
  pt: /^[a-záâãàçéêíóôõú]+$/,
  pl: /^[a-ząćęłńóśźż]+$/,
  ru: /^[а-яё]+$/,
  uk: /^[а-щьюяєіїґ]+$/,
  vi: /^[a-zàáảãạăằắẳẵặâầấẩẫậđèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵ]+$/,
};

const filled = (s) => typeof s === 'string' && s.trim() !== '';
const clean = (s) => s.normalize('NFC').replace(/\s+/g, ' ').trim();
export const byId = (a, b) => a.id.localeCompare(b.id, 'en', { numeric: true });
/** The serving order: by level, then step. */
export const sentenceOrder = (a, b) => LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level) || a.step - b.step || byId(a, b);

/** What a batch file is for, from its name ("es-A1-1.jsonl"); null where the name doesn't say. */
export function fileTarget(file) {
  const [lang, level, batch] = path.basename(file, '.jsonl').split('-');
  return {
    lang: LANGS.includes(lang) ? lang : null,
    level: LEVELS.includes(level) ? level : null,
    batch: /^[12]$/.test(batch ?? '') ? Number(batch) : null,
  };
}

/** The steps a batch holds: 1–100 for batch 1, 101–200 for batch 2. */
export const batchSteps = (batch) => [(batch - 1) * BATCH_SIZE + 1, batch * BATCH_SIZE];

/** Count words the way the limits do: Vietnamese syllables and other languages' words are both space-separated. */
export const countWords = (s) => writingWords(s).length;

/** The problems of one sentence (an empty list when it is fine). */
export function checkSentence(s, target = {}) {
  const out = [];
  if (!s || typeof s !== 'object' || Array.isArray(s)) return ['not a JSON object'];
  const allowed = new Set(['id', 'lang', 'level', 'step', 'topic', 'en', 'context', 'answers']);
  for (const k of Object.keys(s)) if (!allowed.has(k)) out.push(`unknown field ${k}`);
  if (!LANGS.includes(s.lang)) out.push(`unknown lang ${JSON.stringify(s.lang)}`);
  else if (target.lang && s.lang !== target.lang) out.push(`lang ${s.lang} in a ${target.lang} file`);
  if (!LEVELS.includes(s.level)) out.push(`level must be one of ${LEVELS.join(', ')}`);
  else if (target.level && s.level !== target.level) out.push(`level ${s.level} in a ${target.level} file`);
  if (!Number.isInteger(s.step) || s.step < 1 || s.step > STEPS_PER_LEVEL) out.push(`step must be a whole number from 1 to ${STEPS_PER_LEVEL}`);
  else if (target.batch) {
    const [lo, hi] = batchSteps(target.batch);
    if (s.step < lo || s.step > hi) out.push(`step ${s.step} is outside batch ${target.batch} (${lo}–${hi})`);
  }
  const batch = Number.isInteger(s.step) ? Math.ceil(s.step / BATCH_SIZE) : null;
  const wantId = `${s.lang}-${s.level}-${batch}-${String(s.step).padStart(3, '0')}`;
  if (!filled(s.id) || s.id !== wantId) out.push(`id must be ${wantId} (language, level, batch, step)`);
  if (!filled(s.topic) || s.topic.length > 30 || /[^a-z ]/.test(s.topic)) out.push('topic must be one to three lower-case English words');
  const limits = WORDS[s.level];
  if (!filled(s.en)) out.push('en is missing');
  else {
    const en = clean(s.en);
    if (en !== s.en) out.push('en has extra spaces or is not NFC');
    if (/\d/.test(en)) out.push('en has digits: write numbers as words');
    // The app spells the verb like the noun, in its own text and in its content.
    if (/\bpractis(e|ed|es|ing)\b/i.test(en)) out.push('en: write "practice" (practiced, practicing), not "practise"');
    if (/[(){}[\]|]/.test(en)) out.push('en has brackets or | (put what the English leaves open in context)');
    if (!/^[A-Z"“‘']/.test(en)) out.push('en must start with a capital letter');
    if (!/[.?!]["”’']?$/.test(en)) out.push('en must end with . ? or !');
    if (limits) {
      const n = countWords(en);
      if (n < limits.en[0] || n > limits.en[1]) out.push(`en has ${n} words; ${s.level} allows ${limits.en[0]}–${limits.en[1]}`);
    }
  }
  if (s.context != null) {
    if (!filled(s.context) || s.context.length > 40) out.push('context must be a short note (at most 40 characters) or left out');
    else if (/\d|[.]$/.test(s.context) || /^[A-Z]/.test(s.context)) out.push('context starts lower-case, has no digits and no final full stop');
  }
  if (!Array.isArray(s.answers) || !s.answers.length || s.answers.length > 8 || !s.answers.every(filled)) {
    out.push('answers must be a list of one to eight patterns');
    return out;
  }
  for (const p of s.answers) {
    if (/\d/.test(p)) out.push(`a pattern has digits: write numbers as words (${p})`);
    if (/[()[\]"]/.test(p)) out.push(`a pattern has brackets or straight quotes (${p})`);
    if (p !== p.normalize('NFC')) out.push(`a pattern is not NFC (${p})`);
  }
  let all;
  try {
    all = expandAnswers(s.answers);
  } catch (e) {
    if (e instanceof PatternError) {
      out.push(`answers: ${e.message}`);
      return out;
    }
    throw e;
  }
  if (all.length > MAX_TRANSLATIONS) out.push(`answers accept ${all.length} translations; at most ${MAX_TRANSLATIONS}`);
  const main = all[0] ?? '';
  if (!/[.?!…]$/.test(main)) out.push('the main translation must end with . ? ! or …');
  if (limits && LANGS.includes(s.lang)) {
    const [lo, hi] = s.lang === 'vi' ? limits.vi : limits.target;
    const n = countWords(main);
    if (n < lo || n > hi) out.push(`the main translation has ${n} ${s.lang === 'vi' ? 'syllables' : 'words'}; ${s.level} allows ${lo}–${hi}`);
  }
  const letters = LETTERS[s.lang];
  if (letters) {
    const odd = new Set();
    for (const t of all) {
      for (const w of writingWords(t)) for (const part of w.toLocaleLowerCase(s.lang).split(/['’ʼ-]/)) if (part && !letters.test(part)) odd.add(w);
    }
    if (odd.size) out.push(`words with letters ${s.lang} does not use: ${[...odd].slice(0, 6).join(', ')}`);
  }
  for (const t of all) if (!writingKey(t, s.lang)) out.push(`an accepted translation has no words (${JSON.stringify(t)})`);
  return out;
}

/** Read one batch file: its sentences and the problems of each line. */
export function readBatch(file) {
  const target = fileTarget(file);
  const problems = [];
  const sentences = [];
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      if (!line.trim()) return;
      let s;
      try {
        s = JSON.parse(line);
      } catch {
        problems.push(`${path.basename(file)}:${i + 1}: not valid JSON`);
        return;
      }
      for (const p of checkSentence(s, target)) problems.push(`${path.basename(file)}:${i + 1} ${s?.id ?? ''}: ${p}`);
      sentences.push(s);
    });
  if (!target.lang || !target.level || !target.batch) problems.push(`${path.basename(file)}: the file name must look like es-A1-1.jsonl (batch 1 or 2)`);
  return { target, sentences, problems };
}

/** Problems across a language's sentences: repeated ids, steps, English sentences or main translations. */
export function crossCheck(sentences) {
  const out = [];
  const seen = { id: new Map(), step: new Map(), en: new Map(), main: new Map() };
  for (const s of sentences) {
    const keys = {
      id: s.id,
      step: `${s.level}-${s.step}`,
      en: clean(String(s.en ?? '')).toLowerCase().replace(/[^\p{L}\p{N} ]/gu, ''),
      main: (() => {
        try {
          return writingKey(expandAnswers(s.answers)[0] ?? '', s.lang);
        } catch {
          return null;
        }
      })(),
    };
    for (const [k, v] of Object.entries(keys)) {
      if (!v) continue;
      if (seen[k].has(v)) out.push(`${s.id}: the same ${k === 'main' ? 'main translation' : k === 'en' ? 'English sentence' : k} as ${seen[k].get(v)}`);
      else seen[k].set(v, s.id);
    }
  }
  return out;
}

const hash = (s) => createHash('sha256').update(s).digest('hex').slice(0, 12);

/** Build every language's file from data/writing/src/. Returns the problems (nothing is written when there are any). */
export function build({ srcDir = SRC_DIR, outDir = OUT_DIR, log = console.log } = {}) {
  const files = existsSync(srcDir) ? readdirSync(srcDir).filter((f) => f.endsWith('.jsonl')).sort() : [];
  const problems = [];
  const byLang = new Map(LANGS.map((l) => [l, []]));
  for (const f of files) {
    const b = readBatch(path.join(srcDir, f));
    problems.push(...b.problems);
    for (const s of b.sentences) if (byLang.has(s?.lang)) byLang.get(s.lang).push(s);
  }
  for (const list of byLang.values()) problems.push(...crossCheck(list));
  if (problems.length) {
    for (const p of problems) log(`problem: ${p}`);
    return problems;
  }
  mkdirSync(outDir, { recursive: true });
  const counts = [];
  for (const [lang, list] of byLang) {
    const sentences = list
      .map((s) => ({ id: s.id, level: s.level, step: s.step, topic: s.topic, en: s.en, ...(s.context ? { context: s.context } : {}), answers: s.answers }))
      .sort(sentenceOrder);
    const body = JSON.stringify(sentences);
    const doc = { format: FORMAT, language: lang, version: hash(body), copyright: COPYRIGHT, credit: CREDIT, sentences };
    const file = path.join(outDir, `${lang}.json`);
    if (!sentences.length) {
      counts.push(`${lang}: none`);
      continue;
    }
    writeFileSync(file, JSON.stringify(doc, null, 0).replace(/\},\{"id"/g, '},\n{"id"') + '\n');
    const per = LEVELS.map((l) => `${l} ${sentences.filter((s) => s.level === l).length}`).join(', ');
    counts.push(`${lang}: ${sentences.length} (${per})`);
  }
  for (const c of counts) log(c);
  return [];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const at = args.indexOf('--import');
  if (at >= 0) {
    const dir = args[at + 1];
    if (!dir || !existsSync(dir)) {
      console.error('usage: node scripts/writing/build.mjs [--import <dir>]');
      process.exit(2);
    }
    mkdirSync(SRC_DIR, { recursive: true });
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.jsonl'))) copyFileSync(path.join(dir, f), path.join(SRC_DIR, f));
  }
  const problems = build();
  process.exit(problems.length ? 1 : 0);
}
