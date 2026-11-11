// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// The exact cells of example sentences (data/grammar/, server/learning/grammar.ts) reach the exercises whose feedback
// explains the form. A fixture Ukrainian set is imported and its annotations are built with scripts/grammar/build.mjs
// into a folder served through VB_GRAMMAR_DIR: a session's cloze exercises (and the follow-up variants) and the
// sentence-gap practice carry `exact` for the annotated sentence and for no other, only when the word's table in the
// database confirms the cell; the file is re-read when it changes, and a missing or broken file means no annotations.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client, startTestServer, type TestServer } from '../helpers/harness.ts';
import { startSession } from '../helpers/study.ts';
import { exactKey, explainForm } from '../../shared/grammar.ts';
import { exactCellFor, loadGrammar } from '../../server/learning/grammar.ts';
// @ts-expect-error plain JavaScript build script
import { build, languageFile } from '../../scripts/grammar/build.mjs';

const WHY = 'it describes “громадянство” (citizenship), the thing he has in “у нього …” (he has); what someone has is the subject there, so it is nominative.';
const OWNER = 'У нього українське громадянство.';

const table = (spec: string) => Object.fromEntries(spec.split(';').map((c) => [c.split('=')[0], c.split('=')[1].split(',')]));
const ukDoc = {
  format: 'vocabbuilder-v1',
  language: 'uk',
  source: { name: 'Test set (uk)', kind: 'frequency_mixed', license: 'CC-BY-SA-4.0' },
  sentenceSources: { tatoeba: { name: 'Tatoeba', license: 'CC-BY-2.0-FR', url: 'https://tatoeba.org' } },
  entries: [
    {
      lemma: 'український',
      display: 'украї́нський',
      pos: 'adjective',
      senses: [{ gloss: 'Ukrainian' }],
      examples: [{ text: OWNER, translation: 'He has Ukrainian citizenship.', target: 'українське', source: 'tatoeba', ref: 'tatoeba:5713784' }],
      paradigm: {
        kind: 'adjective',
        source: 'dmklinger/ukrainian',
        cells: table(
          'nom|m=украї́нський;nom|n=украї́нське;nom|f=украї́нська;nom|pl=украї́нські;gen|m=украї́нського;gen|n=украї́нського;gen|f=украї́нської;gen|pl=украї́нських;dat|m=украї́нському;dat|n=украї́нському;dat|f=украї́нській;dat|pl=украї́нським;acc|n=украї́нське;acc|f=украї́нську;ins|m=украї́нським;ins|n=украї́нським;ins|f=украї́нською;ins|pl=украї́нськими;loc|m=украї́нському;loc|n=украї́нському;loc|f=украї́нській;loc|pl=украї́нських;acc.inan|m=украї́нський;acc.anim|m=украї́нського;acc.inan|pl=украї́нські;acc.anim|pl=украї́нських',
        ),
      },
    },
    {
      lemma: 'школа',
      display: 'шко́ла',
      pos: 'noun',
      gender: 'f',
      senses: [{ gloss: 'school' }],
      examples: [{ text: 'Діти йдуть у школу.', translation: 'The children go to school.', target: 'школу', source: 'tatoeba', ref: 'tatoeba:1' }],
      paradigm: { kind: 'noun', source: 'test', cells: table('nom|sg=шко́ла;nom|pl=шко́ли;gen|sg=шко́ли;gen|pl=шкіл;dat|sg=шко́лі;dat|pl=шко́лам;acc|sg=шко́лу;acc|pl=шко́ли;ins|sg=шко́лою;ins|pl=шко́лами;loc|sg=шко́лі;loc|pl=шко́лах;voc|sg=шко́ло;voc|pl=шко́ли') },
    },
    {
      lemma: 'робота',
      display: 'робо́та',
      pos: 'noun',
      gender: 'f',
      senses: [{ gloss: 'work' }],
      examples: [{ text: 'Я повернувся з роботи.', translation: 'I came back from work.', target: 'роботи', source: 'tatoeba', ref: 'tatoeba:2' }],
      paradigm: { kind: 'noun', source: 'test', cells: table('nom|sg=робо́та;nom|pl=робо́ти;gen|sg=робо́ти;gen|pl=робі́т;dat|sg=робо́ті;dat|pl=робо́там;acc|sg=робо́ту;acc|pl=робо́ти;ins|sg=робо́тою;ins|pl=робо́тами;loc|sg=робо́ті;loc|pl=робо́тах;voc|sg=робо́то;voc|pl=робо́ти') },
    },
  ],
};

let srv: TestServer;
let c: Client;
let dir: string;
let grammarDir: string;
const ids: Record<string, number> = {};
const grammarFile = () => path.join(grammarDir, 'uk.json');

before(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'vb-grammar-'));
  grammarDir = path.join(dir, 'grammar');
  const [src, freq] = [path.join(dir, 'src'), path.join(dir, 'freq')];
  mkdirSync(src);
  mkdirSync(freq);
  // The build checks the annotations against the same set the app imports.
  writeFileSync(path.join(freq, 'uk.json'), JSON.stringify(ukDoc));
  writeFileSync(
    path.join(src, 'uk.jsonl'),
    [
      { lemma: 'український', target: 'українське', sentence: OWNER, cell: 'nom|n', why: WHY },
      { lemma: 'робота', target: 'роботи', sentence: 'Я повернувся з роботи.', cell: 'nom|sg', why: 'роботи is not in this cell.' },
    ]
      .map((r) => JSON.stringify(r))
      .join('\n'),
  );
  const [uk] = build({ srcDir: src, freqDir: freq, outDir: grammarDir, langs: ['uk'] });
  assert.deepEqual([uk.kept, uk.dropped], [1, 1], 'the build drops the record whose cell does not hold the target');

  srv = await startTestServer({ env: { VB_GRAMMAR_DIR: grammarDir } });
  c = new Client(srv.url);
  await c.setup();
  const up = await c.post('/api/import/upload?lang=uk&kind=vocabulary&filename=uk.json', Buffer.from(JSON.stringify(ukDoc)), { 'Content-Type': 'application/octet-stream' });
  assert.equal(up.status, 200, JSON.stringify(up.body));
  const commit = await c.post(`/api/import/${up.body.id}/commit`, { mapping: {}, options: {} });
  assert.equal(commit.status, 200, JSON.stringify(commit.body));
  for (const e of ukDoc.entries) ids[e.lemma] = srv.app.db.get<{ id: number }>("SELECT id FROM vocabulary_entries WHERE language_code = 'uk' AND lemma = ?", e.lemma)!.id;
});
after(async () => {
  await srv.cleanup();
  rmSync(dir, { recursive: true, force: true });
});

test('the server looks a sentence up by its normalised key, from VB_GRAMMAR_DIR', () => {
  assert.equal(srv.config.grammarDir, grammarDir);
  assert.equal(loadGrammar(srv.app, 'uk')?.cells.size, 1);
  assert.deepEqual(exactCellFor(srv.app, 'uk', 'украї́нський', 'Українське', ' у нього  українське громадянство! '), { cell: 'nom|n', why: WHY });
  assert.equal(exactCellFor(srv.app, 'uk', 'робота', 'роботи', 'Я повернувся з роботи.'), null, 'dropped by the build');
  assert.equal(loadGrammar(srv.app, 'ru'), null, 'no file for Russian: no annotations');
});

test('a Ukrainian session’s cloze exercises carry the exact cell of the annotated sentence, and its explanation names that cell alone', async () => {
  const s = await startSession(c, { language: 'uk', minutes: 30, newWords: 3 });
  const items = Object.values(s.items) as any[];
  const word = items.find((i) => i.entryId === ids['український']);
  assert.ok(word, 'український is in the session');
  // Every sentence exercise of the word: the planned ones and the follow-up variants the device and server pick from.
  const planned = s.exercises.filter((x: any) => x.itemId === word.itemId && (x.kind === 'cloze_choice' || x.kind === 'cloze_typed'));
  assert.ok(planned.some((x: any) => x.kind === 'cloze_choice'), 'stage D asks for the form in the sentence');
  for (const p of [...planned.map((x: any) => x.payload), word.variants.cloze_choice, word.variants.cloze_typed]) {
    assert.equal(p.before + 'українське' + p.after, OWNER);
    assert.deepEqual(p.exact, { cell: 'nom|n', why: WHY });
  }
  // The hint names the sentence's own form, not every cell that holds it.
  assert.deepEqual(word.variants.cloze_typed.tags, ['nominative neuter']);
  // What the feedback shows (Exercise.tsx → answerInTable → explainForm, with the item's table).
  const choice = planned.find((x: any) => x.kind === 'cloze_choice').payload;
  const answer = choice.options.find((o: any) => o.id === choice.correctId).text;
  const e = explainForm({ language: 'uk', paradigm: word.paradigm, lemma: word.lemma, form: answer, before: choice.before, after: choice.after, exact: choice.exact })!;
  assert.equal(e.text, `“українське” is the nominative neuter of “український”: ${WHY}`);
  assert.deepEqual(e.cells, ['nom|n']);
  // Sentences without an annotation carry none.
  for (const lemma of ['школа', 'робота']) {
    const other = items.find((i) => i.entryId === ids[lemma]);
    assert.ok(other, `${lemma} is in the session`);
    for (const kind of ['cloze_choice', 'cloze_typed']) assert.equal('exact' in other.variants[kind], false, `${lemma} ${kind}`);
  }
  await c.post(`/api/sessions/${s.id}/complete`);
});

test('the sentence-gap practice carries it too, also for a session’s round, with the form the gap needs', async () => {
  const b = await c.post('/api/practice/cloze/batch', { language: 'uk', scope: 'entry', entryId: ids['український'], size: 5, choices: true });
  assert.equal(b.status, 200, JSON.stringify(b.body));
  const [item] = b.body.items;
  assert.equal(item.target, 'українське');
  assert.deepEqual(item.exact, { cell: 'nom|n', why: WHY });
  assert.equal(item.needed, 'nominative neuter', 'without the annotation the table would leave it open (nominative or accusative)');
  const round = await c.post('/api/practice/cloze/batch', { language: 'uk', scope: 'entries', entryIds: [ids['український'], ids['школа']], size: 3 });
  const byTarget = Object.fromEntries(round.body.items.map((i: any) => [i.target, i]));
  assert.deepEqual(byTarget['українське'].exact, { cell: 'nom|n', why: WHY });
  assert.equal('exact' in byTarget['школу'], false);
  assert.equal(byTarget['школу'].needed, 'accusative singular');
  // What ClozePractice shows, with the table the page fetches for the word.
  const paradigm = (await c.get(`/api/vocab/${ids['український']}`)).body.paradigm;
  const e = explainForm({ language: 'uk', paradigm, lemma: item.lemma, form: item.target, before: item.before, after: item.after, exact: item.exact })!;
  assert.equal(e.text, `“українське” is the nominative neuter of “український”: ${WHY}`);
});

test('a cell the word’s table does not confirm is not sent; the file is re-read when it changes; a missing or broken file means none', async () => {
  const batch = async (lemma: string) => (await c.post('/api/practice/cloze/batch', { language: 'uk', scope: 'entry', entryId: ids[lemma], size: 5 })).body.items[0];
  writeFileSync(
    grammarFile(),
    languageFile(
      'uk',
      new Map([
        [exactKey('uk', 'український', 'українське', OWNER), ['acc|n', 'a different reason, to see the file read again.']],
        // Written without the build's checks, as a file built against another version of the set might be.
        [exactKey('uk', 'робота', 'роботи', 'Я повернувся з роботи.'), ['nom|sg', 'a cell that does not hold роботи.']],
      ]),
    ),
  );
  assert.deepEqual((await batch('український')).exact, { cell: 'acc|n', why: 'a different reason, to see the file read again.' });
  const work = await batch('робота');
  assert.equal('exact' in work, false, 'nom|sg holds робота, not роботи');
  assert.equal(work.needed, null);
  const s = await startSession(c, { language: 'uk', minutes: 30, newWords: 3 });
  const sessionItems = Object.values(s.items) as any[];
  const workItem = sessionItems.find((i) => i.entryId === ids['робота']);
  assert.ok(workItem, 'робота is in the new session');
  assert.equal('exact' in workItem.variants.cloze_typed, false);
  assert.equal(sessionItems.find((i) => i.entryId === ids['український']).variants.cloze_typed.exact.cell, 'acc|n', 'sessions read the new file too');
  await c.post(`/api/sessions/${s.id}/complete`);

  rmSync(grammarFile());
  const none = await batch('український');
  assert.equal('exact' in none, false);
  assert.equal(none.needed, null, 'the table alone leaves it open');
  writeFileSync(grammarFile(), '{"format":"vocabbuilder-grammar-v1","cells":{');
  const broken = await c.post('/api/practice/cloze/batch', { language: 'uk', scope: 'entry', entryId: ids['український'], size: 5 });
  assert.equal(broken.status, 200, 'a broken file does not break practice');
  assert.equal('exact' in broken.body.items[0], false);
});
