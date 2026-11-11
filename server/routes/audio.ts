// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { App } from '../app.ts';
import { HANDLED, HttpError, notFound, pipeFile, type Router } from '../http/http.ts';
import { LANGUAGE_CODES, type LanguageCode } from '../../shared/languages.ts';
import { deleteUserRecording, lookupAudio, saveUserRecording } from '../audio/service.ts';
import { lang } from './settings.ts';

export function registerAudioRoutes(router: Router, app: App) {
  const db = app.db;

  router.get('/api/audio/usage', {}, () => ({ configured: app.forvo.configured, ...app.forvo.usage() }));

  router.post('/api/audio/usage', { body: z.object({ plays: z.number().int().min(0).max(100) }) }, (ctx, body) => {
    app.forvo.recordPlays(body.plays, ctx.now);
    return { ok: true, usage: app.forvo.usage(ctx.now) };
  });

  router.get('/api/audio/speakers', {}, (ctx) =>
    db.all('SELECT language_code AS language, provider, speaker, preference, accent_note AS accentNote, verified_by_user AS verifiedByUser, updated_at AS updatedAt FROM speaker_profiles WHERE language_code = ? ORDER BY speaker', lang(ctx.query.get('lang') ?? '')),
  );

  router.put(
    '/api/audio/speakers',
    {
      body: z.object({
        language: z.enum(LANGUAGE_CODES as [LanguageCode, ...LanguageCode[]]),
        speaker: z.string().min(1).max(100),
        preference: z.enum(['preferred', 'neutral', 'avoid']),
        accentNote: z.string().max(120).nullable().optional(),
        verifiedByUser: z.boolean().optional(),
      }),
    },
    (ctx, body) => {
      db.run(
        `INSERT INTO speaker_profiles (language_code, provider, speaker, preference, accent_note, verified_by_user, updated_at) VALUES (?, 'forvo', ?, ?, ?, ?, ?)
         ON CONFLICT(language_code, provider, speaker) DO UPDATE SET preference = excluded.preference, accent_note = excluded.accent_note,
           verified_by_user = excluded.verified_by_user, updated_at = excluded.updated_at`,
        body.language,
        body.speaker,
        body.preference,
        body.accentNote ?? null,
        body.verifiedByUser ? 1 : 0,
        ctx.now,
      );
      return { ok: true };
    },
  );

  router.get('/api/audio/file/:id', {}, (ctx) => {
    const r = db.get<{ file_name: string; mime_type: string }>("SELECT file_name, mime_type FROM pronunciation_records WHERE id = ? AND provider IN ('user', 'licensed')", Number(ctx.params.id));
    if (!r?.file_name) throw notFound('Recording');
    const file = path.join(app.config.dataDir, 'audio', path.basename(r.file_name));
    if (!existsSync(file)) throw notFound('Recording file');
    const size = statSync(file).size;
    const base = { 'Content-Type': r.mime_type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=86400' };
    // Safari only plays media from servers that honour byte ranges.
    const range = /^bytes=(\d*)-(\d*)$/.exec(String(ctx.req.headers.range ?? '').trim());
    if (range && (range[1] || range[2])) {
      const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      if (start >= size || start > end) {
        ctx.res.writeHead(416, { ...base, 'Content-Range': `bytes */${size}` }).end();
        return HANDLED;
      }
      ctx.res.writeHead(206, { ...base, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) });
      pipeFile(createReadStream(file, { start, end }), ctx.res);
      return HANDLED;
    }
    ctx.res.writeHead(200, { ...base, 'Content-Length': String(size) });
    pipeFile(createReadStream(file), ctx.res);
    return HANDLED;
  });

  router.delete('/api/audio/file/:id', {}, (ctx) => {
    deleteUserRecording(app, Number(ctx.params.id));
    return { ok: true };
  });

  router.get('/api/audio/:entryId', {}, (ctx) => lookupAudio(app, Number(ctx.params.entryId), { refresh: ctx.query.get('refresh') === '1', now: ctx.now }));

  router.post('/api/audio/:entryId/preferred', { body: z.object({ sourceId: z.string().max(120).nullable() }) }, (ctx, body) => {
    const entryId = Number(ctx.params.entryId);
    if (!db.get('SELECT 1 FROM vocabulary_entries WHERE id = ?', entryId)) throw notFound('Word');
    let recordId: number | null = null;
    if (body.sourceId) {
      const [kind, ref] = body.sourceId.split(':');
      const row =
        kind === 'forvo'
          ? db.get<{ id: number }>("SELECT id FROM pronunciation_records WHERE provider = 'forvo' AND provider_ref = ? AND entry_id = ?", ref, entryId)
          : db.get<{ id: number }>('SELECT id FROM pronunciation_records WHERE id = ? AND entry_id = ?', Number(ref), entryId);
      if (!row) throw new HttpError(404, 'not_found', 'Recording not found for this word');
      recordId = row.id;
    }
    db.run(
      'INSERT INTO pronunciation_preferences (entry_id, record_id, updated_at) VALUES (?, ?, ?) ON CONFLICT(entry_id) DO UPDATE SET record_id = excluded.record_id, updated_at = excluded.updated_at',
      entryId,
      recordId,
      ctx.now,
    );
    return { ok: true };
  });

  router.post('/api/audio/:entryId/recordings', { tx: false }, async (ctx) => {
    const data = await ctx.readBody(3 * 1024 * 1024);
    const id = saveUserRecording(app, Number(ctx.params.entryId), String(ctx.req.headers['content-type'] ?? ''), data, ctx.now);
    return { recordId: id };
  });
}
