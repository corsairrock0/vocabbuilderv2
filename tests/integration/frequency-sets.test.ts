// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// The bundled "most frequent words" sets: status, loading on top of a starter set without duplicates,
// frequency order, the build report, and undo.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Client, startTestServer, type TestServer } from '../helpers/harness.ts';
import type { Db } from '../../server/db/database.ts';

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

// Each set has 6,000 ranks, less the words taken out (crude words, say).
const setSize = (lang: string) => JSON.parse(readFileSync(path.join(import.meta.dirname, '../../data/frequency', `${lang}.json`), 'utf8')).entries.length as number;
const count = (lang: string) => db.get<{ n: number }>('SELECT COUNT(*) AS n FROM vocabulary_entries WHERE language_code = ? AND deleted_at IS NULL', lang)!.n;

test('every language offers a set of about 6,000 words, not yet loaded', async () => {
  const r = await c.get('/api/import/frequency-sets');
  assert.equal(r.status, 200);
  for (const code of ['es', 'pt', 'vi', 'ru', 'uk', 'pl']) {
    assert.equal(r.body[code].words, setSize(code), code);
    assert.ok(setSize(code) > 5900 && setSize(code) <= 6000, `${code}: ${setSize(code)} words`);
    assert.equal(r.body[code].loaded, false, code);
  }
  const boot = await c.get('/api/bootstrap');
  assert.equal(boot.body.languages.find((l: any) => l.code === 'es').frequencySet.words, setSize('es'));
});

test('loading the Spanish set after the starter set merges shared words and ranks them', async () => {
  const starter = await c.post('/api/import/starter', { language: 'es' });
  assert.equal(starter.status, 200, JSON.stringify(starter.body));
  const starterCount = count('es');
  const agua = () => db.get<{ id: number; frequency_rank: number | null }>("SELECT id, frequency_rank FROM vocabulary_entries WHERE language_code = 'es' AND lemma = 'agua'");
  assert.equal(agua()!.frequency_rank, null, 'starter words have a teaching order, not a frequency rank');

  const t0 = Date.now();
  const r = await c.post('/api/import/frequency-set', { language: 'es' });
  const ms = Date.now() - t0;
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const { created, merged, skipped, errors } = r.body.stats;
  assert.equal(errors, 0);
  assert.ok(merged > 0, 'starter words were merged');
  assert.equal(created + merged + skipped, setSize('es'));
  assert.equal(count('es'), starterCount + created);
  assert.ok(ms < 60_000, `import took ${ms} ms`);

  const dups = db.all('SELECT lemma_key, pos, COUNT(*) AS n FROM vocabulary_entries WHERE language_code = ? AND deleted_at IS NULL GROUP BY lemma_key, pos, homograph HAVING n > 1', 'es');
  assert.deepEqual(dups, [], 'no word is duplicated');

  assert.ok(agua()!.frequency_rank! > 0 && agua()!.frequency_rank! < 1000, `agua is ranked (${agua()!.frequency_rank})`);
  const first = db.get<{ lemma: string }>("SELECT lemma FROM vocabulary_entries WHERE language_code = 'es' AND deleted_at IS NULL AND frequency_rank IS NOT NULL ORDER BY frequency_rank LIMIT 1");
  assert.equal(first!.lemma, 'el');

  const status = await c.get('/api/import/frequency-sets');
  assert.equal(status.body.es.loaded, true);
  const pref = db.get<{ value: string }>("SELECT value FROM language_settings WHERE language_code = 'es' AND key = 'frequencySourceId'");
  assert.ok(pref && JSON.parse(pref.value) > 0, 'the set becomes the frequency source that orders new words');

  // New words are introduced in frequency order.
  const detail = await c.get(`/api/vocab/${agua()!.id}`);
  assert.equal(detail.status, 200);
  assert.ok(detail.body.senses.some((s: any) => /water/.test(s.gloss)));
});

test('a loaded set records its version, so no update is offered until a newer set ships; its stored copy is removed', async () => {
  const status = await c.get('/api/import/frequency-sets');
  assert.equal(status.body.es.updateAvailable, false);
  assert.equal(status.body.pt.updateAvailable, false, 'nothing to update in a set that is not loaded');
  const job = db.get<{ stored_file: string | null; options: string }>("SELECT stored_file, options FROM import_jobs WHERE file_name = 'frequency-es.json'");
  assert.equal(job!.stored_file, null, 'the set ships with the app, so the import keeps no copy');
  assert.ok(JSON.parse(job!.options).setVersion);
  const up = await c.post('/api/import/frequency-set/update', { language: 'es' });
  assert.equal(up.status, 200, JSON.stringify(up.body));
  assert.equal(up.body.status, 'up_to_date');
});

test('the build report lists sources and skipped words', async () => {
  const r = await c.get('/api/import/frequency-sets/uk/report');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type') ?? '', /^text\/plain; charset=utf-8/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  const text = String(r.body);
  assert.match(text, /## Sources/);
  assert.match(text, /dmklinger\/ukrainian/);
  assert.match(text, /## Skipped words/);
});

test('Ukrainian words defined by the fallback dictionary are tagged', async () => {
  const r = await c.post('/api/import/frequency-set', { language: 'uk' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.stats.created, setSize('uk'));
  const tagged = db.get<{ n: number }>(
    "SELECT COUNT(*) AS n FROM entry_tags et JOIN tags t ON t.id = et.tag_id JOIN vocabulary_entries e ON e.id = et.entry_id WHERE t.name = 'fallback-dictionary' AND e.language_code = 'uk'",
  )!.n;
  assert.ok(tagged > 500 && tagged < 3000, `${tagged} tagged`);
  const stressed = db.get<{ display: string }>("SELECT display FROM vocabulary_entries WHERE language_code = 'uk' AND lemma = 'людина'");
  assert.equal(stressed!.display, 'люди́на');
});

test('undo removes the set and restores the starter words’ order', async () => {
  const jobs = (await c.get('/api/import/jobs?lang=es')).body;
  const job = jobs.find((j: any) => j.file_name === 'frequency-es.json');
  const before = count('es');
  const r = await c.post(`/api/import/${job.id}/undo`, {});
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(count('es') < before);
  assert.equal(db.get<{ frequency_rank: number | null }>("SELECT frequency_rank FROM vocabulary_entries WHERE language_code = 'es' AND lemma = 'agua'")!.frequency_rank, null);
  assert.equal((await c.get('/api/import/frequency-sets')).body.es.loaded, false);
});

test('a set loads again after undo, and words already started keep their progress without duplicates', async () => {
  const entry = (lemma: string) => db.get<{ id: number; frequency_rank: number | null }>("SELECT id, frequency_rank FROM vocabulary_entries WHERE language_code = 'uk' AND lemma = ? AND deleted_at IS NULL", lemma);
  const started = entry('людина')!;
  const untouched = entry('вода')!;
  // Stand-in for a study session introducing this word (learning items are created when a word is first studied).
  const now = Date.now();
  db.run("INSERT INTO learning_items (entry_id, language_code, status, introduced_at, created_at, updated_at) VALUES (?, 'uk', 'introduced', ?, ?, ?)", started.id, now, now, now);
  const senses = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM vocabulary_senses WHERE entry_id = ?', started.id)!.n;

  const job = (await c.get('/api/import/jobs?lang=uk')).body.find((j: any) => j.file_name === 'frequency-uk.json' && j.status === 'committed');
  const undo = await c.post(`/api/import/${job.id}/undo`, {});
  assert.equal(undo.status, 200, JSON.stringify(undo.body));
  assert.deepEqual(undo.body, { removed: setSize('uk') - 1, keptWithProgress: 1 });
  assert.equal(count('uk'), 1);
  assert.equal(entry('вода'), undefined, 'words not started are removed');
  assert.equal(entry('людина')!.frequency_rank, started.frequency_rank, 'the started word keeps its rank');
  assert.equal((await c.get('/api/import/frequency-sets')).body.uk.loaded, false, 'the set can be loaded again');

  const again = await c.post('/api/import/frequency-set', { language: 'uk' });
  assert.equal(again.status, 200, JSON.stringify(again.body));
  assert.equal(again.body.stats.created, setSize('uk') - 1);
  assert.equal(again.body.stats.merged, 1);
  assert.equal(count('uk'), setSize('uk'));
  assert.equal(entry('людина')!.id, started.id, 'the started word is the same word, not a copy');
  assert.equal(db.get<{ status: string }>('SELECT status FROM learning_items WHERE entry_id = ?', started.id)!.status, 'introduced');
  assert.equal(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM vocabulary_senses WHERE entry_id = ?', started.id)!.n, senses, 'identical senses are not added twice');
  assert.equal(entry('вода')!.frequency_rank, untouched.frequency_rank);
  assert.equal((await c.get('/api/import/frequency-sets')).body.uk.loaded, true);
});
