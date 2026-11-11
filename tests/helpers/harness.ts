// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
import './env.ts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadConfig, type Config } from '../../server/config.ts';
import { startServer, type RunningServer } from '../../server/main.ts';

export interface TestServer extends RunningServer {
  dataDir: string;
  backupDir: string;
  config: Config;
  restart(): Promise<TestServer>;
  cleanup(): Promise<void>;
}

export async function startTestServer(opts: { root?: string; env?: Record<string, string> } = {}): Promise<TestServer> {
  const root = opts.root ?? mkdtempSync(path.join(tmpdir(), 'vb-test-'));
  const dataDir = path.join(root, 'data');
  const backupDir = path.join(root, 'backups');
  const config = loadConfig({
    ...process.env,
    NODE_ENV: 'test',
    VB_DATA_DIR: dataDir,
    VB_BACKUP_DIR: backupDir,
    VB_PORT: '0',
    VB_HOST: '127.0.0.1',
    VB_SETUP_TOKEN: 'TEST-SETUP-TOKEN',
    VB_LOG_LEVEL: 'error',
    VB_BACKUPS_ENABLED: 'false',
    VB_FORVO_API_KEY: '',
    VB_LEGAL_NAME: '',
    VB_LEGAL_EMAIL: '',
    VB_LEGAL_ADDRESS: '',
    VB_LEGAL_GOVERNING_LAW: '',
    // No Writing sentences unless a test brings its own (tests/integration/writing.test.ts): the shipped sentences grow
    // with every batch, and Writing slots take time from a Comprehensive session's exercises.
    VB_WRITING_DIR: path.join(root, 'no-writing'),
    ...opts.env,
  });
  const running = await startServer(config);
  const ts: TestServer = {
    ...running,
    dataDir,
    backupDir,
    config,
    async restart() {
      await running.stop();
      return startTestServer({ root, env: opts.env });
    },
    async cleanup() {
      await running.stop();
      rmSync(root, { recursive: true, force: true });
    },
  };
  return ts;
}

export interface Res<T = any> {
  status: number;
  body: T;
  headers: Headers;
}

/** A browser-like API client: cookie jar, CSRF header, device id, idempotency keys. */
export class Client {
  url: string;
  cookie = '';
  csrf = '';
  deviceId: string;
  constructor(url: string, deviceId = `dev-${randomUUID().slice(0, 12)}`) {
    this.url = url;
    this.deviceId = deviceId;
  }

  async req<T = any>(method: string, p: string, body?: unknown, extra: Record<string, string> = {}): Promise<Res<T>> {
    const headers: Record<string, string> = { 'X-Device-Id': this.deviceId, ...extra };
    if (this.cookie) headers.Cookie = this.cookie;
    if (method !== 'GET' && this.csrf) headers['X-CSRF-Token'] = this.csrf;
    let payload: string | Uint8Array | undefined;
    if (body instanceof Uint8Array || typeof body === 'string') payload = body as string | Uint8Array;
    else if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetch(this.url + p, { method, headers, body: payload });
    const set = res.headers.getSetCookie?.() ?? [];
    for (const c of set) {
      const [pair] = c.split(';');
      const [name, value] = pair.split('=');
      if (name === 'vb_session') this.cookie = value ? `vb_session=${value}` : '';
    }
    const text = await res.text();
    let parsed: any = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      /* raw */
    }
    if (parsed && typeof parsed === 'object' && parsed.csrfToken) this.csrf = parsed.csrfToken;
    return { status: res.status, body: parsed, headers: res.headers };
  }

  get<T = any>(p: string) {
    return this.req<T>('GET', p);
  }
  post<T = any>(p: string, body?: unknown, headers?: Record<string, string>) {
    return this.req<T>('POST', p, body, headers);
  }
  put<T = any>(p: string, body?: unknown) {
    return this.req<T>('PUT', p, body);
  }

  async setup(username = 'owner', password = 'correct horse battery staple') {
    const r = await this.post('/api/auth/setup', { setupToken: 'TEST-SETUP-TOKEN', username, password, timezone: 'Europe/Kyiv', acceptTerms: true });
    if (r.status !== 200) throw new Error(`setup failed: ${r.status} ${JSON.stringify(r.body)}`);
    return r;
  }

  async login(username = 'owner', password = 'correct horse battery staple') {
    const r = await this.post('/api/auth/login', { username, password });
    if (r.status !== 200) throw new Error(`login failed: ${r.status} ${JSON.stringify(r.body)}`);
    return r;
  }
}

export const FIXTURE = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'fixtures');

/** Answer an exercise correctly using its payload (what an attentive learner would do). */
export function correctAnswer(ex: any, items: Record<string, any>): Record<string, unknown> {
  const p = ex.payload;
  switch (ex.kind) {
    case 'intro':
      return {};
    case 'meaning_choice':
    case 'word_choice':
    case 'cloze_choice':
    case 'context_meaning':
    case 'listen_meaning':
    case 'listen_choice':
    case 'picture_choice':
      return { choiceId: p.correctId };
    case 'meaning_typed':
    case 'recall_typed':
    case 'cloze_typed':
    case 'form_typed':
    case 'dictation':
      return { response: p.answer.accepted[0] };
    case 'speak_flashcard':
    case 'sentence_create':
    case 'shadowing':
      return { selfRating: 3 };
    default:
      void items;
      return {};
  }
}

export function wrongAnswer(ex: any): Record<string, unknown> {
  const p = ex.payload;
  if (p.options) return { choiceId: p.options.find((o: any) => o.id !== p.correctId)?.id ?? 'z' };
  if (p.answer) return { response: 'zzzz wrong' };
  return { selfRating: 1 };
}

export function nextPending(session: any) {
  return session.exercises.filter((e: any) => e.status === 'pending').sort((a: any, b: any) => a.seq - b.seq)[0];
}
