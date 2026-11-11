// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Cloze sentences: how the frequency-set build picks up to three sentences per word (scripts/freq/sentences.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '../..');
const { attachSentences, closeUpPunctuation } = await import(pathToFileURL(path.join(ROOT, 'scripts/freq/sentences.mjs')).href);

/** A sources directory with a Tatoeba deck and a Porttinari treebank file holding the given sentences. */
function sources(deck: Array<[string, string]>, treebank: Array<{ text: string; tokens: Array<[string, string, string]> }>) {
  const dir = mkdtempSync(path.join(tmpdir(), 'vb-sentences-'));
  mkdirSync(path.join(dir, 'tatoeba-decks'));
  const db = new DatabaseSync(path.join(dir, 'tatoeba-decks', 'pt.sqlite'));
  db.exec('CREATE TABLE notes (id INTEGER PRIMARY KEY, flds TEXT)');
  deck.forEach(([pt, en], i) => db.prepare('INSERT INTO notes (id, flds) VALUES (?, ?)').run(i + 1, `${pt}\x1f${en}\x1f[sound:${1000 + i}.mp3]`));
  db.close();
  const ud = path.join(dir, 'ud', 'UD_Portuguese-Porttinari');
  mkdirSync(ud, { recursive: true });
  const conllu = treebank
    .map((s, i) => [`# sent_id = s${i + 1}`, `# text = ${s.text}`, ...s.tokens.map(([form, lemma, upos], j) => [j + 1, form, lemma, upos, '_', '_', '0', 'root', '_', '_'].join('\t')), ''].join('\n'))
    .join('\n');
  writeFileSync(path.join(ud, 'pt_porttinari-ud-train.conllu'), conllu + '\n');
  return (p: string) => path.join(dir, p);
}

const words = (text: string, lemmas: Record<string, [string, string]> = {}) =>
  (text.match(/[\p{L}\d,.%]+|[?.!]/gu) ?? []).map((w): [string, string, string] => (lemmas[w] ? [w, ...lemmas[w]] : [w, w.toLowerCase(), /^\p{L}/u.test(w) ? 'X' : 'PUNCT']));

test('cloze sentences: Tatoeba first, near-copies skipped, the blank unambiguous, long or numbered treebank text only as a last resort', async () => {
  const entries: any[] = [
    { lemma: 'calendário', pos: 'noun', frequencyRank: 1, forms: [] },
    { lemma: 'consultório', pos: 'noun', frequencyRank: 2, forms: [] },
    { lemma: 'orçamento', pos: 'noun', frequencyRank: 3, forms: [] },
    { lemma: 'eleitoral', pos: 'adjective', frequencyRank: 4, forms: [] },
  ];
  const long = 'O orçamento que o governo apresentou ontem à noite aos deputados da comissão de finanças prevê cortes em quase todas as áreas da administração pública federal.';
  const src = sources(
    [
      ['Você tem um calendário?', 'Do you have a calendar?'],
      ['Vocês têm um calendário?', 'Do you have a calendar?'],
      ['Eu preciso de um calendário.', 'I need a calendar.'],
      ['Eu vou colocar no meu calendário.', "I'll put it on my calendar."],
      ['O calendário novo é igual ao calendário velho.', 'The new calendar is the same as the old one.'],
      ['O consultório fica perto daqui.', 'The practice is near here.'],
      ['Precisamos de um orçamento.', 'We need a budget.'],
    ],
    [
      { text: 'O médico abriu um consultório no centro.', tokens: words('O médico abriu um consultório no centro .', { consultório: ['consultório', 'NOUN'] }) },
      { text: 'O orçamento da cidade foi aprovado.', tokens: words('O orçamento da cidade foi aprovado .', { orçamento: ['orçamento', 'NOUN'] }) },
      { text: long, tokens: words(long.replace('.', ' .'), { orçamento: ['orçamento', 'NOUN'] }) },
      { text: 'A justiça eleitoral registrou 12 candidatos.', tokens: words('A justiça eleitoral registrou 12 candidatos .', { eleitoral: ['eleitoral', 'ADJ'] }) },
    ],
  );
  const { stats } = await attachSentences('pt', entries, src, { ranked: [] });
  const texts = (lemma: string) => entries.find((e) => e.lemma === lemma).examples.map((x: any) => x.text);

  // Three different Tatoeba sentences; the near-copy and the sentence with the word twice are left out.
  assert.deepEqual(texts('calendário'), ['Você tem um calendário?', 'Eu preciso de um calendário.', 'Eu vou colocar no meu calendário.']);
  const first = entries[0].examples[0];
  assert.equal(first.translation, 'Do you have a calendar?');
  assert.equal(first.source, 'tatoeba');
  assert.equal(first.ref, 'tatoeba:1000');
  // Treebank text fills in after Tatoeba; the 30-word treebank sentence is not used for a word that has others.
  assert.deepEqual(texts('consultório'), ['O consultório fica perto daqui.', 'O médico abriu um consultório no centro.']);
  assert.deepEqual(texts('orçamento'), ['Precisamos de um orçamento.', 'O orçamento da cidade foi aprovado.']);
  // A sentence with a number in it stands in when nothing else has the word.
  assert.deepEqual(texts('eleitoral'), ['A justiça eleitoral registrou 12 candidatos.']);
  assert.equal(entries[3].examples[0].source, 'pt-porttinari');
  assert.equal(stats.withSentences, 4);
});

test('treebank text with a space before each punctuation mark is closed up for display', () => {
  assert.equal(closeUpPunctuation('Trong khi , tương lai ở nông thôn hiện nay chưa có gì đảm bảo .'), 'Trong khi, tương lai ở nông thôn hiện nay chưa có gì đảm bảo.');
  assert.equal(closeUpPunctuation('Ông ( 45 tuổi ) nói : " Tốt " , rồi đi ...'), 'Ông (45 tuổi) nói: "Tốt", rồi đi...');
});

test('AI-written sentences fill only words with no other sentence, and need an unambiguous blank in a real form', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'vb-ai-'));
  mkdirSync(path.join(dir, 'tatoeba-decks'));
  const db = new DatabaseSync(path.join(dir, 'tatoeba-decks', 'ru.sqlite'));
  db.exec('CREATE TABLE notes (id INTEGER PRIMARY KEY, flds TEXT)');
  db.prepare('INSERT INTO notes (id, flds) VALUES (1, ?)').run('Где мой дом?\x1fWhere is my house?\x1f[sound:7.mp3]');
  db.close();
  const ai = path.join(dir, 'ru.tsv');
  writeFileSync(
    ai,
    [
      'lemma\tpos\tsentence\ttarget\ttranslation',
      'дом\tnoun\tЭто наш дом.\tдом\tThis is our house.',
      'книга\tnoun\tЯ читаю книгу.\tкнигу\tI am reading a book.',
      'книга\tnoun\tКниги лежат на полке, книги везде.\tКниги\tBooks lie on the shelf, books everywhere.',
      'книга\tnoun\tТам много книжек.\tкнижек\tThere are many little books there.',
      'книга\tnoun\tНа полке стоит книга.\tкнига\tThere is a book on the shelf.',
    ].join('\n') + '\n',
  );
  const table = (stem: string) => ({ kind: 'noun', cells: { 'nom|sg': [`${stem}а`], 'gen|sg': [`${stem}и`], 'acc|sg': [`${stem}у`], 'nom|pl': [`${stem}и`] } });
  const entries: any[] = [
    { lemma: 'дом', pos: 'noun', frequencyRank: 1, forms: [] },
    { lemma: 'книга', pos: 'noun', frequencyRank: 2, forms: [], paradigm: table('книг') },
  ];
  const { stats, credits } = await attachSentences('ru', entries, (p: string) => path.join(dir, p), { ranked: [] }, { aiFile: ai });
  // дом has a Tatoeba sentence, so its AI sentence is not used.
  assert.deepEqual(entries[0].examples.map((x: any) => x.source), ['tatoeba']);
  // книга: the sentence with the word twice and the one with a form outside the table are left out.
  assert.deepEqual(entries[1].examples.map((x: any) => [x.text, x.target, x.source]), [
    ['Я читаю книгу.', 'книгу', 'ai-claude'],
    ['На полке стоит книга.', 'книга', 'ai-claude'],
  ]);
  assert.equal(stats.aiWords, 1);
  assert.equal(stats.bySource['ai-claude'], 2);
  assert.equal(stats.aiRejected.length, 2);
  assert.ok(credits.filter((c: any) => c.lemma === 'книга').every((c: any) => /AI \(Claude\)/.test(c.credit)));
  // Without the file, nothing is added.
  const again: any[] = [{ lemma: 'книга', pos: 'noun', frequencyRank: 2, forms: [], paradigm: table('книг') }];
  await attachSentences('ru', again, (p: string) => path.join(dir, p), { ranked: [] }, { aiFile: null });
  assert.deepEqual(again[0].examples, []);
});
