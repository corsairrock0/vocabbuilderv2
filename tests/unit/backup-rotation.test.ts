// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Grandfather-father-son retention and backup scheduling arithmetic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig } from '../../server/config.ts';
import { BackupService, decryptBuffer, encryptBuffer, type BackupInfo } from '../../server/backup/backup.ts';

function fakeBackups(dir: string, dates: Array<{ iso: string; kind: BackupInfo['kind'] }>) {
  for (const { iso, kind } of dates) {
    const stamp = iso.replace(/[:.]/g, '-');
    const file = `vocabbuilder-${stamp}-${kind}.sqlite.gz`;
    writeFileSync(path.join(dir, file), 'x');
    const info: BackupInfo = { file, kind, createdAt: Date.parse(iso), sizeBytes: 1, sha256: '', encrypted: false, schemaVersion: 1, appVersion: 'test', integrity: 'ok', counts: {}, offsiteCopiedAt: null, note: null };
    writeFileSync(path.join(dir, file.replace('.sqlite.gz', '.json')), JSON.stringify(info));
  }
}

test('rotation keeps the newest daily, weekly and monthly backups and every recent manual one', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'vb-rot-'));
  try {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test', VB_BACKUP_DIR: dir, VB_BACKUP_KEEP_DAILY: '3', VB_BACKUP_KEEP_WEEKLY: '2', VB_BACKUP_KEEP_MONTHLY: '2' });
    const svc = new BackupService(config, () => null as any);
    const days: Array<{ iso: string; kind: BackupInfo['kind'] }> = [];
    for (let i = 0; i < 60; i++) days.push({ iso: new Date(Date.parse('2026-11-05T01:30:00Z') - i * 86_400_000).toISOString(), kind: 'scheduled' });
    days.push({ iso: '2026-01-15T10:00:00.000Z', kind: 'manual' });
    days.push({ iso: '2026-02-01T10:00:00.000Z', kind: 'pre-migration' });
    fakeBackups(dir, days);
    const removed = svc.rotate(Date.parse('2026-11-05T12:00:00Z'));
    const kept = svc.list().map((b) => b.file.slice(13, 23) + ':' + b.kind).sort();
    assert.deepEqual(kept, [
      '2026-01-15:manual',
      '2026-02-01:pre-migration',
      '2026-10-31:scheduled', // newest of October (monthly)
      '2026-11-01:scheduled', // newest of ISO week 44 (weekly)
      '2026-11-03:scheduled', // daily
      '2026-11-04:scheduled', // daily
      '2026-11-05:scheduled', // daily + week 45 + November
    ]);
    assert.equal(removed.length, 55);
    assert.equal(readdirSync(dir).length, 7 * 2, 'files and sidecars are removed together');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the next scheduled backup time is computed in the owner’s timezone', () => {
  const config = loadConfig({ ...process.env, NODE_ENV: 'test', VB_BACKUP_TIME: '03:30' });
  const svc = new BackupService(config, () => null as any);
  svc.timezone = () => 'Europe/Kyiv';
  const now = Date.parse('2026-11-05T12:00:00Z'); // 14:00 Kyiv
  assert.equal(now + svc.msUntilNext(now), Date.parse('2026-11-06T01:30:00Z'));
  const early = Date.parse('2026-11-05T00:00:00Z'); // 02:00 Kyiv
  assert.equal(early + svc.msUntilNext(early), Date.parse('2026-11-05T01:30:00Z'));
});

test('backup encryption uses authenticated encryption', () => {
  const plain = Buffer.from('review history');
  const enc = encryptBuffer(plain, 'pass phrase');
  assert.deepEqual(decryptBuffer(enc, 'pass phrase'), plain);
  const tampered = Buffer.from(enc);
  tampered[tampered.length - 1] ^= 0xff;
  assert.throws(() => decryptBuffer(tampered, 'pass phrase'), /Wrong backup passphrase or corrupted/);
  assert.throws(() => decryptBuffer(Buffer.from('plain gzip'), 'x'), /Not an encrypted/);
  assert.notDeepEqual(encryptBuffer(plain, 'pass phrase'), enc, 'random salt and IV per backup');
});
