// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Writing practice (1.9.0): accepted translations as patterns, word-by-word grading (what is forgiven and what is
// not), the nearest translation with the words marked, the checks of the sentence build, and how well a sentence fits a
// study session's words.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { alignWords, expandAnswers, expandPattern, gradeWriting, parsePattern, PatternError, wordKey, writingKey } from '../../shared/writing.ts';
// @ts-expect-error plain JavaScript build script
import { build, checkSentence, crossCheck } from '../../scripts/writing/build.mjs';
import { sentencesWith, wordIndex, wordScores, type WritingData } from '../../server/learning/writing.ts';

test('patterns: alternatives, optional parts, nesting, tidy spaces and capitals, no repeats', () => {
  assert.deepEqual(expandPattern('{|Yo }soy {profesor|profesora}.'), ['Soy profesor.', 'Soy profesora.', 'Yo soy profesor.', 'Yo soy profesora.']);
  assert.deepEqual(expandPattern('¿{A dónde|Adónde} {vas|va} {|a ir }mañana?'), ['¿A dónde vas mañana?', '¿A dónde vas a ir mañana?', '¿A dónde va mañana?', '¿A dónde va a ir mañana?', '¿Adónde vas mañana?', '¿Adónde vas a ir mañana?', '¿Adónde va mañana?', '¿Adónde va a ir mañana?']);
  assert.deepEqual(expandPattern('{Ayer {fui|me fui}|Me fui ayer} al mercado {|hoy} .'), ['Ayer fui al mercado.', 'Ayer fui al mercado hoy.', 'Ayer me fui al mercado.', 'Ayer me fui al mercado hoy.', 'Me fui ayer al mercado.', 'Me fui ayer al mercado hoy.']);
  assert.deepEqual(expandAnswers(['{|Eu }estou bem.', 'Estou bem.']), ['Estou bem.', 'Eu estou bem.'], 'a second pattern adds only what is new');
  for (const bad of ['a {b|c', 'a {b} c', 'a b|c', 'a } b']) assert.throws(() => parsePattern(bad), PatternError, bad);
  assert.throws(() => expandPattern('{a|b}{a|b}{a|b}{a|b}', 10), /more than 10/);
});

test('word keys forgive capitals, punctuation, stress marks, ё, apostrophes, Vietnamese tone placement and Ukrainian у/в, і/й, -ся/-сь', () => {
  assert.equal(writingKey('¡Hola, Ana!', 'es'), writingKey('hola ana', 'es'));
  assert.equal(writingKey('Ёлка ВОДА́.', 'ru'), 'елка вода');
  assert.equal(writingKey('П’ять котів.', 'uk'), writingKey("п'ять котів", 'uk'));
  assert.equal(writingKey('Я живу у Києві й працюю зі сестрою', 'uk'), writingKey('я живу в Києві і працюю з сестрою', 'uk'));
  assert.equal(writingKey('Вона втомилась, ми дивимось кіно', 'uk'), writingKey('вона втомилася, ми дивимося кіно', 'uk'), 'Ukrainian -сь after a vowel');
  assert.notEqual(writingKey('Він втомивсь', 'uk'), writingKey('він втомився', 'uk'), 'not after a consonant');
  assert.notEqual(writingKey('Она училась', 'ru'), writingKey('она училася', 'ru'), 'not in Russian');
  assert.equal(writingKey('Tôi học hoá học ở công ty', 'vi'), writingKey('tôi học hóa học ở công ti', 'vi'));
  assert.notEqual(writingKey('Esta casa', 'es'), writingKey('Está casa', 'es'), 'a missing accent is a different word');
  assert.notEqual(writingKey('już', 'pl'), writingKey('juz', 'pl'));
  assert.notEqual(writingKey('Tôi học', 'vi'), writingKey('Toi hoc', 'vi'), 'tones count');
  assert.notEqual(writingKey('guarda-chuva', 'pt'), writingKey('guarda chuva', 'pt'), 'a hyphenated word is one word');
});

test('grading: every word right in an accepted order, or wrong with the nearest translation and the words marked', () => {
  const s = { answers: ['{|Yo }soy {profesor|profesora}.'] };
  assert.equal(gradeWriting('soy profesora', s, 'es').correct, true);
  assert.equal(gradeWriting('YO SOY PROFESOR!!', s, 'es').correct, true);
  const extra = gradeWriting('Yo soy un profesor.', s, 'es');
  assert.equal(extra.correct, false);
  assert.equal(extra.closest, 'Yo soy profesor.');
  assert.deepEqual(extra.answerWords.map((w) => [w.w, w.ok]), [['Yo', true], ['soy', true], ['un', false], ['profesor', true]]);
  assert.deepEqual(extra.closestWords.every((w) => w.ok), true);
  const missing = gradeWriting('Soy', s, 'es');
  assert.equal(missing.correct, false);
  assert.deepEqual(missing.closestWords.map((w) => [w.w, w.ok]), [['Soy', true], ['profesor', false]]);
  assert.equal(gradeWriting('profesor soy', s, 'es').correct, false, 'an order the sentence does not accept');
  assert.equal(gradeWriting('', s, 'es').correct, false);
  assert.equal(gradeWriting('Soy maestro.', s, 'es', ['Soy maestro']).correct, true, 'a wording the learner said was right');
  assert.equal(gradeWriting('Soy maestro.', s, 'es').expected, 'Soy profesor.', 'the main translation is the first one');
  assert.equal(alignWords('a b c', 'a c', 'es').common, 2);
});

const good = { id: 'es-A1-1-001', lang: 'es', level: 'A1', step: 1, topic: 'feelings', en: 'I am tired.', answers: ['{|Yo }estoy {cansado|cansada}.'] };

test('the build checks each sentence and the batch together', () => {
  assert.deepEqual(checkSentence(good, { lang: 'es', level: 'A1', batch: 1 }), []);
  const problems = (over: Record<string, unknown>, target = { lang: 'es', level: 'A1', batch: 1 }) => checkSentence({ ...good, ...over }, target).join(' | ');
  assert.match(problems({ id: 'es-A1-1-1' }), /id must be es-A1-1-001/);
  assert.match(problems({ step: 150 }), /outside batch 1/);
  assert.match(problems({ en: 'I am 5.' }), /digits/);
  assert.match(problems({ en: 'I am (very) tired.' }), /brackets/);
  assert.match(problems({ answers: ['{Estoy|Estoy} cansado'] }), /must end with/);
  assert.match(problems({ answers: ['Estoy cansado (yo).'] }), /brackets/);
  assert.match(problems({ answers: ['Estoy cansaço.'] }), /letters es does not use: cansaço/);
  assert.match(problems({ lang: 'uk', id: 'uk-A1-1-001', answers: ['Я втомлений, ыы.'] }, { lang: 'uk', level: 'A1', batch: 1 }), /letters uk does not use/);
  assert.match(problems({ answers: [`${'{a|b}'.repeat(7)} x.`] }), /translations; at most 120/);
  assert.match(problems({ extra: 1 }), /unknown field extra/);
  assert.match(problems({ context: 'To a friend.' }), /context starts lower-case/);
  const twin = { ...good, id: 'es-A1-1-002', step: 2 };
  assert.deepEqual(crossCheck([good, twin]).map((p: string) => p.replace(/:.*/, '')), ['es-A1-1-002', 'es-A1-1-002']);
});

test('the build writes each language in level and step order, the same bytes from the same batches', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'vb-writing-'));
  const src = path.join(dir, 'src');
  mkdirSync(src);
  const line = (step: number, en: string, answer: string) => JSON.stringify({ id: `es-A1-1-${String(step).padStart(3, '0')}`, lang: 'es', level: 'A1', step, topic: 'home', en, answers: [answer] });
  writeFileSync(path.join(src, 'es-A1-1.jsonl'), [line(2, 'The house is big.', 'La casa es grande.'), line(1, 'I am tired.', '{|Yo }estoy cansado.')].join('\n') + '\n');
  const log: string[] = [];
  assert.deepEqual(build({ srcDir: src, outDir: dir, log: (s: string) => log.push(s) }), []);
  const doc = JSON.parse(readFileSync(path.join(dir, 'es.json'), 'utf8'));
  assert.equal(doc.format, 'vocabbuilder-writing-v1');
  assert.deepEqual(doc.sentences.map((s: any) => s.step), [1, 2]);
  const bytes = readFileSync(path.join(dir, 'es.json'), 'utf8');
  build({ srcDir: src, outDir: dir, log: () => {} });
  assert.equal(readFileSync(path.join(dir, 'es.json'), 'utf8'), bytes);
  writeFileSync(path.join(src, 'es-A1-1.jsonl'), line(1, 'I am tired.', 'Estoy {cansado.') + '\n');
  const problems = build({ srcDir: src, outDir: dir, log: () => {} });
  assert.ok(problems.some((p: string) => /not closed/.test(p)));
  assert.equal(readFileSync(path.join(dir, 'es.json'), 'utf8'), bytes, 'nothing is written when a sentence has a problem');
});

test('a session’s words in the sentences: forms of one word or of several in a row, the rarer words counting for more', () => {
  const sentence = (step: number, answers: string[]) => ({ id: `vi-A1-1-00${step}`, level: 'A1' as const, step, topic: 'study', en: 'A sentence.', answers });
  const data: WritingData = {
    format: 'vocabbuilder-writing-v1',
    language: 'vi',
    version: 't',
    copyright: '',
    credit: '',
    sentences: [sentence(1, ['Tôi là sinh viên.']), sentence(2, ['{Sinh viên|Cậu sinh viên} mệt.']), sentence(3, ['Tôi thích trà.']), sentence(4, ['Cuộc sống ở đây vui.'])],
  };
  const index = wordIndex(data);
  const k = (...words: string[]) => words.map((w) => wordKey(w, 'vi'));
  // Only the usual translation counts ("Cậu sinh viên" is accepted, not usual); a word of several syllables in a row.
  assert.deepEqual(index.keys[1], k('Sinh', 'viên', 'mệt'));
  assert.deepEqual([...sentencesWith(index, [k('sinh', 'viên')])].sort(), [0, 1]);
  assert.deepEqual([...sentencesWith(index, [k('viên', 'sinh')])], [], 'in that order only');
  // tôi is in two of the four sentences, trà in one: trà counts for more. A word in every sentence counts for nothing.
  const scores = wordScores(index, [
    { id: 10, forms: [k('tôi')] },
    { id: 20, forms: [k('trà')] },
    { id: 30, forms: [k('tôi'), k('sinh', 'viên'), k('cuộc', 'sống')] },
  ]);
  assert.deepEqual(scores.get(2)!.uses, [10, 20]);
  assert.deepEqual(scores.get(0)!.uses, [10]);
  assert.ok(Math.abs(scores.get(0)!.score - Math.log(5 / 3)) < 1e-9);
  assert.ok(Math.abs(scores.get(2)!.score - (Math.log(5 / 3) + Math.log(5 / 2))) < 1e-9);
  assert.equal(scores.has(1), false, 'sinh viên comes only with the word that is everywhere');
  assert.equal(scores.has(3), false);
});
