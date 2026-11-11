// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from './database.ts';
import { log } from '../log.ts';

export interface Migration {
  version: number;
  name: string;
  sql: string;
  checksum: string;
}

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

export function loadMigrations(dir = MIGRATIONS_DIR): Migration[] {
  return readdirSync(dir)
    .filter((f) => /^\d{4}_[\w-]+\.sql$/.test(f))
    .sort()
    .map((f) => {
      const sql = readFileSync(path.join(dir, f), 'utf8');
      return {
        version: Number(f.slice(0, 4)),
        name: f.replace(/\.sql$/, ''),
        sql,
        checksum: createHash('sha256').update(sql).digest('hex'),
      };
    });
}

function ensureTable(db: Db) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    checksum TEXT NOT NULL,
    applied_at INTEGER NOT NULL
  )`);
}

export function schemaVersion(db: Db): number {
  ensureTable(db);
  return db.get<{ v: number | null }>('SELECT MAX(version) AS v FROM schema_migrations')?.v ?? 0;
}

export function latestVersion(migrations = loadMigrations()): number {
  return migrations.length ? migrations[migrations.length - 1].version : 0;
}

export interface MigrationStatus {
  current: number;
  latest: number;
  pending: Migration[];
  hasData: boolean;
}

export function migrationStatus(db: Db, migrations = loadMigrations()): MigrationStatus {
  ensureTable(db);
  const applied = db.all<{ version: number; name: string; checksum: string }>('SELECT version, name, checksum FROM schema_migrations ORDER BY version');
  const known = new Map(migrations.map((m) => [m.version, m]));
  for (const a of applied) {
    const m = known.get(a.version);
    if (!m) {
      throw new Error(
        `Database schema version ${a.version} (${a.name}) is newer than this application supports (latest ${latestVersion(migrations)}). ` +
          'Upgrade the application, or restore the pre-upgrade backup to roll back.',
      );
    }
    if (m.checksum !== a.checksum) {
      throw new Error(`Migration ${a.name} was modified after it was applied (checksum mismatch). Never edit applied migrations; add a new one.`);
    }
  }
  const current = applied.length ? applied[applied.length - 1].version : 0;
  const pending = migrations.filter((m) => m.version > current);
  const hasData = current > 0;
  return { current, latest: latestVersion(migrations), pending, hasData };
}

/**
 * Apply pending migrations, each in its own transaction. When the database already holds
 * data, `beforeApply` runs first (the server passes a pre-migration backup) so an upgrade
 * can always be rolled back by restoring that backup.
 */
export async function migrate(
  db: Db,
  opts: { beforeApply?: (status: MigrationStatus) => Promise<void>; migrations?: Migration[] } = {},
): Promise<number[]> {
  const migrations = opts.migrations ?? loadMigrations();
  const status = migrationStatus(db, migrations);
  if (!status.pending.length) return [];
  if (status.hasData && opts.beforeApply) await opts.beforeApply(status);
  const applied: number[] = [];
  for (const m of status.pending) {
    db.tx(() => {
      db.exec(m.sql);
      db.run('INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)', m.version, m.name, m.checksum, Date.now());
    });
    db.exec(`PRAGMA user_version = ${m.version}`);
    applied.push(m.version);
    log.info('migration applied', { version: m.version, name: m.name });
  }
  const fk = db.all('PRAGMA foreign_key_check');
  if (fk.length) throw new Error(`Foreign key check failed after migration: ${JSON.stringify(fk.slice(0, 5))}`);
  return applied;
}
