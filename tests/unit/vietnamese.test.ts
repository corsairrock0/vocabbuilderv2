// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// The Vietnamese tone keys of the typing helper (shared/vietnamese.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyTone, toneIndex, VI_TONE_KEYS } from '../../shared/vietnamese.ts';
import { vietnameseSpellingKey } from '../../shared/text.ts';

const mark = (name: string) => VI_TONE_KEYS.find((t) => t.name === name)!.mark;
const tone = (text: string, name: string, caret = text.length) => applyTone(text, caret, mark(name)).text;

test('a tone key puts its mark on the vowel of the syllable before the caret that carries it', () => {
  assert.equal(tone('đa', 'ngã'), 'đã', 'the owner’s word');
  assert.equal(tone('ngươi', 'huyền'), 'người', 'the ơ of ươ');
  assert.equal(tone('tiêng', 'sắc'), 'tiếng', 'a vowel with its own mark');
  assert.equal(tone('toan', 'sắc'), 'toán', 'two vowels in a closed syllable: the second');
  assert.equal(tone('hai', 'huyền'), 'hài', 'two vowels in an open syllable: the first');
  assert.equal(tone('khoai', 'sắc'), 'khoái', 'three vowels: the middle one');
  assert.equal(tone('qua', 'sắc'), 'quá', 'the u of qu- is part of the consonant');
  assert.equal(tone('gia', 'huyền'), 'già', 'so is the i of gi-');
  assert.equal(tone('gi', 'huyền'), 'gì', 'unless it is the only vowel');
  assert.equal(tone('Đa', 'ngã'), 'Đã', 'capitals keep their case');
});

test('either spelling of a tone on two vowels is accepted, so the helper never makes an answer wrong', () => {
  assert.equal(vietnameseSpellingKey(tone('hoa', 'sắc')), vietnameseSpellingKey('hoá'));
  assert.equal(vietnameseSpellingKey(tone('thuy', 'hỏi')), vietnameseSpellingKey('thuỷ'));
});

test('the same key takes the tone off, another replaces it; the rest of the text and the caret stay right', () => {
  assert.equal(tone('đã', 'ngã'), 'đa');
  assert.equal(tone('đá', 'ngã'), 'đã');
  const r = applyTone('tôi đa la', 6, mark('ngã'));
  assert.deepEqual(r, { text: 'tôi đã la', caret: 6 }, 'only the syllable before the caret');
  assert.deepEqual(applyTone('đ', 1, mark('ngã')), { text: 'đ', caret: 1 }, 'no vowel: nothing changes');
  assert.deepEqual(applyTone('', 0, mark('sắc')), { text: '', caret: 0 });
  assert.equal(toneIndex('xyz'.replace(/[aeiouy]/g, '')), -1);
});
