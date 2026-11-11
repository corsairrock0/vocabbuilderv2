// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Each sentence is linked to the meaning it shows: import, the word page, edits, practice gaps, exports, and
// updating a loaded word set (old meanings and sentences replaced, edited words kept, practice history kept, left-out words removed).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Client, startTestServer, type TestServer } from '../helpers/harness.ts';
import type { Db } from '../../server/db/database.ts';
import { commitImport, createImportJob, undoImport } from '../../server/vocab/importer.ts';

let srv: TestServer;
let c: Client;
let db: Db;

before(async () => {
  srv = await startTestServer();
  c = new Client(srv.url);
  await c.setup();
  db = srv.app.db;
});
after(() => srv.cleanup());

async function importDoc(lang: string, doc: unknown, options: Record<string, unknown> = {}) {
  const up = await c.post(`/api/import/upload?lang=${lang}&kind=vocabulary&filename=set.json`, Buffer.from(JSON.stringify(doc)), { 'Content-Type': 'application/octet-stream' });
  assert.equal(up.status, 200, JSON.stringify(up.body));
  const commit = await c.post(`/api/import/${up.body.id}/commit`, { mapping: {}, options });
  assert.equal(commit.status, 200, JSON.stringify(commit.body));
  return { id: up.body.id as string, stats: commit.body.stats };
}

const doc = (entries: unknown[], name = 'Meaning test set') => ({
  format: 'vocabbuilder-v1',
  language: 'es',
  source: { name, kind: 'frequency_mixed', license: 'CC-BY-SA-4.0' },
  sentenceSources: { tatoeba: { name: 'Tatoeba', license: 'CC-BY-2.0-FR', url: 'https://tatoeba.org' } },
  entries,
});

const embargo = {
  lemma: 'embargo',
  pos: 'noun',
  gender: 'm',
  frequencyRank: 424,
  senses: [
    { gloss: 'used in «sin embargo» (however)', translations: ['however'] },
    { gloss: 'trade embargo', translations: ['embargo'] },
    { gloss: 'seizure of property', definition: 'el embargo de la casa = the seizure of the house', note: 'law' },
  ],
  examples: [
    { text: 'Es caro y sin embargo lo compré.', translation: 'It is expensive, and yet I bought it.', target: 'embargo', sense: 0, source: 'tatoeba', ref: 'tatoeba:1' },
    { text: 'El país vive bajo un embargo comercial.', translation: 'The country lives under a trade embargo.', target: 'embargo', sense: 1 },
    { text: 'El juez ordenó el embargo de su casa.', translation: 'The judge ordered the seizure of his house.', target: 'embargo', sense: 2 },
    { text: 'Hablaron del embargo.', translation: 'They talked about the embargo.', target: 'embargo' },
  ],
  expressions: [{ text: 'sin embargo', translation: 'however, nevertheless', kind: 'combination' }],
};

let embargoId = 0;

test('imported sentences keep the meaning they show, and combinations keep their kind', async () => {
  await importDoc('es', doc([embargo]));
  embargoId = db.get<{ id: number }>("SELECT id FROM vocabulary_entries WHERE language_code = 'es' AND lemma = 'embargo'")!.id;
  const d = (await c.get(`/api/vocab/${embargoId}`)).body;
  const glossOf = (x: any) => d.senses.find((s: any) => s.id === x.senseId)?.gloss ?? null;
  assert.deepEqual(
    d.examples.map((x: any) => [x.text, glossOf(x)]),
    [
      ['Es caro y sin embargo lo compré.', 'used in «sin embargo» (however)'],
      ['El país vive bajo un embargo comercial.', 'trade embargo'],
      ['El juez ordenó el embargo de su casa.', 'seizure of property'],
      ['Hablaron del embargo.', null],
    ],
  );
  assert.deepEqual(d.expressions.map((x: any) => [x.text, x.kind]), [['sin embargo', 'combination']]);
  assert.equal(d.senses[2].definition, 'el embargo de la casa = the seizure of the house');
});

test('a practice gap names the meaning of its own sentence, without giving the word away', async () => {
  const b = await c.post('/api/practice/cloze/batch', { language: 'es', scope: 'entry', entryId: embargoId, size: 10 });
  assert.equal(b.status, 200, JSON.stringify(b.body));
  const byStart = (s: string) => b.body.items.find((i: any) => i.before.startsWith(s));
  assert.equal(byStart('Es caro').gloss, 'used in «sin …» (however)');
  assert.equal(byStart('El país').gloss, 'trade embargo');
  assert.equal(byStart('El juez').gloss, 'seizure of property');
  // A sentence not linked to a meaning names all of them rather than guessing one.
  assert.equal(byStart('Hablaron').gloss, 'used in «sin …» (however) / trade embargo / seizure of property');
});

test('editing a word keeps each sentence with its meaning, its practice history, its combinations and usage notes', async () => {
  const before = (await c.get(`/api/vocab/${embargoId}`)).body;
  const sentenceIds = before.examples.map((x: any) => x.id);
  const attempt = await c.post('/api/practice/attempts', { opId: randomUUID(), mode: 'cloze', entryId: embargoId, sentenceId: sentenceIds[1], response: 'embargo', answeredAt: Date.now() });
  assert.equal(attempt.status, 200, JSON.stringify(attempt.body));
  // The edit form reorders the meanings and sends sentences without their meaning (an older client) or with it.
  const senses = [before.senses[1], before.senses[0], before.senses[2]].map((s: any) => ({ gloss: s.gloss, translations: s.translations, definition: s.definition, note: s.note }));
  const r = await c.put(`/api/vocab/${embargoId}`, {
    lemma: 'embargo',
    pos: 'noun',
    gender: 'm',
    baseVersion: before.version,
    senses,
    examples: [
      { text: before.examples[0].text, translation: before.examples[0].translation, target: 'embargo' },
      { text: before.examples[1].text, translation: before.examples[1].translation, target: 'embargo' },
      { text: before.examples[2].text, translation: before.examples[2].translation, target: 'embargo', sense: 0 },
      { text: before.examples[3].text, translation: before.examples[3].translation, target: 'embargo', sense: null },
    ],
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const d = (await c.get(`/api/vocab/${embargoId}`)).body;
  const glossOf = (x: any) => d.senses.find((s: any) => s.id === x.senseId)?.gloss ?? null;
  assert.deepEqual(
    d.examples.map((x: any) => glossOf(x)),
    ['used in «sin embargo» (however)', 'trade embargo', 'trade embargo', null],
    'unsent meanings follow their gloss; sent ones are used as given',
  );
  assert.deepEqual(d.examples.map((x: any) => x.id), sentenceIds, 'sentences keep their rows');
  const kept = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM practice_attempts WHERE sentence_id = ?', sentenceIds[1])!.n;
  assert.equal(kept, 1, 'and so their practice history');
  assert.deepEqual(d.expressions.map((x: any) => x.text), ['sin embargo'], 'an edit that does not send combinations keeps them');
  assert.equal(d.senses.find((s: any) => s.gloss === 'seizure of property').definition, 'el embargo de la casa = the seizure of the house');
});

test('an export carries each sentence’s meaning and the kind of each combination', async () => {
  const exp = await c.get('/api/export/vocabulary?lang=es&format=json');
  assert.equal(exp.status, 200);
  const d = typeof exp.body === 'string' ? JSON.parse(exp.body) : exp.body;
  const e = d.entries.find((x: any) => x.lemma === 'embargo');
  assert.deepEqual(e.examples.map((x: any) => x.sense ?? null), [1, 0, 0, null]);
  assert.equal(e.senses[1].gloss, 'used in «sin embargo» (however)');
  assert.deepEqual(e.expressions, [{ text: 'sin embargo', translation: 'however, nevertheless', kind: 'combination' }]);
});

// ------------------------------------------------------------------ updating a loaded set

const setV1 = [
  {
    lemma: 'cuarto',
    pos: 'adjective',
    frequencyRank: 459,
    senses: [{ gloss: 'fourth' }, { gloss: 'quarter' }],
    examples: [
      { text: 'El cuarto de Tom era muy pequeño.', translation: "Tom's room was very small.", target: 'cuarto' },
      { text: 'Son un cuarto para las tres.', translation: "It's a quarter to three.", target: 'cuarto' },
    ],
  },
  { lemma: 'cielo', pos: 'noun', frequencyRank: 438, senses: [{ gloss: 'sky' }], examples: [{ text: 'Pintó el cielorraso.', translation: 'He painted the ceiling.', target: 'cielo' }] },
  { lemma: 'ley', pos: 'noun', frequencyRank: 430, senses: [{ gloss: 'law' }], examples: [{ text: 'Sé que es contra la ley.', translation: "I know it's against the law.", target: 'ley' }] },
];
const setV2 = [
  {
    lemma: 'cuarto',
    pos: 'adjective',
    frequencyRank: 459,
    senses: [{ gloss: 'room, bedroom' }, { gloss: 'fourth' }, { gloss: 'quarter (of an hour)', translations: ['quarter'] }],
    examples: [
      { text: 'El cuarto de Tom era muy pequeño.', translation: "Tom's room was very small.", target: 'cuarto', sense: 0 },
      { text: 'Son un cuarto para las tres.', translation: "It's a quarter to three.", target: 'cuarto', sense: 2 },
      { text: 'Vivo en el cuarto piso.', translation: 'I live on the fourth floor.', target: 'cuarto', sense: 1 },
    ],
    expressions: [{ text: 'cuarto de baño', translation: 'bathroom', kind: 'combination' }],
  },
  { lemma: 'cielo', pos: 'noun', frequencyRank: 438, senses: [{ gloss: 'sky' }], examples: [{ text: 'El cielo está despejado.', translation: 'The sky is clear.', target: 'cielo', sense: 0 }] },
  { lemma: 'ley', pos: 'noun', frequencyRank: 430, senses: [{ gloss: 'law (rule made by a government)' }], examples: [{ text: 'Sé que es contra la ley.', translation: "I know it's against the law.", target: 'ley', sense: 0 }] },
  { lemma: 'nube', pos: 'noun', frequencyRank: 900, senses: [{ gloss: 'cloud' }], examples: [{ text: 'Hay una nube.', translation: 'There is a cloud.', target: 'nube', sense: 0 }] },
];

test('updating a set replaces the old version’s meanings and sentences, keeps edited words and practice history', async () => {
  const app = srv.app;
  const load = (entries: unknown[], options: Record<string, unknown>) => {
    const job = createImportJob(app, { language: 'es', kind: 'vocabulary', fileName: 'frequency-es.json', data: Buffer.from(JSON.stringify(doc(entries, 'Bundled set (es)'))), now: Date.now() });
    const r = commitImport(app, job.id, {}, { duplicatePolicy: 'merge', homographPolicy: 'merge', ...options }, Date.now());
    return { id: job.id, stats: r.stats as Record<string, number> };
  };
  const v1 = load(setV1, {});
  assert.equal(v1.stats.created, 3);
  const id = (lemma: string) => db.get<{ id: number }>("SELECT id FROM vocabulary_entries WHERE language_code = 'es' AND lemma = ?", lemma)!.id;

  // The learner practiced the quarter sentence, and edited ley by hand.
  const quarter = (await c.get(`/api/vocab/${id('cuarto')}`)).body.examples.find((x: any) => x.text.startsWith('Son un cuarto'));
  await c.post('/api/practice/attempts', { opId: randomUUID(), mode: 'cloze', entryId: id('cuarto'), sentenceId: quarter.id, response: 'cuarto', answeredAt: Date.now() });
  const ley = (await c.get(`/api/vocab/${id('ley')}`)).body;
  const edit = await c.put(`/api/vocab/${id('ley')}`, { lemma: 'ley', pos: 'noun', baseVersion: ley.version, senses: [{ gloss: 'law, statute' }], examples: [{ text: 'La ley es clara.', translation: 'The law is clear.', target: 'ley' }] });
  assert.equal(edit.status, 200, JSON.stringify(edit.body));

  const v2 = load(setV2, { refreshFrom: [v1.id] });
  assert.equal(v2.stats.refreshed, 2, JSON.stringify(v2.stats));
  assert.equal(v2.stats.keptEdited, 1);
  assert.equal(v2.stats.created, 1);

  const cuarto = (await c.get(`/api/vocab/${id('cuarto')}`)).body;
  assert.deepEqual(cuarto.senses.map((s: any) => s.gloss), ['room, bedroom', 'fourth', 'quarter (of an hour)'], 'the old meanings are gone');
  const glossOf = (x: any) => cuarto.senses.find((s: any) => s.id === x.senseId)?.gloss;
  assert.deepEqual(
    cuarto.examples.map((x: any) => [x.text, glossOf(x)]),
    [
      ['El cuarto de Tom era muy pequeño.', 'room, bedroom'],
      ['Son un cuarto para las tres.', 'quarter (of an hour)'],
      ['Vivo en el cuarto piso.', 'fourth'],
    ],
  );
  assert.equal(cuarto.examples[1].id, quarter.id, 'a sentence the new version keeps keeps its row');
  assert.equal(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM practice_attempts WHERE sentence_id = ?', quarter.id)!.n, 1, 'and its practice history');
  assert.deepEqual(cuarto.expressions.map((x: any) => [x.text, x.kind]), [['cuarto de baño', 'combination']]);

  const cielo = (await c.get(`/api/vocab/${id('cielo')}`)).body;
  assert.deepEqual(cielo.examples.map((x: any) => x.text), ['El cielo está despejado.'], 'a wrong-word sentence the new version dropped is gone');
  assert.equal(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM example_sentences WHERE text = 'Pintó el cielorraso.'")!.n, 0, 'and not left behind');

  const leyAfter = (await c.get(`/api/vocab/${id('ley')}`)).body;
  assert.deepEqual(leyAfter.senses.map((s: any) => s.gloss), ['law, statute'], 'the edited word is kept as the learner made it');
  assert.deepEqual(leyAfter.examples.map((x: any) => x.text), ['La ley es clara.']);

  assert.throws(() => undoImport(app, v2.id, Date.now()), /can’t be undone/);
});

test('an update gives a word the set created the set’s new written form; a word you edited keeps yours', async () => {
  const app = srv.app;
  const ukDoc = (entries: unknown[]) => ({ format: 'vocabbuilder-v1', language: 'uk', source: { name: 'Bundled set (uk)', kind: 'frequency_mixed', license: 'CC-BY-SA-4.0' }, sentenceSources: {}, entries });
  const load = (entries: unknown[], options: Record<string, unknown>) => {
    const job = createImportJob(app, { language: 'uk', kind: 'vocabulary', fileName: 'frequency-uk.json', data: Buffer.from(JSON.stringify(ukDoc(entries))), now: Date.now() });
    const r = commitImport(app, job.id, {}, { duplicatePolicy: 'merge', homographPolicy: 'merge', ...options }, Date.now());
    return { id: job.id, stats: r.stats as Record<string, number> };
  };
  const city = { text: 'Москва — дуже велике місто.', translation: 'Moscow is a very big city.', target: 'Москва' };
  const water = { text: 'Я п’ю воду.', translation: 'I drink water.', target: 'воду' };
  const v1 = load(
    [
      { lemma: 'москва', display: 'москва́', pos: 'noun', frequencyRank: 997, senses: [{ gloss: 'Muscovites, Russians', note: 'collective' }], examples: [city] },
      { lemma: 'вода', display: 'вода́', pos: 'noun', frequencyRank: 300, senses: [{ gloss: 'water' }], examples: [water] },
    ],
    {},
  );
  const id = (lemma: string) => db.get<{ id: number }>("SELECT id FROM vocabulary_entries WHERE language_code = 'uk' AND lemma = ?", lemma)!.id;
  const voda = (await c.get(`/api/vocab/${id('вода')}`)).body;
  const edit = await c.put(`/api/vocab/${id('вода')}`, { lemma: 'вода', display: 'вода (my note)', pos: 'noun', baseVersion: voda.version, senses: [{ gloss: 'water' }], examples: [water] });
  assert.equal(edit.status, 200, JSON.stringify(edit.body));

  const v2 = load(
    [
      { lemma: 'москва', display: 'Москва́', pos: 'noun', frequencyRank: 997, senses: [{ gloss: 'Moscow (the capital of Russia)' }], examples: [{ ...city, sense: 0 }] },
      { lemma: 'вода', display: 'вода́', pos: 'noun', frequencyRank: 300, senses: [{ gloss: 'water' }], examples: [{ ...water, sense: 0 }] },
    ],
    { refreshFrom: [v1.id] },
  );
  assert.equal(v2.stats.refreshed, 1, JSON.stringify(v2.stats));
  const moskva = (await c.get(`/api/vocab/${id('москва')}`)).body;
  assert.equal(moskva.display, 'Москва́', 'the new written form');
  assert.deepEqual(moskva.senses.map((s: any) => [s.gloss, s.note ?? null]), [['Moscow (the capital of Russia)', null]], 'and the new meaning');
  assert.equal((await c.get(`/api/vocab/${id('вода')}`)).body.display, 'вода (my note)', 'the edited word keeps what the learner wrote');
});

test('an update removes the words the new version left out, unless they were started or added to', async () => {
  const app = srv.app;
  const load = (entries: unknown[], options: Record<string, unknown>) => {
    const job = createImportJob(app, { language: 'es', kind: 'vocabulary', fileName: 'frequency-es.json', data: Buffer.from(JSON.stringify(doc(entries, 'Left-out test set'))), now: Date.now() });
    const r = commitImport(app, job.id, {}, { duplicatePolicy: 'merge', homographPolicy: 'merge', ...options }, Date.now());
    return { id: job.id, stats: r.stats as Record<string, number> };
  };
  const word = (lemma: string, gloss: string, rank: number, text: string, translation: string, extra: Record<string, unknown> = {}) => ({
    lemma,
    pos: 'noun',
    frequencyRank: rank,
    senses: [{ gloss }],
    examples: [{ text, translation, target: lemma, sense: 0 }],
    ...extra,
  });
  const lince = word('lince', 'lynx', 14, 'El lince caza.', 'The lynx hunts.');
  // A word of the learner's own that the set also has.
  await importDoc('es', doc([{ lemma: 'nutria', pos: 'noun', senses: [{ gloss: 'otter' }] }], 'My words'));
  const v1 = load(
    [
      word('zorro', 'fox', 10, 'El zorro corre.', 'The fox runs.'),
      word('búho', 'owl', 11, 'El búho mira.', 'The owl looks.', { expressions: [{ text: 'búho real', translation: 'eagle owl', kind: 'combination' }] }),
      word('tejón', 'badger', 12, 'El tejón duerme.', 'The badger sleeps.'),
      { ...word('nutria', 'otter', 13, 'La nutria nada.', 'The otter swims.'), senses: [{ gloss: 'otter' }, { gloss: 'coypu' }] },
      lince,
    ],
    {},
  );
  assert.equal(v1.stats.created, 4, JSON.stringify(v1.stats));
  assert.equal(v1.stats.merged, 1);
  const entry = (lemma: string) => db.get<{ id: number; frequency_rank: number | null }>("SELECT id, frequency_rank FROM vocabulary_entries WHERE language_code = 'es' AND lemma = ?", lemma);
  const id = (lemma: string) => entry(lemma)!.id;
  const sentences = (text: string) => db.get<{ n: number }>('SELECT COUNT(*) AS n FROM example_sentences WHERE text = ?', text)!.n;

  // The learner started búho and wrote a note on tejón.
  const now = Date.now();
  db.run("INSERT INTO learning_items (entry_id, language_code, status, introduced_at, created_at, updated_at) VALUES (?, 'es', 'introduced', ?, ?, ?)", id('búho'), now, now, now);
  db.run("INSERT INTO entry_user_data (entry_id, note, updated_at) VALUES (?, 'seen at the zoo', ?)", id('tejón'), now);

  const v2 = load([lince], { refreshFrom: [v1.id] });
  assert.equal(v2.stats.refreshed, 1, JSON.stringify(v2.stats));
  assert.equal(v2.stats.removed, 1);
  assert.equal(v2.stats.keptStarted, 2);

  assert.equal(entry('zorro'), undefined, 'a word not started is removed');
  assert.equal(sentences('El zorro corre.'), 0, 'with its sentences');

  const buho = (await c.get(`/api/vocab/${id('búho')}`)).body;
  assert.deepEqual(buho.senses.map((s: any) => s.gloss), ['owl'], 'a started word keeps its meanings');
  assert.deepEqual(buho.examples, [], 'but not the set’s sentences');
  assert.deepEqual(buho.expressions, [], 'or combinations');
  assert.equal(entry('búho')!.frequency_rank, null, 'and the set no longer ranks it');
  assert.equal(db.get<{ status: string }>('SELECT status FROM learning_items WHERE entry_id = ?', id('búho'))!.status, 'introduced', 'progress is kept');
  assert.equal(sentences('El búho mira.'), 0);

  const tejon = (await c.get(`/api/vocab/${id('tejón')}`)).body;
  assert.deepEqual(tejon.senses.map((s: any) => s.gloss), ['badger'], 'a word with a note stays');
  assert.deepEqual(tejon.examples, []);
  assert.equal(db.get<{ note: string }>('SELECT note FROM entry_user_data WHERE entry_id = ?', id('tejón'))!.note, 'seen at the zoo');

  const nutria = (await c.get(`/api/vocab/${id('nutria')}`)).body;
  assert.deepEqual(nutria.senses.map((s: any) => s.gloss), ['otter', 'coypu'], 'a word of your own keeps its meanings');
  assert.deepEqual(nutria.examples, [], 'but not the set’s sentences');
  assert.equal(entry('nutria')!.frequency_rank, null);

  assert.equal(entry('lince')!.frequency_rank, 14, 'a word the new version has keeps its rank');

  // The next update doesn't count the words that stayed again.
  const v3 = load([lince], { refreshFrom: [v1.id, v2.id] });
  assert.equal(v3.stats.removed, 0, JSON.stringify(v3.stats));
  assert.equal(v3.stats.keptStarted, 0);
  assert.ok(entry('búho') && entry('tejón') && entry('nutria'));
});

test('a left-out word a session planned is marked deleted, so the session keeps its exercises; homographs match by meaning', async () => {
  const app = srv.app;
  const load = (entries: unknown[], options: Record<string, unknown>) => {
    const job = createImportJob(app, { language: 'es', kind: 'vocabulary', fileName: 'frequency-es.json', data: Buffer.from(JSON.stringify(doc(entries, 'Planned test set'))), now: Date.now() });
    const r = commitImport(app, job.id, {}, { duplicatePolicy: 'merge', homographPolicy: 'new', ...options }, Date.now());
    return { id: job.id, stats: r.stats as Record<string, number> };
  };
  const word = (lemma: string, gloss: string, rank: number, text: string, translation: string) => ({
    lemma,
    pos: 'noun',
    frequencyRank: rank,
    senses: [{ gloss }],
    examples: [{ text, translation, target: lemma, sense: 0 }],
  });
  const garza = word('garza', 'heron', 20, 'La garza pesca en el río.', 'The heron fishes in the river.');
  const bench = word('banca', 'bench', 21, 'Nos sentamos en la banca del parque.', 'We sat on the park bench.');
  const bank = word('banca', 'banking (industry)', 22, 'Mi tía trabaja en la banca.', 'My aunt works in banking.');
  const v1 = load([garza, bench, bank, word('ardilla', 'squirrel', 23, 'La ardilla come nueces.', 'The squirrel eats nuts.')], {});
  assert.equal(v1.stats.created, 4, JSON.stringify(v1.stats));
  const ids = (lemma: string) => db.all<{ id: number }>("SELECT id FROM vocabulary_entries WHERE language_code = 'es' AND lemma = ? ORDER BY id", lemma).map((r) => r.id);
  const [benchId, bankId] = ids('banca');
  const garzaId = ids('garza')[0];
  const now = Date.now();
  // A finished session planned garza without asking it; the learner started banca "bench".
  const item = Number(db.run("INSERT INTO learning_items (entry_id, language_code, status, created_at, updated_at) VALUES (?, 'es', 'new', ?, ?)", garzaId, now, now).lastInsertRowid);
  db.run(
    "INSERT INTO study_sessions (id, language_code, status, mode, config, plan_meta, resources, created_at) VALUES ('s-planned', 'es', 'completed', 'mixed', '{}', '{}', '{}', ?)",
    now,
  );
  db.run("INSERT INTO session_exercises (id, session_id, seq, stage, item_id, kind, payload) VALUES ('x-planned', 's-planned', 1, 'review', ?, 'meaning', '{}')", item);
  db.run("INSERT INTO learning_items (entry_id, language_code, status, introduced_at, created_at, updated_at) VALUES (?, 'es', 'introduced', ?, ?, ?)", benchId, now, now, now);

  // The new version keeps ardilla and banca "banking" only.
  const v2 = load([word('ardilla', 'squirrel', 23, 'La ardilla come nueces.', 'The squirrel eats nuts.'), bank], { refreshFrom: [v1.id] });
  assert.equal(v2.stats.removed, 1, JSON.stringify(v2.stats));
  assert.equal(v2.stats.keptStarted, 1);
  const garzaRow = db.get<{ deleted_at: number | null }>('SELECT deleted_at FROM vocabulary_entries WHERE id = ?', garzaId);
  assert.ok(garzaRow?.deleted_at, 'the planned word is marked deleted, not deleted');
  assert.equal(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM session_exercises WHERE session_id = 's-planned'")!.n, 1, 'the session keeps its exercise');
  assert.equal((await c.get(`/api/vocab/${garzaId}`)).status, 404, 'a deleted word is gone from the app');

  const benchAfter = (await c.get(`/api/vocab/${benchId}`)).body;
  assert.deepEqual(benchAfter.senses.map((s: any) => s.gloss), ['bench'], 'the started homograph keeps its own meaning');
  const bankAfter = (await c.get(`/api/vocab/${bankId}`)).body;
  assert.deepEqual(bankAfter.senses.map((s: any) => s.gloss), ['banking (industry)'], 'the row refreshes the homograph with its meaning');
  assert.equal(db.get<{ frequency_rank: number | null }>('SELECT frequency_rank FROM vocabulary_entries WHERE id = ?', bankId)!.frequency_rank, 22);
});

test('undoing an import never leaves a word without a meaning', async () => {
  const app = srv.app;
  const job = createImportJob(app, { language: 'es', kind: 'vocabulary', fileName: 'frequency-es.json', data: Buffer.from(JSON.stringify(doc([{ lemma: 'zorzal', pos: 'noun', frequencyRank: 30, senses: [{ gloss: 'thrush' }] }], 'Undo test set'))), now: Date.now() });
  const set = commitImport(app, job.id, {}, { duplicatePolicy: 'merge', homographPolicy: 'merge' }, Date.now());
  assert.equal((set.stats as any).created, 1);
  const zorzal = db.get<{ id: number }>("SELECT id FROM vocabulary_entries WHERE language_code = 'es' AND lemma = 'zorzal'")!.id;
  // The learner's own list adds a meaning; the set's word stays because it was started.
  const mine = await importDoc('es', doc([{ lemma: 'zorzal', pos: 'noun', senses: [{ gloss: 'thrush' }, { gloss: 'clever person' }] }], 'My zorzal list'), { duplicatePolicy: 'merge', homographPolicy: 'merge' });
  assert.equal(mine.stats.merged, 1);
  db.run('DELETE FROM vocabulary_senses WHERE entry_id = ? AND import_job_id = ?', zorzal, job.id); // as if the set's meaning had gone
  const undo = await c.post(`/api/import/${mine.id}/undo`, {});
  assert.equal(undo.status, 200, JSON.stringify(undo.body));
  const after = (await c.get(`/api/vocab/${zorzal}`)).body;
  assert.ok(after.senses.length >= 1, 'the word keeps a meaning');
});

test('starter sentences know their meaning; reworded meanings from a set merge into the ones a word has', async () => {
  const r = await c.post('/api/import/starter', { language: 'es' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const quererId = db.get<{ id: number }>("SELECT id FROM vocabulary_entries WHERE language_code = 'es' AND lemma = 'querer'")!.id;
  const meaningOf = async () => {
    const d = (await c.get(`/api/vocab/${quererId}`)).body;
    return { senses: d.senses.map((s: any) => s.gloss), examples: d.examples.map((x: any) => [x.text, d.senses.find((s: any) => s.id === x.senseId)?.gloss ?? null]) };
  };
  let d = await meaningOf();
  assert.deepEqual(d.senses, ['to want', 'to love']);
  assert.ok(d.examples.some(([t, g]: [string, string]) => t === 'Te quiero mucho, mamá.' && g === 'to love'), 'every meaning has a sentence');

  // Sentences loaded by an earlier version had no meaning: they are linked from the bundled file.
  db.run("UPDATE entry_examples SET sense_id = NULL WHERE entry_id IN (SELECT id FROM vocabulary_entries WHERE language_code = 'es')");
  const { linkStarterSentences } = await import('../../server/vocab/importer.ts');
  assert.ok(linkStarterSentences(srv.app, 'es') > 100);
  assert.deepEqual((await meaningOf()).examples, d.examples);

  // A set that words the meaning differently ("to want, to wish") merges into "to want" and links its sentence there.
  await importDoc(
    'es',
    doc([{ lemma: 'querer', pos: 'verb', senses: [{ gloss: 'to want, to wish' }, { gloss: 'to love (a person)' }], examples: [{ text: 'Quiero un café.', translation: 'I want a coffee.', target: 'Quiero', sense: 0 }, { text: 'Te quiero.', translation: 'I love you.', target: 'quiero', sense: 1 }] }], 'Another set (es)'),
    { duplicatePolicy: 'merge', homographPolicy: 'merge' },
  );
  d = await meaningOf();
  assert.deepEqual(d.senses, ['to want', 'to love'], 'no second copy of either meaning');
  assert.deepEqual(d.examples.filter(([t]: [string]) => t === 'Quiero un café.' || t === 'Te quiero.'), [
    ['Quiero un café.', 'to want'],
    ['Te quiero.', 'to love'],
  ]);
});
