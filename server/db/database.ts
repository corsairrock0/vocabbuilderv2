// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export type SqlValue = string | number | bigint | null | Uint8Array;
export type Row = Record<string, any>;

/**
 * Thin synchronous wrapper around node:sqlite.
 * - WAL journal + synchronous=FULL: every committed transaction is durable on disk.
 * - Foreign keys enforced.
 * - `tx()` runs a function in BEGIN IMMEDIATE … COMMIT (nested calls use savepoints) and
 *   rolls back on any exception, so a failed request never leaves partial progress.
 */
export class Db {
  readonly file: string;
  sqlite: DatabaseSync;
  private stmts = new Map<string, StatementSync>();
  private depth = 0;
  private savepoint = 0;
  /** Incremented (in app_meta.revision) by mutating transactions; clients poll it for cross-device refresh. */
  private dirty = false;

  constructor(file: string) {
    this.file = file;
    if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
    this.sqlite = this.open();
  }

  private open(): DatabaseSync {
    const db = new DatabaseSync(this.file, { enableForeignKeyConstraints: true });
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA synchronous = FULL');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('PRAGMA busy_timeout = 5000');
    db.exec('PRAGMA temp_store = MEMORY');
    db.exec('PRAGMA cache_size = -16000');
    return db;
  }

  /** Re-open the database file (used after a restore replaced the file). */
  reopen(): void {
    this.close();
    this.sqlite = this.open();
  }

  close(): void {
    for (const s of this.stmts.values()) void s;
    this.stmts.clear();
    try {
      this.sqlite.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    } catch {
      /* ignore */
    }
    if (this.sqlite.isOpen) this.sqlite.close();
  }

  prepare(sql: string): StatementSync {
    let s = this.stmts.get(sql);
    if (!s) {
      s = this.sqlite.prepare(sql);
      this.stmts.set(sql, s);
    }
    return s;
  }

  get<T = Row>(sql: string, ...params: SqlValue[]): T | undefined {
    return this.prepare(sql).get(...params) as T | undefined;
  }

  all<T = Row>(sql: string, ...params: SqlValue[]): T[] {
    return this.prepare(sql).all(...params) as T[];
  }

  run(sql: string, ...params: SqlValue[]): { changes: number; lastInsertRowid: number } {
    const r = this.prepare(sql).run(...params);
    if (r.changes > 0) this.dirty = true;
    return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
  }

  exec(sql: string): void {
    this.sqlite.exec(sql);
  }

  get inTransaction(): boolean {
    return this.depth > 0;
  }

  tx<T>(fn: () => T): T {
    if (this.depth > 0) {
      const name = `sp${++this.savepoint}`;
      this.sqlite.exec(`SAVEPOINT ${name}`);
      this.depth++;
      try {
        const out = fn();
        this.sqlite.exec(`RELEASE ${name}`);
        return out;
      } catch (err) {
        this.sqlite.exec(`ROLLBACK TO ${name}`);
        this.sqlite.exec(`RELEASE ${name}`);
        throw err;
      } finally {
        this.depth--;
      }
    }
    this.sqlite.exec('BEGIN IMMEDIATE');
    this.depth = 1;
    this.dirty = false;
    try {
      const out = fn();
      if (out instanceof Promise) throw new Error('Db.tx callbacks must be synchronous');
      if (this.dirty) {
        this.sqlite
          .prepare("INSERT INTO app_meta(key, value) VALUES ('revision', '1') ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + 1")
          .run();
      }
      this.sqlite.exec('COMMIT');
      return out;
    } catch (err) {
      try {
        this.sqlite.exec('ROLLBACK');
      } catch {
        /* already rolled back */
      }
      throw err;
    } finally {
      this.depth = 0;
      this.dirty = false;
    }
  }

  meta(key: string): string | null {
    return this.get<{ value: string }>('SELECT value FROM app_meta WHERE key = ?', key)?.value ?? null;
  }

  setMeta(key: string, value: string): void {
    this.run('INSERT INTO app_meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value);
  }

  revision(): number {
    return Number(this.meta('revision') ?? 0);
  }
}

export function json<T>(text: string | null | undefined, fallback: T): T {
  if (text == null || text === '') return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}
