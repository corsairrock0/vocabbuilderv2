// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Audio endpoints without Forvo credentials (study still works), user recordings, speaker
// preferences, usage tracking, and data exports.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { Client, startTestServer, type TestServer } from '../helpers/harness.ts';
import { importFixture, runSession, startSession } from '../helpers/study.ts';

let srv: TestServer;
let c: Client;
let entryId: number;

before(async () => {
  srv = await startTestServer();
  c = new Client(srv.url);
  await c.setup();
  await importFixture(c, 'vi-mini.json', 'vi');
  entryId = srv.app.db.get<{ id: number }>("SELECT id FROM vocabulary_entries WHERE lemma = 'tiền'")!.id;
});
after(() => srv.cleanup());

test('without Forvo credentials the audio lookup says so and study continues without listening', async () => {
  const a = (await c.get(`/api/audio/${entryId}`)).body;
  assert.equal(a.status, 'not_configured');
  assert.deepEqual(a.sources, []);
  assert.equal(a.forvoPageUrl, `https://forvo.com/word/${encodeURIComponent('tiền')}/#vi`);
  assert.equal(a.tts.enabled, false);
  assert.deepEqual(a.tts.locales, ['vi-VN']);
  const s = await startSession(c, { language: 'vi', minutes: 20, newWords: 3 });
  assert.ok(!s.exercises.some((e: any) => ['listen_meaning', 'listen_choice', 'dictation', 'shadowing'].includes(e.kind)), 'no listening exercises without any audio source');
  assert.equal(s.meta.audioAvailable, false);
  const done = await runSession(c, s.id);
  assert.equal(done.status, 'completed');
});

test('enabling the device text-to-speech fallback is labelled and enables listening practice', async () => {
  await c.put('/api/languages/vi/settings', { ttsFallback: true });
  const a = (await c.get(`/api/audio/${entryId}`)).body;
  assert.equal(a.tts.enabled, true);
  const s = await startSession(c, { language: 'vi', minutes: 30, newWords: 3, replaceActive: true });
  assert.equal(s.meta.audioAvailable, true);
  assert.ok(s.exercises.some((e: any) => e.stage === 'E' || e.stage === 'G'));
  await c.post(`/api/sessions/${s.id}/complete`);
  await c.put('/api/languages/vi/settings', { ttsFallback: false });
});

test('user recordings: upload, play back, prefer, delete; unsupported formats rejected', async () => {
  const audio = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(2000, 7)]);
  const up = await c.post(`/api/audio/${entryId}/recordings`, audio, { 'Content-Type': 'audio/webm;codecs=opus' });
  assert.equal(up.status, 200, JSON.stringify(up.body));
  const recordId = up.body.recordId;
  const lookup = (await c.get(`/api/audio/${entryId}`)).body;
  assert.equal(lookup.status, 'ok');
  const mine = lookup.sources.find((s: any) => s.id === `rec:${recordId}`);
  assert.ok(mine);
  assert.equal(mine.kind, 'user');
  assert.match(mine.accentLabel, /Your uploaded recording — not a verified native recording/);
  const file = await fetch(`${srv.url}${mine.url}`, { headers: { Cookie: c.cookie } });
  assert.equal(file.status, 200);
  assert.equal(file.headers.get('content-type'), 'audio/webm');
  assert.deepEqual(Buffer.from(await file.arrayBuffer()), audio);
  assert.equal((await fetch(`${srv.url}${mine.url}`)).status, 401, 'recordings are private');
  // Byte ranges (Safari plays media only from servers that honour them).
  const part = await fetch(`${srv.url}${mine.url}`, { headers: { Cookie: c.cookie, Range: 'bytes=0-1' } });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('content-range'), `bytes 0-1/${audio.length}`);
  assert.deepEqual(Buffer.from(await part.arrayBuffer()), audio.subarray(0, 2));
  const tail = await fetch(`${srv.url}${mine.url}`, { headers: { Cookie: c.cookie, Range: 'bytes=-4' } });
  assert.equal(tail.status, 206);
  assert.deepEqual(Buffer.from(await tail.arrayBuffer()), audio.subarray(audio.length - 4));
  assert.equal((await fetch(`${srv.url}${mine.url}`, { headers: { Cookie: c.cookie, Range: `bytes=${audio.length}-` } })).status, 416);
  assert.equal((await c.post(`/api/audio/${entryId}/preferred`, { sourceId: `rec:${recordId}` })).status, 200);
  assert.equal((await c.get(`/api/audio/${entryId}`)).body.sources[0].preferred, true);
  assert.equal((await c.post(`/api/audio/${entryId}/preferred`, { sourceId: 'forvo:does-not-exist' })).status, 404);
  const bad = await c.post(`/api/audio/${entryId}/recordings`, Buffer.from('MZ executable'), { 'Content-Type': 'application/x-msdownload' });
  assert.equal(bad.status, 415);
  const tooSmall = await c.post(`/api/audio/${entryId}/recordings`, Buffer.from('x'), { 'Content-Type': 'audio/webm' });
  assert.equal(tooSmall.status, 422);
  const dir = path.join(srv.dataDir, 'audio');
  assert.equal(readdirSync(dir).length, 1, 'rejected uploads leave no files behind');
  // With a user recording, the planner may use listening exercises for that word.
  const del = await c.req('DELETE', `/api/audio/file/${recordId}`);
  assert.equal(del.status, 200);
  assert.equal(readdirSync(dir).length, 0);
  assert.equal((await c.get(`/api/audio/${entryId}`)).body.status, 'not_configured');
});

test('speaker preferences and accent verification by the owner are saved per language', async () => {
  const put = await c.put('/api/audio/speakers', { language: 'vi', speaker: 'saigon_speaker', preference: 'preferred', accentNote: 'Southern (Saigon)', verifiedByUser: true });
  assert.equal(put.status, 200);
  const list = (await c.get('/api/audio/speakers?lang=vi')).body;
  assert.equal(list.length, 1);
  assert.equal(list[0].accentNote, 'Southern (Saigon)');
  assert.equal(list[0].verifiedByUser, 1);
  assert.deepEqual((await c.get('/api/audio/speakers?lang=ru')).body, []);
  const bad = await c.put('/api/audio/speakers', { language: 'vi', speaker: 'x', preference: 'favourite' });
  assert.equal(bad.status, 422);
});

test('playback usage is counted toward the Forvo request quota', async () => {
  const r = await c.post('/api/audio/usage', { plays: 3 });
  assert.equal(r.status, 200);
  assert.equal(r.body.usage.audioPlays, 3);
  const u = (await c.get('/api/audio/usage')).body;
  assert.equal(u.audioPlays, 3);
  assert.equal(u.configured, false);
  assert.equal((await c.post('/api/audio/usage', { plays: 1000 })).status, 422);
});

test('vocabulary exports (CSV with BOM, JSON) and a full progress export', async () => {
  const csv = await fetch(`${srv.url}/api/export/vocabulary?lang=vi&format=csv`, { headers: { Cookie: c.cookie } });
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-disposition') ?? '', /attachment; filename="vocabbuilder-vi-vocabulary-\d{4}-\d{2}-\d{2}\.csv"/);
  const bytes = Buffer.from(await csv.arrayBuffer());
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'Excel-friendly UTF-8 BOM');
  const text = bytes.subarray(3).toString('utf8');
  assert.ok(text.startsWith('lemma,display,pos,glosses'), text.slice(0, 40));
  assert.ok(text.includes('tiền'));
  assert.ok(text.includes('"xe buýt"') || text.includes('xe buýt'));
  const json: any = await (await fetch(`${srv.url}/api/export/vocabulary?lang=vi`, { headers: { Cookie: c.cookie } })).json();
  assert.equal(json.format, 'vocabbuilder-v1', 'the JSON export is in the import format');
  assert.equal(json.entries.length, 8);
  const tien = json.entries.find((e: any) => e.lemma === 'tiền');
  assert.ok(tien.senses[0].gloss && Array.isArray(tien.senses[0].translations));
  assert.ok(json.entries.some((e: any) => e.examples.length && e.examples[0].translation));
  // Round trip: the export imports cleanly into a fresh server with identical content.
  const other = await startTestServer();
  try {
    const c2 = new Client(other.url);
    await c2.setup();
    const up = await c2.post('/api/import/upload?lang=vi&kind=vocabulary&filename=export.json', Buffer.from(JSON.stringify(json)), { 'Content-Type': 'application/octet-stream' });
    assert.equal(up.status, 200, JSON.stringify(up.body));
    const commit = await c2.post(`/api/import/${up.body.id}/commit`, { mapping: {}, options: {} });
    assert.equal(commit.status, 200, JSON.stringify(commit.body));
    const again: any = await (await fetch(`${other.url}/api/export/vocabulary?lang=vi`, { headers: { Cookie: c2.cookie } })).json();
    const strip = (d: any) => d.entries.map((e: any) => ({ ...e, frequencyRank: undefined }));
    assert.deepEqual(strip(again), strip(json));
  } finally {
    await other.cleanup();
  }
  const progress: any = await (await fetch(`${srv.url}/api/export/progress`, { headers: { Cookie: c.cookie } })).json();
  assert.equal(progress.format, 'vocabbuilder-progress-v1');
  for (const t of ['learning_items', 'fsrs_cards', 'review_logs', 'exercise_attempts', 'skill_evidence', 'study_sessions', 'user_settings', 'language_settings']) {
    assert.ok(Array.isArray(progress.data[t]), t);
  }
  assert.ok(progress.data.review_logs.length > 0);
  assert.ok(progress.data.study_sessions.every((s: any) => s.resources === undefined), 'large session snapshots are omitted');
  assert.ok(existsSync(srv.config.dbFile));
});
