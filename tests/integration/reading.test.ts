// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Read and say: sentences chosen from the words a learner knows (server/learning/reading.ts).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Client, startTestServer, type TestServer } from '../helpers/harness.ts';
import type { Db } from '../../server/db/database.ts';
import { compareWords } from '../../shared/compare.ts';
import { startSession } from '../helpers/study.ts';

let srv: TestServer;
let c: Client;
let db: Db;

const word = (lemma: string, pos: string, rank: number, gloss: string, forms: string[] = [], examples: unknown[] = [], senses?: unknown[]) => ({
  lemma,
  pos,
  frequencyRank: rank,
  senses: senses ?? [{ gloss }],
  forms: forms.map((form) => ({ form, tags: [] })),
  examples,
});

before(async () => {
  srv = await startTestServer();
  c = new Client(srv.url);
  await c.setup();
  db = srv.app.db;
  const doc = {
    format: 'vocabbuilder-v1',
    language: 'es',
    source: { name: 'Reading test set', kind: 'frequency_mixed' },
    entries: [
      word('yo', 'pronoun', 1, 'I'),
      word('tener', 'verb', 2, 'to have', ['tengo', 'tiene']),
      word('un', 'determiner', 3, 'a, an', ['una']),
      word('perro', 'noun', 4, 'dog', ['perros'], [
        { text: 'Yo tengo un perro.', translation: 'I have a dog.', target: 'perro', sense: 0 },
        { text: 'Tom tiene un perro.', translation: 'Tom has a dog.', target: 'perro', sense: 0 },
      ]),
      word('gato', 'noun', 5, 'cat', ['gatos'], [{ text: 'Yo tengo un gato.', translation: 'I have a cat.', target: 'gato', sense: 0 }]),
      word('casa', 'noun', 6, 'house', ['casas'], [{ text: 'Yo tengo una casa grande.', translation: 'I have a big house.', target: 'casa', sense: 0 }]),
      word('grande', 'adjective', 7, 'big', [], [], [{ gloss: 'big, large' }, { gloss: 'great' }]),
      word('hoy', 'adverb', 8, 'today', [], [{ text: 'Hoy tengo un examen dificilísimo.', translation: 'Today I have a very hard exam.', target: 'Hoy', sense: 0 }]),
    ],
  };
  const up = await c.post('/api/import/upload?lang=es&kind=vocabulary&filename=set.json', Buffer.from(JSON.stringify(doc)), { 'Content-Type': 'application/octet-stream' });
  assert.equal(up.status, 200, JSON.stringify(up.body));
  assert.equal((await c.post(`/api/import/${up.body.id}/commit`, { mapping: {}, options: {} })).status, 200);
  // The learner knows yo, tener, un, perro and casa; gato, grande and hoy are new.
  const now = Date.now();
  for (const l of ['yo', 'tener', 'un', 'perro', 'casa']) {
    const id = db.get<{ id: number }>("SELECT id FROM vocabulary_entries WHERE language_code = 'es' AND lemma = ?", l)!.id;
    db.run("INSERT INTO learning_items (entry_id, language_code, status, introduced_at, created_at, updated_at) VALUES (?, 'es', 'active', ?, ?, ?)", id, now, now, now);
  }
});
after(() => srv.cleanup());

const idOf = (lemma: string) => db.get<{ id: number }>("SELECT id FROM vocabulary_entries WHERE language_code = 'es' AND lemma = ?", lemma)!.id;

test('reading offers sentences with at most one new word, marks it, and gives every word its meaning', async () => {
  const r = await c.post('/api/practice/read/batch', { language: 'es', mode: 'read', size: 10 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const byText = new Map(r.body.items.map((i: any) => [i.text, i]));
  assert.ok(byText.has('Yo tengo un perro.'), 'every word known');
  assert.ok(byText.has('Tom tiene un perro.'), 'a name needs no learning');
  const cat = byText.get('Yo tengo un gato.') as any;
  assert.equal(cat.newEntryId, idOf('gato'), 'one new word: gato');
  assert.deepEqual(cat.tokens.filter((t: any) => t.s).map((t: any) => [t.t, t.s]), [
    ['Yo', 'known'],
    ['tengo', 'known'],
    ['un', 'known'],
    ['gato', 'new'],
  ]);
  assert.equal(cat.words[idOf('tener')].lemma, 'tener', 'an inflected form shows its dictionary form');
  // casa is known, grande is the one new word; a word with several meanings shows its first two.
  const house = byText.get('Yo tengo una casa grande.') as any;
  assert.equal(house.newEntryId, idOf('grande'));
  assert.equal(house.words[idOf('grande')].gloss, 'big, large; great');
  assert.ok(!byText.has('Hoy tengo un examen dificilísimo.'), 'a word in no list (examen) means the sentence cannot be read yet');
});

test('saying uses only sentences of known words, without names', async () => {
  const r = await c.post('/api/practice/read/batch', { language: 'es', mode: 'say', size: 10 });
  assert.deepEqual(r.body.items.map((i: any) => i.text), ['Yo tengo un perro.']);
  const s = await c.get('/api/practice/read/summary/es');
  assert.deepEqual(s.body, { knownWords: 5, readable: 4, sayable: 1, newWords: 2 });
});

test('a sentence read in the last week is not offered again, and results are kept as practice', async () => {
  const sentenceId = db.get<{ id: number }>("SELECT id FROM example_sentences WHERE text = 'Yo tengo un perro.'")!.id;
  const a = await c.post('/api/practice/read/attempts', { opId: 'read-attempt-0001', mode: 'read', sentenceId, grade: 'understood', answeredAt: Date.now() });
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.equal((await c.post('/api/practice/read/attempts', { opId: 'read-attempt-0001', mode: 'read', sentenceId, grade: 'understood', answeredAt: Date.now() })).body.duplicate, true);
  const bad = await c.post('/api/practice/read/attempts', { opId: 'read-attempt-0002', mode: 'read', sentenceId, grade: 'correct', answeredAt: Date.now() });
  assert.equal(bad.status, 422, 'a saying grade does not fit reading');
  const r = await c.post('/api/practice/read/batch', { language: 'es', mode: 'read', size: 10 });
  assert.ok(!r.body.items.some((i: any) => i.text === 'Yo tengo un perro.'));
  assert.ok(r.body.items.some((i: any) => i.text === 'Tom tiene un perro.'), 'other sentences still come');
  const row = db.get<{ mode: string; grade: string }>("SELECT mode, grade FROM practice_attempts WHERE op_id = 'read-attempt-0001'")!;
  assert.deepEqual({ ...row }, { mode: 'read', grade: 'understood' });
  assert.equal(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM fsrs_cards')!.n, 0, 'reading never touches the review schedule');
});

test('"Learn it next" puts a new word met in reading at the front of the next session', async () => {
  const r = await c.post('/api/practice/read/learn-next', { entryId: idOf('gato') });
  assert.deepEqual(r.body, { status: 'introduced', queued: true });
  const item = db.get<{ status: string }>('SELECT status FROM learning_items WHERE entry_id = ?', idOf('gato'))!;
  assert.equal(item.status, 'introduced');
  const again = await c.post('/api/practice/read/learn-next', { entryId: idOf('perro') });
  assert.deepEqual(again.body, { status: 'active', queued: false }, 'a word already being learned is left alone');
  const session = await startSession(c, { language: 'es', minutes: 10, newWords: 1 });
  const first = (await c.get(`/api/sessions/${session.id}`)).body;
  const intro = first.exercises.find((x: any) => x.kind === 'intro');
  assert.equal(intro?.payload?.entryId, idOf('gato'), 'the word comes first among new words');
});

test('saying is compared word by word: order counts, one slip does not mark the rest wrong', () => {
  const same = compareWords('yo tengo un perro', 'Yo tengo un perro.', 'es');
  assert.equal(same.score, 1);
  const slip = compareWords('Yo tengo una perro', 'Yo tengo un perro.', 'es');
  assert.deepEqual(slip.original.map((o) => o.ok), [true, true, false, true]);
  assert.deepEqual(slip.extra, ['una']);
  assert.ok(slip.score > 0.7 && slip.score < 0.95);
  const extra = compareWords('Yo sí tengo un perro grande', 'Yo tengo un perro.', 'es');
  assert.deepEqual(extra.extra, ['sí', 'grande']);
  assert.ok(extra.score < 0.95, 'added words lower the score');
  assert.equal(compareWords('Я пью воду', 'Я пью́ воду.', 'ru').score, 1, 'stress marks do not count');
});
