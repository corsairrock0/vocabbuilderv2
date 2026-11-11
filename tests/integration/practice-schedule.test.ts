// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Every kind of question updates the memory schedule (2.0.0): grammar forms, sentence gaps, Identify and Writing
// answers are FSRS events for the word they test (server/learning/scheduling.ts scheduleFromPractice). Covered: which
// memory each question tests and its rating (right Good, hinted or close Hard, wrong Again), one event per memory per
// day and never both memories of a word in a day, a word whose other memory is due waiting for that review, an early
// answer and an early miss, no event for words not scheduled yet, due words asked first, Writing rating each word being
// learned in the translation, and "I was right" turning a miss into Good with the card recomputed.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client, startTestServer, type TestServer } from '../helpers/harness.ts';
import type { Db } from '../../server/db/database.ts';
import { applyReview, ensureCards, getCard, type CardRow } from '../../server/learning/scheduling.ts';
import { getTimezone } from '../../server/services/settings.ts';
import { endOfLocalDay, localDay } from '../../shared/time.ts';
import type { CardSkill } from '../../shared/exercises.ts';
import type { Rating } from '../../shared/fsrs.ts';

const DAY = 86_400_000;
let srv: TestServer;
let c: Client;
let db: Db;
let writingDir: string;
let tz: string;
const ids: Record<string, number> = {};
const sentences: Record<string, number> = {};

const verb = (lemma: string, gloss: string, cells: Record<string, string[]>, text: string, translation: string) => ({
  lemma,
  pos: 'verb',
  senses: [{ gloss }],
  examples: [{ text, translation, target: lemma }],
  paradigm: { kind: 'verb', source: 'test', cells: { ...cells, 'nfin|inf': [lemma] } },
});
const noun = (lemma: string, gloss: string, gender: string, text: string, translation: string) => ({
  lemma,
  pos: 'noun',
  gender,
  senses: [{ gloss }],
  examples: [{ text, translation, target: lemma }],
});
const esDoc = {
  format: 'vocabbuilder-v1',
  language: 'es',
  source: { name: 'Practice scheduling test set (es)', kind: 'curated', license: 'CC0-1.0' },
  entries: [
    verb('hablar', 'to speak', { 'ind.pres|1s': ['hablo'], 'ind.pres|3s': ['habla'] }, 'Quiero hablar contigo.', 'I want to talk to you.'),
    verb('comer', 'to eat', { 'ind.pres|1s': ['como'], 'ind.pres|3s': ['come'] }, 'Vamos a comer ahora.', "Let's eat now."),
    verb('vivir', 'to live', { 'ind.pres|1s': ['vivo'], 'ind.pres|3s': ['vive'] }, 'Quiero vivir aquí.', 'I want to live here.'),
    verb('beber', 'to drink', { 'ind.pres|1s': ['bebo'] }, 'Voy a beber agua.', "I'm going to drink water."),
    verb('abrir', 'to open', { 'ind.pres|1s': ['abro'] }, 'Puedes abrir la puerta.', 'You can open the door.'),
    verb('leer', 'to read', { 'ind.pres|1s': ['leo'] }, 'Me gusta leer.', 'I like to read.'),
    noun('escuela', 'school', 'f', 'La escuela está cerca.', 'The school is near.'),
    noun('tren', 'train', 'm', 'El tren llega tarde.', 'The train is late.'),
    noun('casa', 'house', 'f', 'Mi casa es pequeña.', 'My house is small.'),
    noun('perro', 'dog', 'm', 'Tengo un perro.', 'I have a dog.'),
    noun('gato', 'cat', 'm', 'El gato duerme.', 'The cat sleeps.'),
  ],
};
const writing = (step: number, en: string, answers: string[]) => ({ id: `es-A1-1-${String(step).padStart(3, '0')}`, level: 'A1', step, topic: 'home', en, answers });
const writingFixture = [
  writing(1, 'The house is big.', ['La casa es grande.']),
  writing(2, 'The dog is happy.', ['El perro está feliz.']),
  writing(3, 'The cat is sleeping.', ['El gato está durmiendo.']),
];

before(async () => {
  writingDir = mkdtempSync(path.join(tmpdir(), 'vb-practice-schedule-'));
  writeFileSync(
    path.join(writingDir, 'es.json'),
    JSON.stringify({ format: 'vocabbuilder-writing-v1', language: 'es', version: 't', copyright: '© 2026 Lango.', credit: 'test', sentences: writingFixture }),
  );
  srv = await startTestServer({ env: { VB_WRITING_DIR: writingDir } });
  c = new Client(srv.url);
  await c.setup();
  db = srv.app.db;
  tz = getTimezone(db, srv.config.defaultTimezone);
  const up = await c.post('/api/import/upload?lang=es&kind=vocabulary&filename=set.json', Buffer.from(JSON.stringify(esDoc)), { 'Content-Type': 'application/octet-stream' });
  assert.equal(up.status, 200, JSON.stringify(up.body));
  const commit = await c.post(`/api/import/${up.body.id}/commit`, { mapping: {}, options: {} });
  assert.equal(commit.status, 200, JSON.stringify(commit.body));
  for (const r of db.all<{ id: number; lemma: string }>("SELECT id, lemma FROM vocabulary_entries WHERE language_code = 'es'")) ids[r.lemma] = r.id;
  for (const r of db.all<{ id: number; lemma: string }>('SELECT s.id, e.lemma FROM example_sentences s JOIN entry_examples ee ON ee.sentence_id = s.id JOIN vocabulary_entries e ON e.id = ee.entry_id'))
    sentences[r.lemma] = r.id;

  // Learning histories, built with the scheduler itself so cards and logs agree. A first session rates both memories
  // (aggregated, the same day); later reviews are a day or more apart.
  const both = (daysAgo: number) => ({ daysAgo, skill: 'both' as const });
  learn('hablar', 'active', [both(10)]); // both memories due
  learn('comer', 'active', [both(10), { daysAgo: 3, skill: 'productive' }]); // recognition due, recall later
  learn('vivir', 'active', [both(10), { daysAgo: 4, skill: 'receptive' }, { daysAgo: 3, skill: 'productive' }]); // neither due
  learn('beber', 'introduced', []); // met in a session, not scheduled yet
  learn('abrir', 'active', []); // cards never rated
  // leer: no learning item at all.
  learn('escuela', 'active', [both(10)]);
  learn('tren', 'active', [both(10), { daysAgo: 4, skill: 'receptive' }, { daysAgo: 3, skill: 'productive' }]);
  learn('casa', 'active', [both(10)]);
  learn('perro', 'active', [both(10)]);
  learn('gato', 'active', [both(10), { daysAgo: 3, skill: 'productive' }]);
});
after(async () => {
  await srv.cleanup();
  rmSync(writingDir, { recursive: true, force: true });
});

function learn(lemma: string, status: 'active' | 'introduced', events: Array<{ daysAgo: number; skill: CardSkill | 'both'; rating?: Rating }>) {
  const now = Date.now();
  db.tx(() => {
    const first = events.length ? now - events[0].daysAgo * DAY : now;
    db.run(
      'INSERT INTO learning_items (entry_id, language_code, status, introduced_at, introduced_day, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ids[lemma],
      'es',
      status,
      first,
      localDay(first, tz),
      now,
      now,
    );
    const itemId = db.get<{ id: number }>('SELECT id FROM learning_items WHERE entry_id = ?', ids[lemma])!.id;
    ensureCards(db, itemId, 'es', now);
    for (const e of events) {
      for (const skill of e.skill === 'both' ? (['receptive', 'productive'] as const) : [e.skill]) {
        const change = applyReview(db, {
          card: getCard(db, itemId, skill)!,
          rating: e.rating ?? 3,
          reviewedAt: now - e.daysAgo * DAY,
          timezone: tz,
          opId: `setup:${randomUUID()}`,
          ratingSource: e.skill === 'both' ? 'aggregate' : 'auto',
          exerciseKind: null,
          attemptId: null,
          sessionId: null,
          deviceId: null,
          now,
        });
        assert.ok(change, `setup review of ${lemma} (${skill})`);
      }
    }
  });
}

const card = (lemma: string, skill: CardSkill) => {
  const item = db.get<{ id: number }>('SELECT id FROM learning_items WHERE entry_id = ?', ids[lemma])!;
  return getCard(db, item.id, skill)!;
};
const endOfToday = () => endOfLocalDay(Date.now(), tz);
const isDue = (k: CardRow) => k.due != null && k.due < endOfToday();
const logsOf = (lemma: string) =>
  db.all<{ op_id: string; skill: string; rating: number; rating_source: string; exercise_kind: string; local_day: string }>(
    `SELECT r.op_id, r.skill, r.rating, r.rating_source, r.exercise_kind, r.local_day FROM review_logs r
      JOIN learning_items li ON li.id = r.item_id WHERE li.entry_id = ? AND r.op_id NOT LIKE 'setup:%' ORDER BY r.id`,
    ids[lemma],
  ).map((r) => ({ ...r }));
const practice = async (body: Record<string, unknown>) => {
  const opId = randomUUID();
  const r = await c.post('/api/practice/attempts', { opId, answeredAt: Date.now(), ...body });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return { ...r.body, opId };
};
const form = (lemma: string, cell: string, response: string, extra: Record<string, unknown> = {}) => practice({ mode: 'forms', entryId: ids[lemma], cell, response, ...extra });
const gap = (lemma: string, response: string, choice: boolean) => practice({ mode: 'cloze', entryId: ids[lemma], sentenceId: sentences[lemma], response, choice });
const write = async (sentenceId: string, response: string) => {
  const opId = randomUUID();
  const r = await c.post('/api/practice/writing/attempts', { opId, language: 'es', sentenceId, response, answeredAt: Date.now() });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return { ...r.body, opId };
};

test('the starting point: due and not-due memories as built', () => {
  assert.ok(isDue(card('hablar', 'receptive')) && isDue(card('hablar', 'productive')));
  assert.ok(isDue(card('comer', 'receptive')) && !isDue(card('comer', 'productive')));
  assert.ok(!isDue(card('vivir', 'receptive')) && !isDue(card('vivir', 'productive')));
  assert.ok(!isDue(card('tren', 'receptive')) && !isDue(card('tren', 'productive')));
  assert.ok(isDue(card('gato', 'receptive')) && !isDue(card('gato', 'productive')));
  assert.equal(card('abrir', 'productive').state, 0);
});

test('practice asks the words whose memory is due first', async () => {
  const scope = ['leer', 'beber', 'vivir', 'abrir', 'comer', 'hablar'].map((l) => ids[l]);
  const two = await c.post('/api/practice/forms/batch', { language: 'es', scope: 'entries', entryIds: scope, size: 2 });
  assert.equal(two.status, 200, JSON.stringify(two.body));
  assert.deepEqual(new Set(two.body.items.map((i: any) => i.entryId)), new Set([ids.hablar, ids.comer]), 'the two words with a memory due');
  const three = await c.post('/api/practice/forms/batch', { language: 'es', scope: 'entries', entryIds: scope, size: 3 });
  assert.deepEqual(new Set(three.body.items.map((i: any) => i.entryId)), new Set([ids.hablar, ids.comer, ids.vivir]), 'then a word scheduled later');
  const cloze = await c.post('/api/practice/cloze/batch', { language: 'es', scope: 'entries', entryIds: [ids.vivir, ids.hablar], size: 1, choices: true });
  assert.equal(cloze.status, 200, JSON.stringify(cloze.body));
  assert.deepEqual(cloze.body.items.map((i: any) => i.entryId), [ids.hablar]);
  const identify = await c.post('/api/practice/identify/batch', { language: 'es', scope: 'entries', entryIds: [ids.tren, ids.escuela], size: 1 });
  assert.equal(identify.status, 200, JSON.stringify(identify.body));
  assert.deepEqual(identify.body.items.map((i: any) => i.entryId), [ids.escuela], 'the due word’s picture first');
});

test('a due word’s grammar form is its recall review: once a day, and never both memories in a day', async () => {
  const before = card('hablar', 'productive');
  const right = await form('hablar', 'ind.pres|1s', 'hablo');
  assert.equal(right.grade, 'correct');
  assert.equal(right.review?.skill, 'productive');
  assert.ok(right.review.scheduledDays >= 1 && right.review.dueAfter > Date.now());
  assert.deepEqual(logsOf('hablar'), [
    { op_id: `prac:${right.opId}`, skill: 'productive', rating: 3, rating_source: 'auto', exercise_kind: 'practice:forms', local_day: localDay(Date.now(), tz) },
  ]);
  const after = card('hablar', 'productive');
  assert.ok(after.due! >= endOfToday() && after.due! > before.due!, 'the recall memory is scheduled ahead');
  assert.equal(after.reps, before.reps + 1);

  // The same answer sent again counts once.
  const again = await c.post('/api/practice/attempts', { opId: right.opId, mode: 'forms', entryId: ids.hablar, cell: 'ind.pres|1s', response: 'hablo', answeredAt: Date.now() });
  assert.equal(again.body.duplicate, true);
  // A second answer the same day stays practice, even a wrong one.
  const wrong = await form('hablar', 'ind.pres|3s', 'zzz');
  assert.equal(wrong.grade, 'incorrect');
  assert.equal(wrong.review, undefined);
  assert.equal(card('hablar', 'productive').due, after.due);
  // The recognition memory is due too, but a word gets one memory's review a day.
  const choice = await gap('hablar', 'hablar', true);
  assert.equal(choice.grade, 'correct');
  assert.equal(choice.review, undefined);
  assert.ok(isDue(card('hablar', 'receptive')));
  assert.equal(logsOf('hablar').length, 1);
});

test('a word whose other memory is due waits for that review', async () => {
  const recall = card('comer', 'productive');
  const typed = await form('comer', 'ind.pres|3s', 'come');
  assert.equal(typed.grade, 'correct');
  assert.equal(typed.review, undefined, 'recall is not due, and the due recognition review comes first');
  assert.equal(card('comer', 'productive').due, recall.due);
  assert.equal(logsOf('comer').length, 0);
  const choice = await gap('comer', 'comer', true);
  assert.equal(choice.review?.skill, 'receptive');
  assert.deepEqual(
    logsOf('comer').map((l) => [l.skill, l.rating, l.exercise_kind]),
    [['receptive', 3, 'practice:cloze_choice']],
  );
  assert.ok(!isDue(card('comer', 'receptive')));
});

test('an early answer counts, and an early miss brings the word back soon', async () => {
  const before = card('vivir', 'productive');
  assert.ok(before.due! > endOfToday() + DAY, 'recall was days away');
  const miss = await gap('vivir', 'zzz', false);
  assert.equal(miss.grade, 'incorrect');
  assert.equal(miss.review?.skill, 'productive');
  assert.deepEqual(
    logsOf('vivir').map((l) => [l.skill, l.rating, l.rating_source, l.exercise_kind]),
    [['productive', 1, 'auto', 'practice:cloze_typed']],
  );
  const after = card('vivir', 'productive');
  assert.ok(after.due! < before.due!, 'back sooner than planned');
  assert.ok(after.due! <= Date.now() + 2 * DAY, `back within two days (${after.scheduled_days} d)`);
  assert.equal(after.lapses, before.lapses + 1);
  assert.equal(db.get<{ n: number }>('SELECT times_forgotten AS n FROM learning_items WHERE entry_id = ?', ids.vivir)!.n, 1);
});

test('Identify: a named picture is a recall review (hinted is Hard), a picked name a recognition review', async () => {
  const batch = await c.post('/api/practice/identify/batch', { language: 'es', scope: 'entries', entryIds: [ids.escuela, ids.tren], size: 5 });
  const school = batch.body.items.find((i: any) => i.entryId === ids.escuela);
  const train = batch.body.items.find((i: any) => i.entryId === ids.tren);
  assert.ok(school && train, 'pictures for both words');
  const named = await practice({ mode: 'identify', entryId: ids.escuela, cell: school.id, response: 'escuela', hintsUsed: 1 });
  assert.equal(named.grade, 'correct');
  assert.equal(named.review?.skill, 'productive');
  assert.deepEqual(
    logsOf('escuela').map((l) => [l.skill, l.rating, l.exercise_kind]),
    [['productive', 2, 'practice:identify_typed']],
  );
  // tren is not due at all: an early recognition review.
  const picked = await practice({ mode: 'identify', entryId: ids.tren, cell: train.id, response: 'tren', choice: true });
  assert.equal(picked.review?.skill, 'receptive');
  assert.deepEqual(
    logsOf('tren').map((l) => [l.skill, l.rating, l.exercise_kind]),
    [['receptive', 3, 'practice:identify_choice']],
  );
});

test('no event for a word that is not scheduled yet or not being learned', async () => {
  const logs = () => db.get<{ n: number }>("SELECT COUNT(*) AS n FROM review_logs WHERE op_id NOT LIKE 'setup:%'")!.n;
  const before = logs();
  for (const lemma of ['beber', 'abrir', 'leer']) {
    const r = await form(lemma, 'ind.pres|1s', { beber: 'bebo', abrir: 'abro', leer: 'leo' }[lemma]!);
    assert.equal(r.grade, 'correct', lemma);
    assert.equal(r.review, undefined, lemma);
  }
  assert.equal(logs(), before);
  assert.equal(card('beber', 'productive').state, 0);
  assert.equal(card('abrir', 'productive').state, 0);
});

test('Writing rates each word being learned in the translation, and “I was right” turns a miss into Good', async () => {
  const right = await write('es-A1-1-001', 'La casa es grande.');
  assert.deepEqual([right.correct, right.reviews], [true, 1]);
  assert.deepEqual(
    logsOf('casa').map((l) => [l.op_id, l.skill, l.rating, l.exercise_kind]),
    [[`wrev:${right.opId}:${ids.casa}`, 'productive', 3, 'practice:writing']],
  );

  // The wrong word where perro belongs: perro is rated Again (gato is not in this translation).
  const passedBefore = db.get<{ n: number }>("SELECT COALESCE(SUM(reviews_passed), 0) AS n FROM daily_stats WHERE language_code = 'es'")!.n;
  const perroBefore = card('perro', 'productive');
  const wrong = await write('es-A1-1-002', 'El gato está feliz.');
  assert.deepEqual([wrong.correct, wrong.reviews], [false, 1]);
  assert.deepEqual(logsOf('perro').map((l) => [l.rating, l.exercise_kind]), [[1, 'practice:writing']]);
  assert.equal(logsOf('gato').length, 0);
  const missed = card('perro', 'productive');
  assert.equal(missed.lapses, perroBefore.lapses + 1);

  const accepted = await c.post('/api/practice/writing/accept', { opId: wrong.opId, language: 'es' });
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  assert.equal(accepted.body.correct, true);
  assert.deepEqual(logsOf('perro').map((l) => [l.op_id, l.rating]), [[`wrev:${wrong.opId}:${ids.perro}`, 3]]);
  const fixed = card('perro', 'productive');
  assert.equal(fixed.lapses, perroBefore.lapses, 'the lapse is gone');
  assert.ok(fixed.due! > missed.due! && fixed.due! >= endOfToday(), 'scheduled as remembered');
  assert.equal(db.get<{ n: number }>('SELECT times_forgotten AS n FROM learning_items WHERE entry_id = ?', ids.perro)!.n, 0);
  assert.equal(db.get<{ n: number }>("SELECT COALESCE(SUM(reviews_passed), 0) AS n FROM daily_stats WHERE language_code = 'es'")!.n, passedBefore + 1);
  // Accepting again changes nothing more.
  await c.post('/api/practice/writing/accept', { opId: wrong.opId, language: 'es' });
  assert.equal(card('perro', 'productive').version, fixed.version);

  // gato's recognition is due, so its recall waits; "I don't know" tests no word.
  const cat = await write('es-A1-1-003', 'El gato está durmiendo.');
  assert.deepEqual([cat.correct, cat.reviews], [true, 0]);
  const blank = await write('es-A1-1-003', '');
  assert.equal(blank.reviews, 0);
  assert.equal(logsOf('gato').length, 0);
});
