// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Read and say: real sentences built from the words the learner already knows.
//
// Read   A sentence in which at most one word is new (comprehensible input, one new word at a time). Every word can be
//        tapped for its meaning; the learner then checks the translation and says how much they understood. A new
//        word met this way can be put at the front of the next session ("Learn it next").
// Say    A sentence made only of known words, shown in English. The learner says or types the whole sentence, then
//        compares it word by word with the original: active recall of whole sentences, not just single words.
//
// Neither mode changes the review schedule; attempts are kept in practice_attempts (modes 'read' and 'say').
import type { App } from '../app.ts';
import type { Db } from '../db/database.ts';
import { HttpError, notFound } from '../http/http.ts';
import type { LanguageCode } from '../../shared/languages.ts';
import { matchKey } from '../../shared/text.ts';
import { localDay } from '../../shared/time.ts';
import { getTimezone } from '../services/settings.ts';
import { AI_SENTENCES } from '../vocab/repo.ts';
import { MAX_ANSWER_ACTIVE_MS } from '../../shared/activity.ts';
import { addPracticeTime } from './scheduling.ts';

export type ReadMode = 'read' | 'say';

/** A piece of a sentence: a word (with the entry it belongs to) or the text between words. */
export interface ReadToken {
  t: string;
  /** For a word: the entry a tap shows; absent for numbers and names. */
  e?: number;
  /** For a word: known, new (the one word the learner has not met), or name/number. */
  s?: 'known' | 'new' | 'other';
}

export interface ReadItem {
  sentenceId: number;
  /** The entry whose example this sentence is (sentence practice of that word links here). */
  entryId: number;
  text: string;
  translation: string;
  ai: boolean;
  tokens: ReadToken[];
  /** The one new word in a reading sentence, or null when every word is known. */
  newEntryId: number | null;
  /** Meaning of every word in the sentence, for taps. */
  words: Record<number, { lemma: string; display: string; pos: string | null; gloss: string }>;
}

interface Sentence {
  id: number;
  entryId: number;
  senseId: number | null;
  text: string;
  translation: string;
  ai: boolean;
  /** Word tokens with their candidate entries; null for names and numbers. */
  pieces: Array<{ t: string; word: boolean; ids: number[] | null; span: number }>;
  /** Every distinct entry set, one per word position (a word matches several entries when they share a form). */
  slots: number[][];
  unlisted: boolean;
  /** Personal and place names: fine to read, but not to say from English (Tom is Tomás in the sentence). */
  names: number;
  words: number;
}

interface LangIndex {
  signature: string;
  sentences: Sentence[];
  rank: Map<number, number>;
}

const cache = new Map<LanguageCode, LangIndex>();
const WORD = /[\p{L}\p{M}\p{N}]+(?:['’ʼ-][\p{L}\p{M}\p{N}]+)*/gu;
const MAX_SPAN = 4;

/** Changes whenever the language's words or sentences change, so the index is rebuilt. */
function signature(db: Db, language: LanguageCode): string {
  const e = db.get<{ n: number; u: number | null }>('SELECT COUNT(*) AS n, MAX(updated_at) AS u FROM vocabulary_entries WHERE language_code = ?', language)!;
  const s = db.get<{ n: number; m: number | null }>('SELECT COUNT(*) AS n, MAX(id) AS m FROM example_sentences WHERE language_code = ?', language)!;
  const f = db.get<{ m: number | null }>('SELECT MAX(id) AS m FROM vocabulary_forms')!;
  return `${e.n}:${e.u}:${s.n}:${s.m}:${f.m}`;
}

/** Split a sentence into words and the text between them. */
export function splitWords(text: string): Array<{ t: string; word: boolean }> {
  const out: Array<{ t: string; word: boolean }> = [];
  let last = 0;
  for (const m of text.normalize('NFC').matchAll(WORD)) {
    if (m.index! > last) out.push({ t: text.normalize('NFC').slice(last, m.index), word: false });
    out.push({ t: m[0], word: true });
    last = m.index! + m[0].length;
  }
  if (last < text.normalize('NFC').length) out.push({ t: text.normalize('NFC').slice(last), word: false });
  return out;
}

function buildIndex(db: Db, language: LanguageCode): LangIndex {
  // Every spelling of every word: dictionary forms and inflected forms, single words and phrases (Vietnamese words
  // are often several syllables: sinh viên).
  const single = new Map<string, number[]>();
  const multi = new Map<string, Map<number, number[]>>(); // first word → span → key → ids, flattened below
  const multiKeys = new Map<string, number[]>();
  const add = (form: string, id: number) => {
    const key = matchKey(form, language);
    if (!key) return;
    const parts = key.split(' ');
    if (parts.length === 1) {
      const list = single.get(key) ?? single.set(key, []).get(key)!;
      if (!list.includes(id)) list.push(id);
    } else if (parts.length <= MAX_SPAN) {
      const list = multiKeys.get(key) ?? multiKeys.set(key, []).get(key)!;
      if (!list.includes(id)) list.push(id);
      const spans = multi.get(parts[0]) ?? multi.set(parts[0], new Map()).get(parts[0])!;
      spans.set(parts.length, []);
    }
  };
  const rank = new Map<number, number>();
  for (const r of db.all<{ id: number; lemma: string; rank: number | null }>(
    'SELECT id, lemma, COALESCE(frequency_rank, curated_order + 100000) AS rank FROM vocabulary_entries WHERE language_code = ? AND deleted_at IS NULL',
    language,
  )) {
    add(r.lemma, r.id);
    rank.set(r.id, r.rank ?? 1e9);
  }
  for (const r of db.all<{ entry_id: number; form: string }>(
    'SELECT f.entry_id, f.form FROM vocabulary_forms f JOIN vocabulary_entries e ON e.id = f.entry_id WHERE e.language_code = ? AND e.deleted_at IS NULL',
    language,
  )) add(r.form, r.entry_id);

  const sentences: Sentence[] = [];
  const rows = db.all<{ id: number; text: string; translation: string; entry_id: number; sense_id: number | null; source_kind: string | null }>(
    `SELECT s.id, s.text, s.translation, ee.entry_id, ee.sense_id, src.kind AS source_kind
       FROM example_sentences s
       JOIN entry_examples ee ON ee.sentence_id = s.id
       JOIN vocabulary_entries e ON e.id = ee.entry_id AND e.deleted_at IS NULL
       LEFT JOIN sources src ON src.id = s.source_id
      WHERE s.language_code = ? AND s.translation IS NOT NULL AND s.translation != ''
      GROUP BY s.id`,
    language,
  );
  for (const r of rows) {
    const parts = splitWords(r.text);
    const wordIdx = parts.map((p, i) => (p.word ? i : -1)).filter((i) => i >= 0);
    const keys = wordIdx.map((i) => matchKey(parts[i].t, language));
    const pieces: Sentence['pieces'] = parts.map((p) => ({ t: p.t, word: p.word, ids: null, span: 1 }));
    const slots: number[][] = [];
    let unlisted = false;
    let names = 0;
    for (let w = 0; w < wordIdx.length; ) {
      // Longest phrase first, then the single word.
      let matched = false;
      const spans = multi.get(keys[w]);
      if (spans) {
        for (let n = Math.min(MAX_SPAN, wordIdx.length - w); n >= 2; n--) {
          if (!spans.has(n)) continue;
          const ids = multiKeys.get(keys.slice(w, w + n).join(' '));
          if (ids) {
            const first = pieces[wordIdx[w]];
            first.ids = ids;
            first.span = n;
            for (let k = 1; k < n; k++) pieces[wordIdx[w + k]].ids = [];
            slots.push(ids);
            w += n;
            matched = true;
            break;
          }
        }
      }
      if (matched) continue;
      const piece = pieces[wordIdx[w]];
      const ids = single.get(keys[w]);
      if (ids) {
        piece.ids = ids;
        slots.push(ids);
      } else if (/^\p{N}+$/u.test(piece.t)) {
        piece.ids = null; // a number: needs no learning
      } else if (/^\p{Lu}/u.test(piece.t)) {
        piece.ids = null; // a name (Tom, Boston): needs no learning
        names++;
      } else {
        unlisted = true;
      }
      w++;
    }
    sentences.push({ id: r.id, entryId: r.entry_id, senseId: r.sense_id, text: r.text, translation: r.translation, ai: r.source_kind === AI_SENTENCES, pieces, slots, unlisted, names, words: wordIdx.length });
  }
  return { signature: signature(db, language), sentences, rank };
}

function indexFor(db: Db, language: LanguageCode): LangIndex {
  const sig = signature(db, language);
  const hit = cache.get(language);
  if (hit && hit.signature === sig) return hit;
  const built = buildIndex(db, language);
  cache.set(language, built);
  return built;
}

/** Words the learner has met: introduced, being learned, or marked as known. */
function knownWords(db: Db, language: LanguageCode): Set<number> {
  return new Set(db.all<{ entry_id: number }>("SELECT entry_id FROM learning_items WHERE language_code = ? AND status IN ('introduced', 'active', 'known')", language).map((r) => r.entry_id));
}

/** How a sentence reads for a learner: its new words (entries no known word stands for). */
function newSlots(s: Sentence, known: Set<number>): number[][] {
  return s.slots.filter((ids) => ids.length && !ids.some((id) => known.has(id)));
}

function shuffle<T>(xs: T[], rand: () => number): T[] {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [xs[i], xs[j]] = [xs[j], xs[i]];
  }
  return xs;
}

export function readingSummary(app: App, language: LanguageCode) {
  const idx = indexFor(app.db, language);
  const known = knownWords(app.db, language);
  let read = 0;
  let say = 0;
  const newWords = new Set<number>();
  for (const s of idx.sentences) {
    if (s.unlisted || s.words < 3) continue;
    const n = newSlots(s, known);
    if (n.length === 0) {
      read++;
      if (s.words <= 10 && s.names === 0) say++;
    } else if (n.length === 1 && s.words <= 14) {
      read++;
      newWords.add(bestNew(n[0], idx));
    }
  }
  return { knownWords: known.size, readable: read, sayable: say, newWords: newWords.size };
}

/** The word a learner meets in a sentence when one form stands for several entries: the most frequent one. */
function bestNew(ids: number[], idx: LangIndex): number {
  return [...ids].sort((a, b) => (idx.rank.get(a) ?? 1e9) - (idx.rank.get(b) ?? 1e9))[0];
}

export function readingBatch(app: App, input: { language: LanguageCode; mode: ReadMode; size?: number; entryIds?: number[] | null }, now: number, rand: () => number = Math.random): { items: ReadItem[]; knownWords: number } {
  const db = app.db;
  const { language, mode } = input;
  const size = Math.min(Math.max(input.size ?? 10, 1), 30);
  const idx = indexFor(db, language);
  const known = knownWords(db, language);
  const recent = new Set(
    db.all<{ sentence_id: number }>('SELECT sentence_id FROM practice_attempts WHERE language_code = ? AND mode = ? AND answered_at > ? AND sentence_id IS NOT NULL', language, mode, now - 7 * 86_400_000).map((r) => r.sentence_id),
  );
  // Words learned in the last two weeks: sentences with them come first, so new words meet new contexts.
  const fresh = new Set(
    db.all<{ entry_id: number }>("SELECT entry_id FROM learning_items WHERE language_code = ? AND status IN ('introduced', 'active') AND introduced_at > ?", language, now - 14 * 86_400_000).map((r) => r.entry_id),
  );
  const freshCount = (s: Sentence) => s.slots.filter((ids) => ids.some((id) => fresh.has(id))).length;
  // A study session's own words (Comprehensive mode) come before everything else.
  const focus = new Set(input.entryIds ?? []);
  const focusCount = (s: Sentence) => (focus.size ? s.slots.filter((ids) => ids.some((id) => focus.has(id))).length : 0);

  const allKnown: Sentence[] = [];
  const oneNew = new Map<number, Sentence[]>(); // new entry → sentences
  for (const s of idx.sentences) {
    if (s.unlisted || s.words < 3 || recent.has(s.id)) continue;
    const n = newSlots(s, known);
    if (n.length === 0 && (mode === 'say' ? s.words <= 10 && s.names === 0 : s.words <= 14)) allKnown.push(s);
    else if (mode === 'read' && n.length === 1 && s.words <= 14) {
      const e = bestNew(n[0], idx);
      (oneNew.get(e) ?? oneNew.set(e, []).get(e)!).push(s);
    }
  }
  const pickKnown = (k: number) =>
    shuffle(allKnown, rand)
      .sort((a, b) => focusCount(b) - focusCount(a) || freshCount(b) - freshCount(a) || (mode === 'say' ? a.words - b.words : 0))
      .slice(0, k);
  let chosen: Array<{ s: Sentence; newEntry: number | null }> = [];
  if (mode === 'read') {
    // The most frequent words not met yet, one sentence each (the shortest, real sentences before AI-written ones).
    const nextWords = [...oneNew.keys()].sort((a, b) => (idx.rank.get(a) ?? 1e9) - (idx.rank.get(b) ?? 1e9)).slice(0, Math.ceil(size * 0.6));
    for (const e of nextWords) {
      const best = oneNew.get(e)!.sort((a, b) => Number(a.ai) - Number(b.ai) || Math.abs(a.words - 7) - Math.abs(b.words - 7))[0];
      chosen.push({ s: best, newEntry: e });
    }
    chosen.push(...pickKnown(size - chosen.length).map((s) => ({ s, newEntry: null })));
    chosen = shuffle(chosen, rand);
  } else {
    chosen = pickKnown(size).map((s) => ({ s, newEntry: null }));
  }

  // Meanings for taps: the sentence's own word uses the meaning the sentence is linked to.
  const entryIds = [...new Set(chosen.flatMap(({ s }) => s.pieces.flatMap((p) => p.ids ?? [])))];
  const info = new Map<number, { lemma: string; display: string; pos: string | null; glosses: Array<{ id: number; gloss: string }> }>();
  if (entryIds.length) {
    for (const r of db.all<{ id: number; lemma: string; display: string | null; pos: string | null }>('SELECT id, lemma, display, pos FROM vocabulary_entries WHERE id IN (SELECT value FROM json_each(?))', JSON.stringify(entryIds))) {
      info.set(r.id, { lemma: r.lemma, display: r.display ?? r.lemma, pos: r.pos, glosses: [] });
    }
    for (const r of db.all<{ id: number; entry_id: number; gloss: string }>('SELECT id, entry_id, gloss FROM vocabulary_senses WHERE entry_id IN (SELECT value FROM json_each(?)) ORDER BY entry_id, sense_order', JSON.stringify(entryIds))) {
      info.get(r.entry_id)?.glosses.push({ id: r.id, gloss: r.gloss });
    }
  }
  const items: ReadItem[] = chosen.map(({ s, newEntry }) => {
    const words: ReadItem['words'] = {};
    const tokens: ReadToken[] = [];
    for (let i = 0; i < s.pieces.length; i++) {
      const p = s.pieces[i];
      if (!p.word) {
        tokens.push({ t: p.t });
        continue;
      }
      if (p.ids && p.ids.length === 0) continue; // inside a phrase already shown
      // A phrase (sinh viên, por favor) is one tappable token with the text between its words.
      let text = p.t;
      if (p.span > 1) {
        let seen = 1;
        let j = i + 1;
        while (seen < p.span && j < s.pieces.length) {
          text += s.pieces[j].t;
          if (s.pieces[j].word) seen++;
          j++;
        }
        i = j - 1;
      }
      if (!p.ids) {
        tokens.push({ t: text, s: 'other' });
        continue;
      }
      const isNew = !p.ids.some((id) => known.has(id));
      const shown = isNew ? bestNew(p.ids, idx) : (p.ids.find((id) => id === s.entryId) ?? p.ids.find((id) => known.has(id))!);
      tokens.push({ t: text, e: shown, s: isNew ? 'new' : 'known' });
      const w = info.get(shown);
      if (w && !words[shown]) {
        const linked = shown === s.entryId && s.senseId != null ? w.glosses.find((g) => g.id === s.senseId)?.gloss : null;
        words[shown] = { lemma: w.lemma, display: w.display, pos: w.pos, gloss: linked ?? w.glosses.slice(0, 2).map((g) => g.gloss).join('; ') };
      }
    }
    return { sentenceId: s.id, entryId: s.entryId, text: s.text, translation: s.translation, ai: s.ai, tokens, newEntryId: newEntry, words };
  });
  return { items, knownWords: known.size };
}

export interface ReadAttempt {
  opId: string;
  mode: ReadMode;
  sentenceId: number;
  /** read: understood | partly | not; say: correct | close | incorrect | revealed */
  grade: 'understood' | 'partly' | 'not' | 'correct' | 'close' | 'incorrect' | 'revealed';
  response?: string | null;
  answeredAt: number;
  deviceId?: string | null;
  /** Active time on the Practice page since the previous sentence; none from a round inside a session. */
  activeMs?: number | null;
}

export function submitReadingAttempt(app: App, input: ReadAttempt, now: number) {
  const db = app.db;
  if (db.get('SELECT 1 FROM practice_attempts WHERE op_id = ?', input.opId)) return { saved: true, duplicate: true };
  const s = db.get<{ language_code: LanguageCode; entry_id: number; text: string }>(
    'SELECT s.language_code, ee.entry_id, s.text FROM example_sentences s JOIN entry_examples ee ON ee.sentence_id = s.id WHERE s.id = ? LIMIT 1',
    input.sentenceId,
  );
  if (!s) throw notFound('Sentence');
  const readGrades = ['understood', 'partly', 'not'];
  if ((input.mode === 'read') !== readGrades.includes(input.grade)) throw new HttpError(422, 'validation_failed', 'That result does not belong to this kind of practice.');
  const answeredAt = Math.min(Math.max(input.answeredAt, 0), now);
  const tz = getTimezone(db, app.config.defaultTimezone);
  const day = localDay(answeredAt, tz);
  db.tx(() => {
    const saved = db.run(
      `INSERT INTO practice_attempts (op_id, language_code, mode, entry_id, cell, sentence_id, response, grade, expected, answered_at, local_day, device_id, received_at)
       VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(op_id) DO NOTHING`,
      input.opId,
      s.language_code,
      input.mode,
      s.entry_id,
      input.sentenceId,
      input.response ?? null,
      input.grade,
      input.mode === 'say' ? s.text : null,
      answeredAt,
      day,
      input.deviceId ?? null,
      now,
    );
    if (saved.changes) addPracticeTime(db, s.language_code, day, input.activeMs, MAX_ANSWER_ACTIVE_MS);
  });
  return { saved: true, duplicate: false };
}

/**
 * Put a word met in reading at the front of the next session: it becomes the first new word introduced (its card
 * comes with the usual exercises). A word already being learned is left alone.
 */
export function learnNext(app: App, entryId: number, now: number) {
  const db = app.db;
  const e = db.get<{ id: number; language_code: LanguageCode }>('SELECT id, language_code FROM vocabulary_entries WHERE id = ? AND deleted_at IS NULL', entryId);
  if (!e) throw notFound('Word');
  const item = db.get<{ id: number; status: string }>('SELECT id, status FROM learning_items WHERE entry_id = ?', entryId);
  if (item && item.status !== 'new') return { status: item.status, queued: false };
  db.tx(() => {
    if (item) db.run("UPDATE learning_items SET status = 'introduced', introduced_at = ?, updated_at = ?, version = version + 1 WHERE id = ?", now, now, item.id);
    else
      db.run(
        "INSERT INTO learning_items (entry_id, language_code, status, introduced_at, created_at, updated_at) VALUES (?, ?, 'introduced', ?, ?, ?)",
        entryId,
        e.language_code,
        now,
        now,
        now,
      );
  });
  return { status: 'introduced', queued: true };
}
