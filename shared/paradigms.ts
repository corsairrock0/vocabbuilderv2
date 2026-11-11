// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
/**
 * Inflection tables: declensions (Russian, Ukrainian, Polish) and conjugations (Spanish, Portuguese, and since 1.8.4
 * Russian, Ukrainian and Polish verbs).
 *
 * A paradigm stores its forms in cells keyed "<row>|<column>":
 *   declension  rows nom gen dat acc acc.anim acc.inan ins loc voc short comp sup; columns sg pl m n f pl.vir pl.nvir -
 *   conjugation rows are tenses (ind.pres, sbjv.impf, c.ind.perf …) and nfin/part; columns are persons (1s 2s 2s.vos 3s 1p 2p 3p)
 *   Slavic verbs rows pres fut past cond imp, and nfin (inf adv adv.past imps) / part (act pass); columns are persons
 *               (1s … 3p), past genders (m f n pl) in Russian and Ukrainian, person and gender in the Polish past and
 *               conditional (1s.m 1s.f 2s.m 2s.f 3s.m 3s.f 3s.n 1p.vir 1p.nvir 2p.vir 2p.nvir 3p.vir 3p.nvir)
 *   gender and number (Spanish and Portuguese nouns, adjectives, determiners and pronouns, 1.8.5) rows sg pl, apoc
 *               (the Spanish short form before a noun: buen, algún), neut (esto, isso, lo) and, for yo and tú, subj obj
 *               prep com; columns m f, or - where the forms don't change for gender
 * This module labels the cells, lays them out as tables and chooses which cells a drill asks for.
 * It is shared by the server (grading, form tags) and the web app (tables, practice).
 */
import type { LanguageCode } from './languages.ts';
import type { AnswerSpec } from './answer.ts';
import { canonical, stripStress } from './text.ts';

export type ParadigmKind = 'noun' | 'adjective' | 'pronoun' | 'numeral' | 'verb';

export interface Paradigm {
  kind: ParadigmKind;
  source?: string | null;
  cells: Record<string, string[]>;
  /** Every case has the dictionary form (кофе, кіно). */
  indeclinable?: boolean;
  notes?: string[];
  /** Polish noun gender class from the dictionary (m1 m2 m3 f n1 n2 p1 p2 p3). */
  gender?: string | null;
}

export const DECLENSION_LANGS: readonly LanguageCode[] = ['ru', 'uk', 'pl'];
export const CONJUGATION_LANGS: readonly LanguageCode[] = ['es', 'pt'];

export function hasParadigms(lang: LanguageCode): boolean {
  return DECLENSION_LANGS.includes(lang) || CONJUGATION_LANGS.includes(lang);
}

type SlavicLang = 'ru' | 'uk' | 'pl';
const isSlavic = (lang: LanguageCode): lang is SlavicLang => lang === 'ru' || lang === 'uk' || lang === 'pl';

/**
 * What the practice pages call a language's tables: "Conjugation, gender and number" (es, pt) or "Declension and
 * conjugation" (ru, uk, pl).
 */
export function paradigmTitle(lang: LanguageCode): string {
  return CONJUGATION_LANGS.includes(lang) ? 'Conjugation, gender and number' : 'Declension and conjugation';
}

/** Rows of a Spanish or Portuguese gender and number table (1.8.5). */
const ROMANCE_ROWS = ['sg', 'pl', 'apoc', 'neut', 'subj', 'obj', 'prep', 'com'];
const PRONOUN_ROWS = ['subj', 'obj', 'prep', 'com'];
const rowOf = (cell: string) => cell.split('|')[0];
const colOf = (cell: string) => cell.split('|')[1];

/** A Spanish or Portuguese table of gender and number (or of a pronoun's forms) rather than a conjugation. */
export function isNominalRomance(p: Paradigm | null | undefined): boolean {
  return !!p && p.kind !== 'verb' && Object.keys(p.cells).some((k) => ROMANCE_ROWS.includes(rowOf(k)));
}

/** A Spanish or Portuguese gender and number cell (sua: sg|f). */
export function isRomanceNominalCell(lang: LanguageCode, cell: string): boolean {
  return (lang === 'es' || lang === 'pt') && ROMANCE_ROWS.includes(rowOf(cell));
}

/**
 * What one word's table is called: "Conjugation" for a verb; for Spanish and Portuguese words "Gender and number",
 * "Singular and plural" or "Forms" (yo, tú); "Declension" for the rest.
 */
export function tableTitle(p: Paradigm): string {
  if (p.kind === 'verb') return 'Conjugation';
  if (isNominalRomance(p)) {
    const keys = Object.keys(p.cells);
    if (keys.some((k) => PRONOUN_ROWS.includes(rowOf(k)))) return 'Forms';
    return keys.some((k) => colOf(k) === 'f') ? 'Gender and number' : 'Singular and plural';
  }
  return 'Declension';
}

// ------------------------------------------------------------------ labels

const CASES: Record<string, string> = {
  nom: 'nominative',
  gen: 'genitive',
  dat: 'dative',
  acc: 'accusative',
  ins: 'instrumental',
  loc: 'locative',
  voc: 'vocative',
};
const CASE_ORDER = ['nom', 'gen', 'dat', 'acc', 'ins', 'loc', 'voc'];

/** A case's name in English: "genitive"; Russian calls the locative "prepositional". */
export function caseLabel(lang: LanguageCode, c: string): string {
  if (c === 'loc' && lang === 'ru') return 'prepositional';
  return CASES[c] ?? c;
}

const NOMINAL_COLUMNS: Record<string, string> = {
  sg: 'singular',
  pl: 'plural',
  m: 'masculine',
  n: 'neuter',
  f: 'feminine',
  'pl.vir': 'plural (masculine personal)',
  'pl.nvir': 'plural (other)',
  '-': '',
};
const SHORT_COLUMNS: Record<string, string> = { sg: 'sg.', pl: 'pl.', m: 'masc.', n: 'neut.', f: 'fem.', 'pl.vir': 'masc. pers. pl.', 'pl.nvir': 'other pl.', '-': '' };

/** A declension column's name in English ("singular", "feminine"); empty for the single column of a pronoun. */
export function columnLabel(col: string): string {
  return NOMINAL_COLUMNS[col] ?? col;
}

export const PERSONS: Record<'es' | 'pt', Record<string, string>> = {
  es: { '1s': 'yo', '2s': 'tú', '2s.vos': 'vos', '3s': 'él, ella, usted', '1p': 'nosotros', '2p': 'vosotros', '3p': 'ellos, ellas, ustedes' },
  pt: { '1s': 'eu', '2s': 'tu', '3s': 'ele, ela, você', '1p': 'nós', '2p': 'vós', '3p': 'eles, elas, vocês' },
};
const IMPERATIVE_PERSONS: Record<'es' | 'pt', Record<string, string>> = {
  es: { '2s': 'tú', '2s.vos': 'vos', '3s': 'usted', '1p': 'nosotros', '2p': 'vosotros', '3p': 'ustedes' },
  pt: { '2s': 'tu', '3s': 'você', '1p': 'nós', '2p': 'vós', '3p': 'vocês' },
};

/**
 * What each case is used for, with the words that most often call for it, shown beside the case in tables
 * ("of, without; after немає, без, для").
 */
const CASE_ROLES: Partial<Record<LanguageCode, Record<string, string>>> = {
  uk: {
    nom: 'subject: who? what?',
    gen: 'of; after немає, без, для, від, до, з (out of)',
    dat: 'to or for someone',
    acc: 'direct object; у/в, на (where to)',
    ins: 'with, by means of; з (together with)',
    loc: 'place: у/в, на; also по, при',
    voc: 'calling someone',
  },
  ru: {
    nom: 'subject: who? what?',
    gen: 'of; after нет, без, для, у, из, от, до',
    dat: 'to or for someone; к, по',
    acc: 'direct object; в, на (where to), через',
    ins: 'with, by means of; с (together with)',
    loc: 'place: в, на; about: о',
    voc: 'calling someone',
  },
  pl: {
    nom: 'subject: who? what?',
    gen: 'of; after nie ma, bez, dla, do, od, z (out of)',
    dat: 'to or for someone',
    acc: 'direct object; na (where to), przez',
    ins: 'with, by means of; z (together with)',
    loc: 'place: w, na; about: o',
    voc: 'calling someone',
  },
};

/** The role of a case in this language, for the first column of a declension table. */
export function caseRole(lang: LanguageCode, c: string): string | null {
  return CASE_ROLES[lang]?.[c.split('.')[0]] ?? null;
}

/** Persons a regional variety hardly uses: shown dimmed in tables, with the reason. */
const PERSON_NOTES: Partial<Record<LanguageCode, Record<string, string>>> = {
  es: { '2p': 'Spain only', '2s.vos': 'parts of Colombia' },
  pt: { '2s': 'regional in Brazil', '2p': 'not used in Brazil' },
};

export function personNote(lang: LanguageCode, person: string): string | null {
  return PERSON_NOTES[lang]?.[person] ?? null;
}

/** The cells of a table that hold a form (stress marks and case ignored): where an inflected answer sits. */
export function cellsForForm(p: Paradigm | null | undefined, form: string | null | undefined): string[] {
  if (!p || !form) return [];
  const want = stripStress(form).toLowerCase().trim();
  if (!want) return [];
  return Object.entries(p.cells)
    .filter(([, forms]) => forms.some((f) => stripStress(f).toLowerCase() === want))
    .map(([k]) => k);
}

/** Tense: English name and the name learners meet in grammars of the language. */
export interface TenseInfo {
  key: string;
  label: string;
  native: string;
}

const ES_TENSES: TenseInfo[] = [
  { key: 'ind.pres', label: 'Present', native: 'presente' },
  { key: 'ind.pret', label: 'Preterite', native: 'pretérito perfecto simple' },
  { key: 'ind.impf', label: 'Imperfect', native: 'pretérito imperfecto' },
  { key: 'ind.fut', label: 'Future', native: 'futuro simple' },
  { key: 'cond', label: 'Conditional', native: 'condicional simple' },
  { key: 'sbjv.pres', label: 'Present subjunctive', native: 'presente de subjuntivo' },
  { key: 'sbjv.impf', label: 'Imperfect subjunctive', native: 'pretérito imperfecto de subjuntivo' },
  { key: 'sbjv.fut', label: 'Future subjunctive', native: 'futuro de subjuntivo' },
  { key: 'imp.aff', label: 'Imperative', native: 'imperativo afirmativo' },
  { key: 'imp.neg', label: 'Negative imperative', native: 'imperativo negativo' },
  { key: 'c.ind.perf', label: 'Present perfect', native: 'pretérito perfecto compuesto' },
  { key: 'c.ind.plup', label: 'Pluperfect', native: 'pretérito pluscuamperfecto' },
  { key: 'c.ind.fut', label: 'Future perfect', native: 'futuro compuesto' },
  { key: 'c.cond', label: 'Conditional perfect', native: 'condicional compuesto' },
  { key: 'c.sbjv.perf', label: 'Present perfect subjunctive', native: 'pretérito perfecto de subjuntivo' },
  { key: 'c.sbjv.plup', label: 'Pluperfect subjunctive', native: 'pretérito pluscuamperfecto de subjuntivo' },
];
const PT_TENSES: TenseInfo[] = [
  { key: 'ind.pres', label: 'Present', native: 'presente' },
  { key: 'ind.pret', label: 'Preterite', native: 'pretérito perfeito' },
  { key: 'ind.impf', label: 'Imperfect', native: 'pretérito imperfeito' },
  { key: 'ind.plup', label: 'Pluperfect (simple)', native: 'pretérito mais-que-perfeito' },
  { key: 'ind.fut', label: 'Future', native: 'futuro do presente' },
  { key: 'cond', label: 'Conditional', native: 'futuro do pretérito' },
  { key: 'sbjv.pres', label: 'Present subjunctive', native: 'presente do subjuntivo' },
  { key: 'sbjv.impf', label: 'Imperfect subjunctive', native: 'pretérito imperfeito do subjuntivo' },
  { key: 'sbjv.fut', label: 'Future subjunctive', native: 'futuro do subjuntivo' },
  { key: 'imp.aff', label: 'Imperative', native: 'imperativo afirmativo' },
  { key: 'imp.neg', label: 'Negative imperative', native: 'imperativo negativo' },
  { key: 'inf.pers', label: 'Personal infinitive', native: 'infinitivo pessoal' },
  { key: 'c.ind.perf', label: 'Present perfect', native: 'pretérito perfeito composto' },
  { key: 'c.ind.plup', label: 'Pluperfect', native: 'pretérito mais-que-perfeito composto' },
  { key: 'c.ind.fut', label: 'Future perfect', native: 'futuro do presente composto' },
  { key: 'c.cond', label: 'Conditional perfect', native: 'futuro do pretérito composto' },
  { key: 'c.sbjv.perf', label: 'Perfect subjunctive', native: 'pretérito perfeito do subjuntivo' },
  { key: 'c.sbjv.plup', label: 'Pluperfect subjunctive', native: 'pretérito mais-que-perfeito do subjuntivo' },
  { key: 'c.sbjv.fut', label: 'Future perfect subjunctive', native: 'futuro composto do subjuntivo' },
];

export function tenses(lang: LanguageCode): TenseInfo[] {
  return lang === 'es' ? ES_TENSES : lang === 'pt' ? PT_TENSES : [];
}

const NONFINITE: Record<string, string> = {
  'nfin|inf': 'infinitive',
  'nfin|ger': 'gerund',
  'part|m.sg': 'past participle',
  'part|f.sg': 'past participle (feminine)',
  'part|m.pl': 'past participle (masculine plural)',
  'part|f.pl': 'past participle (feminine plural)',
};

// ------------------------------------------------------------------ Slavic verbs (1.8.4)

const SLAVIC_PERSONS: Record<SlavicLang, Record<string, string>> = {
  ru: { '1s': 'я', '2s': 'ты', '3s': 'он, она, оно', '1p': 'мы', '2p': 'вы', '3p': 'они' },
  uk: { '1s': 'я', '2s': 'ти', '3s': 'він, вона, воно', '1p': 'ми', '2p': 'ви', '3p': 'вони' },
  pl: { '1s': 'ja', '2s': 'ty', '3s': 'on, ona, ono', '1p': 'my', '2p': 'wy', '3p': 'oni, one' },
};
/** The pronoun each past form goes with in Russian and Ukrainian (the past agrees in gender and number). */
const SLAVIC_PAST_PRONOUN: Record<'ru' | 'uk', Record<string, string>> = {
  ru: { m: 'он', f: 'она', n: 'оно', pl: 'они' },
  uk: { m: 'він', f: 'вона', n: 'воно', pl: 'вони' },
};
const PL_THIRD: Record<string, string> = { '3s.m': 'on', '3s.f': 'ona', '3s.n': 'ono', '3p.vir': 'oni', '3p.nvir': 'one' };
const GENDER_WORD: Record<string, string> = { m: 'masculine', f: 'feminine', n: 'neuter', pl: 'plural', vir: 'masculine personal', nvir: 'other' };
const SLAVIC_TENSE: Record<string, string> = { pres: 'present', fut: 'future', past: 'past', cond: 'conditional', imp: 'imperative' };
export const SLAVIC_VERB_ROWS: readonly string[] = ['pres', 'fut', 'past', 'cond', 'imp'];
const SLAVIC_NONFINITE: Record<string, string> = {
  'nfin|inf': 'infinitive',
  'nfin|adv': 'adverbial participle',
  'nfin|adv.past': 'past adverbial participle',
  'nfin|imps': 'impersonal form',
  'part|act': 'active participle',
  'part|pass': 'passive participle',
};

const SLAVIC_TENSE_NATIVE: Record<SlavicLang, Record<string, string>> = {
  ru: { pres: 'настоящее время', fut: 'будущее время', past: 'прошедшее время', imp: 'повелительное наклонение' },
  uk: { pres: 'теперішній час', fut: 'майбутній час', past: 'минулий час', imp: 'наказовий спосіб' },
  pl: { pres: 'czas teraźniejszy', fut: 'czas przyszły', past: 'czas przeszły', cond: 'tryb przypuszczający', imp: 'tryb rozkazujący' },
};

/** A Russian, Ukrainian or Polish verb tense with its English and native names ("Past", "минулий час"), or null. */
export function slavicTense(lang: LanguageCode, row: string): { label: string; native: string } | null {
  if (!isSlavic(lang) || !SLAVIC_TENSE[row]) return null;
  const label = SLAVIC_TENSE[row][0].toUpperCase() + SLAVIC_TENSE[row].slice(1);
  return { label, native: SLAVIC_TENSE_NATIVE[lang][row] ?? '' };
}

/** A cell of a Russian, Ukrainian or Polish verb's table (pres|1s, past|3s.f, nfin|adv …). */
export function isSlavicVerbCell(lang: LanguageCode, cell: string): boolean {
  if (!isSlavic(lang)) return false;
  return SLAVIC_VERB_ROWS.includes(cell.split('|')[0]) || !!SLAVIC_NONFINITE[cell];
}

/** Who a Slavic verb cell is for: the pronoun (я; он, она, оно), and in the Polish past its gender (ja, masculine). */
function slavicPerson(lang: SlavicLang, tense: string, col: string): string {
  if ((tense === 'past' || tense === 'cond') && lang !== 'pl') return SLAVIC_PAST_PRONOUN[lang][col] ?? col;
  if ((tense === 'past' || tense === 'cond') && lang === 'pl') {
    if (PL_THIRD[col]) return PL_THIRD[col];
    const [person, gender] = col.split('.');
    return `${SLAVIC_PERSONS.pl[person] ?? person}, ${GENDER_WORD[gender] ?? gender}`;
  }
  return SLAVIC_PERSONS[lang][col] ?? col;
}

/** "present (я)", "past (вона)", "past (ja, feminine)", "imperative (ти)", "infinitive". */
function slavicVerbLabel(lang: SlavicLang, cell: string): string {
  if (SLAVIC_NONFINITE[cell]) return SLAVIC_NONFINITE[cell];
  const [row, col] = cell.split('|');
  return `${SLAVIC_TENSE[row] ?? row} (${slavicPerson(lang, row, col)})`;
}

/** The person a verb cell is for, as the pronouns of the language (yo; él, ella, usted; ти; ja, masculine). */
export function personLabel(lang: LanguageCode, tense: string, person: string): string {
  if (isSlavic(lang)) return slavicPerson(lang, tense, person);
  if (lang !== 'es' && lang !== 'pt') return person;
  const map = tense.startsWith('imp.') ? IMPERATIVE_PERSONS[lang] : PERSONS[lang];
  return map[person] ?? person;
}

const ROMANCE_ROW_LABEL: Record<string, string> = {
  neut: 'neuter',
  subj: 'subject',
  obj: 'object (me, you)',
  prep: 'after a preposition',
};

/** "feminine plural", "singular", "short form before a masculine noun", "neuter", "with con". */
function romanceNominalLabel(lang: 'es' | 'pt', row: string, col: string): string {
  const gender = col === 'm' ? 'masculine' : col === 'f' ? 'feminine' : '';
  if (row === 'sg' || row === 'pl') return `${gender ? `${gender} ` : ''}${row === 'sg' ? 'singular' : 'plural'}`;
  if (row === 'apoc') return `short form before a ${gender ? `${gender} ` : ''}noun`;
  if (row === 'com') return lang === 'es' ? 'with con' : 'with com';
  return ROMANCE_ROW_LABEL[row] ?? row;
}

/**
 * A cell's name in English, e.g. "genitive plural", "accusative masculine (animate)", "preterite (yo)",
 * "past participle", "feminine plural". Used for drill prompts, form tags and feedback.
 */
export function cellLabel(lang: LanguageCode, cell: string): string {
  const [row, col] = cell.split('|');
  if (isSlavicVerbCell(lang, cell)) return slavicVerbLabel(lang as SlavicLang, cell);
  if (NONFINITE[cell]) return NONFINITE[cell];
  if ((lang === 'es' || lang === 'pt') && ROMANCE_ROWS.includes(row)) return romanceNominalLabel(lang, row, col);
  if (lang === 'es' || lang === 'pt') {
    const t = tenses(lang).find((x) => x.key === row);
    return `${(t?.label ?? row).toLowerCase()} (${personLabel(lang, row, col).split(', ').join('/')})`;
  }
  if (row === 'short') return `short form ${NOMINAL_COLUMNS[col] ?? col}`.trim();
  if (row === 'comp') return 'comparative';
  if (row === 'sup') return 'superlative';
  const [c, anim] = row.split('.');
  const colLabel = NOMINAL_COLUMNS[col] ?? col;
  const animLabel = anim === 'anim' ? ' (animate)' : anim === 'inan' ? ' (inanimate)' : '';
  return `${caseLabel(lang, c)}${colLabel ? ` ${colLabel}` : ''}${animLabel}`;
}

// ------------------------------------------------------------------ tables

export interface TableCell {
  key: string;
  forms: string[];
}
export interface TableRow {
  key: string;
  label: string;
  /** One entry per column; null where the word has no such form. */
  cells: Array<TableCell | null>;
  /** Every column holds the same forms: show them once across the row (два: двух). */
  merged?: boolean;
  /** Labelled sub-lines inside a cell, for the animate/inanimate accusative pair. */
  sub?: Array<{ label: string; cells: Array<TableCell | null> }>;
}
export interface TableSection {
  id: string;
  title: string;
  subtitle?: string;
  columns: Array<{ key: string; label: string; short: string }>;
  rows: TableRow[];
}

const nonEmpty = (p: Paradigm, k: string) => (p.cells[k]?.length ? { key: k, forms: p.cells[k] } : null);

function declensionSections(lang: LanguageCode, p: Paradigm): TableSection[] {
  const keys = Object.keys(p.cells);
  const colsPresent = new Set(keys.map((k) => k.split('|')[1]));
  const gendered = ['m', 'n', 'f'].some((c) => colsPresent.has(c));
  const order = (gendered ? ['m', 'n', 'f', 'pl', 'pl.vir', 'pl.nvir', '-'] : ['sg', 'pl', '-']).filter((c) => colsPresent.has(c) && keys.some((k) => k.split('|')[1] === c && CASE_ORDER.includes(k.split('|')[0].split('.')[0])));
  const columns = order.map((c) => ({ key: c, label: NOMINAL_COLUMNS[c] ? NOMINAL_COLUMNS[c][0].toUpperCase() + NOMINAL_COLUMNS[c].slice(1) : '', short: SHORT_COLUMNS[c] ?? c }));
  const rows: TableRow[] = [];
  for (const c of CASE_ORDER) {
    const plain = order.map((col) => nonEmpty(p, `${c}|${col}`));
    if (c === 'acc') {
      const anim = order.map((col) => nonEmpty(p, `acc.anim|${col}`));
      const inan = order.map((col) => nonEmpty(p, `acc.inan|${col}`));
      if (anim.some(Boolean) || inan.some(Boolean)) {
        // Columns without the split show their single accusative on both lines.
        rows.push({
          key: 'acc',
          label: caseLabel(lang, 'acc'),
          cells: plain,
          sub: [
            { label: 'inanimate', cells: order.map((_, i) => inan[i] ?? plain[i]) },
            { label: 'animate', cells: order.map((_, i) => anim[i] ?? plain[i]) },
          ],
        });
        continue;
      }
    }
    if (!plain.some(Boolean)) continue;
    const filled = plain.filter(Boolean) as TableCell[];
    const merged = order.length > 1 && filled.length > 1 && filled.every((x) => x.forms.join() === filled[0].forms.join()) && filled.length === order.length;
    rows.push({ key: c, label: caseLabel(lang, c), cells: plain, merged });
  }
  const sections: TableSection[] = [{ id: 'cases', title: 'Cases', columns, rows }];
  const shortCols = ['m', 'n', 'f', 'pl'].filter((g) => p.cells[`short|${g}`]?.length);
  if (shortCols.length) {
    sections.push({
      id: 'short',
      title: 'Short form',
      columns: shortCols.map((g) => ({ key: g, label: NOMINAL_COLUMNS[g][0].toUpperCase() + NOMINAL_COLUMNS[g].slice(1), short: SHORT_COLUMNS[g] })),
      rows: [{ key: 'short', label: 'short form', cells: shortCols.map((g) => nonEmpty(p, `short|${g}`)) }],
    });
  }
  const degrees = (['comp', 'sup'] as const).filter((d) => p.cells[`${d}|-`]?.length);
  if (degrees.length) {
    sections.push({
      id: 'degrees',
      title: 'Comparison',
      columns: [{ key: '-', label: '', short: '' }],
      rows: degrees.map((d) => ({ key: d, label: d === 'comp' ? 'comparative' : 'superlative', cells: [nonEmpty(p, `${d}|-`)] })),
    });
  }
  return sections;
}

const VERB_GROUPS: Record<'es' | 'pt', Array<{ id: string; title: string; tenses: string[] }>> = {
  es: [
    { id: 'indicative', title: 'Indicative', tenses: ['ind.pres', 'ind.pret', 'ind.impf', 'ind.fut', 'cond'] },
    { id: 'subjunctive', title: 'Subjunctive', tenses: ['sbjv.pres', 'sbjv.impf', 'sbjv.fut'] },
    { id: 'imperative', title: 'Imperative', tenses: ['imp.aff', 'imp.neg'] },
    { id: 'compound', title: 'Compound tenses', tenses: ['c.ind.perf', 'c.ind.plup', 'c.ind.fut', 'c.cond', 'c.sbjv.perf', 'c.sbjv.plup'] },
  ],
  pt: [
    { id: 'indicative', title: 'Indicative', tenses: ['ind.pres', 'ind.pret', 'ind.impf', 'ind.plup', 'ind.fut', 'cond'] },
    { id: 'subjunctive', title: 'Subjunctive', tenses: ['sbjv.pres', 'sbjv.impf', 'sbjv.fut'] },
    { id: 'imperative', title: 'Imperative', tenses: ['imp.aff', 'imp.neg'] },
    { id: 'infinitive', title: 'Personal infinitive', tenses: ['inf.pers'] },
    { id: 'compound', title: 'Compound tenses', tenses: ['c.ind.perf', 'c.ind.plup', 'c.ind.fut', 'c.cond', 'c.sbjv.perf', 'c.sbjv.plup', 'c.sbjv.fut'] },
  ],
};
const VERB_PERSON_ORDER = ['1s', '2s', '2s.vos', '3s', '1p', '2p', '3p'];

/** One section per tense (persons down the side), grouped by mood; non-finite forms first. */
function conjugationSections(lang: 'es' | 'pt', p: Paradigm): TableSection[] {
  const sections: TableSection[] = [];
  const nf = ['nfin|inf', 'nfin|ger', 'part|m.sg'].filter((k) => p.cells[k]?.length);
  if (nf.length) {
    const partForms = ['part|f.sg', 'part|m.pl', 'part|f.pl'].map((k) => p.cells[k]?.[0]).filter(Boolean);
    sections.push({
      id: 'nonfinite',
      title: 'Forms',
      columns: [{ key: 'form', label: '', short: '' }],
      rows: nf.map((k) => ({
        key: k,
        label: NONFINITE[k],
        cells: [{ key: k, forms: k === 'part|m.sg' && partForms.length ? [...p.cells[k], ...partForms.map((f) => f as string)] : p.cells[k] }],
      })),
    });
  }
  for (const g of VERB_GROUPS[lang]) {
    for (const t of g.tenses) {
      const info = tenses(lang).find((x) => x.key === t)!;
      const persons = VERB_PERSON_ORDER.filter((pp) => p.cells[`${t}|${pp}`]?.length);
      if (!persons.length) continue;
      sections.push({
        id: t,
        title: info.label,
        subtitle: info.native,
        columns: [{ key: 'form', label: '', short: '' }],
        rows: persons.map((pp) => ({ key: pp, label: personLabel(lang, t, pp), cells: [{ key: `${t}|${pp}`, forms: p.cells[`${t}|${pp}`] }] })),
      });
    }
  }
  return sections;
}

const SLAVIC_VERB_GROUPS: Array<{ id: string; title: string; tenses: string[] }> = [
  { id: 'tenses', title: 'Present, future and past', tenses: ['pres', 'fut', 'past', 'past.sg', 'past.pl'] },
  { id: 'imperative', title: 'Imperative', tenses: ['imp'] },
  { id: 'conditional', title: 'Conditional', tenses: ['cond.sg', 'cond.pl'] },
];
const ONE_COLUMN = [{ key: 'form', label: '', short: '' }];

/**
 * A Russian, Ukrainian or Polish verb: the infinitive and participles first, then the present or future and the past
 * with the pronouns down the side (the Polish past and conditional as person × gender), then the imperative.
 */
function slavicConjugationSections(lang: SlavicLang, p: Paradigm): TableSection[] {
  const sections: TableSection[] = [];
  const nf = Object.keys(SLAVIC_NONFINITE).filter((k) => p.cells[k]?.length);
  if (nf.length) sections.push({ id: 'nonfinite', title: 'Forms', columns: ONE_COLUMN, rows: nf.map((k) => ({ key: k, label: SLAVIC_NONFINITE[k], cells: [{ key: k, forms: p.cells[k] }] })) });
  const list = (id: string, title: string, subtitle: string | undefined, cells: Array<[string, string]>) => {
    const rows = cells.filter(([k]) => p.cells[k]?.length).map(([k, label]) => ({ key: k.split('|')[1], label, cells: [{ key: k, forms: p.cells[k] }] }));
    if (rows.length) sections.push({ id, title, ...(subtitle ? { subtitle } : {}), columns: ONE_COLUMN, rows });
  };
  const persons = ['1s', '2s', '3s', '1p', '2p', '3p'];
  const hasPresent = persons.some((pp) => p.cells[`pres|${pp}`]?.length);
  list('pres', 'Present', undefined, persons.map((pp) => [`pres|${pp}`, SLAVIC_PERSONS[lang][pp]]));
  list('fut', 'Future', hasPresent ? undefined : 'a perfective verb has no present tense', persons.map((pp) => [`fut|${pp}`, SLAVIC_PERSONS[lang][pp]]));
  if (lang === 'pl') {
    for (const t of ['past', 'cond']) {
      const grid = (id: string, title: string, cols: string[], rows: Array<[string, string]>) => {
        const filled = rows.map(([pp, label]) => ({ key: pp, label, cells: cols.map((g) => nonEmpty(p, `${t}|${pp}.${g}`)) })).filter((r) => r.cells.some(Boolean));
        if (filled.length) sections.push({ id, title, columns: cols.map((g) => ({ key: g, label: GENDER_WORD[g][0].toUpperCase() + GENDER_WORD[g].slice(1), short: SHORT_COLUMNS[g === 'vir' ? 'pl.vir' : g === 'nvir' ? 'pl.nvir' : g] ?? g })), rows: filled });
      };
      grid(`${t}.sg`, `${t === 'past' ? 'Past' : 'Conditional'}, singular`, ['m', 'f', 'n'], [['1s', 'ja'], ['2s', 'ty'], ['3s', 'on, ona, ono']]);
      grid(`${t}.pl`, `${t === 'past' ? 'Past' : 'Conditional'}, plural`, ['vir', 'nvir'], [['1p', 'my'], ['2p', 'wy'], ['3p', 'oni, one']]);
    }
  } else {
    list('past', 'Past', 'agrees with the subject in gender and number', ['m', 'f', 'n', 'pl'].map((g) => [`past|${g}`, SLAVIC_PAST_PRONOUN[lang][g]]));
  }
  list('imp', 'Imperative', undefined, ['2s', '1p', '2p'].map((pp) => [`imp|${pp}`, SLAVIC_PERSONS[lang][pp]]));
  return sections;
}

/** The groups of a conjugation (Indicative, Subjunctive…; Present, future and past…) with the tense sections in each. */
export function verbGroups(lang: LanguageCode): Array<{ id: string; title: string; tenses: string[] }> {
  return lang === 'es' || lang === 'pt' ? VERB_GROUPS[lang] : isSlavic(lang) ? SLAVIC_VERB_GROUPS : [];
}

/**
 * A Spanish or Portuguese word's gender and number: singular and plural down the side, masculine and feminine
 * across (one column when the forms are the same for both), the Spanish short form before a noun as a row of its
 * own, and the neuter (esto, isso) apart. Yo and tú list their forms by use instead.
 */
function romanceNominalSections(lang: 'es' | 'pt', p: Paradigm): TableSection[] {
  const keys = Object.keys(p.cells).filter((k) => p.cells[k]?.length);
  const pronounRows = PRONOUN_ROWS.filter((r) => p.cells[`${r}|-`]?.length);
  if (pronounRows.length) {
    return [{ id: 'forms', title: 'Forms', columns: ONE_COLUMN, rows: pronounRows.map((r) => ({ key: r, label: romanceNominalLabel(lang, r, '-'), cells: [{ key: `${r}|-`, forms: p.cells[`${r}|-`] }] })) }];
  }
  const gendered = keys.some((k) => colOf(k) === 'f');
  const cols = gendered ? ['m', 'f'] : ['-'];
  const columns = cols.map((c) => ({ key: c, label: c === '-' ? '' : NOMINAL_COLUMNS[c][0].toUpperCase() + NOMINAL_COLUMNS[c].slice(1), short: SHORT_COLUMNS[c] }));
  const rows: TableRow[] = [];
  for (const r of ['sg', 'pl', 'apoc']) {
    const cells = cols.map((c) => nonEmpty(p, `${r}|${c}`));
    if (cells.some(Boolean)) rows.push({ key: r, label: r === 'apoc' ? 'before a noun' : r === 'sg' ? 'singular' : 'plural', cells });
  }
  const sections: TableSection[] = [];
  if (rows.length) {
    const sameForBoth = !gendered && p.kind !== 'noun';
    sections.push({ id: 'gender', title: gendered ? 'Gender and number' : 'Singular and plural', ...(sameForBoth ? { subtitle: 'the same for masculine and feminine' } : {}), columns, rows });
  }
  if (p.cells['neut|-']?.length) {
    sections.push({
      id: 'neuter',
      title: 'Neuter',
      subtitle: lang === 'es' ? 'for an idea or something not named (esto, eso, lo)' : 'for an idea or something not named (isto, isso, aquilo)',
      columns: ONE_COLUMN,
      rows: [{ key: 'neut', label: 'neuter', cells: [{ key: 'neut|-', forms: p.cells['neut|-'] }] }],
    });
  }
  return sections;
}

export function paradigmTable(lang: LanguageCode, p: Paradigm): TableSection[] {
  if (p.indeclinable) return [];
  if (p.kind === 'verb') return lang === 'es' || lang === 'pt' ? conjugationSections(lang, p) : isSlavic(lang) ? slavicConjugationSections(lang, p) : [];
  if ((lang === 'es' || lang === 'pt') && isNominalRomance(p)) return romanceNominalSections(lang, p);
  return declensionSections(lang, p);
}

// ------------------------------------------------------------------ forms and drills

/** Distinct forms of a table with the labels of every cell they fill (книги: genitive singular, nominative plural…). */
export function paradigmForms(lang: LanguageCode, p: Paradigm): Array<{ form: string; tags: string[] }> {
  const out = new Map<string, { form: string; tags: string[] }>();
  for (const [cell, forms] of Object.entries(p.cells)) {
    for (const form of forms) {
      const k = form.normalize('NFC');
      const item = out.get(k) ?? { form: k, tags: [] };
      const label = cellLabel(lang, cell);
      if (!item.tags.includes(label)) item.tags.push(label);
      out.set(k, item);
    }
  }
  return [...out.values()];
}

/** A drillable group of cells, as offered in the forms practice setup. */
export interface DrillGroup {
  id: string;
  label: string;
  hint?: string;
  cells: (cell: string) => boolean;
  defaultOn: boolean;
  /**
   * The setup shows the two apart (both arrive in `tenses`): in Russian, Ukrainian and Polish cases and verb tenses,
   * in Spanish and Portuguese verb tenses and gender and number ("case").
   */
  kind?: 'case' | 'tense';
}

const tenseOf = (cell: string) => cell.split('|')[0];
const personOf = (cell: string) => cell.split('|')[1];

/** Tense and person groups for verbs; case groups for declension. The practice setup shows these as toggles. */
export function drillGroups(lang: LanguageCode): { tenses: DrillGroup[]; persons: DrillGroup[] } {
  if (lang === 'es' || lang === 'pt') {
    const off = lang === 'es' ? ['sbjv.fut', 'c.ind.fut', 'c.cond', 'c.sbjv.perf', 'c.sbjv.plup'] : ['ind.plup', 'inf.pers', 'c.ind.perf', 'c.ind.fut', 'c.cond', 'c.sbjv.perf', 'c.sbjv.plup', 'c.sbjv.fut'];
    const t: DrillGroup[] = [
      { id: 'nfin', label: 'Gerund and participle', cells: (c) => c === 'nfin|ger' || c === 'part|m.sg', defaultOn: true, kind: 'tense' },
      ...tenses(lang).map((x) => ({ id: x.key, label: x.label, hint: x.native, cells: (c: string) => tenseOf(c) === x.key, defaultOn: !off.includes(x.key), kind: 'tense' as const })),
      // Nouns, adjectives, determiners and pronouns (1.8.5): the feminine and the plurals, and Spanish buen, algún.
      { id: 'gn', label: 'Gender and number', hint: lang === 'es' ? 'su, sus; bueno, buena, buenos, buenas' : 'seu, sua, seus, suas', cells: (c) => ['sg', 'pl', 'apoc', 'neut'].includes(tenseOf(c)), defaultOn: true, kind: 'case' },
    ];
    const persons: DrillGroup[] = Object.entries(PERSONS[lang]).map(([k, label]) => ({
      id: k,
      label,
      // Colombia and Brazil: vos is regional, vosotros and vós are not used, and Brazilian Portuguese mostly uses você for tu.
      hint: k === '2s.vos' ? 'used in parts of Colombia' : k === '2p' ? 'Spain only' : lang === 'pt' && k === '2s' ? 'regional in Brazil' : undefined,
      cells: (c: string) => personOf(c) === k,
      defaultOn: !(k === '2s.vos' || k === '2p' || (lang === 'pt' && k === '2s')),
    }));
    return { tenses: t, persons };
  }
  if (DECLENSION_LANGS.includes(lang)) {
    const cases: DrillGroup[] = CASE_ORDER.filter((c) => c !== 'voc' || lang !== 'ru').map((c) => ({
      id: c,
      label: caseLabel(lang, c)[0].toUpperCase() + caseLabel(lang, c).slice(1),
      cells: (cell: string) => tenseOf(cell).split('.')[0] === c,
      defaultOn: true,
      kind: 'case' as const,
    }));
    if (lang === 'ru') cases.push({ id: 'short', label: 'Short forms', cells: (c) => tenseOf(c) === 'short', defaultOn: true, kind: 'case' });
    cases.push({ id: 'degrees', label: 'Comparative and superlative', cells: (c) => tenseOf(c) === 'comp' || tenseOf(c) === 'sup', defaultOn: true, kind: 'case' });
    // Verb tenses (1.8.4): ids with "v." so they never clash with a case.
    const verbTenses: DrillGroup[] = [
      { id: 'v.pres', label: 'Present', cells: (c) => tenseOf(c) === 'pres', defaultOn: true, kind: 'tense' },
      { id: 'v.fut', label: 'Future', cells: (c) => tenseOf(c) === 'fut', defaultOn: true, kind: 'tense' },
      { id: 'v.past', label: 'Past', cells: (c) => tenseOf(c) === 'past', defaultOn: true, kind: 'tense' },
      ...(lang === 'pl' ? [{ id: 'v.cond', label: 'Conditional', cells: (c: string) => tenseOf(c) === 'cond', defaultOn: true, kind: 'tense' as const }] : []),
      { id: 'v.imp', label: 'Imperative', cells: (c) => tenseOf(c) === 'imp', defaultOn: true, kind: 'tense' },
      { id: 'v.nfin', label: 'Adverbial participles', hint: 'mając, маючи: doing something at the same time', cells: (c) => c === 'nfin|adv' || c === 'nfin|adv.past', defaultOn: false, kind: 'tense' },
    ];
    const singular = (col: string) => ['sg', 'm', 'n', 'f', '-'].includes(col) || /^[123]s(\.|$)/.test(col);
    const plural = (col: string) => ['pl', 'pl.vir', 'pl.nvir'].includes(col) || /^[123]p(\.|$)/.test(col);
    const numbers: DrillGroup[] = [
      { id: 'sg', label: 'Singular', cells: (c) => singular(personOf(c)), defaultOn: true },
      { id: 'pl', label: 'Plural', cells: (c) => plural(personOf(c)), defaultOn: true },
    ];
    return { tenses: [...cases, ...verbTenses], persons: numbers };
  }
  return { tenses: [], persons: [] };
}

/** Cells of a paradigm a drill may ask for, given the chosen group ids (null = the defaults). */
export function drillCells(lang: LanguageCode, p: Paradigm, chosen?: { tenses?: string[] | null; persons?: string[] | null }): string[] {
  if (p.indeclinable) return [];
  const g = drillGroups(lang);
  const on = (groups: DrillGroup[], ids?: string[] | null) => groups.filter((x) => (ids ? ids.includes(x.id) : x.defaultOn));
  const t = on(g.tenses, chosen?.tenses);
  const pp = on(g.persons, chosen?.persons);
  return Object.keys(p.cells).filter((cell) => {
    if (!p.cells[cell]?.length) return false;
    if (cell === 'nfin|inf' || cell.startsWith('part|') && cell !== 'part|m.sg') return false; // the infinitive is the prompt itself
    // The dictionary form of a Spanish or Portuguese word is the prompt too, and yo and tú are not drilled.
    if ((lang === 'es' || lang === 'pt') && (cell === 'sg|m' || cell === 'sg|-' || PRONOUN_ROWS.includes(tenseOf(cell)))) return false;
    if (!t.some((x) => x.cells(cell))) return false;
    // Non-finite verb forms, degree/short rows and Spanish or Portuguese gender and number have no person to filter on.
    if (cell.startsWith('nfin|') || cell.startsWith('part|') || cell.startsWith('comp|') || cell.startsWith('sup|')) return true;
    if (isRomanceNominalCell(lang, cell)) return true;
    return pp.some((x) => x.cells(cell));
  });
}

/** Light validation for imported tables: cells of short strings, at most a few hundred. */
export function sanitizeParadigm(input: unknown): Paradigm | null {
  if (!input || typeof input !== 'object') return null;
  const x = input as Record<string, unknown>;
  const kind = x.kind;
  if (kind !== 'noun' && kind !== 'adjective' && kind !== 'pronoun' && kind !== 'numeral' && kind !== 'verb') return null;
  const cells: Record<string, string[]> = {};
  const raw = x.cells && typeof x.cells === 'object' ? (x.cells as Record<string, unknown>) : {};
  let n = 0;
  for (const [k, v] of Object.entries(raw)) {
    if (++n > 600 || !/^[a-z.]+\|[a-z0-9.-]+$/.test(k) || !Array.isArray(v)) continue;
    const forms = v.filter((f): f is string => typeof f === 'string' && f.trim().length > 0 && f.length <= 80).slice(0, 8).map((f) => f.normalize('NFC').trim());
    if (forms.length) cells[k] = forms;
  }
  const indeclinable = x.indeclinable === true;
  if (!indeclinable && !Object.keys(cells).length) return null;
  return {
    kind,
    source: typeof x.source === 'string' ? x.source.slice(0, 120) : null,
    cells,
    indeclinable: indeclinable || undefined,
    notes: Array.isArray(x.notes) ? x.notes.filter((s): s is string => typeof s === 'string').slice(0, 6).map((s) => s.slice(0, 60)) : undefined,
    gender: typeof x.gender === 'string' ? x.gender.slice(0, 8) : undefined,
  };
}

/**
 * A few key forms of a table for places with no room for all of it (the new-word card): the present tense and
 * participle of a verb, the nominative and genitive of a noun, the nominative genders of an adjective.
 */
export function inflectionSummary(lang: LanguageCode, p: Paradigm | null): { title: string; rows: Array<{ label: string; forms: string[] }> } | null {
  if (!p || p.indeclinable) return null;
  const c = p.cells;
  const rows: Array<{ label: string; forms: string[] }> = [];
  const push = (label: string, key: string) => {
    if (c[key]?.length) rows.push({ label, forms: c[key] });
  };
  if ((lang === 'es' || lang === 'pt') && isNominalRomance(p)) {
    for (const r of ['sg', 'pl', 'apoc', 'neut', ...PRONOUN_ROWS]) for (const col of ['m', 'f', '-']) push(romanceNominalLabel(lang, r, col), `${r}|${col}`);
    return rows.length ? { title: tableTitle(p), rows } : null;
  }
  if (p.kind === 'verb' && (lang === 'es' || lang === 'pt')) {
    for (const pp of ['1s', '2s', '3s', '1p', '3p']) push(personLabel(lang, 'ind.pres', pp), `ind.pres|${pp}`);
    push(`preterite (${PERSONS[lang]['1s']})`, 'ind.pret|1s');
    push('past participle', 'part|m.sg');
    return rows.length ? { title: 'Present tense and key forms', rows } : null;
  }
  if (p.kind === 'verb' && isSlavic(lang)) {
    const t = ['1s', '2s', '3s', '1p', '2p', '3p'].some((pp) => c[`pres|${pp}`]?.length) ? 'pres' : 'fut';
    for (const pp of ['1s', '2s', '3s', '3p']) push(slavicVerbLabel(lang, `${t}|${pp}`), `${t}|${pp}`);
    for (const col of lang === 'pl' ? ['3s.m', '3s.f', '3p.vir'] : ['m', 'f', 'pl']) push(slavicVerbLabel(lang, `past|${col}`), `past|${col}`);
    push(slavicVerbLabel(lang, 'imp|2s'), 'imp|2s');
    return rows.length ? { title: 'Key forms', rows } : null;
  }
  const cols = new Set(Object.keys(c).map((k) => k.split('|')[1]));
  if (cols.has('sg') || cols.has('pl')) {
    for (const cs of ['nom', 'gen']) {
      const forms = [...(c[`${cs}|sg`] ?? []).slice(0, 1), ...(c[`${cs}|pl`] ?? []).slice(0, 1)];
      if (forms.length) rows.push({ label: `${caseLabel(lang, cs)} ${c[`${cs}|sg`] && c[`${cs}|pl`] ? 'singular, plural' : c[`${cs}|sg`] ? 'singular' : 'plural'}`, forms });
    }
    return rows.length ? { title: 'Key forms', rows } : null;
  }
  if (cols.has('m') || cols.has('f')) {
    for (const g of ['m', 'n', 'f', 'pl', 'pl.vir', 'pl.nvir']) push(`nominative ${NOMINAL_COLUMNS[g]}`, `nom|${g}`);
    return rows.length ? { title: 'Key forms', rows } : null;
  }
  for (const cs of CASE_ORDER) push(caseLabel(lang, cs), `${cs}|-`);
  return rows.length ? { title: 'Cases', rows } : null;
}

/** What a drill on one cell accepts: its forms (Spanish/Portuguese negative imperatives also without no / não). */
export function formsSpec(language: LanguageCode, p: Paradigm, cell: string, lemma: string): AnswerSpec {
  const forms = p.cells[cell] ?? [];
  const accepted = [...forms];
  for (const f of forms) {
    const bare = f.replace(/^(no|não) /, '');
    if (bare !== f && !accepted.includes(bare)) accepted.push(bare);
  }
  const accKeys = new Set(accepted.map((a) => canonical(a, language)));
  const otherForms = paradigmForms(language, p)
    .filter((f) => !accKeys.has(canonical(f.form, language)))
    .map((f) => ({ form: stripStress(f.form), tags: f.tags.slice(0, 4) }));
  if (!accKeys.has(canonical(lemma, language))) otherForms.push({ form: stripStress(lemma), tags: ['dictionary form'] });
  return { lang: language, accepted, otherForms };
}
