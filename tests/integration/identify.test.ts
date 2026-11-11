// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Identify practice: objects in the bundled pictures named by the learner's words (data/identify/identify.json),
// batches for each scope, choices, server grading (synonyms, plurals, other forms, other objects), idempotent
// attempts, the order after a miss, the summary and the word page's picture count.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { Client, startTestServer, type TestServer } from '../helpers/harness.ts';
import { loadIdentify, namingPlurals } from '../../server/learning/identify.ts';

let srv: TestServer;
let c: Client;
const ids: Record<string, number> = {};

const words = [
  { lemma: 'escuela', pos: 'noun', gender: 'f', senses: [{ gloss: 'school' }], forms: [{ form: 'escuelas', tags: ['plural'] }] },
  { lemma: 'árbol', pos: 'noun', gender: 'm', senses: [{ gloss: 'tree' }] },
  { lemma: 'paraguas', pos: 'noun', gender: 'm', senses: [{ gloss: 'umbrella' }] },
  { lemma: 'caballo', pos: 'noun', gender: 'm', senses: [{ gloss: 'horse' }] },
  { lemma: 'tren', pos: 'noun', gender: 'm', senses: [{ gloss: 'train' }] },
  { lemma: 'estación', pos: 'noun', gender: 'f', senses: [{ gloss: 'station' }] },
  {
    lemma: 'gato',
    pos: 'noun',
    gender: 'm',
    senses: [{ gloss: 'cat' }],
    forms: [
      { form: 'gata', tags: ['feminine', 'singular'] },
      { form: 'gatos', tags: ['masculine', 'plural'] },
      { form: 'gatas', tags: ['feminine', 'plural'] },
    ],
  },
  { lemma: 'comer', pos: 'verb', senses: [{ gloss: 'to eat' }], forms: [{ form: 'comen', tags: ['present', '3rd-person', 'plural'] }] },
];

before(async () => {
  srv = await startTestServer();
  c = new Client(srv.url);
  await c.setup();
  const doc = { format: 'vocabbuilder-v1', language: 'es', source: { name: 'Test nouns (es)', kind: 'curated', license: 'CC0-1.0' }, entries: words };
  const up = await c.post('/api/import/upload?lang=es&kind=vocabulary&filename=nouns.json', Buffer.from(JSON.stringify(doc)), { 'Content-Type': 'application/octet-stream' });
  assert.equal(up.status, 200, JSON.stringify(up.body));
  const commit = await c.post(`/api/import/${up.body.id}/commit`, { mapping: {}, options: {} });
  assert.equal(commit.status, 200, JSON.stringify(commit.body));
  for (const r of srv.app.db.all<{ id: number; lemma: string }>("SELECT id, lemma FROM vocabulary_entries WHERE language_code = 'es'")) ids[r.lemma] = r.id;
});
after(() => srv.cleanup());

const attempt = (body: Record<string, unknown>) => c.post('/api/practice/attempts', { opId: randomUUID(), mode: 'identify', answeredAt: Date.now(), ...body });

test('the bundled scene data is complete: every picture file exists and every object has a box, a point and words', () => {
  const data = loadIdentify(srv.app);
  assert.ok(data, 'data/identify/identify.json is missing');
  assert.equal(data.scenes.length, 194);
  for (const s of data.scenes) {
    for (const f of Object.values(s.src)) assert.ok(existsSync(path.join(srv.app.config.root, 'data', 'identify', 'images', f)), `${s.id}: ${f} missing`);
    assert.ok(s.w > 0 && s.h > 0);
    for (const o of s.objects) {
      const [y0, x0, y1, x1] = o.box;
      const [y, x] = o.point;
      assert.ok(y0 < y1 && x0 < x1, `${s.id} #${o.n} box`);
      assert.ok(y >= y0 - 15 && y <= y1 + 15 && x >= x0 - 15 && x <= x1 + 15, `${s.id} #${o.n} point outside its box`);
      for (const ws of Object.values(o.words)) for (const [lemma, display] of ws!) assert.ok(lemma && display, `${s.id} #${o.n} empty word`);
    }
  }
});

test('plurals that name things: nominative or untagged plurals, not case forms or the other gender', () => {
  const pl = (forms: Array<[string, string[]]>) => [...namingPlurals(forms.map(([form, tags]) => ({ form, tags })))].sort();
  // Table labels (Polish szkoła) and separate tags (Russian, Spanish).
  assert.deepEqual(pl([['szkoły', ['genitive singular', 'nominative plural', 'accusative plural']], ['szkół', ['genitive plural']], ['szkole', ['dative singular', 'locative singular']]]), ['szkoły']);
  assert.deepEqual(pl([['книги', ['nominative', 'plural']], ['книг', ['genitive', 'plural']]]), ['книги']);
  assert.deepEqual(pl([['niña', ['feminine', 'singular']], ['niños', ['masculine', 'plural']], ['niñas', ['feminine', 'plural']], ['escuelas', ['plural']]]), ['escuelas', 'niños']);
});

test('the summary counts the pictured objects named by the learner’s words', async () => {
  const r = await c.get('/api/practice/summary/es');
  assert.equal(r.status, 200);
  const s = r.body.identify;
  assert.ok(s.words >= 6, JSON.stringify(s));
  assert.ok(s.objects >= s.words && s.scenes >= 3);
  assert.equal(s.learningWords, 0);
  assert.equal(s.attempts7d, 0);
});

test('a batch gives each word once with its picture, the dot and four options that include the answer', async () => {
  const r = await c.post('/api/practice/identify/batch', { language: 'es', scope: 'all', choices: true, size: 20 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const items = r.body.items as any[];
  // Seven nouns, each in at least one picture (at most two objects per picture in a batch); the verb names nothing.
  assert.ok(items.length >= 6 && items.length <= 7, String(items.length));
  assert.ok(!items.some((i) => i.entryId === ids.comer));
  assert.equal(new Set(items.map((i) => i.entryId)).size, items.length);
  for (const i of items) {
    assert.match(i.scene.src.small, /^\/identify\/S\d{3}-800-[0-9a-f]{10}\.webp$/);
    assert.match(i.scene.src.large, /^\/identify\/S\d{3}-1600-[0-9a-f]{10}\.webp$/);
    assert.equal(i.id, `${i.scene.id}:${i.n}`);
    assert.equal(i.choices.length, 4);
    assert.ok(i.choices.includes(i.display));
    assert.equal(new Set(i.choices.map((x: string) => x.toLowerCase())).size, 4);
    for (const other of i.alsoRight) assert.ok(!i.choices.includes(other), `${i.id}: another right answer is offered as a wrong option`);
    assert.equal(i.answer.accepted[0], i.lemma);
    assert.ok(i.point[0] >= i.box[0] - 15 && i.point[0] <= i.box[2] + 15);
  }
  const typed = await c.post('/api/practice/identify/batch', { language: 'es', scope: 'all', choices: false, size: 3 });
  assert.equal(typed.body.items.length, 3);
  assert.equal(typed.body.items[0].choices, null);
  assert.equal(typed.body.available, r.body.available);
});

test('the server grades: chosen and typed answers, other names of the same thing, other forms, other things, unknown objects', async () => {
  const school = 'S001:1';
  const yes = await attempt({ entryId: ids.escuela, cell: school, response: 'escuela', choice: true });
  assert.equal(yes.status, 200, JSON.stringify(yes.body));
  assert.equal(yes.body.grade, 'correct');
  const no = await attempt({ entryId: ids.escuela, cell: school, response: 'árbol', choice: true });
  assert.equal(no.body.grade, 'incorrect');
  assert.equal(no.body.expected, 'escuela');
  // Every word listed for the object is right.
  const batch = await c.post('/api/practice/identify/batch', { language: 'es', scope: 'entry', entryId: ids.escuela, size: 10 });
  const item = (batch.body.items as any[]).find((i) => i.id === school);
  assert.ok(item, 'the schoolyard picture is offered for escuela');
  for (const other of item.answer.accepted.slice(1)) assert.equal((await attempt({ entryId: ids.escuela, cell: school, response: other })).body.grade, 'correct', other);
  assert.equal((await attempt({ entryId: ids.escuela, cell: school, response: 'Escuela' })).body.grade, 'correct');
  // Plurals are right (many pictures show several of a thing); other forms are close, with a note on what is wanted.
  assert.equal((await attempt({ entryId: ids.escuela, cell: school, response: 'escuelas' })).body.grade, 'correct');
  const cat = 'S052:7';
  assert.equal((await attempt({ entryId: ids.gato, cell: cat, response: 'gatos' })).body.grade, 'correct');
  for (const form of ['gata', 'gatas']) {
    const r = await attempt({ entryId: ids.gato, cell: cat, response: form });
    assert.equal(r.body.grade, 'close', form);
    assert.match(r.body.message, /^Right word, different form: “gatas?” \(feminine, (singular|plural)\)\. Name it with the dictionary form, “gato”\.$/);
  }
  assert.equal((await attempt({ entryId: ids.gato, cell: cat, response: 'gato' })).body.grade, 'correct');
  // Another object in the same picture is never accepted as a typo.
  assert.equal((await attempt({ entryId: ids.escuela, cell: school, response: 'arbol' })).body.grade, 'incorrect');
  assert.equal((await attempt({ entryId: ids.escuela, cell: school, revealed: true })).body.grade, 'revealed');
  assert.equal((await attempt({ entryId: ids.escuela, cell: school, response: 'escuela' })).body.grade, 'correct');
  assert.equal((await attempt({ entryId: ids.escuela, cell: 'S001:99', response: 'escuela' })).status, 404);
  assert.equal((await attempt({ entryId: ids['árbol'], cell: school, response: 'árbol' })).status, 422);
  // Idempotent on opId.
  const opId = randomUUID();
  const first = await c.post('/api/practice/attempts', { opId, mode: 'identify', entryId: ids.paraguas, cell: 'S001:3', response: 'paraguas', choice: true, answeredAt: Date.now() });
  const again = await c.post('/api/practice/attempts', { opId, mode: 'identify', entryId: ids.paraguas, cell: 'S001:3', response: 'paraguas', choice: true, answeredAt: Date.now() });
  assert.equal(first.body.grade, 'correct');
  assert.equal(again.body.duplicate, true);
  const n = srv.app.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM practice_attempts WHERE mode = 'identify' AND op_id = ?", opId)!.n;
  assert.equal(n, 1);
});

test('a missed object comes back first, a word not being learned gets no review, and the word page counts the pictures', async () => {
  const before = srv.app.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM review_logs')!.n;
  const miss = await attempt({ entryId: ids.caballo, cell: 'S003:2', response: 'tren', choice: true });
  assert.equal(miss.body.grade, 'incorrect');
  const next = await c.post('/api/practice/identify/batch', { language: 'es', scope: 'all', choices: false, size: 1 });
  assert.equal(next.body.items[0].id, 'S003:2');
  assert.equal(srv.app.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM review_logs')!.n, before);
  const s = await c.get('/api/practice/summary/es');
  assert.ok(s.body.identify.attempts7d >= 8);
  const detail = await c.get(`/api/vocab/${ids.escuela}`);
  assert.ok(detail.body.identifyCount >= 1);
  assert.equal((await c.get(`/api/vocab/${ids.comer}`)).body.identifyCount, 0);
  // The word page keeps its picture link after a flag change.
  const flagged = await c.post(`/api/vocab/${ids.escuela}/flags`, { favorite: true });
  assert.equal(flagged.status, 200, JSON.stringify(flagged.body));
  assert.equal(flagged.body.identifyCount, detail.body.identifyCount);
  const none = await c.post('/api/practice/identify/batch', { language: 'es', scope: 'learning', choices: true, size: 10 });
  assert.deepEqual(none.body, { items: [], available: 0 });
});

test('a Comprehensive session’s Identify minimum: its own words first, then the words being learned, then all words', async () => {
  // Being learned: tren and caballo. The session's words: comer (in no picture) and escuela.
  for (const w of ['tren', 'caballo']) assert.equal((await c.post('/api/practice/read/learn-next', { entryId: ids[w] })).status, 200);
  const batch = (body: Record<string, unknown>) => c.post('/api/practice/identify/batch', { language: 'es', scope: 'entries', entryIds: [ids.comer, ids.escuela], choices: true, ...body });
  const words = (r: { body: any }) => (r.body.items as any[]).map((i) => i.entryId).sort((a, b) => a - b);
  const of = (...lemmas: string[]) => lemmas.map((l) => ids[l]).sort((a, b) => a - b);
  // A usual round: the session's words only, each once, so one picture of escuela.
  const plain = await batch({ size: 5 });
  assert.equal(plain.status, 200, JSON.stringify(plain.body));
  assert.deepEqual(words(plain), of('escuela'));
  // Filled up: the session's word first, then the words being learned, before any other word of the learner's.
  assert.deepEqual(words(await batch({ size: 1, fill: ['learning', 'all'] })), of('escuela'));
  assert.deepEqual(words(await batch({ size: 3, fill: ['learning', 'all'] })), of('escuela', 'tren', 'caballo'));
  const five = await batch({ size: 5, fill: ['learning', 'all'] });
  assert.equal(five.status, 200, JSON.stringify(five.body));
  const got = words(five);
  assert.equal(got.length, 5);
  assert.equal(new Set(got).size, 5, 'each word once while there are enough words');
  for (const w of ['escuela', 'tren', 'caballo']) assert.ok(got.includes(ids[w]), w);
  assert.ok(!got.includes(ids.comer));
  for (const i of five.body.items) {
    assert.equal(i.choices.length, 4);
    assert.ok(i.choices.includes(i.display));
    assert.equal(i.answer.accepted[0], i.lemma);
  }
  assert.ok(five.body.available > plain.body.available, 'the fill-up words’ pictures are available too');
  // Filling up only from the words being learned: every picture of those three words, a word twice when needed.
  const learning = await batch({ size: 50, fill: ['learning'] });
  assert.ok(learning.body.items.every((i: any) => [ids.escuela, ids.tren, ids.caballo].includes(i.entryId)));
  assert.equal(learning.body.items.length, learning.body.available, 'as many pictures as there are');
  assert.equal(new Set(learning.body.items.map((i: any) => i.id)).size, learning.body.items.length, 'no picture twice');
  assert.ok(learning.body.items.length >= 3);
  // Only the scopes the app knows.
  assert.equal((await batch({ size: 5, fill: ['everything'] })).status, 422);
});
