// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
import { z } from 'zod';
import type { App } from '../app.ts';
import { HANDLED, HttpError, type Router } from '../http/http.ts';
import { LANGUAGE_CODES } from '../../shared/languages.ts';
import { commitImport, createImportJob, frequencySetReport, frequencySetStatus, importFrequencySet, importStarter, listJobs, preview, undoImport, updateFrequencySet, validateImport, MAPPING_FIELDS } from '../vocab/importer.ts';
import { lang } from './settings.ts';

const mappingSchema = z.record(z.enum(MAPPING_FIELDS as any), z.string().max(200)).default({});
const optionsSchema = z
  .object({
    duplicatePolicy: z.enum(['skip', 'merge', 'new']).optional(),
    homographPolicy: z.enum(['new', 'merge', 'skip']).optional(),
    listSeparator: z.string().max(3).optional(),
    sourceName: z.string().max(200).optional(),
    sourceLicense: z.string().max(200).optional(),
    sourceUrl: z.string().max(500).optional(),
    frequencyKind: z.enum(['frequency_spoken', 'frequency_subtitles', 'frequency_written', 'frequency_mixed']).optional(),
    setAsPreferredFrequency: z.boolean().optional(),
    limit: z.number().int().min(1).max(500_000).optional(),
    decisions: z.record(z.enum(['skip', 'merge', 'new'])).optional(),
  })
  .default({});

export function registerImportRoutes(router: Router, app: App) {
  router.post('/api/import/upload', { tx: false }, async (ctx) => {
    const language = lang(ctx.query.get('lang') ?? '');
    const kind = ctx.query.get('kind') === 'frequency' ? 'frequency' : 'vocabulary';
    const fileName = (ctx.query.get('filename') || 'upload.csv').slice(0, 200);
    const data = await ctx.readBody(app.config.maxUploadBytes);
    if (!data.length) throw new HttpError(400, 'bad_request', 'The uploaded file is empty.');
    try {
      return createImportJob(app, { language, kind, fileName, data, now: ctx.now });
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(422, 'unreadable_file', `Could not read this file: ${(err as Error).message}`);
    }
  });

  router.get('/api/import/jobs', {}, (ctx) => listJobs(app, ctx.query.get('lang') ? lang(ctx.query.get('lang')!) : undefined));

  router.get('/api/import/:id/preview', {}, (ctx) => preview(app, ctx.params.id));

  router.post('/api/import/:id/validate', { body: z.object({ mapping: mappingSchema, options: optionsSchema }), tx: false }, (ctx, body) =>
    validateImport(app, ctx.params.id, body.mapping, body.options),
  );

  router.post('/api/import/:id/commit', { body: z.object({ mapping: mappingSchema, options: optionsSchema }), tx: false }, (ctx, body) =>
    commitImport(app, ctx.params.id, body.mapping, body.options, ctx.now),
  );

  router.post('/api/import/:id/undo', { tx: false }, (ctx) => undoImport(app, ctx.params.id, ctx.now));

  router.post('/api/import/starter', { body: z.object({ language: z.enum(LANGUAGE_CODES as any) }), tx: false }, (ctx, body) => importStarter(app, body.language, ctx.now));

  // The bundled "most frequent words" sets (data/frequency, built by scripts/freq/build.mjs).
  router.get('/api/import/frequency-sets', {}, () => Object.fromEntries(LANGUAGE_CODES.map((code) => [code, frequencySetStatus(app, code)])));

  router.post('/api/import/frequency-set', { body: z.object({ language: z.enum(LANGUAGE_CODES as any) }), tx: false }, (ctx, body) => importFrequencySet(app, body.language, ctx.now));

  // Update a loaded set to the bundled version (backup first; words you edited are kept as they are).
  router.post('/api/import/frequency-set/update', { body: z.object({ language: z.enum(LANGUAGE_CODES as any) }), tx: false }, async (ctx, body) => await updateFrequencySet(app, body.language, ctx.now));

  router.get('/api/import/frequency-sets/:lang/report', {}, (ctx) => {
    const text = frequencySetReport(app, lang(ctx.params.lang));
    // Markdown served as plain text: every browser shows text/plain in the tab, while some download text/markdown.
    ctx.res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    ctx.res.end(text);
    return HANDLED;
  });
}
