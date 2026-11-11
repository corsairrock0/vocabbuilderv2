// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
/** Vocabulary data access: loading entries for study, browsing, detail and edits. */
import type { Db } from '../db/database.ts';
import { json } from '../db/database.ts';
import { findTarget, matchKey, stripStress } from '../../shared/text.ts';
import { normalizePos, type LanguageCode } from '../../shared/languages.ts';
import type { StudyEntry } from '../learning/planner.ts';
import type { CardInfo, VocabDetail, VocabListItem, VocabListResponse } from '../../shared/types.ts';
import { masteryLevels, MATURE_STABILITY_DAYS, type Skill } from '../../shared/exercises.ts';
import { schedulerFor } from '../learning/scheduling.ts';
import { HttpError, notFound } from '../http/http.ts';
import { paradigmForms, sanitizeParadigm, type Paradigm } from '../../shared/paradigms.ts';

/** sources.kind of example sentences written by an AI; the app labels them. */
export const AI_SENTENCES = 'ai_sentences';

const ids = (xs: number[]) => JSON.stringify(xs);

export function ensureItem(db: Db, entryId: number, language: LanguageCode, now: number): number {
  const existing = db.get<{ id: number }>('SELECT id FROM learning_items WHERE entry_id = ?', entryId);
  if (existing) return existing.id;
  return db.run(
    "INSERT INTO learning_items (entry_id, language_code, status, created_at, updated_at) VALUES (?, ?, 'new', ?, ?)",
    entryId,
    language,
    now,
    now,
  ).lastInsertRowid;
}

/** Load everything needed to render exercises for a set of learning items. */
export function loadStudyEntries(db: Db, itemIds: number[], forvoConfigured: boolean, now: number): Map<number, StudyEntry> {
  const out = new Map<number, StudyEntry>();
  if (!itemIds.length) return out;
  const rows = db.all<any>(
    `SELECT li.id AS item_id, li.status, e.* FROM learning_items li JOIN vocabulary_entries e ON e.id = li.entry_id
      WHERE li.id IN (SELECT value FROM json_each(?))`,
    ids(itemIds),
  );
  const entryIds = rows.map((r) => r.id as number);
  const byEntry = new Map<number, StudyEntry>();
  for (const r of rows) {
    const grammar = json<{ notes?: string }>(r.grammar, {});
    const se: StudyEntry = {
      itemId: r.item_id,
      entryId: r.id,
      lemma: r.lemma,
      display: r.display || r.lemma,
      pos: r.pos,
      gender: r.gender,
      aspect: r.aspect,
      aspectPair: r.aspect_pair,
      pronunciation: r.pronunciation,
      senses: [],
      forms: [],
      examples: [],
      expressions: [],
      grammarNotes: grammar.notes ?? null,
      regionalNote: r.regional_note,
      register: r.register,
      tags: [],
      frequencyRank: r.frequency_rank,
      curatedOrder: r.curated_order,
      imageUrl: r.image_url,
      isNew: r.status === 'new' || r.status === 'introduced',
      audio: { forvo: forvoConfigured, user: false },
    };
    out.set(r.item_id, se);
    byEntry.set(r.id, se);
  }
  const E = ids(entryIds);
  const senses = db.all<any>(
    'SELECT id, entry_id, gloss, definition, note FROM vocabulary_senses WHERE entry_id IN (SELECT value FROM json_each(?)) ORDER BY entry_id, sense_order',
    E,
  );
  const tr = db.all<any>(
    `SELECT t.sense_id, t.text FROM vocabulary_translations t JOIN vocabulary_senses s ON s.id = t.sense_id
      WHERE s.entry_id IN (SELECT value FROM json_each(?)) ORDER BY t.id`,
    E,
  );
  const trBySense = new Map<number, string[]>();
  for (const t of tr) (trBySense.get(t.sense_id) ?? trBySense.set(t.sense_id, []).get(t.sense_id)!).push(t.text);
  const senseIndex = new Map<number, number>();
  for (const s of senses) {
    const se = byEntry.get(s.entry_id);
    if (!se) continue;
    senseIndex.set(s.id, se.senses.length);
    se.senses.push({ gloss: s.gloss, translations: trBySense.get(s.id) ?? [s.gloss], definition: s.definition, note: s.note });
  }
  for (const f of db.all<any>('SELECT entry_id, form, display, tags FROM vocabulary_forms WHERE entry_id IN (SELECT value FROM json_each(?)) ORDER BY id', E)) {
    // A verb's forms can carry a dozen cell labels each; three are plenty for feedback and keep sessions small.
    byEntry.get(f.entry_id)?.forms.push({ form: f.form, display: f.display, tags: json<string[]>(f.tags, []).slice(0, 3) });
  }
  for (const r of db.all<any>('SELECT * FROM entry_paradigms WHERE entry_id IN (SELECT value FROM json_each(?))', E)) {
    const se = byEntry.get(r.entry_id);
    if (se) se.paradigm = paradigmFromRow(r);
  }
  for (const x of db.all<any>(
    `SELECT ee.entry_id, ee.sense_id, s.text, s.display, s.translation, ee.target, ee.target_start, ee.target_end, src.kind AS source_kind
       FROM entry_examples ee JOIN example_sentences s ON s.id = ee.sentence_id LEFT JOIN sources src ON src.id = s.source_id
      WHERE ee.entry_id IN (SELECT value FROM json_each(?)) ORDER BY ee.entry_id, ee.example_order`,
    E,
  )) {
    byEntry.get(x.entry_id)?.examples.push({
      text: x.text,
      display: x.display,
      translation: x.translation,
      target: x.target,
      start: x.target_start,
      end: x.target_end,
      sense: x.sense_id != null ? senseIndex.get(x.sense_id) ?? null : null,
      ...(x.source_kind === AI_SENTENCES ? { ai: true } : {}),
    });
  }
  for (const x of db.all<any>('SELECT entry_id, text, translation, kind FROM related_expressions WHERE entry_id IN (SELECT value FROM json_each(?)) ORDER BY id', E)) {
    byEntry.get(x.entry_id)?.expressions.push({ text: x.text, translation: x.translation, kind: expressionKind(x.kind) });
  }
  for (const t of db.all<any>(
    'SELECT et.entry_id, t.name FROM entry_tags et JOIN tags t ON t.id = et.tag_id WHERE et.entry_id IN (SELECT value FROM json_each(?)) ORDER BY t.name',
    E,
  )) {
    byEntry.get(t.entry_id)?.tags.push(t.name);
  }
  for (const a of db.all<any>("SELECT DISTINCT entry_id FROM pronunciation_records WHERE provider IN ('user', 'licensed') AND entry_id IN (SELECT value FROM json_each(?))", E)) {
    const se = byEntry.get(a.entry_id);
    if (se) se.audio.user = true;
  }
  if (forvoConfigured) {
    for (const a of db.all<any>("SELECT entry_id, status, checked_at FROM audio_lookups WHERE provider = 'forvo' AND entry_id IN (SELECT value FROM json_each(?))", E)) {
      const se = byEntry.get(a.entry_id);
      // A recent "none found" result means no Forvo listening exercises for this word.
      if (se && a.status === 'none' && now - a.checked_at < 30 * 86_400_000) se.audio.forvo = false;
    }
  }
  return out;
}

// ------------------------------------------------------------------ browsing

export interface ListQuery {
  language: LanguageCode;
  q?: string;
  pos?: string;
  tag?: string;
  status?: string; // new | learning | learned | mature | mastered | known | suspended | introduced | active
  due?: boolean;
  difficult?: boolean;
  favorite?: boolean;
  freqMin?: number;
  freqMax?: number;
  sort?: 'frequency' | 'alpha' | 'recent' | 'due' | 'difficulty';
  offset?: number;
  limit?: number;
}

const LIST_SELECT = `
  SELECT e.id AS entry_id, e.language_code, e.lemma, e.display, e.pos, e.frequency_rank, e.curated_order, e.is_custom,
         (SELECT gloss FROM vocabulary_senses s WHERE s.entry_id = e.id ORDER BY sense_order LIMIT 1) AS gloss,
         (SELECT group_concat(t.name, ',') FROM entry_tags et JOIN tags t ON t.id = et.tag_id WHERE et.entry_id = e.id) AS tags,
         li.status, COALESCE(li.is_favorite, 0) AS favorite, COALESCE(li.is_difficult, 0) AS difficult,
         r.due AS r_due, r.stability AS r_stab, r.state AS r_state, r.lapses AS r_lapses, r.reps AS r_reps,
         p.due AS p_due, p.stability AS p_stab, p.lapses AS p_lapses
    FROM vocabulary_entries e
    LEFT JOIN learning_items li ON li.entry_id = e.id
    LEFT JOIN fsrs_cards r ON r.item_id = li.id AND r.skill = 'receptive'
    LEFT JOIN fsrs_cards p ON p.item_id = li.id AND p.skill = 'productive'`;

export function learnState(row: any): VocabListItem['learnState'] {
  const status = row.status ?? 'new';
  if (status === 'known') return 'known';
  if (status === 'suspended') return 'suspended';
  if (status === 'new') return 'new';
  if (status === 'introduced' || !row.r_state) return 'learning';
  const rs = row.r_stab ?? 0;
  const ps = row.p_stab ?? 0;
  if (rs >= MATURE_STABILITY_DAYS && ps >= MATURE_STABILITY_DAYS) return 'mastered';
  if (rs >= MATURE_STABILITY_DAYS) return 'mature';
  if ((row.r_reps ?? 0) >= 2 && rs >= 3) return 'learned';
  return 'learning';
}

function toListItem(r: any): VocabListItem {
  return {
    entryId: r.entry_id,
    language: r.language_code,
    lemma: r.lemma,
    display: r.display || r.lemma,
    pos: r.pos,
    gloss: r.gloss ?? '',
    frequencyRank: r.frequency_rank,
    curatedOrder: r.curated_order,
    tags: r.tags ? String(r.tags).split(',') : [],
    status: r.status ?? 'new',
    learnState: learnState(r),
    favorite: !!r.favorite,
    difficult: !!r.difficult || (r.r_lapses ?? 0) + (r.p_lapses ?? 0) >= 3,
    receptiveDue: r.r_state ? r.r_due : null,
    productiveDue: r.p_due ?? null,
    receptiveStability: r.r_stab ?? null,
    lapses: (r.r_lapses ?? 0) + (r.p_lapses ?? 0),
    isCustom: !!r.is_custom,
  };
}

/** A word whose memory is due by the end of the day (two placeholders: end of today, twice), and a difficult word. */
const DUE_SQL = "li.status = 'active' AND ((r.state != 0 AND r.due < ?) OR (p.state != 0 AND p.due < ?))";
const DIFFICULT_SQL = '(li.is_difficult = 1 OR COALESCE(r.lapses, 0) + COALESCE(p.lapses, 0) >= 3)';
const LIST_FROM = `FROM vocabulary_entries e LEFT JOIN learning_items li ON li.entry_id = e.id
       LEFT JOIN fsrs_cards r ON r.item_id = li.id AND r.skill = 'receptive' LEFT JOIN fsrs_cards p ON p.item_id = li.id AND p.skill = 'productive'`;

/** The Words page's quick filters with their counts: every word, due today, difficult, favourites (2.0.0). */
export function vocabCounts(db: Db, language: string, endOfToday: number): { all: number; due: number; difficult: number; favorite: number } {
  const row = db.get<{ all: number; due: number | null; difficult: number | null; favorite: number | null }>(
    `SELECT COUNT(*) AS "all", SUM(CASE WHEN ${DUE_SQL} THEN 1 ELSE 0 END) AS due, SUM(CASE WHEN ${DIFFICULT_SQL} THEN 1 ELSE 0 END) AS difficult,
            SUM(CASE WHEN li.is_favorite = 1 THEN 1 ELSE 0 END) AS favorite
       ${LIST_FROM}
      WHERE e.language_code = ? AND e.deleted_at IS NULL`,
    endOfToday,
    endOfToday,
    language,
  );
  return { all: row?.all ?? 0, due: row?.due ?? 0, difficult: row?.difficult ?? 0, favorite: row?.favorite ?? 0 };
}

export function listVocabulary(db: Db, q: ListQuery, now: number, endOfToday: number): VocabListResponse {
  const where: string[] = ['e.language_code = ?', 'e.deleted_at IS NULL'];
  const params: any[] = [q.language];
  if (q.q?.trim()) {
    const key = matchKey(q.q, q.language);
    const enKey = matchKey(q.q, 'en');
    where.push(`(e.lemma_key LIKE ? OR EXISTS (SELECT 1 FROM vocabulary_forms f WHERE f.entry_id = e.id AND f.form_key LIKE ?)
                 OR EXISTS (SELECT 1 FROM vocabulary_senses s JOIN vocabulary_translations t ON t.sense_id = s.id WHERE s.entry_id = e.id AND t.text_key LIKE ?))`);
    params.push(`%${key}%`, `${key}%`, `%${enKey}%`);
  }
  if (q.pos) {
    where.push('e.pos = ?');
    params.push(q.pos);
  }
  if (q.tag) {
    where.push('EXISTS (SELECT 1 FROM entry_tags et JOIN tags t ON t.id = et.tag_id WHERE et.entry_id = e.id AND t.name = ?)');
    params.push(q.tag);
  }
  if (q.freqMin != null) {
    where.push('COALESCE(e.frequency_rank, e.curated_order) >= ?');
    params.push(q.freqMin);
  }
  if (q.freqMax != null) {
    where.push('COALESCE(e.frequency_rank, e.curated_order) <= ?');
    params.push(q.freqMax);
  }
  if (q.favorite) where.push('li.is_favorite = 1');
  if (q.difficult) where.push(DIFFICULT_SQL);
  if (q.due) {
    where.push(DUE_SQL);
    params.push(endOfToday, endOfToday);
  }
  switch (q.status) {
    case 'new':
      where.push("(li.id IS NULL OR li.status = 'new')");
      break;
    case 'known':
    case 'suspended':
    case 'introduced':
    case 'active':
      where.push('li.status = ?');
      params.push(q.status);
      break;
    case 'learning':
      where.push(`(li.status = 'introduced' OR (li.status = 'active' AND (r.state IS NULL OR r.state = 0 OR COALESCE(r.reps, 0) < 2 OR r.stability < 3)))`);
      break;
    case 'learned':
      where.push(`li.status = 'active' AND r.reps >= 2 AND r.stability >= 3`);
      break;
    case 'mature':
      where.push(`li.status = 'active' AND r.stability >= ${MATURE_STABILITY_DAYS}`);
      break;
    case 'mastered':
      where.push(`li.status = 'active' AND r.stability >= ${MATURE_STABILITY_DAYS} AND p.stability >= ${MATURE_STABILITY_DAYS}`);
      break;
  }
  const order =
    q.sort === 'alpha'
      ? 'e.lemma_key COLLATE NOCASE, e.id'
      : q.sort === 'recent'
        ? 'COALESCE(li.last_studied_at, 0) DESC, e.id DESC'
        : q.sort === 'due'
          ? 'COALESCE(MIN(r.due, COALESCE(p.due, r.due)), 9e15), e.id'
          : q.sort === 'difficulty'
            ? 'COALESCE(r.lapses, 0) + COALESCE(p.lapses, 0) DESC, COALESCE(r.difficulty, 0) DESC, e.id'
            : '(e.frequency_rank IS NULL), e.frequency_rank, (e.curated_order IS NULL), e.curated_order, e.id';
  const limit = Math.min(Math.max(q.limit ?? 50, 1), 200);
  const offset = Math.max(q.offset ?? 0, 0);
  const whereSql = where.join(' AND ');
  const total =
    db.get<{ n: number }>(
      `SELECT COUNT(*) AS n ${LIST_FROM}
       WHERE ${whereSql}`,
      ...params,
    )?.n ?? 0;
  const rows = db.all<any>(`${LIST_SELECT} WHERE ${whereSql} ORDER BY ${order} LIMIT ? OFFSET ?`, ...params, limit, offset);
  void now;
  return { items: rows.map(toListItem), total, offset, limit };
}

/** A link to one sentence at its source, where the source has sentence pages (Tatoeba). */
export function sentenceUrl(ref: string | null | undefined): string | null {
  const m = /^tatoeba:(\d+)$/.exec(ref ?? '');
  return m ? `https://tatoeba.org/en/sentences/show/${m[1]}` : null;
}

export function vocabDetail(db: Db, entryId: number, now: number): VocabDetail {
  const row = db.get<any>(`${LIST_SELECT} WHERE e.id = ? AND e.deleted_at IS NULL`, entryId);
  if (!row) throw notFound('Word');
  const e = db.get<any>('SELECT * FROM vocabulary_entries WHERE id = ?', entryId)!;
  const base = toListItem(row);
  const senses = db.all<any>('SELECT id, gloss, definition, note FROM vocabulary_senses WHERE entry_id = ? ORDER BY sense_order', entryId).map((s) => ({
    id: s.id,
    gloss: s.gloss,
    definition: s.definition,
    note: s.note,
    translations: db.all<{ text: string }>('SELECT text FROM vocabulary_translations WHERE sense_id = ? ORDER BY id', s.id).map((t) => t.text),
  }));
  const forms = db.all<any>('SELECT id, form, display, tags FROM vocabulary_forms WHERE entry_id = ? ORDER BY id', entryId).map((f) => ({ id: f.id, form: f.form, display: f.display, tags: json<string[]>(f.tags, []) }));
  const examples = db
    .all<any>(
      `SELECT s.id, s.text, s.display, s.translation, s.source_ref, ee.target, ee.sense_id, src.name AS source_name, src.license AS source_license, src.url AS source_url, src.kind AS source_kind
         FROM entry_examples ee JOIN example_sentences s ON s.id = ee.sentence_id LEFT JOIN sources src ON src.id = s.source_id
        WHERE ee.entry_id = ? ORDER BY ee.example_order`,
      entryId,
    )
    .map((x) => ({
      id: x.id,
      text: x.text,
      display: x.display,
      translation: x.translation,
      target: x.target,
      senseId: x.sense_id ?? null,
      source: x.source_name ? { name: x.source_name, license: x.source_license, url: sentenceUrl(x.source_ref) ?? x.source_url, ...(x.source_kind === AI_SENTENCES ? { ai: true } : {}) } : null,
    }));
  const paradigm = loadParadigm(db, entryId);
  const expressions = db.all<any>('SELECT id, text, translation, kind FROM related_expressions WHERE entry_id = ? ORDER BY id', entryId).map((x) => ({ ...x, kind: expressionKind(x.kind) }));
  const frequencies = db.all<any>(
    'SELECT s.name AS source, s.kind, f.rank, f.count FROM vocabulary_frequency f JOIN sources s ON s.id = f.source_id WHERE f.entry_id = ? ORDER BY f.rank',
    entryId,
  );
  const source = e.source_id ? db.get<any>('SELECT name, kind, license FROM sources WHERE id = ?', e.source_id) ?? null : null;
  const user = db.get<any>('SELECT note, mnemonic FROM entry_user_data WHERE entry_id = ?', entryId);
  const item = db.get<any>('SELECT * FROM learning_items WHERE entry_id = ?', entryId);
  let cards: CardInfo[] = [];
  let evidence: VocabDetail['evidence'] = [];
  let reviews: VocabDetail['reviews'] = [];
  let recentAttempts: VocabDetail['recentAttempts'] = [];
  if (item) {
    cards = db.all<any>('SELECT * FROM fsrs_cards WHERE item_id = ? ORDER BY skill', item.id).map((c) => ({
      skill: c.skill,
      state: c.state,
      stability: c.stability,
      difficulty: c.difficulty,
      due: c.state ? c.due : null,
      lastReview: c.last_review,
      reps: c.reps,
      lapses: c.lapses,
      retrievability: c.last_review && c.stability ? schedulerFor(db, e.language_code).retrievabilityAt(c.stability, (now - c.last_review) / 86_400_000) : null,
    }));
    evidence = db.all<any>('SELECT * FROM skill_evidence WHERE item_id = ? ORDER BY skill', item.id).map((x) => ({
      skill: x.skill,
      attempts: x.attempts,
      correct: x.correct,
      delayedCorrect: x.delayed_correct,
      streak: x.streak,
      lastAttemptAt: x.last_attempt_at,
    }));
    reviews = db
      .all<any>('SELECT id, skill, rating, reviewed_at, scheduled_days, stability_after, retrievability_before, exercise_kind FROM review_logs WHERE item_id = ? ORDER BY reviewed_at DESC LIMIT 100', item.id)
      .map((r) => ({ id: r.id, skill: r.skill, rating: r.rating, reviewedAt: r.reviewed_at, scheduledDays: r.scheduled_days, stabilityAfter: r.stability_after, retrievabilityBefore: r.retrievability_before, exerciseKind: r.exercise_kind }));
    recentAttempts = db
      .all<any>("SELECT kind, grade, answered_at, response FROM exercise_attempts WHERE item_id = ? AND kind != 'intro' ORDER BY answered_at DESC LIMIT 30", item.id)
      .map((a) => ({ kind: a.kind, grade: a.grade, answeredAt: a.answered_at, response: a.response }));
  }
  const evMap: Partial<Record<Skill, { delayedCorrect: number; correct: number; attempts: number }>> = {};
  for (const x of evidence) evMap[x.skill] = x;
  const hasAudio =
    !!db.get("SELECT 1 FROM pronunciation_records WHERE entry_id = ? AND provider IN ('user','licensed')", entryId) ||
    !!db.get("SELECT 1 FROM audio_lookups WHERE entry_id = ? AND status = 'found'", entryId);
  const rc = cards.find((c) => c.skill === 'receptive');
  const pc = cards.find((c) => c.skill === 'productive');
  return {
    ...base,
    gender: e.gender,
    aspect: e.aspect,
    aspectPair: e.aspect_pair,
    pronunciation: e.pronunciation,
    register: e.register,
    regionalNote: e.regional_note,
    grammarNotes: json<{ notes?: string }>(e.grammar, {}).notes ?? null,
    imageUrl: e.image_url,
    senses,
    forms,
    examples,
    paradigm,
    expressions,
    frequencies,
    source,
    note: user?.note ?? null,
    mnemonic: user?.mnemonic ?? null,
    cards,
    evidence,
    mastery: masteryLevels({
      status: item?.status ?? 'new',
      introducedAt: item?.introduced_at ?? null,
      receptiveStability: rc?.stability ?? null,
      productiveStability: pc?.stability ?? null,
      receptiveState: rc?.state ?? null,
      evidence: evMap,
      audioAvailable: hasAudio,
    }),
    reviews,
    recentAttempts,
    version: e.version,
  };
}

// ------------------------------------------------------------------ edits

export interface EntryInput {
  lemma: string;
  display?: string | null;
  pos?: string | null;
  gender?: string | null;
  aspect?: string | null;
  aspectPair?: string | null;
  pronunciation?: string | null;
  register?: string | null;
  regionalNote?: string | null;
  grammarNotes?: string | null;
  imageUrl?: string | null;
  senses: Array<{ gloss: string; translations?: string[]; definition?: string | null; note?: string | null }>;
  forms?: Array<{ form: string; display?: string | null; tags?: string[] }>;
  /**
   * sourceKey refers to the import file's sentenceSources; the importer resolves it to sourceId.
   * sense is the index (from 0) of the meaning in senses that the sentence shows. undefined on an edit keeps the
   * sentence's current meaning; null means not linked to a meaning.
   */
  examples?: Array<{ text: string; display?: string | null; translation?: string | null; target?: string | null; sense?: number | null; sourceId?: number | null; sourceKey?: string | null; sourceRef?: string | null }>;
  /** kind 'combination': a fixed combination with its own meaning (shown under the word, never quizzed as its meaning). undefined on an edit keeps them. */
  expressions?: Array<{ text: string; translation?: string | null; kind?: string }>;
  tags?: string[];
  frequencyRank?: number | null;
  curatedOrder?: number | null;
  /** Declension or conjugation table. undefined keeps the stored one (edits); null removes it. */
  paradigm?: Paradigm | null;
}

// ------------------------------------------------------------------ inflection tables

export function loadParadigm(db: Db, entryId: number): Paradigm | null {
  const r = db.get<{ kind: string; data: string; source: string | null }>('SELECT kind, data, source FROM entry_paradigms WHERE entry_id = ?', entryId);
  return r ? paradigmFromRow(r) : null;
}

export function paradigmFromRow(r: { kind: string; data: string; source: string | null }): Paradigm {
  const d = json<{ cells?: Record<string, string[]>; indeclinable?: boolean; notes?: string[]; gender?: string | null }>(r.data, {});
  return { kind: r.kind as Paradigm['kind'], source: r.source, cells: d.cells ?? {}, indeclinable: d.indeclinable || undefined, notes: d.notes, gender: d.gender ?? undefined };
}

export function writeParadigm(db: Db, entryId: number, p: Paradigm | null, importJobId: string | null, now: number) {
  db.run('DELETE FROM entry_paradigms WHERE entry_id = ?', entryId);
  if (!p) return;
  db.run(
    'INSERT INTO entry_paradigms (entry_id, kind, data, source, import_job_id, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    entryId,
    p.kind,
    JSON.stringify({ cells: p.cells, indeclinable: p.indeclinable || undefined, notes: p.notes, gender: p.gender ?? undefined }),
    p.source ?? null,
    importJobId,
    now,
  );
}

/**
 * The forms to store for a word: every form of its table, tagged with the cells it fills, then any other forms
 * given (a dictionary's list). A form is identified by its stress-marked spelling, so Russian воды́ (genitive)
 * and во́ды (plural) stay apart; a form without stress marks joins the stressed form it spells.
 */
export function mergedForms(language: LanguageCode, paradigm: Paradigm | null, forms: EntryInput['forms']): Array<{ form: string; display?: string | null; tags: string[] }> {
  type Item = { form: string; display?: string | null; tags: string[]; stressed: boolean };
  const out: Item[] = [];
  const exact = new Map<string, Item>();
  const byPlain = new Map<string, Item[]>();
  const add = (f: { form: string; display?: string | null; tags?: string[] }) => {
    const shown = (f.display ?? f.form).trim().normalize('NFC');
    const plain = stripStress(shown);
    const pk = matchKey(plain, language);
    if (!pk) return;
    const stressed = shown !== plain;
    const tags = f.tags ?? [];
    const merge = (into: Item) => {
      for (const t of tags) if (!into.tags.includes(t)) into.tags.push(t);
    };
    const hit = exact.get(shown.toLowerCase());
    if (hit) return merge(hit);
    const same = byPlain.get(pk) ?? [];
    if (!stressed && same.length) return merge(same[0]);
    const unstressed = stressed ? same.find((x) => !x.stressed) : undefined;
    if (unstressed) {
      unstressed.display = shown;
      unstressed.stressed = true;
      exact.set(shown.toLowerCase(), unstressed);
      return merge(unstressed);
    }
    const item: Item = { form: plain, display: stressed ? shown : null, tags: [...tags], stressed };
    exact.set(shown.toLowerCase(), item);
    byPlain.set(pk, [...same, item]);
    out.push(item);
  };
  if (paradigm && !paradigm.indeclinable) for (const f of paradigmForms(language, paradigm)) add(f);
  for (const f of forms ?? []) if (f.form?.trim()) add(f);
  return out.map(({ form, display, tags }) => ({ form, display, tags }));
}

export function tagId(db: Db, name: string): number {
  const n = name.trim().toLowerCase().slice(0, 60);
  db.run('INSERT INTO tags (name) VALUES (?) ON CONFLICT(name) DO NOTHING', n);
  return db.get<{ id: number }>('SELECT id FROM tags WHERE name = ?', n)!.id;
}

/** 'combination': two or more words with a meaning of their own; anything else is a related expression. */
export const expressionKind = (k: string | null | undefined) => (k === 'combination' ? 'combination' : 'expression');

/** Write senses, forms, examples, expressions and tags for an entry (replacing existing child rows). */
export function writeEntryChildren(db: Db, entryId: number, language: LanguageCode, input: EntryInput, now: number, importJobId: string | null, sourceId: number | null) {
  // An edit may send sentences without their meaning: remember which meaning (by position and gloss) each one showed.
  const oldMeaning = new Map(
    db
      .all<{ text: string; sense_order: number | null; gloss: string | null }>(
        'SELECT s.text, vs.sense_order, vs.gloss FROM entry_examples ee JOIN example_sentences s ON s.id = ee.sentence_id LEFT JOIN vocabulary_senses vs ON vs.id = ee.sense_id WHERE ee.entry_id = ?',
        entryId,
      )
      .map((r) => [r.text, r]),
  );
  db.run('DELETE FROM vocabulary_senses WHERE entry_id = ?', entryId);
  const senseIds: number[] = [];
  const newGlosses = input.senses.map((s) => s.gloss.trim());
  input.senses.forEach((s, i) => {
    const senseId = Number(db.run('INSERT INTO vocabulary_senses (entry_id, sense_order, gloss, definition, note, import_job_id) VALUES (?, ?, ?, ?, ?, ?)', entryId, i, s.gloss.trim(), s.definition ?? null, s.note ?? null, importJobId).lastInsertRowid);
    senseIds.push(senseId);
    const translations = [s.gloss, ...(s.translations ?? [])].map((t) => t.trim()).filter(Boolean);
    for (const t of translations) {
      db.run('INSERT INTO vocabulary_translations (sense_id, text, text_key, import_job_id) VALUES (?, ?, ?, ?) ON CONFLICT(sense_id, text_key) DO NOTHING', senseId, t, matchKey(t, 'en'), importJobId);
    }
  });
  let paradigm: Paradigm | null;
  if (input.paradigm !== undefined) {
    paradigm = input.paradigm ? sanitizeParadigm(input.paradigm) : null;
    writeParadigm(db, entryId, paradigm, importJobId, now);
  } else paradigm = loadParadigm(db, entryId);
  db.run('DELETE FROM vocabulary_forms WHERE entry_id = ?', entryId);
  for (const f of mergedForms(language, paradigm, input.forms)) {
    const form = stripStress(f.form.trim());
    db.run('INSERT INTO vocabulary_forms (entry_id, form, form_key, display, tags, import_job_id) VALUES (?, ?, ?, ?, ?, ?)', entryId, form, matchKey(form, language), f.display ?? (f.form !== form ? f.form : null), JSON.stringify(f.tags ?? []), importJobId);
  }
  // An edit sends examples without their sources: keep the source of a sentence that is still there.
  const oldSource = new Map(
    db
      .all<{ text: string; source_id: number | null; source_ref: string | null }>('SELECT s.text, s.source_id, s.source_ref FROM entry_examples ee JOIN example_sentences s ON s.id = ee.sentence_id WHERE ee.entry_id = ?', entryId)
      .map((r) => [r.text, r]),
  );
  // A sentence that stays keeps its row, so its practice history stays with it.
  const oldSentences = db.all<{ sentence_id: number; text: string }>('SELECT ee.sentence_id, s.text FROM entry_examples ee JOIN example_sentences s ON s.id = ee.sentence_id WHERE ee.entry_id = ?', entryId);
  const reusable = new Map(oldSentences.filter((s) => !db.get('SELECT 1 FROM entry_examples WHERE sentence_id = ? AND entry_id != ?', s.sentence_id, entryId)).map((s) => [s.text, s.sentence_id]));
  db.run('DELETE FROM entry_examples WHERE entry_id = ?', entryId);
  const kept = new Set<number>();
  const senseFor = (x: NonNullable<EntryInput['examples']>[number], text: string): number | null => {
    if (x.sense !== undefined) return x.sense != null && senseIds[x.sense] != null ? senseIds[x.sense] : null;
    const m = oldMeaning.get(text);
    if (!m || m.gloss == null) return null;
    // Same gloss first (meanings may have been reordered), then the same position.
    const byGloss = newGlosses.indexOf(m.gloss);
    if (byGloss >= 0) return senseIds[byGloss];
    return m.sense_order != null && senseIds[m.sense_order] != null ? senseIds[m.sense_order] : null;
  };
  const seen = new Set<string>();
  (input.examples ?? []).forEach((x, i) => {
    if (!x.text?.trim()) return;
    const text = stripStress(x.text.trim());
    if (seen.has(text)) return; // the same sentence twice would break the (entry, sentence) key
    seen.add(text);
    const display = x.display ?? (x.text.trim() !== text ? x.text.trim() : null);
    const old = oldSource.get(text);
    const sourceIdValue = x.sourceId ?? old?.source_id ?? sourceId;
    const sourceRef = x.sourceRef ?? (x.sourceId == null ? old?.source_ref ?? null : null);
    let sid = reusable.get(text);
    if (sid != null) {
      db.run('UPDATE example_sentences SET display = ?, translation = ?, source_id = ?, source_ref = ?, import_job_id = ? WHERE id = ?', display, x.translation ?? null, sourceIdValue, sourceRef, importJobId, sid);
      kept.add(sid);
    } else {
      sid = Number(
        db.run(
          'INSERT INTO example_sentences (language_code, text, display, translation, source_id, source_ref, import_job_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          language,
          text,
          display,
          x.translation ?? null,
          sourceIdValue,
          sourceRef,
          importJobId,
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
      senseFor(x, text),
      range ? text.slice(range[0], range[1]) : null,
      range?.[0] ?? null,
      range?.[1] ?? null,
      i,
    );
  });
  for (const s of oldSentences) {
    if (!kept.has(s.sentence_id) && !db.get('SELECT 1 FROM entry_examples WHERE sentence_id = ?', s.sentence_id)) db.run('DELETE FROM example_sentences WHERE id = ?', s.sentence_id);
  }
  if (input.expressions !== undefined) {
    db.run('DELETE FROM related_expressions WHERE entry_id = ?', entryId);
    for (const x of input.expressions) {
      if (x.text?.trim()) db.run('INSERT INTO related_expressions (entry_id, text, translation, kind, import_job_id) VALUES (?, ?, ?, ?, ?)', entryId, x.text.trim(), x.translation ?? null, expressionKind(x.kind), importJobId);
    }
  }
  db.run('DELETE FROM entry_tags WHERE entry_id = ?', entryId);
  for (const t of new Set((input.tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean))) {
    db.run('INSERT INTO entry_tags (entry_id, tag_id) VALUES (?, ?) ON CONFLICT DO NOTHING', entryId, tagId(db, t));
  }
}

export function createEntry(db: Db, language: LanguageCode, input: EntryInput, now: number, opts: { custom: boolean; sourceId?: number | null; importJobId?: string | null; homograph?: number }): number {
  const lemma = stripStress(input.lemma.trim().normalize('NFC'));
  if (!/[\p{L}\p{N}]/u.test(lemma)) throw new HttpError(422, 'validation_failed', 'A word is required.');
  if (!input.senses.length || !input.senses[0].gloss?.trim()) throw new HttpError(422, 'validation_failed', 'An English meaning is required.');
  const display = input.display?.trim() || (input.lemma.trim() !== lemma ? input.lemma.trim() : null);
  const pos = normalizePos(input.pos);
  const key = matchKey(lemma, language);
  let homograph = opts.homograph ?? 0;
  if (opts.homograph == null) {
    const max = db.get<{ h: number | null }>('SELECT MAX(homograph) AS h FROM vocabulary_entries WHERE language_code = ? AND lemma_key = ? AND pos = ?', language, key, pos)?.h;
    homograph = max == null ? 0 : max + 1;
  }
  const id = db.run(
    `INSERT INTO vocabulary_entries (language_code, lemma, lemma_key, display, pos, homograph, gender, aspect, aspect_pair, pronunciation, grammar,
       register, regional_note, image_url, frequency_rank, curated_order, source_id, import_job_id, is_custom, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    language,
    lemma,
    key,
    display,
    pos,
    homograph,
    input.gender ?? null,
    input.aspect ?? null,
    input.aspectPair ?? null,
    input.pronunciation ?? null,
    input.grammarNotes ? JSON.stringify({ notes: input.grammarNotes }) : null,
    input.register ?? null,
    input.regionalNote ?? null,
    input.imageUrl ?? null,
    input.frequencyRank ?? null,
    input.curatedOrder ?? null,
    opts.sourceId ?? null,
    opts.importJobId ?? null,
    opts.custom ? 1 : 0,
    now,
    now,
  ).lastInsertRowid;
  writeEntryChildren(db, id, language, input, now, opts.importJobId ?? null, opts.sourceId ?? null);
  return id;
}

export function updateEntry(db: Db, entryId: number, input: EntryInput, baseVersion: number | null, now: number): void {
  const e = db.get<any>('SELECT * FROM vocabulary_entries WHERE id = ? AND deleted_at IS NULL', entryId);
  if (!e) throw notFound('Word');
  if (baseVersion != null && baseVersion !== e.version) {
    throw new HttpError(409, 'edit_conflict', 'This word was changed on another device. Reload to see the latest version before editing.', { currentVersion: e.version });
  }
  const lemma = stripStress(input.lemma.trim().normalize('NFC'));
  const key = matchKey(lemma, e.language_code);
  const pos = normalizePos(input.pos ?? e.pos);
  if (key !== e.lemma_key || pos !== e.pos) {
    const clash = db.get('SELECT id FROM vocabulary_entries WHERE language_code = ? AND lemma_key = ? AND pos = ? AND homograph = ? AND id != ?', e.language_code, key, pos, e.homograph, entryId);
    if (clash) {
      const max = db.get<{ h: number }>('SELECT MAX(homograph) AS h FROM vocabulary_entries WHERE language_code = ? AND lemma_key = ? AND pos = ?', e.language_code, key, pos)!.h;
      db.run('UPDATE vocabulary_entries SET homograph = ? WHERE id = ?', (max ?? 0) + 1, entryId);
    }
  }
  db.run(
    `UPDATE vocabulary_entries SET lemma = ?, lemma_key = ?, display = ?, pos = ?, gender = ?, aspect = ?, aspect_pair = ?, pronunciation = ?,
       grammar = ?, register = ?, regional_note = ?, image_url = ?, version = version + 1, updated_at = ? WHERE id = ?`,
    lemma,
    key,
    input.display?.trim() || null,
    pos,
    input.gender ?? null,
    input.aspect ?? null,
    input.aspectPair ?? null,
    input.pronunciation ?? null,
    input.grammarNotes ? JSON.stringify({ notes: input.grammarNotes }) : null,
    input.register ?? null,
    input.regionalNote ?? null,
    input.imageUrl ?? null,
    now,
    entryId,
  );
  writeEntryChildren(db, entryId, e.language_code, input, now, null, e.source_id);
}

export function softDeleteEntry(db: Db, entryId: number, now: number): void {
  const r = db.run('UPDATE vocabulary_entries SET deleted_at = ?, version = version + 1, updated_at = ? WHERE id = ? AND deleted_at IS NULL', now, now, entryId);
  if (!r.changes) throw notFound('Word');
}

export function setItemFlags(db: Db, entryId: number, flags: { favorite?: boolean; difficult?: boolean; status?: 'known' | 'suspended' | 'restore' }, now: number) {
  const e = db.get<{ language_code: LanguageCode }>('SELECT language_code FROM vocabulary_entries WHERE id = ? AND deleted_at IS NULL', entryId);
  if (!e) throw notFound('Word');
  const itemId = ensureItem(db, entryId, e.language_code, now);
  // Starring a word or flagging it difficult leaves updated_at alone, so for a word marked known (or suspended) on its
  // page updated_at stays the moment that happened: the Progress page's words-known history counts it from that day.
  if (flags.favorite != null) db.run('UPDATE learning_items SET is_favorite = ?, version = version + 1 WHERE id = ?', flags.favorite ? 1 : 0, itemId);
  if (flags.difficult != null) db.run('UPDATE learning_items SET is_difficult = ?, version = version + 1 WHERE id = ?', flags.difficult ? 1 : 0, itemId);
  if (flags.status === 'known' || flags.status === 'suspended') {
    db.run('UPDATE learning_items SET status = ?, updated_at = ?, version = version + 1 WHERE id = ?', flags.status, now, itemId);
  } else if (flags.status === 'restore') {
    const hasSchedule = db.get("SELECT 1 FROM fsrs_cards WHERE item_id = ? AND state != 0", itemId);
    const introduced = db.get<{ introduced_at: number | null }>('SELECT introduced_at FROM learning_items WHERE id = ?', itemId)?.introduced_at;
    db.run('UPDATE learning_items SET status = ?, updated_at = ?, version = version + 1 WHERE id = ?', hasSchedule ? 'active' : introduced ? 'introduced' : 'new', now, itemId);
  }
  return itemId;
}

/**
 * Full-fidelity export of a language's vocabulary in the `vocabbuilder-v1` import format, so a JSON export can be
 * imported again (on this server or another). Learning progress is exported separately (/api/export/progress).
 */
export function exportVocabularyV1(db: Db, language: LanguageCode, now: number) {
  const entries = db.all<any>(
    'SELECT * FROM vocabulary_entries WHERE language_code = ? AND deleted_at IS NULL ORDER BY COALESCE(frequency_rank, curated_order, 1e9), id',
    language,
  );
  const sentenceSources: Record<string, { name: string; license: string | null; url: string | null; ai?: boolean }> = {};
  // Keys are slugs of the source names (unique per language), so an export reads the same on any server.
  const keyById = new Map<number, string | null>();
  const sourceKey = (id: number | null) => {
    if (id == null) return null;
    if (keyById.has(id)) return keyById.get(id)!;
    const r = db.get<any>('SELECT name, license, url, kind FROM sources WHERE id = ?', id);
    let k: string | null = null;
    if (r) {
      const base = String(r.name).toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'source';
      k = base;
      for (let i = 2; sentenceSources[k] && sentenceSources[k].name !== r.name; i++) k = `${base}-${i}`;
      sentenceSources[k] = { name: r.name, license: r.license, url: r.url, ...(r.kind === AI_SENTENCES ? { ai: true } : {}) };
    }
    keyById.set(id, k);
    return k;
  };
  const paradigms = new Map(db.all<any>('SELECT p.* FROM entry_paradigms p JOIN vocabulary_entries e ON e.id = p.entry_id WHERE e.language_code = ?', language).map((r) => [r.entry_id as number, paradigmFromRow(r)]));
  const out = {
    format: 'vocabbuilder-v1',
    language,
    exportedAt: new Date(now).toISOString(),
    source: { name: `VocabBuilder export (${language})`, kind: 'export', license: null, notes: 'Exported from VocabBuilder. Check the licences of the sources you imported originally before sharing.' },
    sentenceSources,
    entries: entries.map((e) => {
      const senseRows = db.all<any>('SELECT id, gloss, definition, note FROM vocabulary_senses WHERE entry_id = ? ORDER BY sense_order', e.id);
      const senseIndex = new Map(senseRows.map((sn, i) => [sn.id as number, i]));
      return {
      lemma: e.lemma,
      display: e.display,
      pos: e.pos,
      gender: e.gender,
      aspect: e.aspect,
      aspectPair: e.aspect_pair ?? null,
      pronunciation: e.pronunciation,
      register: e.register ?? null,
      regionalNote: e.regional_note ?? null,
      grammar: json<Record<string, unknown> | null>(e.grammar, null) ?? undefined,
      senses: senseRows.map((sn) => ({
        gloss: sn.gloss,
        translations: db.all<{ text: string }>('SELECT text FROM vocabulary_translations WHERE sense_id = ? ORDER BY id', sn.id).map((t) => t.text),
        definition: sn.definition,
        note: sn.note,
      })),
      forms: db.all<any>('SELECT form, display, tags FROM vocabulary_forms WHERE entry_id = ? ORDER BY id', e.id).map((f) => ({ form: f.form, display: f.display, tags: json<string[]>(f.tags, []) })),
      examples: db
        .all<any>(
          `SELECT s.text, s.display, s.translation, s.source_id, s.source_ref, ee.target, ee.sense_id FROM entry_examples ee JOIN example_sentences s ON s.id = ee.sentence_id
            WHERE ee.entry_id = ? ORDER BY ee.example_order`,
          e.id,
        )
        .map((x) => ({
          text: x.text,
          display: x.display,
          translation: x.translation,
          target: x.target,
          ...(x.sense_id != null && senseIndex.has(x.sense_id) ? { sense: senseIndex.get(x.sense_id) } : {}),
          source: sourceKey(x.source_id),
          ref: x.source_ref ?? null,
        })),
      paradigm: paradigms.get(e.id) ?? undefined,
      expressions: db.all<any>('SELECT text, translation, kind FROM related_expressions WHERE entry_id = ? ORDER BY id', e.id).map((x) => ({ text: x.text, translation: x.translation, kind: expressionKind(x.kind) })),
      tags: db.all<{ name: string }>('SELECT t.name FROM entry_tags et JOIN tags t ON t.id = et.tag_id WHERE et.entry_id = ? ORDER BY t.name', e.id).map((t) => t.name),
      frequencyRank: e.frequency_rank,
      curatedOrder: e.curated_order,
      imageUrl: e.image_url ?? null,
      };
    }),
  };
  return out;
}
