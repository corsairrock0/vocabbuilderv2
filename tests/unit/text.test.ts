// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Text normalisation regression tests. In particular: stripping learner stress marks must
// never remove Latin accents or Vietnamese tones (they are part of the spelling).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonical, editDistance, englishCore, expandEnglishVariants, findTarget, foldLatinDiacritics, matchKey, soundVariants, stripPunctuation, stripStress } from '../../shared/text.ts';
import { checkAnswer } from '../../shared/answer.ts';

test('stripStress removes Russian/Ukrainian stress marks only', () => {
  assert.equal(stripStress('вода́'), 'вода');
  assert.equal(stripStress('во́ду'), 'воду');
  assert.equal(stripStress('Я пью во́ду.'), 'Я пью воду.');
  assert.equal(stripStress('дя́кую'), 'дякую');
  assert.equal(stripStress('го̀род'), 'город', 'grave used as a stress mark');
  assert.equal(stripStress('ѐ'), 'е', 'NFC-composed ѐ is treated as е + stress');
  assert.equal(stripStress('ещё'), 'ещё', 'ё is a letter, not a stress mark');
  assert.equal(stripStress('їжа'), 'їжа');
  assert.equal(stripStress('чай'), 'чай');
});

test('regression: Latin accents and Vietnamese tones survive stripStress', () => {
  for (const w of ['dónde', 'qué', 'más', 'café', 'mówić', 'źdźbło', 'książka', 'ônibus', 'você', 'avó', 'à', 'tiền', 'cảm ơn', 'người', 'đường', 'phở', 'má', 'mà']) {
    assert.equal(stripStress(w), w, w);
    assert.equal(stripStress(w.normalize('NFD')), w, `${w} (NFD input)`);
  }
});

test('regression: lemma keys keep accents and tones, so distinct words stay distinct', () => {
  assert.equal(matchKey('Dónde', 'es'), 'dónde');
  assert.notEqual(matchKey('dónde', 'es'), matchKey('donde', 'es'));
  assert.notEqual(matchKey('tiền', 'vi'), matchKey('tiên', 'vi'));
  assert.notEqual(matchKey('má', 'vi'), matchKey('ma', 'vi'));
  assert.notEqual(matchKey('avó', 'pt'), matchKey('avô', 'pt'));
  assert.equal(matchKey('mówić', 'pl'), 'mówić');
  // Russian keys fold stress and ё, as ordinary Russian text often omits ё.
  assert.equal(matchKey('Ещё', 'ru'), 'еще');
  assert.equal(matchKey('вода́', 'ru'), 'вода');
  assert.equal(canonical('Вода́!', 'uk'), 'вода');
});

test('regression: accented accepted answers still require the accents (normal strictness)', () => {
  assert.equal(checkAnswer('dónde', { lang: 'es', accepted: ['dónde'] }).grade, 'correct');
  assert.equal(checkAnswer('donde', { lang: 'es', accepted: ['dónde'] }).code, 'missing_diacritics');
  assert.equal(checkAnswer('tiền', { lang: 'vi', accepted: ['tiền'] }).grade, 'correct');
  assert.equal(checkAnswer('tiên', { lang: 'vi', accepted: ['tiền'] }).grade, 'incorrect');
  assert.equal(checkAnswer('mowic', { lang: 'pl', accepted: ['mówić'] }).grade, 'close');
});

test('punctuation stripping keeps word-internal apostrophes and hyphens', () => {
  assert.equal(stripPunctuation("¿Qué tal?"), 'Qué tal');
  assert.equal(stripPunctuation("м'ясо"), "м'ясо");
  assert.equal(stripPunctuation('кто-то, где-нибудь!'), 'кто-то где-нибудь');
  assert.equal(stripPunctuation("'quoted' - dash"), 'quoted dash');
});

test('Latin diacritic folding covers đ and ł', () => {
  assert.equal(foldLatinDiacritics('đường'), 'duong');
  assert.equal(foldLatinDiacritics('Łódź'), 'Lodz');
  assert.equal(foldLatinDiacritics('coração'), 'coracao');
});

test('English helpers', () => {
  assert.deepEqual(expandEnglishVariants('to look (at)').sort(), ['to look', 'to look (at)', 'to look at'].sort());
  assert.deepEqual(expandEnglishVariants('glass/cup; mug'), ['glass', 'cup', 'mug']);
  assert.equal(englishCore('To be cold'), 'cold');
  assert.equal(englishCore('the house'), 'house');
  assert.equal(englishCore('to look for something'), 'look for');
});

test('edit distance (optimal string alignment) with cut-off', () => {
  assert.equal(editDistance('kitten', 'sitting'), 3);
  assert.equal(editDistance('abcd', 'abdc'), 1, 'adjacent transposition is one edit');
  assert.equal(editDistance('вода', 'вода'), 0);
  assert.equal(editDistance('a', 'abcdef', 2), 3, 'cut-off returns max + 1');
});

test('findTarget prefers the word itself to the same letters inside another word', () => {
  assert.deepEqual(findTarget('Ella era la Primera Dama.', 'la'), [9, 11]);
  assert.deepEqual(findTarget('La casa es grande.', 'la'), [0, 2]);
  assert.deepEqual(findTarget('Dámelo ya.', 'lo'), [4, 6], 'a clitic inside a longer word is still found');
  assert.deepEqual(findTarget('Tôi là sinh viên.', 'sinh viên'), [7, 16]);
});

test('findTarget locates the word in an example sentence', () => {
  assert.deepEqual(findTarget('Я пью воду.', 'воду'), [6, 10]);
  assert.deepEqual(findTarget('Спасибо за помощь.', 'спасибо'), [0, 7]);
  assert.equal(findTarget('Hola', 'adiós'), null);
});

test('sound variants: Ukrainian в/у, і/й and з/із/зі replace each other; Russian and Polish ones depend on the next word', () => {
  assert.deepEqual(soundVariants('В', 'uk'), { variants: ['у'], free: true });
  assert.deepEqual(soundVariants('зі', 'uk'), { variants: ['з', 'із'], free: true });
  assert.deepEqual(soundVariants('книга', 'uk'), { variants: [], free: true });
  assert.deepEqual(soundVariants('во', 'ru'), { variants: ['в'], free: false });
  assert.deepEqual(soundVariants('we', 'pl'), { variants: ['w'], free: false });
  assert.deepEqual(soundVariants('en', 'es'), { variants: [], free: false });
});
