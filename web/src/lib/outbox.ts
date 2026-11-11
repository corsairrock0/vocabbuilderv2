// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
/**
 * Durable offline queue for learning events and other writes.
 *
 * Every write is first stored in IndexedDB, then sent with an Idempotency-Key equal to its
 * operation id. Network failures leave the operation queued (retried with backoff and when
 * the browser comes back online). Server validation failures move it to "failed" where it
 * stays visible until the learner retries, exports or discards it — nothing is dropped silently.
 */
import { api, ApiError, hasCsrf, refreshCsrf, uuid } from './api.ts';
import { idb } from './idb.ts';

export interface QueuedOp {
  id: string;
  method: 'POST' | 'PUT' | 'DELETE';
  url: string;
  body: unknown;
  label: string;
  sessionId?: string;
  createdAt: number;
  status: 'pending' | 'failed';
  attempts: number;
  lastError?: string;
}

export interface SyncStatus {
  state: 'saved' | 'saving' | 'offline' | 'error' | 'unavailable';
  pending: number;
  failed: number;
  lastSyncedAt: number | null;
  message: string | null;
  /** Unsent changes live only in memory (device storage full or unavailable): closing the app would lose them. */
  volatile: boolean;
}

let status: SyncStatus = { state: 'saved', pending: 0, failed: 0, lastSyncedAt: null, message: null, volatile: false };
const listeners = new Set<() => void>();
const resultHandlers = new Map<string, Array<(result: unknown) => void>>();
const errorHandlers = new Map<string, Array<(err: ApiError) => void>>();
let memoryQueue: QueuedOp[] | null = null; // fallback when IndexedDB is unavailable
let flushing: Promise<void> | null = null;
let flushAgain = false; // something was queued while a flush was running
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let backoffIndex = 0;
const BACKOFF = [2000, 5000, 15000, 30000, 60000];

function emit() {
  for (const l of listeners) l();
}

export function subscribeSync(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getSyncStatus(): SyncStatus {
  return status;
}

function setStatus(patch: Partial<SyncStatus>) {
  status = { ...status, ...patch };
  emit();
}

async function all(): Promise<QueuedOp[]> {
  if (memoryQueue) return [...memoryQueue];
  try {
    const ops = await idb.getAll<QueuedOp>('outbox');
    return ops.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  } catch {
    memoryQueue = [];
    setStatus({ state: 'unavailable', message: 'This browser cannot store offline data; changes are sent immediately.' });
    return [];
  }
}

async function save(op: QueuedOp) {
  if (memoryQueue) {
    const i = memoryQueue.findIndex((o) => o.id === op.id);
    if (i >= 0) memoryQueue[i] = op;
    else memoryQueue.push(op);
    return;
  }
  try {
    await idb.put('outbox', op);
  } catch {
    // Storage full or blocked: keep every queued change in memory so it is still sent, and say so.
    const stored = await idb.getAll<QueuedOp>('outbox').catch(() => [] as QueuedOp[]);
    memoryQueue = [...stored.filter((o) => o.id !== op.id), op].sort((a, b) => a.createdAt - b.createdAt);
    setStatus({ state: 'unavailable', message: 'This device’s storage is full, so unsent changes are only kept in memory. Keep the app open until they are saved.' });
  }
}

async function remove(id: string) {
  if (memoryQueue) memoryQueue = memoryQueue.filter((o) => o.id !== id);
  else await idb.delete('outbox', id);
}

async function refreshCounts() {
  const ops = await all();
  const pending = ops.filter((o) => o.status === 'pending').length;
  const failed = ops.filter((o) => o.status === 'failed').length;
  setStatus({
    pending,
    failed,
    volatile: memoryQueue !== null && pending + failed > 0,
    state: failed ? 'error' : pending ? (navigator.onLine ? 'saving' : 'offline') : status.state === 'unavailable' ? 'unavailable' : 'saved',
  });
}

/** Queue a write. Resolves once it is durably stored on this device (not when the server confirms). */
export async function enqueue(op: { method: QueuedOp['method']; url: string; body?: unknown; label: string; sessionId?: string; id?: string }, handlers?: { onResult?: (r: any) => void; onError?: (e: ApiError) => void }): Promise<string> {
  const id = op.id ?? uuid();
  if (handlers?.onResult) resultHandlers.set(id, [...(resultHandlers.get(id) ?? []), handlers.onResult]);
  if (handlers?.onError) errorHandlers.set(id, [...(errorHandlers.get(id) ?? []), handlers.onError]);
  await save({ id, method: op.method, url: op.url, body: op.body ?? {}, label: op.label, sessionId: op.sessionId, createdAt: Date.now() + Math.random() / 1000, status: 'pending', attempts: 0 });
  await refreshCounts();
  if (flushing) flushAgain = true;
  void flush();
  return id;
}

function scheduleRetry() {
  if (retryTimer) return;
  const delay = BACKOFF[Math.min(backoffIndex, BACKOFF.length - 1)];
  backoffIndex++;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void flush();
  }, delay);
}

/** Send queued operations in order. Safe to call repeatedly. */
export function flush(): Promise<void> {
  if (flushing) return flushing;
  flushing = (async () => {
    try {
      const ops = (await all()).filter((o) => o.status === 'pending');
      if (!ops.length) {
        await refreshCounts();
        return;
      }
      setStatus({ state: 'saving' });
      // After an offline start the CSRF token is unknown: fetch it before sending anything.
      if (!hasCsrf()) {
        try {
          if ((await refreshCsrf()) === 'signed_out') {
            setStatus({ message: 'Sign in again to finish syncing.' });
            return;
          }
        } catch {
          setStatus({ state: 'offline' });
          scheduleRetry();
          return;
        }
      }
      let csrfRetried = false;
      for (let i = 0; i < ops.length; i++) {
        const op = ops[i];
        try {
          const result = await api(op.method, op.url, op.body, { idempotencyKey: op.id });
          await remove(op.id);
          backoffIndex = 0;
          setStatus({ lastSyncedAt: Date.now(), message: null });
          for (const h of resultHandlers.get(op.id) ?? []) h(result);
          resultHandlers.delete(op.id);
          errorHandlers.delete(op.id);
        } catch (err) {
          const e = err instanceof ApiError ? err : new ApiError(0, 'network', String(err));
          if (e.status === 403 && e.code === 'csrf_failed' && !csrfRetried) {
            // The token changed (new sign-in elsewhere, server restore): refresh it and resend this change.
            csrfRetried = true;
            const r = await refreshCsrf().catch(() => 'offline' as const);
            if (r === 'ok') {
              i--;
              continue;
            }
            await save({ ...op, attempts: op.attempts + 1, lastError: e.message });
            setStatus({ message: r === 'signed_out' ? 'Sign in again to finish syncing.' : e.message });
            if (r === 'offline') scheduleRetry();
            break;
          }
          if (e.retryable || e.status === 401 || (e.status === 403 && e.code === 'csrf_failed')) {
            await save({ ...op, attempts: op.attempts + 1, lastError: e.message });
            setStatus({ state: e.status === 0 ? 'offline' : 'saving', message: e.status === 401 ? 'Sign in again to finish syncing.' : e.message });
            if (e.status !== 401) scheduleRetry();
            break; // keep order: later operations wait for this one
          }
          // Permanent rejection: keep it visible as failed; continue with the rest.
          await save({ ...op, status: 'failed', attempts: op.attempts + 1, lastError: `${e.message} (${e.code})` });
          for (const h of errorHandlers.get(op.id) ?? []) h(e);
          errorHandlers.delete(op.id);
        }
      }
    } finally {
      await refreshCounts();
      flushing = null;
      if (flushAgain) {
        flushAgain = false;
        void flush();
      }
    }
  })();
  return flushing;
}

export async function listQueue(): Promise<QueuedOp[]> {
  return all();
}

export async function retryFailed() {
  for (const op of await all()) if (op.status === 'failed') await save({ ...op, status: 'pending' });
  await refreshCounts();
  backoffIndex = 0;
  if (flushing) flushAgain = true; // a send already in progress took its list before these were reset
  return flush();
}

export async function discardOp(id: string) {
  await remove(id);
  await refreshCounts();
}

export async function pendingForSession(sessionId: string): Promise<QueuedOp[]> {
  return (await all()).filter((o) => o.sessionId === sessionId);
}

export function startSyncLoop() {
  window.addEventListener('online', () => {
    backoffIndex = 0;
    void flush();
  });
  window.addEventListener('offline', () => void refreshCounts());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void flush();
  });
  void refreshCounts().then(() => flush());
}
