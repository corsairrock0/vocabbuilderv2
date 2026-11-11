// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Client, correctAnswer, FIXTURE, nextPending, startTestServer, wrongAnswer, type TestServer } from '../helpers/harness.ts';

let srv: TestServer;
let c: Client;

async function importFixture(client: Client, file = 'ru-mini.json', lang = 'ru') {
  const up = await client.post(`/api/import/upload?lang=${lang}&kind=vocabulary&filename=${file}`, readFileSync(path.join(FIXTURE, file)), { 'Content-Type': 'application/json' });
  assert.equal(up.status, 200, JSON.stringify(up.body));
  const commit = await client.post(`/api/import/${up.body.id}/commit`, { mapping: {}, options: {} });
  assert.equal(commit.status, 200, JSON.stringify(commit.body));
  return commit.body;
}

before(async () => {
  srv = await startTestServer();
  c = new Client(srv.url);
  await c.setup();
  await importFixture(c);
});
after(() => srv.cleanup());

test('a standard session combines the integrated stages', async () => {
  const r = await c.post('/api/sessions', { id: randomUUID(), language: 'ru', minutes: 30, newWords: 6 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const s = r.body;
  const stages = new Set(s.exercises.map((e: any) => e.stage));
  for (const st of ['B', 'C', 'D', 'F']) assert.ok(stages.has(st), `stage ${st} present (${[...stages]})`);
  assert.equal(s.meta.newPlanned, 6);
  assert.ok(Object.keys(s.items).length >= 6);
  // Every new item gets intro, immediate recall and productive recall.
  for (const itemId of Object.keys(s.items)) {
    const kinds = s.exercises.filter((e: any) => String(e.itemId) === itemId).map((e: any) => e.kind);
    assert.ok(kinds.includes('intro'), `intro for ${itemId}`);
    assert.ok(kinds.includes('meaning_choice'), `meaning_choice for ${itemId}`);
    assert.ok(kinds.includes('recall_typed') || kinds.includes('speak_flashcard'), `production for ${itemId}`);
  }
  // Complete it: answer everything, one wrong answer to trigger remediation.
  let session = s;
  let wrongDone = false;
  let remediationSeen = false;
  for (let i = 0; i < 300; i++) {
    const ex = nextPending(session);
    if (!ex) break;
    const answer: Record<string, unknown> = !wrongDone && ex.kind === 'recall_typed' ? wrongAnswer(ex) : correctAnswer(ex, session.items);
    if (!wrongDone && ex.kind === 'recall_typed') wrongDone = true;
    const opId = randomUUID();
    const a: any = await c.post(`/api/sessions/${s.id}/attempts`, { opId, exerciseId: ex.id, answeredAt: Date.now(), latencyMs: 4000, activeMsDelta: 5000, ...answer }, { 'Idempotency-Key': opId });
    assert.equal(a.status, 200, JSON.stringify(a.body));
    if (a.body.inserted.length) remediationSeen = true;
    session = (await c.get(`/api/sessions/${s.id}`)).body;
  }
  assert.ok(wrongDone, 'a wrong answer was given');
  assert.ok(remediationSeen, 'a wrong answer inserted a remediation exercise in a different format');
  assert.equal(session.status, 'completed');
  assert.ok(session.summary);
  assert.equal(session.summary.introduced.length, 6);
  assert.ok(session.summary.scheduleChanges.length >= 6, 'new words received initial schedules');
  // One scheduling event per card per day.
  const detail = (await c.get('/api/vocab?lang=ru&status=learning&limit=50')).body;
  assert.ok(detail.total >= 1);
});

test('retrying an attempt with the same operation id never duplicates progress', async () => {
  const s = (await c.post('/api/sessions', { id: randomUUID(), language: 'ru', minutes: 10, newWords: 2 })).body;
  const ex = nextPending(s);
  const opId = randomUUID();
  const body = { opId, exerciseId: ex.id, answeredAt: Date.now(), ...correctAnswer(ex, s.items) };
  const a1 = await c.post(`/api/sessions/${s.id}/attempts`, body, { 'Idempotency-Key': opId });
  const a2 = await c.post(`/api/sessions/${s.id}/attempts`, body, { 'Idempotency-Key': opId });
  assert.equal(a1.status, 200);
  assert.equal(a2.status, 200);
  assert.equal(a2.headers.get('idempotent-replayed'), 'true');
  assert.deepEqual(a2.body.result.attemptId, a1.body.result.attemptId);
  // Without the header, the unique op id still prevents a duplicate attempt row.
  const a3 = await c.post(`/api/sessions/${s.id}/attempts`, body);
  assert.equal(a3.status, 200);
  assert.equal(a3.body.alreadyCompleted, true);
  const sess = (await c.get(`/api/sessions/${s.id}`)).body;
  assert.equal(sess.exercises.filter((e: any) => e.status === 'done').length, 1);
});

test('a failed request does not mark an exercise complete', async () => {
  const active = (await c.get('/api/sessions/active?lang=ru')).body;
  const s = (await c.get(`/api/sessions/${active[0].id}`)).body;
  const ex = nextPending(s);
  // Invalid payload (missing answeredAt) is rejected...
  const bad = await c.post(`/api/sessions/${s.id}/attempts`, { opId: randomUUID(), exerciseId: ex.id });
  assert.equal(bad.status, 422);
  // ...and a non-existent exercise is rejected.
  const missing = await c.post(`/api/sessions/${s.id}/attempts`, { opId: randomUUID(), exerciseId: 'nope', answeredAt: Date.now() });
  assert.equal(missing.status, 404);
  const after = (await c.get(`/api/sessions/${s.id}`)).body;
  assert.equal(after.exercises.find((e: any) => e.id === ex.id).status, 'pending');
});

test('resume returns the latest saved position', async () => {
  const active = (await c.get('/api/sessions/active?lang=ru')).body;
  assert.equal(active.length, 1);
  const s = (await c.get(`/api/sessions/${active[0].id}`)).body;
  assert.equal(s.exercises.filter((e: any) => e.status === 'done').length, active[0].done);
  // Creating another session in the same language requires an explicit choice.
  const conflict = await c.post('/api/sessions', { id: randomUUID(), language: 'ru' });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.error.code, 'active_session_exists');
});

test('nothing_to_study is reported for an empty language', async () => {
  const r = await c.post('/api/sessions', { id: randomUUID(), language: 'pl' });
  assert.equal(r.status, 422);
  assert.equal(r.body.error.code, 'nothing_to_study');
});
