// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Writing practice (1.9.0) through the server, with a small fixture of Spanish sentences: the next sentence in step
// order, grading on the server, a wrong sentence coming back after other answers, the level rising only with the
// last sentence of the level written right, "I was right", idempotent answers, the summaries, the
// statistics, the Writing slots of a Comprehensive session, and a session's words coming first (Portuguese).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client, startTestServer, type TestServer } from '../helpers/harness.ts';
import type { Db } from '../../server/db/database.ts';

let srv: TestServer;
let c: Client;
let db: Db;

const sentence = (level: string, step: number, en: string, answers: string[]) => ({ id: `es-${level}-1-${String(step).padStart(3, '0')}`, level, step, topic: 'home', en, answers });
const fixture = [
  sentence('A1', 1, 'I am tired.', ['{|Yo }estoy {cansado|cansada}.']),
  sentence('A1', 2, 'The house is big.', ['La casa es grande.']),
  sentence('A1', 3, 'Where is the bathroom?', ['¿Dónde {está|queda} el baño?']),
  sentence('A2', 1, 'Yesterday I went to the market.', ['Ayer fui al mercado.']),
];

// estar is in three of these sentences (estou, está), casa in one, água and dias (dia) in one.
const pt = (step: number, en: string, answers: string[]) => ({ id: `pt-A1-1-${String(step).padStart(3, '0')}`, level: 'A1', step, topic: 'home', en, answers });
const ptFixture = [
  pt(1, 'I am tired.', ['{|Eu }estou {cansado|cansada}.']),
  pt(2, 'The house is big.', ['A casa é grande.']),
  pt(3, 'The dog is happy.', ['O cachorro está feliz.']),
  pt(4, 'I drink water every day.', ['{|Eu }bebo água todos os dias.']),
  pt(5, 'The cat is sleeping.', ['O gato está dormindo.']),
];

before(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'vb-writing-'));
  writeFileSync(path.join(dir, 'es.json'), JSON.stringify({ format: 'vocabbuilder-writing-v1', language: 'es', version: 't', copyright: '© 2026 Lango.', credit: 'test', sentences: fixture }));
  writeFileSync(path.join(dir, 'pt.json'), JSON.stringify({ format: 'vocabbuilder-writing-v1', language: 'pt', version: 't', copyright: '© 2026 Lango.', credit: 'test', sentences: ptFixture }));
  srv = await startTestServer({ env: { VB_WRITING_DIR: dir } });
  c = new Client(srv.url);
  await c.setup();
  db = srv.app.db;
});
after(() => srv.cleanup());

const next = async (body: Record<string, unknown> = {}) => {
  const r = await c.post('/api/practice/writing/next', { language: 'es', ...body });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
};
const answer = async (sentenceId: string, response: string, opId = randomUUID()) => {
  const r = await c.post('/api/practice/writing/attempts', { opId, language: 'es', sentenceId, response, answeredAt: Date.now() });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return { ...r.body, opId };
};

test('sentences come in step order at the writing level, are graded on the server, and a wrong one comes back later', async () => {
  const first = await next();
  assert.equal(first.sentence.id, 'es-A1-1-001');
  assert.deepEqual([first.requested, first.level, first.fallback, first.again], ['A1', 'A1', false, false]);
  assert.deepEqual(first.progress, { level: 'A1', total: 3, read: 0 });
  assert.deepEqual(first.sentence.accepted, []);
  const wrong = await answer('es-A1-1-001', 'Yo soy cansado.');
  assert.equal(wrong.correct, false);
  assert.equal(wrong.grade.closest, 'Yo estoy cansado.');
  assert.deepEqual(wrong.grade.answerWords.map((w: any) => w.ok), [true, false, true]);
  // The wrong one waits: the next sentence in step order comes first.
  assert.equal((await next()).sentence.id, 'es-A1-1-002');
  const right = await answer('es-A1-1-002', 'la casa es GRANDE');
  assert.deepEqual([right.correct, right.levelUp, right.progress.read], [true, false, 1]);
  // A repeated answer counts once.
  const again = await answer('es-A1-1-002', 'la casa es grande', right.opId);
  assert.equal(again.duplicate, true);
  assert.equal(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM writing_attempts WHERE sentence_id = 'es-A1-1-002'")!.n, 1);
  assert.equal((await next()).sentence.id, 'es-A1-1-003');
  assert.equal((await next({ exclude: ['es-A1-1-003'] })).sentence.id, 'es-A1-1-001', 'with nothing else left, the wrong one comes back');
});

test('the level rises only when every sentence of it is written right; "I was right" counts and is remembered', async () => {
  const third = await answer('es-A1-1-003', '¿Dónde queda el baño?');
  assert.equal(third.correct, true);
  assert.equal(third.levelAfter, 'A1', 'sentence 1 is still not right');
  const back = await next();
  assert.deepEqual([back.sentence.id, back.again], ['es-A1-1-001', true]);
  // The learner's wording is graded wrong; they say it was right.
  const mine = await answer('es-A1-1-001', 'Me siento cansado.');
  assert.equal(mine.correct, false);
  const accepted = await c.post('/api/practice/writing/accept', { opId: mine.opId, language: 'es' });
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  assert.deepEqual([accepted.body.correct, accepted.body.accepted, accepted.body.levelAfter, accepted.body.levelUp], [true, true, 'A2', true]);
  assert.equal(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM writing_attempts WHERE correct = 1 AND accepted = 1")!.n, 1);
  const settings = (await c.get('/api/bootstrap')).body.languageSettings.es;
  assert.equal(settings.writingLevel, 'A2', 'every device sees the new level');
  // Accepting again changes nothing more; the wording is right from now on.
  const twice = await c.post('/api/practice/writing/accept', { opId: mine.opId, language: 'es' });
  assert.equal(twice.body.correct, true);
  const nextOne = await next();
  assert.deepEqual([nextOne.sentence.id, nextOne.level], ['es-A2-1-001', 'A2']);
  const regraded = await answer('es-A1-1-001', 'me siento cansado');
  assert.equal(regraded.correct, true, 'the accepted wording counts as right');
  // An empty answer ("I don't know") can't be counted as right.
  const blank = await answer('es-A2-1-001', '');
  assert.equal(blank.correct, false);
  assert.equal((await c.post('/api/practice/writing/accept', { opId: blank.opId, language: 'es' })).status, 422);
  assert.equal((await c.post('/api/practice/writing/attempts', { opId: randomUUID(), language: 'es', sentenceId: 'es-B1-1-001', response: 'x', answeredAt: Date.now() })).status, 404);
});

test('summaries, statistics, and the Writing slots of a Comprehensive session (none where a language has no sentences)', async () => {
  const s = (await c.get('/api/practice/writing/summary/es')).body;
  assert.deepEqual([s.level, s.total, s.done, s.available], ['A2', 4, 3, 1]);
  assert.deepEqual(s.levels.slice(0, 2), [{ level: 'A1', total: 3, done: 3 }, { level: 'A2', total: 1, done: 0 }]);
  const practice = (await c.get('/api/practice/summary/es')).body;
  assert.equal(practice.writing.total, 4);
  assert.ok(practice.writing.attempts7d >= 6);
  const progress = (await c.get('/api/stats/progress/es/period?window=7')).body;
  const card = progress.skills.find((k: any) => k.key === 'writing');
  assert.ok(card.answers >= 6, JSON.stringify(card));
  // A Comprehensive session plans Writing while sentences are left to write.
  await c.post('/api/import/starter', { language: 'es' });
  const planned = await c.post('/api/sessions', { id: randomUUID(), language: 'es', minutes: 20, newWords: 3, mode: 'comprehensive', replaceActive: true });
  assert.equal(planned.status, 200, JSON.stringify(planned.body).slice(0, 300));
  const writing = planned.body.meta.practice.filter((p: any) => p.kind === 'writing');
  assert.equal(writing.length, 3, 'about one per five model minutes: 20 real minutes at pace 2');
  assert.ok(writing.every((p: any) => p.size === 1));
  const ev = await c.post(`/api/sessions/${planned.body.id}/events`, { type: 'round', roundId: writing[0].id, skill: 'writing', grades: ['correct'], end: true, at: Date.now() });
  assert.equal(ev.status, 200, JSON.stringify(ev.body));
  assert.deepEqual((await c.get(`/api/sessions/${planned.body.id}`)).body.meta.rounds.writing, { rounds: 1, answered: 1, correct: 1 });
  // Russian has no sentences in this fixture: no Writing slots.
  await c.post('/api/import/starter', { language: 'ru' });
  const ru = await c.post('/api/sessions', { id: randomUUID(), language: 'ru', minutes: 20, newWords: 3, mode: 'comprehensive', replaceActive: true });
  assert.equal(ru.status, 200, JSON.stringify(ru.body).slice(0, 300));
  assert.equal(ru.body.meta.practice.filter((p: any) => p.kind === 'writing').length, 0);
});

test('a study session’s words come first: the sentence that uses them, the rarer word counting for more, else the usual order', async () => {
  await c.post('/api/import/starter', { language: 'pt' });
  const id = (lemma: string) => db.get<{ id: number }>("SELECT id FROM vocabulary_entries WHERE language_code = 'pt' AND lemma = ? AND deleted_at IS NULL ORDER BY id LIMIT 1", lemma)!.id;
  const [agua, casa, estar, dia] = ['água', 'casa', 'estar', 'dia'].map(id);
  const es = db.get<{ id: number }>("SELECT id FROM vocabulary_entries WHERE language_code = 'es' AND deleted_at IS NULL LIMIT 1")!.id;
  const pick = async (entryIds?: number[]) => {
    const r = await c.post('/api/practice/writing/next', { language: 'pt', ...(entryIds ? { entryIds } : {}) });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return r.body;
  };
  const plain = await pick();
  assert.deepEqual([plain.sentence.id, plain.uses], ['pt-A1-1-001', undefined], 'outside a session: step order');
  assert.deepEqual([(await pick([agua])).sentence.id, (await pick([agua])).uses], ['pt-A1-1-004', [agua]]);
  // estar's forms (estou, está) are in three sentences: the first of them comes; with água, água's sentence wins.
  assert.deepEqual([(await pick([estar])).sentence.id, (await pick([estar])).uses], ['pt-A1-1-001', [estar]]);
  assert.equal((await pick([estar, agua])).sentence.id, 'pt-A1-1-004');
  // As good a fit: the easier sentence. Two of the words beat one.
  assert.equal((await pick([agua, casa])).sentence.id, 'pt-A1-1-002');
  assert.deepEqual((await pick([casa, agua, dia])).uses, [agua, dia]);
  // A word of another language, or one that is no word at all, changes nothing.
  assert.deepEqual([(await pick([es, 99999999])).sentence.id, (await pick([es, 99999999])).uses], ['pt-A1-1-001', []]);
  // Answered wrong just now, the sentence waits like any other: no other sentence uses água, so the usual order holds.
  assert.equal((await c.post('/api/practice/writing/attempts', { opId: randomUUID(), language: 'pt', sentenceId: 'pt-A1-1-004', response: 'Eu bebo', answeredAt: Date.now() })).body.correct, false);
  assert.deepEqual([(await pick([agua])).sentence.id, (await pick([agua])).uses], ['pt-A1-1-001', []]);
  // Written right, a sentence is done and never comes for its words again.
  assert.equal((await c.post('/api/practice/writing/attempts', { opId: randomUUID(), language: 'pt', sentenceId: 'pt-A1-1-002', response: 'A casa é grande', answeredAt: Date.now() })).body.correct, true);
  assert.equal((await pick([casa])).sentence.id, 'pt-A1-1-001');
  assert.equal((await c.post('/api/practice/writing/next', { language: 'pt', entryIds: [0] })).status, 422);
});
