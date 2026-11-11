// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
import { createHash, randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ZodType } from 'zod';
import type { Db } from '../db/database.ts';
import { errorFields, log } from '../log.ts';

export class HttpError extends Error {
  status: number;
  code: string;
  details?: unknown;
  headers?: Record<string, string>;
  constructor(status: number, code: string, message: string, details?: unknown, headers?: Record<string, string>) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    this.headers = headers;
  }
}

export const badRequest = (message: string, details?: unknown) => new HttpError(400, 'bad_request', message, details);
export const notFound = (what = 'Resource') => new HttpError(404, 'not_found', `${what} not found`);
export const conflict = (code: string, message: string, details?: unknown) => new HttpError(409, code, message, details);

export interface AuthInfo {
  sessionId: string;
  userId: number;
  username: string;
  csrfToken: string;
}

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  url: URL;
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  ip: string;
  secure: boolean;
  cookies: Record<string, string>;
  auth: AuthInfo | null;
  deviceId: string | null;
  now: number;
  requestId: string;
  readBody(limit: number): Promise<Buffer>;
  setCookie(name: string, value: string, opts: CookieOptions): void;
  responseHeaders: Record<string, string>;
}

export interface CookieOptions {
  maxAgeSeconds?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Lax' | 'Strict' | 'None';
  path?: string;
}

/** Return this from a handler that wrote the response itself (files, streams). */
export const HANDLED = Symbol('handled');

export interface JsonResult {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

const RESULT = Symbol('json-result');

/** Explicit status/headers for a JSON response (plain return values become 200 JSON). */
export function respond(status: number, body: unknown, headers?: Record<string, string>): JsonResult {
  return { [RESULT]: true, status, body, headers } as JsonResult;
}

export function isJsonResult(x: unknown): x is JsonResult {
  return typeof x === 'object' && x !== null && (x as Record<symbol, unknown>)[RESULT] === true;
}

type AnyHandler = (ctx: Ctx, body: any) => unknown;

export interface RouteOptions {
  /** Require an authenticated owner session (default true). */
  auth?: boolean;
  /** Require the CSRF header on this mutating route (default true when auth is required). */
  csrf?: boolean;
  /** zod schema for a JSON body; the parsed value is passed to the handler. */
  body?: ZodType<any>;
  /** Run synchronously inside one database transaction with idempotency-key support (default: true for JSON-bodied mutations). */
  tx?: boolean;
  maxBodyBytes?: number;
}

interface Route {
  method: string;
  parts: string[];
  options: RouteOptions;
  handler: AnyHandler;
}

export class Router {
  private routes: Route[] = [];

  add(method: string, pattern: string, options: RouteOptions, handler: AnyHandler): void {
    this.routes.push({ method, parts: pattern.split('/').filter(Boolean), options, handler });
  }
  get(p: string, o: RouteOptions, h: AnyHandler) {
    this.add('GET', p, o, h);
  }
  post(p: string, o: RouteOptions, h: AnyHandler) {
    this.add('POST', p, o, h);
  }
  put(p: string, o: RouteOptions, h: AnyHandler) {
    this.add('PUT', p, o, h);
  }
  patch(p: string, o: RouteOptions, h: AnyHandler) {
    this.add('PATCH', p, o, h);
  }
  delete(p: string, o: RouteOptions, h: AnyHandler) {
    this.add('DELETE', p, o, h);
  }

  match(method: string, path: string): { route: Route; params: Record<string, string> } | { allowed: string[] } | null {
    const segs = path.split('/').filter(Boolean);
    const allowed: string[] = [];
    for (const r of this.routes) {
      if (r.parts.length !== segs.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < segs.length; i++) {
        const p = r.parts[i];
        if (p.startsWith(':')) {
          try {
            params[p.slice(1)] = decodeURIComponent(segs[i]);
          } catch {
            ok = false;
            break;
          }
        } else if (p !== segs[i]) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      if (r.method === method || (method === 'HEAD' && r.method === 'GET')) return { route: r, params };
      allowed.push(r.method);
    }
    return allowed.length ? { allowed } : null;
  }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (!k) continue;
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

export function serializeCookie(name: string, value: string, o: CookieOptions): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${o.path ?? '/'}`];
  if (o.maxAgeSeconds != null) parts.push(`Max-Age=${Math.floor(o.maxAgeSeconds)}`);
  if (o.httpOnly !== false) parts.push('HttpOnly');
  if (o.secure) parts.push('Secure');
  parts.push(`SameSite=${o.sameSite ?? 'Lax'}`);
  return parts.join('; ');
}

export function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const data = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(data),
    ...headers,
  });
  res.end(data);
}

export function sendError(res: ServerResponse, err: unknown, requestId: string): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  if (err instanceof HttpError) {
    sendJson(res, err.status, { error: { code: err.code, message: err.message, details: err.details, requestId } }, err.headers);
    return;
  }
  log.error('unhandled request error', { requestId, ...errorFields(err) });
  sendJson(res, 500, { error: { code: 'internal', message: 'Internal server error — nothing was saved for this request.', requestId } });
}

export function hashRequest(method: string, path: string, body: unknown): string {
  return createHash('sha256').update(`${method} ${path} ${JSON.stringify(body ?? null)}`).digest('hex');
}

/**
 * Run a mutating handler atomically with idempotency-key replay.
 * If the same key is retried (e.g. after a network failure), the stored response is
 * returned and nothing is applied twice.
 */
export function runIdempotent(db: Db, ctx: Ctx, body: unknown, handler: () => unknown): JsonResult {
  const key = (ctx.req.headers['idempotency-key'] as string | undefined)?.trim();
  if (key && (key.length > 200 || !/^[\w.:~-]+$/.test(key))) throw badRequest('Invalid Idempotency-Key header');
  return db.tx(() => {
    const hash = hashRequest(ctx.method, ctx.path, body);
    if (key) {
      const existing = db.get<{ request_hash: string; status: number; response: string }>(
        'SELECT request_hash, status, response FROM idempotency_keys WHERE key = ?',
        key,
      );
      if (existing) {
        if (existing.request_hash !== hash) {
          throw new HttpError(422, 'idempotency_conflict', 'This Idempotency-Key was already used for a different request.');
        }
        return { status: existing.status, body: JSON.parse(existing.response), headers: { 'Idempotent-Replayed': 'true' } };
      }
    }
    const out = handler();
    const result: JsonResult = isJsonResult(out) ? out : { status: 200, body: out ?? { ok: true } };
    if (key) {
      db.run(
        'INSERT INTO idempotency_keys (key, method, path, request_hash, status, response, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        key,
        ctx.method,
        ctx.path,
        hash,
        result.status,
        JSON.stringify(result.body ?? null),
        ctx.now,
      );
    }
    return result;
  });
}

export async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const declared = Number(req.headers['content-length'] ?? 0);
  if (declared > limit) throw new HttpError(413, 'payload_too_large', `Request body exceeds ${Math.round(limit / 1024)} KB`);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new HttpError(413, 'payload_too_large', `Request body exceeds ${Math.round(limit / 1024)} KB`);
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

export async function readJsonBody(ctx: Ctx, schema: ZodType<any> | undefined, limit: number): Promise<unknown> {
  const ct = String(ctx.req.headers['content-type'] ?? '');
  const raw = await ctx.readBody(limit);
  if (!raw.length) {
    if (!schema) return undefined;
    const r = schema.safeParse({});
    if (r.success) return r.data;
    throw badRequest('Request body required', r.error.flatten());
  }
  if (!ct.includes('application/json')) throw new HttpError(415, 'unsupported_media_type', 'Expected application/json');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString('utf8'));
  } catch {
    throw badRequest('Malformed JSON body');
  }
  if (!schema) return parsed;
  const r = schema.safeParse(parsed);
  if (!r.success) throw new HttpError(422, 'validation_failed', 'Some fields are invalid', r.error.flatten());
  return r.data;
}

export function newRequestId(): string {
  return randomUUID().slice(0, 8);
}

/** Simple fixed-window limiter for API requests per client IP (protects the single-user server). */
export class WindowLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();
  private limit: number;
  private windowMs: number;
  constructor(limit: number, windowMs: number) {
    this.limit = limit;
    this.windowMs = windowMs;
  }
  take(key: string, now = Date.now()): { ok: boolean; retryAfterS: number } {
    let h = this.hits.get(key);
    if (!h || h.resetAt <= now) {
      h = { count: 0, resetAt: now + this.windowMs };
      this.hits.set(key, h);
      if (this.hits.size > 5000) for (const [k, v] of this.hits) if (v.resetAt <= now) this.hits.delete(k);
    }
    h.count++;
    return { ok: h.count <= this.limit, retryAfterS: Math.ceil((h.resetAt - now) / 1000) };
  }
}

/** Stream a file to the response. A read error (e.g. the file was deleted mid-download) ends only this response. */
export function pipeFile(stream: import('node:stream').Readable, res: import('node:http').ServerResponse): void {
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}
