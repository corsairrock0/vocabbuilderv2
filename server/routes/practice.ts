// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
import { z } from 'zod';
import type { App } from '../app.ts';
import type { Router } from '../http/http.ts';
import { LANGUAGE_CODES, type LanguageCode } from '../../shared/languages.ts';
import { clozeBatch, formsBatch, practiceSummary, submitPracticeAttempt } from '../learning/practice.ts';
import { identifyBatch } from '../learning/identify.ts';
import { lang } from './settings.ts';
import { learnNext, readingBatch, readingSummary, submitReadingAttempt } from '../learning/reading.ts';
import { comprehensionSummary, nextPassage, submitComprehension } from '../learning/comprehension.ts';
import { acceptWriting, nextSentence, submitWriting, writingSummary } from '../learning/writing.ts';
import { READING_LEVELS } from '../../shared/comprehension.ts';

const language = z.enum(LANGUAGE_CODES as [LanguageCode, ...LanguageCode[]]);
const scope = z.enum(['learning', 'all', 'entry', 'entries']);
const entryIds = z.array(z.number().int().positive()).max(200).nullable().optional();
const ids = z.array(z.string().max(40)).max(40).nullable().optional();
// Active time on a Practice page since the previous answer; the server caps it (shared/activity.ts). Rounds inside a
// study session send none: the session counts their time.
const activeMs = z.number().int().min(0).max(3_600_000).nullable().optional();

const formsSchema = z.object({ language, scope, entryId: z.number().int().positive().nullable().optional(), entryIds, tenses: ids, persons: ids, size: z.number().int().min(1).max(50).optional() });
const clozeSchema = z.object({ language, scope, entryId: z.number().int().positive().nullable().optional(), entryIds, choices: z.boolean().optional(), size: z.number().int().min(1).max(50).optional() });
// fill: with scope 'entries' (a Comprehensive session's words), the scopes to fill up from, in order, when those words
// name too few pictures (the session's Identify minimum).
const identifySchema = clozeSchema.extend({ fill: z.array(z.enum(['learning', 'all'])).max(2).nullable().optional() });
const attemptSchema = z.object({
  opId: z.string().min(8).max(100),
  mode: z.enum(['forms', 'cloze', 'identify']),
  entryId: z.number().int().positive(),
  cell: z.string().max(40).nullable().optional(),
  sentenceId: z.number().int().positive().nullable().optional(),
  response: z.string().max(500).nullable().optional(),
  revealed: z.boolean().optional(),
  choice: z.boolean().optional(),
  answeredAt: z.number().int().min(0),
  deviceId: z.string().max(64).nullable().optional(),
  activeMs,
  hintsUsed: z.number().int().min(0).max(10).nullable().optional(),
  sessionId: z.string().max(100).nullable().optional(),
});

const readMode = z.enum(['read', 'say']);
const readBatchSchema = z.object({ language, mode: readMode, size: z.number().int().min(1).max(30).optional(), entryIds });
const readAttemptSchema = z.object({
  opId: z.string().min(8).max(100),
  mode: readMode,
  sentenceId: z.number().int().positive(),
  grade: z.enum(['understood', 'partly', 'not', 'correct', 'close', 'incorrect', 'revealed']),
  response: z.string().max(1000).nullable().optional(),
  answeredAt: z.number().int().min(0),
  deviceId: z.string().max(64).nullable().optional(),
  activeMs,
});

const passageId = z.string().min(1).max(60);
const comprehensionNextSchema = z.object({
  language,
  kind: z.enum(['long', 'short']).nullable().optional(),
  level: z.enum(READING_LEVELS).nullable().optional(),
  exclude: z.array(passageId).max(50).nullable().optional(),
});
const comprehensionAttemptSchema = z.object({
  opId: z.string().min(8).max(100),
  language,
  passageId,
  // Per question, in stored order: the chosen option's stored index, or -1 for none.
  answers: z.array(z.number().int().min(-1).max(9)).min(1).max(10),
  answeredAt: z.number().int().min(0),
  deviceId: z.string().max(64).nullable().optional(),
  activeMs,
});

const sentenceId = z.string().min(1).max(60);
const writingNextSchema = z.object({
  language,
  level: z.enum(READING_LEVELS).nullable().optional(),
  exclude: z.array(sentenceId).max(50).nullable().optional(),
  entryIds: z.array(z.number().int().positive()).max(200).nullable().optional(),
});
const writingAttemptSchema = z.object({
  opId: z.string().min(8).max(100),
  language,
  sentenceId,
  response: z.string().max(1000),
  answeredAt: z.number().int().min(0),
  deviceId: z.string().max(64).nullable().optional(),
  activeMs,
});
const writingAcceptSchema = z.object({ opId: z.string().min(8).max(100), language, deviceId: z.string().max(64).nullable().optional() });

export function registerPracticeRoutes(router: Router, app: App) {
  // Writing: English sentences to translate, every word right, at the learner's writing level (server/learning/writing.ts).
  router.get('/api/practice/writing/summary/:code', {}, (ctx) => writingSummary(app, lang(ctx.params.code)));
  router.post('/api/practice/writing/next', { body: writingNextSchema }, (ctx, body) => nextSentence(app, body, ctx.now));
  router.post('/api/practice/writing/attempts', { body: writingAttemptSchema }, (ctx, body) => submitWriting(app, { ...body, deviceId: body.deviceId ?? ctx.deviceId ?? null }, ctx.now));
  router.post('/api/practice/writing/accept', { body: writingAcceptSchema }, (ctx, body) => acceptWriting(app, { ...body, deviceId: body.deviceId ?? ctx.deviceId ?? null }, ctx.now));
  // Reading comprehension: long and short (everyday) passages at the learner's level (server/learning/comprehension.ts).
  router.get('/api/practice/comprehension/summary/:code', {}, (ctx) => comprehensionSummary(app, lang(ctx.params.code)));
  router.post('/api/practice/comprehension/next', { body: comprehensionNextSchema }, (_ctx, body) => nextPassage(app, body));
  router.post('/api/practice/comprehension/attempts', { body: comprehensionAttemptSchema }, (ctx, body) => submitComprehension(app, { ...body, deviceId: body.deviceId ?? ctx.deviceId ?? null }, ctx.now));
  // Read and say: sentences built from the words the learner knows (server/learning/reading.ts).
  router.post('/api/practice/read/batch', { body: readBatchSchema }, (ctx, body) => readingBatch(app, body, ctx.now));
  router.get('/api/practice/read/summary/:code', {}, (ctx) => readingSummary(app, lang(ctx.params.code)));
  router.post('/api/practice/read/attempts', { body: readAttemptSchema }, (ctx, body) => submitReadingAttempt(app, { ...body, deviceId: body.deviceId ?? ctx.deviceId ?? null }, ctx.now));
  router.post('/api/practice/read/learn-next', { body: z.object({ entryId: z.number().int().positive() }) }, (ctx, body) => learnNext(app, body.entryId, ctx.now));
  router.post('/api/practice/forms/batch', { body: formsSchema }, (ctx, body) => formsBatch(app, body, ctx.now));
  router.post('/api/practice/cloze/batch', { body: clozeSchema }, (ctx, body) => clozeBatch(app, body, ctx.now));
  router.post('/api/practice/identify/batch', { body: identifySchema }, (ctx, body) => identifyBatch(app, body, ctx.now));
  router.post('/api/practice/attempts', { body: attemptSchema }, (ctx, body) => submitPracticeAttempt(app, { ...body, deviceId: body.deviceId ?? ctx.deviceId ?? null }, ctx.now));
  router.get('/api/practice/summary/:code', {}, (ctx) => practiceSummary(app, lang(ctx.params.code), ctx.now));
}
