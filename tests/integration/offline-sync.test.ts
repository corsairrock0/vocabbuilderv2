// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Multi-device conflicts: concurrent answers to the same exercise, late offline reviews
// (inserted chronologically + replayed), and offline progress for already-ended sessions.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Client, correctAnswer, nextPending, startTestServer, type TestServer } from '../helpers/harness.ts';
import { answer, duplicateCardDays, importFixture, runSession, shiftHistory, startSession, TZ } from '../helpers/study.ts';
import { FsrsScheduler, fuzzSeed, seededRandom, type Rating } from '../../shared/fsrs.ts';
import { addDays, localDay, startOfLocalDay } from '../../shared/time.ts';
import type { Db } from '../../server/db/database.ts';

let srv: TestServer;
let desktop: Client;
let phone: Client;
let db: Db;

before(async () => {
  srv = await startTestServer();
  desktop = new Client(srv.url, 'desktop-device-0001');
  phone = new Client(srv.url, 'phone-device-0002');
  await desktop.setup();
  await phone.login();
  await importFixture(desktop, 'ru-mini.json', 'ru');
  db = srv.app.db;
  const s = await startSession(desktop, { language: 'ru', minutes: 30, newWords: 4 });
  const done = await runSession(desktop, s.id);
  assert.equal(done.status, 'completed');
  shiftHistory(db, 5);
});
after(() => srv.cleanup());

test('two devices answering the same exercise: one completion, both attempts kept, one scheduling event', async () => {
  const s = await startSession(desktop, { language: 'ru', mode: 'review', minutes: 20 });
  const onPhone = (await phone.get(`/api/sessions/${s.id}`)).body;
  assert.equal(onPhone.id, s.id, 'the phone sees the same session');
  const ex = nextPending(s);
  const send = (client: Client) => {
    const opId = randomUUID();
    return client.post(`/api/sessions/${s.id}/attempts`, { opId, exerciseId: ex.id, answeredAt: Date.now(), ...correctAnswer(ex, s.items) }, { 'Idempotency-Key': opId });
  };
  const [r1, r2] = await Promise.all([send(desktop), send(phone)]);
  assert.equal(r1.status, 200);
  assert.equal(r2.status, 200);
  assert.deepEqual([r1.body.alreadyCompleted, r2.body.alreadyCompleted].sort(), [false, true]);
  const attempts = db.all<{ id: number; device_id: string }>('SELECT id, device_id FROM exercise_attempts WHERE exercise_id = ? ORDER BY id', ex.id);
  assert.equal(attempts.length, 2, 'both answers are preserved');
  assert.deepEqual(attempts.map((a) => a.device_id).sort(), ['desktop-device-0001', 'phone-device-0002']);
  const row = db.get<{ status: string; attempt_id: number }>('SELECT status, attempt_id FROM session_exercises WHERE id = ?', ex.id)!;
  assert.equal(row.status, 'done');
  assert.equal(row.attempt_id, attempts[0].id, 'first write wins for completion');
  const card = db.get<{ id: number }>('SELECT id FROM fsrs_cards WHERE item_id = ? AND skill = ?', ex.itemId, ex.cardSkill)!;
  assert.equal(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM review_logs WHERE card_id = ? AND local_day = ?', card.id, localDay(Date.now(), TZ))!.n, 1);
  assert.equal(duplicateCardDays(db), 0);
  // Both devices converge on the same session state.
  const a = (await desktop.get(`/api/sessions/${s.id}`)).body;
  const b = (await phone.get(`/api/sessions/${s.id}`)).body;
  assert.deepEqual(
    a.exercises.map((e: any) => [e.id, e.status]),
    b.exercises.map((e: any) => [e.id, e.status]),
  );
  await desktop.post(`/api/sessions/${s.id}/complete`);
});

test('a late offline review is inserted chronologically and the card is replayed', async () => {
  // The phone prepares an offline session while the cards are due.
  const offline = await startSession(phone, { language: 'ru', mode: 'review', minutes: 20, prepared: true });
  assert.equal(offline.status, 'prepared');
  const target = offline.exercises.find((e: any) => {
    const card = db.get<{ last_review: number }>('SELECT last_review FROM fsrs_cards WHERE item_id = ? AND skill = ?', e.itemId, e.cardSkill)!;
    return card.last_review < startOfLocalDay(localDay(Date.now(), TZ), TZ);
  });
  assert.ok(target, 'the offline plan contains a card not yet reviewed today');
  const card = db.get<{ id: number }>('SELECT id FROM fsrs_cards WHERE item_id = ? AND skill = ?', target.itemId, target.cardSkill)!;

  // Meanwhile the desktop reviews the same card online today.
  const online = await startSession(desktop, { language: 'ru', mode: 'review', minutes: 20 });
  const same = online.exercises.find((e: any) => e.itemId === target.itemId && e.cardSkill === target.cardSkill);
  assert.ok(same, 'desktop session includes the same card');
  const r1 = await answer(desktop, online.id, same, {}, online.items);
  assert.ok(r1.review);

  // The phone syncs later; its answer was given yesterday while offline.
  const yesterdayNoon = startOfLocalDay(addDays(localDay(Date.now(), TZ), -1), TZ) + 12 * 3600_000;
  const r2 = await answer(phone, offline.id, target, { answeredAt: yesterdayNoon, offline: true }, offline.items);
  assert.ok(r2.review, 'the offline review counts as a scheduling event on its own day');
  assert.equal(r2.result.countedAsReview, true);

  const logs = db.all<{ rating: Rating; reviewed_at: number; local_day: string; due_after: number; stability_after: number; difficulty_after: number }>(
    'SELECT rating, reviewed_at, local_day, due_after, stability_after, difficulty_after FROM review_logs WHERE card_id = ? ORDER BY reviewed_at',
    card.id,
  );
  assert.equal(logs.length, 3, 'initial + offline (yesterday) + online (today)');
  assert.equal(logs[1].reviewed_at, yesterdayNoon);
  assert.ok(logs[1].reviewed_at < logs[2].reviewed_at);
  // The stored card equals a from-scratch replay of the complete history.
  const sched = new FsrsScheduler({ desiredRetention: 0.9 });
  const replay = sched.replay(
    logs.map((l) => ({ rating: l.rating, reviewedAt: l.reviewed_at })),
    (_i, t) => seededRandom(fuzzSeed(card.id, t)),
  );
  const row = db.get<{ state: number; stability: number; difficulty: number; due: number; last_review: number; reps: number }>('SELECT * FROM fsrs_cards WHERE id = ?', card.id)!;
  assert.equal(row.reps, 3);
  assert.equal(row.last_review, logs[2].reviewed_at);
  assert.equal(row.due, replay.card.due);
  assert.ok(Math.abs(row.stability - replay.card.stability!) < 1e-9);
  assert.ok(Math.abs(row.difficulty - replay.card.difficulty!) < 1e-9);
  // Each log's "after" state was recomputed in order.
  replay.outcomes.forEach((o, i) => {
    assert.equal(logs[i].due_after, o.card.due);
    assert.ok(Math.abs(logs[i].stability_after - o.card.stability!) < 1e-9);
  });
  assert.equal(duplicateCardDays(db), 0);
  const attempt = db.get<{ offline: number; device_id: string }>('SELECT offline, device_id FROM exercise_attempts WHERE id = ?', r2.result.attemptId)!;
  assert.equal(attempt.offline, 1);
  assert.equal(attempt.device_id, 'phone-device-0002');
  await desktop.post(`/api/sessions/${online.id}/complete`);
});

test('offline answers for a session that another device already ended are still saved', async () => {
  const offline = (await phone.get('/api/sessions/active?lang=ru')).body.find((s: any) => s.status === 'prepared' || s.status === 'active');
  assert.ok(offline, 'the offline session is still open');
  const session = (await phone.get(`/api/sessions/${offline.id}`)).body;
  const pending = nextPending(session);
  assert.ok(pending);
  // The desktop ends it first (e.g. "End session" on another device).
  const end = await desktop.post(`/api/sessions/${offline.id}/complete`);
  assert.equal(end.status, 200);
  const before = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM exercise_attempts')!.n;
  const r = await answer(phone, offline.id, pending, { answeredAt: Date.now() - 60_000, offline: true }, session.items);
  assert.equal(r.session.status, 'completed', 'the session stays completed');
  assert.equal(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM exercise_attempts')!.n, before + 1, 'the offline answer is never discarded');
  assert.equal(r.inserted.length, 0, 'no remediation is added to an ended session');
});

test('retried uploads of queued offline answers are applied exactly once', async () => {
  const s = await startSession(desktop, { language: 'ru', minutes: 10, newWords: 1, replaceActive: true });
  const ex = nextPending(s);
  const opId = randomUUID();
  const body = { opId, exerciseId: ex.id, answeredAt: Date.now() - 5000, offline: true, ...correctAnswer(ex, s.items) };
  const results = await Promise.all([1, 2, 3].map(() => phone.post(`/api/sessions/${s.id}/attempts`, body, { 'Idempotency-Key': opId })));
  assert.ok(results.every((r) => r.status === 200));
  assert.equal(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM exercise_attempts WHERE op_id = ?', opId)!.n, 1);
  const replayed = results.filter((r) => r.headers.get('idempotent-replayed') === 'true').length;
  assert.equal(replayed, 2);
  // The same key with a different body is rejected rather than silently applied.
  const clash = await phone.post(`/api/sessions/${s.id}/attempts`, { ...body, response: 'different' }, { 'Idempotency-Key': opId });
  assert.equal(clash.status, 422);
  assert.equal(clash.body.error.code, 'idempotency_conflict');
});

test('a follow-up exercise planned only on an offline device is adopted by the server, never rejected', async () => {
  const s = await startSession(desktop, { language: 'ru', minutes: 20, newWords: 2, replaceActive: true });
  const parent = s.exercises.find((e: any) => e.kind !== 'intro' && s.items[String(e.itemId)]?.variants);
  assert.ok(parent, 'an exercise with prepared variants');
  const variants = s.items[String(parent.itemId)].variants;
  const kind = Object.keys(variants).find((k) => k !== parent.kind)!;
  const followUp = { id: `${parent.id}~r1`, kind, payload: variants[kind], itemId: parent.itemId };
  const opId = randomUUID();
  const r = await desktop.post(
    `/api/sessions/${s.id}/attempts`,
    { opId, exerciseId: followUp.id, kind, answeredAt: Date.now(), ...correctAnswer(followUp, s.items) },
    { 'Idempotency-Key': opId },
  );
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const row = db.get<{ status: string; origin: string; parent_id: string; kind: string }>('SELECT status, origin, parent_id, kind FROM session_exercises WHERE id = ?', followUp.id)!;
  assert.deepEqual({ ...row }, { status: 'done', origin: 'remediation', parent_id: parent.id, kind });
  assert.equal(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM exercise_attempts WHERE op_id = ?', opId)!.n, 1, 'the answer is kept');
  // Unknown exercise ids that are not follow-ups of a real exercise are still rejected.
  const bad = randomUUID();
  const r2 = await desktop.post(`/api/sessions/${s.id}/attempts`, { opId: bad, exerciseId: 'nope~r1', kind, answeredAt: Date.now(), choiceId: 'a' }, { 'Idempotency-Key': bad });
  assert.equal(r2.status, 404);
  await desktop.post(`/api/sessions/${s.id}/complete`);
});
