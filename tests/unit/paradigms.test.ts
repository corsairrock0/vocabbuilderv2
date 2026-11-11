// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Inflection tables: the build-time readers and rules (scripts/freq/paradigms/) and the shared layout,
// labels and drill choices (shared/paradigms.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { cellLabel, drillCells, drillGroups, formsSpec, inflectionSummary, paradigmForms, paradigmTable, sanitizeParadigm, type Paradigm } from '../../shared/paradigms.ts';
import { checkAnswer } from '../../shared/answer.ts';
import { vietnameseSpellingKey } from '../../shared/text.ts';

// The build scripts are plain JavaScript modules, loaded the way tests/unit/frequency-build.test.ts loads them.
const ROOT = path.resolve(import.meta.dirname, '../..');
const load = async (rel: string): Promise<any> => import(pathToFileURL(path.join(ROOT, rel)).href);
const { brazilianSpelling, choosePortuguese, personalInfinitive, portugueseImperatives, portugueseParticiples, readVerbecc, regularParticiple, unimorphCells, verbTable, vosFrom } =
  await load('scripts/freq/paradigms/romance.mjs');
const { fromAttestations, polishFromMorfologik, pruneVariants, russianFromOpenRussian, ukrainianFromDmklinger } = await load('scripts/freq/paradigms/nominal.mjs');

test('voseo comes from the vosotros forms', () => {
  assert.equal(vosFrom('habláis', 'ind.pres'), 'hablás');
  assert.equal(vosFrom('coméis', 'ind.pres'), 'comés');
  assert.equal(vosFrom('vivís', 'ind.pres'), 'vivís');
  assert.equal(vosFrom('sois', 'ind.pres'), 'sos');
  assert.equal(vosFrom('tengáis', 'sbjv.pres'), 'tengás');
  assert.equal(vosFrom('hablad', 'imp.aff'), 'hablá');
  assert.equal(vosFrom('tened', 'imp.aff'), 'tené');
  assert.equal(vosFrom('oíd', 'imp.aff'), 'oí');
  assert.equal(vosFrom('dad', 'imp.aff'), 'da');
  assert.equal(vosFrom('sed', 'imp.aff'), 'sé');
  assert.equal(vosFrom('no habléis', 'imp.neg'), 'no hablés');
});

test('Brazilian spelling, personal infinitives, participles and imperatives', () => {
  assert.equal(brazilianSpelling('falámos', 'ind.pret|1p'), 'falamos');
  assert.equal(brazilianSpelling('falámos', 'ind.plup|1p'), 'falámos', 'only the preterite loses the accent');
  assert.equal(brazilianSpelling('apóie', 'sbjv.pres|1s'), 'apoie');
  assert.equal(brazilianSpelling('dói', 'ind.pres|3s'), 'dói', 'oxytones keep the accent');
  assert.equal(brazilianSpelling('vôo', 'ind.pres|1s'), 'voo');
  assert.equal(brazilianSpelling('crêem', 'ind.pres|3p'), 'creem');
  assert.equal(brazilianSpelling('agüentar', 'nfin|inf'), 'aguentar');
  assert.deepEqual(personalInfinitive('pôr'), { '1s': 'pôr', '2s': 'pores', '3s': 'pôr', '1p': 'pormos', '2p': 'pordes', '3p': 'porem' });
  assert.equal(personalInfinitive('sair')['2s'], 'saíres');
  assert.equal(regularParticiple('construir', 'pt'), 'construído');
  assert.equal(regularParticiple('seguir', 'pt'), 'seguido');
  assert.equal(regularParticiple('leer', 'es'), 'leído');
  assert.equal(regularParticiple('huir', 'es'), 'huido');
  assert.deepEqual(portugueseParticiples('abrir', ['abrido', 'aberto']), ['aberto'], 'a strong verb takes its irregular participle');
  assert.deepEqual(portugueseParticiples('matar', ['morto']), ['matado', 'morto'], 'abundant verbs list the regular one first');
  assert.deepEqual(portugueseParticiples('resolver', ['resolvo']), ['resolvido'], 'resolver is not ver');
  const imp = portugueseImperatives({ 'ind.pres|2s': ['tens'], 'ind.pres|2p': ['tendes'], 'sbjv.pres|3s': ['tenha'], 'sbjv.pres|1p': ['tenhamos'], 'sbjv.pres|3p': ['tenham'], 'sbjv.pres|2s': ['tenhas'], 'sbjv.pres|2p': ['tenhais'] }, 'ter');
  assert.deepEqual(imp['imp.aff|2s'], ['tem']);
  assert.deepEqual(imp['imp.aff|2p'], ['tende']);
  assert.deepEqual(imp['imp.neg|2s'], ['não tenhas']);
  assert.deepEqual(portugueseImperatives({ 'ind.pres|2s': ['dizes'] }, 'dizer')['imp.aff|2s'], ['diz', 'dize']);
  assert.deepEqual(portugueseImperatives({}, 'ser')['imp.aff|2s'], ['sê']);
});

test('choosing between the two Portuguese sources cell by cell', () => {
  assert.deepEqual(choosePortuguese('ind.pres|1p', ['vamosimos'], ['imos'], 'ir'), [['vamos', 'imos'], 'split concatenation']);
  assert.deepEqual(choosePortuguese('ind.fut|2s', ['estareis'], ['estarás'], 'estar'), [['estarás'], 'ending']);
  assert.deepEqual(choosePortuguese('ind.impf|2s', ['destruias'], ['destruías'], 'destruir'), [['destruías'], 'accents']);
  assert.deepEqual(choosePortuguese('ind.pres|2s', ['dóis'], ['doís'], 'doer'), [['dóis'], 'accents'], '-oer verbs: UniMorph has the accents right');
  assert.deepEqual(choosePortuguese('ind.pres|3s', ['destrói'], ['destrui'], 'destruir'), [['destrói'], 'unimorph preferred']);
  assert.deepEqual(choosePortuguese('ind.pres|1s', ['falo'], ['falo'], 'falar')[1], 'agree');
});

test('UniMorph rows: clitic bundles skipped, tú before vos, usted in the imperative', () => {
  const f = (s: string) => new Set(s.split(';'));
  const cells = unimorphCells(
    [
      ['hablas', f('V;IND;PRS;2;SG;INFM')],
      ['hablás', f('V;IND;PRS;2;SG;INFM')],
      ['habla', f('V;IND;PRS;2;SG;FORM')],
      ['habla', f('V;IND;PRS;3;SG')],
      ['hable', f('V;POS;IMP;2;SG;FORM')],
      ['háblame', f('V;IMP;INFM;2;SG;DAT;PRO;1;SG')],
      ['hablado', f('V;V.PTCP;PST;MASC;SG')],
    ],
    'es',
  );
  assert.deepEqual(cells['ind.pres|2s'], ['hablas']);
  assert.deepEqual(cells['ind.pres|2s.vos'], ['hablás']);
  assert.deepEqual(cells['ind.pres|3s'], ['habla']);
  assert.deepEqual(cells['imp.aff|3s'], ['hable']);
  assert.equal(Object.values(cells).flat().includes('háblame'), false);
});

test('verbecc templates: stem + endings, compound tenses, and fixes for its known slips', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'verbecc-'));
  const p = (xs: string[]) => xs.map((x) => `<p><i>${x}</i></p>`).join('');
  writeFileSync(
    path.join(dir, 'c.xml'),
    `<conjugation-es><template name="t:ener"><Indicativo><presente>${p(['engo', 'ienes', 'iene', 'enemos', 'enéis', 'ienen'])}</presente><pretérito-imperfecto>${p(['enía', 'enías', 'enía', 'eníamos', 'eníais', 'enían'])}</pretérito-imperfecto><pretérito-perfecto-simple>${p(['uve', 'uviste', 'uvo', 'uvimos', 'uvisteis', 'uvieron'])}</pretérito-perfecto-simple><futuro>${p(['endré', 'endrás', 'endrá', 'endremos', 'endréis', 'endrán'])}</futuro></Indicativo><Subjuntivo><presente>${p(['enga', 'engas', 'enga', 'engamos', 'engáis', 'engan'])}</presente><pretérito-imperfecto-1>${p(['uviera', 'uvieras', 'uviera', 'uviéramos', 'uvierais', 'uvieran'])}</pretérito-imperfecto-1><pretérito-imperfecto-2>${p(['uviese', 'uvieses', 'uviese', 'uviésemos', 'uvieseis', 'uviesen'])}</pretérito-imperfecto-2><futuro>${p(['uviere', 'uvieres', 'uviere', 'uviéremos', 'uviereis', 'uvieren'])}</futuro></Subjuntivo><Imperativo><afirmativo>${p(['en', 'enga', 'engamos', 'ened', 'engan'])}</afirmativo><negativo>${p(['engas', 'enga', 'engamos', 'engáis', 'engan'])}</negativo></Imperativo><Condicional><presente>${p(['endría', 'endrías', 'endría', 'endríamos', 'endríais', 'endrían'])}</presente></Condicional><Infinitivo><infinitivo>${p(['ener'])}</infinitivo></Infinitivo><Gerundio><gerundio>${p(['eniendo'])}</gerundio></Gerundio><Participo><participo>${p(['enido'])}</participo></Participo></template></conjugation-es>`,
  );
  writeFileSync(path.join(dir, 'v.xml'), '<verbs-es><v><i>tener</i><t>t:ener</t></v><v><i>obtener</i><t>t:ener</t></v></verbs-es>');
  const vc = readVerbecc(path.join(dir, 'c.xml'), path.join(dir, 'v.xml'), 'es');
  const t = verbTable('es', 'tener', null, vc.conjugate('tener'))!;
  assert.equal(t.source, 'verbecc');
  assert.deepEqual(t.cells['ind.pret|1s'], ['tuve']);
  assert.deepEqual(t.cells['sbjv.impf|1s'], ['tuviera', 'tuviese']);
  assert.deepEqual(t.cells['imp.neg|2s'], ['no tengas']);
  assert.deepEqual(t.cells['ind.pres|2s.vos'], ['tenés']);
  assert.deepEqual(t.cells['imp.aff|2s.vos'], ['tené']);
  assert.deepEqual(t.cells['c.ind.perf|1s'], ['he tenido']);
  assert.deepEqual(t.cells['c.sbjv.plup|3p'], ['hubieran tenido', 'hubiesen tenido']);
  assert.deepEqual(t.cells['part|f.pl'], ['tenidas']);
  assert.deepEqual(verbTable('es', 'obtener', null, vc.conjugate('obtener'))!.cells['imp.aff|2s'], ['obtén'], 'compounds stress the last syllable');
});

test('Russian: OpenRussian rows, the animate accusative, and indeclinable nouns', () => {
  const adj = russianFromOpenRussian({ lemma: 'хороший', pos: 'adjective' }, [
    { kind: 'adjectives', row: { decl_m_nom: "хоро'ший", decl_m_gen: "хоро'шего", decl_m_acc: "хоро'ший, хоро'шего", decl_pl_nom: "хоро'шие", decl_pl_gen: "хоро'ших", decl_pl_acc: "хоро'шие, хоро'ших", decl_f_acc: "хоро'шую", short_m: "хоро'ш", comparative: "лу'чше" } },
  ])!;
  assert.deepEqual(adj.cells['acc.inan|m'], ['хоро́ший']);
  assert.deepEqual(adj.cells['acc.anim|m'], ['хоро́шего']);
  assert.deepEqual(adj.cells['acc|f'], ['хоро́шую']);
  assert.deepEqual(adj.cells['short|m'], ['хоро́ш']);
  const tot = russianFromOpenRussian({ lemma: 'тот', pos: 'pronoun' }, [{ kind: 'adjectives', row: { decl_m_nom: "то'т", decl_f_nom: "та'", decl_pl_inst: "те'ми" } }])!;
  assert.deepEqual([tot.cells['nom|m'], tot.cells['nom|f'], tot.cells['ins|pl']], [['тот'], ['та'], ['те́ми']], 'one-vowel forms lose the stress mark');
  assert.deepEqual(adj.cells['comp|-'], ['лу́чше']);
  const kofe = russianFromOpenRussian({ lemma: 'кофе', pos: 'noun' }, [{ kind: 'nouns', row: { indeclinable: '1' } }])!;
  assert.equal(kofe.indeclinable, true);
});

test('treebank attestations give pronoun tables, with ё restored from known spellings', () => {
  const a = (form: string, feats: string, n = 5) => ({ form, upos: 'PRON', feats: Object.fromEntries(feats.split('|').map((x) => x.split('='))), n });
  const p = fromAttestations({ lemma: 'она', pos: 'pronoun' }, [a('она', 'Case=Nom|Gender=Fem|Number=Sing'), a('ее', 'Case=Gen|Gender=Fem|Number=Sing'), a('нее', 'Case=Gen|Gender=Fem|Number=Sing', 3), a('ей', 'Case=Dat|Gender=Fem|Number=Sing'), a('еи', 'Case=Dat|Gender=Fem|Number=Sing', 1)], 'ru', 'SynTagRus annotations', new Map([['ее', 'её'], ['нее', 'неё']]))!;
  assert.deepEqual(p.cells['nom|-'], ['она'], 'a single gender means a case-only table');
  assert.deepEqual(p.cells['gen|-'], ['её', 'неё']);
  assert.deepEqual(p.cells['dat|-'], ['ей'], 'a one-off annotation slip is dropped');
});

test('Ukrainian dmklinger tables pick the layout from the forms they have', () => {
  const dva = ukrainianFromDmklinger({ lemma: 'два', pos: 'numeral' }, [{ pos: 'numeral', forms: { 'nom am': ['два'], 'nom af': ['дві'], 'gen ap': ['двох'], 'nom ns': ['два'] } }])!;
  assert.deepEqual(Object.keys(dva.cells).sort(), ['gen|pl', 'nom|f', 'nom|m']);
  const xto = ukrainianFromDmklinger({ lemma: 'хто', pos: 'pronoun' }, [{ pos: 'pronoun', forms: { 'nom ns': ['хто'], 'gen ns': ['кого́'] } }])!;
  assert.deepEqual(xto.cells['gen|-'], ['кого́'], 'a pronoun without genders has one case column');
});

test('Polish Morfologik tags: homonyms, the masculine accusative, numerals and pruning', () => {
  const rows: Array<[string, string]> = [
    ['dzień', 'subst:sg:nom.acc:m3'],
    ['dnia', 'subst:sg:gen:m3'],
    ['dni', 'subst:pl:nom.acc.gen:m3'],
    ['dzieni', 'subst:sg:dat:f'],
  ];
  const counts = new Map([['dzień', 900], ['dnia', 500], ['dni', 800], ['dzieni', 1]]);
  const d = polishFromMorfologik({ lemma: 'dzień', pos: 'noun' }, rows, counts)!;
  assert.equal(d.gender, 'm3');
  assert.equal(Object.values(d.cells).flat().includes('dzieni'), false, 'the rare homonym is left out');
  const adj = polishFromMorfologik({ lemma: 'dobry', pos: 'adjective' }, [
    ['dobry', 'adj:sg:acc:m3:pos+adj:sg:nom.voc:m1.m2.m3:pos'],
    ['dobrego', 'adj:sg:acc:m1.m2:pos+adj:sg:gen:m1.m2.m3.n1.n2:pos'],
    ['dobrzy', 'adj:pl:nom.voc:m1.p1:pos'],
    ['dobre', 'adj:pl:nom.voc:m2.m3.f.n1.n2.p2.p3:pos'],
    ['lepszy', 'adj:sg:nom.voc:m1.m2.m3:com'],
  ])!;
  assert.deepEqual(adj.cells['acc.anim|m'], ['dobrego']);
  assert.deepEqual(adj.cells['acc.inan|m'], ['dobry']);
  assert.deepEqual(adj.cells['nom|pl.vir'], ['dobrzy']);
  assert.deepEqual(adj.cells['comp|-'], ['lepszy']);
  const piec = polishFromMorfologik({ lemma: 'pięć', pos: 'numeral' }, [
    ['pięć', 'num:pl:nom.acc:m2.m3.f.n1.n2:congr'],
    ['pięciu', 'num:pl:nom.acc:m1:rec+num:pl:gen.dat.loc:m1.m2.m3.f.n1.n2:congr'],
  ])!;
  assert.equal(Object.keys(piec.cells).some((k) => k.endsWith('|f')), false, 'no feminine column when it repeats the other');
  const cells = pruneVariants({ 'acc|-': ['mnie', 'mię'] }, new Map([['mnie', 50000], ['mię', 3]]), 'pl');
  assert.deepEqual(cells['acc|-'], ['mnie']);
});

const ruNoun: Paradigm = {
  kind: 'noun',
  cells: { 'nom|sg': ['кни́га'], 'nom|pl': ['кни́ги'], 'gen|sg': ['кни́ги'], 'gen|pl': ['книг'], 'acc|sg': ['кни́гу'], 'acc|pl': ['кни́ги'], 'loc|sg': ['кни́ге'] },
};
const ruAdj: Paradigm = {
  kind: 'adjective',
  cells: { 'nom|m': ['мой'], 'nom|n': ['моё'], 'nom|f': ['моя́'], 'nom|pl': ['мои́'], 'acc.inan|m': ['мой'], 'acc.anim|m': ['моего́'], 'acc|n': ['моё'], 'acc|f': ['мою́'], 'acc.inan|pl': ['мои́'], 'acc.anim|pl': ['мои́х'], 'comp|-': ['лу́чше'] },
};

test('labels: Russian prepositional, Ukrainian/Polish locative, animacy, tenses with pronouns', () => {
  assert.equal(cellLabel('ru', 'loc|sg'), 'prepositional singular');
  assert.equal(cellLabel('uk', 'loc|sg'), 'locative singular');
  assert.equal(cellLabel('ru', 'acc.anim|m'), 'accusative masculine (animate)');
  assert.equal(cellLabel('pl', 'nom|pl.vir'), 'nominative plural (masculine personal)');
  assert.equal(cellLabel('es', 'ind.pret|3p'), 'preterite (ellos/ellas/ustedes)');
  assert.equal(cellLabel('es', 'imp.aff|3s'), 'imperative (usted)');
  assert.equal(cellLabel('pt', 'cond|1s'), 'conditional (eu)');
  assert.equal(cellLabel('es', 'part|m.sg'), 'past participle');
});

test('tables: case rows, the accusative pair on two lines, other sections', () => {
  const t = paradigmTable('ru', ruAdj);
  const cases = t.find((s) => s.id === 'cases')!;
  assert.deepEqual(cases.columns.map((c) => c.key), ['m', 'n', 'f', 'pl']);
  const acc = cases.rows.find((r) => r.key === 'acc')!;
  assert.deepEqual(acc.sub!.map((x) => x.cells.map((c) => c?.forms[0] ?? null)), [
    ['мой', 'моё', 'мою́', 'мои́'],
    ['моего́', 'моё', 'мою́', 'мои́х'],
  ]);
  assert.ok(t.some((s) => s.id === 'degrees'));
  const noun = paradigmTable('ru', ruNoun).find((s) => s.id === 'cases')!;
  assert.deepEqual(noun.rows.map((r) => r.key), ['nom', 'gen', 'acc', 'loc']);
  assert.deepEqual(paradigmTable('ru', { kind: 'noun', indeclinable: true, cells: {} }), []);
});

test('forms carry every cell they fill; drills follow the default groups', () => {
  const f = paradigmForms('ru', ruNoun).find((x) => x.form === 'кни́ги')!;
  assert.deepEqual(f.tags, ['nominative plural', 'genitive singular', 'accusative plural']);
  const verb: Paradigm = { kind: 'verb', cells: { 'nfin|inf': ['hablar'], 'nfin|ger': ['hablando'], 'ind.pres|1s': ['hablo'], 'ind.pres|2s.vos': ['hablás'], 'ind.pres|2p': ['habláis'], 'sbjv.fut|1s': ['hablare'], 'imp.neg|2s': ['no hables'] } };
  assert.deepEqual(drillCells('es', verb).sort(), ['imp.neg|2s', 'ind.pres|1s', 'nfin|ger']);
  assert.deepEqual(drillCells('es', verb, { tenses: ['ind.pres'], persons: ['2s.vos', '2p'] }).sort(), ['ind.pres|2p', 'ind.pres|2s.vos']);
  assert.equal(drillGroups('pt').persons.find((g) => g.id === '2s')!.defaultOn, false, 'Brazilian Portuguese drills você, not tu, by default');
  assert.deepEqual(formsSpec('es', verb, 'imp.neg|2s', 'hablar').accepted, ['no hables', 'hables']);
  const sum = inflectionSummary('es', { kind: 'verb', cells: { 'ind.pres|1s': ['hablo'], 'part|m.sg': ['hablado'] } })!;
  assert.deepEqual(sum.rows, [{ label: 'yo', forms: ['hablo'] }, { label: 'past participle', forms: ['hablado'] }]);
});

test('imported tables are checked: unknown kinds and malformed cells are dropped', () => {
  assert.equal(sanitizeParadigm({ kind: 'adverb', cells: { 'nom|sg': ['x'] } }), null);
  assert.equal(sanitizeParadigm({ kind: 'noun', cells: {} }), null);
  const p = sanitizeParadigm({ kind: 'noun', cells: { 'nom|sg': ['дом', 5, ''], 'BAD KEY': ['x'], 'gen|sg': 'дома' } })!;
  assert.deepEqual(p.cells, { 'nom|sg': ['дом'] });
  assert.equal(sanitizeParadigm({ kind: 'noun', indeclinable: true, cells: {} })!.indeclinable, true);
});

test('Vietnamese: both spellings of a word are the same answer', () => {
  assert.equal(vietnameseSpellingKey('công ty'), vietnameseSpellingKey('công ti'));
  assert.equal(vietnameseSpellingKey('hóa học'), vietnameseSpellingKey('hoá học'));
  assert.equal(vietnameseSpellingKey('kỹ thuật'), vietnameseSpellingKey('kĩ thuật'));
  assert.equal(vietnameseSpellingKey('quý'), vietnameseSpellingKey('quí'));
  assert.notEqual(vietnameseSpellingKey('tay'), vietnameseSpellingKey('tai'), 'y after a vowel is not i');
  assert.notEqual(vietnameseSpellingKey('má'), vietnameseSpellingKey('mà'), 'tones still matter');
  const r = checkAnswer('công ti', { lang: 'vi', accepted: ['công ty'] });
  assert.equal(r.grade, 'correct');
});

test('case roles, regional persons and where a form sits in a table', async () => {
  const { caseRole, personNote, cellsForForm } = await import('../../shared/paradigms.ts');
  assert.match(caseRole('uk', 'gen')!, /немає/);
  assert.match(caseRole('ru', 'loc')!, /о/);
  assert.match(caseRole('pl', 'acc.anim')!, /direct object/);
  assert.equal(caseRole('es', 'gen'), null);
  assert.equal(personNote('es', '2p'), 'Spain only');
  assert.equal(personNote('pt', '2p'), 'not used in Brazil');
  assert.equal(personNote('es', '1s'), null);
  const p = { kind: 'noun' as const, cells: { 'nom|sg': ['кни́га'], 'gen|sg': ['кни́ги'], 'nom|pl': ['кни́ги'], 'gen|pl': ['книг'] } };
  assert.deepEqual(cellsForForm(p, 'книги').sort(), ['gen|sg', 'nom|pl']);
  assert.deepEqual(cellsForForm(p, 'КНИГ'), ['gen|pl']);
  assert.deepEqual(cellsForForm(p, 'стол'), []);
  assert.deepEqual(cellsForForm(null, 'книги'), []);
});
