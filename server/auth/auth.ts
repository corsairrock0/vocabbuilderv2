// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Config } from '../config.ts';
import type { Db } from '../db/database.ts';
import { HttpError, type AuthInfo, type Ctx } from '../http/http.ts';

export const SESSION_COOKIE = 'vb_session';
const TOUCH_INTERVAL_MS = 5 * 60_000;
const DAY_MS = 86_400_000;

export const LOGIN_LIMITS = {
  perIpFailures: 5,
  perIpWindowMs: 15 * 60_000,
  globalFailures: 30,
  globalWindowMs: 60 * 60_000,
};

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const A = Buffer.from(a);
  const B = Buffer.from(b);
  return A.length === B.length && timingSafeEqual(A, B);
}

export function ownerExists(db: Db): boolean {
  return !!db.get('SELECT 1 AS x FROM users WHERE id = 1');
}

/**
 * First-run protection: until an owner account exists, account creation requires a setup
 * code (VB_SETUP_TOKEN, or a random code printed in the server log at startup), so nobody
 * who merely reaches the URL can claim the instance.
 */
export function prepareSetupToken(db: Db, config: Config): string | null {
  if (ownerExists(db)) return null;
  const token = config.setupToken ?? randomToken(9).replace(/[-_]/g, 'x').slice(0, 12).toUpperCase();
  db.tx(() => db.setMeta('setup_token_hash', sha256(token)));
  return token;
}

export function checkSetupToken(db: Db, token: string): boolean {
  const stored = db.meta('setup_token_hash');
  return !!stored && safeEqual(stored, sha256(token.trim()));
}

export function cookieSecure(config: Config, ctx: Ctx): boolean {
  if (config.cookieSecure === 'auto') return ctx.secure || (config.publicOrigin?.startsWith('https://') ?? false);
  return config.cookieSecure;
}

export function createSession(db: Db, config: Config, ctx: Ctx, userId: number): { token: string; csrfToken: string } {
  const token = randomToken();
  const csrfToken = randomToken(24);
  const now = ctx.now;
  db.run(
    `INSERT INTO auth_sessions (id, user_id, csrf_token, created_at, last_seen_at, idle_expires_at, absolute_expires_at, user_agent, ip)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    sha256(token),
    userId,
    csrfToken,
    now,
    now,
    now + config.sessionIdleDays * DAY_MS,
    now + config.sessionMaxDays * DAY_MS,
    String(ctx.req.headers['user-agent'] ?? '').slice(0, 300),
    ctx.ip,
  );
  ctx.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: cookieSecure(config, ctx),
    maxAgeSeconds: config.sessionMaxDays * 86400,
  });
  return { token, csrfToken };
}

export function clearSessionCookie(config: Config, ctx: Ctx) {
  ctx.setCookie(SESSION_COOKIE, '', { httpOnly: true, sameSite: 'Lax', secure: cookieSecure(config, ctx), maxAgeSeconds: 0 });
}

export function resolveSession(db: Db, config: Config, token: string | undefined, now: number): AuthInfo | null {
  if (!token || token.length > 200) return null;
  const id = sha256(token);
  const row = db.get<{ id: string; user_id: number; csrf_token: string; last_seen_at: number; idle_expires_at: number; absolute_expires_at: number; username: string }>(
    `SELECT s.id, s.user_id, s.csrf_token, s.last_seen_at, s.idle_expires_at, s.absolute_expires_at, u.username
       FROM auth_sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`,
    id,
  );
  if (!row) return null;
  if (row.idle_expires_at <= now || row.absolute_expires_at <= now) {
    db.tx(() => db.run('DELETE FROM auth_sessions WHERE id = ?', id));
    return null;
  }
  if (now - row.last_seen_at > TOUCH_INTERVAL_MS) {
    db.tx(() =>
      db.run(
        'UPDATE auth_sessions SET last_seen_at = ?, idle_expires_at = MIN(absolute_expires_at, ?) WHERE id = ?',
        now,
        now + config.sessionIdleDays * DAY_MS,
        id,
      ),
    );
  }
  return { sessionId: row.id, userId: row.user_id, username: row.username, csrfToken: row.csrf_token };
}

/**
 * Sign-in attempts still being checked (the password hash takes a moment) count as failures, so a burst of parallel
 * guesses cannot all slip past the limit before the first one is recorded. At most two hashes run at a time, which
 * also bounds CPU and memory (each check uses about 128 MiB).
 */
const inFlight = new Map<string, number>();
let inFlightTotal = 0;
const MAX_CONCURRENT_CHECKS = 2;

export function beginLoginAttempt(db: Db, ip: string, now: number): () => void {
  const pending = inFlight.get(ip) ?? 0;
  assertLoginAllowed(db, ip, now, pending, inFlightTotal);
  if (inFlightTotal >= MAX_CONCURRENT_CHECKS) {
    throw new HttpError(429, 'too_many_attempts', 'Sign-in is busy. Try again in a moment.', { retryAfterSeconds: 2 }, { 'Retry-After': '2' });
  }
  inFlight.set(ip, pending + 1);
  inFlightTotal++;
  let done = false;
  return () => {
    if (done) return;
    done = true;
    const n = (inFlight.get(ip) ?? 1) - 1;
    if (n <= 0) inFlight.delete(ip);
    else inFlight.set(ip, n);
    inFlightTotal--;
  };
}

/** Throws 429 when an IP (or the instance overall) has too many recent failed logins. */
export function assertLoginAllowed(db: Db, ip: string, now: number, pendingForIp = 0, pendingTotal = 0): void {
  const ipFails = db.get<{ n: number; oldest: number | null }>(
    'SELECT COUNT(*) AS n, MIN(attempted_at) AS oldest FROM login_attempts WHERE ip = ? AND success = 0 AND attempted_at > ?',
    ip,
    now - LOGIN_LIMITS.perIpWindowMs,
  )!;
  if (ipFails.n + pendingForIp >= LOGIN_LIMITS.perIpFailures) {
    const retry = Math.max(1, Math.ceil(((ipFails.oldest ?? now) + LOGIN_LIMITS.perIpWindowMs - now) / 1000));
    throw new HttpError(429, 'too_many_attempts', `Too many failed sign-in attempts. Try again in ${Math.ceil(retry / 60)} minute(s).`, { retryAfterSeconds: retry }, { 'Retry-After': String(retry) });
  }
  const global = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM login_attempts WHERE success = 0 AND attempted_at > ?', now - LOGIN_LIMITS.globalWindowMs)!;
  if (global.n + pendingTotal >= LOGIN_LIMITS.globalFailures) {
    throw new HttpError(429, 'too_many_attempts', 'Sign-in is temporarily locked because of many failed attempts. Try again later.', { retryAfterSeconds: 900 }, { 'Retry-After': '900' });
  }
}

export function recordLoginAttempt(db: Db, ip: string, username: string, success: boolean, now: number): void {
  db.tx(() => {
    db.run('INSERT INTO login_attempts (ip, username, success, attempted_at) VALUES (?, ?, ?, ?)', ip, username.slice(0, 100), success ? 1 : 0, now);
    if (success) db.run('DELETE FROM login_attempts WHERE ip = ? AND success = 0', ip);
    db.run('DELETE FROM login_attempts WHERE attempted_at < ?', now - 30 * DAY_MS);
  });
}

export function pruneExpiredSessions(db: Db, now: number): number {
  return db.tx(() => db.run('DELETE FROM auth_sessions WHERE idle_expires_at <= ? OR absolute_expires_at <= ?', now, now).changes);
}

export function sessionIdFromToken(token: string): string {
  return sha256(token);
}
