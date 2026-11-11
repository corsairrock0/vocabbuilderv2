// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
/** Fetch wrapper: same-origin cookies, CSRF header, device id, idempotency keys, typed errors. */

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
  get isNetwork() {
    return this.status === 0;
  }
  /** Worth retrying later (offline, server busy/restarting). */
  get retryable() {
    return this.status === 0 || this.status === 429 || this.status === 503 || this.status >= 500;
  }
}

export function uuid(): string {
  // randomUUID only exists in secure contexts (HTTPS/localhost); plain-HTTP LAN access falls back to getRandomValues.
  const c: Crypto = globalThis.crypto;
  if (typeof c.randomUUID === 'function') return c.randomUUID();
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function readDeviceId(): string {
  try {
    let id = localStorage.getItem('vb-device-id');
    if (!id) {
      id = `d-${uuid()}`;
      localStorage.setItem('vb-device-id', id);
    }
    return id;
  } catch {
    return `d-${uuid()}`;
  }
}

export const deviceId = readDeviceId();
let csrfToken = '';
export function hasCsrf(): boolean {
  return !!csrfToken;
}
export function setCsrf(token: string | undefined) {
  csrfToken = token ?? '';
}

type UnauthHandler = () => void;
let onUnauthenticated: UnauthHandler = () => {};
export function setUnauthenticatedHandler(fn: UnauthHandler) {
  onUnauthenticated = fn;
}

export interface ApiOptions {
  idempotencyKey?: string;
  signal?: AbortSignal;
  /** Raw body (Blob/ArrayBuffer/File) with this content type instead of JSON. */
  contentType?: string;
}

export async function api<T = unknown>(method: string, path: string, body?: unknown, opts: ApiOptions = {}): Promise<T> {
  const headers: Record<string, string> = { 'X-Device-Id': deviceId, Accept: 'application/json' };
  if (method !== 'GET' && csrfToken) headers['X-CSRF-Token'] = csrfToken;
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
  let payload: BodyInit | undefined;
  if (body !== undefined && body !== null) {
    if (opts.contentType) {
      headers['Content-Type'] = opts.contentType;
      payload = body as BodyInit;
    } else {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
  }
  let res: Response;
  try {
    res = await fetch(path, { method, headers, body: payload, credentials: 'same-origin', signal: opts.signal });
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') throw err;
    throw new ApiError(0, 'network', 'Cannot reach the server. Your work is kept on this device and will sync automatically.');
  }
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const e = data?.error;
    if (res.status === 401) onUnauthenticated();
    throw new ApiError(res.status, e?.code ?? `http_${res.status}`, e?.message ?? `Request failed (${res.status})`, e?.details);
  }
  return data as T;
}

export const get = <T>(path: string, signal?: AbortSignal) => api<T>('GET', path, undefined, { signal });
export const post = <T>(path: string, body?: unknown, opts?: ApiOptions) => api<T>('POST', path, body ?? {}, opts);
export const put = <T>(path: string, body?: unknown, opts?: ApiOptions) => api<T>('PUT', path, body ?? {}, opts);
export const del = <T>(path: string) => api<T>('DELETE', path);

/**
 * Fetch the session's CSRF token (after an offline start, or when the server rotated it).
 * Resolves 'signed_out' when the session is gone; throws a network ApiError when offline.
 */
export async function refreshCsrf(): Promise<'ok' | 'signed_out'> {
  const st = await api<{ authenticated: boolean; csrfToken?: string }>('GET', '/api/auth/status');
  if (st.authenticated && st.csrfToken) {
    setCsrf(st.csrfToken);
    return 'ok';
  }
  return 'signed_out';
}
