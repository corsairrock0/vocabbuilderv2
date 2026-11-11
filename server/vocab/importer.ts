// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
/**
 * Vocabulary import pipeline: upload → detect format → preview + suggested column mapping →
 * validate (errors, in-file duplicates, existing duplicates, homograph candidates) →
 * commit in ONE transaction (all-or-nothing) → optional undo.
 *
 * Formats: CSV, TSV, JSON (array of objects or VocabBuilder "vocabbuilder-v1"),
 * JSONL (generic objects or Kaikki/Wiktextract dictionary lines), and frequency lists
 * ("word count", "rank word", CSV/TSV with word/rank/count columns).
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { App } from '../app.ts';
import type { Db } from '../db/database.ts';
import { json } from '../db/database.ts';
import { HttpError, notFound } from '../http/http.ts';
import { LANGUAGES, normalizePos, type LanguageCode } from '../../shared/languages.ts';
import { englishCore, findTarget, matchKey, stripStress } from '../../shared/text.ts';
import { AI_SENTENCES, createEntry, expressionKind, loadParadigm, mergedForms, tagId, writeEntryChildren, writeParadigm, type EntryInput } from './repo.ts';
import { sanitizeParadigm } from '../../shared/paradigms.ts';

export type ImportFormat = 'csv' | 'tsv' | 'json' | 'jsonl' | 'kaikki' | 'vocabbuilder' | 'frequency';

export const MAPPING_FIELDS = [
  'lemma', 'gloss', 'translations', 'pos', 'display', 'gender', 'aspect', 'aspectPair', 'pronunciation', 'definition', 'rank', 'count',
  'tags', 'example', 'exampleTranslation', 'exampleTarget', 'example2', 'example2Translation', 'forms', 'notes', 'register', 'regionalNote', 'source',
] as const;
export type MappingField = (typeof MAPPING_FIELDS)[number];
export type Mapping = Partial<Record<MappingField, string>>;

export interface ImportOptions {
  duplicatePolicy: 'skip' | 'merge' | 'new';
  homographPolicy: 'new' | 'merge' | 'skip';
  listSeparator: string;
  sourceName?: string;
  sourceKind?: string;
  sourceLicense?: string;
  sourceUrl?: string;
  /** Frequency imports: which kind of corpus the list comes from. */
  frequencyKind?: 'frequency_spoken' | 'frequency_subtitles' | 'frequency_written' | 'frequency_mixed';
  setAsPreferredFrequency?: boolean;
  limit?: number;
  decisions?: Record<string, 'skip' | 'merge' | 'new'>;
  /** Bundled sets: the version of the set file that was loaded. */
  setVersion?: string;
  /** Updating a bundled set: the earlier loads of it whose meanings, sentences and combinations are replaced. */
  refreshFrom?: string[];
}

export const DEFAULT_OPTIONS: ImportOptions = { duplicatePolicy: 'skip', homographPolicy: 'new', listSeparator: ';' };

// ------------------------------------------------------------------ parsing

export function parseDelimited(text: string, delimiter: ',' | '\t' | ';'): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;
  const s = text.replace(/^﻿/, '');
  while (i < s.length) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"' && field === '') {
      quoted = true;
      i++;
      continue;
    }
    if (c === delimiter) {
      row.push(field);
      field = '';
      i++;
      continue;
    }
    if (c === '\r') {
      i++;
      continue;
    }
    if (c === '\n') {
      row.push(field);
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
      field = '';
      i++;
      continue;
    }
    field += c;
    i++;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows;
}

export function detectFormat(fileName: string, text: string): ImportFormat {
  const ext = path.extname(fileName).toLowerCase();
  const head = text.replace(/^﻿/, '').trimStart();
  if (ext === '.jsonl' || ext === '.ndjson' || (/^\{/.test(head) && head.split('\n').filter(Boolean).length > 1 && (() => {
    try {
      JSON.parse(head.split('\n')[0]);
      return true;
    } catch {
      return false;
    }
  })())) {
    const first = JSON.parse(head.split('\n').find((l) => l.trim())!);
    return first && typeof first === 'object' && 'word' in first && 'senses' in first ? 'kaikki' : 'jsonl';
  }
  if (ext === '.json' || head.startsWith('[') || head.startsWith('{')) {
    try {
      const parsed = JSON.parse(head);
      if (parsed && !Array.isArray(parsed) && parsed.format === 'vocabbuilder-v1') return 'vocabbuilder';
      return 'json';
    } catch {
      /* fall through */
    }
  }
  const firstLines = head.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 5);
  if (firstLines.every((l) => /^\S+\s+\d+\s*$/.test(l.trim()) || /^\d+\s+\S+\s*$/.test(l.trim()))) return 'frequency';
  if (ext === '.tsv' || ext === '.tab' || (firstLines[0]?.includes('\t') ?? false)) return 'tsv';
  return 'csv';
}

export interface ParsedTable {
  columns: string[];
  rows: Array<Record<string, string>>;
}

function tableFromDelimited(text: string, delimiter: ',' | '\t' | ';', hasHeader: boolean): ParsedTable {
  const raw = parseDelimited(text, delimiter);
  if (!raw.length) return { columns: [], rows: [] };
  // A loop, not Math.max(...rows): spreading 100k+ rows into arguments overflows the call stack.
  let width = 0;
  for (const r of raw) if (r.length > width) width = r.length;
  const columns = hasHeader ? raw[0].map((c, i) => c.trim() || `column ${i + 1}`) : Array.from({ length: width }, (_, i) => `column ${i + 1}`);
  const body = hasHeader ? raw.slice(1) : raw;
  return { columns, rows: body.map((r) => Object.fromEntries(columns.map((c, i) => [c, (r[i] ?? '').trim()]))) };
}

function flattenObject(o: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v == null) continue;
    out[k] = Array.isArray(v) ? v.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join('; ') : typeof v === 'object' ? JSON.stringify(v) : String(v);
  }
  return out;
}

export function parseTable(format: ImportFormat, text: string, hasHeader = true): ParsedTable {
  if (format === 'csv') {
    const firstLine = text.split('\n')[0] ?? '';
    const delim = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
    return tableFromDelimited(text, delim, hasHeader);
  }
  if (format === 'tsv') return tableFromDelimited(text, '\t', hasHeader);
  if (format === 'frequency') {
    const rows = text
      .replace(/^﻿/, '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const parts = l.split(/\s+/);
        if (/^\d+$/.test(parts[0]) && parts.length >= 2 && !/^\d+$/.test(parts[1])) return { rank: parts[0], word: parts.slice(1).join(' ') } as Record<string, string>;
        const count = parts[parts.length - 1];
        return { word: parts.slice(0, -1).join(' '), count } as Record<string, string>;
      });
    return { columns: Object.keys(rows[0] ?? { word: '', count: '' }), rows };
  }
  if (format === 'json') {
    const parsed = JSON.parse(text.replace(/^﻿/, ''));
    const arr: unknown[] = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.entries) ? parsed.entries : Array.isArray(parsed?.words) ? parsed.words : [];
    const rows = arr.filter((x) => x && typeof x === 'object').map((x) => flattenObject(x as Record<string, unknown>));
    return { columns: [...new Set(rows.flatMap((r) => Object.keys(r)))], rows };
  }
  if (format === 'jsonl') {
    const rows = text
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => flattenObject(JSON.parse(l)));
    return { columns: [...new Set(rows.flatMap((r) => Object.keys(r)))], rows };
  }
  throw new HttpError(400, 'bad_request', `Format ${format} is not tabular`);
}

const SYNONYMS: Record<MappingField, string[]> = {
  lemma: ['lemma', 'word', 'term', 'headword', 'vocabulary', 'vocab', 'front', 'target', 'expression', 'spanish', 'portuguese', 'vietnamese', 'russian', 'ukrainian', 'polish', 'bare', 'palabra', 'слово'],
  gloss: ['english', 'meaning', 'translation', 'gloss', 'en', 'back', 'definition_en', 'translation_en', 'translations_en', 'tl'],
  translations: ['alternatives', 'synonyms', 'other_translations', 'accepted', 'alt', 'also'],
  pos: ['pos', 'part_of_speech', 'partofspeech', 'part of speech', 'word_class', 'class', 'type', 'wordtype'],
  display: ['stressed', 'accented', 'display', 'with_stress', 'accented_form'],
  gender: ['gender', 'genus'],
  aspect: ['aspect'],
  aspectPair: ['aspect_pair', 'partner', 'aspect partner', 'pair'],
  pronunciation: ['pronunciation', 'ipa', 'phonetic', 'transcription'],
  definition: ['definition', 'description'],
  rank: ['rank', 'frequency_rank', 'freq_rank', 'position', '#', 'no', 'number'],
  count: ['count', 'frequency', 'freq', 'occurrences', 'ipm', 'per_million'],
  tags: ['tags', 'tag', 'category', 'categories', 'topic', 'topics', 'theme', 'deck'],
  example: ['example', 'sentence', 'example_sentence', 'context', 'usage', 'example1'],
  exampleTranslation: ['example_translation', 'sentence_translation', 'example_en', 'translation_sentence', 'example1_translation', 'sentence_en'],
  exampleTarget: ['example_target', 'target_form', 'cloze', 'surface_form'],
  example2: ['example2', 'sentence2'],
  example2Translation: ['example2_translation', 'sentence2_translation'],
  forms: ['forms', 'inflections', 'declension', 'conjugation'],
  notes: ['notes', 'note', 'comment', 'comments', 'grammar', 'usage_note'],
  register: ['register', 'style'],
  regionalNote: ['region', 'regional', 'regional_note', 'dialect', 'variety'],
  source: ['source', 'origin'],
};

export function suggestMapping(columns: string[], kind: 'vocabulary' | 'frequency'): Mapping {
  const norm = (s: string) => s.toLowerCase().replace(/[\s-]+/g, '_').trim();
  const mapping: Mapping = {};
  const used = new Set<string>();
  const fields: MappingField[] = kind === 'frequency' ? ['lemma', 'rank', 'count', 'pos'] : (MAPPING_FIELDS as readonly MappingField[]).slice();
  for (const field of fields) {
    const syn = field === 'lemma' && kind === 'frequency' ? [...SYNONYMS.lemma, 'form'] : SYNONYMS[field];
    const col = columns.find((c) => !used.has(c) && syn.includes(norm(c)));
    if (col) {
      mapping[field] = col;
      used.add(col);
    }
  }
  if (!mapping.lemma && columns[0] && !used.has(columns[0])) {
    mapping.lemma = columns[0];
    used.add(columns[0]);
  }
  if (kind === 'vocabulary' && !mapping.gloss && columns[1] && !used.has(columns[1])) mapping.gloss = columns[1];
  return mapping;
}

// ------------------------------------------------------------------ normalisation

export interface NormalizedRow {
  row: number;
  entry: EntryInput;
  errors: string[];
}

function splitList(v: string | undefined, sep: string): string[] {
  if (!v) return [];
  const parts = sep === ';' ? v.split(/\s*[;|]\s*/) : v.split(sep);
  return parts.map((s) => s.trim()).filter(Boolean);
}

/** forms column: "воду:accusative,singular; воды:genitive,singular" */
function parseForms(v: string | undefined): EntryInput['forms'] {
  if (!v) return [];
  if (v.trim().startsWith('[')) {
    try {
      const arr = JSON.parse(v);
      if (Array.isArray(arr)) return arr.filter((f) => f?.form).map((f) => ({ form: String(f.form), display: f.display ?? null, tags: Array.isArray(f.tags) ? f.tags.map(String) : [] }));
    } catch {
      /* fall back to compact syntax */
    }
  }
  return v
    .split(/\s*;\s*/)
    .filter(Boolean)
    .map((part) => {
      const [form, tags] = part.split(':');
      return { form: form.trim(), tags: tags ? tags.split(',').map((t) => t.trim()).filter(Boolean) : [] };
    });
}

export function rowsToEntries(table: ParsedTable, mapping: Mapping, opts: ImportOptions): NormalizedRow[] {
  const get = (r: Record<string, string>, f: MappingField) => (mapping[f] ? (r[mapping[f]!] ?? '').trim() : '');
  return table.rows.map((r, i) => {
    const errors: string[] = [];
    const lemma = get(r, 'lemma');
    const gloss = get(r, 'gloss');
    // A word must contain at least one letter or digit (not only spaces, punctuation or stress marks).
    if (!/[\p{L}\p{N}]/u.test(lemma)) errors.push('Missing word');
    if (!/[\p{L}\p{N}]/u.test(gloss)) errors.push('Missing English meaning');
    if (lemma.length > 200) errors.push('Word is longer than 200 characters');
    const rank = get(r, 'rank');
    if (rank && !/^\d+$/.test(rank)) errors.push(`Rank "${rank}" is not a whole number`);
    const examples: NonNullable<EntryInput['examples']> = [];
    if (get(r, 'example')) examples.push({ text: get(r, 'example'), translation: get(r, 'exampleTranslation') || null, target: get(r, 'exampleTarget') || null });
    if (get(r, 'example2')) examples.push({ text: get(r, 'example2'), translation: get(r, 'example2Translation') || null, target: null });
    const glossParts = splitList(gloss, opts.listSeparator);
    const entry: EntryInput = {
      lemma,
      display: get(r, 'display') || null,
      pos: get(r, 'pos') || null,
      gender: get(r, 'gender') || null,
      aspect: get(r, 'aspect') || null,
      aspectPair: get(r, 'aspectPair') || null,
      pronunciation: get(r, 'pronunciation') || null,
      register: get(r, 'register') || null,
      regionalNote: get(r, 'regionalNote') || null,
      grammarNotes: get(r, 'notes') || null,
      senses: gloss ? [{ gloss: glossParts[0] ?? gloss, translations: [...glossParts.slice(1), ...splitList(get(r, 'translations'), opts.listSeparator)], definition: get(r, 'definition') || null }] : [],
      forms: parseForms(get(r, 'forms')),
      examples,
      tags: splitList(get(r, 'tags'), opts.listSeparator === ';' ? ',' : opts.listSeparator).flatMap((t) => t.split(/\s*[;,]\s*/)).filter(Boolean),
      frequencyRank: rank ? Number(rank) : null,
    };
    return { row: i + 1, entry, errors };
  });
}

const KAIKKI_SKIP_FORM_TAGS = new Set(['table-tags', 'inflection-template', 'romanization', 'class', 'error-unrecognized-form']);

/** Convert Kaikki/Wiktextract JSONL lines into entries (lemma entries only; form-of entries are skipped). */
export function kaikkiToEntries(text: string, language: LanguageCode, limit = 100_000): NormalizedRow[] {
  const out: NormalizedRow[] = [];
  const name = LANGUAGES[language].name.toLowerCase();
  const lines = text.split('\n');
  for (let i = 0; i < lines.length && out.length < limit; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    let o: any;
    try {
      o = JSON.parse(line);
    } catch {
      out.push({ row: i + 1, entry: { lemma: '', senses: [] }, errors: ['Invalid JSON line'] });
      continue;
    }
    if (o.lang_code && o.lang_code !== language && String(o.lang ?? '').toLowerCase() !== name) continue;
    const senses = (Array.isArray(o.senses) ? o.senses : []).filter((s: any) => !s.form_of && !(s.tags ?? []).includes('form-of') && Array.isArray(s.glosses) && s.glosses.length);
    if (!senses.length) continue;
    const canonical = (o.forms ?? []).find((f: any) => (f.tags ?? []).includes('canonical'))?.form;
    const ipa = (o.sounds ?? []).find((s: any) => s.ipa)?.ipa ?? null;
    const examples: NonNullable<EntryInput['examples']> = [];
    for (const s of senses) {
      for (const ex of s.examples ?? []) {
        const tr = ex.translation ?? ex.english;
        if (ex.text && tr && examples.length < 3) examples.push({ text: ex.text, translation: tr, target: null });
      }
    }
    const regional = [...new Set(senses.flatMap((s: any) => (s.tags ?? []).filter((t: string) => /^[A-Z]/.test(t))))].join(', ');
    out.push({
      row: i + 1,
      errors: [],
      entry: {
        lemma: stripStress(o.word),
        display: canonical && canonical !== o.word ? canonical : null,
        pos: o.pos,
        pronunciation: ipa,
        regionalNote: regional || null,
        senses: senses.slice(0, 5).map((s: any) => ({ gloss: String(s.glosses[s.glosses.length - 1]).slice(0, 300), translations: [], note: (s.tags ?? []).join(', ') || null })),
        forms: (o.forms ?? [])
          .filter((f: any) => f.form && !(f.tags ?? []).some((t: string) => KAIKKI_SKIP_FORM_TAGS.has(t) || t === 'canonical') && f.form !== '-')
          .slice(0, 40)
          .map((f: any) => ({ form: f.form, tags: f.tags ?? [] })),
        examples,
        tags: [],
      },
    });
  }
  return out;
}

export function vocabbuilderToEntries(text: string): { language: string | null; source: any; sentenceSources: Record<string, { name: string; license?: string | null; url?: string | null; ai?: boolean }>; rows: NormalizedRow[] } {
  const doc = JSON.parse(text.replace(/^﻿/, ''));
  const rows: NormalizedRow[] = (doc.entries ?? []).map((e: any, i: number) => {
    const errors: string[] = [];
    if (!/[\p{L}\p{N}]/u.test(String(e.lemma ?? ''))) errors.push('Missing lemma');
    if (!e.senses?.length || !/[\p{L}\p{N}]/u.test(String(e.senses[0].gloss ?? ''))) errors.push('Missing English meaning');
    return {
      row: i + 1,
      errors,
      entry: {
        lemma: e.lemma ?? '',
        display: e.display ?? null,
        pos: e.pos ?? null,
        gender: e.gender ?? null,
        aspect: e.aspect ?? null,
        aspectPair: e.aspectPair ?? null,
        pronunciation: e.pronunciation ?? null,
        register: e.register ?? null,
        regionalNote: e.regionalNote ?? null,
        grammarNotes: e.grammar?.notes ?? null,
        senses: (e.senses ?? []).map((s: any) => ({ gloss: s.gloss, translations: s.translations ?? [], definition: s.definition ?? null, note: s.note ?? null })),
        forms: (e.forms ?? []).map((f: any) => ({ form: f.form, display: f.display ?? null, tags: f.tags ?? [] })),
        examples: (e.examples ?? []).map((x: any) => ({
          text: x.display ?? x.text,
          translation: x.translation ?? null,
          target: x.target ?? null,
          // The meaning (index into senses) the sentence shows.
          sense: Number.isInteger(x.sense) && x.sense >= 0 && x.sense < (e.senses ?? []).length ? x.sense : null,
          sourceKey: typeof x.source === 'string' ? x.source : null,
          sourceRef: typeof x.ref === 'string' ? x.ref.slice(0, 120) : null,
        })),
        paradigm: e.paradigm != null ? sanitizeParadigm(e.paradigm) : undefined,
        expressions: (e.expressions ?? []).map((x: any) => ({ text: x.text, translation: x.translation ?? null, kind: expressionKind(x.kind) })),
        tags: e.tags ?? [],
        frequencyRank: e.frequencyRank ?? null,
        curatedOrder: e.curatedOrder ?? null,
        imageUrl: e.imageUrl ?? null,
      },
    };
  });
  const sentenceSources: Record<string, { name: string; license?: string | null; url?: string | null; ai?: boolean }> = {};
  for (const [k, v] of Object.entries((doc.sentenceSources ?? {}) as Record<string, any>)) {
    if (v && typeof v.name === 'string' && v.name.trim()) sentenceSources[k] = { name: v.name.trim().slice(0, 200), license: typeof v.license === 'string' ? v.license : null, url: typeof v.url === 'string' ? v.url : null, ai: v.ai === true };
  }
  return { language: doc.language ?? null, source: doc.source ?? null, sentenceSources, rows };
}

// ------------------------------------------------------------------ jobs

interface JobRow {
  id: string;
  language_code: LanguageCode;
  kind: 'vocabulary' | 'frequency';
  file_name: string | null;
  stored_file: string | null;
  format: ImportFormat;
  status: string;
  mapping: string | null;
  options: string | null;
  stats: string | null;
  error_report: string | null;
}

function jobFile(app: App, id: string, ext: string) {
  const dir = path.join(app.config.dataDir, 'imports');
  mkdirSync(dir, { recursive: true });
  return path.join(dir, `${id}${ext}`);
}

function loadJob(app: App, id: string): JobRow {
  const job = app.db.get<JobRow>('SELECT * FROM import_jobs WHERE id = ?', id);
  if (!job) throw notFound('Import job');
  return job;
}

function readJobText(app: App, job: JobRow): string {
  if (!job.stored_file || !existsSync(job.stored_file)) throw new HttpError(410, 'import_file_missing', 'The uploaded file is no longer available. Upload it again.');
  return readFileSync(job.stored_file, 'utf8');
}

export function createImportJob(app: App, input: { language: LanguageCode; kind: 'vocabulary' | 'frequency'; fileName: string; data: Buffer; now: number }) {
  const text = input.data.toString('utf8');
  if (text.includes('�') && !/[\u0080-￿]/.test(text.replace(/�/g, ''))) {
    throw new HttpError(422, 'encoding', 'The file does not look like UTF-8 text. Export it as UTF-8 and try again.');
  }
  let format = detectFormat(input.fileName, text);
  if (input.kind === 'frequency' && (format === 'csv' || format === 'tsv')) format = format; // tabular frequency lists use mapping
  const id = randomUUID();
  const stored = jobFile(app, id, path.extname(input.fileName).toLowerCase() || '.txt');
  writeFileSync(stored, input.data);
  app.db.tx(() =>
    app.db.run(
      "INSERT INTO import_jobs (id, language_code, kind, file_name, stored_file, format, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'uploaded', ?)",
      id,
      input.language,
      input.kind,
      input.fileName.slice(0, 200),
      stored,
      format,
      input.now,
    ),
  );
  return { id, ...preview(app, id) };
}

export function preview(app: App, id: string) {
  const job = loadJob(app, id);
  const text = readJobText(app, job);
  if (job.format === 'vocabbuilder') {
    const doc = vocabbuilderToEntries(text);
    return { format: job.format, kind: job.kind, columns: [] as string[], sample: doc.rows.slice(0, 10).map((r) => ({ lemma: r.entry.lemma, gloss: r.entry.senses[0]?.gloss ?? '' })), rowCount: doc.rows.length, suggestedMapping: {} as Mapping, needsMapping: false, fileLanguage: doc.language };
  }
  if (job.format === 'kaikki') {
    const rows = kaikkiToEntries(text, job.language_code, 50);
    return { format: job.format, kind: job.kind, columns: [], sample: rows.slice(0, 10).map((r) => ({ lemma: r.entry.lemma, gloss: r.entry.senses[0]?.gloss ?? '', pos: r.entry.pos ?? '' })), rowCount: text.split('\n').filter((l) => l.trim()).length, suggestedMapping: {}, needsMapping: false, fileLanguage: null };
  }
  const table = parseTable(job.format, text);
  return {
    format: job.format,
    kind: job.kind,
    columns: table.columns,
    sample: table.rows.slice(0, 10),
    rowCount: table.rows.length,
    suggestedMapping: suggestMapping(table.columns, job.kind),
    needsMapping: true,
    fileLanguage: null,
  };
}

function normalizedRows(app: App, job: JobRow, mapping: Mapping, opts: ImportOptions): NormalizedRow[] {
  const text = readJobText(app, job);
  if (job.format === 'vocabbuilder') {
    const doc = vocabbuilderToEntries(text);
    if (doc.language && doc.language !== job.language_code) throw new HttpError(422, 'language_mismatch', `This file is for language "${doc.language}", not "${job.language_code}".`);
    return doc.rows;
  }
  if (job.format === 'kaikki') return kaikkiToEntries(text, job.language_code, opts.limit ?? 100_000);
  const table = parseTable(job.format, text);
  if (!mapping.lemma) throw new HttpError(422, 'mapping_required', 'Choose which column contains the word.');
  if (job.kind === 'vocabulary' && !mapping.gloss) throw new HttpError(422, 'mapping_required', 'Choose which column contains the English meaning.');
  return rowsToEntries(table, mapping, opts).slice(0, opts.limit ?? Number.MAX_SAFE_INTEGER);
}

export interface ValidationReport {
  total: number;
  valid: number;
  errors: Array<{ row: number; lemma: string; errors: string[] }>;
  inFileDuplicates: Array<{ row: number; lemma: string; firstRow: number }>;
  duplicates: Array<{ row: number; lemma: string; entryId: number; gloss: string }>;
  homographs: Array<{ row: number; lemma: string; gloss: string; existing: Array<{ entryId: number; gloss: string }> }>;
  newEntries: number;
}

/** Entries with the same headword and a compatible part of speech ('other' = unknown matches any). */
function existingMatches(db: Db, language: LanguageCode, key: string, pos: string) {
  return db.all<{ id: number; pos: string; glosses: string | null; gloss: string | null }>(
    `SELECT e.id, e.pos, (SELECT group_concat(t.text_key, '|') FROM vocabulary_senses s JOIN vocabulary_translations t ON t.sense_id = s.id WHERE s.entry_id = e.id) AS glosses,
            (SELECT s.gloss FROM vocabulary_senses s WHERE s.entry_id = e.id ORDER BY s.sense_order LIMIT 1) AS gloss
       FROM vocabulary_entries e WHERE e.language_code = ? AND e.lemma_key = ? AND (e.pos = ? OR e.pos = 'other' OR ? = 'other') AND e.deleted_at IS NULL
      ORDER BY e.id`,
    language,
    key,
    pos,
    pos,
  );
}

function classify(db: Db, language: LanguageCode, rows: NormalizedRow[]): { report: ValidationReport; classes: Map<number, { type: 'error' | 'dup_in_file' | 'duplicate' | 'homograph' | 'new'; entryId?: number }> } {
  const report: ValidationReport = { total: rows.length, valid: 0, errors: [], inFileDuplicates: [], duplicates: [], homographs: [], newEntries: 0 };
  const classes = new Map<number, { type: 'error' | 'dup_in_file' | 'duplicate' | 'homograph' | 'new'; entryId?: number }>();
  const seen = new Map<string, number>();
  for (const r of rows) {
    if (r.errors.length) {
      report.errors.push({ row: r.row, lemma: r.entry.lemma, errors: r.errors });
      classes.set(r.row, { type: 'error' });
      continue;
    }
    report.valid++;
    const key = matchKey(stripStress(r.entry.lemma), language);
    const pos = normalizePos(r.entry.pos);
    const glossKeys = new Set(r.entry.senses.flatMap((s) => [s.gloss, ...(s.translations ?? [])]).map((g) => englishCore(g)));
    const fileKey = `${key}|${pos}|${[...glossKeys].sort().join('/')}`;
    if (seen.has(fileKey)) {
      report.inFileDuplicates.push({ row: r.row, lemma: r.entry.lemma, firstRow: seen.get(fileKey)! });
      classes.set(r.row, { type: 'dup_in_file' });
      continue;
    }
    seen.set(fileKey, r.row);
    const matches = existingMatches(db, language, key, pos);
    const dup = matches.find((m) => (m.glosses ?? '').split('|').some((g) => g && glossKeys.has(englishCore(g))));
    if (dup) {
      report.duplicates.push({ row: r.row, lemma: r.entry.lemma, entryId: dup.id, gloss: r.entry.senses[0]?.gloss ?? '' });
      classes.set(r.row, { type: 'duplicate', entryId: dup.id });
    } else if (matches.length) {
      // Same spelling and part of speech, different meaning: never merged silently.
      report.homographs.push({
        row: r.row,
        lemma: r.entry.lemma,
        gloss: r.entry.senses[0]?.gloss ?? '',
        existing: matches.map((m) => ({ entryId: m.id, gloss: m.gloss ?? '' })),
      });
      classes.set(r.row, { type: 'homograph', entryId: matches[0].id });
    } else {
      report.newEntries++;
      classes.set(r.row, { type: 'new' });
    }
  }
  return { report, classes };
}

export function validateImport(app: App, id: string, mapping: Mapping, options: Partial<ImportOptions>) {
  const job = loadJob(app, id);
  const opts = { ...DEFAULT_OPTIONS, ...options };
  if (job.kind === 'frequency') return validateFrequency(app, job, mapping, opts);
  const rows = normalizedRows(app, job, mapping, opts);
  const { report } = classify(app.db, job.language_code, rows);
  app.db.tx(() =>
    app.db.run("UPDATE import_jobs SET status = 'validated', mapping = ?, options = ?, stats = ? WHERE id = ?", JSON.stringify(mapping), JSON.stringify(opts), JSON.stringify({ validation: summarize(report) }), id),
  );
  return { report: { ...report, errors: report.errors.slice(0, 200), duplicates: report.duplicates.slice(0, 200), homographs: report.homographs.slice(0, 200), inFileDuplicates: report.inFileDuplicates.slice(0, 200) } };
}

function summarize(r: ValidationReport) {
  return { total: r.total, valid: r.valid, errors: r.errors.length, duplicates: r.duplicates.length, homographs: r.homographs.length, inFileDuplicates: r.inFileDuplicates.length, newEntries: r.newEntries };
}

function ensureSource(db: Db, language: LanguageCode, opts: ImportOptions, fallbackName: string, kind: string, now: number, src?: any): number {
  const name = (src?.name ?? opts.sourceName ?? fallbackName).slice(0, 200);
  db.run(
    'INSERT INTO sources (language_code, name, kind, url, license, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(language_code, name) DO NOTHING',
    language,
    name,
    src?.kind ?? opts.sourceKind ?? kind,
    src?.url ?? opts.sourceUrl ?? null,
    src?.license ?? opts.sourceLicense ?? null,
    src?.notes ?? null,
    now,
  );
  return db.get<{ id: number }>('SELECT id FROM sources WHERE language_code = ? AND name = ?', language, name)!.id;
}

/** Commit the import in one transaction: either every accepted row is written or none is. */
export function commitImport(app: App, id: string, mapping: Mapping, options: Partial<ImportOptions>, now: number) {
  const job = loadJob(app, id);
  if (job.status === 'committed') throw new HttpError(409, 'already_committed', 'This import was already committed.');
  const opts = { ...DEFAULT_OPTIONS, ...json<Partial<ImportOptions>>(job.options, {}), ...options };
  if (job.kind === 'frequency') return commitFrequency(app, job, mapping, opts, now);
  const db = app.db;
  const rows = normalizedRows(app, job, mapping, opts);
  const text = job.format === 'vocabbuilder' ? readJobText(app, job) : null;
  const parsedFile = text ? vocabbuilderToEntries(text) : null;
  const fileSource = parsedFile?.source ?? null;
  try {
    const stats = db.tx(() => {
      const { classes } = classify(db, job.language_code, rows);
      const sourceId = ensureSource(db, job.language_code, opts, `Import: ${job.file_name ?? job.id}`, job.format === 'kaikki' ? 'dictionary' : 'user', now, fileSource);
      // Example sentences name their own sources (Tatoeba, a treebank, AI-written): one sources row each.
      const sentenceSourceIds = new Map<string, number>();
      for (const [k, v] of Object.entries(parsedFile?.sentenceSources ?? {})) {
        const kind = v.ai ? AI_SENTENCES : 'sentences';
        sentenceSourceIds.set(k, ensureSource(db, job.language_code, opts, v.name, kind, now, { name: v.name, kind, license: v.license ?? null, url: v.url ?? null }));
      }
      for (const r of rows) {
        for (const x of r.entry.examples ?? []) if (x.sourceKey) x.sourceId = sentenceSourceIds.get(x.sourceKey) ?? null;
      }
      const refreshFrom = opts.refreshFrom?.length ? JSON.stringify(opts.refreshFrom) : null;
      // An update of a bundled set also counts the words it refreshed, the edited words it left alone, and the words it left out.
      const s: { created: number; merged: number; skipped: number; errors: number; homographsCreated: number; refreshed?: number; keptEdited?: number; removed?: number; keptStarted?: number } = {
        created: 0,
        merged: 0,
        skipped: 0,
        errors: 0,
        homographsCreated: 0,
        ...(refreshFrom ? { refreshed: 0, keptEdited: 0, removed: 0, keptStarted: 0 } : {}),
      };
      let ranked = false;
      const refreshedIds = new Set<number>();
      const inVersion = new Set<number>(); // every word this file has, for an update to tell which ones it left out
      for (const r of rows) {
        const c = classes.get(r.row)!;
        const decision = opts.decisions?.[String(r.row)];
        if (c.type === 'error') {
          s.errors++;
          continue;
        }
        if (c.type === 'dup_in_file') {
          s.skipped++;
          continue;
        }
        // Updating a bundled set: a word an earlier version of the set created or added to takes the new version's
        // meanings, sentences and combinations. A word you edited is left as you made it.
        const target = refreshFrom ? refreshTarget(db, job.language_code, r.entry, refreshFrom, refreshedIds) : null;
        if (target) {
          refreshedIds.add(target.id);
          inVersion.add(target.id);
          if (target.edited) s.keptEdited!++;
          else {
            refreshFromSet(db, target.id, job.language_code, r.entry, job.id, sourceId, now, refreshFrom!);
            s.refreshed!++;
          }
          if (r.entry.frequencyRank != null) {
            db.run('INSERT INTO vocabulary_frequency (entry_id, source_id, rank, import_job_id) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING', target.id, sourceId, r.entry.frequencyRank, job.id);
            ranked = true;
          }
          continue;
        }
        const action = decision ?? (c.type === 'duplicate' ? opts.duplicatePolicy : c.type === 'homograph' ? opts.homographPolicy : 'new');
        if (action === 'skip') {
          if (c.entryId) inVersion.add(c.entryId);
          s.skipped++;
          continue;
        }
        if ((c.type === 'duplicate' || c.type === 'homograph') && action === 'merge' && c.entryId) {
          mergeInto(db, c.entryId, job.language_code, r.entry, job.id, sourceId, now);
          inVersion.add(c.entryId);
          // A merged word also takes the file's frequency rank (a starter word ranked by a frequency set).
          if (r.entry.frequencyRank != null) {
            db.run('INSERT INTO vocabulary_frequency (entry_id, source_id, rank, import_job_id) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING', c.entryId, sourceId, r.entry.frequencyRank, job.id);
            ranked = true;
          }
          s.merged++;
          continue;
        }
        const entryId = createEntry(db, job.language_code, r.entry, now, { custom: false, sourceId, importJobId: job.id });
        inVersion.add(entryId);
        if (r.entry.frequencyRank != null) {
          db.run('INSERT INTO vocabulary_frequency (entry_id, source_id, rank, import_job_id) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING', entryId, sourceId, r.entry.frequencyRank, job.id);
          ranked = true;
        }
        s.created++;
        if (c.type === 'homograph') s.homographsCreated++;
      }
      // Words the earlier version had and this one leaves out.
      if (refreshFrom) {
        const left = leaveOutDroppedWords(db, job.language_code, sourceId, refreshFrom, inVersion, now);
        s.removed = left.removed;
        s.keptStarted = left.keptStarted;
        if (left.changed) ranked = true;
      }
      if (ranked) {
        if (opts.setAsPreferredFrequency) setPreferredFrequencyIfUnset(db, job.language_code, sourceId, now);
        recomputeEffectiveRanks(db, job.language_code);
      }
      db.run("UPDATE import_jobs SET status = 'committed', committed_at = ?, mapping = ?, options = ?, stats = ? WHERE id = ?", now, JSON.stringify(mapping), JSON.stringify(opts), JSON.stringify(s), id);
      return s;
    });
    return { status: 'committed', stats };
  } catch (err) {
    // The transaction rolled back: nothing from this file was written.
    const message = err instanceof Error ? err.message : String(err);
    app.db.tx(() => app.db.run("UPDATE import_jobs SET status = 'failed', error_report = ? WHERE id = ?", JSON.stringify({ message }), id));
    if (err instanceof HttpError) throw err;
    throw new HttpError(422, 'import_failed', `Import failed and was rolled back: ${message}`);
  }
}

/**
 * Merge an imported word into an existing one: new meanings, forms, sentences and combinations are added; nothing is
 * removed. reuse: rows of sentences (by text) that the word showed before and may keep, with their practice history.
 */
function mergeInto(db: Db, entryId: number, language: LanguageCode, input: EntryInput, jobId: string, sourceId: number, now: number, reuse?: Map<string, number>) {
  const maxOrder = db.get<{ m: number | null }>('SELECT MAX(sense_order) AS m FROM vocabulary_senses WHERE entry_id = ?', entryId)?.m ?? -1;
  const existingKeys = new Set(
    db.all<{ text_key: string }>('SELECT t.text_key FROM vocabulary_translations t JOIN vocabulary_senses s ON s.id = t.sense_id WHERE s.entry_id = ?', entryId).map((r) => r.text_key),
  );
  let order = maxOrder + 1;
  // Meanings also match on their first wording ("to want, to wish" is the stored "to want"), so a set whose glosses
  // were reworded does not add a second copy of a meaning a word already has.
  const firstWording = (g: string) => englishCore(g.split(/[,;(]/)[0] ?? '');
  const byFirst = new Map<string, number>();
  for (const r of db.all<{ id: number; gloss: string }>('SELECT id, gloss FROM vocabulary_senses WHERE entry_id = ? ORDER BY sense_order', entryId)) {
    const k = firstWording(r.gloss);
    if (k && !byFirst.has(k)) byFirst.set(k, r.id);
  }
  // The stored meaning each imported meaning became, so sentences link to the right one.
  const senseIds: Array<number | null> = [];
  for (const s of input.senses) {
    const keys = [s.gloss, ...(s.translations ?? [])].map((t) => matchKey(t, 'en'));
    const sameFirst = byFirst.get(firstWording(s.gloss));
    if (keys.some((k) => existingKeys.has(k)) || sameFirst != null) {
      // Same meaning: add any new alternative translations to the matching sense.
      const senseId =
        db.get<{ sense_id: number }>(
          'SELECT t.sense_id FROM vocabulary_translations t JOIN vocabulary_senses s ON s.id = t.sense_id WHERE s.entry_id = ? AND t.text_key IN (SELECT value FROM json_each(?)) LIMIT 1',
          entryId,
          JSON.stringify(keys),
        )?.sense_id ?? sameFirst!;
      for (const t of [s.gloss, ...(s.translations ?? [])]) {
        db.run('INSERT INTO vocabulary_translations (sense_id, text, text_key, import_job_id) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING', senseId, t, matchKey(t, 'en'), jobId);
      }
      senseIds.push(senseId);
      continue;
    }
    const senseId = Number(db.run('INSERT INTO vocabulary_senses (entry_id, sense_order, gloss, definition, note, import_job_id) VALUES (?, ?, ?, ?, ?, ?)', entryId, order++, s.gloss, s.definition ?? null, s.note ?? null, jobId).lastInsertRowid);
    for (const t of [s.gloss, ...(s.translations ?? [])]) {
      db.run('INSERT INTO vocabulary_translations (sense_id, text, text_key, import_job_id) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING', senseId, t, matchKey(t, 'en'), jobId);
      existingKeys.add(matchKey(t, 'en'));
    }
    senseIds.push(senseId);
  }
  const senseOf = (x: NonNullable<EntryInput['examples']>[number]) => (x.sense != null ? senseIds[x.sense] ?? null : null);
  // A table the word lacks is added; its forms join the word's forms (and label forms stored without tags).
  let paradigm = loadParadigm(db, entryId);
  if (!paradigm && input.paradigm) {
    paradigm = input.paradigm;
    writeParadigm(db, entryId, paradigm, jobId, now);
  }
  // Existing rows are matched by stressed spelling; an untagged, unstressed row takes the first table form it spells.
  const rows = db.all<{ id: number; form: string; form_key: string; display: string | null; tags: string }>('SELECT id, form, form_key, display, tags FROM vocabulary_forms WHERE entry_id = ?', entryId);
  const claimed = new Set<number>();
  for (const f of mergedForms(language, paradigm, input.forms)) {
    const form = stripStress(f.form);
    if (!form) continue;
    const k = matchKey(form, language);
    const shown = (f.display ?? f.form).normalize('NFC');
    const same = rows.find((r) => (r.display ?? r.form).normalize('NFC') === shown);
    if (same) {
      if (same.tags === '[]' && f.tags.length) db.run('UPDATE vocabulary_forms SET tags = ? WHERE id = ?', JSON.stringify(f.tags), same.id);
      claimed.add(same.id);
      continue;
    }
    const bare = rows.find((r) => r.form_key === k && !r.display && r.tags === '[]' && !claimed.has(r.id));
    if (bare) {
      db.run('UPDATE vocabulary_forms SET display = ?, tags = ? WHERE id = ?', shown !== form ? shown : null, JSON.stringify(f.tags), bare.id);
      claimed.add(bare.id);
      continue;
    }
    if (rows.some((r) => r.form_key === k && !r.display) && shown === form) continue; // already there, unstressed
    db.run('INSERT INTO vocabulary_forms (entry_id, form, form_key, display, tags, import_job_id) VALUES (?, ?, ?, ?, ?, ?)', entryId, form, k, shown !== form ? shown : null, JSON.stringify(f.tags ?? []), jobId);
  }
  let exOrder = (db.get<{ m: number | null }>('SELECT MAX(example_order) AS m FROM entry_examples WHERE entry_id = ?', entryId)?.m ?? -1) + 1;
  for (const x of input.examples ?? []) {
    const text = stripStress(x.text);
    const have = db.get<{ sentence_id: number; sense_id: number | null }>('SELECT ee.sentence_id, ee.sense_id FROM entry_examples ee JOIN example_sentences s ON s.id = ee.sentence_id WHERE ee.entry_id = ? AND s.text = ?', entryId, text);
    if (have) {
      // Already there: it only gains the meaning it shows, if it had none.
      if (have.sense_id == null && senseOf(x) != null) db.run('UPDATE entry_examples SET sense_id = ? WHERE entry_id = ? AND sentence_id = ?', senseOf(x), entryId, have.sentence_id);
      continue;
    }
    const display = x.text !== text ? x.text : null;
    let sid = reuse?.get(text);
    if (sid != null) {
      reuse!.delete(text);
      db.run('UPDATE example_sentences SET display = ?, translation = ?, source_id = ?, source_ref = ?, import_job_id = ? WHERE id = ?', display, x.translation ?? null, x.sourceId ?? sourceId, x.sourceRef ?? null, jobId, sid);
    } else {
      sid = Number(
        db.run(
          'INSERT INTO example_sentences (language_code, text, display, translation, source_id, source_ref, import_job_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          language,
          text,
          display,
          x.translation ?? null,
          x.sourceId ?? sourceId,
          x.sourceRef ?? null,
          jobId,
          now,
        ).lastInsertRowid,
      );
    }
    const target = x.target ? stripStress(x.target) : null;
    const range = target ? findTarget(text, target) : null;
    db.run(
      'INSERT INTO entry_examples (entry_id, sentence_id, sense_id, target, target_start, target_end, example_order) VALUES (?, ?, ?, ?, ?, ?, ?)',
      entryId,
      sid,
      senseOf(x),
      range ? text.slice(range[0], range[1]) : null,
      range?.[0] ?? null,
      range?.[1] ?? null,
      exOrder++,
    );
  }
  // Combinations and related expressions the word lacks are added.
  for (const x of input.expressions ?? []) {
    const t = x.text?.trim();
    if (!t || db.get('SELECT 1 FROM related_expressions WHERE entry_id = ? AND text = ?', entryId, t)) continue;
    db.run('INSERT INTO related_expressions (entry_id, text, translation, kind, import_job_id) VALUES (?, ?, ?, ?, ?)', entryId, t, x.translation ?? null, expressionKind(x.kind), jobId);
  }
  for (const t of input.tags ?? []) db.run('INSERT INTO entry_tags (entry_id, tag_id) VALUES (?, ?) ON CONFLICT DO NOTHING', entryId, tagId(db, t));
  db.run('UPDATE vocabulary_entries SET version = version + 1, updated_at = ? WHERE id = ?', now, entryId);
}

/**
 * For an update of a bundled set: the existing word that an earlier load of the set (one of oldJobs) created or added
 * to. edited: the word was edited since, so none of the earlier load's content is left in it.
 */
function refreshTarget(db: Db, language: LanguageCode, entry: EntryInput, oldJobs: string, done: Set<number>): { id: number; edited: boolean } | null {
  const matches = existingMatches(db, language, matchKey(stripStress(entry.lemma), language), normalizePos(entry.pos));
  const withSetContent = matches.filter(
    (m) =>
      !done.has(m.id) &&
      db.get(
        `SELECT 1 FROM vocabulary_senses WHERE entry_id = ? AND import_job_id IN (SELECT value FROM json_each(?))
         UNION ALL
         SELECT 1 FROM entry_examples ee JOIN example_sentences s ON s.id = ee.sentence_id WHERE ee.entry_id = ? AND s.import_job_id IN (SELECT value FROM json_each(?))
         LIMIT 1`,
        m.id,
        oldJobs,
        m.id,
        oldJobs,
      ),
  );
  if (withSetContent.length > 1) {
    // Homographs (banco "bench" and banco "bank"): the one whose meanings this row shares, not simply the first.
    const firstWording = (g: string) => englishCore(g.split(/[,;(]/)[0] ?? '');
    const keys = new Set(entry.senses.flatMap((x) => [x.gloss, ...(x.translations ?? [])]).map((t) => matchKey(t, 'en')));
    const firsts = new Set(entry.senses.map((x) => firstWording(x.gloss)).filter(Boolean));
    const score = (id: number) =>
      db.all<{ text_key: string }>('SELECT t.text_key FROM vocabulary_translations t JOIN vocabulary_senses s ON s.id = t.sense_id WHERE s.entry_id = ?', id).filter((r) => keys.has(r.text_key)).length +
      db.all<{ gloss: string }>('SELECT gloss FROM vocabulary_senses WHERE entry_id = ?', id).filter((r) => firsts.has(firstWording(r.gloss))).length;
    const best = withSetContent.map((m) => ({ id: m.id, score: score(m.id) })).reduce((a, b) => (b.score > a.score ? b : a));
    return { id: best.id, edited: false };
  }
  if (withSetContent.length) return { id: withSetContent[0].id, edited: false };
  for (const m of matches) {
    if (done.has(m.id)) continue;
    if (db.get('SELECT 1 FROM vocabulary_entries WHERE id = ? AND import_job_id IN (SELECT value FROM json_each(?))', m.id, oldJobs)) return { id: m.id, edited: true };
  }
  return null;
}

/**
 * Update a word from a newer version of a bundled set: the earlier version's meanings, sentences and combinations are
 * replaced by the new version's. Content from anywhere else (a starter set, your own imports) stays. A sentence the
 * new version keeps keeps its row, so its practice history stays with it.
 */
function refreshFromSet(db: Db, entryId: number, language: LanguageCode, input: EntryInput, jobId: string, sourceId: number, now: number, oldJobs: string) {
  // A word the set created takes the set's written form too (Ukrainian Москва́, which 1.8.2 wrote in lower case). A
  // word you edited never comes here: saving it takes the set's meanings and sentences out of the set's hands.
  db.run('UPDATE vocabulary_entries SET display = ? WHERE id = ? AND import_job_id IN (SELECT value FROM json_each(?))', input.display?.trim() || null, entryId, oldJobs);
  db.run('DELETE FROM vocabulary_senses WHERE entry_id = ? AND import_job_id IN (SELECT value FROM json_each(?))', entryId, oldJobs);
  db.run('DELETE FROM related_expressions WHERE entry_id = ? AND import_job_id IN (SELECT value FROM json_each(?))', entryId, oldJobs);
  // The set's forms are replaced too, so a version that drops a misspelt or wrong form (miec, juz, a crude word listed
  // under на) takes it out of the word; forms you added stay (1.8.5).
  db.run('DELETE FROM vocabulary_forms WHERE entry_id = ? AND import_job_id IN (SELECT value FROM json_each(?))', entryId, oldJobs);
  const old = db.all<{ id: number; text: string }>(
    'SELECT s.id, s.text FROM entry_examples ee JOIN example_sentences s ON s.id = ee.sentence_id WHERE ee.entry_id = ? AND s.import_job_id IN (SELECT value FROM json_each(?))',
    entryId,
    oldJobs,
  );
  for (const r of old) db.run('DELETE FROM entry_examples WHERE entry_id = ? AND sentence_id = ?', entryId, r.id);
  const reuse = new Map(old.filter((r) => !db.get('SELECT 1 FROM entry_examples WHERE sentence_id = ?', r.id)).map((r) => [r.text, r.id]));
  mergeInto(db, entryId, language, input, jobId, sourceId, now, reuse);
  for (const r of old) if (!db.get('SELECT 1 FROM entry_examples WHERE sentence_id = ?', r.id)) db.run('DELETE FROM example_sentences WHERE id = ?', r.id);
}

/**
 * For an update of a bundled set: the words an earlier version ranked that the new version leaves out (words taken
 * out as crude, say). A word that came from the set, that you haven't started and that you haven't added to is
 * removed: deleted outright, or marked deleted when a study session refers to it (so the session and its history stay
 * whole). A word you've started or added to stays, with your progress and its meanings, but leaves the set: it loses
 * the set's rank, sentences and combinations. A word that another set or import brought in loses the same, and keeps
 * its meanings. kept: the words the new version has. keptStarted counts the set's words that stay because of you.
 */
function leaveOutDroppedWords(db: Db, language: LanguageCode, sourceId: number, oldJobs: string, kept: Set<number>, now: number): { removed: number; keptStarted: number; changed: number } {
  const candidates = db
    .all<{ id: number; fromSet: number | null }>(
      `SELECT DISTINCT e.id, e.import_job_id IN (SELECT value FROM json_each(?)) AS fromSet
         FROM vocabulary_entries e JOIN vocabulary_frequency f ON f.entry_id = e.id
        WHERE e.language_code = ? AND e.deleted_at IS NULL AND (f.source_id = ? OR f.import_job_id IN (SELECT value FROM json_each(?)))`,
      oldJobs,
      language,
      sourceId,
      oldJobs,
    )
    .filter((c) => !kept.has(c.id));
  let removed = 0;
  let keptStarted = 0;
  for (const c of candidates) {
    // Started: studied, practiced or marked by you. (A word only planned in a session is not started.)
    const started = db.get(
      `SELECT 1 FROM learning_items li
        WHERE li.entry_id = ? AND (li.status IN ('introduced', 'active', 'known') OR li.is_favorite = 1 OR li.is_difficult = 1
          OR EXISTS (SELECT 1 FROM exercise_attempts a WHERE a.item_id = li.id)
          OR EXISTS (SELECT 1 FROM review_logs r WHERE r.item_id = li.id))
       UNION ALL SELECT 1 FROM practice_attempts p WHERE p.entry_id = ?
       LIMIT 1`,
      c.id,
      c.id,
    );
    // Other content: a meaning from you or another import, a sentence you wrote, a note, a recording.
    const yours = db.get(
      `SELECT 1 FROM vocabulary_senses WHERE entry_id = ? AND (import_job_id IS NULL OR import_job_id NOT IN (SELECT value FROM json_each(?)))
       UNION ALL SELECT 1 FROM entry_examples ee JOIN example_sentences s ON s.id = ee.sentence_id WHERE ee.entry_id = ? AND s.import_job_id IS NULL
       UNION ALL SELECT 1 FROM entry_user_data WHERE entry_id = ? AND (COALESCE(note, '') != '' OR COALESCE(mnemonic, '') != '')
       UNION ALL SELECT 1 FROM pronunciation_records WHERE entry_id = ? AND provider = 'user'
       LIMIT 1`,
      c.id,
      oldJobs,
      c.id,
      c.id,
      c.id,
    );
    if (c.fromSet && !started && !yours) {
      // A session that planned the word, finished or not, keeps its exercises: the word is marked deleted instead.
      const inSession = db.get('SELECT 1 FROM session_exercises x JOIN learning_items li ON li.id = x.item_id WHERE li.entry_id = ? LIMIT 1', c.id);
      if (inSession) {
        db.run('UPDATE vocabulary_entries SET deleted_at = ?, version = version + 1, updated_at = ? WHERE id = ?', now, now, c.id);
      } else {
        const setSentences = db.all<{ id: number }>(
          'SELECT s.id FROM entry_examples ee JOIN example_sentences s ON s.id = ee.sentence_id WHERE ee.entry_id = ? AND s.import_job_id IN (SELECT value FROM json_each(?))',
          c.id,
          oldJobs,
        );
        db.run('DELETE FROM vocabulary_entries WHERE id = ?', c.id); // meanings, links, rank and learning item go with it
        for (const r of setSentences) if (!db.get('SELECT 1 FROM entry_examples WHERE sentence_id = ?', r.id)) db.run('DELETE FROM example_sentences WHERE id = ?', r.id);
      }
      removed++;
      continue;
    }
    // The word stays, outside the set: it keeps its meanings (yours may share one with the set) but not the set's
    // rank, sentences or combinations.
    const setSentences = db.all<{ id: number }>(
      'SELECT s.id FROM entry_examples ee JOIN example_sentences s ON s.id = ee.sentence_id WHERE ee.entry_id = ? AND s.import_job_id IN (SELECT value FROM json_each(?))',
      c.id,
      oldJobs,
    );
    db.run('DELETE FROM vocabulary_frequency WHERE entry_id = ? AND (source_id = ? OR import_job_id IN (SELECT value FROM json_each(?)))', c.id, sourceId, oldJobs);
    db.run('DELETE FROM related_expressions WHERE entry_id = ? AND import_job_id IN (SELECT value FROM json_each(?))', c.id, oldJobs);
    for (const r of setSentences) {
      db.run('DELETE FROM entry_examples WHERE entry_id = ? AND sentence_id = ?', c.id, r.id);
      if (!db.get('SELECT 1 FROM entry_examples WHERE sentence_id = ?', r.id)) db.run('DELETE FROM example_sentences WHERE id = ?', r.id);
    }
    db.run('UPDATE vocabulary_entries SET version = version + 1, updated_at = ? WHERE id = ?', now, c.id);
    if (started || (c.fromSet && yours)) keptStarted++;
  }
  return { removed, keptStarted, changed: candidates.length };
}

/** Undo a committed import: removes entries it created that have no learning progress, and data it merged into existing words. */
export function undoImport(app: App, id: string, now: number) {
  const job = loadJob(app, id);
  if (job.status !== 'committed') throw new HttpError(409, 'not_committed', 'Only committed imports can be undone.');
  if ((json<{ refreshed?: number }>(job.stats, {}).refreshed ?? 0) > 0) {
    throw new HttpError(409, 'not_undoable', 'This update replaced meanings and sentences, so it can’t be undone. To go back, restore the backup made just before it (Settings, Backups).');
  }
  const db = app.db;
  return db.tx(() => {
    const created = db.all<{ id: number }>('SELECT id FROM vocabulary_entries WHERE import_job_id = ?', id);
    let removed = 0;
    let kept = 0;
    for (const e of created) {
      const progress = db.get(
        "SELECT 1 FROM learning_items li WHERE li.entry_id = ? AND (li.status IN ('introduced', 'active') OR EXISTS (SELECT 1 FROM exercise_attempts a WHERE a.item_id = li.id))",
        e.id,
      );
      if (progress) {
        kept++;
        continue;
      }
      db.run('DELETE FROM learning_items WHERE entry_id = ?', e.id);
      db.run('DELETE FROM vocabulary_entries WHERE id = ?', e.id);
      removed++;
    }
    const keptIds = JSON.stringify(created.map((e) => e.id));
    // Meanings it added to other words go, unless they are all a word has left (a word never ends up without a meaning).
    db.run(
      `DELETE FROM vocabulary_senses WHERE import_job_id = ? AND entry_id NOT IN (SELECT value FROM json_each(?))
         AND EXISTS (SELECT 1 FROM vocabulary_senses o WHERE o.entry_id = vocabulary_senses.entry_id AND (o.import_job_id IS NULL OR o.import_job_id != ?))`,
      id,
      keptIds,
      id,
    );
    // Translations it added to other meanings go; those of its own meanings that stayed stay with them.
    db.run(
      `DELETE FROM vocabulary_translations WHERE import_job_id = ?
         AND sense_id NOT IN (SELECT id FROM vocabulary_senses WHERE entry_id IN (SELECT value FROM json_each(?)))
         AND sense_id NOT IN (SELECT id FROM vocabulary_senses WHERE import_job_id = ?)`,
      id,
      keptIds,
      id,
    );
    db.run('DELETE FROM vocabulary_forms WHERE import_job_id = ? AND entry_id NOT IN (SELECT value FROM json_each(?))', id, keptIds);
    db.run('DELETE FROM entry_paradigms WHERE import_job_id = ? AND entry_id NOT IN (SELECT value FROM json_each(?))', id, keptIds);
    db.run('DELETE FROM related_expressions WHERE import_job_id = ? AND entry_id NOT IN (SELECT value FROM json_each(?))', id, keptIds);
    db.run('DELETE FROM vocabulary_frequency WHERE import_job_id = ? AND entry_id NOT IN (SELECT value FROM json_each(?))', id, keptIds);
    db.run('DELETE FROM example_sentences WHERE import_job_id = ? AND id NOT IN (SELECT sentence_id FROM entry_examples WHERE entry_id IN (SELECT value FROM json_each(?)))', id, keptIds);
    recomputeEffectiveRanks(db, job.language_code);
    db.run("UPDATE import_jobs SET status = 'undone', undone_at = ? WHERE id = ?", now, id);
    return { removed, keptWithProgress: kept };
  });
}

// ------------------------------------------------------------------ frequency lists

function frequencyRows(app: App, job: JobRow, mapping: Mapping) {
  const text = readJobText(app, job);
  const table = parseTable(job.format === 'csv' || job.format === 'tsv' || job.format === 'json' || job.format === 'jsonl' ? job.format : 'frequency', text);
  const m: Mapping = Object.keys(mapping).length ? mapping : { lemma: 'word', rank: table.columns.includes('rank') ? 'rank' : undefined, count: table.columns.includes('count') ? 'count' : undefined };
  const rows = table.rows
    .map((r, i) => ({ row: i + 1, word: (r[m.lemma ?? 'word'] ?? '').trim(), rank: m.rank ? Number(r[m.rank]) : NaN, count: m.count ? Number(String(r[m.count]).replace(/[, ]/g, '')) : NaN }))
    .filter((r) => r.word);
  if (rows.some((r) => !Number.isFinite(r.rank))) {
    // Derive ranks from counts (descending) or from file order.
    const hasCounts = rows.every((r) => Number.isFinite(r.count));
    const sorted = hasCounts ? [...rows].sort((a, b) => b.count - a.count) : rows;
    sorted.forEach((r, i) => (r.rank = i + 1));
  }
  return rows;
}

function matchFrequency(db: Db, language: LanguageCode, rows: ReturnType<typeof frequencyRows>) {
  const best = new Map<number, { rank: number; count: number | null; form: string }>();
  let matchedRows = 0;
  for (const r of rows) {
    const key = matchKey(r.word, language);
    const ids = new Set<number>([
      ...db.all<{ id: number }>('SELECT id FROM vocabulary_entries WHERE language_code = ? AND lemma_key = ? AND deleted_at IS NULL', language, key).map((x) => x.id),
      ...db.all<{ id: number }>(
        'SELECT f.entry_id AS id FROM vocabulary_forms f JOIN vocabulary_entries e ON e.id = f.entry_id WHERE f.form_key = ? AND e.language_code = ? AND e.deleted_at IS NULL',
        key,
        language,
      ).map((x) => x.id),
    ]);
    if (ids.size) matchedRows++;
    // A lemma takes the best (lowest) rank among its matching surface forms.
    for (const id of ids) {
      const prev = best.get(id);
      if (!prev || r.rank < prev.rank) best.set(id, { rank: r.rank, count: Number.isFinite(r.count) ? r.count : null, form: r.word });
    }
  }
  return { best, matchedRows };
}

function validateFrequency(app: App, job: JobRow, mapping: Mapping, opts: ImportOptions) {
  const rows = frequencyRows(app, job, mapping);
  const { best, matchedRows } = matchFrequency(app.db, job.language_code, rows);
  const report = {
    total: rows.length,
    matchedRows,
    entriesRanked: best.size,
    unmatched: rows.length - matchedRows,
    note: 'Frequency lists rank existing words; words without an English meaning are not created. Surface forms are matched to lemmas through stored inflected forms.',
  };
  app.db.tx(() => app.db.run("UPDATE import_jobs SET status = 'validated', mapping = ?, options = ?, stats = ? WHERE id = ?", JSON.stringify(mapping), JSON.stringify(opts), JSON.stringify({ validation: report }), job.id));
  return { report };
}

function commitFrequency(app: App, job: JobRow, mapping: Mapping, opts: ImportOptions, now: number) {
  const db = app.db;
  const rows = frequencyRows(app, job, mapping);
  const stats = db.tx(() => {
    const sourceId = ensureSource(db, job.language_code, opts, opts.sourceName ?? `Frequency list: ${job.file_name ?? job.id}`, opts.frequencyKind ?? 'frequency_mixed', now);
    const { best, matchedRows } = matchFrequency(db, job.language_code, rows);
    for (const [entryId, f] of best) {
      db.run(
        `INSERT INTO vocabulary_frequency (entry_id, source_id, rank, count, matched_form, import_job_id) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(entry_id, source_id) DO UPDATE SET rank = excluded.rank, count = excluded.count, matched_form = excluded.matched_form, import_job_id = excluded.import_job_id`,
        entryId,
        sourceId,
        f.rank,
        f.count,
        f.form,
        job.id,
      );
    }
    if (opts.setAsPreferredFrequency !== false) setPreferredFrequencyIfUnset(db, job.language_code, sourceId, now);
    recomputeEffectiveRanks(db, job.language_code);
    const s = { rows: rows.length, matchedRows, entriesRanked: best.size, sourceId };
    db.run("UPDATE import_jobs SET status = 'committed', committed_at = ?, mapping = ?, options = ?, stats = ? WHERE id = ?", now, JSON.stringify(mapping), JSON.stringify(opts), JSON.stringify(s), job.id);
    return s;
  });
  return { status: 'committed', stats };
}

/** Make this source drive the learning order unless the user already chose one. */
function setPreferredFrequencyIfUnset(db: Db, language: LanguageCode, sourceId: number, now: number) {
  const current = db.get<{ value: string }>("SELECT value FROM language_settings WHERE language_code = ? AND key = 'frequencySourceId'", language);
  if (current && json(current.value, null) != null) return;
  db.run(
    `INSERT INTO language_settings (language_code, key, value, updated_at) VALUES (?, 'frequencySourceId', ?, ?)
     ON CONFLICT(language_code, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    language,
    JSON.stringify(sourceId),
    now,
  );
}

/** Effective frequency rank = rank in the preferred frequency source, else best rank from any source. */
export function recomputeEffectiveRanks(db: Db, language: LanguageCode) {
  const pref = json<number | null>(db.get<{ value: string }>("SELECT value FROM language_settings WHERE language_code = ? AND key = 'frequencySourceId'", language)?.value, null);
  db.run(
    `UPDATE vocabulary_entries SET frequency_rank = COALESCE(
        (SELECT rank FROM vocabulary_frequency f WHERE f.entry_id = vocabulary_entries.id AND f.source_id = ?),
        (SELECT MIN(rank) FROM vocabulary_frequency f WHERE f.entry_id = vocabulary_entries.id))
      WHERE language_code = ?`,
    pref,
    language,
  );
}

// ------------------------------------------------------------------ starter sets

export function starterFile(app: App, language: LanguageCode) {
  return path.join(app.config.root, 'data', 'starter', `${language}.json`);
}

export function importStarter(app: App, language: LanguageCode, now: number) {
  const file = starterFile(app, language);
  if (!existsSync(file)) throw new HttpError(404, 'not_found', `No starter set is bundled for ${LANGUAGES[language].name}.`);
  const data = readFileSync(file);
  const job = createImportJob(app, { language, kind: 'vocabulary', fileName: `starter-${language}.json`, data, now });
  try {
    return commitImport(app, job.id, {}, { duplicatePolicy: 'skip', homographPolicy: 'new' }, now);
  } finally {
    dropStoredCopy(app, job.id);
  }
}

/**
 * Link sentences an earlier version loaded from the starter set to the meanings they show, using the bundled file
 * (which names each sentence's meaning). Only sentences without a meaning are touched. Returns how many were linked.
 */
export function linkStarterSentences(app: App, language: LanguageCode): number {
  const file = starterFile(app, language);
  if (!existsSync(file)) return 0;
  const jobs = app.db.all<{ id: string }>("SELECT id FROM import_jobs WHERE language_code = ? AND file_name = ? AND status = 'committed'", language, `starter-${language}.json`).map((j) => j.id);
  if (!jobs.length) return 0;
  const doc = JSON.parse(readFileSync(file, 'utf8'));
  const meaning = new Map<string, string>(); // lemma + sentence -> gloss of the meaning it shows
  for (const e of doc.entries ?? []) {
    for (const x of e.examples ?? []) {
      const g = Number.isInteger(x.sense) ? e.senses?.[x.sense]?.gloss : null;
      if (g) meaning.set(`${stripStress(e.lemma)}\t${stripStress(x.text)}`, g);
    }
  }
  const rows = app.db.all<{ entry_id: number; sentence_id: number; lemma: string; text: string }>(
    `SELECT ee.entry_id, ee.sentence_id, e.lemma, s.text FROM entry_examples ee
       JOIN example_sentences s ON s.id = ee.sentence_id JOIN vocabulary_entries e ON e.id = ee.entry_id
      WHERE ee.sense_id IS NULL AND e.language_code = ? AND s.import_job_id IN (SELECT value FROM json_each(?))`,
    language,
    JSON.stringify(jobs),
  );
  let linked = 0;
  app.db.tx(() => {
    for (const r of rows) {
      const g = meaning.get(`${r.lemma}\t${r.text}`);
      if (!g) continue;
      const sense = app.db.get<{ id: number }>('SELECT id FROM vocabulary_senses WHERE entry_id = ? AND gloss = ? ORDER BY sense_order LIMIT 1', r.entry_id, g);
      if (!sense) continue;
      app.db.run('UPDATE entry_examples SET sense_id = ? WHERE entry_id = ? AND sentence_id = ?', sense.id, r.entry_id, r.sentence_id);
      linked++;
    }
  });
  return linked;
}

/** A bundled set ships with the app, so the copy an import job keeps of it is not needed once the job has run. */
function dropStoredCopy(app: App, jobId: string) {
  const j = app.db.get<{ stored_file: string | null }>('SELECT stored_file FROM import_jobs WHERE id = ?', jobId);
  if (!j?.stored_file) return;
  rmSync(j.stored_file, { force: true });
  app.db.tx(() => app.db.run('UPDATE import_jobs SET stored_file = NULL WHERE id = ?', jobId));
}

/** Remove the copies earlier versions kept of bundled sets they loaded (about 15 MB each). Returns how many. */
export function removeBundledSetCopies(app: App): number {
  const jobs = app.db.all<{ id: string; stored_file: string }>(
    "SELECT id, stored_file FROM import_jobs WHERE stored_file IS NOT NULL AND status IN ('committed', 'failed', 'undone') AND (file_name LIKE 'frequency-%.json' OR file_name LIKE 'starter-%.json')",
  );
  for (const j of jobs) dropStoredCopy(app, j.id);
  return jobs.length;
}

export function listJobs(app: App, language?: LanguageCode) {
  return app.db
    .all<any>(`SELECT id, language_code, kind, file_name, format, status, stats, created_at, committed_at, undone_at FROM import_jobs ${language ? 'WHERE language_code = ?' : ''} ORDER BY created_at DESC LIMIT 50`, ...(language ? [language] : []))
    .map((j) => ({ ...j, stats: json(j.stats, null) }));
}

// ------------------------------------------------------------------ frequency sets (data/frequency)

export interface FrequencySetInfo {
  words: number;
  name: string;
  bySource: Record<string, number>;
  skipped: number;
  builtAt: string;
}

let frequencyIndexCache: { file: string; mtimeMs: number; data: Record<string, FrequencySetInfo> } | null = null;

function frequencyDir(app: App) {
  return path.join(app.config.root, 'data', 'frequency');
}

export function frequencySetFile(app: App, language: LanguageCode) {
  return path.join(frequencyDir(app), `${language}.json`);
}

/** The build's summary of the bundled sets (data/frequency/index.json), re-read when it changes. */
export function frequencySetIndex(app: App): Record<string, FrequencySetInfo> {
  const file = path.join(frequencyDir(app), 'index.json');
  if (!existsSync(file)) return {};
  const mtimeMs = statSync(file).mtimeMs;
  if (!frequencyIndexCache || frequencyIndexCache.file !== file || frequencyIndexCache.mtimeMs !== mtimeMs) {
    frequencyIndexCache = { file, mtimeMs, data: JSON.parse(readFileSync(file, 'utf8')) };
  }
  return frequencyIndexCache.data;
}

const versionCache = new Map<string, { mtimeMs: number; size: number; version: string }>();

/** The version of a bundled set file: the build's version from index.json, or a hash of the file. */
export function frequencySetVersion(app: App, language: LanguageCode): string | null {
  const file = frequencySetFile(app, language);
  if (!existsSync(file)) return null;
  const fromIndex = (frequencySetIndex(app)[language] as { version?: string } | undefined)?.version;
  if (fromIndex) return fromIndex;
  const st = statSync(file);
  const hit = versionCache.get(file);
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.version;
  const version = createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 12);
  versionCache.set(file, { mtimeMs: st.mtimeMs, size: st.size, version });
  return version;
}

const setJobs = (app: App, language: LanguageCode) =>
  app.db.all<{ id: string; options: string | null }>(
    "SELECT id, options FROM import_jobs WHERE language_code = ? AND file_name = ? AND status = 'committed' ORDER BY committed_at",
    language,
    `frequency-${language}.json`,
  );

/**
 * Whether a "most frequent words" set is bundled for a language, whether it has been loaded, and whether the bundled
 * file is newer than the version loaded (a corrected set shipped with an update of the app).
 */
export function frequencySetStatus(app: App, language: LanguageCode): { words: number; name: string; loaded: boolean; updateAvailable: boolean } | null {
  const info = frequencySetIndex(app)[language];
  if (!info || !existsSync(frequencySetFile(app, language))) return null;
  const jobs = setJobs(app, language);
  const last = jobs.at(-1);
  const loadedVersion = last ? json<Partial<ImportOptions>>(last.options, {}).setVersion ?? null : null;
  return { words: info.words, name: info.name, loaded: jobs.length > 0, updateAvailable: jobs.length > 0 && loadedVersion !== frequencySetVersion(app, language) };
}

/**
 * Load the bundled most-frequent-words set. Words that already exist (from a starter set or an earlier
 * import) are merged, never duplicated: they gain the set's senses, forms and frequency rank.
 */
export function importFrequencySet(app: App, language: LanguageCode, now: number) {
  const file = frequencySetFile(app, language);
  if (!existsSync(file)) throw new HttpError(404, 'not_found', `No frequency set is bundled for ${LANGUAGES[language].name}.`);
  const job = createImportJob(app, { language, kind: 'vocabulary', fileName: `frequency-${language}.json`, data: readFileSync(file), now });
  try {
    return commitImport(app, job.id, {}, { duplicatePolicy: 'merge', homographPolicy: 'merge', setAsPreferredFrequency: true, setVersion: frequencySetVersion(app, language) ?? undefined }, now);
  } finally {
    dropStoredCopy(app, job.id);
  }
}

/**
 * Update a loaded set to the bundled version. Words that came from the earlier version take the new version's
 * meanings, sentences and combinations; words you edited stay as you made them; words the new version leaves out are
 * removed unless you've started or added to them; learning progress is kept. A backup is made first, since the update
 * can't be undone like an import.
 */
export async function updateFrequencySet(app: App, language: LanguageCode, now: number) {
  const status = frequencySetStatus(app, language);
  if (!status) throw new HttpError(404, 'not_found', `No frequency set is bundled for ${LANGUAGES[language].name}.`);
  if (!status.loaded) return importFrequencySet(app, language, now);
  if (!status.updateAvailable) return { status: 'up_to_date', stats: { created: 0, merged: 0, skipped: 0, errors: 0, homographsCreated: 0, refreshed: 0, keptEdited: 0, removed: 0, keptStarted: 0 } };
  const backup = await app.backups.create('pre-upgrade', `Before updating the ${LANGUAGES[language].name} word set`);
  const file = frequencySetFile(app, language);
  const refreshFrom = setJobs(app, language).map((j) => j.id);
  const job = createImportJob(app, { language, kind: 'vocabulary', fileName: `frequency-${language}.json`, data: readFileSync(file), now });
  try {
    const r = commitImport(app, job.id, {}, { duplicatePolicy: 'merge', homographPolicy: 'merge', setAsPreferredFrequency: true, setVersion: frequencySetVersion(app, language) ?? undefined, refreshFrom }, now);
    linkStarterSentences(app, language);
    return { ...r, backup: backup.file };
  } finally {
    dropStoredCopy(app, job.id);
  }
}

/** The build report for a bundled set: sources, coverage and every skipped word (Markdown). */
export function frequencySetReport(app: App, language: LanguageCode): string {
  const file = path.join(frequencyDir(app), 'reports', `${language}.md`);
  if (!existsSync(file)) throw new HttpError(404, 'not_found', `No frequency set report for ${LANGUAGES[language].name}.`);
  return readFileSync(file, 'utf8');
}
