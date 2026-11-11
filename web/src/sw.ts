// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
/// <reference lib="webworker" />
/**
 * VocabBuilder service worker.
 *
 * - Precaches the app shell (index.html, hashed JS/CSS chunks, fonts, icons) per build, so the app opens offline.
 * - Navigations: network first (short timeout), falling back to the cached shell.
 * - Never caches API responses, with one exception: the user's OWN uploaded recordings (/api/audio/file/:id),
 *   so they can play offline. Forvo audio is cross-origin and is never intercepted, stored or cached here.
 * - Learning progress is never stored here; it lives in IndexedDB (outbox) until the server confirms it.
 * - Identify practice pictures (/identify/, content-hashed names) are cached when first shown, so a practice that
 *   has been opened once keeps its pictures offline; they are never precached (about 50 MB in all).
 */
declare const __PRECACHE__: string[];
declare const __BUILD_ID__: string;

const sw = self as unknown as ServiceWorkerGlobalScope;
const SHELL = `vb-shell-${__BUILD_ID__}`;
const USER_AUDIO = 'vb-user-audio';
const PICTURES = 'vb-identify';
const PICTURES_MAX = 500;
const NAV_TIMEOUT_MS = 3500;

sw.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL);
      // cache: 'reload' bypasses the HTTP cache so a new build never precaches stale files.
      await cache.addAll(__PRECACHE__.map((url) => new Request(url, { cache: 'reload', credentials: 'same-origin' })));
    })(),
  );
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith('vb-shell-') && key !== SHELL) await caches.delete(key);
      }
      await sw.clients.claim();
    })(),
  );
});

sw.addEventListener('message', (event) => {
  const type = (event.data as { type?: string } | null)?.type;
  if (type === 'SKIP_WAITING') void sw.skipWaiting();
  if (type === 'CLEAR_USER_DATA') event.waitUntil(caches.delete(USER_AUDIO));
});

sw.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== sw.location.origin) return; // Forvo and any other third party: untouched.

  if (url.pathname.startsWith('/api/audio/file/')) {
    event.respondWith(userRecording(event, req, url));
    return;
  }
  if (url.pathname.startsWith('/api/') || url.pathname === '/healthz' || url.pathname === '/sw.js') return;

  if (req.mode === 'navigate') {
    event.respondWith(navigation(req));
    return;
  }
  if (url.pathname.startsWith('/identify/')) {
    event.respondWith(picture(event, req));
    return;
  }
  event.respondWith(staticAsset(req, url));
});

async function navigation(req: Request): Promise<Response> {
  const cache = await caches.open(SHELL);
  try {
    const res = await withTimeout(fetch(req), NAV_TIMEOUT_MS);
    if (res.ok && (res.headers.get('content-type') ?? '').includes('text/html')) return res;
    if (res.status >= 500) throw new Error(`server ${res.status}`);
    return res;
  } catch {
    const shell = await cache.match('/');
    if (shell) return shell;
    return new Response('<!doctype html><meta charset="utf-8"><title>Offline</title><p style="font-family:system-ui;margin:3rem">VocabBuilder is offline and has not been opened on this device before.</p>', {
      status: 503,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }
}

async function staticAsset(req: Request, url: URL): Promise<Response> {
  const cache = await caches.open(SHELL);
  const hit = await cache.match(req, { ignoreSearch: url.pathname.startsWith('/assets/') });
  if (hit) return hit;
  try {
    const res = await fetch(req);
    // Hashed chunks of the current build that were not precached (e.g. after a hot update) are kept.
    if (res.ok && url.pathname.startsWith('/assets/') && !url.pathname.endsWith('.map')) void cache.put(req, res.clone());
    return res;
  } catch (err) {
    const fallback = await caches.match(req);
    if (fallback) return fallback;
    throw err;
  }
}

/** Identify pictures: cache first (a name never changes content); the oldest are dropped past PICTURES_MAX. */
async function picture(event: FetchEvent, req: Request): Promise<Response> {
  const cache = await caches.open(PICTURES);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.status === 200) {
    event.waitUntil(
      (async () => {
        await cache.put(req, res.clone());
        const keys = await cache.keys();
        for (const k of keys.slice(0, Math.max(0, keys.length - PICTURES_MAX))) await cache.delete(k);
      })().catch(() => undefined),
    );
  }
  return res;
}

/** The user's own recordings: network first; a full copy is kept for offline playback. Range requests are honoured. */
async function userRecording(event: FetchEvent, req: Request, url: URL): Promise<Response> {
  const key = url.origin + url.pathname;
  const cache = await caches.open(USER_AUDIO);
  try {
    const res = await fetch(req);
    if (res.ok) {
      if (res.status === 200 && !req.headers.has('range')) {
        void cache.put(key, res.clone());
      } else {
        event.waitUntil(
          (async () => {
            if (await cache.match(key)) return;
            const full = await fetch(key, { credentials: 'same-origin' });
            if (full.status === 200) await cache.put(key, full);
          })().catch(() => undefined),
        );
      }
    } else if (res.status === 404 || res.status === 401) {
      void cache.delete(key);
    }
    return res;
  } catch (err) {
    const hit = await cache.match(key);
    if (!hit) throw err;
    return ranged(req, hit);
  }
}

async function ranged(req: Request, full: Response): Promise<Response> {
  const range = req.headers.get('range');
  if (!range) return full;
  const body = await full.arrayBuffer();
  const size = body.byteLength;
  const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!m || (!m[1] && !m[2])) return new Response(body, { status: 200, headers: full.headers });
  let start: number;
  let end: number;
  if (!m[1]) {
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  }
  if (start >= size || start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  const headers = new Headers(full.headers);
  headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
  headers.set('Content-Length', String(end - start + 1));
  headers.set('Accept-Ranges', 'bytes');
  return new Response(body.slice(start, end + 1), { status: 206, headers });
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}
