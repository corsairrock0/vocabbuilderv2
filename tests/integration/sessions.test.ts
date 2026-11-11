// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Session lifecycle: resume after interruption, language switching, pause/resume, skip,
// "I know this word", wrap-up when out of time, stale-session finalisation, summaries, and the practice rounds'
// answers kept with a Comprehensive session (`round` events).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Client, nextPending, startTestServer, wrongAnswer, type TestServer } from '../helpers/harness.ts';
import { answer, importFixture, runSession, startSession } from '../helpers/study.ts';
import type { Db } from '../../server/db/database.ts';
import { DEFAULT_PACE, sessionPace } from '../../server/learning/sessions.ts';

let srv: TestServer;
let c: Client;
let db: Db;

before(async () => {
  srv = await startTestServer();
  c = new Client(srv.url);
  await c.setup();
  await importFixture(c, 'ru-mini.json', 'ru');
  await importFixture(c, 'es-mini.json', 'es');
  db = srv.app.db;
});
after(() => srv.cleanup());

const end = (id: string) => c.post(`/api/sessions/${id}/complete`);

test('an interrupted session resumes at the latest saved position on another browser', async () => {
  const s = await startSession(c, { language: 'ru', minutes: 20, newWords: 3 });
  let session = s;
  const answeredIds: string[] = [];
  for (let i = 0; i < 5; i++) {
    const ex = nextPending(session);
    await answer(c, s.id, ex, {}, session.items);
    answeredIds.push(ex.id);
    session = (await c.get(`/api/sessions/${s.id}`)).body;
  }
  // The browser is closed. Later another browser signs in and resumes.
  const other = new Client(srv.url);
  await other.login();
  const active = (await other.get('/api/sessions/active?lang=ru')).body;
  assert.equal(active.length, 1);
  assert.equal(active[0].id, s.id);
  assert.equal(active[0].done, 5);
  const resumed = (await other.get(`/api/sessions/${s.id}`)).body;
  const doneIds = resumed.exercises.filter((e: any) => e.status === 'done').map((e: any) => e.id);
  assert.deepEqual(doneIds.sort(), answeredIds.sort());
  const next = nextPending(resumed);
  assert.ok(!answeredIds.includes(next.id));
  assert.ok(resumed.exercises.filter((e: any) => e.status === 'done').every((e: any) => e.result && e.result.attemptId), 'saved results are returned');
  const finished = await runSession(other, s.id);
  assert.equal(finished.status, 'completed');
});

test('switching languages keeps sessions and progress separate', async () => {
  const es = await startSession(c, { language: 'es', minutes: 20, newWords: 2 });
  let esSession = es;
  for (let i = 0; i < 3; i++) {
    await answer(c, es.id, nextPending(esSession), {}, esSession.items);
    esSession = (await c.get(`/api/sessions/${es.id}`)).body;
  }
  const pause = await c.post(`/api/sessions/${es.id}/events`, { type: 'pause', activeMsDelta: 1000 });
  assert.equal(pause.body.session.status, 'paused');
  const ru = await startSession(c, { language: 'ru', minutes: 20, newWords: 2 });
  const active = (await c.get('/api/sessions/active')).body;
  assert.deepEqual(active.map((a: any) => a.language).sort(), ['es', 'ru']);
  // Each session only contains words of its own language.
  for (const s of [es, ru]) {
    const langs = db.all<{ language_code: string }>(
      'SELECT DISTINCT li.language_code FROM session_exercises x JOIN learning_items li ON li.id = x.item_id WHERE x.session_id = ?',
      s.id,
    );
    assert.deepEqual(langs.map((l) => l.language_code), [s.language]);
  }
  const esBefore = (await c.get('/api/bootstrap')).body.languages.find((l: any) => l.code === 'es').stats;
  await runSession(c, ru.id);
  const after = (await c.get('/api/bootstrap')).body.languages;
  const esAfter = after.find((l: any) => l.code === 'es').stats;
  assert.deepEqual({ introduced: esAfter.introduced, due: esAfter.due }, { introduced: esBefore.introduced, due: esBefore.due }, 'Russian study does not change Spanish progress');
  assert.equal(after.find((l: any) => l.code === 'es').activeSession.id, es.id, 'the Spanish session is still resumable');
  const esResumed = (await c.get(`/api/sessions/${es.id}`)).body;
  assert.equal(esResumed.exercises.filter((e: any) => e.status === 'done').length, 3);
  const resume = await c.post(`/api/sessions/${es.id}/events`, { type: 'resume' });
  assert.equal(resume.body.session.status, 'active');
  await end(es.id);
});

test('heartbeats add study time; skipping advances without grading', async () => {
  const s = await startSession(c, { language: 'es', minutes: 20, newWords: 2 });
  const hb = await c.post(`/api/sessions/${s.id}/events`, { type: 'heartbeat', activeMsDelta: 30_000 });
  assert.equal(hb.body.session.activeMs, 30_000);
  const capped = await c.post(`/api/sessions/${s.id}/events`, { type: 'heartbeat', activeMsDelta: 3_000_000 });
  assert.equal(capped.body.session.activeMs, 30_000 + 5 * 60_000, 'idle gaps are capped');
  const ex = nextPending(s);
  const skip = await c.post(`/api/sessions/${s.id}/events`, { type: 'skip', exerciseId: ex.id });
  assert.deepEqual(skip.body.skipped, [ex.id]);
  assert.equal(skip.body.session.done, 1);
  assert.equal(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM exercise_attempts WHERE exercise_id = ?', ex.id)!.n, 0, 'a skip is not a wrong answer');
  await end(s.id);
});

test('"I already know this word" excludes the word and skips its exercises', async () => {
  const s = await startSession(c, { language: 'ru', minutes: 20, newWords: 2 });
  const intro = s.exercises.find((e: any) => e.kind === 'intro');
  const r = await answer(c, s.id, intro, { markKnown: true });
  const itemExercises = s.exercises.filter((e: any) => e.itemId === intro.itemId && e.id !== intro.id).map((e: any) => e.id);
  assert.deepEqual(r.skipped.sort(), itemExercises.sort());
  assert.equal(db.get<{ status: string }>('SELECT status FROM learning_items WHERE id = ?', intro.itemId)!.status, 'known');
  await end(s.id);
  assert.equal(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM fsrs_cards WHERE item_id = ?', intro.itemId)!.n, 0, 'no schedule for a known word');
  const next = await startSession(c, { language: 'ru', minutes: 20, newWords: 5 });
  assert.ok(!next.exercises.some((e: any) => e.itemId === intro.itemId), 'known words are not offered as new');
  await end(next.id);
});

test('wrap-up when time runs out drops optional work and words not yet introduced', async () => {
  const s = await startSession(c, { language: 'es', minutes: 45, newWords: 5 });
  const intros = s.exercises.filter((e: any) => e.kind === 'intro');
  assert.ok(intros.length >= 4);
  const firstIntro = intros[0];
  await answer(c, s.id, firstIntro);
  const r = await c.post(`/api/sessions/${s.id}/events`, { type: 'wrap_up' });
  assert.equal(r.status, 200);
  const after = (await c.get(`/api/sessions/${s.id}`)).body;
  const pending = after.exercises.filter((e: any) => e.status === 'pending');
  assert.ok(pending.every((e: any) => e.priority === 'core'), 'only core work remains');
  assert.ok(pending.every((e: any) => e.itemId === firstIntro.itemId || e.stage === 'A'), 'only the started word (and reviews) remain');
  for (const intro of intros.slice(1)) {
    assert.ok(after.exercises.filter((e: any) => e.itemId === intro.itemId).every((e: any) => e.status === 'skipped'));
    assert.equal(db.get<{ status: string }>('SELECT status FROM learning_items WHERE id = ?', intro.itemId)!.status, 'new', 'unstarted words stay new');
  }
  const finished = await runSession(c, s.id);
  assert.equal(finished.status, 'completed');
  assert.equal(finished.summary.introduced.length, 1);
});

test('stale sessions are finalised as abandoned, scheduling words that were practiced', async () => {
  const s = await startSession(c, { language: 'ru', minutes: 20, newWords: 2 });
  const [i1, i2] = s.exercises.filter((e: any) => e.kind === 'intro');
  await answer(c, s.id, i1);
  const recall = s.exercises.find((e: any) => e.itemId === i1.itemId && e.kind === 'meaning_choice');
  await answer(c, s.id, recall, {}, s.items);
  db.tx(() => db.run('UPDATE study_sessions SET last_activity_at = ? WHERE id = ?', Date.now() - 13 * 3600_000, s.id));
  const active = (await c.get('/api/sessions/active?lang=ru')).body;
  assert.equal(active.length, 0);
  const row = db.get<{ status: string; summary: string }>('SELECT status, summary FROM study_sessions WHERE id = ?', s.id)!;
  assert.equal(row.status, 'abandoned');
  assert.ok(JSON.parse(row.summary).introduced.length === 1);
  const logs = db.all<{ skill: string; rating_source: string }>('SELECT skill, rating_source FROM review_logs WHERE item_id = ?', i1.itemId);
  assert.deepEqual(logs.map((l) => ({ ...l })), [{ skill: 'receptive', rating_source: 'aggregate' }], 'practiced word received its initial schedule');
  assert.equal(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM review_logs WHERE item_id = ?', i2.itemId)!.n, 0);
  assert.equal(db.get<{ status: string }>('SELECT status FROM learning_items WHERE id = ?', i2.itemId)!.status, 'new');
});

test('the completed-session summary reports every required figure', async () => {
  const s = await startSession(c, { language: 'ru', minutes: 30, newWords: 2 });
  let missed = false;
  const done = await runSession(c, s.id, (ex) => {
    if (!missed && ex.kind === 'meaning_choice') {
      missed = true;
      return wrongAnswer(ex);
    }
    return undefined;
  });
  assert.equal(done.status, 'completed');
  const sum = done.summary;
  assert.equal(sum.introduced.length, 2);
  assert.ok(sum.introduced.every((x: any) => x.lemma && x.gloss));
  assert.ok(sum.attempts > 0);
  assert.ok(sum.correctFirstTry > 0 && sum.correctFirstTry < sum.attempts);
  assert.ok(sum.retrievalAccuracy > 0 && sum.retrievalAccuracy < 1);
  assert.ok(sum.difficult.length >= 1 && sum.difficult[0].misses >= 1);
  assert.ok(sum.scheduleChanges.length >= 2);
  assert.ok(sum.scheduleChanges.every((x: any) => x.dueAfter > Date.now() && x.scheduledDays >= 1 && [1, 2, 3, 4].includes(x.rating)));
  assert.equal(typeof sum.listening.attempts, 'number');
  assert.ok(sum.production.attempts >= 2);
  assert.ok(sum.activeMs > 0);
  assert.match(sum.next.suggestion, /session|due/);
  // Completing again returns the stored summary instead of recomputing or duplicating stats.
  const again = await end(s.id);
  assert.deepEqual(again.body.summary, sum);
  const hist = (await c.get('/api/sessions/history?lang=ru')).body;
  assert.ok(hist.some((h: any) => h.id === s.id && h.introduced === 2));
});

test('a practice round’s answers are kept with the session: each answer once, returned with it, also after the session is complete', async () => {
  const s = await startSession(c, { language: 'ru', minutes: 20, newWords: 2, mode: 'comprehensive', replaceActive: true });
  assert.equal(s.meta.rounds, undefined, 'none yet');
  const url = `/api/sessions/${s.id}/events`;
  const scheduleRows = () => ({
    reviews: db.get<{ n: number }>('SELECT COUNT(*) AS n FROM review_logs WHERE session_id = ?', s.id)!.n,
    attempts: db.get<{ n: number }>('SELECT COUNT(*) AS n FROM exercise_attempts WHERE session_id = ?', s.id)!.n,
  });
  const before = scheduleRows();
  // After each answer the device sends the round's answers so far.
  const roundId = randomUUID();
  const first = await c.post(url, { type: 'round', roundId, skill: 'cloze', grades: ['correct'], at: Date.now() });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const second = { type: 'round', roundId, skill: 'cloze', grades: ['correct', 'incorrect'], at: Date.now() };
  assert.equal((await c.post(url, second, { 'Idempotency-Key': `round-${roundId}-2` })).status, 200);
  // Replayed: the outbox resending the same operation, and the same answers sent again as a new one.
  const replay = await c.post(url, second, { 'Idempotency-Key': `round-${roundId}-2` });
  assert.equal(replay.status, 200);
  assert.equal(replay.headers.get('idempotent-replayed'), 'true');
  assert.equal((await c.post(url, { ...second, at: Date.now() + 1 })).status, 200);
  // A late event from before the last one adds nothing either.
  assert.equal((await c.post(url, { type: 'round', roundId, skill: 'cloze', grades: ['correct'] })).status, 200);
  // Another round: five Identify questions, a sentence understood in full counts as right in a Read round.
  const identify = randomUUID();
  assert.equal((await c.post(url, { type: 'round', roundId: identify, skill: 'identify', grades: ['correct', 'revealed', 'correct', 'incorrect', 'correct'] })).status, 200);
  assert.equal((await c.post(url, { type: 'round', roundId: randomUUID(), skill: 'read', grades: ['understood', 'partly'] })).status, 200);

  const expected = {
    cloze: { rounds: 1, answered: 2, correct: 1 },
    identify: { rounds: 1, answered: 5, correct: 3 },
    read: { rounds: 1, answered: 2, correct: 1 },
  };
  const got = (await c.get(`/api/sessions/${s.id}`)).body;
  assert.deepEqual(got.meta.rounds, expected, 'returned with the session (another device resuming it sees them)');
  assert.equal(got.meta.roundAnswers[roundId], 2);
  assert.equal(got.meta.budgetSeconds, s.meta.budgetSeconds, 'the plan is kept');
  assert.deepEqual(JSON.parse(db.get<{ plan_meta: string }>('SELECT plan_meta FROM study_sessions WHERE id = ?', s.id)!.plan_meta).rounds, expected, 'stored');
  assert.deepEqual(scheduleRows(), before, 'practice: no attempt and no review is recorded for them');

  // The last exercise completes the session; the rounds at the end of it come after that, and still count.
  const finished = await runSession(c, s.id);
  assert.equal(finished.status, 'completed');
  assert.equal((await c.post(url, { type: 'round', roundId: randomUUID(), skill: 'comprehension', grades: ['correct', 'correct', 'incorrect'] })).status, 200);
  const after = (await c.get(`/api/sessions/${s.id}`)).body;
  assert.deepEqual(after.meta.rounds, { ...expected, comprehension: { rounds: 1, answered: 3, correct: 2 } });
  assert.deepEqual(after.summary, finished.summary, 'the stored summary is unchanged');
  assert.equal(after.status, 'completed');
});

test('a malformed round event is refused and changes nothing', async () => {
  const s = await startSession(c, { language: 'es', minutes: 20, newWords: 2, mode: 'comprehensive', replaceActive: true });
  const url = `/api/sessions/${s.id}/events`;
  const ok = { type: 'round', roundId: randomUUID(), skill: 'forms', grades: ['correct'] };
  for (const [why, body] of [
    ['no round id', { ...ok, roundId: undefined }],
    ['no skill', { ...ok, skill: undefined }],
    ['no grades', { ...ok, grades: undefined }],
    ['an unknown skill', { ...ok, skill: 'vocabulary' }],
    ['no answers, and not the end of the round', { ...ok, grades: [] }],
    ['an answer number that is not one', { ...ok, from: -1 }],
    ['an answer number past the last', { ...ok, from: 11 }],
    ['an end that is not yes or no', { ...ok, end: 'yes' }],
    ['more than ten answers', { ...ok, grades: Array.from({ length: 11 }, () => 'correct') }],
    ['a long grade', { ...ok, grades: ['x'.repeat(21)] }],
    ['an empty grade', { ...ok, grades: [''] }],
    ['a grade that is not text', { ...ok, grades: [1] }],
    ['a round id that is not short', { ...ok, roundId: 'r'.repeat(65) }],
    ['a round id with other characters', { ...ok, roundId: '__proto__' }],
  ] as const) {
    const r = await c.post(url, body);
    assert.equal(r.status, 422, why);
    assert.equal(r.body.error.code, 'validation_failed', why);
  }
  assert.equal((await c.get(`/api/sessions/${s.id}`)).body.meta.rounds, undefined);
  assert.equal((await c.post(url, ok)).status, 200, 'the well-formed one is kept');
  assert.deepEqual((await c.get(`/api/sessions/${s.id}`)).body.meta.rounds, { forms: { rounds: 1, answered: 1, correct: 1 } });
  // The end of a round may come with no answers (a slot with nothing to ask), and a resumed one goes on from its count.
  assert.equal((await c.post(url, { type: 'round', roundId: 'p2', skill: 'cloze', grades: [], end: true })).status, 200);
  assert.equal((await c.post(url, { ...ok, grades: ['incorrect'], from: 1, end: true })).status, 200);
  const meta = (await c.get(`/api/sessions/${s.id}`)).body.meta;
  assert.deepEqual(meta.rounds, { forms: { rounds: 1, answered: 2, correct: 1 } });
  assert.deepEqual(meta.roundsEnded, { p2: true, [ok.roundId]: true });
  await end(s.id);
});

test('a Comprehensive session is planned with its practice: every kind, sized to its length, spread between its exercises', async () => {
  const s = await startSession(c, { language: 'ru', minutes: 20, newWords: 3, mode: 'comprehensive', replaceActive: true });
  const plan = s.meta.practice as Array<{ id: string; kind: string; size: number; after: number }>;
  // No finished sessions to measure yet: questions take twice the time model (DEFAULT_PACE), so 20 real minutes plan
  // the practice of 10 model minutes, with the text that a session of ten real minutes or more gets.
  assert.equal(s.meta.pace, 2);
  assert.deepEqual(
    plan.map((p) => [p.kind, p.size]),
    [['forms', 3], ['cloze', 3], ['identify', 5], ['comprehension', 3], ['say', 2]],
  );
  const exercises = s.exercises.length;
  assert.ok(plan.every((p, i) => p.after >= 0 && p.after <= exercises && (i === 0 || p.after >= plan[i - 1].after)), 'in order, between the exercises');
  // Kept as planned: another device gets the same mix.
  assert.deepEqual((await c.get(`/api/sessions/${s.id}`)).body.meta.practice, plan);
  await end(s.id);
  // Reviews and new words only: no practice.
  const mixed = await startSession(c, { language: 'ru', minutes: 20, newWords: 3, mode: 'mixed', replaceActive: true });
  assert.equal(mixed.meta.practice, undefined);
  await end(mixed.id);
});

test('sessions are planned at the learner’s measured pace: real time against the model time their plans filled', async () => {
  // A month ahead, so no session of the other tests counts.
  const now = Date.now() + 40 * 86_400_000;
  assert.equal(sessionPace(db, 'ru', now), DEFAULT_PACE, 'nothing finished to measure yet');
  const item = db.get<{ id: number }>("SELECT id FROM learning_items WHERE language_code = 'ru' LIMIT 1")!.id;
  const add = (o: { minutes: number; meta: Record<string, number>; activeMin: number; planned: number; done: number; status?: string }) => {
    const id = randomUUID();
    db.run(
      `INSERT INTO study_sessions (id, language_code, status, mode, config, plan_meta, resources, created_at, active_ms) VALUES (?, 'ru', ?, 'comprehensive', ?, ?, '{}', ?, ?)`,
      id,
      o.status ?? 'completed',
      JSON.stringify({ minutes: o.minutes, mode: 'comprehensive' }),
      JSON.stringify(o.meta),
      now - 86_400_000,
      o.activeMin * 60_000,
    );
    for (let i = 0; i < o.planned; i++) {
      db.run(`INSERT INTO session_exercises (id, session_id, seq, stage, item_id, kind, payload, status) VALUES (?, ?, ?, 'A', ?, 'meaning_choice', '{}', ?)`, randomUUID(), id, i, item, i < o.done ? 'done' : 'pending');
    }
  };
  // Planned before 1.8.4 (pace 1): ten minutes took twenty.
  add({ minutes: 10, meta: { budgetSeconds: 600, estimatedSeconds: 390 }, activeMin: 20, planned: 10, done: 10 });
  assert.equal(sessionPace(db, 'ru', now), 2);
  // Planned at pace 2 and ended halfway after 9 minutes: 1.8 times the minutes planned for that half, so pace 3.6.
  add({ minutes: 10, meta: { budgetSeconds: 600, estimatedSeconds: 195, pace: 2 }, activeMin: 9, planned: 10, done: 5, status: 'abandoned' });
  assert.equal(sessionPace(db, 'ru', now), 2.53, 'weighted by the minutes done: (2 × 10 + 3.6 × 5) / 15');
  // Neither counts: a plan that could not fill its time (too few words), and one less than half done.
  add({ minutes: 10, meta: { budgetSeconds: 600, estimatedSeconds: 100 }, activeMin: 3, planned: 6, done: 6 });
  add({ minutes: 10, meta: { budgetSeconds: 600, estimatedSeconds: 390 }, activeMin: 5, planned: 10, done: 4 });
  assert.equal(sessionPace(db, 'ru', now), 2.53);
  // Never below the model or above three times it.
  add({ minutes: 10, meta: { budgetSeconds: 600, estimatedSeconds: 390 }, activeMin: 200, planned: 10, done: 10 });
  assert.equal(sessionPace(db, 'ru', now), 3);
});

test('the preview plans a session without starting one: the mix per type, the same as Start then gets, and nothing written', async () => {
  const counts = () => ({
    sessions: db.get<{ n: number }>('SELECT COUNT(*) AS n FROM study_sessions')!.n,
    items: db.get<{ n: number }>('SELECT COUNT(*) AS n FROM learning_items')!.n,
    revision: db.revision(),
  });
  const before = counts();
  const id = randomUUID();
  const r = await c.get(`/api/sessions/preview?id=${id}&lang=es&minutes=20&newWords=4&mode=comprehensive`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const p = r.body;
  assert.deepEqual({ language: p.language, mode: p.mode, minutes: p.minutes, empty: p.empty }, { language: 'es', mode: 'comprehensive', minutes: 20, empty: null });
  assert.deepEqual(counts(), before, 'no session, no word added to the learning list, nothing to sync');
  const types = p.parts.map((x: any) => x.type);
  assert.deepEqual(types, ['review', 'new', 'listening', 'grammar', 'sentences', 'pictures', 'speaking', 'reading', 'writing'].filter((t) => types.includes(t)), 'in order');
  // (The test server has no Writing sentences: tests/integration/writing.test.ts has the Writing slots.)
  assert.ok(['grammar', 'sentences', 'pictures', 'speaking', 'reading'].every((t) => types.includes(t)), 'every kind of practice');
  assert.equal(p.total, p.parts.reduce((n: number, x: any) => n + x.count, 0));
  assert.ok(p.newWords > 0 && p.newWords <= 4);
  // Started with the same id and options: the very same mix.
  const s = await startSession(c, { id, language: 'es', minutes: 20, newWords: 4, mode: 'comprehensive', replaceActive: true });
  const practice = s.meta.practice.reduce((n: number, x: any) => n + x.size, 0);
  assert.equal(p.total, s.exercises.length + practice);
  const newCount = s.exercises.filter((e: any) => s.items[String(e.itemId)].isNew && !['listen_meaning', 'listen_choice', 'dictation'].includes(e.kind)).length;
  assert.equal(p.parts.find((x: any) => x.type === 'new')?.count ?? 0, newCount);
  await end(s.id);
  // Other lengths and modes; a malformed query is refused; nothing to study is said, not an error.
  const short = (await c.get('/api/sessions/preview?lang=es&minutes=10&mode=mixed')).body;
  assert.ok(short.parts.every((x: any) => ['review', 'new', 'listening'].includes(x.type)), 'reviews and new words only');
  assert.equal((await c.get('/api/sessions/preview?lang=xx')).status, 422);
  assert.equal((await c.get('/api/sessions/preview?lang=es&minutes=2')).status, 422);
  const none = (await c.get('/api/sessions/preview?lang=pt&mode=review')).body;
  assert.deepEqual([none.total, none.parts, typeof none.empty], [0, [], 'string']);
});

test('the preview plans what Start gets: an empty frequency range is none (as Start’s null), not the one in the settings', async () => {
  // The settings keep new words to ranks far past the list: with that range there is nothing new to learn.
  assert.equal((await c.put('/api/languages/es/settings', { frequencyMin: 900000, frequencyMax: 900001 })).status, 200);
  try {
    const id = randomUUID();
    const q = `id=${id}&lang=es&minutes=20&mode=mixed&newWords=3`;
    const settingsRange = (await c.get(`/api/sessions/preview?${q}`)).body;
    const none = (await c.get(`/api/sessions/preview?${q}&frequencyMin=&frequencyMax=`)).body;
    assert.equal(settingsRange.newWords, 0, 'left out: the range in the settings');
    assert.ok(none.newWords > 0, 'empty: no range');
    const s = await startSession(c, { id, language: 'es', minutes: 20, newWords: 3, mode: 'mixed', frequencyMin: null, frequencyMax: null, replaceActive: true });
    assert.deepEqual([s.config.frequencyMin, s.config.frequencyMax], [null, null]);
    assert.equal(s.meta.newPlanned, none.newWords);
    assert.equal(s.exercises.length, none.total);
    await end(s.id);
  } finally {
    await c.put('/api/languages/es/settings', { frequencyMin: null, frequencyMax: null });
  }
});

test('by default new words are what is left of today’s target, alike for Home’s preview, the start screen and Start', async () => {
  assert.equal((await c.put('/api/languages/es/settings', { dailyNewTarget: 4 })).status, 200);
  try {
    const introduced = () => db.get<{ n: number }>("SELECT COALESCE(SUM(introduced), 0) AS n FROM daily_stats WHERE language_code = 'es'")!.n;
    // One new word today, in a session of its own (a test before may have introduced some: the target counts them all).
    const first = await startSession(c, { language: 'es', minutes: 10, newWords: 1, mode: 'mixed', replaceActive: true });
    await runSession(c, first.id);
    const left = Math.max(0, 4 - introduced());
    const id = randomUUID();
    const home = (await c.get('/api/sessions/preview?lang=es&quick=1')).body;
    const screen = (await c.get(`/api/sessions/preview?id=${id}&lang=es&minutes=20&mode=comprehensive&quick=1`)).body;
    const s = await startSession(c, { id, language: 'es', minutes: 20, mode: 'comprehensive', quick: true, replaceActive: true });
    assert.equal(s.meta.newRequested, left, 'the rest of today’s target');
    assert.ok(home.newWords <= left && screen.newWords <= left);
    assert.equal(screen.newWords, s.meta.newPlanned, 'the start screen shows the plan Start gets');
    assert.equal(screen.total, s.exercises.length + s.meta.practice.reduce((n: number, p: any) => n + p.size, 0));
    await end(s.id);
  } finally {
    await c.put('/api/languages/es/settings', { dailyNewTarget: 10 });
  }
});

test('a pictures slot reached before any answer still fills up from the learner’s other words', async () => {
  const fill = await c.post('/api/practice/identify/batch', { language: 'es', scope: 'entries', entryIds: [], size: 5, fill: ['learning', 'all'] });
  assert.equal(fill.status, 200, JSON.stringify(fill.body));
  const without = await c.post('/api/practice/identify/batch', { language: 'es', scope: 'entries', entryIds: [], size: 5 });
  assert.equal(without.status, 422, 'the session’s own words alone: there must be some');
});
