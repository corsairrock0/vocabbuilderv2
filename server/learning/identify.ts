// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
/**
 * Identify practice: an everyday photo with one object marked by a dot; the learner names the object.
 *
 * The scenes, their pictures and the words that name each object come from data/identify/identify.json (built by
 * scripts/identify/build-data.mjs from data/identify/scene-plan.json, the boxes and points Gemini found and the word
 * review). The pictures are served from /identify/ (copied there by the web build).
 *
 * Like the other practices this runs outside the spaced-repetition schedule; answers go to practice_attempts with
 * mode 'identify' and the scene object ("S012:3") in the cell column. An object is practiced in a language when at
 * least one of its words for that language is among the learner's words; every word listed for the object counts as
 * right, and the one asked for is the learner's own (in "words I'm learning") or the most natural one.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { App } from '../app.ts';
import type { Db } from '../db/database.ts';
import { HttpError, notFound } from '../http/http.ts';
import type { AnswerSpec } from '../../shared/answer.ts';
import { paradigmForms } from '../../shared/paradigms.ts';
import type { LanguageCode } from '../../shared/languages.ts';
import { canonical, matchKey, stripStress } from '../../shared/text.ts';
import { paradigmFromRow } from '../vocab/repo.ts';
import type { PracticeScope } from './practice.ts';
import { practiceUrgency } from './scheduling.ts';
import { getTimezone } from '../services/settings.ts';

export interface IdentifyObject {
  n: number;
  o: string;
  label: string;
  /** [y, x], 0–1000. */
  point: [number, number];
  /** [ymin, xmin, ymax, xmax], 0–1000. */
  box: [number, number, number, number];
  /** [lemma, display] per language; the first is the most natural name. */
  words: Partial<Record<LanguageCode, Array<[string, string]>>>;
}

export interface IdentifyScene {
  id: string;
  title: string;
  w: number;
  h: number;
  /** File names under /identify/, by width. */
  src: Record<string, string>;
  objects: IdentifyObject[];
}

export interface IdentifyData {
  format: string;
  version: string;
  credit: string;
  scenes: IdentifyScene[];
}

let cache: { file: string; mtimeMs: number; data: IdentifyData } | null = null;

export function identifyFile(app: App) {
  return path.join(app.config.root, 'data', 'identify', 'identify.json');
}

/** The scene data, re-read when the file changes; null when this installation has no pictures. */
export function loadIdentify(app: App): IdentifyData | null {
  const file = identifyFile(app);
  if (!existsSync(file)) return null;
  const mtimeMs = statSync(file).mtimeMs;
  if (!cache || cache.file !== file || cache.mtimeMs !== mtimeMs) {
    cache = { file, mtimeMs, data: JSON.parse(readFileSync(file, 'utf8')) as IdentifyData };
  }
  return cache.data;
}

export const IMAGE_BASE = '/identify/';

interface EntryRow {
  id: number;
  lemma: string;
  display: string | null;
  pos: string;
  frequency_rank: number | null;
  learning: number;
}

export interface CandidateWord {
  lemma: string;
  display: string;
  entry: EntryRow | null;
}

export interface Candidate {
  key: string;
  scene: IdentifyScene;
  obj: IdentifyObject;
  words: CandidateWord[];
}

/**
 * The learner's words that name scene objects, matched on the lemma (case, stress marks and Russian ё folded).
 * When a lemma has several entries, a noun wins, then the more frequent one.
 */
function entriesByKey(db: Db, language: LanguageCode): Map<string, EntryRow> {
  const rows = db.all<EntryRow>(
    `SELECT e.id, e.lemma, e.display, e.pos, e.frequency_rank,
            EXISTS (SELECT 1 FROM learning_items li WHERE li.entry_id = e.id AND li.status IN ('introduced', 'active')) AS learning
       FROM vocabulary_entries e WHERE e.language_code = ? AND e.deleted_at IS NULL`,
    language,
  );
  const better = (a: EntryRow, b: EntryRow) => (a.pos === 'noun' ? 0 : 1) - (b.pos === 'noun' ? 0 : 1) || (a.frequency_rank ?? 1e9) - (b.frequency_rank ?? 1e9) || a.id - b.id;
  const out = new Map<string, EntryRow>();
  for (const r of rows) {
    const k = matchKey(r.lemma, language);
    const prev = out.get(k);
    if (!prev || better(r, prev) < 0) out.set(k, r);
  }
  return out;
}

/** Every scene object that has a word for this language among the learner's words. */
export function identifyCandidates(app: App, language: LanguageCode): Candidate[] {
  const data = loadIdentify(app);
  if (!data) return [];
  const byKey = entriesByKey(app.db, language);
  const out: Candidate[] = [];
  for (const scene of data.scenes) {
    for (const obj of scene.objects) {
      const ws = obj.words[language];
      if (!ws?.length) continue;
      const words = ws.map(([lemma, display]) => ({ lemma, display, entry: byKey.get(matchKey(lemma, language)) ?? null }));
      if (words.some((w) => w.entry)) out.push({ key: `${scene.id}:${obj.n}`, scene, obj, words });
    }
  }
  return out;
}

/** The word the item asks for: the given entry, else a word being learned (for that scope), else the first matched word. */
export function primaryWord(c: Candidate, scope: PracticeScope, entryId?: number | null, entryIds?: Set<number> | null): CandidateWord | null {
  if (scope === 'entry') return c.words.find((w) => w.entry?.id === entryId) ?? null;
  if (scope === 'entries') return c.words.find((w) => w.entry && entryIds?.has(w.entry.id)) ?? null;
  if (scope === 'learning') return c.words.find((w) => w.entry?.learning) ?? null;
  return c.words.find((w) => w.entry) ?? null;
}

function formsOf(db: Db, language: LanguageCode, entryId: number): Array<{ form: string; tags: string[] }> {
  const row = db.get<{ kind: string; data: string; source: string | null }>('SELECT kind, data, source FROM entry_paradigms WHERE entry_id = ?', entryId);
  if (row) {
    const p = paradigmFromRow(row);
    if (!p.indeclinable && Object.keys(p.cells).length) return paradigmForms(language, p).map((f) => ({ form: stripStress(f.form), tags: f.tags }));
  }
  return db.all<{ form: string; tags: string }>('SELECT form, tags FROM vocabulary_forms WHERE entry_id = ?', entryId).map((f) => ({ form: f.form, tags: JSON.parse(f.tags) as string[] }));
}

const OBLIQUE = /genitive|dative|accusative|instrumental|locative|vocative|prepositional/;

/**
 * The plurals of a noun that name things rather than fill a case: Spanish "escuelas", Polish "szkoły". A gendered
 * plural counts only when the noun has no singular of that gender among its forms (niños for niño, not niñas).
 */
export function namingPlurals(forms: Array<{ form: string; tags: string[] }>): Set<string> {
  const otherGender = new Set<string>(forms.flatMap((f) => (f.tags.includes('singular') ? f.tags.filter((t) => t === 'masculine' || t === 'feminine') : [])));
  const out = new Set<string>();
  for (const { form, tags } of forms) {
    const labelled = tags.some((t) => t.startsWith('nominative plural'));
    const tagged = tags.includes('plural') && !tags.some((t) => OBLIQUE.test(t) || otherGender.has(t));
    if (labelled || tagged) out.add(form);
  }
  return out;
}

/**
 * What the answer accepts: every word listed for the object (the asked one first) and the plurals of those that are
 * nouns, since many pictures show several of a thing. Other forms count as "right word, other form", with a note
 * that the practice wants the dictionary form; the names of the other objects in the picture are never taken as typos.
 */
export function identifySpec(db: Db, language: LanguageCode, c: Candidate, primary: CandidateWord): AnswerSpec {
  const words = [primary, ...c.words.filter((w) => w !== primary)];
  const accepted = words.map((w) => w.lemma);
  const keys = new Set(accepted.map((a) => canonical(a, language)));
  const otherForms: Array<{ form: string; tags: string[] }> = [];
  for (const w of words) {
    if (!w.entry) continue;
    const forms = formsOf(db, language, w.entry.id);
    const plurals = w.entry.pos === 'noun' ? namingPlurals(forms) : new Set<string>();
    for (const f of forms) {
      const k = canonical(f.form, language);
      if (keys.has(k)) continue;
      keys.add(k);
      if (plurals.has(f.form)) accepted.push(f.form);
      else otherForms.push({ form: f.form, tags: f.tags.slice(0, 4) });
    }
  }
  const confusables = c.scene.objects
    .filter((o) => o.n !== c.obj.n)
    .flatMap((o) => (o.words[language] ?? []).map(([lemma]) => lemma))
    .filter((l) => !keys.has(canonical(l, language)));
  return {
    lang: language,
    accepted,
    otherForms,
    confusables: [...new Set(confusables)],
    wrongFormNote: `Name it with the dictionary form, “${stripStress(primary.display)}”.`,
  };
}

function shuffle<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Four options: the asked word and three names of other things, the objects in the same picture first (so the
 * dot, not the scene, decides), then common names from other pictures. No option is another right answer.
 */
export function identifyChoices(language: LanguageCode, c: Candidate, primary: CandidateWord, pool: string[]): string[] {
  const seen = new Set(c.words.map((w) => canonical(w.lemma, language)));
  const out: string[] = [];
  const add = (display: string) => {
    const k = canonical(display, language);
    if (!k || seen.has(k) || out.length >= 3) return;
    seen.add(k);
    out.push(display);
  };
  for (const o of shuffle(c.scene.objects.filter((o) => o.n !== c.obj.n))) {
    const first = o.words[language]?.[0];
    if (first) add(first[1]);
  }
  for (const d of shuffle(pool)) {
    if (out.length >= 3) break;
    add(d);
  }
  return shuffle([primary.display, ...out]);
}

export interface IdentifyItem {
  id: string;
  scene: { id: string; w: number; h: number; src: { small: string; large: string } };
  n: number;
  label: string;
  point: [number, number];
  box: [number, number, number, number];
  entryId: number;
  lemma: string;
  display: string;
  pos: string;
  /** The other right answers (display forms). */
  alsoRight: string[];
  answer: AnswerSpec;
  choices: string[] | null;
}

/** The scopes an Identify batch for a list of words can fill up from, in the order given. */
export type IdentifyFill = 'learning' | 'all';

export interface IdentifyRequest {
  language: LanguageCode;
  scope: PracticeScope;
  entryId?: number | null;
  entryIds?: number[] | null;
  choices?: boolean;
  size?: number;
  /**
   * With scope 'entries' (a Comprehensive session's words): when those words name fewer objects than `size`, fill up
   * from these scopes in turn, e.g. the words being learned, then all the learner's words. Used for the session's
   * Identify minimum.
   */
  fill?: IdentifyFill[] | null;
}

/** What picking needs to know of a usable object: the object, its picture and the word it would ask for. */
export interface Pickable {
  key: string;
  scene: string;
  entry: number;
}

/**
 * The objects of a batch, tier by tier (the requested words first, then each fill-up scope), each tier in its own
 * order. Each word is asked once and each picture shown at most twice, except when practicing a single word (`single`).
 * `relax`: when the tiers can't fill the batch that way, the objects left over follow, in the same order, so a learner
 * with few pictured words still gets as many pictures as there are.
 */
export function pickObjects<T extends Pickable>(tiers: T[][], size: number, opts: { single?: boolean; relax?: boolean } = {}): T[] {
  const all = tiers.flat();
  const picked: T[] = [];
  const perEntry = new Set<number>();
  const perScene = new Map<string, number>();
  for (const x of all) {
    if (picked.length >= size) break;
    if (!opts.single && (perEntry.has(x.entry) || (perScene.get(x.scene) ?? 0) >= 2)) continue;
    picked.push(x);
    perEntry.add(x.entry);
    perScene.set(x.scene, (perScene.get(x.scene) ?? 0) + 1);
  }
  if (opts.relax) {
    const taken = new Set(picked.map((x) => x.key));
    for (const x of all) {
      if (picked.length >= size) break;
      if (!taken.has(x.key)) picked.push(x);
    }
  }
  return picked;
}

function sceneImages(s: IdentifyScene) {
  const widths = Object.keys(s.src).map(Number).sort((a, b) => a - b);
  return { small: IMAGE_BASE + s.src[String(widths[0])], large: IMAGE_BASE + s.src[String(widths[widths.length - 1])] };
}

/**
 * A batch of objects to name. Objects missed recently come first, then objects never practiced, then the least
 * recently practiced; frequent words first among equals. Each word is asked once per batch and each picture at most
 * twice, except when practicing a single word (its pictures in turn). With scope 'entries' and `fill`, the objects the
 * given words name come first and the fill-up scopes' objects after them, each tier in that order (pickObjects).
 */
export function identifyBatch(app: App, req: IdentifyRequest, now: number): { items: IdentifyItem[]; available: number } {
  const db = app.db;
  const size = Math.min(Math.max(req.size ?? 20, 1), 50);
  if (req.scope === 'entry' && !req.entryId) throw new HttpError(422, 'validation_failed', 'Choose a word to practice.');
  // A session's words can be none yet (a slot reached before any answer); the fill-up still has the learner's words.
  if (req.scope === 'entries' && !req.entryIds?.length && !req.fill?.length) throw new HttpError(422, 'validation_failed', 'Choose the words to practice.');
  const all = identifyCandidates(app, req.language);
  const wanted = req.scope === 'entries' ? new Set(req.entryIds) : null;
  const fill = req.scope === 'entries' ? [...new Set(req.fill ?? [])] : [];
  // Each object once, in the first tier where one of the learner's words fits it, asked as that tier's word.
  const seen = new Set<string>();
  const tiers = [req.scope, ...fill].map((scope) => {
    const tier: Array<{ c: Candidate; primary: CandidateWord }> = [];
    for (const c of all) {
      if (seen.has(c.key)) continue;
      const primary = primaryWord(c, scope, req.entryId, wanted);
      if (!primary) continue;
      seen.add(c.key);
      tier.push({ c, primary });
    }
    return tier;
  });
  const usable = tiers.flat();
  if (!usable.length) return { items: [], available: 0 };

  const last = new Map<string, { at: number; grade: string }>();
  for (const a of db.all<{ cell: string; grade: string; answered_at: number }>("SELECT cell, grade, answered_at FROM practice_attempts WHERE language_code = ? AND mode = 'identify' ORDER BY answered_at", req.language)) {
    last.set(a.cell, { at: a.answered_at, grade: a.grade });
  }
  const recent = now - 14 * 86_400_000;
  const missed = (k: string) => {
    const l = last.get(k);
    return l && l.grade !== 'correct' && l.at >= recent ? 0 : 1;
  };
  // Missed lately first, then the words whose memory is due (their answers here are their reviews), then the rest.
  const urgency = practiceUrgency(db, [...new Set(usable.map((x) => x.primary.entry!.id))], now, getTimezone(db, app.config.defaultTimezone));
  const due = (x: { primary: CandidateWord }) => urgency(x.primary.entry!.id);
  const order = (a: { c: Candidate; primary: CandidateWord }, b: { c: Candidate; primary: CandidateWord }) =>
    missed(a.c.key) - missed(b.c.key) ||
    due(a)[0] - due(b)[0] ||
    due(a)[1] - due(b)[1] ||
    (last.has(a.c.key) ? 1 : 0) - (last.has(b.c.key) ? 1 : 0) ||
    (last.get(a.c.key)?.at ?? 0) - (last.get(b.c.key)?.at ?? 0) ||
    (a.primary.entry!.frequency_rank ?? 1e9) - (b.primary.entry!.frequency_rank ?? 1e9);
  const picked = pickObjects(
    tiers.map((tier) => shuffle(tier).sort(order).map((x) => ({ ...x, key: x.c.key, scene: x.c.scene.id, entry: x.primary.entry!.id }))),
    size,
    // Filling up for a session's minimum: as many pictures as there are, even when few words name them.
    { single: req.scope === 'entry', relax: fill.length > 0 },
  );
  const pool = req.choices ? [...new Set(all.map((c) => c.obj.words[req.language]![0][1]))] : [];
  const items = picked.map(({ c, primary }): IdentifyItem => {
    const e = primary.entry!;
    return {
      id: c.key,
      scene: { id: c.scene.id, w: c.scene.w, h: c.scene.h, src: sceneImages(c.scene) },
      n: c.obj.n,
      label: c.obj.label,
      point: c.obj.point,
      box: c.obj.box,
      entryId: e.id,
      lemma: e.lemma,
      display: primary.display,
      pos: e.pos,
      alsoRight: c.words.filter((w) => w !== primary).map((w) => w.display),
      answer: identifySpec(db, req.language, c, primary),
      choices: req.choices ? identifyChoices(req.language, c, primary, pool) : null,
    };
  });
  return { items: shuffle(items), available: usable.length };
}

/** The spec the server grades an Identify answer with: the object named by `cell`, asked as the given word. */
export function identifyAttemptSpec(app: App, language: LanguageCode, entryId: number, cell: string | null | undefined): AnswerSpec {
  const data = loadIdentify(app);
  const [sceneId, n] = String(cell ?? '').split(':');
  const scene = data?.scenes.find((s) => s.id === sceneId);
  const obj = scene?.objects.find((o) => o.n === Number(n));
  if (!scene || !obj) throw notFound('Picture');
  const c = identifyCandidates(app, language).find((x) => x.key === `${scene.id}:${obj.n}`);
  const primary = c ? primaryWord(c, 'entry', entryId) : null;
  if (!c || !primary) throw new HttpError(422, 'validation_failed', 'That word does not name the marked object.');
  return identifySpec(app.db, language, c, primary);
}

export interface IdentifySummary {
  scenes: number;
  objects: number;
  words: number;
  learningWords: number;
  attempts7d: number;
  correct7d: number;
}

export function identifySummary(app: App, language: LanguageCode, now: number): IdentifySummary | null {
  if (!loadIdentify(app)) return null;
  const all = identifyCandidates(app, language);
  const words = new Set<number>();
  const learning = new Set<number>();
  for (const c of all) {
    for (const w of c.words) {
      if (!w.entry) continue;
      words.add(w.entry.id);
      if (w.entry.learning) learning.add(w.entry.id);
    }
  }
  const t = app.db.get<{ n: number; ok: number }>(
    "SELECT COUNT(*) AS n, COALESCE(SUM(grade = 'correct'), 0) AS ok FROM practice_attempts WHERE language_code = ? AND mode = 'identify' AND answered_at >= ?",
    language,
    now - 7 * 86_400_000,
  )!;
  return { scenes: new Set(all.map((c) => c.scene.id)).size, objects: all.length, words: words.size, learningWords: learning.size, attempts7d: t.n, correct7d: t.ok };
}

/** How many pictured objects a word names (for the word page's practice link). */
export function identifyCountForEntry(app: App, entryId: number): number {
  const e = app.db.get<{ language_code: LanguageCode }>('SELECT language_code FROM vocabulary_entries WHERE id = ? AND deleted_at IS NULL', entryId);
  if (!e || !loadIdentify(app)) return 0;
  return identifyCandidates(app, e.language_code).filter((c) => c.words.some((w) => w.entry?.id === entryId)).length;
}
