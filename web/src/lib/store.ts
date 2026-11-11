// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
/** App-wide state: auth, bootstrap data, settings, toasts. Settings writes go through the offline outbox. */
import { useSyncExternalStore } from 'react';
import type { Bootstrap } from '../../../shared/types.ts';
import type { GlobalSettings, LanguageSettings } from '../../../shared/settings.ts';
import { GLOBAL_DEFAULTS } from '../../../shared/settings.ts';
import type { LanguageCode } from '../../../shared/languages.ts';
import { ApiError, get, setCsrf, setUnauthenticatedHandler } from './api.ts';
import { idb, kvGet, kvSet } from './idb.ts';
import { enqueue } from './outbox.ts';
import { setDisplayTimezone } from './format.ts';

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'good' | 'bad';
  action?: { label: string; run: () => void };
}

export interface AppState {
  auth: 'loading' | 'setup' | 'login' | 'ready';
  username: string | null;
  boot: Bootstrap | null;
  bootError: string | null;
  offlineData: boolean;
  toasts: Toast[];
}

let state: AppState = { auth: 'loading', username: null, boot: null, bootError: null, offlineData: false, toasts: [] };
const listeners = new Set<() => void>();

export function getState() {
  return state;
}

export function setState(patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)) {
  state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
  applyAppearance();
  for (const l of listeners) l();
}

export function useApp<T>(select: (s: AppState) => T): T {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => select(state),
  );
}

export function settings(): GlobalSettings {
  return state.boot?.settings ?? GLOBAL_DEFAULTS;
}

export function langSettings(code: LanguageCode): LanguageSettings | null {
  return state.boot?.languageSettings[code] ?? null;
}

export function activeLanguage(): LanguageCode {
  return settings().activeLanguage;
}

let toastId = 0;
export function toast(text: string, kind: Toast['kind'] = 'info', action?: Toast['action']) {
  const id = ++toastId;
  setState((s) => ({ toasts: [...s.toasts.slice(-2), { id, text, kind, action }] }));
  setTimeout(() => setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), action ? 8000 : 4500);
}

function applyAppearance() {
  const s = settings();
  const root = document.documentElement;
  const dark = s.theme === 'dark' || (s.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  root.classList.toggle('dark', dark);
  root.classList.toggle('high-contrast', s.highContrast);
  root.classList.toggle('reduce-motion', s.reducedMotion);
  root.style.setProperty('--font-scale', String(s.fontScale || 1));
  root.dataset.lang = s.activeLanguage;
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyAppearance);

setUnauthenticatedHandler(() => {
  if (state.auth === 'ready') setState({ auth: 'login' });
});

export async function checkAuth() {
  try {
    const st = await get<{ setupRequired: boolean; authenticated: boolean; user?: { username: string }; csrfToken?: string }>('/api/auth/status');
    if (st.setupRequired) return setState({ auth: 'setup' });
    if (!st.authenticated) return setState({ auth: 'login' });
    setCsrf(st.csrfToken);
    setState({ auth: 'ready', username: st.user!.username });
    await loadBootstrap();
  } catch (err) {
    // Offline start: use the last bootstrap cached on this device so cached sessions stay usable.
    const cached = await kvGet<Bootstrap>('bootstrap');
    if (cached && err instanceof ApiError && err.isNetwork) {
      setState({ auth: 'ready', username: cached.user.username, boot: cached, offlineData: true });
      setDisplayTimezone(cached.settings.timezone);
    } else {
      setState({ auth: 'login', bootError: err instanceof Error ? err.message : String(err) });
    }
  }
}

let loading: Promise<void> | null = null;
export function loadBootstrap(): Promise<void> {
  if (loading) return loading;
  loading = (async () => {
    try {
      const boot = await get<Bootstrap>('/api/bootstrap');
      setDisplayTimezone(boot.settings.timezone);
      setState({ boot, bootError: null, offlineData: false });
      lastRevision = boot.revision;
      await kvSet('bootstrap', boot);
      // First run on this device: record the browser timezone if the server still has the default.
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (boot.settings.timezone === 'UTC' && tz && tz !== 'UTC') void updateSettings({ timezone: tz });
    } catch (err) {
      if (err instanceof ApiError && err.isNetwork) setState({ offlineData: true });
      else setState({ bootError: err instanceof Error ? err.message : String(err) });
    } finally {
      loading = null;
    }
  })();
  return loading;
}

/** Optimistic settings update, saved through the outbox (works offline, last-writer-wins per key on the server). */
export async function updateSettings(patch: Partial<GlobalSettings>) {
  if (!state.boot) return;
  setState({ boot: { ...state.boot, settings: { ...state.boot.settings, ...patch } } });
  if (patch.timezone) setDisplayTimezone(patch.timezone);
  await enqueue(
    { method: 'PUT', url: `/api/settings?changedAt=${Date.now()}`, body: patch, label: 'Settings' },
    // The server keeps the newest change per setting; show what it kept.
    { onResult: (r: { settings?: GlobalSettings }) => r?.settings && state.boot && setState({ boot: { ...state.boot, settings: r.settings } }) },
  );
}

export async function updateLanguageSettings(code: LanguageCode, patch: Partial<LanguageSettings>) {
  if (!state.boot) return;
  setState({ boot: { ...state.boot, languageSettings: { ...state.boot.languageSettings, [code]: { ...state.boot.languageSettings[code], ...patch } } } });
  await enqueue(
    { method: 'PUT', url: `/api/languages/${code}/settings?changedAt=${Date.now()}`, body: patch, label: `${code.toUpperCase()} settings` },
    {
      onResult: (r: { rescheduled?: number; settings?: LanguageSettings }) => {
        if (r?.settings && state.boot) setState({ boot: { ...state.boot, languageSettings: { ...state.boot.languageSettings, [code]: r.settings } } });
        if (r?.rescheduled) toast(`Review schedule recalculated for ${r.rescheduled} cards.`, 'good');
      },
    },
  );
}

/** Show a language setting the server changed by itself (a reading level moved up); nothing is sent. */
export function setLocalLanguageSettings(code: LanguageCode, patch: Partial<LanguageSettings>) {
  if (!state.boot) return;
  setState({ boot: { ...state.boot, languageSettings: { ...state.boot.languageSettings, [code]: { ...state.boot.languageSettings[code], ...patch } } } });
}

export function setActiveLanguage(code: LanguageCode) {
  if (settings().activeLanguage !== code) void updateSettings({ activeLanguage: code });
}

let lastRevision = 0;
/** Cross-device freshness: poll the server revision while visible and refresh data when another device changed it. */
export function startRevisionPolling(isBusy: () => boolean) {
  const check = async () => {
    if (document.visibilityState !== 'visible' || state.auth !== 'ready') return;
    try {
      const r = await get<{ revision: number }>('/api/sync/state');
      if (r.revision !== lastRevision && !isBusy()) {
        lastRevision = r.revision;
        await loadBootstrap();
        window.dispatchEvent(new CustomEvent('vb:data-changed'));
      }
    } catch {
      /* offline — try later */
    }
  };
  setInterval(check, 30_000);
  document.addEventListener('visibilitychange', () => void check());
  window.addEventListener('online', () => void check());
}

export function noteRevision(rev: number) {
  lastRevision = rev;
}

/**
 * Remove what this device cached for offline use (dashboard data, downloaded sessions, your own recordings).
 * Unsynced changes in the outbox are kept: they belong to the owner and sync after the next sign-in.
 */
export async function clearDeviceData(): Promise<void> {
  try {
    await idb.delete('kv', 'bootstrap');
    await idb.clear('sessions');
  } catch {
    /* IndexedDB unavailable: nothing was cached */
  }
  try {
    navigator.serviceWorker?.controller?.postMessage({ type: 'CLEAR_USER_DATA' });
    if ('caches' in window) await caches.delete('vb-user-audio');
  } catch {
    /* no service worker or Cache Storage */
  }
}
