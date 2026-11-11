// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Conjugation tables of Russian, Ukrainian and Polish verbs (1.8.4): the build readers (scripts/freq/paradigms/verbs.mjs),
// the shared layout, labels and drills (shared/paradigms.ts), explanations (shared/grammar.ts) and stats groups.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { cellLabel, drillCells, drillGroups, inflectionSummary, paradigmTable, paradigmTitle, slavicTense, tableTitle, type Paradigm } from '../../shared/paradigms.ts';
import { explainForm } from '../../shared/grammar.ts';
import { formsGroup } from '../../shared/stats.ts';

const ROOT = path.resolve(import.meta.dirname, '../..');
const { dropUndiacritised, polishVerbCell, polishVerbFromMorfologik, russianVerbFromOpenRussian, ukrainianVerbFromDmklinger, verbTableReport } = await import(
  pathToFileURL(path.join(ROOT, 'scripts/freq/paradigms/verbs.mjs')).href
);

test('Polish Morfologik verb tags: tenses, the past by person and gender, imperatives, participles', () => {
  assert.deepEqual(polishVerbCell('verb:fin:sg:pri:imperf:nonrefl'), { cell: 'pres|1s', aspect: 'imperf' });
  assert.deepEqual(polishVerbCell('verb:fin:pl:ter:perf:nonrefl'), { cell: 'fut|3p', aspect: 'perf' }, 'a perfective verb’s present forms are its future');
  assert.deepEqual(polishVerbCell('verb:bedzie:sg:sec:imperf:nonrefl'), { cell: 'fut|2s', aspect: 'imperf' }, 'będziesz');
  assert.equal(polishVerbCell('verb:praet:sg:m1.m2.m3:pri:imperf:nonrefl')!.cell, 'past|1s.m');
  assert.equal(polishVerbCell('verb:praet:sg:f:ter:imperf:nonrefl')!.cell, 'past|3s.f');
  assert.equal(polishVerbCell('verb:praet:sg:n1.n2:ter:imperf:nonrefl')!.cell, 'past|3s.n');
  assert.equal(polishVerbCell('verb:praet:sg:n1.n2:pri:imperf:nonrefl'), null, 'the rare 1st person neuter (byłom) is left out');
  assert.equal(polishVerbCell('verb:praet:pl:m1.p1:pri:imperf:nonrefl')!.cell, 'past|1p.vir');
  assert.equal(polishVerbCell('verb:pot:pl:m2.m3.f.n1.n2.p2.p3:ter:imperf:nonrefl')!.cell, 'cond|3p.nvir');
  assert.equal(polishVerbCell('verb:impt:pl:pri:imperf:nonrefl')!.cell, 'imp|1p');
  assert.equal(polishVerbCell('pcon:imperf:nonrefl')!.cell, 'nfin|adv');
  assert.equal(polishVerbCell('pact:sg:nom.voc:m1.m2.m3:imperf:aff:nonrefl')!.cell, 'part|act');
  assert.equal(polishVerbCell('pact:sg:nom.voc:m1.m2.m3:imperf:neg:nonrefl'), null, 'negated participles (niemający) are left out');
  assert.equal(polishVerbCell('ger:sg:nom.acc:n2:imperf:aff:nonrefl'), null, 'the verbal noun is a word of its own');
  assert.equal(polishVerbCell('subst:sg:nom:m3'), null);
});

test('a Polish table from Morfologik rows: emphatic imperatives dropped, aspect and future noted, diacritic-less forms out', () => {
  const rows: Array<[string, string]> = [
    ['mieć', 'verb:inf:imperf:nonrefl'],
    ['mam', 'verb:fin:sg:pri:imperf:nonrefl'],
    ['ma', 'verb:fin:sg:ter:imperf:nonrefl'],
    ['miałem', 'verb:praet:sg:m1.m2.m3:pri:imperf:nonrefl'],
    ['miałam', 'verb:praet:sg:f:pri:imperf:nonrefl'],
    ['miał', 'verb:praet:sg:m1.m2.m3:ter:imperf:nonrefl'],
    ['miałby', 'verb:pot:sg:m1.m2.m3:ter:imperf:nonrefl'],
    ['miej', 'verb:impt:sg:sec:imperf:nonrefl'],
    ['miejże', 'verb:impt:sg:sec:imperf:nonrefl'],
    ['mając', 'pcon:imperf:nonrefl'],
  ];
  const e: any = { lemma: 'mieć', pos: 'verb', forms: [{ form: 'ma' }, { form: 'miec' }, { form: 'mial' }, { form: 'mające' }] };
  const p = polishVerbFromMorfologik(e, rows);
  assert.equal(p.kind, 'verb');
  assert.deepEqual(p.cells['imp|2s'], ['miej'], 'miejże goes');
  assert.deepEqual(p.cells['past|1s.f'], ['miałam']);
  assert.deepEqual(p.notes, ['imperfective', 'future: będę + infinitive']);
  assert.equal(dropUndiacritised(e, p.cells), 2);
  assert.deepEqual(e.forms.map((f: any) => f.form), ['ma', 'mające'], 'miec and mial were typed without Polish letters; mające is a real form the table lacks');
  assert.deepEqual(polishVerbFromMorfologik({ lemma: 'x', pos: 'verb' }, [['xy', 'verb:inf:imperf:nonrefl']]), null, 'an infinitive alone is no table');
});

test('a Russian table from OpenRussian: present or future by aspect, past by gender, the future of быть', () => {
  const row = (o: Record<string, string>) => ({ bare: '', accented: '', aspect: '', imperative_sg: '', imperative_pl: '', past_m: '', past_f: '', past_n: '', past_pl: '', presfut_sg1: '', presfut_sg2: '', presfut_sg3: '', presfut_pl1: '', presfut_pl2: '', presfut_pl3: '', ...o });
  const say = russianVerbFromOpenRussian(
    { lemma: 'сказать', pos: 'verb', aspect: 'perfective' },
    [row({ bare: 'сказать', accented: "сказа'ть", aspect: 'perfective', presfut_sg1: "скажу'", presfut_sg3: "ска'жет", past_f: "сказа'ла", imperative_sg: "скажи'" })],
  );
  assert.deepEqual(say.cells['fut|1s'], ['скажу́']);
  assert.deepEqual(say.cells['past|f'], ['сказа́ла']);
  assert.equal(say.cells['pres|1s'], undefined, 'a perfective verb has no present');
  assert.deepEqual(say.notes, ['perfective', 'conditional: past + бы']);
  const byt = russianVerbFromOpenRussian({ lemma: 'быть', pos: 'verb' }, [row({ bare: 'быть', accented: 'быть', aspect: 'imperfective', presfut_sg1: 'есть', past_m: "бы'л" })]);
  assert.deepEqual(byt.cells['fut|1s'], ['бу́ду'], 'not есть in every person');
  assert.equal(byt.cells['pres|1s'], undefined);
});

test('a Ukrainian table from dmklinger: one-word future kept, colloquial short forms dropped, мати built in', () => {
  const rows = [
    {
      word: 'писа́ти',
      info: 'imperfective',
      forms: {
        inf: ['писа́ти', 'писа́ть'],
        pres: { '1s': ['пишу́'], '1p': ['пи́шем', 'пи́шемо'], pp: { adv: ['пи́шучи'] } },
        fut: { '1s': ['писа́тиму'] },
        past: { ms: ['писа́в'], fs: ['писа́ла'], pp: { pas: ['пи́саний'], imp: ['пи́сано'], adv: ['писа́вши'] } },
        imp: { '1p': ['пиші́м', 'пиші́мо'], '2s': ['пиши́'] },
      },
    },
  ];
  const p = ukrainianVerbFromDmklinger({ lemma: 'писати', pos: 'verb' }, rows);
  assert.deepEqual(p.cells['nfin|inf'], ['писа́ти']);
  assert.deepEqual(p.cells['pres|1p'], ['пи́шемо']);
  assert.deepEqual(p.cells['imp|1p'], ['пиші́мо']);
  assert.deepEqual(p.cells['fut|1s'], ['писа́тиму']);
  assert.deepEqual(p.cells['part|pass'], ['пи́саний']);
  assert.deepEqual(p.notes, ['imperfective', 'future also: буду + infinitive', 'conditional: past + б or би']);
  const maty = ukrainianVerbFromDmklinger({ lemma: 'мати', pos: 'verb' }, undefined);
  assert.equal(maty.source, 'VocabBuilder');
  assert.deepEqual(maty.cells['pres|3s'], ['ма́є']);
  assert.match(verbTableReport('uk', { wanted: 2, withTable: 1, bySource: { 'dmklinger/ukrainian': 1 }, missing: [{ lemma: 'нема' }], formsDropped: 0 }).join('\n'), /Without a table \(1\): нема\./);
});

const polish: Paradigm = {
  kind: 'verb',
  source: 'test',
  cells: {
    'nfin|inf': ['mieć'], 'nfin|adv': ['mając'], 'pres|1s': ['mam'], 'pres|3s': ['ma'], 'pres|3p': ['mają'],
    'past|1s.m': ['miałem'], 'past|1s.f': ['miałam'], 'past|3s.m': ['miał'], 'past|3s.f': ['miała'], 'past|3s.n': ['miało'], 'past|3p.vir': ['mieli'], 'past|3p.nvir': ['miały'],
    'cond|1s.m': ['miałbym'], 'imp|2s': ['miej'], 'imp|1p': ['miejmy'],
  },
  notes: ['imperfective'],
};
const ukrainian: Paradigm = {
  kind: 'verb',
  source: 'test',
  cells: { 'nfin|inf': ['писа́ти'], 'pres|1s': ['пишу́'], 'pres|2s': ['пи́шеш'], 'pres|3s': ['пи́ше'], 'pres|1p': ['пи́шемо'], 'pres|2p': ['пи́шете'], 'pres|3p': ['пи́шуть'], 'past|m': ['писа́в'], 'past|f': ['писа́ла'], 'past|pl': ['писа́ли'], 'imp|2s': ['пиши́'] },
};

test('Slavic verb tables: forms first, then the tenses with pronouns, the Polish past by gender, then the imperative', () => {
  const pl = paradigmTable('pl', polish);
  assert.deepEqual(pl.map((s) => s.id), ['nonfinite', 'pres', 'past.sg', 'past.pl', 'cond.sg', 'imp']);
  const sg = pl.find((s) => s.id === 'past.sg')!;
  assert.deepEqual(sg.columns.map((c) => c.label), ['Masculine', 'Feminine', 'Neuter']);
  assert.deepEqual(sg.rows.map((r) => [r.label, r.cells.map((c) => c?.forms[0] ?? null)]), [['ja', ['miałem', 'miałam', null]], ['on, ona, ono', ['miał', 'miała', 'miało']]]);
  const uk = paradigmTable('uk', ukrainian);
  assert.deepEqual(uk.find((s) => s.id === 'past')!.rows.map((r) => r.label), ['він', 'вона', 'вони']);
  const ru = paradigmTable('ru', { kind: 'verb', cells: { 'fut|1s': ['скажу́'], 'past|m': ['сказа́л'] } });
  assert.equal(ru.find((s) => s.id === 'fut')!.subtitle, 'a perfective verb has no present tense');
  assert.equal(tableTitle(polish), 'Conjugation');
  assert.equal(tableTitle({ kind: 'noun', cells: { 'nom|sg': ['dom'] } }), 'Declension');
  assert.equal(paradigmTitle('pl'), 'Declension and conjugation');
  assert.equal(paradigmTitle('es'), 'Conjugation, gender and number');
});

test('Slavic verb cells are named with their pronoun, drilled by tense and number, and summed up on the new-word card', () => {
  assert.equal(cellLabel('uk', 'pres|1s'), 'present (я)');
  assert.equal(cellLabel('ru', 'past|f'), 'past (она)');
  assert.equal(cellLabel('pl', 'past|1s.f'), 'past (ja, feminine)');
  assert.equal(cellLabel('pl', 'past|3p.vir'), 'past (oni)');
  assert.equal(cellLabel('pl', 'cond|1p.vir'), 'conditional (my, masculine personal)');
  assert.equal(cellLabel('uk', 'imp|2s'), 'imperative (ти)');
  assert.equal(cellLabel('pl', 'nfin|adv'), 'adverbial participle');
  assert.equal(cellLabel('pl', 'gen|pl'), 'genitive plural', 'cases are unchanged');
  assert.deepEqual(slavicTense('uk', 'past'), { label: 'Past', native: 'минулий час' });
  const groups = drillGroups('pl').tenses;
  assert.deepEqual(groups.filter((g) => g.kind === 'tense').map((g) => [g.id, g.defaultOn]), [['v.pres', true], ['v.fut', true], ['v.past', true], ['v.cond', true], ['v.imp', true], ['v.nfin', false]]);
  assert.ok(groups.filter((g) => g.kind === 'case').length >= 7);
  const all = drillCells('pl', polish);
  assert.ok(!all.includes('nfin|inf') && !all.includes('nfin|adv'), 'the infinitive is the prompt; participles are off by default');
  assert.ok(all.includes('past|1s.f') && all.includes('cond|1s.m') && all.includes('imp|1p'));
  assert.deepEqual(drillCells('pl', polish, { tenses: ['v.past'], persons: ['pl'] }).sort(), ['past|3p.nvir', 'past|3p.vir']);
  assert.deepEqual(drillCells('pl', polish, { tenses: ['v.nfin'], persons: ['sg'] }), ['nfin|adv']);
  assert.deepEqual(inflectionSummary('uk', ukrainian)!.rows.map((r) => r.label), ['present (я)', 'present (ти)', 'present (він, вона, воно)', 'present (вони)', 'past (він)', 'past (вона)', 'past (вони)', 'imperative (ти)']);
});

test('a Slavic verb form in an answer is named and explained by its tense', () => {
  assert.equal(
    explainForm({ language: 'uk', paradigm: ukrainian, lemma: 'писати', form: 'писала' })?.text,
    '“писала” is the past (вона) of “писати”. Used for what happened or was happening; it agrees with the subject in gender and number.',
  );
  assert.equal(explainForm({ language: 'pl', paradigm: polish, lemma: 'mieć', form: 'miałam' })?.label, 'past (ja, feminine)');
  const be: Paradigm = { kind: 'verb', cells: Object.fromEntries(['1s', '2s', '3s', '1p', '2p', '3p'].map((p) => [`pres|${p}`, ['є']])) };
  assert.equal(explainForm({ language: 'uk', paradigm: be, lemma: 'бути', form: 'є' })?.label, 'present (every person)');
  assert.equal(explainForm({ language: 'uk', paradigm: ukrainian, lemma: 'писати', form: 'писати' }), null, 'the dictionary form needs no note');
  assert.deepEqual(formsGroup('uk', 'past|f'), { key: 'v.past', label: 'past tense' });
  assert.deepEqual(formsGroup('pl', 'nfin|adv'), { key: 'v.nfin', label: 'participles' });
  assert.deepEqual(formsGroup('pl', 'gen|pl'), { key: 'gen', label: 'genitive' });
});
