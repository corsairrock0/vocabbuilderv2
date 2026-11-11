// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Schema migrations: fresh install, checksum protection, newer-schema refusal, pre-migration hook.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, cpSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Db } from '../../server/db/database.ts';
import { latestVersion, loadMigrations, migrate, migrationStatus, schemaVersion } from '../../server/db/migrate.ts';

const MIGRATIONS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'server', 'db', 'migrations');

test('a fresh database is migrated to the latest version with all core tables', async () => {
  const db = new Db(':memory:');
  const applied = await migrate(db);
  assert.deepEqual(applied, loadMigrations().map((m) => m.version));
  assert.equal(schemaVersion(db), latestVersion());
  const tables = new Set(db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'").map((r) => r.name));
  for (const t of ['vocabulary_entries', 'vocabulary_senses', 'vocabulary_forms', 'example_sentences', 'learning_items', 'fsrs_cards', 'review_logs',
    'exercise_attempts', 'skill_evidence', 'study_sessions', 'session_exercises', 'user_settings', 'language_settings', 'pronunciation_records',
    'speaker_profiles', 'import_jobs', 'idempotency_keys', 'daily_stats', 'auth_sessions', 'login_attempts']) {
    assert.ok(tables.has(t), `table ${t}`);
  }
  assert.equal(db.get<{ user_version: number }>('PRAGMA user_version')!.user_version, latestVersion());
  assert.equal(db.all('SELECT code FROM languages').length, 6);
  // Re-running is a no-op.
  assert.deepEqual(await migrate(db), []);
  // Foreign keys are enforced.
  assert.throws(() => db.run('INSERT INTO learning_items (entry_id, language_code, created_at, updated_at) VALUES (999, ?, 1, 1)', 'es'));
  db.close();
});

test('the one-review-per-card-per-day policy is enforced by the schema', async () => {
  const db = new Db(':memory:');
  await migrate(db);
  const idx = db.all<{ name: string; unique: number }>("SELECT name, \"unique\" FROM pragma_index_list('review_logs')");
  assert.ok(idx.some((i) => i.name === 'uq_reviews_card_day' && i.unique === 1));
  db.close();
});

test('a modified, already-applied migration is detected', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'vb-mig-'));
  try {
    cpSync(MIGRATIONS, dir, { recursive: true });
    const db = new Db(path.join(dir, 'test.sqlite'));
    await migrate(db, { migrations: loadMigrations(dir) });
    const file = path.join(dir, readdirSync(dir).find((f) => f.startsWith('0001'))!);
    writeFileSync(file, readFileSync(file, 'utf8') + '\n-- edited after release\n');
    assert.throws(() => migrationStatus(db, loadMigrations(dir)), /modified after it was applied/);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a database from a newer application version is refused with guidance', async () => {
  const db = new Db(':memory:');
  await migrate(db);
  db.run("INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (9999, '9999_future', 'x', 1)");
  assert.throws(() => migrationStatus(db), /newer than this application supports.*restore the pre-upgrade backup/s);
  await assert.rejects(migrate(db), /newer than this application/);
  db.close();
});

test('pending migrations on an existing database run the pre-migration hook first; fresh installs skip it', async () => {
  const base = loadMigrations();
  const db = new Db(':memory:');
  const calls: number[] = [];
  await migrate(db, { migrations: base, beforeApply: async (s) => void calls.push(s.current) });
  assert.equal(calls.length, 0, 'no backup needed for an empty database');
  const sql = 'CREATE TABLE extra_feature (id INTEGER PRIMARY KEY);';
  const next = { version: base[base.length - 1].version + 1, name: '9998_extra', sql, checksum: createHash('sha256').update(sql).digest('hex') };
  const applied = await migrate(db, { migrations: [...base, next], beforeApply: async (s) => void calls.push(s.current) });
  assert.deepEqual(calls, [latestVersion(base)]);
  assert.deepEqual(applied, [next.version]);
  db.close();
});

test('a failing migration is rolled back and leaves the schema version unchanged', async () => {
  const base = loadMigrations();
  const db = new Db(':memory:');
  await migrate(db, { migrations: base });
  const sql = 'CREATE TABLE half_done (id INTEGER); INSERT INTO no_such_table VALUES (1);';
  const bad = { version: 9997, name: '9997_bad', sql, checksum: createHash('sha256').update(sql).digest('hex') };
  await assert.rejects(migrate(db, { migrations: [...base, bad] }));
  assert.equal(schemaVersion(db), latestVersion(base));
  assert.equal(db.get("SELECT name FROM sqlite_master WHERE name = 'half_done'"), undefined);
  db.close();
});

test('a 1.7.0 database (migrations 0001–0005) gets the practice-day index of 0006 after a pre-migration backup, keeping its answers', async () => {
  const all = loadMigrations();
  const v170 = all.filter((m) => m.version <= 5);
  assert.deepEqual(v170.map((m) => m.version), [1, 2, 3, 4, 5]);
  const db = new Db(':memory:');
  await migrate(db, { migrations: v170 });
  db.run("INSERT INTO vocabulary_entries (id, language_code, lemma, lemma_key, pos, created_at, updated_at) VALUES (1, 'pl', 'dom', 'dom', 'noun', 1, 1)");
  db.run("INSERT INTO practice_attempts (op_id, language_code, mode, entry_id, cell, grade, answered_at, local_day, received_at) VALUES ('op-1', 'pl', 'forms', 1, 'gen|sg', 'correct', 5, '2026-11-01', 5)");
  const calls: number[] = [];
  const applied = await migrate(db, { migrations: all, beforeApply: async (s) => void calls.push(s.current) });
  assert.deepEqual(calls, [5], 'the pre-migration backup runs first');
  assert.ok(applied.includes(6));
  const idx = db.all<{ name: string }>("SELECT name FROM pragma_index_list('practice_attempts')").map((r) => r.name);
  assert.ok(idx.includes('idx_practice_lang_day'));
  assert.equal(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM practice_attempts')!.n, 1);
  const plan = db.all<{ detail: string }>("EXPLAIN QUERY PLAN SELECT local_day, COUNT(*) FROM practice_attempts WHERE language_code = 'pl' AND local_day >= '2026-10-01' GROUP BY local_day");
  assert.match(plan.map((p) => p.detail).join(' '), /COVERING INDEX idx_practice_lang_day/);
  db.close();
});
