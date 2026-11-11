// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Gender and number tables for Spanish and Portuguese words (1.8.5) and the clean-up of every language's forms lists:
// the rules that sort the dictionary's unlabeled forms into cells, our own tables, what is left out, and how the
// tables are laid out, named, drilled and explained.
import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error plain JavaScript build script
import { attachNominalTables, cleanForms, romanceNominalParadigm } from '../../scripts/freq/paradigms/romance-nominal.mjs';
import { cellLabel, drillCells, drillGroups, inflectionSummary, paradigmTable, tableTitle, type Paradigm } from '../../shared/paradigms.ts';
import { explainForm } from '../../shared/grammar.ts';

const entry = (lemma: string, pos: string, forms: string[]) => ({ lemma, pos, forms: forms.map((form) => ({ form, display: null, tags: [] })), paradigm: null as Paradigm | null });
const cells = (lang: string, lemma: string, pos: string, forms: string[]) => romanceNominalParadigm(lang, entry(lemma, pos, forms))?.cells ?? null;

test('Portuguese: possessives and bom from our own tables, regular words by the spelling rules', () => {
  assert.deepEqual(cells('pt', 'seu', 'pronoun', ['sua', 'seus', 'suas']), { 'sg|m': ['seu'], 'sg|f': ['sua'], 'pl|m': ['seus'], 'pl|f': ['suas'] });
  assert.deepEqual(cells('pt', 'meu', 'determiner', ['minha', 'meus', 'minhas']), { 'sg|m': ['meu'], 'sg|f': ['minha'], 'pl|m': ['meus'], 'pl|f': ['minhas'] });
  assert.deepEqual(cells('pt', 'bom', 'adjective', ['boa', 'boas', 'bons', 'óptimo', 'bonzinho']), { 'sg|m': ['bom'], 'sg|f': ['boa'], 'pl|m': ['bons'], 'pl|f': ['boas'] });
  assert.deepEqual(cells('pt', 'novo', 'adjective', ['nova', 'novos', 'novas', 'novinho', 'novíssimo']), { 'sg|m': ['novo'], 'sg|f': ['nova'], 'pl|m': ['novos'], 'pl|f': ['novas'] });
  assert.deepEqual(cells('pt', 'casa', 'noun', ['casas', 'casinha']), { 'sg|-': ['casa'], 'pl|-': ['casas'] }, 'diminutives are not forms');
  assert.deepEqual(cells('pt', 'alemão', 'adjective', ['alemã', 'alemães', 'alemãs']), { 'sg|m': ['alemão'], 'sg|f': ['alemã'], 'pl|m': ['alemães'], 'pl|f': ['alemãs'] });
  assert.deepEqual(cells('pt', 'papel', 'noun', ['papéis']), { 'sg|-': ['papel'], 'pl|-': ['papéis'] });
  assert.deepEqual(cells('pt', 'animal', 'noun', ['animais']), { 'sg|-': ['animal'], 'pl|-': ['animais'] });
  assert.deepEqual(cells('pt', 'homem', 'noun', ['homens']), { 'sg|-': ['homem'], 'pl|-': ['homens'] });
  assert.deepEqual(cells('pt', 'senhor', 'noun', ['senhores', 'senhorita', 'senhoras', 'senhora', 'sr', 'sô']), { 'sg|m': ['senhor'], 'pl|m': ['senhores'], 'pl|f': ['senhoras'], 'sg|f': ['senhora'] });
  assert.deepEqual(cells('pt', 'ambos', 'pronoun', ['ambas']), { 'pl|m': ['ambos'], 'pl|f': ['ambas'] }, 'a word whose dictionary form is plural');
  assert.ok(cells('pt', 'este', 'determiner', ['esta', 'estes', 'estas'])!['neut|-'], 'the demonstratives have their neuter (isto)');
});

test('Spanish: accents that move, the short form before a noun, and words filed under another part of speech', () => {
  assert.deepEqual(cells('es', 'inglés', 'adjective', ['inglesa', 'ingleses', 'inglesas']), { 'sg|m': ['inglés'], 'sg|f': ['inglesa'], 'pl|m': ['ingleses'], 'pl|f': ['inglesas'] });
  assert.deepEqual(cells('es', 'canción', 'noun', ['canciones']), { 'sg|-': ['canción'], 'pl|-': ['canciones'] });
  assert.deepEqual(cells('es', 'joven', 'noun', ['jóvenes']), { 'sg|-': ['joven'], 'pl|-': ['jóvenes'] });
  assert.deepEqual(cells('es', 'luz', 'noun', ['luces']), { 'sg|-': ['luz'], 'pl|-': ['luces'] });
  assert.deepEqual(cells('es', 'su', 'determiner', ['sus']), { 'sg|-': ['su'], 'pl|-': ['sus'] });
  assert.deepEqual(cells('es', 'grande', 'adjective', ['gran', 'grandes']), { 'sg|-': ['grande'], 'apoc|-': ['gran'], 'pl|-': ['grandes'] });
  assert.deepEqual(cells('es', 'bueno', 'interjection', ['buena', 'buen', 'buenas', 'buenos']), { 'sg|m': ['bueno'], 'sg|f': ['buena'], 'apoc|m': ['buen'], 'pl|f': ['buenas'], 'pl|m': ['buenos'] }, 'bueno is filed as an interjection but has its forms');
  assert.deepEqual(cells('es', 'el', 'determiner', ['la', 'los', 'las']), { 'sg|m': ['el'], 'sg|f': ['la'], 'pl|m': ['los'], 'pl|f': ['las'], 'neut|-': ['lo'] });
  assert.equal(cells('es', 'contra', 'preposition', ['contras']), null, 'a preposition gets a table only when its forms have a feminine');
  assert.ok(cells('es', 'bajo', 'preposition', ['baja', 'bajos', 'bajas']), 'bajo is also the adjective "low"');
  assert.equal(cells('es', 'perro', 'noun', ['perros', 'perra', 'perras'])!['sg|f'], undefined, 'a feminine that is also crude slang is left out');
  assert.equal(cells('es', 'cuatro', 'numeral', ['cuatros']), null);
});

test('forms lists: misspelt copies, function words and adverbs; Polish pairs that differ only by ą are both kept', () => {
  const ru = entry('на', 'preposition', ['нахуй', 'нах']);
  cleanForms('ru', ru);
  assert.deepEqual(ru.forms, [], 'nothing under на is a form of it');
  const vo = entry('в', 'preposition', ['во']);
  cleanForms('ru', vo);
  assert.deepEqual(vo.forms.map((f) => f.form), ['во'], 'во is the form before some consonant clusters');
  const chto = entry('что', 'conjunction', ['чего', 'чем', 'чему', 'че']);
  cleanForms('ru', chto);
  assert.deepEqual(chto.forms.map((f) => f.form), ['чего', 'чем', 'чему']);
  const good = entry('хорошо', 'adverb', ['лучше', 'получше', 'хорошенько']);
  cleanForms('ru', good);
  assert.deepEqual(good.forms.map((f) => f.form), ['лучше', 'получше'], 'comparatives stay');
  const knife = entry('ніж', 'conjunction', ['ножем', 'ножі']);
  cleanForms('uk', knife);
  assert.deepEqual(knife.forms, [], 'the noun ніж (knife) has its own entry');
  const juz = entry('już', 'adverb', ['juz']);
  cleanForms('pl', juz, { formsOf: () => new Set(['już']) });
  assert.deepEqual(juz.forms, []);
  const big = entry('duży', 'adjective', ['największa', 'największą', 'najwieksza']);
  cleanForms('pl', big, { formsOf: () => new Set(['duży', 'największa', 'największą']) });
  assert.deepEqual(big.forms.map((f) => f.form), ['największa', 'największą'], 'the dictionary has both');
  const dia = entry('día', 'noun', ['días', 'dia', 'dias']);
  cleanForms('es', dia);
  assert.deepEqual(dia.forms.map((f) => f.form), ['días']);
  const pairs = entry('algo', 'pronoun', ['esta', 'ésta']);
  cleanForms('es', pairs);
  assert.deepEqual(pairs.forms.map((f) => f.form), ['esta', 'ésta'], 'esta is a word of its own, not a misspelt ésta');
});

test('attaching: misspelt copies never reach a table, and the forms list becomes the table forms', () => {
  const entries = [entry('alguno', 'determiner', ['alguna', 'algún', 'algunos', 'algunas', 'algun']), entry('niño', 'noun', ['niños', 'ninos', 'niña', 'niñas'])];
  const stats = attachNominalTables('es', entries);
  assert.equal(stats.tables, 2);
  assert.deepEqual(entries[0].paradigm!.cells['apoc|m'], ['algún']);
  assert.deepEqual(entries[1].paradigm!.cells, { 'sg|m': ['niño'], 'sg|f': ['niña'], 'pl|m': ['niños'], 'pl|f': ['niñas'] });
  assert.deepEqual(entries[1].forms.map((f) => f.form), ['niña', 'niños', 'niñas']);
  assert.ok(stats.droppedBy.accents >= 2);
});

const seu: Paradigm = { kind: 'pronoun', cells: { 'sg|m': ['seu'], 'sg|f': ['sua'], 'pl|m': ['seus'], 'pl|f': ['suas'] } };
const el: Paradigm = { kind: 'pronoun', cells: { 'sg|m': ['el'], 'sg|f': ['la'], 'pl|m': ['los'], 'pl|f': ['las'], 'neut|-': ['lo'] } };
const grande: Paradigm = { kind: 'adjective', cells: { 'sg|-': ['grande'], 'apoc|-': ['gran'], 'pl|-': ['grandes'] } };
const casa: Paradigm = { kind: 'noun', cells: { 'sg|-': ['casa'], 'pl|-': ['casas'] } };
const yo: Paradigm = { kind: 'pronoun', cells: { 'subj|-': ['yo'], 'obj|-': ['me'], 'prep|-': ['mí'], 'com|-': ['conmigo'] } };

test('layout and names: singular and plural down the side, masculine and feminine across, the neuter apart', () => {
  const s = paradigmTable('pt', seu);
  assert.deepEqual(s.map((x) => x.id), ['gender']);
  assert.deepEqual(s[0].columns.map((c) => c.label), ['Masculine', 'Feminine']);
  assert.deepEqual(s[0].rows.map((r) => [r.label, r.cells.map((c) => c?.forms.join())]), [['singular', ['seu', 'sua']], ['plural', ['seus', 'suas']]]);
  assert.deepEqual(paradigmTable('es', el).map((x) => x.id), ['gender', 'neuter']);
  const g = paradigmTable('es', grande)[0];
  assert.equal(g.subtitle, 'the same for masculine and feminine');
  assert.deepEqual(g.rows.map((r) => r.label), ['singular', 'plural', 'before a noun']);
  assert.equal(paradigmTable('pt', casa)[0].subtitle, undefined, 'a noun has one gender: nothing to say');
  assert.deepEqual(paradigmTable('es', yo)[0].rows.map((r) => r.label), ['subject', 'object (me, you)', 'after a preposition', 'with con']);
  assert.deepEqual([tableTitle(seu), tableTitle(casa), tableTitle(yo)], ['Gender and number', 'Singular and plural', 'Forms']);
  assert.deepEqual(['sg|f', 'pl|m', 'pl|-', 'apoc|m', 'apoc|-', 'neut|-'].map((c) => cellLabel('es', c)), ['feminine singular', 'masculine plural', 'plural', 'short form before a masculine noun', 'short form before a noun', 'neuter']);
  assert.deepEqual(inflectionSummary('pt', seu)!.rows.map((r) => r.label), ['masculine singular', 'feminine singular', 'masculine plural', 'feminine plural']);
});

test('forms practice drills gender and number: every cell but the dictionary form, with or without the persons', () => {
  const gn = drillGroups('pt').tenses.find((g) => g.id === 'gn')!;
  assert.equal(gn.kind, 'case');
  assert.equal(gn.defaultOn, true);
  assert.deepEqual(drillCells('pt', seu), ['sg|f', 'pl|m', 'pl|f']);
  assert.deepEqual(drillCells('pt', seu, { tenses: ['ind.pres'], persons: null }), [], 'only when the group is chosen');
  assert.deepEqual(drillCells('es', seu, { tenses: ['gn'], persons: ['1s'] }), ['sg|f', 'pl|m', 'pl|f'], 'persons are for verbs');
  assert.deepEqual(drillCells('es', yo), [], 'yo and tú are not drilled');
});

test('explanations name the gender and number, and why an adjective or determiner takes it', () => {
  assert.equal(explainForm({ language: 'pt', paradigm: seu, lemma: 'seu', form: 'sua' })!.text, '“sua” is the feminine singular of “seu”. It agrees with the noun it goes with.');
  assert.equal(explainForm({ language: 'pt', paradigm: casa, lemma: 'casa', form: 'casas' })!.text, '“casas” is the plural of “casa”.');
  assert.match(explainForm({ language: 'es', paradigm: { kind: 'adjective', cells: { 'sg|m': ['bueno'], 'apoc|m': ['buen'] } }, lemma: 'bueno', form: 'buen' })!.text, /short form before a masculine noun of “bueno”\. Used right before a masculine singular noun/);
  assert.equal(explainForm({ language: 'pt', paradigm: seu, lemma: 'seu', form: 'seu' }), null, 'the dictionary form needs no note');
});
