// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// The build of data/grammar/<lang>.json (scripts/grammar/build.mjs): every annotation is checked against the frequency
// set (the lemma's table, the cell, the target, the reason), bad ones are reported with their line and dropped, the
// later of two lines for one sentence wins, sentences that are not the word's examples are counted, and the same
// records always give the same bytes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exactKey } from '../../shared/grammar.ts';
// @ts-expect-error plain JavaScript build script
import { build, checkRecord, FORMAT, frequencyIndex, importAnnotations, languageFile, readRecords } from '../../scripts/grammar/build.mjs';

const UKRAINIAN = {
  kind: 'adjective',
  cells: {
    'nom|m': ['украї́нський'], 'nom|n': ['украї́нське'], 'nom|f': ['украї́нська'], 'nom|pl': ['украї́нські'], 'gen|m': ['украї́нського'], 'gen|n': ['украї́нського'],
    'gen|f': ['украї́нської'], 'gen|pl': ['украї́нських'], 'acc|n': ['украї́нське'], 'acc|f': ['украї́нську'], 'acc.inan|m': ['украї́нський'], 'acc.anim|m': ['украї́нського'],
  },
};
/** A frequency set in the shipped format, cut down to what the checks read. */
const UK_SET = {
  format: 'vocabbuilder-v1',
  language: 'uk',
  entries: [
    { lemma: 'український', pos: 'adjective', paradigm: UKRAINIAN, examples: [{ text: 'У нього українське громадянство.', target: 'українське' }] },
    // Filed as a conjunction without a table; explanations have a built-in one.
    { lemma: 'що', pos: 'conjunction', paradigm: null, examples: [{ text: 'Для чого ти будеш це використовувати?', target: 'чого' }] },
    { lemma: 'кіно', pos: 'noun', paradigm: { kind: 'noun', indeclinable: true, cells: {} }, examples: [] },
    { lemma: 'і', pos: 'conjunction', paradigm: null, examples: [] },
  ],
};
const PT_SET = {
  format: 'vocabbuilder-v1',
  language: 'pt',
  entries: [
    {
      lemma: 'obrigar',
      pos: 'verb',
      paradigm: { kind: 'verb', cells: { 'nfin|inf': ['obrigar'], 'sbjv.pres|3s': ['obrigue'], 'imp.aff|3s': ['obrigue'], 'imp.neg|2s': ['não obrigues'], 'imp.neg|3s': ['não obrigue'] } },
      examples: [{ text: 'Não me obrigue a fazer isso.', target: 'obrigue' }],
    },
  ],
};

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const WHY = 'it describes “громадянство” (citizenship), the thing he has in “у нього …” (he has); what someone has is the subject there, so it is nominative.';
const rec = (over: Record<string, unknown> = {}) => ({ lemma: 'український', target: 'українське', sentence: 'У нього українське громадянство.', cell: 'nom|n', why: WHY, ...over });
const jsonl = (...lines: unknown[]) => lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n';

test('a record is kept when the lemma’s table (or a built-in one) has the cell, the cell holds the target and why is not empty', () => {
  const uk = frequencyIndex('uk', UK_SET);
  const pt = frequencyIndex('pt', PT_SET);
  assert.equal(checkRecord(rec(), uk), null);
  assert.equal(checkRecord(rec({ lemma: 'украї́нський', target: 'Українське', sentence: 'у нього УКРАЇНСЬКЕ громадянство' }), uk), null, 'stress marks, capitals and punctuation do not matter');
  assert.equal(checkRecord(rec({ lemma: 'що', target: 'чого', sentence: 'Для чого ти будеш це використовувати?', cell: 'gen|-' }), uk), null, 'the built-in table of що');
  assert.equal(checkRecord({ lemma: 'obrigar', target: 'obrigue', sentence: 'Não me obrigue a fazer isso.', cell: 'imp.neg|3s', why: 'a negative command.' }, pt), null, 'a negative imperative holds não + the target');

  assert.equal(checkRecord(rec({ cell: 'gen|n' }), uk), 'cell gen|n of “український” holds “українського”, not “українське”');
  assert.equal(checkRecord(rec({ cell: 'nom|zz' }), uk), 'the table of “український” has no cell nom|zz');
  assert.equal(checkRecord(rec({ cell: 'constructor' }), uk), 'the table of “український” has no cell constructor');
  assert.equal(checkRecord(rec({ lemma: 'неіснуючий' }), uk), '“неіснуючий” is not a word of data/frequency/uk.json');
  assert.equal(checkRecord(rec({ lemma: 'і', target: 'і' }), uk), '“і” has no table');
  assert.equal(checkRecord(rec({ lemma: 'кіно', target: 'кіно' }), uk), '“кіно” is indeclinable');
  assert.equal(checkRecord(rec({ why: '   ' }), uk), 'why is missing or empty');
  assert.equal(checkRecord(rec({ why: undefined }), uk), 'why is missing or empty');
  assert.equal(checkRecord(rec({ target: '' }), uk), 'target is missing');
  assert.equal(checkRecord(rec({ cell: 3 }), uk), 'cell is missing');
  assert.equal(checkRecord(['not', 'an', 'object'], uk), 'not a JSON object');
  assert.equal(checkRecord({ lemma: 'obrigar', target: 'obrigue', sentence: 'Não me obrigue a fazer isso.', cell: 'imp.neg|2s', why: 'x' }, pt), 'cell imp.neg|2s of “obrigar” holds “não obrigues”, not “obrigue”');
  assert.equal(checkRecord({ lemma: 'obrigar', target: 'obrigar', sentence: 'Tenho que obrigar.', cell: 'nfin|inf', why: 'x' }, pt), 'cell nfin|inf is not one the explanations name');
});

test('bad records are reported with their line and dropped; for one sentence the later line wins; unmatched sentences are counted', () => {
  const index = frequencyIndex('uk', UK_SET);
  const r = readRecords(
    'uk',
    jsonl(
      rec({ cell: 'acc|n', why: 'an earlier guess.' }),
      rec({ cell: 'gen|n' }),
      '{not json',
      '',
      rec(),
      rec({ lemma: 'що', target: 'чого', sentence: 'Для чого ти будеш це використовувати?', cell: 'gen|-', why: 'it follows “для” (for), which always takes the genitive.' }),
      rec({ sentence: 'Це українське місто.', why: 'not one of the word’s example sentences.' }),
      ['an', 'array'],
    ),
    index,
  );
  assert.equal(r.records, 7, 'blank lines are not records');
  assert.equal(r.cells.size, 3);
  assert.equal(r.problems.length, 3);
  assert.equal(r.problems[0], 'uk.jsonl line 2 (українське): cell gen|n of “український” holds “українського”, not “українське”');
  assert.match(r.problems[1], /^uk\.jsonl line 3: not valid JSON \(/);
  assert.equal(r.problems[2], 'uk.jsonl line 8: not a JSON object');
  assert.equal(r.replaced, 1);
  assert.deepEqual(r.warnings, ['uk.jsonl line 5 replaces line 1 for “українське” in “У нього українське громадянство.” (acc|n → nom|n)']);
  assert.deepEqual(r.cells.get(exactKey('uk', 'український', 'українське', 'У нього українське громадянство.')), ['nom|n', WHY]);
  assert.equal(r.unmatched, 1, 'Це українське місто. is not an example of український');
});

test('the file is the same bytes for the same records, keys sorted, one entry per line', () => {
  const index = frequencyIndex('uk', UK_SET);
  const lines = [rec(), rec({ lemma: 'що', target: 'чого', sentence: 'Для чого ти будеш це використовувати?', cell: 'gen|-', why: '  it follows “для” (for),   which always takes the genitive. ' })];
  const a = languageFile('uk', readRecords('uk', jsonl(...lines), index).cells);
  const b = languageFile('uk', readRecords('uk', jsonl(...[...lines].reverse()), index).cells);
  assert.equal(a, b, 'the order of the lines does not matter');
  const file = JSON.parse(a);
  assert.equal(file.format, FORMAT);
  assert.equal(file.language, 'uk');
  assert.equal(file.count, 2);
  assert.match(file.version, /^[0-9a-f]{12}$/);
  assert.deepEqual(Object.keys(file.cells), ['uk|український|українське|у нього українське громадянство', 'uk|що|чого|для чого ти будеш це використовувати']);
  assert.deepEqual(file.cells['uk|що|чого|для чого ти будеш це використовувати'], ['gen|-', 'it follows “для” (for), which always takes the genitive.'], 'whitespace in the reason is tidied');
  assert.equal(a.split('\n').length, 5, 'head, two entries, closing line, final newline');
  assert.notEqual(JSON.parse(languageFile('uk', new Map([[exactKey('uk', 'український', 'українське', 'У нього українське громадянство.'), ['acc|n', 'x']]]))).version, file.version);
  assert.deepEqual(JSON.parse(languageFile('pl', new Map())).cells, {}, 'no records: an empty file');
});

test('build writes each language that has annotations, the same bytes every time; import copies only <lang>.jsonl', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'vb-grammar-build-'));
  try {
    const [src, freq, out, inbox] = ['src', 'freq', 'out', 'inbox'].map((d) => path.join(dir, d));
    for (const d of [src, freq, inbox]) mkdirSync(d, { recursive: true });
    writeFileSync(path.join(freq, 'uk.json'), JSON.stringify(UK_SET));
    writeFileSync(path.join(freq, 'pt.json'), JSON.stringify(PT_SET));
    writeFileSync(path.join(inbox, 'uk.jsonl'), jsonl(rec(), rec({ cell: 'gen|n' })));
    writeFileSync(path.join(inbox, 'pt.jsonl'), jsonl({ lemma: 'obrigar', target: 'obrigue', sentence: 'Não me obrigue a fazer isso.', cell: 'imp.neg|3s', why: 'a negative command.' }));
    writeFileSync(path.join(inbox, 'ru.jsonl'), jsonl(rec({ lemma: 'книга' })));
    writeFileSync(path.join(inbox, 'uk-batch-2.jsonl'), 'ignored\n');
    writeFileSync(path.join(inbox, 'notes.txt'), 'ignored\n');
    assert.deepEqual(importAnnotations(inbox, src), ['uk.jsonl', 'ru.jsonl', 'pt.jsonl']);
    assert.equal(existsSync(path.join(src, 'uk-batch-2.jsonl')), false);

    const first = build({ srcDir: src, freqDir: freq, outDir: out });
    const by = Object.fromEntries(first.map((r: any) => [r.lang, r]));
    assert.deepEqual([by.uk.records, by.uk.kept, by.uk.dropped, by.uk.written], [2, 1, 1, true]);
    assert.deepEqual([by.pt.records, by.pt.kept, by.pt.dropped, by.pt.unmatched, by.pt.written], [1, 1, 0, 0, true]);
    assert.equal(by.ru.written, false, 'no frequency set to check against: nothing written');
    assert.match(by.ru.problems[0], /data\/frequency\/ru\.json is missing/);
    assert.deepEqual([by.pl.source, by.pl.written, by.es.source], [false, false, false]);
    assert.equal(existsSync(path.join(out, 'ru.json')), false);
    assert.equal(existsSync(path.join(out, 'pl.json')), false);
    const bytes = readFileSync(path.join(out, 'uk.json'));
    build({ srcDir: src, freqDir: freq, outDir: out });
    assert.deepEqual(readFileSync(path.join(out, 'uk.json')), bytes, 'a rebuild gives byte-identical files');
    assert.equal(JSON.parse(readFileSync(path.join(out, 'pt.json'), 'utf8')).cells['pt|obrigar|obrigue|não me obrigue a fazer isso'][0], 'imp.neg|3s');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the browser tests’ fixture is what the build makes of its record, checked against the real Polish set', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'vb-grammar-fixture-'));
  try {
    const [r] = build({ srcDir: path.join(FIXTURE, 'grammar', 'src'), outDir: dir, langs: ['pl'] });
    assert.deepEqual([r.kept, r.dropped, r.unmatched], [1, 0, 0], 'kobiecie in “Powiem tej kobiecie to, co wiem.” is an example of kobieta, and its dative singular');
    assert.equal(readFileSync(path.join(dir, 'pl.json'), 'utf8'), readFileSync(path.join(FIXTURE, 'grammar', 'pl.json'), 'utf8'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a "no note" record ("-") is kept for a word of the set, whatever its table, so that sentence gets no grammar line', () => {
  const index = frequencyIndex('uk', UK_SET);
  assert.equal(checkRecord({ lemma: 'український', target: 'українське', sentence: 'У нього українське громадянство.', cell: '-', why: 'another word that looks the same' }, index), null);
  assert.equal(checkRecord({ lemma: 'кіно', target: 'кіно', sentence: 'Кіно.', cell: '-', why: 'indeclinable, but no note anyway' }, index), null);
  assert.match(checkRecord({ lemma: 'український', target: 'українське', sentence: 'У нього українське громадянство.', cell: '-', why: '' }, index) ?? '', /why/);
  assert.match(checkRecord({ lemma: 'неіснуючий', target: 'x', sentence: 'x', cell: '-', why: 'note' }, index) ?? '', /not a word/);
});
