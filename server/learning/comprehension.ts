// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
/**
 * Reading comprehension: AI-written passages at levels A1–C1, each with multiple-choice questions. Two kinds:
 *   long   about 150 words on literature, history, the humanities or science, four questions, served in id order;
 *   short  about 75 words of everyday life (a dialogue, a chat message, a notice…), three questions, served in `step`
 *          order, easiest first. Study sessions use these between exercises.
 *
 * The passages come from <readingDir>/<lang>.json (data/reading/ unless VB_READING_DIR says otherwise), built by
 * scripts/reading/build.mjs from the reviewed batches in data/reading/src/. The learner reads one passage at a time at
 * their reading level (the language setting readingLevel, shared by both kinds): the first passage of the kind not
 * read yet at that level; when the level is used up, the nearest higher level with one left, then the nearest lower
 * one, always of the same kind. A passage once read never comes back. The level moves up one step (C1 at most) only
 * when every passage of the level, of both kinds, has been read, whatever the results (shared/comprehension.ts,
 * levelAfter); a level with no passages never counts as read. Passing (all questions but one right) is a result only.
 *
 * The browser grades at once (it receives the right answers); the server grades the attempt again, stores it in
 * comprehension_attempts and changes the level. Reading a text tests no single word, so nothing here touches the
 * review schedule.
 * (The "Read and say" practice is server/learning/reading.ts.)
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { App } from '../app.ts';
import { json } from '../db/database.ts';
import { HttpError, notFound } from '../http/http.ts';
import {
  COMPREHENSION_KINDS,
  isPass,
  kindOfId,
  levelAfter,
  levelProgress,
  levelRank,
  levelSearchOrder,
  READING_LEVELS,
  readingLevel,
  type ComprehensionKind,
  type ComprehensionKindSummary,
  type ComprehensionNext,
  type ComprehensionPassage,
  type ComprehensionResult,
  type ComprehensionSummary,
  type ReadingLevel,
} from '../../shared/comprehension.ts';
import type { LanguageCode } from '../../shared/languages.ts';
import { localDay } from '../../shared/time.ts';
import { getLanguageSettings, getTimezone, updateLanguageSettings } from '../services/settings.ts';
import { MAX_TEXT_ACTIVE_MS } from '../../shared/activity.ts';
import { addPracticeTime } from './scheduling.ts';

export interface ComprehensionData {
  format: string;
  language: LanguageCode;
  version: string;
  copyright: string;
  credit: string;
  passages: ComprehensionPassage[];
}

/** Natural id order, so batch 10 comes after batch 9 ("es-A1-2-01" before "es-A1-10-01"). */
export const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id, 'en', { numeric: true });

/** The order passages are served in: by level, then kind; long ones by id, short ones by step (then id). */
export function passageOrder(a: ComprehensionPassage, b: ComprehensionPassage): number {
  return (
    levelRank(a.level) - levelRank(b.level) ||
    COMPREHENSION_KINDS.indexOf(a.kind) - COMPREHENSION_KINDS.indexOf(b.kind) ||
    (a.kind === 'short' ? (a.step ?? 1e9) - (b.step ?? 1e9) : 0) ||
    byId(a, b)
  );
}

const cache = new Map<string, { mtimeMs: number; size: number; data: ComprehensionData }>();

export function comprehensionFile(app: App, language: LanguageCode): string {
  return path.join(app.config.readingDir, `${language}.json`);
}

/** The language's passages in serving order; re-read when the file changes, null when there is no file. */
export function loadComprehension(app: App, language: LanguageCode): ComprehensionData | null {
  const file = comprehensionFile(app, language);
  if (!existsSync(file)) {
    cache.delete(file);
    return null;
  }
  const { mtimeMs, size } = statSync(file);
  const hit = cache.get(file);
  if (hit && hit.mtimeMs === mtimeMs && hit.size === size) return hit.data;
  const data = JSON.parse(readFileSync(file, 'utf8')) as ComprehensionData;
  data.passages = data.passages
    .filter((p) => READING_LEVELS.includes(p.level))
    .map((p) => (p.kind ? p : { ...p, kind: kindOfId(p.id) }))
    .sort(passageOrder);
  cache.set(file, { mtimeMs, size, data });
  return data;
}

/**
 * The first passage of the kind not read and not excluded, in serving order: at the requested level, else at the
 * nearest higher level with one left, else at the nearest lower one. `passages` must be in serving order.
 */
export function pickPassage<P extends { id: string; level: ReadingLevel; kind: ComprehensionKind }>(
  passages: P[],
  read: Set<string>,
  requested: ReadingLevel,
  exclude: Set<string> = new Set(),
  kind: ComprehensionKind = 'long',
): { passage: P; fallback: boolean } | null {
  for (const level of levelSearchOrder(requested)) {
    const passage = passages.find((p) => p.kind === kind && p.level === level && !read.has(p.id) && !exclude.has(p.id));
    if (passage) return { passage, fallback: level !== requested };
  }
  return null;
}

/** Every passage the learner has read in this language, with whether any attempt at it passed. */
function readPassages(app: App, language: LanguageCode): Map<string, boolean> {
  const rows = app.db.all<{ passage_id: string; passed: number }>(
    'SELECT passage_id, MAX(passed) AS passed FROM comprehension_attempts WHERE language_code = ? GROUP BY passage_id',
    language,
  );
  return new Map(rows.map((r) => [r.passage_id, r.passed === 1]));
}

export function currentReadingLevel(app: App, language: LanguageCode): ReadingLevel {
  return readingLevel(getLanguageSettings(app.db, language).readingLevel);
}

/** The learner's level and, per kind and level, how many passages there are, how many were read and passed. */
export function comprehensionSummary(app: App, language: LanguageCode): ComprehensionSummary {
  const passages = loadComprehension(app, language)?.passages ?? [];
  const read = readPassages(app, language);
  const ofKind = (kind: ComprehensionKind): ComprehensionKindSummary => {
    const levels = READING_LEVELS.map((level) => {
      const here = passages.filter((p) => p.kind === kind && p.level === level);
      return { level, total: here.length, read: here.filter((p) => read.has(p.id)).length, passed: here.filter((p) => read.get(p.id) === true).length };
    });
    const sum = (k: 'total' | 'read' | 'passed') => levels.reduce((n, l) => n + l[k], 0);
    return { total: sum('total'), read: sum('read'), passed: sum('passed'), available: sum('total') - sum('read'), levels };
  };
  const kinds = { long: ofKind('long'), short: ofKind('short') };
  const sum = (k: 'total' | 'read' | 'passed' | 'available') => kinds.long[k] + kinds.short[k];
  const level = currentReadingLevel(app, language);
  return { language, level, progress: levelProgress(level, passages, read), total: sum('total'), read: sum('read'), passed: sum('passed'), available: sum('available'), kinds };
}

export interface NextRequest {
  language: LanguageCode;
  /** Default: long. */
  kind?: ComprehensionKind | null;
  /** Default: the learner's reading level. */
  level?: ReadingLevel | null;
  /** Passages to skip, such as those whose attempts are still on their way from the device. */
  exclude?: string[] | null;
}

export function nextPassage(app: App, req: NextRequest): ComprehensionNext {
  const kind = req.kind ?? 'long';
  const all = loadComprehension(app, req.language)?.passages ?? [];
  const passages = all.filter((p) => p.kind === kind);
  const requested = req.level ?? currentReadingLevel(app, req.language);
  const read = readPassages(app, req.language);
  const exclude = new Set(req.exclude ?? []);
  const pick = pickPassage(passages, new Set(read.keys()), requested, exclude, kind);
  return {
    passage: pick?.passage ?? null,
    kind,
    requested,
    level: pick?.passage.level ?? null,
    fallback: pick?.fallback ?? false,
    total: passages.length,
    available: passages.filter((p) => !read.has(p.id)).length,
    // Texts the device has just read (their attempts may still be on the way) count as read here.
    progress: levelProgress(requested, all, { has: (id) => read.has(id) || exclude.has(id) }),
  };
}

/** Grade a passage's answers: per question the chosen stored index against the right one. */
export function gradeAnswers(p: ComprehensionPassage, answers: number[]) {
  const results = p.questions.map((q, i) => ({ chosen: answers[i] ?? -1, answer: q.answer, correct: answers[i] === q.answer }));
  const correct = results.filter((r) => r.correct).length;
  return { results, correct, total: p.questions.length, passed: isPass(correct, p.questions.length) };
}

export interface ComprehensionAttempt {
  opId: string;
  language: LanguageCode;
  passageId: string;
  /** Per question, in stored order: the chosen option's stored index, or -1 for none. */
  answers: number[];
  answeredAt: number;
  deviceId?: string | null;
  /** Active time on the Practice page for this text (reading and answering); none from a round inside a session. */
  activeMs?: number | null;
}

interface AttemptRow {
  language_code: LanguageCode;
  passage_id: string;
  answers: string;
  correct: number;
  total: number;
  passed: number;
  level_before: string;
  level_after: string;
}

/**
 * Record a passage read: graded here, idempotent on opId (a repeat returns the stored result). When this passage was
 * the last unread one of the learner's level (both kinds counted, whatever the results), the level moves up one step
 * (on through a next level whose passages were all read before, never past C1 or a level without passages); the
 * change is saved as a language setting, so every device sees it.
 */
export function submitComprehension(app: App, input: ComprehensionAttempt, now: number): ComprehensionResult {
  const db = app.db;
  const prior = db.get<AttemptRow>('SELECT language_code, passage_id, answers, correct, total, passed, level_before, level_after FROM comprehension_attempts WHERE op_id = ?', input.opId);
  if (prior) return storedResult(app, prior);
  const passages = loadComprehension(app, input.language)?.passages ?? [];
  const passage = passages.find((p) => p.id === input.passageId);
  if (!passage) throw notFound('Passage');
  if (input.answers.length !== passage.questions.length) {
    throw new HttpError(422, 'validation_failed', `This passage has ${passage.questions.length} questions: send one answer for each, -1 for none.`);
  }
  const g = gradeAnswers(passage, input.answers);
  const before = currentReadingLevel(app, input.language);
  // Every passage read before, and this one: the level moves on only when all of its passages are among them.
  const read = new Set(readPassages(app, input.language).keys()).add(passage.id);
  let after = levelAfter(before, passages, read);
  const answeredAt = Math.min(Math.max(input.answeredAt, 0), now);
  const tz = getTimezone(db, app.config.defaultTimezone);
  const day = localDay(answeredAt, tz);
  db.tx(() => {
    // The level as stored afterwards (per-key last-writer-wins could keep a newer change from another device).
    if (after !== before) after = readingLevel(updateLanguageSettings(db, input.language, { readingLevel: after }, now, input.deviceId ?? null).readingLevel);
    const saved = db.run(
      `INSERT INTO comprehension_attempts (op_id, language_code, passage_id, kind, level, answers, correct, total, passed, level_before, level_after, answered_at, local_day, device_id, received_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(op_id) DO NOTHING`,
      input.opId,
      input.language,
      passage.id,
      passage.kind,
      passage.level,
      JSON.stringify(input.answers),
      g.correct,
      g.total,
      g.passed ? 1 : 0,
      before,
      after,
      answeredAt,
      day,
      input.deviceId ?? null,
      now,
    );
    if (saved.changes) addPracticeTime(db, input.language, day, input.activeMs, MAX_TEXT_ACTIVE_MS);
  });
  return {
    passageId: passage.id,
    correct: g.correct,
    total: g.total,
    passed: g.passed,
    levelBefore: before,
    levelAfter: after,
    levelUp: levelRank(after) > levelRank(before),
    progress: levelProgress(after, passages, read),
    results: g.results,
  };
}

/** A repeated opId: the stored result and levels; the progress: how far through that level the learner is now. */
function storedResult(app: App, r: AttemptRow): ComprehensionResult {
  const before = readingLevel(r.level_before);
  const after = readingLevel(r.level_after);
  const passages = loadComprehension(app, r.language_code)?.passages ?? [];
  const passage = passages.find((p) => p.id === r.passage_id);
  return {
    passageId: r.passage_id,
    correct: r.correct,
    total: r.total,
    passed: r.passed === 1,
    levelBefore: before,
    levelAfter: after,
    levelUp: levelRank(after) > levelRank(before),
    progress: levelProgress(after, passages, readPassages(app, r.language_code)),
    results: passage ? gradeAnswers(passage, json<number[]>(r.answers, [])).results : [],
    duplicate: true,
  };
}
