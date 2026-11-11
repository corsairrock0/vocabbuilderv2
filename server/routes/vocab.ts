// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
import { z } from 'zod';
import type { App } from '../app.ts';
import { HANDLED, HttpError, type Router } from '../http/http.ts';
import { getTimezone } from '../services/settings.ts';
import { endOfLocalDay } from '../../shared/time.ts';
import { createEntry, exportVocabularyV1, listVocabulary, setItemFlags, softDeleteEntry, updateEntry, vocabCounts, vocabDetail } from '../vocab/repo.ts';
import { lang } from './settings.ts';
import { identifyCountForEntry } from '../learning/identify.ts';
import { changedAt } from '../services/settings.ts';
import { LANGUAGE_CODES, PARTS_OF_SPEECH } from '../../shared/languages.ts';

const entrySchema = z.object({
  lemma: z.string().trim().min(1).max(200),
  display: z.string().max(200).nullable().optional(),
  pos: z.string().max(40).nullable().optional(),
  gender: z.string().max(20).nullable().optional(),
  aspect: z.string().max(30).nullable().optional(),
  aspectPair: z.string().max(200).nullable().optional(),
  pronunciation: z.string().max(300).nullable().optional(),
  register: z.string().max(40).nullable().optional(),
  regionalNote: z.string().max(500).nullable().optional(),
  grammarNotes: z.string().max(2000).nullable().optional(),
  imageUrl: z.string().url().max(1000).nullable().optional(),
  senses: z
    .array(z.object({ gloss: z.string().trim().min(1).max(300), translations: z.array(z.string().max(300)).max(30).optional(), definition: z.string().max(1000).nullable().optional(), note: z.string().max(500).nullable().optional() }))
    .min(1)
    .max(20),
  forms: z.array(z.object({ form: z.string().max(200), display: z.string().max(200).nullable().optional(), tags: z.array(z.string().max(40)).max(10).optional() })).max(100).optional(),
  examples: z
    .array(
      z.object({
        text: z.string().max(1000),
        display: z.string().max(1000).nullable().optional(),
        translation: z.string().max(1000).nullable().optional(),
        target: z.string().max(200).nullable().optional(),
        // The meaning (index into senses) the sentence shows; omitted keeps the sentence's current meaning.
        sense: z.number().int().min(0).max(19).nullable().optional(),
      }),
    )
    .max(20)
    .optional(),
  expressions: z.array(z.object({ text: z.string().max(300), translation: z.string().max(300).nullable().optional(), kind: z.string().max(20).optional() })).max(30).optional(),
  tags: z.array(z.string().max(60)).max(20).optional(),
});

export function registerVocabRoutes(router: Router, app: App) {
  const db = app.db;
  const tz = () => getTimezone(db, app.config.defaultTimezone);

  router.get('/api/vocab', {}, (ctx) => {
    const q = ctx.query;
    const num = (k: string) => (q.get(k) ? Number(q.get(k)) : undefined);
    return listVocabulary(
      db,
      {
        language: lang(q.get('lang') ?? ''),
        q: q.get('q') ?? undefined,
        pos: q.get('pos') || undefined,
        tag: q.get('tag') || undefined,
        status: q.get('status') || undefined,
        due: q.get('due') === '1',
        difficult: q.get('difficult') === '1',
        favorite: q.get('favorite') === '1',
        freqMin: num('freqMin'),
        freqMax: num('freqMax'),
        sort: (q.get('sort') as any) || undefined,
        offset: num('offset'),
        limit: num('limit'),
      },
      ctx.now,
      endOfLocalDay(ctx.now, tz()),
    );
  });

  router.get('/api/vocab/meta', {}, (ctx) => {
    const code = lang(ctx.query.get('lang') ?? '');
    return {
      tags: db.all<{ name: string; n: number }>(
        `SELECT t.name, COUNT(*) AS n FROM entry_tags et JOIN tags t ON t.id = et.tag_id JOIN vocabulary_entries e ON e.id = et.entry_id
          WHERE e.language_code = ? AND e.deleted_at IS NULL GROUP BY t.name ORDER BY t.name`,
        code,
      ),
      pos: db.all<{ pos: string; n: number }>('SELECT pos, COUNT(*) AS n FROM vocabulary_entries WHERE language_code = ? AND deleted_at IS NULL GROUP BY pos ORDER BY n DESC', code),
      allPos: PARTS_OF_SPEECH,
      sources: db.all<any>('SELECT id, name, kind, license FROM sources WHERE language_code = ? ORDER BY created_at', code),
      counts: vocabCounts(db, code, endOfLocalDay(ctx.now, tz())),
    };
  });

  // A word's detail with identifyCount, how many pictured things it names (Identify practice), for the word page.
  const detail = (id: number, now: number) => ({ ...vocabDetail(db, id, now), identifyCount: identifyCountForEntry(app, id) });

  router.get('/api/vocab/:id', {}, (ctx) => detail(Number(ctx.params.id), ctx.now));

  router.post('/api/vocab', { body: entrySchema.extend({ language: z.enum(LANGUAGE_CODES as any) }) }, (ctx, body) => {
    const id = createEntry(db, body.language, body, ctx.now, { custom: true });
    return { entryId: id };
  });

  router.put('/api/vocab/:id', { body: entrySchema.extend({ baseVersion: z.number().int().nullable().optional() }) }, (ctx, body) => {
    updateEntry(db, Number(ctx.params.id), body, body.baseVersion ?? null, ctx.now);
    return detail(Number(ctx.params.id), ctx.now);
  });

  router.delete('/api/vocab/:id', {}, (ctx) => {
    softDeleteEntry(db, Number(ctx.params.id), ctx.now);
    return { ok: true };
  });

  router.post(
    '/api/vocab/:id/flags',
    { body: z.object({ favorite: z.boolean().optional(), difficult: z.boolean().optional(), status: z.enum(['known', 'suspended', 'restore']).optional() }) },
    (ctx, body) => {
      setItemFlags(db, Number(ctx.params.id), body, ctx.now);
      return detail(Number(ctx.params.id), ctx.now);
    },
  );

  router.put('/api/vocab/:id/note', { body: z.object({ note: z.string().max(5000).nullable(), mnemonic: z.string().max(2000).nullable().optional() }) }, (ctx, body) => {
    const id = Number(ctx.params.id);
    if (!db.get('SELECT 1 FROM vocabulary_entries WHERE id = ? AND deleted_at IS NULL', id)) throw new HttpError(404, 'not_found', 'Word not found');
    // Last writer wins by when the note was edited on the device; a mnemonic sent as null is cleared, an absent one kept.
    db.run(
      `INSERT INTO entry_user_data (entry_id, note, mnemonic, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(entry_id) DO UPDATE SET note = excluded.note,
         mnemonic = CASE WHEN ? THEN excluded.mnemonic ELSE entry_user_data.mnemonic END, updated_at = excluded.updated_at
       WHERE excluded.updated_at >= entry_user_data.updated_at`,
      id,
      body.note,
      body.mnemonic ?? null,
      changedAt(ctx.query.get('changedAt'), ctx.now),
      body.mnemonic !== undefined ? 1 : 0,
    );
    return { ok: true };
  });

  // Exports (CSV or JSON). Streams a download.
  router.get('/api/export/vocabulary', {}, (ctx) => {
    const code = lang(ctx.query.get('lang') ?? '');
    const format = ctx.query.get('format') === 'csv' ? 'csv' : 'json';
    const rows = db.all<any>(
      `SELECT e.id, e.lemma, e.display, e.pos, e.gender, e.aspect, e.pronunciation, e.frequency_rank, e.curated_order, e.regional_note,
              (SELECT group_concat(s.gloss, ' | ') FROM vocabulary_senses s WHERE s.entry_id = e.id) AS glosses,
              (SELECT group_concat(t.name, ',') FROM entry_tags et JOIN tags t ON t.id = et.tag_id WHERE et.entry_id = e.id) AS tags,
              li.status, li.is_favorite, u.note
         FROM vocabulary_entries e LEFT JOIN learning_items li ON li.entry_id = e.id LEFT JOIN entry_user_data u ON u.entry_id = e.id
        WHERE e.language_code = ? AND e.deleted_at IS NULL ORDER BY COALESCE(e.frequency_rank, e.curated_order, 1e9), e.id`,
      code,
    );
    const filename = `vocabbuilder-${code}-vocabulary-${new Date(ctx.now).toISOString().slice(0, 10)}.${format}`;
    let body: string;
    if (format === 'csv') {
      const cols = ['lemma', 'display', 'pos', 'glosses', 'gender', 'aspect', 'pronunciation', 'frequency_rank', 'curated_order', 'tags', 'regional_note', 'status', 'is_favorite', 'note'];
      const esc = (v: unknown) => {
        const s = v == null ? '' : String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      body = '﻿' + [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
    } else {
      body = JSON.stringify(exportVocabularyV1(db, code, ctx.now), null, 2);
    }
    ctx.res.writeHead(200, {
      'Content-Type': format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    });
    ctx.res.end(body);
    return HANDLED;
  });

  // Full learning-progress export (portable JSON).
  router.get('/api/export/progress', {}, (ctx) => {
    const tables = ['learning_items', 'fsrs_cards', 'review_logs', 'exercise_attempts', 'skill_evidence', 'study_sessions', 'daily_stats', 'user_settings', 'language_settings', 'entry_user_data', 'speaker_profiles', 'pronunciation_preferences', 'comprehension_attempts', 'writing_attempts', 'writing_accepted'];
    const data: Record<string, unknown[]> = {};
    for (const t of tables) data[t] = db.all(`SELECT * FROM ${t}`).map((r: any) => (t === 'study_sessions' ? { ...r, resources: undefined } : r));
    data.vocabulary_entries = db.all('SELECT id, language_code, lemma, display, pos, homograph FROM vocabulary_entries');
    ctx.res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="vocabbuilder-progress-${new Date(ctx.now).toISOString().slice(0, 10)}.json"`,
      'Cache-Control': 'no-store',
    });
    ctx.res.end(JSON.stringify({ format: 'vocabbuilder-progress-v1', exportedAt: new Date(ctx.now).toISOString(), timezone: tz(), data }));
    return HANDLED;
  });
}
