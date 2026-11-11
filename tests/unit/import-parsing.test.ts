// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Import parsing: CSV/TSV edge cases, format detection, column-mapping suggestions, Kaikki adapter.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { detectFormat, kaikkiToEntries, parseDelimited, parseTable, rowsToEntries, suggestMapping, DEFAULT_OPTIONS, vocabbuilderToEntries } from '../../server/vocab/importer.ts';
import { FIXTURE } from '../helpers/harness.ts';

test('CSV parsing: quotes, embedded delimiters/newlines, escaped quotes, BOM, CRLF, blank lines', () => {
  const csv = '﻿word,meaning,example\r\n"agua","water, liquid","Dijo ""hola""\nadiós"\r\n\r\npan,bread,\n';
  assert.deepEqual(parseDelimited(csv, ','), [
    ['word', 'meaning', 'example'],
    ['agua', 'water, liquid', 'Dijo "hola"\nadiós'],
    ['pan', 'bread', ''],
  ]);
  assert.deepEqual(parseDelimited('a\tb\n"c\td"\te', '\t'), [
    ['a', 'b'],
    ['c\td', 'e'],
  ]);
});

test('semicolon-separated CSV (common in European spreadsheet exports) is detected', () => {
  const t = parseTable('csv', 'słowo;znaczenie\nkot;cat\n');
  assert.deepEqual(t.columns, ['słowo', 'znaczenie']);
  assert.equal(t.rows[0]['znaczenie'], 'cat');
});

test('format detection', () => {
  assert.equal(detectFormat('words.csv', 'word,meaning\nagua,water'), 'csv');
  assert.equal(detectFormat('words.tsv', 'word\tmeaning\nagua\twater'), 'tsv');
  assert.equal(detectFormat('words.txt', 'word\tmeaning\nagua\twater'), 'tsv');
  assert.equal(detectFormat('words.json', '[{"word":"agua"}]'), 'json');
  assert.equal(detectFormat('x.json', readFileSync(path.join(FIXTURE, 'ru-mini.json'), 'utf8')), 'vocabbuilder');
  assert.equal(detectFormat('dump.jsonl', '{"word":"agua","pos":"noun","senses":[]}\n{"word":"pan","pos":"noun","senses":[]}'), 'kaikki');
  assert.equal(detectFormat('rows.jsonl', '{"lemma":"agua"}\n{"lemma":"pan"}'), 'jsonl');
  assert.equal(detectFormat('ru_50k.txt', 'и 1000\nв 900\nне 800'), 'frequency');
  assert.equal(detectFormat('ranked.txt', '1 и\n2 в\n3 не'), 'frequency');
});

test('column mapping suggestions recognise common header names', () => {
  const m = suggestMapping(['Word', 'English', 'Part of speech', 'Rank', 'Example', 'Example translation', 'Tags', 'IPA', 'Notes'], 'vocabulary');
  assert.deepEqual(m, { lemma: 'Word', gloss: 'English', pos: 'Part of speech', rank: 'Rank', example: 'Example', exampleTranslation: 'Example translation', tags: 'Tags', pronunciation: 'IPA', notes: 'Notes' });
  // Unknown headers fall back to the first two columns.
  assert.deepEqual(suggestMapping(['col A', 'col B'], 'vocabulary'), { lemma: 'col A', gloss: 'col B' });
  assert.deepEqual(suggestMapping(['word', 'count'], 'frequency'), { lemma: 'word', count: 'count' });
});

test('rows are normalised with lists, forms syntax and validation errors', () => {
  const table = parseTable('csv', 'word,meaning,also,forms,tags,rank\nвода,water; aqua,H2O,"воду:accusative,singular; воды:genitive,singular","food-drink, basic",12\n,missing,,,,x\n');
  const rows = rowsToEntries(table, { lemma: 'word', gloss: 'meaning', translations: 'also', forms: 'forms', tags: 'tags', rank: 'rank' }, DEFAULT_OPTIONS);
  assert.equal(rows[0].errors.length, 0);
  assert.deepEqual(rows[0].entry.senses, [{ gloss: 'water', translations: ['aqua', 'H2O'], definition: null }]);
  assert.deepEqual(rows[0].entry.forms, [
    { form: 'воду', tags: ['accusative', 'singular'] },
    { form: 'воды', tags: ['genitive', 'singular'] },
  ]);
  assert.deepEqual(rows[0].entry.tags, ['food-drink', 'basic']);
  assert.equal(rows[0].entry.frequencyRank, 12);
  assert.deepEqual(rows[1].errors.sort(), ['Missing word', 'Rank "x" is not a whole number'].sort());
});

test('a word consisting only of stress marks or spaces is a validation error, not a commit-time failure', () => {
  const table = parseTable('csv', 'word,meaning\ń,stress mark only\n');
  const rows = rowsToEntries(table, { lemma: 'word', gloss: 'meaning' }, DEFAULT_OPTIONS);
  assert.ok(rows[0].errors.includes('Missing word'), JSON.stringify(rows[0].errors));
});

test('Kaikki/Wiktextract lines: lemma entries kept, form-of entries and other languages skipped', () => {
  const text = readFileSync(path.join(FIXTURE, 'kaikki-sample.jsonl'), 'utf8');
  const es = kaikkiToEntries(text, 'es');
  assert.deepEqual(es.map((r) => r.entry.lemma), ['agua', 'tinto']);
  const agua = es[0].entry;
  assert.equal(agua.pos, 'noun');
  assert.equal(agua.pronunciation, '/ˈaɡwa/');
  assert.equal(agua.senses[0].gloss, 'water');
  assert.deepEqual(agua.examples![0], { text: 'Quiero un vaso de agua.', translation: 'I want a glass of water.', target: null });
  assert.ok(agua.forms!.some((f) => f.form === 'aguas' && f.tags!.includes('plural')));
  assert.equal(es[1].entry.regionalNote, 'Colombia');
  const ru = kaikkiToEntries(text, 'ru');
  assert.equal(ru.length, 1);
  assert.equal(ru[0].entry.lemma, 'вода');
  assert.equal(ru[0].entry.display, 'вода́', 'the canonical stressed form becomes the display form');
  assert.ok(!ru[0].entry.forms!.some((f) => f.form === 'вода́'), 'canonical form is not duplicated as an inflection');
  assert.ok(!ru[0].entry.forms!.some((f) => f.tags!.includes('table-tags')));
  assert.equal(ru[0].entry.examples![0].translation, 'I am drinking water.', 'older "english" field is still read');
});

test('vocabbuilder-v1 documents keep display forms, examples, expressions and teaching order', () => {
  const doc = vocabbuilderToEntries(readFileSync(path.join(FIXTURE, 'ru-mini.json'), 'utf8'));
  assert.equal(doc.language, 'ru');
  assert.equal(doc.rows.length, 12);
  const voda = doc.rows[0].entry;
  assert.equal(voda.display, 'вода́');
  assert.equal(voda.curatedOrder, 1);
  assert.equal(voda.examples![0].text, 'Я пью во́ду.', 'stress-marked example text is passed through (stripped when stored)');
});

test('frequency lists are detected even when short, with blank lines or a trailing newline', () => {
  assert.equal(detectFormat('ru_freq.txt', 'воду 500\nвода 300\n\nхлеб 200\n'), 'frequency');
  assert.equal(detectFormat('pl.txt', '1 nie\r\n2 się\r\n'), 'frequency');
});

test('very large delimited files parse (no argument-spreading limits)', () => {
  const lines = ['word,english'];
  for (let i = 0; i < 160_000; i++) lines.push(`слово${i},word ${i}`);
  const t = parseTable('csv', lines.join('\n'));
  assert.equal(t.rows.length, 160_000);
  assert.deepEqual(t.columns, ['word', 'english']);
});
