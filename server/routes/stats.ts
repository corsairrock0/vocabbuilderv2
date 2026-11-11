// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
import type { App } from '../app.ts';
import type { Router } from '../http/http.ts';
import { getTimezone } from '../services/settings.ts';
import { allLanguageStats, detailedStats, overview, retentionTradeoff } from '../services/stats.ts';
import { skillStats } from '../services/skills.ts';
import { progressOverview, progressPeriod } from '../services/progress.ts';
import { statsWindow } from '../../shared/stats.ts';
import { sessionHistory } from '../learning/sessions.ts';
import { lang } from './settings.ts';

export function registerStatsRoutes(router: Router, app: App) {
  const db = app.db;
  const tz = () => getTimezone(db, app.config.defaultTimezone);

  router.get('/api/stats/overview', {}, (ctx) => ({ overview: overview(db, ctx.now, tz()), languages: allLanguageStats(db, ctx.now, tz()) }));

  router.get('/api/stats/language/:code', {}, (ctx) =>
    detailedStats(db, lang(ctx.params.code), ctx.now, tz(), Math.max(1, Math.min(Math.round(Number(ctx.query.get('days') ?? 90)) || 90, 365))),
  );

  // The Skills section: ?window=7, 30 (the default) or all (shared/stats.ts).
  router.get('/api/stats/skills/:code', {}, (ctx) => skillStats(app, lang(ctx.params.code), statsWindow(ctx.query.get('window')), ctx.now, tz()));

  // The Progress page (server/services/progress.ts): what does not depend on the period (words, coming up, words that
  // need work), and a period's skills and study time (?window=7, 30 or all).
  router.get('/api/stats/progress/:code', {}, (ctx) => progressOverview(app, lang(ctx.params.code), ctx.now, tz()));
  router.get('/api/stats/progress/:code/period', {}, (ctx) => progressPeriod(app, lang(ctx.params.code), statsWindow(ctx.query.get('window')), ctx.now, tz()));

  router.get('/api/stats/retention/:code', {}, (ctx) => retentionTradeoff(db, lang(ctx.params.code)));

  router.get('/api/stats/sessions', {}, (ctx) => sessionHistory(app, ctx.query.get('lang') ? lang(ctx.query.get('lang')!) : null, Math.min(Number(ctx.query.get('limit') ?? 30), 200)));
}
