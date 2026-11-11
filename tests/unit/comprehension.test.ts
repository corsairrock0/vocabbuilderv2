// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Reading comprehension rules: the pass mark, the level after a passage (up only when every text of the level has
// been read), the two kinds of passage and the order they are served in, where the next passage comes from, and the
// checks the passage build (scripts/reading/build.mjs) makes before it writes anything.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isPass,
  kindOfId,
  levelAbove,
  levelAfter,
  levelDone,
  levelProgress,
  levelSearchOrder,
  passMark,
  predictedLevel,
  questionsInLanguage,
  READING_LEVELS,
  readingLevel,
  type ComprehensionKind,
  type ComprehensionPassage,
  type ReadingLevel,
} from '../../shared/comprehension.ts';
import { byId, gradeAnswers, passageOrder, pickPassage } from '../../server/learning/comprehension.ts';
// @ts-expect-error plain JavaScript build script
import { checkPassage, fileTarget, languageFile, readBatches, storedPassage } from '../../scripts/reading/build.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('a passage is passed with all its questions but one right: 3 of 4, or 2 of 3 for a short one', () => {
  assert.equal(passMark(4), 3);
  assert.equal(passMark(3), 2);
  assert.equal(isPass(4, 4), true);
  assert.equal(isPass(3, 4), true);
  assert.equal(isPass(2, 4), false);
  assert.equal(isPass(3, 3), true);
  assert.equal(isPass(2, 3), true);
  assert.equal(isPass(1, 3), false);
  assert.equal(isPass(0, 0), false, 'no questions is no pass');
});

test('a short passage is known by the S in its batch', () => {
  assert.equal(kindOfId('es-A2-S1-07'), 'short');
  assert.equal(kindOfId('es-A2-S12-07'), 'short');
  assert.equal(kindOfId('es-A2-1-07'), 'long');
  assert.equal(kindOfId('es-A2-10-07'), 'long');
});

// Texts for the level rule: A1 has two long and two short, A2 one long, B1 none, B2 one short, C1 two long.
const LEVEL_DATA = ['es-A1-1-01', 'es-A1-1-02', 'es-A1-S1-01', 'es-A1-S1-02', 'es-A2-1-01', 'es-B2-S1-01', 'es-C1-1-01', 'es-C1-1-02'].map((id) => ({ id, level: id.split('-')[1] as ReadingLevel }));
const readOf = (...ids: string[]) => new Set(ids);
const A1 = ['es-A1-1-01', 'es-A1-1-02', 'es-A1-S1-01', 'es-A1-S1-02'];

test('the level moves up one step only when every text of it, long and short, has been read, pass or fail', () => {
  // Every A1 text read (this one included): up to A2.
  assert.equal(levelAfter('A1', LEVEL_DATA, readOf(...A1)), 'A2');
  // One left, of either kind: it stays.
  assert.equal(levelAfter('A1', LEVEL_DATA, readOf('es-A1-1-01', 'es-A1-1-02', 'es-A1-S1-01')), 'A1', 'a short text left');
  assert.equal(levelAfter('A1', LEVEL_DATA, readOf('es-A1-1-01', 'es-A1-S1-01', 'es-A1-S1-02')), 'A1', 'a long text left');
  assert.equal(levelAfter('A1', LEVEL_DATA, readOf()), 'A1');
  // One step: the next level is not done just because the current one is.
  assert.equal(levelAfter('A2', LEVEL_DATA, readOf('es-A2-1-01')), 'B1');
  assert.deepEqual(levelProgress('A1', LEVEL_DATA, readOf('es-A1-1-01', 'es-A2-1-01')), { level: 'A1', total: 4, read: 1 });
});

test('texts at other levels never count toward the current one', () => {
  // Every A2, B2 and C1 text read, but an A1 text left: the learner stays at A1.
  const others = LEVEL_DATA.filter((p) => p.level !== 'A1').map((p) => p.id);
  assert.equal(levelAfter('A1', LEVEL_DATA, readOf(...others, 'es-A1-1-01', 'es-A1-1-02', 'es-A1-S1-01')), 'A1');
  assert.equal(levelAfter('B2', LEVEL_DATA, readOf(...A1, 'es-A2-1-01', 'es-C1-1-01', 'es-C1-1-02')), 'B2', 'the B2 text is still unread');
  // Texts read earlier at a higher level (as fallbacks) count for that level once the learner reaches it: finishing A1
  // with A2 read already moves on through A2, and stops at B1, which has no texts.
  assert.equal(levelAfter('A1', LEVEL_DATA, readOf(...A1, 'es-A2-1-01')), 'B1');
});

test('a level with no texts is never done, C1 is the top, and the level never goes down', () => {
  // B1 has no texts: a B1 reader stays at B1 whatever else has been read (and a learner finishing A2 stops at B1).
  assert.equal(levelAfter('B1', LEVEL_DATA, readOf(...LEVEL_DATA.map((p) => p.id))), 'B1');
  assert.equal(levelDone(levelProgress('B1', LEVEL_DATA, readOf())), false);
  assert.equal(levelDone({ total: 0, read: 0 }), false);
  // A language without any texts at all.
  assert.equal(levelAfter('A1', [], readOf()), 'A1');
  // Every C1 text read: C1 stays.
  assert.equal(levelAfter('C1', LEVEL_DATA, readOf('es-C1-1-01', 'es-C1-1-02')), 'C1');
  assert.equal(levelAbove('C1'), 'C1');
  assert.deepEqual(READING_LEVELS.map(levelAbove), ['A2', 'B1', 'B2', 'C1', 'C1']);
  // Nothing read at the learner's level: no change, whatever was read elsewhere (never down).
  assert.equal(levelAfter('B2', LEVEL_DATA, readOf(...A1)), 'B2');
});

test('the browser predicts the level from the progress sent with the text: this one counts only at the learner’s level', () => {
  const p = (level: ReadingLevel, total: number, read: number) => ({ level, total, read });
  // The last unread A1 text: up to A2 (the A2 counts come from the server's result).
  assert.deepEqual(predictedLevel('A1', p('A1', 40, 39), 'A1'), { level: 'A2', progress: null });
  // Two left: stays, with this one counted.
  assert.deepEqual(predictedLevel('A1', p('A1', 40, 38), 'A1'), { level: 'A1', progress: p('A1', 40, 39) });
  // A text at another level (a fallback) doesn't count.
  assert.deepEqual(predictedLevel('A1', p('A1', 40, 39), 'A2'), { level: 'A1', progress: p('A1', 40, 39) });
  // A level without texts, and C1 read to the end, stay.
  assert.deepEqual(predictedLevel('B1', p('B1', 0, 0), 'A2'), { level: 'B1', progress: p('B1', 0, 0) });
  assert.deepEqual(predictedLevel('C1', p('C1', 40, 39), 'C1'), { level: 'C1', progress: p('C1', 40, 40) });
  // Progress for another level (the learner's level changed meanwhile), or none: no prediction.
  assert.deepEqual(predictedLevel('A2', p('A1', 40, 39), 'A1'), { level: 'A2', progress: null });
  assert.deepEqual(predictedLevel('A2', undefined, 'A2'), { level: 'A2', progress: null });
});

test('the next passage is looked for at the requested level, then higher, then lower, nearest first', () => {
  assert.deepEqual(levelSearchOrder('A1'), ['A1', 'A2', 'B1', 'B2', 'C1']);
  assert.deepEqual(levelSearchOrder('B1'), ['B1', 'B2', 'C1', 'A2', 'A1']);
  assert.deepEqual(levelSearchOrder('C1'), ['C1', 'B2', 'B1', 'A2', 'A1']);
  for (const l of READING_LEVELS) assert.equal(new Set(levelSearchOrder(l)).size, 5);
});

test('levels: unknown stored values read as A1; questions are in the language from B2', () => {
  assert.equal(readingLevel('B2'), 'B2');
  assert.equal(readingLevel('C2'), 'A1');
  assert.equal(readingLevel(undefined), 'A1');
  assert.deepEqual(READING_LEVELS.map(questionsInLanguage), [false, false, false, true, true]);
});

const P = (id: string): { id: string; level: ReadingLevel; kind: ComprehensionKind } => ({ id, level: id.split('-')[1] as ReadingLevel, kind: kindOfId(id) });

test('picking: the first unread passage of the level in id order, skipping read and excluded ones, then other levels', () => {
  const passages = ['es-A1-1-01', 'es-A1-1-02', 'es-A1-1-03', 'es-A2-1-01', 'es-A2-1-02', 'es-B2-1-01'].map(P);
  const none = new Set<string>();
  assert.deepEqual(pickPassage(passages, none, 'A1'), { passage: passages[0], fallback: false });
  assert.equal(pickPassage(passages, new Set(['es-A1-1-01']), 'A1')!.passage.id, 'es-A1-1-02');
  assert.equal(pickPassage(passages, new Set(['es-A1-1-01']), 'A1', new Set(['es-A1-1-02']))!.passage.id, 'es-A1-1-03');
  // A1 used up: the next higher level with a passage left.
  const a1 = new Set(['es-A1-1-01', 'es-A1-1-02', 'es-A1-1-03']);
  assert.deepEqual(pickPassage(passages, a1, 'A1'), { passage: passages[3], fallback: true });
  // B1 has none and B2 is read: C1 has none either, so the nearest lower level (A2).
  assert.deepEqual(pickPassage(passages, new Set(['es-B2-1-01']), 'B1'), { passage: passages[3], fallback: true });
  assert.deepEqual(pickPassage(passages, none, 'C1'), { passage: passages[5], fallback: true });
  // Everything read (or excluded): nothing.
  assert.equal(pickPassage(passages, new Set(passages.map((p) => p.id)), 'A2'), null);
  assert.equal(pickPassage(passages, a1, 'A1', new Set(['es-A2-1-01', 'es-A2-1-02', 'es-B2-1-01'])), null);
  assert.equal(pickPassage([], none, 'A1'), null);
});

test('short passages are served in step order, and a used-up level falls back to other levels of the same kind', () => {
  const full = (id: string, step?: number) => ({ ...P(id), step, genre: 'everyday', topic: '', title: '', titleEn: '', text: '', translation: '', questions: [] }) as unknown as ComprehensionPassage;
  // Long passages by id; short ones by step, whatever their ids.
  const passages = [full('es-A1-S1-01', 3), full('es-B1-S1-01', 1), full('es-A1-1-02'), full('es-A1-S2-01', 2), full('es-A1-1-01'), full('es-A1-S1-02', 1), full('es-A2-1-01')].sort(passageOrder);
  assert.deepEqual(passages.map((p) => p.id), ['es-A1-1-01', 'es-A1-1-02', 'es-A1-S1-02', 'es-A1-S2-01', 'es-A1-S1-01', 'es-A2-1-01', 'es-B1-S1-01']);
  const none = new Set<string>();
  assert.equal(pickPassage(passages, none, 'A1')!.passage.id, 'es-A1-1-01', 'long by default');
  assert.equal(pickPassage(passages, none, 'A1', none, 'short')!.passage.id, 'es-A1-S1-02', 'step 1 first');
  assert.equal(pickPassage(passages, new Set(['es-A1-S1-02']), 'A1', none, 'short')!.passage.id, 'es-A1-S2-01', 'then step 2');
  // Every short A1 read: the short B1 passage, not a long A1 one.
  const shortA1 = new Set(['es-A1-S1-01', 'es-A1-S1-02', 'es-A1-S2-01']);
  assert.deepEqual(pickPassage(passages, shortA1, 'A1', none, 'short'), { passage: passages[6], fallback: true });
  // No long passage from B1 up: the nearest lower long one.
  assert.deepEqual(pickPassage(passages, none, 'B1', none, 'long'), { passage: passages[5], fallback: true });
  assert.equal(pickPassage(passages, new Set([...shortA1, 'es-B1-S1-01']), 'C1', none, 'short'), null);
});

test('id order is natural: batch 10 comes after batch 2', () => {
  const ids = ['es-A1-10-01', 'es-A1-2-10', 'es-A1-2-02', 'es-A1-1-20'];
  assert.deepEqual([...ids].sort((a, b) => byId({ id: a }, { id: b })), ['es-A1-1-20', 'es-A1-2-02', 'es-A1-2-10', 'es-A1-10-01']);
});

test('grading compares each chosen stored index with the right one; -1 is no answer', () => {
  const q = (answer: number) => ({ q: 'Q?', options: ['a', 'b', 'c', 'd'], answer, explain: 'Because.' });
  const passage: ComprehensionPassage = { id: 'es-A1-1-01', kind: 'long', level: 'A1', genre: 'science', topic: 't', title: 'T', titleEn: 'T', text: 'x', translation: 'x', questions: [q(0), q(1), q(2), q(3)] };
  assert.deepEqual(gradeAnswers(passage, [0, 1, 2, 3]).correct, 4);
  const three = gradeAnswers(passage, [0, 1, 2, -1]);
  assert.equal(three.correct, 3);
  assert.equal(three.passed, true);
  assert.deepEqual(three.results[3], { chosen: -1, answer: 3, correct: false });
  assert.equal(gradeAnswers(passage, [3, 2, 1, 0]).passed, false);
  const short: ComprehensionPassage = { ...passage, id: 'es-A1-S1-01', kind: 'short', genre: 'everyday', questions: [q(0), q(1), q(2)] };
  assert.equal(gradeAnswers(short, [0, 1, -1]).passed, true, '2 of 3 passes');
  assert.equal(gradeAnswers(short, [0, 2, -1]).passed, false, '1 of 3 does not');
});

const good = () => ({
  id: 'es-A1-1-01',
  lang: 'es',
  level: 'A1',
  genre: 'literature',
  topic: 'a baker',
  title: 'Un día',
  titleEn: 'A day',
  text: 'Uno.\n\nDos.',
  translation: 'One.\n\nTwo.',
  questions: [0, 1, 2, 3].map((answer) => ({ q: 'What?', options: ['a', 'b', 'c', 'd'], answer, explain: 'Because.' })),
});

const goodShort = () => ({
  ...good(),
  id: 'es-A1-S1-04',
  genre: 'everyday',
  format: 'dialogue',
  step: 4,
  text: '—Hola, ¿qué tal?\n—Bien, gracias.',
  questions: good().questions.slice(0, 3),
});

test('the passage build takes short passages: everyday, a format, a step and three questions, in short files only', () => {
  const target = fileTarget('es-A1-S1.jsonl');
  assert.deepEqual(target, { lang: 'es', level: 'A1', kind: 'short' });
  assert.deepEqual(checkPassage(goodShort(), target), []);
  const bad = (patch: (p: any) => void, t = target) => {
    const p: any = goodShort();
    patch(p);
    return checkPassage(p, t).join('; ');
  };
  assert.match(bad((p) => (p.genre = 'science')), /genre must be "everyday"/);
  assert.match(bad((p) => (p.format = 'poem')), /format must be one of/);
  assert.match(bad((p) => (p.step = 41)), /step must be a whole number from 1 to 40/);
  assert.match(bad((p) => delete p.step), /step must be/);
  assert.match(bad((p) => p.questions.push(p.questions[0])), /exactly 3 questions/);
  assert.match(bad(() => undefined, fileTarget('es-A1-1.jsonl')), /a short passage in a file of long passages/);
  assert.match(checkPassage(good(), target).join('; '), /a long passage in a file of short passages/);
  // Stored with its kind, format and step; the single line breaks of a dialogue stay.
  const s = storedPassage(goodShort());
  assert.deepEqual([s.kind, s.format, s.step, s.questions.length], ['short', 'dialogue', 4, 3]);
  assert.equal(s.text, '—Hola, ¿qué tal?\n—Bien, gracias.');
  assert.equal(storedPassage(good()).kind, 'long');
  assert.equal('step' in storedPassage(good()), false);
});

test('the passage build rejects missing fields, wrong levels, the wrong language and bad questions', () => {
  const target = fileTarget('es-A1-1.jsonl');
  assert.deepEqual(target, { lang: 'es', level: 'A1', kind: 'long' });
  assert.deepEqual(checkPassage(good(), target), []);
  const bad = (patch: (p: any) => void) => {
    const p: any = good();
    patch(p);
    return checkPassage(p, target).join('; ');
  };
  assert.match(bad((p) => (p.lang = 'pt')), /lang pt in a es file/);
  assert.match(bad((p) => (p.level = 'C2')), /level must be one of/);
  assert.match(bad((p) => (p.level = 'A2')), /level A2 in a A1 file/);
  assert.match(bad((p) => (p.genre = 'sport')), /genre/);
  assert.match(bad((p) => (p.translation = ' ')), /translation is missing/);
  assert.match(bad((p) => p.questions.pop()), /exactly 4 questions/);
  assert.match(bad((p) => (p.questions[1].options = ['a', 'b', 'c'])), /question 2: needs 4 options/);
  assert.match(bad((p) => (p.questions[2].options = ['a', 'b', 'C ', 'c'])), /question 3: two options are the same/);
  assert.match(bad((p) => (p.questions[3].answer = 4)), /question 4: answer must be 0–3/);
  assert.match(bad((p) => (p.questions[0].explain = '')), /question 1: no explanation/);
  assert.match(bad((p) => (p.id = 'es-A1-01')), /id must look like/);
});

test('the passage build finds duplicate ids across files and writes passages sorted by level, then id, without lang', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'vb-reading-'));
  try {
    const line = (patch: Record<string, unknown>) => JSON.stringify({ ...good(), ...patch });
    const short = (patch: Record<string, unknown>) => JSON.stringify({ ...goodShort(), ...patch });
    writeFileSync(path.join(dir, 'es-A2-1.jsonl'), [line({ id: 'es-A2-1-01', level: 'A2' })].join('\n'));
    writeFileSync(path.join(dir, 'es-A1-1.jsonl'), [line({ id: 'es-A1-1-10' }), line({ id: 'es-A1-1-02' }), ''].join('\n'));
    writeFileSync(path.join(dir, 'es-A1-S1.jsonl'), [short({ id: 'es-A1-S1-01', step: 2 }), short({ id: 'es-A1-S1-02', step: 1 })].join('\n'));
    const ok = readBatches([path.join(dir, 'es-A2-1.jsonl'), path.join(dir, 'es-A1-1.jsonl'), path.join(dir, 'es-A1-S1.jsonl')]);
    assert.deepEqual(ok.problems, []);
    assert.deepEqual(ok.warnings, []);
    const file = JSON.parse(languageFile('es', ok.byLang.get('es')));
    assert.equal(file.format, 'vocabbuilder-reading-v1');
    assert.equal(file.language, 'es');
    assert.equal(file.copyright, '© 2026 Lango. All rights reserved.');
    assert.deepEqual(file.passages.map((p: any) => p.id), ['es-A1-1-02', 'es-A1-1-10', 'es-A1-S1-02', 'es-A1-S1-01', 'es-A2-1-01']);
    assert.equal('lang' in file.passages[0], false);
    assert.equal(languageFile('es', [...ok.byLang.get('es')].reverse()), languageFile('es', ok.byLang.get('es')), 'the same passages give the same bytes');

    writeFileSync(path.join(dir, 'es-A1-2.jsonl'), line({ id: 'es-A1-1-02' }) + '\n{not json\n');
    const dup = readBatches([path.join(dir, 'es-A1-1.jsonl'), path.join(dir, 'es-A1-2.jsonl')]);
    assert.ok(dup.problems.some((p: string) => /duplicate id, also in es-A1-1\.jsonl/.test(p)));
    assert.ok(dup.problems.some((p: string) => /line 2: not valid JSON/.test(p)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
