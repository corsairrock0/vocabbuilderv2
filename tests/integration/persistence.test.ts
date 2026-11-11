// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Restarting the server (or replacing the container) must not lose any learning progress.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { Client, nextPending, startTestServer, type TestServer } from '../helpers/harness.ts';
import { answer, importFixture, runSession, startSession } from '../helpers/study.ts';

let srv: TestServer;
after(() => srv?.cleanup());

const COUNT_TABLES = ['vocabulary_entries', 'learning_items', 'fsrs_cards', 'review_logs', 'exercise_attempts', 'skill_evidence', 'study_sessions', 'session_exercises', 'user_settings', 'language_settings', 'daily_stats'];

function snapshot(s: TestServer) {
  const out: Record<string, number> = {};
  for (const t of COUNT_TABLES) out[t] = s.app.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t}`)!.n;
  return out;
}

test('progress, schedules, settings, sessions and sign-in survive a server restart', async () => {
  srv = await startTestServer();
  const c = new Client(srv.url);
  await c.setup();
  await importFixture(c, 'ru-mini.json', 'ru');
  const done = await runSession(c, (await startSession(c, { language: 'ru', minutes: 30, newWords: 3 })).id);
  assert.equal(done.status, 'completed');
  await c.put('/api/languages/ru/settings', { accent: 'any', desiredRetention: 0.93 });
  await c.put('/api/settings', { theme: 'dark', timezone: 'Europe/Kyiv' });
  // Leave an unfinished session behind, as if the server stopped mid-session.
  const open = await startSession(c, { language: 'ru', minutes: 20, newWords: 2 });
  await answer(c, open.id, nextPending(open), {}, open.items);
  await answer(c, open.id, nextPending((await c.get(`/api/sessions/${open.id}`)).body), {}, open.items);

  const before = snapshot(srv);
  const entryId = (await c.get('/api/vocab?lang=ru&status=learning&limit=1')).body.items[0].entryId;
  const detailBefore = (await c.get(`/api/vocab/${entryId}`)).body;
  const settingsBefore = (await c.get('/api/settings')).body;

  srv = await srv.restart();
  c.url = srv.url;

  assert.deepEqual(snapshot(srv), before, 'every table keeps its rows');
  const boot = await c.get('/api/bootstrap');
  assert.equal(boot.status, 200, 'the existing sign-in cookie is still valid after restart');
  assert.deepEqual((await c.get('/api/settings')).body, settingsBefore);
  const detailAfter = (await c.get(`/api/vocab/${entryId}`)).body;
  assert.deepEqual(
    detailAfter.cards.map((x: any) => [x.skill, x.state, x.due, x.stability, x.difficulty, x.reps, x.lapses]),
    detailBefore.cards.map((x: any) => [x.skill, x.state, x.due, x.stability, x.difficulty, x.reps, x.lapses]),
  );
  assert.deepEqual(detailAfter.reviews, detailBefore.reviews);
  // The unfinished session can be resumed where it stopped.
  const active = (await c.get('/api/sessions/active?lang=ru')).body;
  assert.equal(active.length, 1);
  assert.equal(active[0].id, open.id);
  assert.equal(active[0].done, 2);
  const finished = await runSession(c, open.id);
  assert.equal(finished.status, 'completed');
});

test('a second restart after more study is also lossless (repeated container replacement)', async () => {
  const c = new Client(srv.url);
  await c.login();
  const before = snapshot(srv);
  srv = await srv.restart();
  const after = snapshot(srv);
  assert.deepEqual(after, before);
  assert.equal(srv.app.db.get<{ v: string }>("SELECT value AS v FROM app_meta WHERE key = 'revision'")!.v !== null, true);
  // WAL mode is in effect and integrity is intact.
  assert.equal(srv.app.db.get<{ journal_mode: string }>('PRAGMA journal_mode')!.journal_mode, 'wal');
  assert.equal(srv.app.db.get<{ integrity_check: string }>('PRAGMA integrity_check')!.integrity_check, 'ok');
});
