// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
import { z } from 'zod';
import type { App } from '../app.ts';
import { legalInfo, termsStatus } from '../services/legal.ts';
import { HttpError, type Router } from '../http/http.ts';
import { isLanguageCode, LANGUAGE_CODES, LANGUAGES, type LanguageCode } from '../../shared/languages.ts';
import {
  getAllLanguageSettings,
  getGlobalSettings,
  getLanguageSettings,
  getTimezone,
  globalSettingsSchema,
  languageSettingsSchema,
  changedAt,
  updateGlobalSettings,
  updateLanguageSettings,
} from '../services/settings.ts';
import { languageStats, overview } from '../services/stats.ts';
import { listActiveSessions } from '../learning/sessions.ts';
import { rescheduleLanguage } from '../learning/scheduling.ts';
import { fitMemoryModel, memoryModelStatus, resetMemoryModel } from '../learning/memory-model.ts';
import { schemaVersion } from '../db/migrate.ts';
import type { Bootstrap } from '../../shared/types.ts';
import { frequencySetStatus } from '../vocab/importer.ts';

export function lang(code: string): LanguageCode {
  if (!isLanguageCode(code)) throw new HttpError(404, 'unknown_language', `Unknown language: ${code}`);
  return code;
}

export function registerSettingsRoutes(router: Router, app: App) {
  const db = app.db;
  const tz = () => getTimezone(db, app.config.defaultTimezone);

  router.get('/api/bootstrap', {}, (ctx): Bootstrap => {
    const now = ctx.now;
    const active = listActiveSessions(app);
    return {
      user: { username: ctx.auth!.username },
      settings: getGlobalSettings(db, app.config.defaultTimezone),
      languageSettings: getAllLanguageSettings(db),
      languages: LANGUAGE_CODES.map((code) => ({
        code,
        name: LANGUAGES[code].name,
        nativeName: LANGUAGES[code].nativeName,
        flag: LANGUAGES[code].flag,
        variety: LANGUAGES[code].variety,
        stats: languageStats(db, code, now, tz()),
        activeSession: active.find((s) => s.language === code && s.status !== 'prepared') ?? null,
        frequencySet: frequencySetStatus(app, code),
      })),
      forvo: { configured: app.forvo.configured, quotaRemaining: app.forvo.configured ? app.forvo.usage(now).remaining : null },
      overview: overview(db, now, tz()),
      serverTime: now,
      version: app.config.version,
      revision: db.revision(),
      legal: legalInfo(app.config),
      terms: termsStatus(db, ctx.auth!.userId),
    };
  });

  router.get('/api/sync/state', {}, () => ({ revision: db.revision(), serverTime: Date.now() }));

  router.get('/api/settings', {}, () => ({ settings: getGlobalSettings(db, app.config.defaultTimezone), languageSettings: getAllLanguageSettings(db) }));

  router.put('/api/settings', { body: globalSettingsSchema }, (ctx, body) => ({ settings: updateGlobalSettings(db, body, changedAt(ctx.query.get('changedAt'), ctx.now), ctx.deviceId) }));

  router.put('/api/languages/:code/settings', { body: z.record(z.unknown()) }, (ctx, body) => {
    const code = lang(ctx.params.code);
    const parsed = languageSettingsSchema(code).safeParse(body);
    if (!parsed.success) throw new HttpError(422, 'validation_failed', 'Some settings are invalid', parsed.error.flatten());
    const before = getLanguageSettings(db, code);
    const settings = updateLanguageSettings(db, code, parsed.data, changedAt(ctx.query.get('changedAt'), ctx.now), ctx.deviceId);
    let rescheduled = 0;
    // A new retention target changes future intervals: recompute schedules from full review history.
    if (settings.desiredRetention !== before.desiredRetention) rescheduled = rescheduleLanguage(db, code);
    return { settings, rescheduled };
  });

  // The learner's own memory model (2.0.0): its state, a fit to their reviews (used only when it predicts their latest
  // reviews better), and the way back to the standard model. The fit takes a moment and runs outside a transaction.
  router.get('/api/languages/:code/memory-model', {}, (ctx) => memoryModelStatus(app, lang(ctx.params.code)));
  router.post('/api/languages/:code/memory-model/fit', { tx: false }, (ctx) => fitMemoryModel(app, lang(ctx.params.code), ctx.now, ctx.deviceId));
  router.post('/api/languages/:code/memory-model/reset', {}, (ctx) => resetMemoryModel(app, lang(ctx.params.code), ctx.now, ctx.deviceId));

  router.get('/api/system', {}, () => ({
    version: app.config.version,
    schemaVersion: schemaVersion(db),
    environment: app.config.env,
    timezone: tz(),
    forvo: { configured: app.forvo.configured, usage: app.forvo.usage() },
    backups: {
      enabled: app.config.backup.enabled,
      time: app.config.backup.time,
      encrypted: !!app.config.backup.passphrase,
      offsiteDir: !!app.config.offsiteBackupDir,
      last: app.backups.lastBackup(),
      count: app.backups.list().length,
    },
    devices: db.all<any>('SELECT id, user_agent, first_seen_at, last_seen_at FROM devices ORDER BY last_seen_at DESC LIMIT 20'),
  }));
}
