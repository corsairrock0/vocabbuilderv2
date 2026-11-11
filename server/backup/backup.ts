// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
/**
 * Database backups.
 *
 *  - Consistent snapshots with SQLite's online backup API (node:sqlite `backup()`), safe
 *    while the app is running and writing.
 *  - Every backup is integrity-checked (PRAGMA integrity_check) before it is kept.
 *  - gzip compression; optional AES-256-GCM encryption (key derived with scrypt from
 *    VB_BACKUP_PASSPHRASE) for copies that leave the server.
 *  - Sidecar metadata (.json) next to each file, so the backup list survives restores.
 *  - Grandfather-father-son retention for scheduled backups; optional copy to a second
 *    directory (another disk/NAS mount) for an independent copy.
 *  - Restore: verify → pre-restore backup → swap file → migrate → reopen (rolls back on failure).
 */
import { backup as sqliteBackup, DatabaseSync } from 'node:sqlite';
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import path from 'node:path';
import type { Config } from '../config.ts';
import { Db } from '../db/database.ts';
import { latestVersion, migrate, schemaVersion } from '../db/migrate.ts';
import { errorFields, log } from '../log.ts';
import { localDay, tzOffset } from '../../shared/time.ts';

export type BackupKind = 'scheduled' | 'manual' | 'pre-migration' | 'pre-restore' | 'pre-upgrade';

export interface BackupInfo {
  file: string;
  kind: BackupKind;
  createdAt: number;
  sizeBytes: number;
  sha256: string;
  encrypted: boolean;
  schemaVersion: number;
  appVersion: string;
  integrity: 'ok' | string;
  counts: Record<string, number>;
  offsiteCopiedAt: number | null;
  note: string | null;
}

const MAGIC = Buffer.from('VBK1');
const COUNT_TABLES = ['vocabulary_entries', 'learning_items', 'fsrs_cards', 'review_logs', 'exercise_attempts', 'study_sessions', 'user_settings', 'language_settings', 'entry_user_data'];

export function encryptBuffer(plain: Buffer, passphrase: string): Buffer {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(passphrase, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([MAGIC, Buffer.from([1]), salt, iv, cipher.getAuthTag(), enc]);
}

export function decryptBuffer(data: Buffer, passphrase: string): Buffer {
  if (!data.subarray(0, 4).equals(MAGIC)) throw new Error('Not an encrypted VocabBuilder backup');
  const salt = data.subarray(5, 21);
  const iv = data.subarray(21, 33);
  const tag = data.subarray(33, 49);
  const key = scryptSync(passphrase, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const d = createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  try {
    return Buffer.concat([d.update(data.subarray(49)), d.final()]);
  } catch {
    throw new Error('Wrong backup passphrase or corrupted backup file');
  }
}

const sha256File = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');

/** Backups contain the password hash and all learning data: owner read/write only. */
const PRIVATE = 0o600;
const writePrivate = (file: string, data: string | Buffer) => {
  writeFileSync(file, data, { mode: PRIVATE });
  chmodSync(file, PRIVATE); // mode is ignored when the file already exists
};
const copyPrivate = (from: string, to: string) => {
  copyFileSync(from, to);
  chmodSync(to, PRIVATE);
};

/** Remove a scratch SQLite database together with the -wal/-shm/-journal files SQLite may leave next to it. */
export function removeSqliteFile(file: string): void {
  for (const ext of ['', '-wal', '-shm', '-journal']) rmSync(file + ext, { force: true });
}

/** Any backup file name the service accepts, and the canonical `vocabbuilder-<UTC time>-<kind>` form it writes. */
const ANY_BACKUP = /^vocabbuilder-[\w.-]+\.sqlite(\.gz)?(\.enc)?$/;
const BACKUP_NAME = /^vocabbuilder-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)-([a-z-]+)\.sqlite(\.gz)?(\.enc)?$/;
function parseBackupName(name: string, fallbackTime: number): { createdAt: number; kind: BackupKind; encrypted: boolean } {
  const m = BACKUP_NAME.exec(name);
  const created = m ? Date.parse(m[1].replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, 'T$1:$2:$3.$4Z')) : NaN;
  return {
    createdAt: Number.isFinite(created) ? created : fallbackTime,
    kind: m && (KINDS as string[]).includes(m[2]) ? (m[2] as BackupKind) : 'manual',
    encrypted: name.endsWith('.enc'),
  };
}
const KINDS: BackupKind[] = ['scheduled', 'manual', 'pre-migration', 'pre-restore', 'pre-upgrade'];

export function inspectDatabaseFile(file: string): { integrity: string; schemaVersion: number; counts: Record<string, number> } {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const integrity = (db.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check;
    let version = 0;
    try {
      version = (db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as { v: number | null }).v ?? 0;
    } catch {
      version = 0;
    }
    const counts: Record<string, number> = {};
    for (const t of COUNT_TABLES) {
      try {
        counts[t] = (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
      } catch {
        counts[t] = -1;
      }
    }
    return { integrity, schemaVersion: version, counts };
  } finally {
    db.close();
  }
}

export class BackupService {
  private config: Config;
  private getDb: () => Db;
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<unknown> | null = null;
  timezone: () => string = () => 'UTC';

  constructor(config: Config, getDb: () => Db) {
    this.config = config;
    this.getDb = getDb;
  }

  get dir(): string {
    return this.config.backupDir;
  }

  private sidecar(file: string) {
    return path.join(this.dir, file.replace(/\.sqlite(\.gz)?(\.enc)?$/, '') + '.json');
  }

  /** All backups in the backup folder, newest first — including files copied in by hand without their .json metadata. */
  list(): BackupInfo[] {
    if (!existsSync(this.dir)) return [];
    const out: BackupInfo[] = [];
    const seen = new Set<string>();
    const files = readdirSync(this.dir);
    for (const f of files) {
      if (!f.endsWith('.json') || !f.startsWith('vocabbuilder-')) continue;
      try {
        const info = JSON.parse(readFileSync(path.join(this.dir, f), 'utf8')) as BackupInfo;
        if (existsSync(path.join(this.dir, info.file))) {
          out.push(info);
          seen.add(info.file);
        }
      } catch {
        /* unreadable metadata: the backup file itself is still listed below */
      }
    }
    for (const f of files) {
      if (seen.has(f) || !ANY_BACKUP.test(f)) continue;
      const st = statSync(path.join(this.dir, f));
      out.push({
        file: f,
        ...parseBackupName(f, st.mtimeMs),
        sizeBytes: st.size,
        sha256: '',
        schemaVersion: 0,
        appVersion: '',
        integrity: 'unverified',
        counts: {},
        offsiteCopiedAt: null,
        note: 'No metadata file next to this backup; run Test restore before relying on it.',
      });
    }
    return out.sort((a, b) => b.createdAt - a.createdAt);
  }

  resolve(file: string): string {
    const base = path.basename(file);
    if (base !== file || !/^vocabbuilder-[\w.-]+\.sqlite(\.gz)?(\.enc)?$/.test(base)) throw new Error('Invalid backup file name');
    const full = path.join(this.dir, base);
    if (!existsSync(full)) throw new Error(`Backup not found: ${base}`);
    return full;
  }

  /** Create, verify and store a backup. Serialised: concurrent calls wait for each other. */
  async create(kind: BackupKind, note: string | null = null): Promise<BackupInfo> {
    while (this.running) await this.running.catch(() => undefined);
    const job = this.createInner(kind, note);
    this.running = job;
    try {
      return await job;
    } finally {
      this.running = null;
    }
  }

  private async createInner(kind: BackupKind, note: string | null): Promise<BackupInfo> {
    mkdirSync(this.dir, { recursive: true });
    const now = Date.now();
    const stamp = new Date(now).toISOString().replace(/[:.]/g, '-');
    const base = `vocabbuilder-${stamp}-${kind}`;
    const tmp = path.join(this.dir, `.${base}.sqlite.tmp`);
    const db = this.getDb();
    try {
      await sqliteBackup(db.sqlite, tmp);
      const inspected = inspectDatabaseFile(tmp);
      if (inspected.integrity !== 'ok') throw new Error(`Backup failed integrity check: ${inspected.integrity}`);
      let data: Buffer = gzipSync(readFileSync(tmp), { level: 9 });
      const encrypted = !!this.config.backup.passphrase;
      if (encrypted) data = encryptBuffer(data, this.config.backup.passphrase!);
      const file = `${base}.sqlite.gz${encrypted ? '.enc' : ''}`;
      const full = path.join(this.dir, file);
      writePrivate(`${full}.part`, data);
      renameSync(`${full}.part`, full);
      const info: BackupInfo = {
        file,
        kind,
        createdAt: now,
        sizeBytes: data.length,
        sha256: createHash('sha256').update(data).digest('hex'),
        encrypted,
        schemaVersion: inspected.schemaVersion,
        appVersion: this.config.version,
        integrity: inspected.integrity,
        counts: inspected.counts,
        offsiteCopiedAt: null,
        note,
      };
      writePrivate(this.sidecar(file), JSON.stringify(info, null, 2));
      if (this.config.offsiteBackupDir) {
        try {
          mkdirSync(this.config.offsiteBackupDir, { recursive: true });
          const dest = path.join(this.config.offsiteBackupDir, file);
          copyPrivate(full, dest);
          if (sha256File(dest) !== info.sha256) throw new Error('offsite copy checksum mismatch');
          info.offsiteCopiedAt = Date.now();
          writePrivate(this.sidecar(file), JSON.stringify(info, null, 2));
          copyPrivate(this.sidecar(file), path.join(this.config.offsiteBackupDir, path.basename(this.sidecar(file))));
        } catch (err) {
          log.error('offsite backup copy failed', { file, ...errorFields(err) });
        }
      }
      log.info('backup created', { file, kind, bytes: info.sizeBytes, encrypted });
      if (kind === 'scheduled') this.rotate(now);
      return info;
    } finally {
      removeSqliteFile(tmp);
    }
  }

  /** Store an uploaded backup file after checking it opens and passes an integrity check. Never overwrites a backup. */
  importUploaded(name: string, data: Buffer, now = Date.now()): BackupInfo {
    if (!ANY_BACKUP.test(name)) throw new Error('Backup files are named vocabbuilder-<time>-<kind>.sqlite.gz (or .sqlite.gz.enc).');
    mkdirSync(this.dir, { recursive: true });
    const dest = path.join(this.dir, name);
    if (existsSync(dest)) throw new Error(`A backup named ${name} is already on the server.`);
    writePrivate(dest, data);
    const tmp = path.join(this.dir, `.upload-check-${now}.sqlite`);
    try {
      this.extract(dest, tmp);
      const inspected = inspectDatabaseFile(tmp);
      if (inspected.integrity !== 'ok') throw new Error(`integrity check failed: ${inspected.integrity}`);
      const info: BackupInfo = {
        file: name,
        ...parseBackupName(name, now),
        sizeBytes: data.length,
        sha256: createHash('sha256').update(data).digest('hex'),
        schemaVersion: inspected.schemaVersion,
        appVersion: 'uploaded',
        integrity: inspected.integrity,
        counts: inspected.counts,
        offsiteCopiedAt: null,
        note: 'Uploaded backup',
      };
      writePrivate(this.sidecar(name), JSON.stringify(info, null, 2));
      return info;
    } catch (err) {
      rmSync(dest, { force: true });
      throw err;
    } finally {
      removeSqliteFile(tmp);
    }
  }

  /** Decompress/decrypt a backup into a plain SQLite file. */
  extract(file: string, dest: string, passphrase = this.config.backup.passphrase): void {
    const full = path.isAbsolute(file) ? file : this.resolve(file);
    let data: Buffer = readFileSync(full);
    if (full.endsWith('.enc')) {
      if (!passphrase) throw new Error('This backup is encrypted: set VB_BACKUP_PASSPHRASE to restore it');
      data = decryptBuffer(data, passphrase);
    }
    if (full.endsWith('.gz') || full.endsWith('.gz.enc')) data = gunzipSync(data);
    writePrivate(dest, data);
  }

  verify(file: string): { ok: boolean; integrity: string; checksumOk: boolean | null; schemaVersion: number; counts: Record<string, number> } {
    const full = this.resolve(file);
    const info = this.list().find((b) => b.file === path.basename(full));
    const checksumOk = info?.sha256 ? sha256File(full) === info.sha256 : null;
    const tmp = path.join(this.dir, `.verify-${Date.now()}.sqlite`);
    try {
      this.extract(full, tmp);
      const r = inspectDatabaseFile(tmp);
      return { ok: r.integrity === 'ok' && checksumOk !== false, integrity: r.integrity, checksumOk, schemaVersion: r.schemaVersion, counts: r.counts };
    } finally {
      removeSqliteFile(tmp);
    }
  }

  /**
   * Restore a backup into the live database file. The caller must stop serving requests
   * (the server sets maintenance mode). A pre-restore backup of the current data is made first.
   */
  async restore(file: string, db: Db): Promise<{ restored: string; preRestore: BackupInfo; counts: Record<string, number> }> {
    const full = this.resolve(file);
    const dbFile = db.file;
    const staging = `${dbFile}.restore-${Date.now()}`;
    this.extract(full, staging);
    try {
      const inspected = inspectDatabaseFile(staging);
      if (inspected.integrity !== 'ok') throw new Error(`Backup integrity check failed: ${inspected.integrity}`);
      if (inspected.schemaVersion > latestVersion()) {
        throw new Error(`Backup schema ${inspected.schemaVersion} is newer than this application (${latestVersion()}); upgrade the app first.`);
      }
      const preRestore = await this.create('pre-restore', `Automatic backup before restoring ${path.basename(full)}`);
      const replaced = `${dbFile}.replaced-${Date.now()}`;
      db.close();
      try {
        renameSync(dbFile, replaced);
        for (const ext of ['-wal', '-shm']) rmSync(dbFile + ext, { force: true });
        renameSync(staging, dbFile);
        db.reopen();
        await migrate(db);
        signOutEverywhere(db);
        removeSqliteFile(replaced);
      } catch (err) {
        log.error('restore failed, rolling back', errorFields(err));
        try {
          if (db.sqlite.isOpen) db.close();
        } catch {
          /* ignore */
        }
        if (existsSync(replaced)) {
          rmSync(dbFile, { force: true });
          renameSync(replaced, dbFile);
        }
        db.reopen();
        throw err;
      }
      log.info('backup restored', { file: path.basename(full) });
      return { restored: path.basename(full), preRestore, counts: inspected.counts };
    } finally {
      removeSqliteFile(staging);
    }
  }

  /**
   * Last-resort restore when the live database cannot be opened (damaged file). No pre-restore backup is possible,
   * so the damaged file is kept beside it as `<db>.damaged-<time>`. Run with the app stopped.
   */
  async restoreOverDamaged(file: string, dbFile: string): Promise<{ restored: string; keptDamagedAs: string | null; counts: Record<string, number> }> {
    const full = this.resolve(file);
    const staging = `${dbFile}.restore-${Date.now()}`;
    this.extract(full, staging);
    try {
      const inspected = inspectDatabaseFile(staging);
      if (inspected.integrity !== 'ok') throw new Error(`Backup integrity check failed: ${inspected.integrity}`);
      if (inspected.schemaVersion > latestVersion()) throw new Error(`Backup schema ${inspected.schemaVersion} is newer than this application (${latestVersion()}).`);
      let kept: string | null = null;
      if (existsSync(dbFile)) {
        kept = `${dbFile}.damaged-${Date.now()}`;
        renameSync(dbFile, kept);
        for (const ext of ['-wal', '-shm']) if (existsSync(dbFile + ext)) renameSync(dbFile + ext, kept + ext);
      }
      renameSync(staging, dbFile);
      const db = new Db(dbFile);
      try {
        await migrate(db);
        signOutEverywhere(db);
      } finally {
        db.close();
      }
      log.info('backup restored over a damaged database', { file: path.basename(full), keptDamagedAs: kept });
      return { restored: path.basename(full), keptDamagedAs: kept, counts: inspected.counts };
    } finally {
      removeSqliteFile(staging);
    }
  }

  /** Restore into a scratch file and report counts — a recovery drill that never touches live data. */
  testRestore(file: string): { ok: boolean; integrity: string; schemaVersion: number; counts: Record<string, number>; reviewHistorySample: number } {
    const full = this.resolve(file);
    const tmp = path.join(this.dir, `.drill-${Date.now()}.sqlite`);
    try {
      this.extract(full, tmp);
      const r = inspectDatabaseFile(tmp);
      return { ok: r.integrity === 'ok', ...r, reviewHistorySample: r.counts.review_logs ?? 0 };
    } finally {
      removeSqliteFile(tmp);
    }
  }

  delete(file: string): void {
    const full = this.resolve(file);
    rmSync(full, { force: true });
    rmSync(this.sidecar(path.basename(full)), { force: true });
  }

  /** Grandfather-father-son retention for scheduled backups. Manual/pre-* backups keep the newest 20 of each kind. */
  rotate(now = Date.now()): string[] {
    const tz = this.timezone();
    const all = this.list();
    const keep = new Set<string>();
    const scheduled = all.filter((b) => b.kind === 'scheduled');
    const pick = (keyOf: (b: BackupInfo) => string, limit: number) => {
      const seen = new Set<string>();
      for (const b of scheduled) {
        const k = keyOf(b);
        if (seen.has(k)) continue;
        if (seen.size >= limit) break;
        seen.add(k);
        keep.add(b.file);
      }
    };
    const day = (b: BackupInfo) => localDay(b.createdAt, tz);
    pick(day, this.config.backup.keepDaily);
    pick((b) => {
      const d = new Date(day(b) + 'T00:00:00Z');
      const thursday = new Date(d);
      thursday.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7));
      const week1 = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4));
      const week = 1 + Math.round(((thursday.getTime() - week1.getTime()) / 86_400_000 - 3 + ((week1.getUTCDay() + 6) % 7)) / 7);
      return `${thursday.getUTCFullYear()}-W${week}`;
    }, this.config.backup.keepWeekly);
    pick((b) => day(b).slice(0, 7), this.config.backup.keepMonthly);
    for (const kind of ['manual', 'pre-migration', 'pre-restore', 'pre-upgrade'] as const) {
      all.filter((b) => b.kind === kind).slice(0, 20).forEach((b) => keep.add(b.file));
    }
    const removed: string[] = [];
    for (const b of all) {
      if (!keep.has(b.file)) {
        this.delete(b.file);
        removed.push(b.file);
      }
    }
    if (removed.length) log.info('backup rotation removed old backups', { count: removed.length });
    void now;
    return removed;
  }

  lastBackup(kind?: BackupKind): BackupInfo | null {
    return this.list().find((b) => !kind || b.kind === kind) ?? null;
  }

  /** Milliseconds until the next configured local backup time. */
  msUntilNext(now = Date.now()): number {
    const [h, m] = this.config.backup.time.split(':').map(Number);
    const tz = this.timezone();
    const offset = tzOffset(now, tz);
    const local = new Date(now + offset);
    const target = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), h || 0, m || 0) - offset;
    return target > now ? target - now : target + 86_400_000 - now;
  }

  startScheduler(): void {
    if (!this.config.backup.enabled) return;
    const schedule = () => {
      const wait = this.msUntilNext();
      this.timer = setTimeout(() => {
        this.create('scheduled').catch((err) => log.error('scheduled backup failed', errorFields(err))).finally(schedule);
      }, wait);
      this.timer.unref();
    };
    schedule();
    // Catch up if the last scheduled backup is older than 24 hours (e.g. server was off at backup time).
    const last = this.lastBackup('scheduled');
    if (!last || Date.now() - last.createdAt > 24 * 3600_000) {
      const t = setTimeout(() => this.create('scheduled').catch((err) => log.error('catch-up backup failed', errorFields(err))), 60_000);
      t.unref();
    }
  }

  stopScheduler(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  sizeOnDisk(): number {
    return this.list().reduce((s, b) => s + (existsSync(path.join(this.dir, b.file)) ? statSync(path.join(this.dir, b.file)).size : 0), 0);
  }
}

export { schemaVersion };

/** Sign-ins stored in a restored backup must not come back to life: every device signs in again after a restore. */
function signOutEverywhere(db: Db): void {
  db.tx(() => db.run('DELETE FROM auth_sessions'));
}
