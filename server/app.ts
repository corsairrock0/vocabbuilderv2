// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import type { Config } from './config.ts';
import type { Db } from './db/database.ts';
import { schemaVersion } from './db/migrate.ts';
import { resolveSession, SESSION_COOKIE } from './auth/auth.ts';
import {
  HANDLED,
  HttpError,
  isJsonResult,
  newRequestId,
  parseCookies,
  readBody,
  readJsonBody,
  Router,
  runIdempotent,
  sendError,
  sendJson,
  serializeCookie,
  WindowLimiter,
  type Ctx,
} from './http/http.ts';
import { serveStatic } from './http/static.ts';
import { log } from './log.ts';
import { registerAuthRoutes } from './routes/auth.ts';
import { registerSettingsRoutes } from './routes/settings.ts';
import { registerVocabRoutes } from './routes/vocab.ts';
import { registerImportRoutes } from './routes/import.ts';
import { registerSessionRoutes } from './routes/sessions.ts';
import { registerAudioRoutes } from './routes/audio.ts';
import { registerStatsRoutes } from './routes/stats.ts';
import { registerBackupRoutes } from './routes/backups.ts';
import { registerPracticeRoutes } from './routes/practice.ts';
import { ForvoClient } from './audio/forvo.ts';
import { BackupService } from './backup/backup.ts';

export interface App {
  config: Config;
  db: Db;
  forvo: ForvoClient;
  backups: BackupService;
  /** Set while a restore swaps the database file; requests receive 503. */
  maintenance: { active: boolean; reason: string | null };
}

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https://*.forvo.com",
  "connect-src 'self'",
  "font-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'microphone=(self), camera=(), geolocation=(), payment=(), usb=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function clientIp(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const xff = req.headers['x-forwarded-for'];
    const first = (Array.isArray(xff) ? xff[0] : xff)?.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.socket.remoteAddress ?? 'unknown';
}

function originAllowed(app: App, req: IncomingMessage, secure: boolean): boolean {
  const origin = req.headers.origin;
  if (!origin) {
    // Non-browser clients (CLI/tests) send no Origin; browsers always send it on cross-site POSTs.
    const fetchSite = req.headers['sec-fetch-site'];
    return !fetchSite || fetchSite === 'same-origin' || fetchSite === 'none';
  }
  if (app.config.publicOrigin && origin === app.config.publicOrigin) return true;
  const host = req.headers['x-forwarded-host'] && app.config.trustProxy ? String(req.headers['x-forwarded-host']) : req.headers.host;
  return origin === `${secure ? 'https' : 'http'}://${host}` || origin === `https://${host}` || origin === `http://${host}`;
}

export function buildRouter(app: App): Router {
  const router = new Router();
  registerAuthRoutes(router, app);
  registerSettingsRoutes(router, app);
  registerVocabRoutes(router, app);
  registerImportRoutes(router, app);
  registerSessionRoutes(router, app);
  registerAudioRoutes(router, app);
  registerStatsRoutes(router, app);
  registerBackupRoutes(router, app);
  registerPracticeRoutes(router, app);
  return router;
}

export function createAppServer(app: App): { server: Server; router: Router; closeAll: () => Promise<void> } {
  const router = buildRouter(app);
  const apiLimiter = new WindowLimiter(1200, 60_000);
  const sockets = new Set<Socket>();

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const requestId = newRequestId();
    const started = Date.now();
    const url = new URL(req.url ?? '/', 'http://localhost');
    const pathname = url.pathname;
    const secure = (app.config.trustProxy && req.headers['x-forwarded-proto'] === 'https') || !!(req.socket as { encrypted?: boolean }).encrypted;
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
    const setCookies: string[] = [];
    const ctx: Ctx = {
      req,
      res,
      method: req.method ?? 'GET',
      url,
      path: pathname,
      params: {},
      query: url.searchParams,
      ip: clientIp(req, app.config.trustProxy),
      secure,
      cookies: parseCookies(req.headers.cookie),
      auth: null,
      deviceId: null,
      now: Date.now(),
      requestId,
      readBody: (limit) => readBody(req, limit),
      setCookie: (name, value, opts) => {
        setCookies.push(serializeCookie(name, value, opts));
        res.setHeader('Set-Cookie', setCookies);
      },
      responseHeaders: {},
    };

    try {
      if (pathname === '/healthz') {
        let dbOk = false;
        try {
          dbOk = app.db.get<{ ok: number }>('SELECT 1 AS ok')?.ok === 1;
        } catch {
          dbOk = false;
        }
        sendJson(res, dbOk && !app.maintenance.active ? 200 : 503, {
          ok: dbOk && !app.maintenance.active,
          version: app.config.version,
          schema: dbOk ? schemaVersion(app.db) : null,
          maintenance: app.maintenance.active,
          time: Date.now(),
        });
        return;
      }
      if (!pathname.startsWith('/api/')) {
        if (ctx.method !== 'GET' && ctx.method !== 'HEAD') throw new HttpError(405, 'method_not_allowed', 'Method not allowed');
        serveStatic(app.config.staticDir, req, res, pathname);
        return;
      }
      if (app.maintenance.active) {
        throw new HttpError(503, 'maintenance', app.maintenance.reason ?? 'Maintenance in progress, try again shortly.', undefined, { 'Retry-After': '5' });
      }
      const limit = apiLimiter.take(ctx.ip);
      if (!limit.ok) throw new HttpError(429, 'rate_limited', 'Too many requests', undefined, { 'Retry-After': String(limit.retryAfterS) });

      const m = router.match(ctx.method, pathname);
      if (!m) throw new HttpError(404, 'not_found', 'Unknown API endpoint');
      if ('allowed' in m) throw new HttpError(405, 'method_not_allowed', 'Method not allowed', undefined, { Allow: m.allowed.join(', ') });
      const { route, params } = m;
      ctx.params = params;
      const opts = route.options;
      const needsAuth = opts.auth !== false;
      ctx.auth = resolveSession(app.db, app.config, ctx.cookies[SESSION_COOKIE], ctx.now);
      if (needsAuth && !ctx.auth) throw new HttpError(401, 'unauthenticated', 'Please sign in.');

      const mutating = MUTATING.has(ctx.method);
      if (mutating) {
        if (!originAllowed(app, req, secure)) throw new HttpError(403, 'bad_origin', 'Cross-origin request rejected.');
        if (needsAuth && opts.csrf !== false) {
          const token = req.headers['x-csrf-token'];
          if (typeof token !== 'string' || !ctx.auth || token !== ctx.auth.csrfToken) {
            throw new HttpError(403, 'csrf_failed', 'Security token missing or expired. Reload the page and try again.');
          }
        }
      }
      const device = req.headers['x-device-id'];
      if (typeof device === 'string' && /^[\w-]{8,64}$/.test(device)) ctx.deviceId = device;
      if (ctx.auth && ctx.deviceId) touchDevice(app, ctx);

      let body: unknown = undefined;
      if (mutating && (opts.body || opts.tx !== false)) {
        const ct = String(req.headers['content-type'] ?? '');
        if (opts.body || ct.includes('application/json')) body = await readJsonBody(ctx, opts.body, opts.maxBodyBytes ?? 1024 * 1024);
      }
      let result: unknown;
      if (mutating && opts.tx !== false) {
        result = runIdempotent(app.db, ctx, body, () => route.handler(ctx, body));
      } else {
        result = await route.handler(ctx, body);
      }
      if (result === HANDLED) return;
      if (isJsonResult(result)) sendJson(res, result.status, result.body, result.headers);
      else if (result && typeof result === 'object' && 'status' in result && 'body' in result && mutating && opts.tx !== false) {
        const r = result as { status: number; body: unknown; headers?: Record<string, string> };
        sendJson(res, r.status, r.body, r.headers);
      } else sendJson(res, 200, result ?? { ok: true });
    } catch (err) {
      sendError(res, err, requestId);
    } finally {
      const ms = Date.now() - started;
      if (pathname.startsWith('/api/')) {
        const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'info' : 'debug';
        log[level]('request', { id: requestId, method: ctx.method, path: pathname, status: res.statusCode, ms });
      }
    }
  };

  const server = createServer({ requestTimeout: 120_000, headersTimeout: 30_000, keepAliveTimeout: 5_000 }, (req, res) => {
    void handle(req, res);
  });
  server.on('connection', (s) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });
  const closeAll = () =>
    new Promise<void>((resolve) => {
      server.close(() => resolve());
      setTimeout(() => {
        for (const s of sockets) s.destroy();
      }, 3000).unref();
      server.closeIdleConnections?.();
    });
  return { server, router, closeAll };
}

const deviceTouched = new Map<string, number>();
function touchDevice(app: App, ctx: Ctx) {
  const id = ctx.deviceId!;
  const last = deviceTouched.get(id) ?? 0;
  if (ctx.now - last < 60_000) return;
  deviceTouched.set(id, ctx.now);
  app.db.tx(() =>
    app.db.run(
      `INSERT INTO devices (id, user_agent, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET last_seen_at = excluded.last_seen_at, user_agent = excluded.user_agent`,
      id,
      String(ctx.req.headers['user-agent'] ?? '').slice(0, 300),
      ctx.now,
      ctx.now,
    ),
  );
}
