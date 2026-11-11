// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Answer checking: Unicode, case, punctuation, stress marks, apostrophes, diacritics per
// language and strictness, synonyms, inflections, confusables and "no substring" rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkAnswer, checkChoice, type AnswerSpec, type Strictness } from '../../shared/answer.ts';

const spec = (lang: AnswerSpec['lang'], accepted: string[], extra: Partial<AnswerSpec> = {}): AnswerSpec => ({ lang, accepted, ...extra });
const grade = (response: string, s: AnswerSpec, strictness: Strictness = 'normal') => checkAnswer(response, s, strictness);

test('empty and whitespace-only answers are incorrect', () => {
  for (const r of ['', '   ', '\n']) {
    const out = grade(r, spec('ru', ['вода']));
    assert.equal(out.grade, 'incorrect');
    assert.equal(out.code, 'empty');
  }
});

test('Unicode normalisation, case, punctuation and surrounding whitespace never cause false errors', () => {
  // NFD input (decomposed accents) matches NFC accepted answers.
  assert.equal(grade('café', spec('es', ['café'])).grade, 'correct');
  assert.equal(grade('  ¿Café?  ', spec('es', ['café'])).grade, 'correct');
  assert.equal(grade('ВОДА!', spec('ru', ['вода'])).grade, 'correct');
  assert.equal(grade('Xin chào.', spec('vi', ['xin chào'])).grade, 'correct');
  // Vietnamese typed with combining marks (NFD) is normalised to precomposed letters.
  assert.equal(grade('cảm ơn'.normalize('NFD'), spec('vi', ['cảm ơn'])).grade, 'correct');
});

test('Russian and Ukrainian learner stress marks are ignored', () => {
  assert.equal(grade('вода́', spec('ru', ['вода'])).grade, 'correct');
  assert.equal(grade('вода', spec('ru', ['вода́'])).grade, 'correct');
  assert.equal(grade('дя́кую', spec('uk', ['дякую'])).grade, 'correct');
  assert.equal(grade('го̀род', spec('ru', ['город'])).grade, 'correct');
});

test('Cyrillic letters with diacritics are never folded (й, ї, ё stay distinct)', () => {
  // чай (tea) vs чаи (teas): a different word, not a stress-mark variant.
  assert.equal(grade('чаи', spec('ru', ['чай'])).grade, 'incorrect');
  // Ukrainian ї vs і in a short word: incorrect, not "accents missing".
  const out = grade('іжа', spec('uk', ['їжа']));
  assert.equal(out.grade, 'incorrect');
  assert.notEqual(out.code, 'missing_diacritics');
});

test('Russian ё may be written as е', () => {
  const out = grade('еще', spec('ru', ['ещё']));
  assert.equal(out.grade, 'correct');
  assert.equal(out.code, 'yo_e');
  assert.equal(grade('ещё', spec('ru', ['еще'])).grade, 'correct');
});

test('Ukrainian apostrophe variants are equivalent', () => {
  for (const r of ['м’ясо', 'мʼясо', "м'ясо", 'м`ясо']) {
    assert.equal(grade(r, spec('uk', ['м’ясо'])).grade, 'correct', r);
  }
  // A missing apostrophe is a near miss, not a full match.
  assert.equal(grade('мясо', spec('uk', ['м’ясо'])).grade, 'close');
});

test('Polish, Spanish and Portuguese diacritics follow the strictness setting', () => {
  const cases: Array<[AnswerSpec['lang'], string, string]> = [
    ['pl', 'książka', 'ksiazka'],
    ['pl', 'łódź', 'lodz'],
    ['es', 'está', 'esta'],
    ['es', 'año', 'ano'],
    ['pt', 'ônibus', 'onibus'],
    ['pt', 'coração', 'coracao'],
  ];
  for (const [lang, accepted, typed] of cases) {
    const s = spec(lang, [accepted]);
    const strict = grade(typed, s, 'strict');
    const normal = grade(typed, s, 'normal');
    const lenient = grade(typed, s, 'lenient');
    assert.equal(strict.grade, 'incorrect', `${typed} strict`);
    assert.equal(normal.grade, 'close', `${typed} normal`);
    assert.equal(normal.code, 'missing_diacritics', `${typed} code`);
    assert.equal(lenient.grade, 'correct', `${typed} lenient`);
    assert.equal(normal.expected, accepted);
  }
});

test('partially wrong accents are reported as wrong diacritics and never fully correct', () => {
  // ksiązka: ą present, ż missing -> some marks present but not matching.
  const s = spec('pl', ['książka']);
  assert.equal(grade('ksiązka', s, 'normal').code, 'wrong_diacritics');
  assert.equal(grade('ksiązka', s, 'normal').grade, 'close');
  assert.equal(grade('ksiązka', s, 'lenient').grade, 'close');
  assert.equal(grade('ksiązka', s, 'strict').grade, 'incorrect');
  assert.equal(grade('cafè', spec('es', ['café'])).code, 'wrong_diacritics');
});

test('Vietnamese: a wrong tone is incorrect, missing all tones is close', () => {
  const s = spec('vi', ['cảm ơn']);
  const wrongTone = grade('cám ơn', s, 'normal');
  assert.equal(wrongTone.grade, 'incorrect');
  assert.equal(wrongTone.code, 'wrong_diacritics');
  assert.equal(grade('cám ơn', s, 'lenient').grade, 'close');
  const noTones = grade('cam on', s, 'normal');
  assert.equal(noTones.grade, 'close');
  assert.equal(noTones.code, 'missing_diacritics');
  assert.equal(grade('cam on', s, 'strict').grade, 'incorrect');
  // đ folds to d only as "missing diacritics", never as a match.
  assert.equal(grade('di', spec('vi', ['đi'])).grade, 'close');
  assert.equal(grade('đi', spec('vi', ['đi'])).grade, 'correct');
});

test('Vietnamese: a toneless form that is itself another word is not accepted as a near miss', () => {
  // "ma" (ghost) vs "má" (mom, Southern): if "ma" is a known different word it is incorrect.
  const out = grade('ma', spec('vi', ['má'], { confusables: ['ma', 'mà', 'mạ'] }));
  assert.equal(out.grade, 'incorrect');
  assert.equal(out.code, 'different_word');
});

test('Vietnamese multi-syllable words: spacing errors are near misses', () => {
  const s = spec('vi', ['xe buýt']);
  assert.equal(grade('xe buýt', s).grade, 'correct');
  assert.equal(grade('xe  buýt', s).grade, 'correct');
  assert.equal(grade('xebuýt', s, 'normal').grade, 'close');
  assert.equal(grade('xebuýt', s, 'normal').code, 'spacing');
  assert.equal(grade('xebuýt', s, 'lenient').grade, 'correct');
});

test('hyphenated words: a space instead of the hyphen is a near miss', () => {
  const out = grade('кто то', spec('ru', ['кто-то']));
  assert.equal(out.grade, 'close');
  assert.equal(out.code, 'spacing');
});

test('right word in the wrong inflected form is close (wrong_form) with the form tags', () => {
  const s = spec('ru', ['воду'], {
    otherForms: [
      { form: 'вода', tags: ['dictionary form'] },
      { form: 'воды', tags: ['genitive', 'singular'] },
    ],
  });
  const out = grade('вода', s);
  assert.equal(out.grade, 'close');
  assert.equal(out.code, 'wrong_form');
  assert.deepEqual(out.formTags, ['dictionary form']);
  assert.match(out.message, /воду/);
  assert.equal(grade('Воду', s).grade, 'correct');
  // Polish: dictionary form instead of the accusative.
  const pl = grade('kawa', spec('pl', ['kawę'], { otherForms: [{ form: 'kawa', tags: ['nominative'] }] }));
  assert.equal(pl.code, 'wrong_form');
});

test('confusables (different real words) are never accepted as typos', () => {
  // брать (to take) vs брат (brother): one edit apart but different words.
  assert.equal(grade('брат', spec('ru', ['брать'])).grade, 'close', 'without confusable info a 1-letter slip is a typo');
  const out = grade('брат', spec('ru', ['брать'], { confusables: ['брат'] }));
  assert.equal(out.grade, 'incorrect');
  assert.equal(out.code, 'different_word');
  // кот vs код: short words get no typo tolerance at all.
  assert.equal(grade('код', spec('ru', ['кот'])).grade, 'incorrect');
  assert.equal(grade('код', spec('ru', ['кот'], { confusables: ['код'] })).code, 'different_word');
});

test('typo tolerance scales with length and strictness', () => {
  const s = spec('es', ['trabajar']);
  assert.equal(grade('trabajr', s, 'normal').grade, 'close');
  assert.equal(grade('trabajr', s, 'normal').code, 'typo');
  assert.equal(grade('trabajr', s, 'strict').grade, 'incorrect');
  // Transposition counts as one edit.
  assert.equal(grade('trabjaar', s, 'normal').grade, 'close');
  // Three edits are too many in normal mode.
  assert.equal(grade('trbjr', s, 'normal').grade, 'incorrect');
  // Very short words: no tolerance.
  assert.equal(grade('sal', spec('es', ['sol'])).grade, 'incorrect');
});

test('English answers: synonyms, "to" prefix, articles, parentheses and slash variants', () => {
  const speak = spec('en', ['to speak', 'to talk', 'speak', 'talk']);
  assert.equal(grade('talk', speak).grade, 'correct');
  assert.equal(grade('To Speak!', speak).grade, 'correct');
  assert.equal(grade('speak', speak).grade, 'correct');
  assert.equal(grade('to talk', speak).code, 'exact');
  assert.equal(grade('Talk.', speak).code, 'accepted_variant');
  const look = spec('en', ['to look (at)']);
  for (const r of ['look', 'look at', 'to look at', 'to look']) assert.equal(grade(r, look).grade, 'correct', r);
  const glass = spec('en', ['glass/cup']);
  assert.equal(grade('cup', glass).grade, 'correct');
  assert.equal(grade('glass', glass).grade, 'correct');
  const bill = spec('en', ['the bill']);
  assert.equal(grade('bill', bill).grade, 'correct');
  assert.equal(grade('a bill', bill).grade, 'correct');
  const searchFor = spec('en', ['to look for something']);
  assert.equal(grade('look for', searchFor).grade, 'correct');
});

test('English: another meaning of the same word is accepted and labelled', () => {
  const out = grade('key', spec('en', ['spring (water source)'], { otherMeanings: ['key', 'clue'] }));
  assert.equal(out.grade, 'correct');
  assert.equal(out.code, 'other_meaning');
});

test('English: short different words are not treated as typos (house/horse)', () => {
  assert.equal(grade('horse', spec('en', ['house'])).grade, 'incorrect');
  assert.equal(grade('beer', spec('en', ['bear'])).grade, 'incorrect');
  // Longer words tolerate one slip.
  const out = grade('beautifull', spec('en', ['beautiful']));
  assert.equal(out.grade, 'close');
  assert.equal(out.code, 'typo');
  // ...unless the slip produces a different known gloss.
  assert.equal(grade('stationery', spec('en', ['stationary'], { confusables: ['stationery'] })).code, 'different_word');
});

test('no substring acceptance: containing the right word is not enough', () => {
  assert.equal(grade('to take', spec('en', ['to take a picture'])).grade, 'incorrect');
  assert.equal(grade('black cat', spec('en', ['cat'])).grade, 'incorrect');
  assert.equal(grade('cat', spec('en', ['black cat'])).grade, 'incorrect');
  assert.equal(grade('вода вода', spec('ru', ['вода'])).grade, 'incorrect');
  assert.equal(grade('моя вода', spec('ru', ['вода'])).grade, 'incorrect');
});

test('the first accepted answer is reported as the expected answer', () => {
  const out = grade('zzz', spec('ru', ['говорить', 'говори́ть']));
  assert.equal(out.grade, 'incorrect');
  assert.equal(out.expected, 'говорить');
});

test('multiple-choice grading', () => {
  assert.equal(checkChoice('b', 'b').grade, 'correct');
  assert.equal(checkChoice('a', 'b').grade, 'incorrect');
  assert.equal(checkChoice(null, 'b').code, 'empty');
});

test('"practice" and "practise" are one word in English answers, whichever way the meaning is spelled', () => {
  // A dictionary meaning spelled the British way accepts the app's spelling in full (right, not "almost").
  for (const [meaning, answer] of [
    ['to practise', 'to practice'],
    ['to practise', 'practice'],
    ['to practice', 'to practise'],
    ['practised, seasoned', 'practiced'],
    ['practising', 'practicing'],
    ['to practise (a trade or profession)', 'to practice a trade or profession'],
  ]) {
    const out = grade(answer, spec('en', [meaning]));
    assert.equal(out.grade, 'correct', `${answer} for ${meaning}`);
  }
  // Only these forms: another word that happens to hold the letters is left alone.
  assert.notEqual(grade('practical', spec('en', ['practise'])).grade, 'correct');
  // Another meaning of the same word is recognised in either spelling too.
  assert.equal(grade('to practise', spec('en', ['to train'], { otherMeanings: ['to practice'] })).code, 'other_meaning');
});
