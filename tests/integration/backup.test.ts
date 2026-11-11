// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Backups: create, list, verify, recovery drill, download, upload, encrypted round-trip,
// and an API restore that returns review history to the backed-up state.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, readdirSync, readFileSync, existsSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Client, startTestServer, type TestServer } from '../helpers/harness.ts';
import { importFixture, runSession, shiftHistory, startSession } from '../helpers/study.ts';

let srv: TestServer;
let owner: Client;

const reviewCount = (s: TestServer) => s.app.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM review_logs')!.n;

before(async () => {
  srv = await startTestServer();
  owner = new Client(srv.url);
  await owner.setup();
  await importFixture(owner, 'ru-mini.json', 'ru');
  await runSession(owner, (await startSession(owner, { language: 'ru', minutes: 30, newWords: 3 })).id);
  await owner.put('/api/languages/ru/settings', { accent: 'any' });
});
after(() => srv.cleanup());

let backupFile = '';
let reviewsAtBackup = 0;

test('a manual backup is consistent, integrity-checked and listed', async () => {
  reviewsAtBackup = reviewCount(srv);
  assert.ok(reviewsAtBackup >= 6);
  const r = await owner.post('/api/backups', { note: 'before experiment' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const info = r.body;
  backupFile = info.file;
  assert.match(info.file, /^vocabbuilder-\d{4}-\d{2}-\d{2}T[\d-]+Z-manual\.sqlite\.gz$/);
  assert.equal(info.integrity, 'ok');
  assert.equal(info.kind, 'manual');
  assert.equal(info.encrypted, false);
  assert.equal(info.counts.review_logs, reviewsAtBackup);
  assert.equal(info.counts.vocabulary_entries, 12);
  assert.ok(info.counts.language_settings >= 1, 'settings are included');
  assert.equal(info.note, 'before experiment');
  assert.ok(existsSync(path.join(srv.backupDir, info.file)));
  assert.ok(existsSync(path.join(srv.backupDir, info.file.replace('.sqlite.gz', '.json'))), 'sidecar metadata survives restores');
  const list = (await owner.get('/api/backups')).body;
  assert.equal(list.backups[0].file, info.file);
  assert.equal(list.settings.keepDaily, 14);
});

test('verification and a recovery drill confirm the backup can be restored', async () => {
  const v = await owner.post(`/api/backups/${backupFile}/verify`);
  assert.equal(v.status, 200);
  assert.equal(v.body.ok, true);
  assert.equal(v.body.checksumOk, true);
  assert.equal(v.body.integrity, 'ok');
  const drill = await owner.post(`/api/backups/${backupFile}/test-restore`);
  assert.equal(drill.body.ok, true);
  assert.equal(drill.body.counts.review_logs, reviewsAtBackup, 'review history is inside the backup');
  assert.equal(drill.body.reviewHistorySample, reviewsAtBackup);
  // A tampered file fails verification.
  const tampered = backupFile.replace('-manual', '-manual-copy');
  const bytes = readFileSync(path.join(srv.backupDir, backupFile));
  writeFileSync(path.join(srv.backupDir, tampered), bytes);
  writeFileSync(
    path.join(srv.backupDir, tampered.replace('.sqlite.gz', '.json')),
    JSON.stringify({ ...JSON.parse(readFileSync(path.join(srv.backupDir, backupFile.replace('.sqlite.gz', '.json')), 'utf8')), file: tampered, sha256: '0'.repeat(64) }),
  );
  const bad = await owner.post(`/api/backups/${tampered}/verify`);
  assert.equal(bad.body.ok, false);
  assert.equal(bad.body.checksumOk, false);
  await owner.req('DELETE', `/api/backups/${tampered}`);
});

test('backups can be downloaded and uploaded again; corrupt uploads are rejected', async () => {
  const res = await fetch(`${srv.url}/api/backups/${backupFile}/download`, { headers: { Cookie: owner.cookie } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition') ?? '', new RegExp(backupFile));
  const buf = Buffer.from(await res.arrayBuffer());
  assert.equal(buf[0], 0x1f);
  assert.equal(buf[1], 0x8b, 'gzip compressed');
  const uploadName = backupFile.replace('-manual', '-uploaded');
  const up = await owner.post(`/api/backups/upload?filename=${uploadName}`, buf, { 'Content-Type': 'application/octet-stream' });
  assert.equal(up.status, 200, JSON.stringify(up.body));
  assert.equal(up.body.counts.review_logs, reviewsAtBackup);
  const junk = await owner.post('/api/backups/upload?filename=vocabbuilder-junk.sqlite.gz', Buffer.from('not a backup at all'), { 'Content-Type': 'application/octet-stream' });
  assert.equal(junk.status, 422);
  assert.ok(!existsSync(path.join(srv.backupDir, 'vocabbuilder-junk.sqlite.gz')), 'rejected uploads are removed');
  assert.equal((await owner.post(`/api/backups/upload?filename=${uploadName}`, buf, { 'Content-Type': 'application/octet-stream' })).status, 409, 'an existing backup is never overwritten');
  assert.equal((await owner.post('/api/backups/upload?filename=../../etc/passwd', Buffer.from('x'))).status, 400);
  assert.equal((await owner.post('/api/backups/..%2F..%2Fsecret.sqlite.gz/verify')).status, 400);
  assert.equal((await owner.post('/api/backups/vocabbuilder-missing.sqlite.gz/verify')).status, 404);
});

test('restore returns review history to the backed-up state; a pre-restore backup keeps the newer data', async () => {
  shiftHistory(srv.app.db, 3);
  await runSession(owner, (await startSession(owner, { language: 'ru', mode: 'review', minutes: 20 })).id);
  await owner.put('/api/languages/ru/settings', { accent: 'ru-RU' });
  const reviewsNow = reviewCount(srv);
  assert.ok(reviewsNow > reviewsAtBackup);
  const laterDevice = new Client(srv.url);
  await laterDevice.login();
  assert.equal((await owner.post(`/api/backups/${backupFile}/restore`, {})).status, 422, 'explicit confirmation is required');
  const r = await owner.post(`/api/backups/${backupFile}/restore`, { confirm: 'RESTORE' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.signInAgain, true);
  assert.equal(r.body.preRestore.kind, 'pre-restore');
  assert.equal(r.body.preRestore.counts.review_logs, reviewsNow);
  assert.equal(reviewCount(srv), reviewsAtBackup);
  assert.equal(srv.app.db.get<{ integrity_check: string }>('PRAGMA integrity_check')!.integrity_check, 'ok');
  // Every device signs in again after a restore: sign-ins stored inside the backup are not revived.
  assert.equal((await laterDevice.get('/api/bootstrap')).status, 401);
  assert.equal((await owner.get('/api/bootstrap')).status, 401, 'sign-ins from the backup are cleared too');
  await owner.login();
  assert.equal((await owner.get('/api/bootstrap')).status, 200);
  const settings = (await owner.get('/api/settings')).body;
  assert.equal(settings.languageSettings.ru.accent, 'any', 'settings are restored too');
  const kinds = (await owner.get('/api/backups')).body.backups.map((b: any) => b.kind);
  assert.ok(kinds.includes('pre-restore'));
  // Restoring the pre-restore backup brings the newer history back (rollback of the restore).
  const rollback = await owner.post(`/api/backups/${r.body.preRestore.file}/restore`, { confirm: 'RESTORE' });
  assert.equal(rollback.status, 200);
  assert.equal(reviewCount(srv), reviewsNow);
  await owner.login();
});

test('the server answers 503 (not partial data) while a restore is running', async () => {
  srv.app.maintenance = { active: true, reason: 'Restoring a backup' };
  try {
    const r = await owner.get('/api/bootstrap');
    assert.equal(r.status, 503);
    assert.equal(r.headers.get('retry-after'), '5');
    const h = await fetch(`${srv.url}/healthz`);
    assert.equal(h.status, 503);
  } finally {
    srv.app.maintenance = { active: false, reason: null };
  }
  assert.equal((await fetch(`${srv.url}/healthz`)).status, 200);
});

test('encrypted backups round-trip and reject a wrong passphrase', async () => {
  const enc = await startTestServer({ env: { VB_BACKUP_PASSPHRASE: 'correct horse battery staple' } });
  try {
    const c = new Client(enc.url);
    await c.setup();
    await importFixture(c, 'es-mini.json', 'es');
    const r = await c.post('/api/backups', {});
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.encrypted, true);
    assert.match(r.body.file, /\.sqlite\.gz\.enc$/);
    const raw = readFileSync(path.join(enc.backupDir, r.body.file));
    assert.equal(raw.subarray(0, 4).toString(), 'VBK1');
    assert.equal(raw.indexOf(Buffer.from('dónde')), -1, 'no plaintext vocabulary in the encrypted file');
    assert.equal((await c.post(`/api/backups/${r.body.file}/verify`)).body.ok, true);
    assert.equal((await c.post(`/api/backups/${r.body.file}/test-restore`)).body.counts.vocabulary_entries, 8);
    assert.throws(() => enc.app.backups.extract(r.body.file, path.join(enc.backupDir, 'x.sqlite'), 'wrong passphrase'), /Wrong backup passphrase/);
    assert.throws(() => enc.app.backups.extract(r.body.file, path.join(enc.backupDir, 'y.sqlite'), null), /encrypted/);
  } finally {
    await enc.cleanup();
  }
});

test('an offsite directory receives an independent, checksum-verified copy', async () => {
  const off = await startTestServer({ env: { VB_OFFSITE_BACKUP_DIR: path.join(srv.backupDir, '..', 'offsite') } });
  try {
    const c = new Client(off.url);
    await c.setup();
    const r = await c.post('/api/backups', {});
    assert.ok(r.body.offsiteCopiedAt);
    const copy = path.join(off.config.offsiteBackupDir!, r.body.file);
    assert.ok(existsSync(copy));
    assert.deepEqual(readFileSync(copy), readFileSync(path.join(off.backupDir, r.body.file)));
  } finally {
    await off.cleanup();
  }
});

test('backup files are owner-only, leave no scratch files behind, and hand-copied backups without metadata are listed', async () => {
  const r = await owner.post('/api/backups', { note: 'permissions' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const file: string = r.body.file;
  assert.equal(statSync(path.join(srv.backupDir, file)).mode & 0o777, 0o600);
  assert.equal(statSync(path.join(srv.backupDir, file.replace(/\.sqlite.*$/, '.json'))).mode & 0o777, 0o600);
  await owner.post(`/api/backups/${file}/verify`);
  await owner.post(`/api/backups/${file}/test-restore`);
  const leftovers = readdirSync(srv.backupDir).filter((f) => f.startsWith('.') || /-(wal|shm|journal)$/.test(f));
  assert.deepEqual(leftovers, [], 'no temporary databases or WAL files remain');
  const dataLeftovers = readdirSync(path.dirname(srv.app.db.file)).filter((f) => /\.(restore|replaced)-/.test(f));
  assert.deepEqual(dataLeftovers, [], 'no restore staging files remain in the data folder');

  const copy = file.replace(/-manual\./, '-handcopied.');
  copyFileSync(path.join(srv.backupDir, file), path.join(srv.backupDir, copy));
  const listed = (await owner.get('/api/backups')).body.backups.find((b: any) => b.file === copy);
  assert.ok(listed, 'a backup without its .json file is still listed');
  assert.equal(listed.integrity, 'unverified');
  assert.equal(listed.createdAt, r.body.createdAt, 'the time is read from the file name');
  const drill = await owner.post(`/api/backups/${copy}/test-restore`);
  assert.equal(drill.body.ok, true);
  assert.equal((await owner.post(`/api/backups/${copy}/verify`)).body.checksumOk, null, 'no recorded checksum to compare');
});
