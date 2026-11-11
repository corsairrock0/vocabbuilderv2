// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
import path from 'node:path';
import { LEGAL_DEFAULTS } from '../shared/legal.ts';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export interface Config {
  root: string;
  env: 'production' | 'development' | 'test';
  version: string;
  host: string;
  port: number;
  dataDir: string;
  dbFile: string;
  backupDir: string;
  offsiteBackupDir: string | null;
  staticDir: string;
  /** Reading comprehension passages, one <lang>.json per language (VB_READING_DIR; default data/reading). */
  readingDir: string;
  /** The exact cells of example sentences for grammar explanations, one <lang>.json per language (VB_GRAMMAR_DIR; default data/grammar). */
  grammarDir: string;
  /** Writing practice sentences, one <lang>.json per language (VB_WRITING_DIR; default data/writing). */
  writingDir: string;
  publicOrigin: string | null;
  cookieSecure: 'auto' | boolean;
  trustProxy: boolean;
  setupToken: string | null;
  sessionIdleDays: number;
  sessionMaxDays: number;
  forvo: { apiKey: string | null; apiBase: string; dailyLimit: number; timeoutMs: number };
  /** Legal details shown in the Terms of Service (VB_LEGAL_*); null when not configured. */
  legal: { name: string | null; email: string | null; address: string | null; governingLaw: string | null };
  backup: {
    enabled: boolean;
    time: string;
    keepDaily: number;
    keepWeekly: number;
    keepMonthly: number;
    passphrase: string | null;
  };
  maxUploadBytes: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  defaultTimezone: string;
}

function num(v: string | undefined, d: number): number {
  if (v == null || v === '') return d;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Invalid number in environment: ${v}`);
  return n;
}

/** A short display text from the environment, or null when unset or blank. */
function text(v: string | undefined, max: number): string | null {
  const t = (v ?? '').trim();
  return t ? t.slice(0, max) : null;
}

function bool(v: string | undefined, d: boolean): boolean {
  if (v == null || v === '') return d;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const mode = (env.NODE_ENV === 'production' ? 'production' : env.NODE_ENV === 'test' ? 'test' : 'development') as Config['env'];
  const version = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version as string;
  const dataDir = path.resolve(env.VB_DATA_DIR || path.join(root, 'storage', 'data'));
  const secure = env.VB_COOKIE_SECURE;
  const tz = env.VB_DEFAULT_TIMEZONE || env.TZ || 'UTC';
  return {
    root,
    env: mode,
    version,
    host: env.VB_HOST || '0.0.0.0',
    port: num(env.VB_PORT, 3000),
    dataDir,
    dbFile: path.join(dataDir, 'vocabbuilder.sqlite'),
    backupDir: path.resolve(env.VB_BACKUP_DIR || path.join(root, 'storage', 'backups')),
    offsiteBackupDir: env.VB_OFFSITE_BACKUP_DIR ? path.resolve(env.VB_OFFSITE_BACKUP_DIR) : null,
    staticDir: path.resolve(env.VB_STATIC_DIR || path.join(root, 'dist', 'web')),
    readingDir: path.resolve(env.VB_READING_DIR || path.join(root, 'data', 'reading')),
    grammarDir: path.resolve(env.VB_GRAMMAR_DIR || path.join(root, 'data', 'grammar')),
    writingDir: path.resolve(env.VB_WRITING_DIR || path.join(root, 'data', 'writing')),
    publicOrigin: env.VB_PUBLIC_ORIGIN ? env.VB_PUBLIC_ORIGIN.replace(/\/$/, '') : null,
    cookieSecure: secure == null || secure === '' || secure === 'auto' ? 'auto' : bool(secure, true),
    trustProxy: bool(env.VB_TRUST_PROXY, false),
    setupToken: env.VB_SETUP_TOKEN || null,
    sessionIdleDays: num(env.VB_SESSION_IDLE_DAYS, 30),
    sessionMaxDays: num(env.VB_SESSION_MAX_DAYS, 90),
    forvo: {
      apiKey: env.VB_FORVO_API_KEY || null,
      apiBase: (env.VB_FORVO_API_BASE || 'https://apifree.forvo.com').replace(/\/$/, ''),
      dailyLimit: num(env.VB_FORVO_DAILY_LIMIT, 500),
      timeoutMs: num(env.VB_FORVO_TIMEOUT_MS, 8000),
    },
    legal: {
      name: text(env.VB_LEGAL_NAME, 120) ?? LEGAL_DEFAULTS.name,
      email: text(env.VB_LEGAL_EMAIL, 200) ?? LEGAL_DEFAULTS.email,
      address: text(env.VB_LEGAL_ADDRESS, 300) ?? LEGAL_DEFAULTS.address,
      governingLaw: text(env.VB_LEGAL_GOVERNING_LAW, 120) ?? LEGAL_DEFAULTS.governingLaw,
    },
    backup: {
      enabled: bool(env.VB_BACKUPS_ENABLED, mode !== 'test'),
      time: env.VB_BACKUP_TIME || '03:30',
      keepDaily: num(env.VB_BACKUP_KEEP_DAILY, 14),
      keepWeekly: num(env.VB_BACKUP_KEEP_WEEKLY, 8),
      keepMonthly: num(env.VB_BACKUP_KEEP_MONTHLY, 12),
      passphrase: env.VB_BACKUP_PASSPHRASE || null,
    },
    maxUploadBytes: num(env.VB_MAX_UPLOAD_MB, 25) * 1024 * 1024,
    logLevel: (env.VB_LOG_LEVEL as Config['logLevel']) || (mode === 'test' ? 'warn' : 'info'),
    defaultTimezone: tz,
  };
}
