// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
import { z } from 'zod';
import type { App } from '../app.ts';
import { HttpError, respond, type Ctx, type Router } from '../http/http.ts';
import {
  assertLoginAllowed,
  beginLoginAttempt,
  checkSetupToken,
  clearSessionCookie,
  createSession,
  ownerExists,
  recordLoginAttempt,
} from '../auth/auth.ts';
import { dummyVerify, hashPassword, passwordProblems, verifyPassword } from '../auth/password.ts';
import { isValidTimezone } from '../../shared/time.ts';
import { TERMS_VERSION } from '../../shared/legal.ts';
import { acceptTerms, legalInfo, termsStatus } from '../services/legal.ts';

const credentials = z.object({ username: z.string().trim().min(1).max(100), password: z.string().min(1).max(1024) });

function userAgent(ctx: Ctx): string | null {
  const ua = ctx.req.headers['user-agent'];
  return typeof ua === 'string' && ua ? ua : null;
}

async function readBodyJson(ctx: Ctx, schema: z.ZodTypeAny) {
  const raw = await ctx.readBody(64 * 1024);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString('utf8') || '{}');
  } catch {
    throw new HttpError(400, 'bad_request', 'Malformed JSON body');
  }
  const r = schema.safeParse(parsed);
  if (!r.success) throw new HttpError(422, 'validation_failed', 'Some fields are invalid', r.error.flatten());
  return r.data;
}

export function registerAuthRoutes(router: Router, app: App) {
  const db = app.db;

  router.get('/api/auth/status', { auth: false }, (ctx) => {
    const setupRequired = !ownerExists(db);
    if (!ctx.auth) return { setupRequired, authenticated: false };
    return { setupRequired, authenticated: true, user: { username: ctx.auth.username }, csrfToken: ctx.auth.csrfToken };
  });

  router.post('/api/auth/setup', { auth: false, csrf: false, tx: false }, async (ctx) => {
    const body = await readBodyJson(ctx, credentials.extend({ setupToken: z.string().min(1).max(200), timezone: z.string().max(80).optional(), acceptTerms: z.boolean().optional() }));
    if (ownerExists(db)) throw new HttpError(409, 'already_setup', 'The owner account already exists. Sign in instead.');
    assertLoginAllowed(db, ctx.ip, ctx.now);
    if (!checkSetupToken(db, body.setupToken)) {
      recordLoginAttempt(db, ctx.ip, 'setup', false, ctx.now);
      throw new HttpError(403, 'bad_setup_token', 'The setup code is not correct. Find it in the server log (docker compose logs app).');
    }
    if (body.acceptTerms !== true) throw new HttpError(422, 'terms_not_accepted', 'Accept the Terms of Service to create the account.');
    const problems = passwordProblems(body.password);
    if (problems.length) throw new HttpError(422, 'weak_password', problems.join(' '), { problems });
    const hash = await hashPassword(body.password);
    const session = db.tx(() => {
      if (ownerExists(db)) throw new HttpError(409, 'already_setup', 'The owner account already exists.');
      db.run('INSERT INTO users (id, username, password_hash, created_at, updated_at, password_changed_at) VALUES (1, ?, ?, ?, ?, ?)', body.username, hash, ctx.now, ctx.now, ctx.now);
      db.run("DELETE FROM app_meta WHERE key = 'setup_token_hash'");
      acceptTerms(db, 1, TERMS_VERSION, ctx.now, ctx.deviceId, userAgent(ctx));
      if (body.timezone && isValidTimezone(body.timezone)) {
        db.run("INSERT INTO user_settings (key, value, updated_at) VALUES ('timezone', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", JSON.stringify(body.timezone), ctx.now);
      }
      return createSession(db, app.config, ctx, 1);
    });
    return { authenticated: true, user: { username: body.username }, csrfToken: session.csrfToken };
  });

  // Legal details for the Terms of Service page, readable before signing in.
  router.get('/api/legal', { auth: false, csrf: false }, () => legalInfo(app.config));
  router.get('/api/legal/terms', {}, (ctx) => termsStatus(db, ctx.auth!.userId));
  // Click-wrap: the signed-in owner accepts the version of the terms in force.
  router.post('/api/legal/accept', { body: z.object({ version: z.string().min(1).max(40) }) }, (ctx, body) =>
    acceptTerms(db, ctx.auth!.userId, body.version, ctx.now, ctx.deviceId, userAgent(ctx)),
  );

  router.post('/api/auth/login', { auth: false, csrf: false, tx: false }, async (ctx) => {
    const body = await readBodyJson(ctx, credentials);
    const finished = beginLoginAttempt(db, ctx.ip, ctx.now);
    const user = db.get<{ id: number; username: string; password_hash: string }>('SELECT id, username, password_hash FROM users WHERE id = 1');
    let ok = false;
    try {
      if (user && user.username.toLowerCase() === body.username.toLowerCase()) ok = await verifyPassword(body.password, user.password_hash);
      else await dummyVerify(body.password);
      recordLoginAttempt(db, ctx.ip, body.username, ok, ctx.now);
    } finally {
      finished();
    }
    if (!ok || !user) throw new HttpError(401, 'invalid_credentials', 'Incorrect username or password.');
    const session = db.tx(() => createSession(db, app.config, ctx, user.id));
    return { authenticated: true, user: { username: user.username }, csrfToken: session.csrfToken };
  });

  router.post('/api/auth/logout', {}, (ctx) => {
    db.run('DELETE FROM auth_sessions WHERE id = ?', ctx.auth!.sessionId);
    clearSessionCookie(app.config, ctx);
    return { ok: true };
  });

  router.post('/api/auth/logout-all', {}, (ctx) => {
    db.run('DELETE FROM auth_sessions WHERE user_id = ?', ctx.auth!.userId);
    clearSessionCookie(app.config, ctx);
    return { ok: true };
  });

  router.get('/api/auth/sessions', {}, (ctx) =>
    db
      .all<any>('SELECT id, created_at, last_seen_at, user_agent, ip, idle_expires_at FROM auth_sessions WHERE user_id = ? ORDER BY last_seen_at DESC', ctx.auth!.userId)
      .map((s) => ({ id: s.id.slice(0, 12), current: s.id === ctx.auth!.sessionId, createdAt: s.created_at, lastSeenAt: s.last_seen_at, userAgent: s.user_agent, ip: s.ip, expiresAt: s.idle_expires_at })),
  );

  router.delete('/api/auth/sessions/:id', {}, (ctx) => {
    const r = db.run('DELETE FROM auth_sessions WHERE user_id = ? AND substr(id, 1, 12) = ?', ctx.auth!.userId, ctx.params.id);
    return { removed: r.changes };
  });

  router.post('/api/auth/password', { tx: false }, async (ctx) => {
    const body = await readBodyJson(ctx, z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(1).max(1024) }));
    const finished = beginLoginAttempt(db, ctx.ip, ctx.now);
    const user = db.get<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = 1')!;
    let currentOk = false;
    try {
      currentOk = await verifyPassword(body.currentPassword, user.password_hash);
      if (!currentOk) recordLoginAttempt(db, ctx.ip, ctx.auth!.username, false, ctx.now);
    } finally {
      finished();
    }
    if (!currentOk) throw new HttpError(403, 'invalid_credentials', 'Current password is incorrect.');
    const problems = passwordProblems(body.newPassword);
    if (problems.length) throw new HttpError(422, 'weak_password', problems.join(' '), { problems });
    const hash = await hashPassword(body.newPassword);
    db.tx(() => {
      db.run('UPDATE users SET password_hash = ?, password_changed_at = ?, updated_at = ? WHERE id = 1', hash, ctx.now, ctx.now);
      // Sign out every other device after a password change.
      db.run('DELETE FROM auth_sessions WHERE user_id = 1 AND id != ?', ctx.auth!.sessionId);
    });
    return respond(200, { ok: true });
  });
}
