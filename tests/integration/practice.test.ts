// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Inflection tables and the two practice modes: import (tables, sentence sources), the word page, the forms
// drill and the sentence cloze, server grading, idempotent attempts, merging tables into existing words, undo.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
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

async function importDoc(lang: string, doc: unknown, options: Record<string, unknown> = {}) {
  const up = await c.post(`/api/import/upload?lang=${lang}&kind=vocabulary&filename=set.json`, Buffer.from(JSON.stringify(doc)), { 'Content-Type': 'application/octet-stream' });
  assert.equal(up.status, 200, JSON.stringify(up.body));
  const commit = await c.post(`/api/import/${up.body.id}/commit`, { mapping: {}, options });
  assert.equal(commit.status, 200, JSON.stringify(commit.body));
  return { id: up.body.id as string, stats: commit.body.stats };
}

const kniga = {
  lemma: 'книга',
  display: 'кни́га',
  pos: 'noun',
  gender: 'f',
  senses: [{ gloss: 'book' }],
  forms: [{ form: 'книги', tags: [] }],
  examples: [
    { text: 'Это моя книга.', translation: 'This is my book.', target: 'книга', source: 'tatoeba', ref: 'tatoeba:123' },
    { text: 'У меня нет книги.', translation: "I don't have the book.", target: 'книги', source: 'tatoeba', ref: 'tatoeba:456' },
    { text: 'Книг было много.', translation: null, target: 'Книг', source: 'ru-taiga', ref: 'ru-taiga:x1' },
  ],
  paradigm: {
    kind: 'noun',
    source: 'OpenRussian',
    cells: {
      'nom|sg': ['кни́га'], 'nom|pl': ['кни́ги'], 'gen|sg': ['кни́ги'], 'gen|pl': ['книг'], 'dat|sg': ['кни́ге'], 'dat|pl': ['кни́гам'],
      'acc|sg': ['кни́гу'], 'acc|pl': ['кни́ги'], 'ins|sg': ['кни́гой', 'кни́гою'], 'ins|pl': ['кни́гами'], 'loc|sg': ['кни́ге'], 'loc|pl': ['кни́гах'],
    },
  },
};
const kofe = { lemma: 'кофе', pos: 'noun', senses: [{ gloss: 'coffee' }], paradigm: { kind: 'noun', source: 'OpenRussian', indeclinable: true, cells: {} } };
const ruDoc = {
  format: 'vocabbuilder-v1',
  language: 'ru',
  source: { name: 'Test set (ru)', kind: 'frequency_mixed', license: 'CC-BY-SA-4.0' },
  sentenceSources: {
    tatoeba: { name: 'Tatoeba', license: 'CC-BY-2.0-FR', url: 'https://tatoeba.org' },
    'ru-taiga': { name: 'UD Russian Taiga', license: 'CC-BY-SA-4.0', url: 'https://github.com/UniversalDependencies/UD_Russian-Taiga' },
  },
  entries: [kniga, kofe],
};

let ruJob = '';
let knigaId = 0;

test('a table and sourced sentences import with the word; its forms are stored with the cells they fill', async () => {
  const r = await importDoc('ru', ruDoc);
  ruJob = r.id;
  assert.equal(r.stats.created, 2);
  knigaId = db.get<{ id: number }>("SELECT id FROM vocabulary_entries WHERE language_code = 'ru' AND lemma = 'книга'")!.id;
  const d = (await c.get(`/api/vocab/${knigaId}`)).body;
  assert.equal(d.paradigm.kind, 'noun');
  assert.deepEqual(d.paradigm.cells['ins|sg'], ['кни́гой', 'кни́гою']);
  const kniги = d.forms.find((f: any) => f.form === 'книги');
  assert.ok(kniги, 'the form книги is stored once');
  assert.deepEqual(kniги.tags, ['nominative plural', 'genitive singular', 'accusative plural']);
  assert.equal(kniги.display, 'кни́ги');
  // Each sentence keeps its own source, with a link to the sentence where the source has one.
  assert.deepEqual(d.examples.map((x: any) => x.source?.name), ['Tatoeba', 'Tatoeba', 'UD Russian Taiga']);
  assert.equal(d.examples[0].source.url, 'https://tatoeba.org/en/sentences/show/123');
  assert.equal(d.examples[2].source.url, 'https://github.com/UniversalDependencies/UD_Russian-Taiga');
  const kofeId = db.get<{ id: number }>("SELECT id FROM vocabulary_entries WHERE language_code = 'ru' AND lemma = 'кофе'")!.id;
  assert.equal((await c.get(`/api/vocab/${kofeId}`)).body.paradigm.indeclinable, true);
});

test('editing a word keeps its table and the sources of its sentences', async () => {
  const d = (await c.get(`/api/vocab/${knigaId}`)).body;
  const r = await c.put(`/api/vocab/${knigaId}`, {
    lemma: d.lemma,
    display: d.display,
    pos: d.pos,
    senses: d.senses.map((s: any) => ({ gloss: s.gloss })),
    forms: [],
    examples: d.examples.map((x: any) => ({ text: x.text, translation: x.translation, target: x.target })),
    baseVersion: d.version,
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const after = (await c.get(`/api/vocab/${knigaId}`)).body;
  assert.ok(after.paradigm, 'the table survives an edit that does not send it');
  assert.ok(after.forms.some((f: any) => f.form === 'книгами'), 'table forms are kept');
  assert.equal(after.examples[0].source.name, 'Tatoeba');
  assert.equal(after.examples[0].source.url, 'https://tatoeba.org/en/sentences/show/123');
});

test('the forms drill asks for cells by name and grades on the server; attempts are recorded once', async () => {
  const b = await c.post('/api/practice/forms/batch', { language: 'ru', scope: 'entry', entryId: knigaId, size: 50 });
  assert.equal(b.status, 200, JSON.stringify(b.body));
  assert.equal(b.body.available, 12, 'all twelve cells of книга');
  assert.equal(b.body.items.length, 12);
  const genPl = b.body.items.find((i: any) => i.cell === 'gen|pl');
  assert.equal(genPl.label, 'genitive plural');
  assert.deepEqual(genPl.answer.accepted, ['книг']);
  const opId = randomUUID();
  const wrong = await c.post('/api/practice/attempts', { opId, mode: 'forms', entryId: knigaId, cell: 'gen|pl', response: 'книги', answeredAt: Date.now() });
  assert.equal(wrong.status, 200, JSON.stringify(wrong.body));
  assert.equal(wrong.body.grade, 'close');
  assert.equal(wrong.body.code, 'wrong_form');
  assert.match(wrong.body.message, /книги.*genitive singular/);
  const again = await c.post('/api/practice/attempts', { opId, mode: 'forms', entryId: knigaId, cell: 'gen|pl', response: 'книг', answeredAt: Date.now() });
  assert.equal(again.body.duplicate, true);
  assert.equal(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM practice_attempts WHERE op_id = ?', opId)!.n, 1);
  const ok = await c.post('/api/practice/attempts', { opId: randomUUID(), mode: 'forms', entryId: knigaId, cell: 'ins|sg', response: 'книгою', answeredAt: Date.now() });
  assert.equal(ok.body.grade, 'correct', 'either instrumental form is right');
  // The missed cell comes back first.
  const next = await c.post('/api/practice/forms/batch', { language: 'ru', scope: 'entry', entryId: knigaId, size: 3 });
  assert.equal(next.body.items[0].cell, 'gen|pl');
  // An indeclinable word has nothing to drill.
  const all = await c.post('/api/practice/forms/batch', { language: 'ru', scope: 'all', size: 20 });
  assert.ok(all.body.items.every((i: any) => i.entryId === knigaId));
  // A word not being learned has no memory to schedule (practice-schedule.test.ts covers the words being learned).
  assert.equal(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM review_logs')!.n, 0);
});

test('a forms batch carries the tables of the words it asks about (the review before the quiz)', async () => {
  const b = await c.post('/api/practice/forms/batch', { language: 'ru', scope: 'entry', entryId: knigaId, size: 4 });
  assert.equal(b.status, 200, JSON.stringify(b.body));
  assert.deepEqual(Object.keys(b.body.tables), [String(knigaId)]);
  assert.deepEqual(b.body.tables[knigaId].cells['gen|pl'], ['книг']);
  assert.equal(b.body.tables[knigaId].kind, 'noun');
});

test('practice for a list of words (a Comprehensive session): forms, gaps and Read and say keep to those words', async () => {
  const forms = await c.post('/api/practice/forms/batch', { language: 'ru', scope: 'entries', entryIds: [knigaId], size: 3 });
  assert.equal(forms.status, 200, JSON.stringify(forms.body));
  assert.equal(forms.body.items.length, 3);
  assert.ok(forms.body.items.every((i: any) => i.entryId === knigaId));
  assert.ok(forms.body.tables[knigaId]);
  const cloze = await c.post('/api/practice/cloze/batch', { language: 'ru', scope: 'entries', entryIds: [knigaId], size: 3, choices: true });
  assert.equal(cloze.status, 200, JSON.stringify(cloze.body));
  assert.ok(cloze.body.items.length >= 1 && cloze.body.items.every((i: any) => i.entryId === knigaId));
  // A word without sentences or a table gives nothing to practice; an empty list is refused.
  const none = await c.post('/api/practice/forms/batch', { language: 'ru', scope: 'entries', entryIds: [999999], size: 3 });
  assert.deepEqual(none.body.items, []);
  const empty = await c.post('/api/practice/cloze/batch', { language: 'ru', scope: 'entries', entryIds: [], size: 3 });
  assert.equal(empty.status, 422);
  const identify = await c.post('/api/practice/identify/batch', { language: 'ru', scope: 'entries', entryIds: [knigaId], size: 3 });
  assert.equal(identify.status, 200, JSON.stringify(identify.body));
  const read = await c.post('/api/practice/read/batch', { language: 'ru', mode: 'say', size: 2, entryIds: [knigaId] });
  assert.equal(read.status, 200, JSON.stringify(read.body));
});

test('the cloze gives the sentence around a gap, the needed form, and grades other forms of the word as close', async () => {
  const b = await c.post('/api/practice/cloze/batch', { language: 'ru', scope: 'entry', entryId: knigaId, size: 10, choices: true });
  assert.equal(b.status, 200, JSON.stringify(b.body));
  assert.equal(b.body.items.length, 3);
  const gen = b.body.items.find((i: any) => i.target === 'книги');
  assert.equal(gen.before, 'У меня нет ');
  assert.equal(gen.after, '.');
  assert.equal(gen.needed, null, 'книги fills three cells, so the needed form is not named');
  assert.equal(gen.choices.length, 4);
  assert.ok(gen.choices.includes('книги'));
  const gap = b.body.items.find((i: any) => i.target === 'Книг');
  assert.equal(gap.needed, 'genitive plural');
  assert.equal(gap.translation, null);
  assert.equal(gap.gloss, 'book');
  assert.equal(gap.source.name, 'UD Russian Taiga');
  const sentenceId = gen.sentenceId;
  const close = await c.post('/api/practice/attempts', { opId: randomUUID(), mode: 'cloze', entryId: knigaId, sentenceId, response: 'книга', answeredAt: Date.now() });
  assert.equal(close.body.grade, 'close');
  assert.equal(close.body.code, 'wrong_form');
  const right = await c.post('/api/practice/attempts', { opId: randomUUID(), mode: 'cloze', entryId: knigaId, sentenceId, response: 'книги', answeredAt: Date.now() });
  assert.equal(right.body.grade, 'correct');
  const choice = await c.post('/api/practice/attempts', { opId: randomUUID(), mode: 'cloze', entryId: knigaId, sentenceId, response: 'книгу', choice: true, answeredAt: Date.now() });
  assert.equal(choice.body.grade, 'incorrect');
  const revealed = await c.post('/api/practice/attempts', { opId: randomUUID(), mode: 'cloze', entryId: knigaId, sentenceId, revealed: true, answeredAt: Date.now() });
  assert.equal(revealed.body.grade, 'revealed');
  const row = db.get<{ cell: string }>("SELECT cell FROM practice_attempts WHERE mode = 'cloze' AND response = 'книги'");
  assert.equal(row!.cell, 'nom|pl', 'the attempt notes a cell the target fills');
  const bad = await c.post('/api/practice/attempts', { opId: randomUUID(), mode: 'cloze', entryId: knigaId, sentenceId: 999999, response: 'x', answeredAt: Date.now() });
  assert.equal(bad.status, 422);
});

test('the summary counts words with tables and sentences, overall and among words being learned', async () => {
  const s = (await c.get('/api/practice/summary/ru')).body;
  assert.equal(s.forms.words, 1, 'кофе is indeclinable');
  assert.equal(s.forms.learningWords, 0);
  assert.equal(s.cloze.words, 1);
  assert.equal(s.cloze.sentences, 3);
  assert.ok(s.forms.attempts7d >= 2);
  const vi = (await c.get('/api/practice/summary/vi')).body;
  assert.equal(vi.forms, null, 'Vietnamese has no inflection tables');
});

test('Spanish verbs: compound tenses, negative imperatives without "no", and voseo cells', async () => {
  const doc = {
    format: 'vocabbuilder-v1',
    language: 'es',
    source: { name: 'Test set (es)', kind: 'frequency_mixed' },
    entries: [
      {
        lemma: 'hablar',
        pos: 'verb',
        senses: [{ gloss: 'to speak' }],
        paradigm: {
          kind: 'verb',
          source: 'UniMorph (Wiktionary)',
          cells: {
            'nfin|inf': ['hablar'], 'nfin|ger': ['hablando'], 'part|m.sg': ['hablado'],
            'ind.pres|1s': ['hablo'], 'ind.pres|2s': ['hablas'], 'ind.pres|2s.vos': ['hablás'], 'ind.pres|3s': ['habla'],
            'imp.neg|2s': ['no hables'], 'c.ind.perf|1s': ['he hablado'],
          },
        },
      },
    ],
  };
  await importDoc('es', doc);
  const id = db.get<{ id: number }>("SELECT id FROM vocabulary_entries WHERE language_code = 'es' AND lemma = 'hablar'")!.id;
  const b = await c.post('/api/practice/forms/batch', { language: 'es', scope: 'entry', entryId: id, size: 50 });
  const cells = b.body.items.map((i: any) => i.cell).sort();
  assert.deepEqual(cells, ['c.ind.perf|1s', 'imp.neg|2s', 'ind.pres|1s', 'ind.pres|2s', 'ind.pres|3s', 'nfin|ger', 'part|m.sg'], 'vos is off by default; the infinitive is the prompt');
  const vos = await c.post('/api/practice/forms/batch', { language: 'es', scope: 'entry', entryId: id, size: 50, persons: ['2s.vos'], tenses: ['ind.pres'] });
  assert.deepEqual(vos.body.items.map((i: any) => i.cell), ['ind.pres|2s.vos']);
  const pres = b.body.items.find((i: any) => i.cell === 'ind.pres|3s');
  assert.deepEqual(pres.tense, { label: 'Present', native: 'presente' });
  assert.equal(pres.person, 'él, ella, usted');
  const neg = await c.post('/api/practice/attempts', { opId: randomUUID(), mode: 'forms', entryId: id, cell: 'imp.neg|2s', response: 'hables', answeredAt: Date.now() });
  assert.equal(neg.body.grade, 'correct');
  const perf = await c.post('/api/practice/attempts', { opId: randomUUID(), mode: 'forms', entryId: id, cell: 'c.ind.perf|1s', response: 'he hablado', answeredAt: Date.now() });
  assert.equal(perf.body.grade, 'correct');
  const accent = await c.post('/api/practice/attempts', { opId: randomUUID(), mode: 'forms', entryId: id, cell: 'ind.pres|2s.vos', response: 'hablas', answeredAt: Date.now() });
  assert.notEqual(accent.body.grade, 'correct', 'hablas is the tú form, not vos');
});

test('loading a set again merges a table into a word that lacks one, and undo takes it away again', async () => {
  const plainDoc = { ...ruDoc, entries: [{ lemma: 'дом', pos: 'noun', senses: [{ gloss: 'house' }], forms: [{ form: 'дома', tags: [] }] }] };
  await importDoc('ru', plainDoc);
  const domId = db.get<{ id: number }>("SELECT id FROM vocabulary_entries WHERE language_code = 'ru' AND lemma = 'дом'")!.id;
  assert.equal((await c.get(`/api/vocab/${domId}`)).body.paradigm, null);
  const withTable = {
    ...ruDoc,
    source: { name: 'Second set (ru)', kind: 'frequency_mixed' },
    entries: [{ lemma: 'дом', pos: 'noun', senses: [{ gloss: 'house' }], paradigm: { kind: 'noun', source: 'OpenRussian', cells: { 'nom|sg': ['дом'], 'gen|sg': ['до́ма'], 'nom|pl': ['дома́'] } } }],
  };
  const r = await importDoc('ru', withTable, { duplicatePolicy: 'merge' });
  assert.equal(r.stats.merged, 1);
  const d = (await c.get(`/api/vocab/${domId}`)).body;
  assert.ok(d.paradigm, 'the merge added the table');
  // до́ма (genitive) and дома́ (plural) are different forms: the untagged дома takes the first, the other is added.
  const doma = d.forms.filter((f: any) => f.form === 'дома').map((f: any) => [f.display, f.tags]);
  assert.deepEqual(doma, [['до́ма', ['genitive singular']], ['дома́', ['nominative plural']]]);
  const undo = await c.post(`/api/import/${r.id}/undo`, {});
  assert.equal(undo.status, 200, JSON.stringify(undo.body));
  assert.equal((await c.get(`/api/vocab/${domId}`)).body.paradigm, null, 'undo removed the merged table');
  void ruJob;
});

test('an export carries tables and sentence sources, and imports again', async () => {
  const exp = await c.get('/api/export/vocabulary?lang=ru&format=json');
  assert.equal(exp.status, 200);
  const doc = typeof exp.body === 'string' ? JSON.parse(exp.body) : exp.body;
  const k = doc.entries.find((e: any) => e.lemma === 'книга');
  assert.equal(k.paradigm.cells['gen|pl'][0], 'книг');
  assert.equal(doc.sentenceSources[k.examples[0].source].name, 'Tatoeba');
  assert.equal(k.examples[0].ref, 'tatoeba:123');
});

test('AI-written sentences are marked as such on the word page, in practice, in sessions and in exports', async () => {
  const doc = {
    format: 'vocabbuilder-v1',
    language: 'uk',
    source: { name: 'Test set (uk)', kind: 'frequency_mixed', license: 'CC-BY-SA-4.0' },
    sentenceSources: {
      tatoeba: { name: 'Tatoeba', license: 'CC-BY-2.0-FR', url: 'https://tatoeba.org' },
      'ai-claude': { name: 'AI-written (Claude)', license: 'AI-generated, not checked by a native speaker', url: null, ai: true },
    },
    entries: [
      { lemma: 'хліб', pos: 'noun', senses: [{ gloss: 'bread' }], frequencyRank: 1, examples: [{ text: 'Я купив хліб.', translation: 'I bought bread.', target: 'хліб', source: 'tatoeba', ref: 'tatoeba:9' }] },
      {
        lemma: 'тис',
        pos: 'noun',
        senses: [{ gloss: 'yew' }],
        frequencyRank: 2,
        examples: [
          { text: 'У парку росте старий тис.', translation: 'An old yew grows in the park.', target: 'тис', source: 'ai-claude' },
          { text: 'Меблі з тису дуже міцні.', translation: 'Yew furniture is very strong.', target: 'тису', source: 'ai-claude' },
        ],
      },
    ],
  };
  await importDoc('uk', doc);
  const list = (await c.get('/api/vocab?lang=uk&q=%D1%82%D0%B8%D1%81')).body.items;
  const tys = list.find((e: any) => e.lemma === 'тис');
  const hlib = (await c.get(`/api/vocab?lang=uk&q=${encodeURIComponent('хліб')}`)).body.items.find((e: any) => e.lemma === 'хліб');

  // Word page
  const detail = (await c.get(`/api/vocab/${tys.entryId}`)).body;
  assert.deepEqual(detail.examples.map((x: any) => x.source?.ai), [true, true]);
  assert.equal(detail.examples[0].source.name, 'AI-written (Claude)');
  assert.equal((await c.get(`/api/vocab/${hlib.entryId}`)).body.examples[0].source.ai, undefined);

  // Sentence practice
  const batch = await c.post('/api/practice/cloze/batch', { language: 'uk', scope: 'entry', entryId: tys.entryId, size: 10 });
  assert.equal(batch.status, 200, JSON.stringify(batch.body));
  assert.ok(batch.body.items.length >= 1);
  assert.ok(batch.body.items.every((i: any) => i.source?.ai === true));

  // Sessions: the study entries carry the mark to every exercise built from the sentence
  const { ensureItem, loadStudyEntries } = await import('../../server/vocab/repo.ts');
  const itemId = ensureItem(db, tys.entryId, 'uk', Date.now());
  const entry = loadStudyEntries(db, [itemId], false, Date.now()).get(itemId)!;
  assert.deepEqual(entry.examples.map((x: any) => x.ai), [true, true]);
  const { splitSentence } = await import('../../server/learning/payloads.ts');
  assert.equal(splitSentence(entry.examples[0]).ai, true);

  // Export, and import again into a fresh language: the mark survives
  const exp = await c.get('/api/export/vocabulary?lang=uk&format=json');
  const out = typeof exp.body === 'string' ? JSON.parse(exp.body) : exp.body;
  const t = out.entries.find((e: any) => e.lemma === 'тис');
  assert.equal(out.sentenceSources[t.examples[0].source].ai, true);
  assert.equal(out.sentenceSources[out.entries.find((e: any) => e.lemma === 'хліб').examples[0].source].ai, undefined);
});

test('a Comprehensive session plans its exercises in two thirds of the time and carries each word’s table', async () => {
  const id = randomUUID();
  const r = await c.post('/api/sessions', { id, language: 'ru', minutes: 30, newWords: 2, mode: 'comprehensive', replaceActive: true });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.config.mode, 'comprehensive');
  assert.equal(r.body.meta.budgetSeconds, 1800, 'the whole session time, practice rounds included');
  const kn = Object.values(r.body.items).find((x: any) => x.lemma === 'книга') as any;
  assert.ok(kn, 'книга is planned');
  assert.deepEqual(kn.paradigm.cells['gen|pl'], ['книг']);
  const planned = r.body.exercises.reduce((t: number, e: any) => t + 1, 0);
  assert.ok(planned > 0);
  const ended = await c.post(`/api/sessions/${id}/complete`, {});
  assert.equal(ended.status, 200, JSON.stringify(ended.body));
});
