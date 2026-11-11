// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
import { createReadStream, statSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { App } from '../app.ts';
import { HANDLED, HttpError, pipeFile, type Router } from '../http/http.ts';
import { errorFields, log } from '../log.ts';

function backupError(err: unknown): never {
  if (err instanceof HttpError) throw err;
  const msg = err instanceof Error ? err.message : String(err);
  if (/not found/i.test(msg)) throw new HttpError(404, 'not_found', msg);
  if (/Invalid backup file name|are named vocabbuilder-/.test(msg)) throw new HttpError(400, 'bad_request', msg);
  if (/already on the server/.test(msg)) throw new HttpError(409, 'conflict', msg);
  throw new HttpError(422, 'backup_error', msg);
}

export function registerBackupRoutes(router: Router, app: App) {
  router.get('/api/backups', {}, () => ({
    backups: app.backups.list(),
    settings: {
      enabled: app.config.backup.enabled,
      time: app.config.backup.time,
      keepDaily: app.config.backup.keepDaily,
      keepWeekly: app.config.backup.keepWeekly,
      keepMonthly: app.config.backup.keepMonthly,
      encrypted: !!app.config.backup.passphrase,
      offsite: !!app.config.offsiteBackupDir,
    },
  }));

  router.post('/api/backups', { tx: false, body: z.object({ note: z.string().max(200).nullable().optional() }) }, async (_ctx, body) => {
    try {
      return await app.backups.create('manual', body.note ?? null);
    } catch (err) {
      backupError(err);
    }
  });

  router.get('/api/backups/:file/download', {}, (ctx) => {
    let full: string;
    try {
      full = app.backups.resolve(ctx.params.file);
    } catch (err) {
      backupError(err);
    }
    ctx.res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(statSync(full!).size),
      'Content-Disposition': `attachment; filename="${path.basename(full!)}"`,
      'Cache-Control': 'no-store',
    });
    pipeFile(createReadStream(full!), ctx.res);
    return HANDLED;
  });

  router.post('/api/backups/:file/verify', { tx: false }, (ctx) => {
    try {
      return app.backups.verify(ctx.params.file);
    } catch (err) {
      backupError(err);
    }
  });

  router.post('/api/backups/:file/test-restore', { tx: false }, (ctx) => {
    try {
      return app.backups.testRestore(ctx.params.file);
    } catch (err) {
      backupError(err);
    }
  });

  router.delete('/api/backups/:file', { tx: false }, (ctx) => {
    try {
      app.backups.delete(ctx.params.file);
      return { ok: true };
    } catch (err) {
      backupError(err);
    }
  });

  /** Upload a backup file (e.g. from another server) so it can be restored. */
  router.post('/api/backups/upload', { tx: false }, async (ctx) => {
    const name = path.basename(ctx.query.get('filename') ?? '');
    const data = await ctx.readBody(1024 * 1024 * 1024);
    try {
      const info = app.backups.importUploaded(name, data, ctx.now);
      return { file: info.file, counts: info.counts, schemaVersion: info.schemaVersion };
    } catch (err) {
      backupError(err);
    }
  });

  router.post('/api/backups/:file/restore', { tx: false, body: z.object({ confirm: z.literal('RESTORE') }) }, async (ctx) => {
    if (app.maintenance.active) throw new HttpError(409, 'busy', 'Another maintenance task is running.');
    app.maintenance = { active: true, reason: 'Restoring a backup — please wait a moment.' };
    try {
      const result = await app.backups.restore(ctx.params.file, app.db);
      return { ...result, signInAgain: true };
    } catch (err) {
      log.error('restore failed', errorFields(err));
      backupError(err);
    } finally {
      app.maintenance = { active: false, reason: null };
    }
  });
}
