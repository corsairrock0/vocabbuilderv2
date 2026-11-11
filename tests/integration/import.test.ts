// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Vocabulary import through the API: mapping, preview, validation, duplicates, homographs,
// transactional commit/rollback, undo, frequency lists, Kaikki — and accents surviving import.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Client, FIXTURE, startTestServer, type TestServer } from '../helpers/harness.ts';
import { answer, importFixture, startSession } from '../helpers/study.ts';
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

async function upload(lang: string, filename: string, content: string | Buffer, kind = 'vocabulary') {
  const r = await c.post(`/api/import/upload?lang=${lang}&kind=${kind}&filename=${encodeURIComponent(filename)}`, typeof content === 'string' ? Buffer.from(content) : content, {
    'Content-Type': 'application/octet-stream',
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
}

const entries = (lang: string) => db.all<{ id: number; lemma: string; display: string | null; pos: string; homograph: number; frequency_rank: number | null }>(
  'SELECT id, lemma, display, pos, homograph, frequency_rank FROM vocabulary_entries WHERE language_code = ? AND deleted_at IS NULL ORDER BY id',
  lang,
);

test('CSV import: preview, suggested column mapping, validation and commit', async () => {
  const csv = [
    'Word,English,Part of speech,Rank,Example,Example translation,Tags',
    'dónde,where,adverb,1,¿Dónde vives?,Where do you live?,questions',
    'también,also; too,adverb,2,Yo también.,Me too.,connectors',
    'niño,child; boy,noun,3,El niño juega.,The child plays.,"family, people"',
    ',no word,noun,4,,,',
  ].join('\n');
  const job = await upload('es', 'basics.csv', csv);
  assert.equal(job.format, 'csv');
  assert.equal(job.needsMapping, true);
  assert.equal(job.rowCount, 4);
  assert.deepEqual(job.suggestedMapping, { lemma: 'Word', gloss: 'English', pos: 'Part of speech', rank: 'Rank', example: 'Example', exampleTranslation: 'Example translation', tags: 'Tags' });
  const v = await c.post(`/api/import/${job.id}/validate`, { mapping: job.suggestedMapping, options: {} });
  assert.equal(v.status, 200);
  assert.equal(v.body.report.valid, 3);
  assert.deepEqual(v.body.report.errors, [{ row: 4, lemma: '', errors: ['Missing word'] }]);
  assert.equal(v.body.report.newEntries, 3);
  const commit = await c.post(`/api/import/${job.id}/commit`, { mapping: job.suggestedMapping, options: {} });
  assert.equal(commit.status, 200, JSON.stringify(commit.body));
  assert.deepEqual(commit.body.stats, { created: 3, merged: 0, skipped: 0, errors: 1, homographsCreated: 0 });
  // Accents are preserved in the stored headwords and examples (regression for stress-mark stripping).
  assert.deepEqual(entries('es').map((e) => e.lemma), ['dónde', 'también', 'niño']);
  const detail = (await c.get(`/api/vocab/${entries('es')[0].id}`)).body;
  assert.equal(detail.examples[0].text, '¿Dónde vives?');
  assert.equal(detail.examples[0].target, null, 'no target column mapped');
  assert.equal(detail.frequencyRank, 1);
  const nino = (await c.get(`/api/vocab/${entries('es')[2].id}`)).body;
  assert.deepEqual(nino.senses[0].translations, ['child', 'boy']);
  assert.deepEqual(nino.tags.sort(), ['family', 'people']);
  assert.equal(nino.source.kind, 'user');
  // Searching works with and without accents typed exactly.
  assert.equal((await c.get('/api/vocab?lang=es&q=dónde')).body.total, 1);
  assert.equal((await c.get('/api/vocab?lang=es&q=child')).body.total, 1);
  const jobs = (await c.get('/api/import/jobs?lang=es')).body;
  assert.equal(jobs[0].status, 'committed');
});

test('TSV and generic JSON imports', async () => {
  const tsv = 'palavra\tsignificado\texemplo\ttradução do exemplo\nônibus\tbus\tPeguei o ônibus.\tI took the bus.\nvocê\tyou\tVocê fala inglês?\tDo you speak English?\n';
  const job = await upload('pt', 'pt.tsv', tsv);
  assert.equal(job.format, 'tsv');
  const mapping = { lemma: 'palavra', gloss: 'significado', example: 'exemplo', exampleTranslation: 'tradução do exemplo' };
  const r = await c.post(`/api/import/${job.id}/commit`, { mapping, options: {} });
  assert.equal(r.body.stats.created, 2);
  assert.deepEqual(entries('pt').map((e) => e.lemma), ['ônibus', 'você']);
  const json = JSON.stringify([
    { word: 'mówić', meaning: 'to speak', pos: 'verb' },
    { word: 'źdźbło', meaning: 'blade (of grass)', pos: 'noun' },
  ]);
  const j = await upload('pl', 'pl.json', json);
  assert.equal(j.format, 'json');
  assert.deepEqual(j.suggestedMapping, { lemma: 'word', gloss: 'meaning', pos: 'pos' });
  const r2 = await c.post(`/api/import/${j.id}/commit`, { mapping: j.suggestedMapping, options: {} });
  assert.equal(r2.body.stats.created, 2);
  assert.deepEqual(entries('pl').map((e) => [e.lemma, e.pos]), [['mówić', 'verb'], ['źdźbło', 'noun']]);
});

test('VocabBuilder JSON keeps tones, stress-marked display forms and cloze targets', async () => {
  await importFixture(c, 'vi-mini.json', 'vi');
  await importFixture(c, 'ru-mini.json', 'ru');
  assert.deepEqual(entries('vi').map((e) => e.lemma), ['tiền', 'cám ơn', 'xe buýt', 'ly', 'nước', 'đi', 'má', 'ma']);
  const ru = entries('ru');
  assert.equal(ru[0].lemma, 'вода');
  assert.equal(ru[0].display, 'вода́');
  const voda = (await c.get(`/api/vocab/${ru[0].id}`)).body;
  assert.equal(voda.examples[0].text, 'Я пью воду.', 'plain text without stress marks');
  assert.equal(voda.examples[0].display, 'Я пью во́ду.', 'display keeps learner stress marks');
  assert.equal(voda.examples[0].target, 'воду');
  assert.deepEqual(voda.forms.map((f: any) => f.form), ['воду', 'воды', 'воды']);
  // Every example target was located in its sentence (needed for cloze exercises).
  const missing = db.all("SELECT ee.entry_id FROM entry_examples ee JOIN vocabulary_entries e ON e.id = ee.entry_id WHERE e.language_code IN ('vi','ru') AND ee.target IS NULL");
  assert.equal(missing.length, 0);
  const tien = (await c.get(`/api/vocab/${entries('vi')[0].id}`)).body;
  assert.equal(tien.examples[0].target, 'tiền');
  assert.equal(tien.source.name, 'Test fixture (Southern Vietnamese)');
  // A file for another language is refused.
  const wrong = await upload('pl', 'ru.json', readFileSync(path.join(FIXTURE, 'ru-mini.json')));
  const commit = await c.post(`/api/import/${wrong.id}/commit`, { mapping: {}, options: {} });
  assert.equal(commit.status, 422);
  assert.equal(commit.body.error.code, 'language_mismatch');
});

test('Kaikki/Wiktextract JSONL import', async () => {
  const text = readFileSync(path.join(FIXTURE, 'kaikki-sample.jsonl'));
  const job = await upload('es', 'kaikki.jsonl', text);
  assert.equal(job.format, 'kaikki');
  assert.equal(job.needsMapping, false);
  const r = await c.post(`/api/import/${job.id}/commit`, { mapping: {}, options: {} });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.stats.created, 2, 'agua and tinto; form-of and other-language lines skipped');
  const agua = entries('es').find((e) => e.lemma === 'agua')!;
  const d = (await c.get(`/api/vocab/${agua.id}`)).body;
  assert.equal(d.pronunciation, '/ˈaɡwa/');
  assert.deepEqual(d.senses.map((s: any) => s.gloss), ['water', 'rain']);
  assert.equal(d.examples[0].translation, 'I want a glass of water.');
  assert.equal(d.source.kind, 'dictionary');
});

test('frequency lists rank existing words, matching inflected forms to their lemma', async () => {
  const list = 'воду 500\nвода 300\nхлеб 200\nнеизвестное 100\n';
  const job = await upload('ru', 'ru_freq.txt', list, 'frequency');
  assert.equal(job.format, 'frequency');
  const v = await c.post(`/api/import/${job.id}/validate`, { mapping: {}, options: { frequencyKind: 'frequency_subtitles' } });
  assert.equal(v.status, 200, JSON.stringify(v.body));
  assert.equal(v.body.report.total, 4);
  assert.equal(v.body.report.entriesRanked, 2);
  assert.equal(v.body.report.unmatched, 1);
  const r = await c.post(`/api/import/${job.id}/commit`, { mapping: {}, options: { frequencyKind: 'frequency_subtitles', sourceName: 'Subtitle test list' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const voda = entries('ru').find((e) => e.lemma === 'вода')!;
  const hleb = entries('ru').find((e) => e.lemma === 'хлеб')!;
  assert.equal(voda.frequency_rank, 1, 'best rank among the lemma’s forms (воду ranks first)');
  assert.equal(hleb.frequency_rank, 3);
  const f = db.get<{ matched_form: string; count: number }>('SELECT matched_form, count FROM vocabulary_frequency WHERE entry_id = ?', voda.id)!;
  assert.equal(f.matched_form, 'воду');
  assert.equal(f.count, 500);
  const src = db.get<{ kind: string; name: string }>('SELECT s.kind, s.name FROM vocabulary_frequency f JOIN sources s ON s.id = f.source_id WHERE f.entry_id = ?', voda.id)!;
  assert.deepEqual({ ...src }, { kind: 'frequency_subtitles', name: 'Subtitle test list' });
  const sorted = (await c.get('/api/vocab?lang=ru&sort=frequency&limit=3')).body.items.map((i: any) => i.lemma);
  assert.deepEqual(sorted.slice(0, 2), ['вода', 'хлеб']);
  assert.equal(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM vocabulary_entries WHERE lemma = 'неизвестное'")!.n, 0, 'unmatched words are not created without meanings');
});

test('duplicates: in-file duplicates skipped; existing duplicates skipped or merged; homographs never merged silently', async () => {
  const csv = 'word,meaning\nвода,water\nвода,water\nвода,water; H2O\nдом,dome\nновый,new\nновый,new\n';
  const job = await upload('ru', 'dups.csv', csv);
  const mapping = { lemma: 'word', gloss: 'meaning' };
  const v = (await c.post(`/api/import/${job.id}/validate`, { mapping, options: {} })).body.report;
  assert.equal(v.inFileDuplicates.length, 2, 'repeated identical rows');
  assert.equal(v.duplicates.length, 2, 'вода twice (same meaning as the existing entry)');
  assert.equal(v.homographs.length, 1, 'дом (dome) vs existing дом (house)');
  assert.equal(v.homographs[0].existing[0].gloss, 'house');
  assert.equal(v.newEntries, 1);
  const r = await c.post(`/api/import/${job.id}/commit`, { mapping, options: { duplicatePolicy: 'merge' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.stats, { created: 2, merged: 2, skipped: 2, errors: 0, homographsCreated: 1 });
  const doms = entries('ru').filter((e) => e.lemma === 'дом');
  assert.equal(doms.length, 2, 'a separate entry for the other meaning');
  const glosses = await Promise.all(doms.map(async (d) => (await c.get(`/api/vocab/${d.id}`)).body.gloss));
  assert.deepEqual(glosses.sort(), ['dome', 'house']);
  const voda = entries('ru').filter((e) => e.lemma === 'вода');
  assert.equal(voda.length, 1);
  const d = (await c.get(`/api/vocab/${voda[0].id}`)).body;
  assert.ok(d.senses[0].translations.includes('H2O'), 'merge adds the new alternative translation to the same meaning');
  // A per-row decision overrides the policy.
  const job2 = await upload('ru', 'dups2.csv', 'word,meaning\nдом,cathedral\n');
  const r2 = await c.post(`/api/import/${job2.id}/commit`, { mapping, options: { decisions: { '1': 'skip' } } });
  assert.deepEqual(r2.body.stats, { created: 0, merged: 0, skipped: 1, errors: 0, homographsCreated: 0 });
  assert.equal((await c.post(`/api/import/${job2.id}/commit`, { mapping, options: {} })).status, 409, 'a committed job cannot be committed twice');
});

test('a failure during commit rolls the whole file back', async () => {
  const before = entries('uk').length;
  db.exec("CREATE TEMP TRIGGER fail_on_word BEFORE INSERT ON vocabulary_entries WHEN NEW.lemma = 'вибух' BEGIN SELECT RAISE(ABORT, 'simulated disk failure'); END;");
  try {
    const job = await upload('uk', 'uk.csv', 'слово,значення\nдякую,thank you\nвода,water\nвибух,explosion\nхліб,bread\n');
    const r = await c.post(`/api/import/${job.id}/commit`, { mapping: { lemma: 'слово', gloss: 'значення' }, options: {} });
    assert.equal(r.status, 422);
    assert.equal(r.body.error.code, 'import_failed');
    assert.match(r.body.error.message, /rolled back/);
    assert.equal(entries('uk').length, before, 'rows before the failure were not kept');
    assert.equal(db.get<{ status: string }>('SELECT status FROM import_jobs WHERE id = ?', job.id)!.status, 'failed');
  } finally {
    db.exec('DROP TRIGGER IF EXISTS fail_on_word');
  }
});

test('undo removes imported words without progress and keeps studied ones', async () => {
  const job = await upload('uk', 'uk-basic.csv', 'word,meaning,rank\nдякую,thank you,1\nбудь ласка,please,2\nзараз,now,3\n');
  const r = await c.post(`/api/import/${job.id}/commit`, { mapping: { lemma: 'word', gloss: 'meaning', rank: 'rank' }, options: {} });
  assert.equal(r.body.stats.created, 3);
  const s = await startSession(c, { language: 'uk', minutes: 10, newWords: 1 });
  const intro = s.exercises.find((e: any) => e.kind === 'intro');
  await answer(c, s.id, intro);
  await c.post(`/api/sessions/${s.id}/complete`);
  const u = await c.post(`/api/import/${job.id}/undo`);
  assert.equal(u.status, 200, JSON.stringify(u.body));
  assert.deepEqual(u.body, { removed: 2, keptWithProgress: 1 });
  assert.deepEqual(entries('uk').map((e) => e.lemma), ['дякую']);
  assert.equal((await c.post(`/api/import/${job.id}/undo`)).status, 409);
});

test('upload errors are clear', async () => {
  assert.equal((await c.post('/api/import/upload?lang=es&filename=x.csv', Buffer.alloc(0), { 'Content-Type': 'text/csv' })).status, 400);
  assert.equal((await c.post('/api/import/upload?lang=xx&filename=x.csv', Buffer.from('a,b'), { 'Content-Type': 'text/csv' })).status, 404);
  const job = await upload('es', 'bad.csv', 'word,meaning\nagua,water\n');
  const r = await c.post(`/api/import/${job.id}/commit`, { mapping: { gloss: 'meaning' }, options: {} });
  assert.equal(r.status, 422);
  assert.equal(r.body.error.code, 'mapping_required');
});

test('custom words can be added, edited with conflict detection, and deleted', async () => {
  const add = await c.post('/api/vocab', { language: 'es', lemma: 'parcero', senses: [{ gloss: 'buddy', translations: ['friend', 'mate'] }], register: 'slang', regionalNote: 'Colombia (Medellín/Bogotá)' });
  assert.equal(add.status, 200, JSON.stringify(add.body));
  const id = add.body.entryId;
  const d1 = (await c.get(`/api/vocab/${id}`)).body;
  assert.equal(d1.isCustom, true);
  const edit = await c.put(`/api/vocab/${id}`, { lemma: 'parcero', senses: [{ gloss: 'buddy', translations: ['pal'] }], baseVersion: d1.version });
  assert.equal(edit.status, 200, JSON.stringify(edit.body));
  assert.deepEqual(edit.body.senses[0].translations, ['buddy', 'pal']);
  const stale = await c.put(`/api/vocab/${id}`, { lemma: 'parce', senses: [{ gloss: 'buddy' }], baseVersion: d1.version });
  assert.equal(stale.status, 409, 'an edit based on an outdated version is rejected, not silently applied');
  assert.equal(stale.body.error.code, 'edit_conflict');
  assert.equal((await c.post('/api/vocab', { language: 'es', lemma: '́', senses: [{ gloss: 'nothing' }] })).status, 422);
  assert.equal((await c.req('DELETE', `/api/vocab/${id}`)).status, 200);
  assert.equal((await c.get(`/api/vocab/${id}`)).status, 404);
});

test('regression: imported accents survive into exercises and grading', async () => {
  const s = (await c.post('/api/sessions', { id: crypto.randomUUID(), language: 'es', minutes: 30, newWords: 2 })).body;
  const recall = s.exercises.find((e: any) => e.kind === 'recall_typed' && s.items[String(e.itemId)].lemma === 'dónde');
  assert.ok(recall, 'dónde is studied first (frequency rank 1)');
  assert.equal(recall.payload.answer.accepted[0], 'dónde');
  const intro = s.exercises.find((e: any) => e.kind === 'intro' && e.itemId === recall.itemId);
  assert.equal(s.items[String(recall.itemId)].display, 'dónde');
  await answer(c, s.id, intro);
  const r = await answer(c, s.id, recall, { response: 'donde' });
  assert.equal(r.result.grade, 'close');
  assert.equal(r.result.code, 'missing_diacritics');
  assert.equal(r.result.expected, 'dónde');
  await c.post(`/api/sessions/${s.id}/complete`);
});
