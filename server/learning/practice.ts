// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
/**
 * Forms practice (declension / conjugation drills) and sentence cloze practice.
 *
 * Their answers are kept in practice_attempts: items missed recently come back first, then the words whose memory is
 * due, then the ones practiced least recently. Since 2.0.0 an answer about a word being learned is also that word's
 * review under the rules of the review log (scheduleFromPractice in scheduling.ts): at most one review per memory a
 * day, never a word's first one, so extra drilling still cannot inflate a word's review history.
 *
 * The client grades each answer at once with the same shared checker (it receives the AnswerSpec); the
 * server grades again from its own data when the attempt arrives, and that grade is the one recorded.
 */
import type { App } from '../app.ts';
import type { Db } from '../db/database.ts';
import { HttpError, notFound } from '../http/http.ts';
import { checkAnswer, type AnswerSpec, type CheckResult } from '../../shared/answer.ts';
import { cellLabel, drillCells, formsSpec, paradigmForms, personLabel, slavicTense, tenses, type Paradigm } from '../../shared/paradigms.ts';
import type { LanguageCode } from '../../shared/languages.ts';
import { canonical, hideWord, soundVariants, stripStress } from '../../shared/text.ts';
import { localDay } from '../../shared/time.ts';
import { getLanguageSettings, getTimezone } from '../services/settings.ts';
import { AI_SENTENCES, paradigmFromRow, sentenceUrl } from '../vocab/repo.ts';
import { exactOf, matchCase, splitSentence } from './payloads.ts';
import { exactLookup } from './grammar.ts';
import { noNote } from '../../shared/grammar.ts';
import type { ExactCell } from '../../shared/grammar.ts';
import { identifyAttemptSpec, identifySummary, type IdentifySummary } from './identify.ts';
import { comprehensionSummary } from './comprehension.ts';
import { writingSummary } from './writing.ts';
import type { LevelProgress, ReadingLevel } from '../../shared/comprehension.ts';
import { MAX_ANSWER_ACTIVE_MS } from '../../shared/activity.ts';
import { addPracticeTime, practiceUrgency, scheduleFromPractice, updateEvidence } from './scheduling.ts';
import type { CardSkill } from '../../shared/exercises.ts';
import type { Rating } from '../../shared/fsrs.ts';

/** entries: the words of a study session (Comprehensive mode), given as entryIds. */
export type PracticeScope = 'learning' | 'all' | 'entry' | 'entries';
export type PracticeMode = 'forms' | 'cloze' | 'identify';

const MISS = "('incorrect', 'close', 'revealed')";

interface EntryRow {
  id: number;
  lemma: string;
  display: string | null;
  pos: string;
  gloss: string | null;
  frequency_rank: number | null;
}

function scopeJoin(scope: PracticeScope): string {
  return scope === 'learning' ? "JOIN learning_items li ON li.entry_id = e.id AND li.status IN ('introduced', 'active')" : '';
}

/** The WHERE part and its parameter for a single word or a list of words; validates that the word(s) were given. */
function scopeWhere(req: { scope: PracticeScope; entryId?: number | null; entryIds?: number[] | null }): { where: string; params: Array<string | number> } {
  if (req.scope === 'entry') {
    if (!req.entryId) throw new HttpError(422, 'validation_failed', 'Choose a word to practice.');
    return { where: 'AND e.id = ?', params: [req.entryId] };
  }
  if (req.scope === 'entries') {
    if (!req.entryIds?.length) throw new HttpError(422, 'validation_failed', 'Choose the words to practice.');
    return { where: 'AND e.id IN (SELECT value FROM json_each(?))', params: [JSON.stringify(req.entryIds)] };
  }
  return { where: '', params: [] };
}

function shuffle<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const glossOf = (db: Db, entryId: number) => db.get<{ gloss: string }>('SELECT gloss FROM vocabulary_senses WHERE entry_id = ? ORDER BY sense_order LIMIT 1', entryId)?.gloss ?? null;

/**
 * What the word means in a sentence: the meaning the sentence is linked to. A sentence not linked to a meaning names
 * the word's only meaning, or all of its meanings rather than guessing one.
 */
const hideIn = (g: string | null, words: string[], lang: LanguageCode) => (g ? hideWord(g, words, lang) : g);

export function sentenceGloss(db: Db, entryId: number, senseId: number | null): string | null {
  if (senseId != null) {
    const g = db.get<{ gloss: string }>('SELECT gloss FROM vocabulary_senses WHERE id = ? AND entry_id = ?', senseId, entryId)?.gloss;
    if (g) return g;
  }
  const all = db.all<{ gloss: string }>('SELECT gloss FROM vocabulary_senses WHERE entry_id = ? ORDER BY sense_order', entryId).map((r) => r.gloss);
  return all.length ? all.join(' / ') : null;
}

// ------------------------------------------------------------------ forms

export interface FormsItem {
  id: string;
  entryId: number;
  lemma: string;
  display: string;
  gloss: string | null;
  pos: string;
  cell: string;
  label: string;
  /** Verbs: the tense and the pronoun, shown as two lines. */
  tense: { label: string; native: string } | null;
  person: string | null;
  answer: AnswerSpec;
}

function formsItem(language: LanguageCode, e: EntryRow, p: Paradigm, cell: string): FormsItem {
  const [row, col] = cell.split('|');
  // A Spanish or Portuguese tense, or (1.8.4) a Russian, Ukrainian or Polish one; non-finite forms have none.
  const t = tenses(language).find((x) => x.key === row) ?? slavicTense(language, row);
  return {
    id: `${e.id}:${cell}`,
    entryId: e.id,
    lemma: e.lemma,
    display: e.display || e.lemma,
    gloss: e.gloss,
    pos: e.pos,
    cell,
    label: cellLabel(language, cell),
    tense: t ? { label: t.label, native: t.native } : null,
    person: t ? personLabel(language, row, col) : null,
    answer: formsSpec(language, p, cell, e.lemma),
  };
}

export interface FormsRequest {
  language: LanguageCode;
  scope: PracticeScope;
  entryId?: number | null;
  entryIds?: number[] | null;
  tenses?: string[] | null;
  persons?: string[] | null;
  size?: number;
}

/**
 * A batch of form prompts. Words missed recently come first, then the least recently practiced (frequent words
 * first among equals); each word contributes one cell, chosen among its recently missed cells when it has any.
 */
export function formsBatch(app: App, req: FormsRequest, now: number): { items: FormsItem[]; available: number; tables: Record<number, Paradigm> } {
  const db = app.db;
  const size = Math.min(Math.max(req.size ?? 20, 1), 50);
  const sw = scopeWhere(req);
  const where = sw.where;
  const params: Array<string | number> = [req.language, ...sw.params];
  const rows = db.all<EntryRow & { kind: string; data: string; source: string | null; last_at: number | null; last_miss: number | null }>(
    `SELECT e.id, e.lemma, e.display, e.pos, e.frequency_rank, p.kind, p.data, p.source,
            (SELECT MAX(answered_at) FROM practice_attempts a WHERE a.entry_id = e.id AND a.mode = 'forms') AS last_at,
            (SELECT MAX(answered_at) FROM practice_attempts a WHERE a.entry_id = e.id AND a.mode = 'forms' AND a.grade IN ${MISS}) AS last_miss
       FROM vocabulary_entries e JOIN entry_paradigms p ON p.entry_id = e.id ${scopeJoin(req.scope)}
      WHERE e.language_code = ? AND e.deleted_at IS NULL ${where}`,
    ...params,
  );
  const usable = rows
    .map((r) => ({ r, p: paradigmFromRow(r) }))
    .map((x) => ({ ...x, cells: drillCells(req.language, x.p, { tenses: req.tenses, persons: req.persons }) }))
    .filter((x) => x.cells.length);
  if (!usable.length) return { items: [], available: 0, tables: {} };
  // The tables of the words asked about, for the review before the quiz and the feedback after each answer.
  const tablesOf = (items: FormsItem[]) => Object.fromEntries([...new Set(items.map((i) => i.entryId))].map((id) => [id, usable.find((u) => u.r.id === id)!.p]));
  const recent = now - 14 * 86_400_000;
  // Missed lately first, then the words whose memory is due (their answers here are their reviews), then the rest.
  const urgency = practiceUrgency(db, usable.map((u) => u.r.id), now, getTimezone(db, app.config.defaultTimezone));
  usable.sort((a, b) => {
    const am = a.r.last_miss != null && a.r.last_miss >= recent && a.r.last_miss === a.r.last_at ? 0 : 1;
    const bm = b.r.last_miss != null && b.r.last_miss >= recent && b.r.last_miss === b.r.last_at ? 0 : 1;
    const [au, ad] = urgency(a.r.id);
    const [bu, bd] = urgency(b.r.id);
    return am - bm || au - bu || ad - bd || (a.r.last_at ?? 0) - (b.r.last_at ?? 0) || (a.r.frequency_rank ?? 1e9) - (b.r.frequency_rank ?? 1e9);
  });
  const missedCells = (entryId: number) =>
    new Set(
      db
        .all<{ cell: string }>(
          `SELECT cell FROM practice_attempts a WHERE entry_id = ? AND mode = 'forms' AND grade IN ${MISS} AND answered_at >= ?
             AND NOT EXISTS (SELECT 1 FROM practice_attempts b WHERE b.entry_id = a.entry_id AND b.mode = 'forms' AND b.cell = a.cell AND b.answered_at > a.answered_at AND b.grade = 'correct')`,
          entryId,
          recent,
        )
        .map((x) => x.cell),
    );
  const items: FormsItem[] = [];
  if (req.scope === 'entry') {
    const u = usable[0];
    const e = { ...u.r, gloss: glossOf(db, u.r.id) };
    const missed = missedCells(e.id);
    const done = new Set(db.all<{ cell: string }>("SELECT DISTINCT cell FROM practice_attempts WHERE entry_id = ? AND mode = 'forms'", e.id).map((x) => x.cell));
    const order = [...shuffle(u.cells.filter((c) => missed.has(c))), ...shuffle(u.cells.filter((c) => !missed.has(c) && !done.has(c))), ...shuffle(u.cells.filter((c) => !missed.has(c) && done.has(c)))];
    for (const c of order.slice(0, size)) items.push(formsItem(req.language, e, u.p, c));
    return { items, available: u.cells.length, tables: tablesOf(items) };
  }
  // One cell per word first; fill up with second cells when the scope has fewer words than the batch size.
  for (let round = 0; items.length < size && round < 3; round++) {
    for (const u of usable.slice(0, size * 2)) {
      if (items.length >= size) break;
      const taken = new Set(items.filter((i) => i.entryId === u.r.id).map((i) => i.cell));
      if (taken.size !== round) continue;
      const missed = [...missedCells(u.r.id)].filter((c) => u.cells.includes(c) && !taken.has(c));
      const pool = missed.length ? missed : u.cells.filter((c) => !taken.has(c));
      if (!pool.length) continue;
      const cell = pool[Math.floor(Math.random() * pool.length)];
      items.push(formsItem(req.language, { ...u.r, gloss: glossOf(db, u.r.id) }, u.p, cell));
    }
  }
  return { items: shuffle(items), available: usable.length, tables: tablesOf(items) };
}

// ------------------------------------------------------------------ cloze

export interface ClozeItem {
  id: string;
  entryId: number;
  sentenceId: number;
  before: string;
  after: string;
  beforeDisplay?: string;
  afterDisplay?: string;
  target: string;
  translation: string | null;
  lemma: string;
  display: string;
  gloss: string | null;
  pos: string;
  /** The form the gap needs, when the sentence's annotation or the word's table says so unambiguously ("genitive plural"). */
  needed: string | null;
  /** The cell the target fills in this sentence and why (AI-annotated, data/grammar/), when the table confirms it. */
  exact?: ExactCell;
  answer: AnswerSpec;
  choices: string[] | null;
  source: { name: string; url: string | null; ai?: boolean } | null;
}

interface SentenceRow {
  entry_id: number;
  sentence_id: number;
  sense_id: number | null;
  text: string;
  display: string | null;
  translation: string | null;
  target: string;
  target_start: number;
  target_end: number;
  source_ref: string | null;
  source_name: string | null;
  source_url: string | null;
  source_kind: string | null;
}

function loadParadigms(db: Db, ids: number[]): Map<number, Paradigm> {
  if (!ids.length) return new Map();
  return new Map(
    db.all<any>('SELECT * FROM entry_paradigms WHERE entry_id IN (SELECT value FROM json_each(?))', JSON.stringify(ids)).map((r) => [r.entry_id as number, paradigmFromRow(r)]),
  );
}

/** What a gap accepts: the sentence's own word; other forms of the word count as "right word, other form". */
export function clozeSpec(db: Db, language: LanguageCode, entryId: number, lemma: string, target: string, p: Paradigm | null): AnswerSpec {
  const tKey = canonical(target, language);
  const forms = p && !p.indeclinable
    ? paradigmForms(language, p).map((f) => ({ form: stripStress(f.form), tags: f.tags.slice(0, 4) }))
    : db.all<{ form: string; tags: string }>('SELECT form, tags FROM vocabulary_forms WHERE entry_id = ?', entryId).map((f) => ({ form: f.form, tags: JSON.parse(f.tags) as string[] }));
  const otherForms = forms.filter((f) => canonical(f.form, language) !== tKey);
  if (canonical(lemma, language) !== tKey) otherForms.push({ form: stripStress(lemma), tags: ['dictionary form'] });
  const sound = soundVariants(target, language);
  return { lang: language, accepted: [target, ...(sound.free ? sound.variants.map((v) => matchCase(v, target, language)) : [])], otherForms };
}

function neededForm(language: LanguageCode, p: Paradigm | null, target: string): string | null {
  if (!p || p.indeclinable) return null;
  const k = canonical(target, language);
  const cells = Object.entries(p.cells).filter(([, forms]) => forms.some((f) => canonical(f, language) === k)).map(([c]) => c);
  return cells.length === 1 ? cellLabel(language, cells[0]) : null;
}

export interface ClozeRequest {
  language: LanguageCode;
  scope: PracticeScope;
  entryId?: number | null;
  entryIds?: number[] | null;
  choices?: boolean;
  size?: number;
}

/**
 * A batch of gaps. Sentences missed recently come first, then sentences never practiced, then the least recently
 * practiced; frequent words first among equals. One sentence per word, except when practicing a single word.
 */
export function clozeBatch(app: App, req: ClozeRequest, now: number): { items: ClozeItem[]; available: number } {
  const db = app.db;
  const size = Math.min(Math.max(req.size ?? 20, 1), 50);
  const sw = scopeWhere(req);
  const where = sw.where;
  const params: Array<string | number> = [req.language, ...sw.params];
  const recent = now - 14 * 86_400_000;
  const rows = db.all<SentenceRow & { lemma: string; edisplay: string | null; pos: string; frequency_rank: number | null; last_at: number | null; last_grade: string | null }>(
    `SELECT ee.entry_id, ee.sentence_id, ee.sense_id, s.text, s.display, s.translation, ee.target, ee.target_start, ee.target_end, s.source_ref,
            src.name AS source_name, src.url AS source_url, src.kind AS source_kind, e.lemma, e.display AS edisplay, e.pos, e.frequency_rank,
            (SELECT MAX(answered_at) FROM practice_attempts a WHERE a.sentence_id = ee.sentence_id AND a.mode = 'cloze') AS last_at,
            (SELECT grade FROM practice_attempts a WHERE a.sentence_id = ee.sentence_id AND a.mode = 'cloze' ORDER BY answered_at DESC LIMIT 1) AS last_grade
       FROM entry_examples ee
       JOIN vocabulary_entries e ON e.id = ee.entry_id ${scopeJoin(req.scope)}
       JOIN example_sentences s ON s.id = ee.sentence_id
       LEFT JOIN sources src ON src.id = s.source_id
      WHERE e.language_code = ? AND e.deleted_at IS NULL AND ee.target IS NOT NULL AND ee.target_start IS NOT NULL ${where}`,
    ...params,
  );
  if (!rows.length) return { items: [], available: 0 };
  const missed = (r: (typeof rows)[number]) => (r.last_grade && r.last_grade !== 'correct' && (r.last_at ?? 0) >= recent ? 0 : 1);
  // Missed lately first, then the words whose memory is due (their answers here are their reviews), then the rest.
  const urgency = practiceUrgency(db, [...new Set(rows.map((r) => r.entry_id))], now, getTimezone(db, app.config.defaultTimezone));
  const sorted = shuffle(rows).sort((a, b) => {
    const [au, ad] = urgency(a.entry_id);
    const [bu, bd] = urgency(b.entry_id);
    return missed(a) - missed(b) || au - bu || ad - bd || (a.last_at == null ? 0 : 1) - (b.last_at == null ? 0 : 1) || (a.last_at ?? 0) - (b.last_at ?? 0) || (a.frequency_rank ?? 1e9) - (b.frequency_rank ?? 1e9);
  });
  const picked: typeof rows = [];
  const perEntry = new Map<number, number>();
  for (const r of sorted) {
    if (picked.length >= size) break;
    if (req.scope !== 'entry' && (perEntry.get(r.entry_id) ?? 0) >= 1) continue;
    picked.push(r);
    perEntry.set(r.entry_id, (perEntry.get(r.entry_id) ?? 0) + 1);
  }
  const paradigms = loadParadigms(db, [...new Set(picked.map((r) => r.entry_id))]);
  const distractorPool = req.choices
    ? db.all<{ lemma: string; pos: string }>('SELECT lemma, pos FROM vocabulary_entries WHERE language_code = ? AND deleted_at IS NULL AND frequency_rank IS NOT NULL ORDER BY frequency_rank LIMIT 3000', req.language)
    : [];
  const lookup = exactLookup(app, req.language);
  const items = picked.map((r): ClozeItem => {
    const p = paradigms.get(r.entry_id) ?? null;
    const parts = splitSentence({ text: r.text, display: r.display, target: r.target, start: r.target_start, end: r.target_end, translation: r.translation });
    const answer = clozeSpec(db, req.language, r.entry_id, r.lemma, r.target, p);
    const exact = exactOf(req.language, { lemma: r.lemma, paradigm: p }, { text: r.text, target: r.target }, lookup);
    return {
      id: `${r.entry_id}:${r.sentence_id}`,
      entryId: r.entry_id,
      sentenceId: r.sentence_id,
      before: parts.before,
      after: parts.after,
      beforeDisplay: parts.beforeDisplay,
      afterDisplay: parts.afterDisplay,
      target: r.target,
      translation: r.translation,
      lemma: r.lemma,
      display: r.edisplay || r.lemma,
      // The meaning this sentence shows, not just the word's first meaning, without the word itself in it.
      gloss: hideIn(sentenceGloss(db, r.entry_id, r.sense_id), [r.lemma, ...db.all<{ form: string }>('SELECT form FROM vocabulary_forms WHERE entry_id = ?', r.entry_id).map((f) => f.form)], req.language),
      pos: r.pos,
      needed: exact ? (noNote(exact) ? null : cellLabel(req.language, exact.cell)) : neededForm(req.language, p, r.target),
      ...(exact ? { exact } : {}),
      answer,
      choices: req.choices ? clozeChoices(req.language, r.target, r.lemma, r.pos, answer, distractorPool) : null,
      source: r.source_name ? { name: r.source_name, url: sentenceUrl(r.source_ref) ?? r.source_url, ...(r.source_kind === AI_SENTENCES ? { ai: true } : {}) } : null,
    };
  });
  return { items, available: rows.length };
}

/** Four options: the gap's word and, for inflected words, three other forms of it; otherwise three common words of the same kind. */
function clozeChoices(language: LanguageCode, target: string, lemma: string, pos: string, answer: AnswerSpec, pool: Array<{ lemma: string; pos: string }>): string[] {
  const tKey = canonical(target, language);
  const seen = new Set([tKey, ...answer.accepted.map((a) => canonical(a, language)), ...soundVariants(target, language).variants]);
  const out: string[] = [];
  const add = (w: string) => {
    const k = canonical(w, language);
    if (!k || seen.has(k) || w.includes(' ') !== target.includes(' ')) return;
    seen.add(k);
    out.push(matchCase(stripStress(w), target, language));
  };
  for (const f of shuffle((answer.otherForms ?? []).filter((f) => !f.tags?.includes('dictionary form')).map((f) => f.form))) {
    if (out.length >= 3) break;
    add(f);
  }
  if (out.length < 3) add(lemma);
  for (const c of shuffle(pool.filter((x) => x.pos === pos && x.lemma !== lemma))) {
    if (out.length >= 3) break;
    add(c.lemma);
  }
  return shuffle([target, ...out.slice(0, 3)]);
}

// ------------------------------------------------------------------ attempts

export interface AttemptInput {
  opId: string;
  mode: PracticeMode;
  entryId: number;
  cell?: string | null;
  sentenceId?: number | null;
  response?: string | null;
  revealed?: boolean;
  /** The answer came from the multiple-choice options. */
  choice?: boolean;
  answeredAt: number;
  deviceId?: string | null;
  /** Active time on the Practice page since the previous answer; none from a round inside a session (the session counts it). */
  activeMs?: number | null;
  /** Hints shown before the answer (Identify's hint): a right answer then counts as Hard. */
  hintsUsed?: number | null;
  /** The study session whose practice slot asked (kept with the scheduling event). */
  sessionId?: string | null;
}

export interface AttemptResult {
  grade: 'correct' | 'close' | 'incorrect' | 'revealed';
  expected: string;
  message: string;
  code: string;
  duplicate?: boolean;
  /** The answer was the word's scheduling event today (2.0.0): its memory, and when it comes back. */
  review?: { skill: CardSkill; scheduledDays: number; dueAfter: number } | null;
}

/** What a practice answer tests: the memory, the skill it is evidence of, and the kind kept with its event. */
export function practiceTest(mode: PracticeMode, choice: boolean): { skill: CardSkill; evidence: string; kind: string } {
  if (mode === 'forms') return { skill: 'productive', evidence: 'production', kind: 'practice:forms' };
  if (mode === 'cloze') return choice ? { skill: 'receptive', evidence: 'sentence', kind: 'practice:cloze_choice' } : { skill: 'productive', evidence: 'sentence', kind: 'practice:cloze_typed' };
  return choice ? { skill: 'receptive', evidence: 'recognition', kind: 'practice:identify_choice' } : { skill: 'productive', evidence: 'recall', kind: 'practice:identify_typed' };
}

/** The FSRS rating of a practice answer, by the session rules: wrong or revealed Again, close or hinted Hard, else Good. */
export function practiceRating(grade: AttemptResult['grade'], hintsUsed = 0): Rating {
  if (grade === 'incorrect' || grade === 'revealed') return 1;
  if (grade === 'close' || hintsUsed > 0) return 2;
  return 3;
}

/** Record one practice answer (idempotent on opId), graded here from the server's own data. */
export function submitPracticeAttempt(app: App, input: AttemptInput, now: number): AttemptResult {
  const db = app.db;
  const prior = db.get<{ grade: AttemptResult['grade']; expected: string | null }>('SELECT grade, expected FROM practice_attempts WHERE op_id = ?', input.opId);
  if (prior) return { grade: prior.grade, expected: prior.expected ?? '', message: 'Already saved.', code: 'duplicate', duplicate: true };
  const e = db.get<{ id: number; language_code: LanguageCode; lemma: string }>('SELECT id, language_code, lemma FROM vocabulary_entries WHERE id = ? AND deleted_at IS NULL', input.entryId);
  if (!e) throw notFound('Word');
  const language = e.language_code;
  const strictness = getLanguageSettings(db, language).spellingStrictness;
  let spec: AnswerSpec;
  let cell: string | null = null;
  let sentenceId: number | null = null;
  if (input.mode === 'identify') {
    // The cell names the pictured object ("S012:3").
    spec = identifyAttemptSpec(app, language, e.id, input.cell);
    cell = input.cell!;
  } else if (input.mode === 'forms') {
    const row = db.get<any>('SELECT * FROM entry_paradigms WHERE entry_id = ?', e.id);
    if (!row || !input.cell) throw new HttpError(422, 'validation_failed', 'This word has no table to practice.');
    const p = paradigmFromRow(row);
    if (!p.cells[input.cell]?.length) throw new HttpError(422, 'validation_failed', 'That form is not in this word’s table.');
    cell = input.cell;
    spec = formsSpec(language, p, cell, e.lemma);
  } else {
    const ex = db.get<{ target: string | null }>('SELECT target FROM entry_examples WHERE entry_id = ? AND sentence_id = ?', e.id, input.sentenceId ?? -1);
    if (!ex?.target) throw new HttpError(422, 'validation_failed', 'That sentence is not one of this word’s examples.');
    sentenceId = input.sentenceId!;
    const row = db.get<any>('SELECT * FROM entry_paradigms WHERE entry_id = ?', e.id);
    const p = row ? paradigmFromRow(row) : null;
    spec = clozeSpec(db, language, e.id, e.lemma, ex.target, p);
    const k = canonical(ex.target, language);
    cell = p ? (Object.entries(p.cells).find(([, forms]) => forms.some((f) => canonical(f, language) === k))?.[0] ?? null) : null;
  }
  let result: AttemptResult;
  if (input.revealed) result = { grade: 'revealed', expected: spec.accepted[0], message: `Answer: ${spec.accepted[0]}.`, code: 'revealed' };
  else if (input.choice) {
    const ok = canonical(input.response ?? '', language) === canonical(spec.accepted[0], language);
    result = ok ? { grade: 'correct', expected: spec.accepted[0], message: 'Correct.', code: 'exact' } : { grade: 'incorrect', expected: spec.accepted[0], message: `Answer: ${spec.accepted[0]}.`, code: 'incorrect' };
  } else {
    const c: CheckResult = checkAnswer(input.response ?? '', spec, strictness);
    result = { grade: c.grade, expected: c.expected, message: c.message, code: c.code };
  }
  const tz = getTimezone(db, app.config.defaultTimezone);
  const answeredAt = Math.min(input.answeredAt, now);
  const day = localDay(answeredAt, tz);
  db.tx(() => {
    const saved = db.run(
      `INSERT INTO practice_attempts (op_id, language_code, mode, entry_id, cell, sentence_id, response, grade, expected, answered_at, local_day, device_id, received_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(op_id) DO NOTHING`,
      input.opId,
      language,
      input.mode,
      e.id,
      cell,
      sentenceId,
      input.response?.slice(0, 500) ?? null,
      result.grade,
      result.expected,
      answeredAt,
      day,
      input.deviceId ?? null,
      now,
    );
    if (!saved.changes) return;
    addPracticeTime(db, language, day, input.activeMs, MAX_ANSWER_ACTIVE_MS);
    // Every kind of question tests the word (2.0.0): evidence for its skill, and its memory's review when it counts.
    const test = practiceTest(input.mode, !!input.choice);
    const item = db.get<{ id: number; introduced_day: string | null }>('SELECT id, introduced_day FROM learning_items WHERE entry_id = ?', e.id);
    if (item) {
      const success = result.grade === 'correct';
      updateEvidence(db, item.id, test.evidence, success, result.grade === 'correct' ? 1 : result.grade === 'close' ? 0.5 : 0, answeredAt, !!item.introduced_day && day > item.introduced_day);
    }
    const change = scheduleFromPractice(db, {
      language,
      entryId: e.id,
      skill: test.skill,
      rating: practiceRating(result.grade, input.hintsUsed ?? 0),
      answeredAt,
      timezone: tz,
      opId: `prac:${input.opId}`,
      exerciseKind: test.kind,
      sessionId: input.sessionId ?? null,
      deviceId: input.deviceId ?? null,
      now,
    });
    if (change) result = { ...result, review: { skill: change.cardSkill, scheduledDays: change.scheduledDays, dueAfter: change.dueAfter } };
  });
  return result;
}

// ------------------------------------------------------------------ summary

export interface PracticeSummary {
  language: LanguageCode;
  forms: { words: number; learningWords: number; attempts7d: number; correct7d: number } | null;
  cloze: { words: number; learningWords: number; sentences: number; attempts7d: number; correct7d: number };
  /** Null when this installation has no Identify pictures. */
  identify: IdentifySummary | null;
  /**
   * Reading comprehension: the learner's level and how far through it they are (both kinds; all its texts move it up),
   * the passages in this language, those read and those left.
   */
  comprehension: { level: ReadingLevel; progress: LevelProgress; total: number; read: number; available: number };
  /** Writing: the learner's writing level, how far through it they are (`read`: sentences done), and the sentences. */
  writing: { level: ReadingLevel; progress: LevelProgress; total: number; done: number; available: number; attempts7d: number; correct7d: number };
}

export function practiceSummary(app: App, language: LanguageCode, now: number): PracticeSummary {
  const db = app.db;
  const since = now - 7 * 86_400_000;
  const tally = (mode: PracticeMode) =>
    db.get<{ n: number; ok: number }>("SELECT COUNT(*) AS n, COALESCE(SUM(grade = 'correct'), 0) AS ok FROM practice_attempts WHERE language_code = ? AND mode = ? AND answered_at >= ?", language, mode, since)!;
  const learning = "JOIN learning_items li ON li.entry_id = e.id AND li.status IN ('introduced', 'active')";
  const tableWords = (join: string) =>
    db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM entry_paradigms p JOIN vocabulary_entries e ON e.id = p.entry_id ${join}
        WHERE e.language_code = ? AND e.deleted_at IS NULL AND p.data NOT LIKE '%"indeclinable":true%'`,
      language,
    )!.n;
  const sentenceWords = (join: string) =>
    db.get<{ n: number }>(
      `SELECT COUNT(DISTINCT ee.entry_id) AS n FROM entry_examples ee JOIN vocabulary_entries e ON e.id = ee.entry_id ${join}
        WHERE e.language_code = ? AND e.deleted_at IS NULL AND ee.target IS NOT NULL`,
      language,
    )!.n;
  const hasTables = ['es', 'pt', 'ru', 'uk', 'pl'].includes(language);
  const f = tally('forms');
  const c = tally('cloze');
  const reading = comprehensionSummary(app, language);
  const writing = writingSummary(app, language);
  const w = db.get<{ n: number; ok: number }>('SELECT COUNT(*) AS n, COALESCE(SUM(correct), 0) AS ok FROM writing_attempts WHERE language_code = ? AND answered_at >= ?', language, since)!;
  return {
    language,
    forms: hasTables ? { words: tableWords(''), learningWords: tableWords(learning), attempts7d: f.n, correct7d: f.ok } : null,
    cloze: {
      words: sentenceWords(''),
      learningWords: sentenceWords(learning),
      sentences: db.get<{ n: number }>('SELECT COUNT(*) AS n FROM entry_examples ee JOIN vocabulary_entries e ON e.id = ee.entry_id WHERE e.language_code = ? AND e.deleted_at IS NULL AND ee.target IS NOT NULL', language)!.n,
      attempts7d: c.n,
      correct7d: c.ok,
    },
    identify: identifySummary(app, language, now),
    comprehension: { level: reading.level, progress: reading.progress, total: reading.total, read: reading.read, available: reading.available },
    writing: { level: writing.level, progress: writing.progress, total: writing.total, done: writing.done, available: writing.available, attempts7d: w.n, correct7d: w.ok },
  };
}
