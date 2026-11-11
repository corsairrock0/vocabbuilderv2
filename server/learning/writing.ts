// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
/**
 * Writing practice (1.9.0): the learner translates an English sentence into the language they are learning, and every
 * word must be right (shared/writing.ts grades it: capitals, punctuation and stress marks never count, nothing else is
 * forgiven).
 *
 * The sentences come from <writingDir>/<lang>.json (data/writing/ unless VB_WRITING_DIR says otherwise), built by
 * scripts/writing/build.mjs from the reviewed batches in data/writing/src/: 200 per level from A1 to C1, in `step`
 * order, easiest first. The learner writes at their writing level (the language setting writingLevel): the next
 * sentence of the level not done yet. A sentence is done once it has been translated right; one answered wrong comes
 * back after WRITING_AGAIN_AFTER other answers (or half a day), until it is right. The level moves up one step (C1 at
 * most) only when every sentence of it is done; a level without sentences never counts as done (the reading rules,
 * shared/comprehension.ts). When the level has nothing left, the nearest higher level with a sentence left is used,
 * then the nearest lower one.
 *
 * In a study session the Writing questions prefer sentences that use the session's words (`entryIds`): among the
 * sentences that could come now at the level, the one whose usual translation holds the session's words, the rarer
 * words counting for more (a word in nearly every sentence, such as "de", counts for almost nothing). Without such a
 * sentence, the usual order holds.
 *
 * "I was right": the learner may say an answer graded wrong was right. The answer then counts as right (the
 * sentence is done, the level may move up), and its wording joins the sentence's accepted translations for this
 * learner (writing_accepted).
 *
 * Since 2.0.0 an answer is a review of each word being learned in the translation it was compared with: Good for a
 * word written right, Again for one missed (scheduleFromPractice in scheduling.ts); "I was right" turns those Again
 * ratings into Good.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { App } from '../app.ts';
import { HttpError, notFound } from '../http/http.ts';
import { levelAfter, levelProgress, levelRank, levelSearchOrder, readingLevel } from '../../shared/comprehension.ts';
import type { LanguageCode } from '../../shared/languages.ts';
import { localDay } from '../../shared/time.ts';
import { MAX_ANSWER_ACTIVE_MS } from '../../shared/activity.ts';
import { paradigmForms } from '../../shared/paradigms.ts';
import { stripStress } from '../../shared/text.ts';
import { paradigmFromRow } from '../vocab/repo.ts';
import {
  expandPattern,
  gradeWriting,
  WRITING_LEVELS,
  wordKey,
  writingKey,
  writingWords,
  type WritingAttemptResult,
  type WritingMark,
  type WritingItem,
  type WritingLevel,
  type WritingNext,
  type WritingSentence,
  type WritingSummary,
} from '../../shared/writing.ts';
import { getLanguageSettings, getTimezone, updateLanguageSettings } from '../services/settings.ts';
import { addPracticeTime, rerateEvents, scheduleFromPractice, updateEvidence } from './scheduling.ts';
import { matchKey } from '../../shared/text.ts';
import type { Db } from '../db/database.ts';

export interface WritingData {
  format: string;
  language: LanguageCode;
  version: string;
  copyright: string;
  credit: string;
  sentences: WritingSentence[];
}

/** A sentence answered wrong comes back once this many answers have been given after it… */
export const WRITING_AGAIN_AFTER = 5;
/** …or this long after its last answer (the next day's session). */
export const WRITING_AGAIN_MS = 12 * 3_600_000;

const order = (a: WritingSentence, b: WritingSentence) => levelRank(a.level) - levelRank(b.level) || a.step - b.step || a.id.localeCompare(b.id);
const cache = new Map<string, { mtimeMs: number; size: number; data: WritingData }>();

export function writingFile(app: App, language: LanguageCode): string {
  return path.join(app.config.writingDir, `${language}.json`);
}

/** The language's sentences in serving order; re-read when the file changes, null when there is no file. */
export function loadWriting(app: App, language: LanguageCode): WritingData | null {
  const file = writingFile(app, language);
  if (!existsSync(file)) {
    cache.delete(file);
    return null;
  }
  const { mtimeMs, size } = statSync(file);
  const hit = cache.get(file);
  if (hit && hit.mtimeMs === mtimeMs && hit.size === size) return hit.data;
  const data = JSON.parse(readFileSync(file, 'utf8')) as WritingData;
  data.sentences = (data.sentences ?? []).filter((s) => WRITING_LEVELS.includes(s.level) && Array.isArray(s.answers) && s.answers.length).sort(order);
  cache.set(file, { mtimeMs, size, data });
  return data;
}

// ------------------------------------------------------------------ the session's words in the sentences

/** The words of each sentence's usual translation, as word keys, and the sentences each key is in. */
interface WordIndex {
  keys: string[][];
  postings: Map<string, Set<number>>;
}
const indexes = new WeakMap<WritingData, WordIndex>();

export function wordIndex(data: WritingData): WordIndex {
  const hit = indexes.get(data);
  if (hit) return hit;
  const keys = data.sentences.map((s) => {
    try {
      return writingWords(expandPattern(s.answers[0])[0] ?? '').map((w) => wordKey(w, data.language)).filter(Boolean);
    } catch {
      return [];
    }
  });
  const postings = new Map<string, Set<number>>();
  keys.forEach((k, i) => {
    for (const w of k) {
      if (!postings.has(w)) postings.set(w, new Set());
      postings.get(w)!.add(i);
    }
  });
  const index = { keys, postings };
  indexes.set(data, index);
  return index;
}

/** A word's written forms (its headword, its listed forms and the cells of its table) as word-key sequences. */
export function entryFormKeys(app: App, language: LanguageCode, entryId: number): string[][] {
  const entry = app.db.get<{ lemma: string }>('SELECT lemma FROM vocabulary_entries WHERE id = ? AND language_code = ? AND deleted_at IS NULL', entryId, language);
  if (!entry) return [];
  const forms = new Set<string>([entry.lemma]);
  for (const f of app.db.all<{ form: string }>('SELECT form FROM vocabulary_forms WHERE entry_id = ?', entryId)) forms.add(f.form);
  const row = app.db.get<{ kind: string; data: string; source: string | null }>('SELECT kind, data, source FROM entry_paradigms WHERE entry_id = ?', entryId);
  if (row) {
    try {
      for (const f of paradigmForms(language, paradigmFromRow(row))) forms.add(stripStress(f.form));
    } catch {
      // A table that can't be read only leaves its forms out.
    }
  }
  const out = new Map<string, string[]>();
  for (const f of forms) {
    const k = writingWords(f).map((w) => wordKey(w, language)).filter(Boolean);
    if (k.length) out.set(k.join(' '), k);
  }
  return [...out.values()];
}

/** The sentences (by index) whose usual translation holds one of these forms, a run of words for a form of several. */
export function sentencesWith(index: WordIndex, forms: string[][]): Set<number> {
  const found = new Set<number>();
  for (const form of forms) {
    const first = index.postings.get(form[0]);
    if (!first) continue;
    for (const i of first) {
      if (found.has(i)) continue;
      if (form.length === 1) {
        found.add(i);
        continue;
      }
      const k = index.keys[i];
      for (let at = 0; at + form.length <= k.length; at++) {
        if (form.every((w, j) => k[at + j] === w)) {
          found.add(i);
          break;
        }
      }
    }
  }
  return found;
}

/**
 * How well each sentence fits these words: for each word the sentence uses, log((n + 1) / (m + 1)), where n is the
 * number of sentences and m the number that use the word, so a rare word counts for more and a word every sentence
 * has counts for nothing. Sentences that use none of the words are left out; `uses` lists the words of each.
 */
export function wordScores(index: WordIndex, words: Array<{ id: number; forms: string[][] }>): Map<number, { score: number; uses: number[] }> {
  const n = index.keys.length;
  const out = new Map<number, { score: number; uses: number[] }>();
  for (const w of words) {
    const hits = sentencesWith(index, w.forms);
    const weight = Math.log((n + 1) / (hits.size + 1));
    if (weight <= 0) continue;
    for (const i of hits) {
      const cur = out.get(i) ?? { score: 0, uses: [] };
      cur.score += weight;
      cur.uses.push(w.id);
      out.set(i, cur);
    }
  }
  return out;
}

export function currentWritingLevel(app: App, language: LanguageCode): WritingLevel {
  return readingLevel(getLanguageSettings(app.db, language).writingLevel);
}

interface SentenceState {
  done: boolean;
  lastAt: number;
  lastId: number;
}

/** Every sentence the learner has answered in this language: done or not, and when it was last answered. */
function writingState(app: App, language: LanguageCode): Map<string, SentenceState> {
  const rows = app.db.all<{ sentence_id: string; done: number; last_at: number; last_id: number }>(
    'SELECT sentence_id, MAX(correct) AS done, MAX(answered_at) AS last_at, MAX(id) AS last_id FROM writing_attempts WHERE language_code = ? GROUP BY sentence_id',
    language,
  );
  return new Map(rows.map((r) => [r.sentence_id, { done: r.done === 1, lastAt: r.last_at, lastId: r.last_id }]));
}

const doneSet = (state: Map<string, SentenceState>) => new Set([...state].filter(([, s]) => s.done).map(([id]) => id));

/** The wordings the learner said were right, for one sentence. */
function acceptedOf(app: App, language: LanguageCode, sentenceId: string): string[] {
  return app.db.all<{ answer: string }>('SELECT answer FROM writing_accepted WHERE language_code = ? AND sentence_id = ? ORDER BY created_at', language, sentenceId).map((r) => r.answer);
}

const item = (app: App, language: LanguageCode, s: WritingSentence): WritingItem => ({ ...s, accepted: acceptedOf(app, language, s.id) });

/** The learner's level and, per level, how many sentences there are and how many are done. */
export function writingSummary(app: App, language: LanguageCode): WritingSummary {
  const sentences = loadWriting(app, language)?.sentences ?? [];
  const done = doneSet(writingState(app, language));
  const levels = WRITING_LEVELS.map((level) => {
    const here = sentences.filter((s) => s.level === level);
    return { level, total: here.length, done: here.filter((s) => done.has(s.id)).length };
  });
  const total = sentences.length;
  const doneCount = levels.reduce((n, l) => n + l.done, 0);
  const level = currentWritingLevel(app, language);
  return { language, level, progress: levelProgress(level, sentences, done), total, done: doneCount, available: total - doneCount, levels };
}

export interface WritingNextRequest {
  language: LanguageCode;
  /** Default: the learner's writing level. */
  level?: WritingLevel | null;
  /** Sentences to skip, such as one whose answer is still on its way from the device. */
  exclude?: string[] | null;
  /** The words of the study session asking: a sentence using them comes first (see the top of this file). */
  entryIds?: number[] | null;
}

/**
 * The next sentence: at the level asked for (else the nearest higher level with one left, else the nearest lower one),
 * a sentence answered wrong whose wait is over first (the one waiting longest), else the first one not answered yet
 * in step order, else a wrong one still waiting. With `entryIds` (a study session's words), first the sentence among
 * those that could come now (not answered yet, or wrong and its wait over) that fits the words best (wordScores),
 * a wrong one before a new one and the easier first when they fit as well.
 */
export function nextSentence(app: App, req: WritingNextRequest, now = Date.now()): WritingNext {
  const db = app.db;
  const data = loadWriting(app, req.language);
  const all = data?.sentences ?? [];
  const state = writingState(app, req.language);
  const done = doneSet(state);
  const exclude = new Set(req.exclude ?? []);
  const requested = req.level ?? currentWritingLevel(app, req.language);
  const answersAfter = (id: number) => db.get<{ n: number }>('SELECT COUNT(*) AS n FROM writing_attempts WHERE language_code = ? AND id > ?', req.language, id)!.n;
  const isReady = (s: WritingSentence) => {
    const st = state.get(s.id);
    return !!st && (now - st.lastAt >= WRITING_AGAIN_MS || answersAfter(st.lastId) >= WRITING_AGAIN_AFTER);
  };
  const base = { requested, total: all.length, available: all.filter((s) => !done.has(s.id)).length, progress: levelProgress(requested, all, done) };
  // The session's words: how well each sentence fits them, by the sentence's place in the file.
  const ids = [...new Set(req.entryIds ?? [])].slice(0, 200);
  const fit = data && ids.length ? wordScores(wordIndex(data), ids.map((id) => ({ id, forms: entryFormKeys(app, req.language, id) }))) : null;
  const place = new Map(all.map((s, i) => [s.id, i]));
  const fitOf = (s: WritingSentence) => fit?.get(place.get(s.id)!) ?? null;
  for (const level of levelSearchOrder(requested)) {
    const left = all.filter((s) => s.level === level && !done.has(s.id) && !exclude.has(s.id));
    if (!left.length) continue;
    let pick: WritingSentence | undefined;
    if (fit) {
      const could = left.filter((s) => fitOf(s) && (!state.has(s.id) || isReady(s)));
      // Best fit first; as good a fit: a wrong one before a new one, then the easier (left is in step order).
      pick = could.reduce<WritingSentence | undefined>((best, s) => {
        if (!best) return s;
        const d = fitOf(s)!.score - fitOf(best)!.score;
        if (Math.abs(d) > 1e-9) return d > 0 ? s : best;
        return state.has(s.id) && !state.has(best.id) ? s : best;
      }, undefined);
    }
    const waiting = left.filter((s) => state.has(s.id)).sort((a, b) => state.get(a.id)!.lastAt - state.get(b.id)!.lastAt);
    pick ??= waiting.find(isReady) ?? left.find((s) => !state.has(s.id)) ?? waiting[0];
    const uses = fit ? (fitOf(pick)?.uses ?? []) : undefined;
    return { ...base, sentence: item(app, req.language, pick), level, fallback: level !== requested, again: state.has(pick.id), ...(uses ? { uses } : {}) };
  }
  return { ...base, sentence: null, level: null, fallback: false, again: false };
}

/**
 * The words being learned in a Writing translation (2.0.0), with whether the answer had each right: the words of the
 * translation the answer was compared with, matched to active words by headword or listed form, longest first (a run
 * of up to three words for a word of several, as Vietnamese has). A form two words share (como: comer and como) is
 * left out, so no word is rated for another's answer. A word written twice counts once, wrong if either was wrong.
 */
export function writingWordsOf(db: Db, language: LanguageCode, marks: WritingMark[]): Array<{ entryId: number; ok: boolean }> {
  const lookup = (text: string) => {
    const k = matchKey(text, language);
    if (!k) return [];
    return db
      .all<{ id: number }>(
        `SELECT DISTINCT e.id FROM vocabulary_entries e JOIN learning_items li ON li.entry_id = e.id AND li.status = 'active'
          WHERE e.language_code = ? AND e.deleted_at IS NULL
            AND (e.lemma_key = ? OR EXISTS (SELECT 1 FROM vocabulary_forms f WHERE f.entry_id = e.id AND f.form_key = ?))`,
        language,
        k,
        k,
      )
      .map((r) => r.id);
  };
  const found = new Map<number, boolean>();
  for (let i = 0; i < marks.length; ) {
    let step = 1;
    for (let n = Math.min(3, marks.length - i); n >= 1; n--) {
      const run = marks.slice(i, i + n);
      const ids = lookup(run.map((m) => m.w).join(' '));
      if (!ids.length) continue;
      step = n;
      if (ids.length === 1) found.set(ids[0], (found.get(ids[0]) ?? true) && run.every((m) => m.ok));
      break;
    }
    i += step;
  }
  return [...found].map(([entryId, ok]) => ({ entryId, ok }));
}

export interface WritingAttemptInput {
  opId: string;
  language: LanguageCode;
  sentenceId: string;
  response: string;
  answeredAt: number;
  deviceId?: string | null;
  /** Active time on the Practice page for this sentence; none from a round inside a session (the session counts it). */
  activeMs?: number | null;
}

interface AttemptRow {
  op_id: string;
  language_code: LanguageCode;
  sentence_id: string;
  response: string;
  correct: number;
  accepted: number;
  level_before: string;
  level_after: string;
}

/** The level once these sentences are done, saved as the language setting when it changes (every device sees it). */
function moveLevel(app: App, language: LanguageCode, sentences: WritingSentence[], done: Set<string>, now: number, deviceId: string | null): { before: WritingLevel; after: WritingLevel } {
  const before = currentWritingLevel(app, language);
  let after = levelAfter(before, sentences, done);
  // The level as stored afterwards (per-key last-writer-wins could keep a newer change from another device).
  if (after !== before) after = readingLevel(updateLanguageSettings(app.db, language, { writingLevel: after }, now, deviceId).writingLevel);
  return { before, after };
}

/**
 * Record an answer: graded here against the sentence's translations and the learner's accepted ones, idempotent on
 * opId (a repeat returns the stored result). A right answer to the last sentence of the level not done moves the
 * level up one step (on through levels done before, never past C1 or a level without sentences).
 */
export function submitWriting(app: App, input: WritingAttemptInput, now: number): WritingAttemptResult {
  const db = app.db;
  const prior = db.get<AttemptRow>('SELECT op_id, language_code, sentence_id, response, correct, accepted, level_before, level_after FROM writing_attempts WHERE op_id = ?', input.opId);
  if (prior) return storedResult(app, prior, true);
  const sentences = loadWriting(app, input.language)?.sentences ?? [];
  const sentence = sentences.find((s) => s.id === input.sentenceId);
  if (!sentence) throw notFound('Sentence');
  const grade = gradeWriting(input.response, sentence, input.language, acceptedOf(app, input.language, sentence.id));
  const answeredAt = Math.min(Math.max(input.answeredAt, 0), now);
  const day = localDay(answeredAt, getTimezone(db, app.config.defaultTimezone));
  let levels = { before: currentWritingLevel(app, input.language), after: currentWritingLevel(app, input.language) };
  let reviews = 0;
  db.tx(() => {
    if (grade.correct) levels = moveLevel(app, input.language, sentences, doneSet(writingState(app, input.language)).add(sentence.id), now, input.deviceId ?? null);
    const saved = db.run(
      `INSERT INTO writing_attempts (op_id, language_code, sentence_id, level, response, correct, accepted, level_before, level_after, answered_at, local_day, device_id, received_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?) ON CONFLICT(op_id) DO NOTHING`,
      input.opId,
      input.language,
      sentence.id,
      sentence.level,
      input.response.normalize('NFC').slice(0, 1000),
      grade.correct ? 1 : 0,
      levels.before,
      levels.after,
      answeredAt,
      day,
      input.deviceId ?? null,
      now,
    );
    if (!saved.changes) return;
    addPracticeTime(db, input.language, day, input.activeMs, MAX_ANSWER_ACTIVE_MS);
    // Every word being learned in the translation was tested (2.0.0): right ones Good, missed ones Again. "I don't know"
    // tests none of them.
    if (!writingKey(input.response, input.language)) return;
    const tz = getTimezone(db, app.config.defaultTimezone);
    for (const w of writingWordsOf(db, input.language, grade.closestWords)) {
      const item = db.get<{ id: number; introduced_day: string | null }>('SELECT id, introduced_day FROM learning_items WHERE entry_id = ?', w.entryId)!;
      updateEvidence(db, item.id, 'production', w.ok, w.ok ? 1 : 0, answeredAt, !!item.introduced_day && day > item.introduced_day);
      if (scheduleFromPractice(db, { language: input.language, entryId: w.entryId, skill: 'productive', rating: w.ok ? 3 : 1, answeredAt, timezone: tz, opId: `wrev:${input.opId}:${w.entryId}`, exerciseKind: 'practice:writing', deviceId: input.deviceId ?? null, now })) reviews++;
    }
  });
  const done = doneSet(writingState(app, input.language));
  return {
    sentenceId: sentence.id,
    correct: grade.correct,
    accepted: false,
    grade,
    levelBefore: levels.before,
    levelAfter: levels.after,
    levelUp: levelRank(levels.after) > levelRank(levels.before),
    progress: levelProgress(levels.after, sentences, done),
    reviews,
  };
}

/**
 * "I was right": the answer (named by its opId) counts as right from now on, the sentence is done, the level
 * may move up, and its wording is accepted for that sentence later. Repeating it changes nothing more.
 */
export function acceptWriting(app: App, input: { opId: string; language: LanguageCode; deviceId?: string | null }, now: number): WritingAttemptResult {
  const db = app.db;
  const row = db.get<AttemptRow>('SELECT op_id, language_code, sentence_id, response, correct, accepted, level_before, level_after FROM writing_attempts WHERE op_id = ? AND language_code = ?', input.opId, input.language);
  if (!row) throw notFound('Answer');
  if (row.correct === 1) return storedResult(app, row, row.accepted === 1);
  const key = writingKey(row.response, row.language_code);
  if (!key) throw new HttpError(422, 'validation_failed', 'An empty answer cannot be counted as right.');
  const sentences = loadWriting(app, row.language_code)?.sentences ?? [];
  db.tx(() => {
    db.run('INSERT INTO writing_accepted (language_code, sentence_id, answer, answer_key, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING', row.language_code, row.sentence_id, row.response, key, now);
    const levels = moveLevel(app, row.language_code, sentences, doneSet(writingState(app, row.language_code)).add(row.sentence_id), now, input.deviceId ?? null);
    db.run('UPDATE writing_attempts SET correct = 1, accepted = 1, level_after = ? WHERE op_id = ?', levels.after, row.op_id);
    // The words the answer was rated as missing were right after all.
    rerateEvents(db, `wrev:${row.op_id}:`, 1, 3);
    row.correct = 1;
    row.accepted = 1;
    row.level_after = levels.after;
  });
  return storedResult(app, row, false);
}

/** A stored answer's result, graded again for its details (the learner's accepted wordings count). */
function storedResult(app: App, r: AttemptRow, duplicate: boolean): WritingAttemptResult {
  const sentences = loadWriting(app, r.language_code)?.sentences ?? [];
  const sentence = sentences.find((s) => s.id === r.sentence_id);
  const before = readingLevel(r.level_before);
  const after = readingLevel(r.level_after);
  const grade = sentence
    ? gradeWriting(r.response, sentence, r.language_code, acceptedOf(app, r.language_code, r.sentence_id))
    : { correct: r.correct === 1, expected: '', closest: '', answerWords: [], closestWords: [] };
  return {
    sentenceId: r.sentence_id,
    correct: r.correct === 1,
    accepted: r.accepted === 1,
    grade: { ...grade, correct: r.correct === 1 },
    levelBefore: before,
    levelAfter: after,
    levelUp: levelRank(after) > levelRank(before),
    progress: levelProgress(after, sentences, doneSet(writingState(app, r.language_code))),
    ...(duplicate ? { duplicate: true } : {}),
  };
}
