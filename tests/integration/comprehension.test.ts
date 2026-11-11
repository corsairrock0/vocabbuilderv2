// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Reading comprehension against the passages shipped in data/reading/ (server/learning/comprehension.ts): the summary,
// the next passage and its fallback, grading, the level staying while texts of it are left (pass or fail), idempotent
// attempts, passages never served twice, and the 404 and 422 answers. Written to hold whatever the passage counts are.
// Short everyday passages and the level rule are tested against a small fixture (tests/fixtures/reading/), built the
// way the real files are and served through VB_READING_DIR: kind selection, step order, the three-question pass rule,
// the fallback, and the level moving up only with the last unread text of it (both kinds), through levels read before,
// never past a level without texts, and never past C1.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client, FIXTURE, startTestServer, type TestServer } from '../helpers/harness.ts';
import { loadComprehension } from '../../server/learning/comprehension.ts';
import { READING_LEVELS, type ComprehensionPassage, type ReadingLevel } from '../../shared/comprehension.ts';
// @ts-expect-error plain JavaScript build script
import { languageFile, readBatches } from '../../scripts/reading/build.mjs';

let srv: TestServer;
let c: Client;
let passages: ComprehensionPassage[];
/** Spanish A1 texts of both kinds: all of them have to be read before the level moves up. */
let a1Total = 0;
const LANG = 'es';

before(async () => {
  srv = await startTestServer();
  c = new Client(srv.url);
  await c.setup();
  const data = loadComprehension(srv.app, LANG);
  assert.ok(data, 'data/reading/es.json is missing: run node scripts/reading/build.mjs');
  // The real files may hold short passages too; these tests read the long ones (the default kind).
  passages = data.passages.filter((p) => p.kind === 'long');
  assert.ok(passages.filter((p) => p.level === 'A1').length >= 3, 'the tests need at least three long Spanish A1 passages');
  // These tests read four texts and expect the level to stay at A1, so A1 needs more than that.
  a1Total = data.passages.filter((p) => p.level === 'A1').length;
  assert.ok(a1Total >= 6, 'the tests need more Spanish A1 texts than they read');
});
after(() => srv.cleanup());

const rightAnswers = (p: ComprehensionPassage) => p.questions.map((q) => q.answer);
const wrongAnswers = (p: ComprehensionPassage) => p.questions.map((q) => (q.answer + 1) % q.options.length);
const attempt = (p: { id: string }, answers: number[], extra: Record<string, unknown> = {}) =>
  c.post('/api/practice/comprehension/attempts', { opId: randomUUID(), language: LANG, passageId: p.id, answers, answeredAt: Date.now(), ...extra });
const next = (body: Record<string, unknown> = {}) => c.post('/api/practice/comprehension/next', { language: LANG, ...body });
const level = async () => (await c.get('/api/settings')).body.languageSettings[LANG].readingLevel as ReadingLevel;
const read: string[] = [];

test('the summary gives the learner’s level and, per kind and level, the passages, read and passed', async () => {
  const r = await c.get(`/api/practice/comprehension/summary/${LANG}`);
  assert.equal(r.status, 200);
  const all = loadComprehension(srv.app, LANG)!.passages;
  assert.equal(r.body.level, 'A1');
  assert.deepEqual(r.body.progress, { level: 'A1', total: a1Total, read: 0 });
  assert.deepEqual([r.body.total, r.body.read, r.body.passed, r.body.available], [all.length, 0, 0, all.length]);
  const long = r.body.kinds.long;
  assert.deepEqual([long.total, long.read, long.passed, long.available], [passages.length, 0, 0, passages.length]);
  assert.deepEqual(
    long.levels.map((l: any) => [l.level, l.total, l.read, l.passed]),
    READING_LEVELS.map((l) => [l, passages.filter((p) => p.level === l).length, 0, 0]),
  );
  assert.equal(r.body.kinds.short.total, all.length - passages.length);
  const practice = await c.get(`/api/practice/summary/${LANG}`);
  assert.deepEqual(practice.body.comprehension, { level: 'A1', progress: { level: 'A1', total: a1Total, read: 0 }, total: all.length, read: 0, available: all.length });
});

test('next gives the first A1 passage in id order, with every question’s options, answer and explanation', async () => {
  const r = await next();
  assert.equal(r.status, 200);
  const first = passages.find((p) => p.level === 'A1')!;
  assert.equal(r.body.requested, 'A1');
  assert.equal(r.body.level, 'A1');
  assert.equal(r.body.fallback, false);
  assert.equal(r.body.passage.id, first.id);
  assert.equal(r.body.passage.title, first.title);
  assert.ok(r.body.passage.text.includes('\n\n') || r.body.passage.text.length > 200);
  assert.equal(r.body.passage.questions.length, 4);
  for (const q of r.body.passage.questions) {
    assert.equal(q.options.length, 4);
    assert.ok(Number.isInteger(q.answer) && q.answer >= 0 && q.answer <= 3);
    assert.ok(q.explain.length > 0);
  }
  assert.equal(r.body.total, passages.length);
  // How far the learner is through their level, both kinds: what the browser needs to show a level change at once.
  assert.deepEqual(r.body.progress, { level: 'A1', total: a1Total, read: 0 });
});

test('answering every question right passes, and the level stays A1 while A1 texts are left to read', async () => {
  const p = (await next()).body.passage as ComprehensionPassage;
  const r = await attempt(p, rightAnswers(p));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(
    { correct: r.body.correct, total: r.body.total, passed: r.body.passed, levelBefore: r.body.levelBefore, levelAfter: r.body.levelAfter, levelUp: r.body.levelUp },
    { correct: 4, total: 4, passed: true, levelBefore: 'A1', levelAfter: 'A1', levelUp: false },
  );
  assert.deepEqual(r.body.progress, { level: 'A1', total: a1Total, read: 1 });
  assert.ok(r.body.results.every((x: any) => x.correct));
  assert.equal(await level(), 'A1');
  read.push(p.id);
  const row = srv.app.db.get<any>('SELECT * FROM comprehension_attempts WHERE passage_id = ?', p.id);
  assert.equal(row.kind, 'long');
  assert.equal(row.level, 'A1');
  assert.deepEqual(JSON.parse(row.answers), rightAnswers(p));
  assert.equal(row.passed, 1);
  assert.deepEqual([row.level_before, row.level_after], ['A1', 'A1']);
  assert.equal(row.device_id, c.deviceId);
  const s = (await c.get(`/api/practice/comprehension/summary/${LANG}`)).body;
  assert.equal(s.level, 'A1');
  assert.deepEqual(s.progress, { level: 'A1', total: a1Total, read: 1 });
  assert.deepEqual([s.kinds.long.read, s.kinds.long.passed, s.kinds.long.available], [1, 1, passages.length - 1]);
  assert.deepEqual(s.kinds.long.levels.find((l: any) => l.level === 'A1').read, 1);
});

test('the same attempt sent twice is saved once and gives the stored result', async () => {
  const p = passages.find((x) => x.level === 'A1' && !read.includes(x.id))!;
  const opId = randomUUID();
  // Three of four right: a pass, but A1 texts are left, so no change.
  const answers = rightAnswers(p).map((a, i) => (i === 0 ? (a + 1) % 4 : a));
  const first = await attempt(p, answers, { opId });
  assert.equal(first.status, 200);
  assert.deepEqual([first.body.correct, first.body.passed, first.body.levelBefore, first.body.levelAfter, first.body.levelUp], [3, true, 'A1', 'A1', false]);
  assert.deepEqual(first.body.progress, { level: 'A1', total: a1Total, read: 2 });
  const again = await attempt(p, rightAnswers(p), { opId });
  assert.equal(again.status, 200);
  assert.equal(again.body.duplicate, true);
  for (const k of ['passageId', 'correct', 'total', 'passed', 'levelBefore', 'levelAfter', 'levelUp', 'progress', 'results']) assert.deepEqual(again.body[k], first.body[k], k);
  assert.equal(srv.app.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM comprehension_attempts WHERE op_id = ?', opId)!.n, 1);
  assert.equal(await level(), 'A1');
  read.push(p.id);
});

test('a passage read is never served again, and passages can be excluded', async () => {
  const unreadA1 = passages.filter((p) => p.level === 'A1' && !read.includes(p.id));
  const r = await next({ level: 'A1' });
  assert.equal(r.body.passage.id, unreadA1[0].id);
  assert.ok(!read.includes(r.body.passage.id));
  if (unreadA1.length > 1) {
    const x = await next({ level: 'A1', exclude: [unreadA1[0].id] });
    assert.equal(x.body.passage.id, unreadA1[1].id);
    assert.equal(x.body.fallback, false);
  }
  // With every A1 passage read or excluded, the next comes from the nearest higher level that has one left.
  const all = await next({ level: 'A1', exclude: unreadA1.slice(0, 50).map((p) => p.id) });
  if (unreadA1.length <= 50) {
    const nextLevel = READING_LEVELS.slice(1).find((l) => passages.some((p) => p.level === l));
    if (nextLevel) {
      assert.equal(all.body.passage.id, passages.find((p) => p.level === nextLevel)!.id);
      assert.equal(all.body.level, nextLevel);
      assert.equal(all.body.fallback, true);
    } else assert.equal(all.body.passage, null);
    // The texts the device asks to skip count as read in the progress (their attempts may still be on the way).
    assert.deepEqual(all.body.progress, { level: 'A1', total: a1Total, read: read.length + unreadA1.length });
  }
  // By default the next passage comes at the learner's level, still A1.
  const byDefault = await next();
  assert.equal(byDefault.body.requested, 'A1');
  assert.ok(!read.includes(byDefault.body.passage.id));
});

test('a failed passage leaves the level where it is', async () => {
  const p = (await next()).body.passage as ComprehensionPassage;
  const r = await attempt(p, wrongAnswers(p));
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.correct, r.body.passed, r.body.levelBefore, r.body.levelAfter, r.body.levelUp], [0, false, 'A1', 'A1', false]);
  const half = passages.find((x) => !read.includes(x.id) && x.id !== p.id)!;
  const two = await attempt(half, rightAnswers(half).map((a, i) => (i < 2 ? a : -1)));
  assert.deepEqual([two.body.correct, two.body.passed, two.body.levelAfter], [2, false, 'A1']);
  assert.equal(await level(), 'A1');
  read.push(p.id, half.id);
  const s = (await c.get(`/api/practice/comprehension/summary/${LANG}`)).body;
  assert.deepEqual([s.read, s.passed], [4, 2]);
  assert.deepEqual([s.kinds.long.read, s.kinds.long.passed], [4, 2]);
  // Attempts are part of the progress export.
  const exp = await c.get('/api/export/progress');
  assert.equal(exp.body.data.comprehension_attempts.length, 4);
});

test('an unknown passage or language is 404; malformed requests are 422', async () => {
  const p = passages.find((x) => !read.includes(x.id))!;
  assert.equal((await attempt({ id: 'es-A1-9-99' }, [0, 0, 0, 0])).status, 404);
  assert.equal((await attempt(p, [0, 0, 0, 0], { language: 'pt' })).status, 404, 'a Spanish passage is not a Portuguese one');
  assert.equal((await c.get('/api/practice/comprehension/summary/xx')).status, 404);
  assert.equal((await attempt(p, [])).status, 422, 'no answers');
  assert.equal((await attempt(p, [0, 1, 2])).status, 422, 'an answer missing');
  assert.equal((await attempt(p, [0, 1, 2, 10])).status, 422, 'an answer out of range');
  assert.equal((await attempt(p, [0, 1, 2, 1.5])).status, 422, 'not a whole number');
  assert.equal((await attempt(p, [0, 1, 2, 3], { opId: 'short' })).status, 422);
  assert.equal((await attempt(p, [0, 1, 2, 3], { language: 'xx' })).status, 422);
  assert.equal((await next({ level: 'C2' })).status, 422);
  assert.equal((await next({ exclude: Array.from({ length: 51 }, (_, i) => `es-A1-1-${i}`) })).status, 422);
  assert.equal((await c.post('/api/practice/comprehension/next', { level: 'A1' })).status, 422, 'no language');
  assert.equal((await next({ kind: 'medium' })).status, 422, 'an unknown kind');
  // Nothing was stored by the refused attempts.
  assert.equal(srv.app.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM comprehension_attempts')!.n, 4);
  assert.equal(await level(), 'A1');
});

describe('short everyday passages and the level rule (fixture)', () => {
  // tests/fixtures/reading: long es-A1-1-01, -02, es-A2-1-01, es-C1-1-01 and -02; short es-A1-S1-01 (step 2), -02
  // (step 3), -03 (step 1) and es-B1-S1-01 (step 1). Short passages have three questions. So A1 has five texts (both
  // kinds), A2 and B1 one each, B2 none and C1 two.
  let fx: TestServer;
  let f: Client;
  let dir: string;
  const fixtureNext = (body: Record<string, unknown>) => f.post('/api/practice/comprehension/next', { language: 'es', ...body });
  const fixtureAttempt = (p: ComprehensionPassage, answers: number[]) =>
    f.post('/api/practice/comprehension/attempts', { opId: randomUUID(), language: 'es', passageId: p.id, answers, answeredAt: Date.now() });
  const right = (p: ComprehensionPassage, n: number) => p.questions.map((q, i) => (i < n ? q.answer : (q.answer + 1) % 4));
  const byId = (id: string) => loadComprehension(fx.app, 'es')!.passages.find((p) => p.id === id)!;
  const fixtureLevel = async () => (await f.get('/api/settings')).body.languageSettings.es.readingLevel as ReadingLevel;
  const outcome = (r: { body: any }) => [r.body.passed, r.body.levelBefore, r.body.levelAfter, r.body.levelUp, r.body.progress];
  const progress = (level: ReadingLevel, total: number, read: number) => ({ level, total, read });

  before(async () => {
    const src = path.join(FIXTURE, 'reading');
    const built = readBatches(readdirSync(src).map((name: string) => path.join(src, name)));
    assert.deepEqual(built.problems, []);
    dir = mkdtempSync(path.join(tmpdir(), 'vb-reading-fixture-'));
    writeFileSync(path.join(dir, 'es.json'), languageFile('es', built.byLang.get('es')));
    fx = await startTestServer({ env: { VB_READING_DIR: dir } });
    f = new Client(fx.url);
    await f.setup();
  });
  after(async () => {
    await fx.cleanup();
    rmSync(dir, { recursive: true, force: true });
  });

  test('the summary counts each kind per level, and how far the learner is through their level', async () => {
    const s = (await f.get('/api/practice/comprehension/summary/es')).body;
    assert.deepEqual([s.total, s.kinds.long.total, s.kinds.short.total], [9, 5, 4]);
    assert.deepEqual(s.kinds.short.levels.map((l: any) => l.total), [3, 0, 1, 0, 0]);
    assert.deepEqual(s.kinds.long.levels.map((l: any) => l.total), [2, 1, 0, 0, 2]);
    assert.deepEqual(s.progress, progress('A1', 5, 0), 'both kinds count toward the level');
    assert.deepEqual((await f.get('/api/practice/summary/es')).body.comprehension.progress, progress('A1', 5, 0));
  });

  test('the kind decides what is served: long by default, short ones from step 1 with three questions', async () => {
    const long = (await fixtureNext({})).body;
    assert.deepEqual([long.kind, long.passage.id, long.passage.kind, long.passage.questions.length], ['long', 'es-A1-1-01', 'long', 4]);
    assert.deepEqual(long.progress, progress('A1', 5, 0));
    const short = (await fixtureNext({ kind: 'short' })).body;
    assert.deepEqual([short.kind, short.passage.id, short.passage.step, short.passage.format, short.passage.genre, short.fallback], ['short', 'es-A1-S1-03', 1, 'dialogue', 'everyday', false]);
    assert.equal(short.passage.questions.length, 3);
    assert.ok(short.passage.text.includes('por favor.\n—¿Con leche?'), 'the dialogue keeps its line breaks');
    assert.deepEqual([short.total, short.available], [4, 4]);
    // Texts the device asks to skip (read, attempts on the way) count as read in the progress; other levels don't.
    const skipping = (await fixtureNext({ kind: 'short', exclude: ['es-A1-S1-03', 'es-B1-S1-01'] })).body;
    assert.deepEqual([skipping.passage.id, skipping.progress], ['es-A1-S1-01', progress('A1', 5, 1)]);
  });

  test('C1 is the top: with every C1 text read, a C1 reader stays at C1', async () => {
    // The learner picks C1 on the Practice page (the level is the shared setting) and reads both C1 passages.
    assert.equal((await f.put('/api/languages/es/settings', { readingLevel: 'C1' })).status, 200);
    // No short C1 text, nor any higher level: the nearest lower level with a short one, B1.
    const lower = (await fixtureNext({ kind: 'short' })).body;
    assert.deepEqual([lower.requested, lower.passage.id, lower.level, lower.fallback, lower.progress], ['C1', 'es-B1-S1-01', 'B1', true, progress('C1', 2, 0)]);
    for (const [i, id] of ['es-C1-1-01', 'es-C1-1-02'].entries()) {
      const n = (await fixtureNext({ kind: 'long' })).body;
      assert.deepEqual([n.requested, n.passage.id, n.fallback, n.progress], ['C1', id, false, progress('C1', 2, i)]);
      assert.deepEqual(outcome(await fixtureAttempt(n.passage, right(n.passage, 4))), [true, 'C1', 'C1', false, progress('C1', 2, i + 1)]);
    }
    assert.equal(await fixtureLevel(), 'C1');
    // Back to A1, as on the Practice page.
    assert.equal((await f.put('/api/languages/es/settings', { readingLevel: 'A1' })).status, 200);
  });

  test('a pass or a fail changes nothing by itself, and texts at other levels never count toward the learner’s level', async () => {
    const first = (await fixtureNext({ kind: 'short' })).body.passage as ComprehensionPassage;
    const pass = await fixtureAttempt(first, right(first, 2));
    assert.equal(pass.status, 200, JSON.stringify(pass.body));
    assert.deepEqual([pass.body.correct, pass.body.total], [2, 3]);
    // Two of three passes a short text; the level stays, and the C1 texts read before count nowhere near A1.
    assert.deepEqual(outcome(pass), [true, 'A1', 'A1', false, progress('A1', 5, 1)]);
    assert.equal(fx.app.db.get<{ kind: string }>('SELECT kind FROM comprehension_attempts WHERE passage_id = ?', first.id)!.kind, 'short');
    // The next short A1 passage is step 2 (es-A1-S1-01), whatever the ids say; failing it moves the level no more.
    const second = (await fixtureNext({ kind: 'short', level: 'A1' })).body.passage as ComprehensionPassage;
    assert.equal(second.id, 'es-A1-S1-01');
    const fail = await fixtureAttempt(second, right(second, 1));
    assert.deepEqual([fail.body.correct, fail.body.total], [1, 3]);
    assert.deepEqual(outcome(fail), [false, 'A1', 'A1', false, progress('A1', 5, 2)]);
    assert.equal((await fixtureNext({ kind: 'short', level: 'A1' })).body.passage.id, 'es-A1-S1-02', 'then step 3');
    // Served as a fallback: with the last short A1 text skipped, the short B1 one. All right, it counts only for B1.
    const fb = (await fixtureNext({ kind: 'short', level: 'A1', exclude: ['es-A1-S1-02'] })).body;
    assert.deepEqual([fb.passage.id, fb.level, fb.fallback], ['es-B1-S1-01', 'B1', true]);
    assert.deepEqual(outcome(await fixtureAttempt(fb.passage, right(fb.passage, 3))), [true, 'A1', 'A1', false, progress('A1', 5, 2)]);
    assert.equal(await fixtureLevel(), 'A1');
    const s = (await f.get('/api/practice/comprehension/summary/es')).body;
    assert.deepEqual([s.read, s.passed, s.progress], [5, 4, progress('A1', 5, 2)]);
  });

  let upOpId = '';
  test('the last unread text of the level moves it up one step, pass or fail; a level read before is passed through, an empty one never', async () => {
    // Left at A1: es-A1-S1-02 (short), es-A1-1-01 and es-A1-1-02 (long). All failed, and the level still moves.
    for (const [i, id] of ['es-A1-S1-02', 'es-A1-1-01'].entries()) {
      assert.deepEqual(outcome(await fixtureAttempt(byId(id), right(byId(id), 0))), [false, 'A1', 'A1', false, progress('A1', 5, 3 + i)], `${id}: one or more left`);
    }
    const last = (await fixtureNext({ kind: 'long' })).body;
    assert.deepEqual([last.passage.id, last.progress], ['es-A1-1-02', progress('A1', 5, 4)]);
    upOpId = randomUUID();
    const up = await f.post('/api/practice/comprehension/attempts', { opId: upOpId, language: 'es', passageId: last.passage.id, answers: right(last.passage, 0), answeredAt: Date.now() });
    assert.deepEqual(outcome(up), [false, 'A1', 'A2', true, progress('A2', 1, 0)], 'one step: A2 has a text left');
    assert.equal(await fixtureLevel(), 'A2');
    const row = fx.app.db.get<any>('SELECT level_before, level_after FROM comprehension_attempts WHERE op_id = ?', upOpId);
    assert.deepEqual([row.level_before, row.level_after], ['A1', 'A2']);
    // A2's only text, failed: A2 is done, and so is B1, whose only text was read as a fallback. B2 has no texts, so the
    // level stops there, although every C1 text has been read.
    const a2 = (await fixtureNext({ kind: 'long' })).body;
    assert.deepEqual([a2.requested, a2.passage.id, a2.fallback, a2.progress], ['A2', 'es-A2-1-01', false, progress('A2', 1, 0)]);
    assert.deepEqual(outcome(await fixtureAttempt(a2.passage, right(a2.passage, 1))), [false, 'A2', 'B2', true, progress('B2', 0, 0)]);
    assert.equal(await fixtureLevel(), 'B2');
    const s = (await f.get('/api/practice/comprehension/summary/es')).body;
    assert.deepEqual([s.read, s.available, s.level, s.progress], [9, 0, 'B2', progress('B2', 0, 0)]);
    assert.equal((await fixtureNext({ kind: 'long' })).body.passage, null, 'nothing is left to read');
  });

  test('a replay gives the stored levels and never moves the level again', async () => {
    const again = await f.post('/api/practice/comprehension/attempts', { opId: upOpId, language: 'es', passageId: 'es-A1-1-02', answers: right(byId('es-A1-1-02'), 4), answeredAt: Date.now() });
    assert.equal(again.status, 200, JSON.stringify(again.body));
    assert.equal(again.body.duplicate, true);
    assert.deepEqual([again.body.correct, again.body.passed, again.body.levelBefore, again.body.levelAfter, again.body.levelUp], [0, false, 'A1', 'A2', true]);
    // The progress is through that level as it is now: A2's text has been read since.
    assert.deepEqual(again.body.progress, progress('A2', 1, 1));
    assert.equal(fx.app.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM comprehension_attempts WHERE op_id = ?', upOpId)!.n, 1);
    assert.equal(await fixtureLevel(), 'B2');
  });
});
