// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { pipeFile } from './http.ts';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.webp': 'image/webp',
};

const NOT_BUILT = `<!doctype html><meta charset="utf-8"><title>VocabBuilder</title>
<body style="font-family:system-ui;max-width:40rem;margin:4rem auto;padding:0 1rem">
<h1>VocabBuilder server is running</h1><p>The web client has not been built yet. Run <code>npm run build</code> (or use the Docker image, which builds it automatically).</p></body>`;

/** Serve the built single-page app: hashed assets are immutable; HTML/service worker are always revalidated. */
export function serveStatic(staticDir: string, req: IncomingMessage, res: ServerResponse, pathname: string): void {
  let rel: string;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  const resolved = path.normalize(path.join(staticDir, rel));
  if (!resolved.startsWith(path.normalize(staticDir + path.sep)) && resolved !== path.normalize(staticDir)) {
    res.writeHead(403).end();
    return;
  }
  let file = resolved;
  let isFile = false;
  try {
    isFile = statSync(file).isFile();
  } catch {
    isFile = false;
  }
  if (!isFile) {
    const wantsHtml = String(req.headers.accept ?? '').includes('text/html') || !path.extname(rel);
    if (!wantsHtml || rel.startsWith('/assets/')) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
      return;
    }
    file = path.join(staticDir, 'index.html');
    if (!existsSync(file)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end(NOT_BUILT);
      return;
    }
  }
  const st = statSync(file);
  const ext = path.extname(file);
  const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
  const base = path.basename(file);
  // Hashed build chunks and the Identify pictures (named with a content hash) never change under the same name.
  const immutable = (rel.startsWith('/assets/') || rel.startsWith('/identify/')) && /-[A-Za-z0-9]{8,}\.\w+$/.test(base);
  const headers: Record<string, string> = {
    'Content-Type': TYPES[ext] ?? 'application/octet-stream',
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    ETag: etag,
  };
  if (base === 'sw.js') headers['Service-Worker-Allowed'] = '/';
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, headers).end();
    return;
  }
  headers['Content-Length'] = String(st.size);
  res.writeHead(200, headers);
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  pipeFile(createReadStream(file), res);
}
