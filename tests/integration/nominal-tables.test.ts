// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Spanish and Portuguese gender and number tables (1.8.5) through the server: an update of a loaded set gives a word
// its table and replaces the set's forms (a misspelt form goes), and forms practice asks for and grades the cells.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Client, startTestServer, type TestServer } from '../helpers/harness.ts';
import type { Db } from '../../server/db/database.ts';
import { commitImport, createImportJob } from '../../server/vocab/importer.ts';

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

const ptDoc = (entries: unknown[]) => ({ format: 'vocabbuilder-v1', language: 'pt', source: { name: 'Bundled set (pt)', kind: 'frequency_mixed', license: 'CC-BY-SA-4.0' }, sentenceSources: {}, entries });
const load = (entries: unknown[], options: Record<string, unknown> = {}) => {
  const app = srv.app;
  const job = createImportJob(app, { language: 'pt', kind: 'vocabulary', fileName: 'frequency-pt.json', data: Buffer.from(JSON.stringify(ptDoc(entries))), now: Date.now() });
  const r = commitImport(app, job.id, {}, { duplicatePolicy: 'merge', homographPolicy: 'merge', ...options }, Date.now());
  return { id: job.id, stats: r.stats as Record<string, number> };
};
const sentence = { text: 'Não é a sua vez.', translation: "It's not your turn.", target: 'sua' };
const seuId = () => db.get<{ id: number }>("SELECT id FROM vocabulary_entries WHERE language_code = 'pt' AND lemma = 'seu'")!.id;

test('an update gives a Portuguese word its gender and number table and takes out a misspelt form', async () => {
  const v1 = load([{ lemma: 'seu', pos: 'pronoun', frequencyRank: 15, senses: [{ gloss: 'your, yours' }], forms: [{ form: 'sua' }, { form: 'seus' }, { form: 'suas' }, { form: 'sus' }], examples: [{ ...sentence }] }]);
  const before1 = (await c.get(`/api/vocab/${seuId()}`)).body;
  assert.equal(before1.paradigm, null);
  assert.ok(before1.forms.some((f: any) => f.form === 'sus'));

  const table = { kind: 'pronoun', source: 'VocabBuilder', cells: { 'sg|m': ['seu'], 'sg|f': ['sua'], 'pl|m': ['seus'], 'pl|f': ['suas'] } };
  const v2 = load([{ lemma: 'seu', pos: 'pronoun', frequencyRank: 15, senses: [{ gloss: 'your, yours' }], paradigm: table, forms: [{ form: 'sua' }, { form: 'seus' }, { form: 'suas' }], examples: [{ ...sentence, sense: 0 }] }], { refreshFrom: [v1.id] });
  assert.equal(v2.stats.refreshed, 1, JSON.stringify(v2.stats));
  const after1 = (await c.get(`/api/vocab/${seuId()}`)).body;
  assert.deepEqual(after1.paradigm.cells, table.cells);
  const tags = Object.fromEntries(after1.forms.map((f: any) => [f.form, f.tags]));
  assert.deepEqual([tags.sua, tags.seus, tags.suas], [['feminine singular'], ['masculine plural'], ['feminine plural']], 'labelled by the table');
  assert.ok(!after1.forms.some((f: any) => f.form === 'sus'), 'the misspelt form is gone');
});

test('forms practice asks for the feminine and the plurals and grades them on the server', async () => {
  const b = await c.post('/api/practice/forms/batch', { language: 'pt', scope: 'all', tenses: ['gn'], size: 10 });
  assert.equal(b.status, 200, JSON.stringify(b.body));
  assert.deepEqual(b.body.items.map((i: any) => i.cell).sort(), ['pl|f', 'pl|m', 'sg|f']);
  const fem = b.body.items.find((i: any) => i.cell === 'sg|f');
  assert.equal(fem.label, 'feminine singular');
  assert.equal(fem.tense, null);
  assert.deepEqual(fem.answer.accepted, ['sua']);
  const right = await c.post('/api/practice/attempts', { opId: randomUUID(), mode: 'forms', entryId: seuId(), cell: 'sg|f', response: 'sua', answeredAt: Date.now() });
  assert.equal(right.body.grade, 'correct');
  const wrong = await c.post('/api/practice/attempts', { opId: randomUUID(), mode: 'forms', entryId: seuId(), cell: 'sg|f', response: 'suas', answeredAt: Date.now() });
  assert.equal(wrong.body.grade, 'close');
  assert.match(wrong.body.message, /suas.*feminine plural/);
  const verbsOnly = await c.post('/api/practice/forms/batch', { language: 'pt', scope: 'all', tenses: ['ind.pres'], size: 10 });
  assert.equal(verbsOnly.body.items.length, 0, 'not without the group');
});
