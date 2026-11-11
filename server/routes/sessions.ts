// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
import { z } from 'zod';
import { KINDS, type ExerciseKind } from '../../shared/exercises.ts';
import type { App } from '../app.ts';
import { HttpError, type Router } from '../http/http.ts';
import { LANGUAGE_CODES, type LanguageCode } from '../../shared/languages.ts';
import { STUDY_MODES } from '../../shared/settings.ts';
import { ROUND_MAX_ANSWERS, ROUND_SKILLS } from '../../shared/activity.ts';
import { completeSession, createSession, getSession, listActiveSessions, normalizeConfig, previewSession, sessionEvent, sessionHistory, submitAttempt } from '../learning/sessions.ts';
import { lang } from './settings.ts';

const createSchema = z.object({
  id: z.string().uuid(),
  language: z.enum(LANGUAGE_CODES as [LanguageCode, ...LanguageCode[]]),
  minutes: z.number().int().min(3).max(180).optional(),
  newWords: z.number().int().min(0).max(100).optional(),
  difficulty: z.enum(['easy', 'normal', 'challenging']).optional(),
  focus: z.enum(['balanced', 'listening', 'speaking', 'reading', 'writing']).optional(),
  // Without a mode the session is Comprehensive (DEFAULT_STUDY_MODE).
  mode: z.enum(STUDY_MODES).optional(),
  frequencyMin: z.number().int().min(1).nullable().optional(),
  frequencyMax: z.number().int().min(1).nullable().optional(),
  tag: z.string().max(60).nullable().optional(),
  quick: z.boolean().optional(),
  prepared: z.boolean().optional(),
  replaceActive: z.boolean().optional(),
});

const rating = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);
const attemptSchema = z.object({
  opId: z.string().min(8).max(100),
  exerciseId: z.string().min(1).max(200),
  response: z.string().max(2000).nullable().optional(),
  choiceId: z.string().max(10).nullable().optional(),
  hintsUsed: z.number().int().min(0).max(10).optional(),
  revealed: z.boolean().optional(),
  latencyMs: z.number().int().min(0).max(3_600_000).nullable().optional(),
  answeredAt: z.number().int().min(0),
  selfRating: rating.nullable().optional(),
  override: z.boolean().optional(),
  ratingOverride: rating.nullable().optional(),
  markKnown: z.boolean().optional(),
  kind: z.enum(Object.keys(KINDS) as [ExerciseKind, ...ExerciseKind[]]).optional(),
  activeMsDelta: z.number().int().min(0).max(3_600_000).optional(),
  deviceId: z.string().max(64).optional(),
  offline: z.boolean().optional(),
});

const eventSchema = z
  .object({
    type: z.enum(['pause', 'resume', 'heartbeat', 'skip', 'wrap_up', 'start', 'round']),
    exerciseId: z.string().max(200).optional(),
    activeMsDelta: z.number().int().min(0).max(3_600_000).optional(),
    at: z.number().int().optional(),
    // round: every answer so far of one practice round of a Comprehensive session (shared/activity.ts, RoundEvent).
    roundId: z.string().regex(/^[A-Za-z0-9-]{1,64}$/).optional(),
    skill: z.enum(ROUND_SKILLS).optional(),
    grades: z.array(z.string().min(1).max(20)).max(ROUND_MAX_ANSWERS).optional(),
    from: z.number().int().min(0).max(ROUND_MAX_ANSWERS).optional(),
    end: z.boolean().optional(),
  })
  .refine((e) => e.type !== 'round' || (e.roundId != null && e.skill != null && e.grades != null && (e.grades.length > 0 || e.end === true)), {
    message: 'A round event needs roundId, skill and grades (none only when it ends the round).',
    path: ['type'],
  });

const rankOrNone = z.preprocess((v) => (v === '' ? null : v), z.coerce.number().int().min(1).nullable()).optional();

// What a session started now would hold (the start screen, Home): the options Start takes, from the query string.
const previewSchema = z.object({
  // The id Start will use: the plan is then the very one it gets (the planner's choices follow the session id).
  id: z.string().uuid().optional(),
  language: z.enum(LANGUAGE_CODES as [LanguageCode, ...LanguageCode[]]),
  minutes: z.coerce.number().int().min(3).max(180).optional(),
  newWords: z.coerce.number().int().min(0).max(100).optional(),
  mode: z.enum(STUDY_MODES).optional(),
  focus: z.enum(['balanced', 'listening', 'speaking', 'reading', 'writing']).optional(),
  difficulty: z.enum(['easy', 'normal', 'challenging']).optional(),
  quick: z.enum(['1', 'true']).optional(),
  tag: z.string().max(60).optional(),
  // Empty: no range (Start's null); left out: the range in the settings.
  frequencyMin: rankOrNone,
  frequencyMax: rankOrNone,
});

export function registerSessionRoutes(router: Router, app: App) {
  router.post('/api/sessions', { body: createSchema }, (ctx, body) => {
    const config = normalizeConfig(app, body, ctx.now);
    return createSession(app, { id: body.id, config, prepared: body.prepared, replaceActive: body.replaceActive }, ctx.now, ctx.deviceId);
  });

  router.get('/api/sessions/active', {}, (ctx) => listActiveSessions(app, ctx.query.get('lang') ? lang(ctx.query.get('lang')!) : undefined));

  router.get('/api/sessions/history', {}, (ctx) =>
    sessionHistory(app, ctx.query.get('lang') ? lang(ctx.query.get('lang')!) : null, Math.min(Number(ctx.query.get('limit') ?? 30), 200)),
  );

  router.get('/api/sessions/preview', {}, (ctx) => {
    const q = previewSchema.safeParse({ ...Object.fromEntries(ctx.query), language: ctx.query.get('lang') ?? undefined });
    if (!q.success) throw new HttpError(422, 'validation_failed', 'Some fields are invalid', q.error.flatten());
    const { quick, id, ...opts } = q.data;
    return previewSession(app, normalizeConfig(app, { ...opts, quick: !!quick }, ctx.now), ctx.now, id);
  });

  router.get('/api/sessions/:id', {}, (ctx) => getSession(app, ctx.params.id));

  router.post('/api/sessions/:id/attempts', { body: attemptSchema }, (ctx, body) => submitAttempt(app, ctx.params.id, body, ctx.now, ctx.deviceId));

  router.post('/api/sessions/:id/events', { body: eventSchema }, (ctx, body) => sessionEvent(app, ctx.params.id, body, ctx.now));

  router.post('/api/sessions/:id/complete', {}, (ctx) => ({ summary: completeSession(app, ctx.params.id, ctx.now, 'completed') }));
}
