// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
/**
 * Why an answer has the form it has. Shown under every answer whose expected form is not the dictionary form, e.g.
 * "“чого” is the genitive of “що”: it follows “для” (for), which always takes the genitive."
 *
 * explainForm takes the word's table (shared/paradigms.ts), the expected form and, for a sentence gap, the text around
 * the gap and the sentence's exact cell when it has one. It returns the cells the form fills, their name and a reason:
 *
 * - The exact cell. A form can fill several cells (українське: the nominative or accusative neuter), and in a given
 *   sentence it is in one of them, which rules can't always tell. For the example sentences of the frequency sets, the
 *   cell and the reason come from data/grammar/<lang>.json (AI-annotated, built by scripts/grammar/build.mjs, keyed by
 *   exactKey); the server sends them with the sentence as `exact`. When the cell holds the form (or no/não + the form,
 *   for a negative imperative: exactCellOf), the explanation names that cell alone, with the reason: "“українське”
 *   is the nominative neuter of “український”: it describes “громадянство” (citizenship), …". Without a reason, the
 *   rules below give the one the sentence shows for that cell, or else its general use. A cell that does not hold the
 *   form is ignored, as if there were none.
 * - Russian, Ukrainian, Polish (cases). The word that calls for the case is looked for just before the gap: at most
 *   three words back, never past punctuation, and only through words that can agree with the gap (adjectives,
 *   possessives, demonstratives, numerals). It knows prepositions (for those with several cases, the meaning that picks
 *   the case), negation (нет, немає, nie ma, and Polish negated transitive verbs), quantity words, numerals and a short
 *   list of verbs with fixed government. A trigger only counts when the form can be in the case it calls for. Without
 *   one, the case's general use is given, as in the table captions (caseRole).
 * - Spanish, Portuguese (verbs). The tense, mood and person with its pronoun, and what the tense is used for, with the
 *   reason the sentence shows when there is one: a subjunctive trigger, a construction (estar + gerund, haber +
 *   participle), a time word, the subject pronoun.
 *
 * Without an exact cell, a form that fills several cells (книги, hablamos) is narrowed only by the sentence; otherwise
 * every possibility is named. Pure functions, no DOM: the web app shows the text in answer feedback.
 */
import type { LanguageCode } from './languages.ts';
import { caseLabel, cellLabel, columnLabel, isNominalRomance, isRomanceNominalCell, isSlavicVerbCell, personNote, type Paradigm, type ParadigmKind } from './paradigms.ts';
import { canonical, foldLatinDiacritics, stripStress } from './text.ts';

export interface FormExplanation {
  /** The cells of the table the form fills here: all of them, or those the sentence leaves. */
  cells: string[];
  /** Their name: "genitive", "genitive singular", "preterite, nosotros (we)". */
  label: string;
  /** Why this form, without the naming part: the trigger in the sentence or the general use (null when unknown). */
  reason: string | null;
  /** The reason comes from a word in the sentence rather than from a general rule. */
  fromSentence: boolean;
  /** One or two plain sentences for the learner. */
  text: string;
}

export interface ExplainInput {
  language: LanguageCode;
  /** The word's table (see paradigmFor for words whose entry has none). */
  paradigm: Paradigm | null | undefined;
  /** The dictionary form. */
  lemma: string;
  /** The form the answer needed. */
  form: string | null | undefined;
  /** For a sentence gap: the text before and after it. */
  before?: string | null;
  after?: string | null;
  /** The cell a question named ("give the genitive plural"): it need not be found from the form. */
  cell?: string | null;
  /** For a sentence gap: the cell the form fills in this sentence, with why, from data/grammar/ (see ExactCell). */
  exact?: ExactCell | null;
}

/**
 * The one cell a form fills in a given sentence and why, annotated offline for the example sentences of the frequency
 * sets (data/grammar/<lang>.json, keyed by exactKey). `why` continues "“<form>” is the <label> of “<lemma>”: …".
 */
export interface ExactCell {
  /** A cell of the word's table, or NO_NOTE: no grammar note for this sentence (see NO_NOTE). */
  cell: string;
  why?: string | null;
}

type Case = 'nom' | 'gen' | 'dat' | 'acc' | 'ins' | 'loc' | 'voc';
type CaseLang = 'ru' | 'uk' | 'pl';
type VerbLang = 'es' | 'pt';
type Pat = Array<string | ReadonlySet<string>>;

const CASES: readonly string[] = ['nom', 'gen', 'dat', 'acc', 'ins', 'loc', 'voc'];
const LANGUAGE_NAME: Record<CaseLang | VerbLang, string> = { ru: 'Russian', uk: 'Ukrainian', pl: 'Polish', es: 'Spanish', pt: 'Portuguese' };

// ------------------------------------------------------------------ helpers

/** Comparison form of a word: no stress marks, lower case, one apostrophe; Russian ё as е, as most texts write it. */
function norm(lang: LanguageCode, s: string): string {
  const k = canonical(s, lang);
  return lang === 'ru' ? k.replace(/ё/g, 'е') : k;
}

/**
 * The key of an annotated sentence in data/grammar/<lang>.json: the language, then the lemma, the form and the whole
 * sentence in comparison form (stress marks removed, lower case, one apostrophe, no punctuation, single spaces; Russian
 * ё as е), joined by "|", which comparison forms never contain. scripts/grammar/build.mjs writes the files with it and
 * the server looks sentences up with it, so the two always agree.
 */
export function exactKey(language: LanguageCode, lemma: string, form: string, sentence: string): string {
  return [language, norm(language, lemma), norm(language, form), norm(language, sentence)].join('|');
}

const quote = (s: string) => `“${s}”`;
const set = (words: string): ReadonlySet<string> => new Set(words.split(/\s+/).filter(Boolean));

function joinOr(xs: string[]): string {
  return xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}`;
}
function joinAnd(xs: string[]): string {
  return xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}

const rowOf = (cell: string) => cell.split('|')[0];
const colOf = (cell: string) => cell.split('|')[1] ?? '';
const caseOf = (cell: string) => rowOf(cell).split('.')[0];
const isNonFinite = (cell: string) => cell.startsWith('nfin|') || cell.startsWith('part|');
/** A verb cell's tense (the whole cell for the gerund and participles, which have no person). */
const tenseOf = (cell: string) => (isNonFinite(cell) ? cell : rowOf(cell));
const personOf = (cell: string) => (isNonFinite(cell) ? '' : colOf(cell));

function numberOf(cell: string): 'sg' | 'pl' | null {
  const c = colOf(cell);
  if (c === 'sg' || c === 'm' || c === 'n' || c === 'f') return 'sg';
  return c.startsWith('pl') ? 'pl' : null;
}

/** The cells of a table holding a form. */
function cellsOf(lang: LanguageCode, p: Paradigm, form: string): string[] {
  const want = norm(lang, form);
  return Object.entries(p.cells)
    .filter(([, forms]) => forms.some((f) => norm(lang, f) === want))
    .map(([k]) => k);
}

/** Does the run of words ending at `end` match the pattern (a word, or a set of words, per position)? */
function matchAt(words: string[], end: number, pat: Pat): boolean {
  const start = end - pat.length + 1;
  if (start < 0) return false;
  return pat.every((p, i) => (typeof p === 'string' ? words[start + i] === p : p.has(words[start + i])));
}

/**
 * Tables for common words whose entry has none. Ukrainian що and Russian что are filed as conjunctions in the
 * frequency sets, but as "what" they decline like pronouns (для чого, о чём). Used for explanations only.
 */
const BUILT_IN: Partial<Record<LanguageCode, Record<string, Paradigm>>> = {
  uk: { 'що': { kind: 'pronoun', source: 'VocabBuilder', cells: { 'nom|-': ['що'], 'gen|-': ['чого'], 'dat|-': ['чому'], 'acc|-': ['що'], 'ins|-': ['чим'], 'loc|-': ['чому', 'чім'] } } },
  ru: { 'что': { kind: 'pronoun', source: 'VocabBuilder', cells: { 'nom|-': ['что'], 'gen|-': ['чего'], 'dat|-': ['чему'], 'acc|-': ['что'], 'ins|-': ['чем'], 'loc|-': ['чём'] } } },
};

/** The word's own table, or a built-in one for a common word whose entry has none (Ukrainian що, Russian что). */
export function paradigmFor(language: LanguageCode, lemma: string, paradigm: Paradigm | null | undefined): Paradigm | null {
  return paradigm ?? BUILT_IN[language]?.[norm(language, lemma)] ?? null;
}

// ------------------------------------------------------------------ the sentence around the gap

/** Ends a clause for every rule. */
const STRONG = /[.;:!?…¿¡()[\]{}«»"“”„]|\s[-–—]\s|[–—]/g;
/** Ends a clause for case triggers and subject pronouns (commas too). */
const ANY_PUNCTUATION = /[.,;:!?…¿¡()[\]{}«»"“”„]|\s[-–—]\s|[–—]/g;

interface Ctx {
  /** Words before the gap back to the nearest punctuation mark, nearest last. */
  near: string[];
  /** Words before the gap back to the nearest full stop, semicolon, colon, question or exclamation mark. */
  wide: string[];
  /** Words after the gap up to the next punctuation mark. */
  next: string[];
  /** Every word of the sentence but the gap (time words may stand anywhere). */
  all: string[];
}

function words(lang: LanguageCode, s: string): string[] {
  return s
    .split(/\s+/)
    .flatMap((w) => norm(lang, w).split(' '))
    .filter(Boolean);
}

function sentenceContext(lang: LanguageCode, before: string | null | undefined, after: string | null | undefined): Ctx | null {
  if (before == null && after == null) return null;
  const b = before ?? '';
  const a = after ?? '';
  const last = (s: string, re: RegExp) => {
    const parts = s.split(re);
    return parts[parts.length - 1];
  };
  return { near: words(lang, last(b, ANY_PUNCTUATION)), wide: words(lang, last(b, STRONG)), next: words(lang, a.split(ANY_PUNCTUATION)[0]), all: [...words(lang, b), ...words(lang, a)] };
}

// ------------------------------------------------------------------ cases: Russian, Ukrainian, Polish

interface Sense {
  c: Case;
  /** What the preposition means with this case ("where something is (in)"). */
  means: string;
  /** The same, shorter, for the contrast ("the accusative would mean where to"). */
  short: string;
}
interface Prep {
  gloss: string;
  senses: Sense[];
  /** One case almost always, with rare exceptions: "which takes", not "which always takes". */
  usual?: boolean;
}
const only = (c: Case, gloss: string): Prep => ({ gloss, senses: [{ c, means: '', short: '' }] });
const mostly = (c: Case, gloss: string): Prep => ({ gloss, senses: [{ c, means: '', short: '' }], usual: true });
const several = (gloss: string, ...senses: Array<[Case, string, string]>): Prep => ({ gloss, senses: senses.map(([c, means, short]) => ({ c, means, short })) });
function withAliases<T>(table: Record<string, T>, aliases: Record<string, string>): Record<string, T> {
  for (const [alias, of] of Object.entries(aliases)) table[alias] = table[of];
  return table;
}

const RU_PREPS = withAliases<Prep>(
  {
    'без': only('gen', 'without'),
    'для': only('gen', 'for'),
    'до': only('gen', 'until, up to, before'),
    'из': only('gen', 'from, out of'),
    'от': only('gen', 'from, away from'),
    'у': only('gen', 'at, by; у меня = I have'),
    'около': only('gen', 'near, about'),
    'возле': only('gen', 'next to'),
    'кроме': only('gen', 'except'),
    'после': only('gen', 'after'),
    'вместо': only('gen', 'instead of'),
    'против': only('gen', 'against'),
    'среди': only('gen', 'among'),
    'вокруг': only('gen', 'around'),
    'мимо': only('gen', 'past'),
    'из-за': only('gen', 'because of, from behind'),
    'из-под': only('gen', 'from under'),
    'напротив': only('gen', 'opposite'),
    'ради': only('gen', 'for the sake of'),
    'вдоль': only('gen', 'along'),
    'внутри': only('gen', 'inside'),
    'к': only('dat', 'to, towards'),
    'благодаря': only('dat', 'thanks to'),
    'по': mostly('dat', 'along, around, by'),
    'через': only('acc', 'through, across, in (a time)'),
    'про': only('acc', 'about'),
    'сквозь': only('acc', 'through'),
    'о': mostly('loc', 'about'),
    'при': only('loc', 'in the presence of, during'),
    'над': only('ins', 'above, over'),
    'перед': only('ins', 'in front of, before'),
    'между': only('ins', 'between'),
    'в': several('in, into', ['loc', 'where something is (in)', 'where something is'], ['acc', 'where to (into), a day or time (в понедельник), or a game (играть в карты)', 'where to']),
    'на': several('on, to', ['loc', 'where something is (on, at)', 'where something is'], ['acc', 'where to, what something is aimed at (смотреть на, похож на), or for how long (на неделю)', 'where to']),
    'за': several('behind, for', ['ins', 'where something is (behind), or going to get something (за хлебом)', 'where something is'], ['acc', 'where to (behind), what you thank or pay for, or how long something takes (за час)', 'where to, or what for']),
    'под': several('under', ['ins', 'where something is (under)', 'where something is'], ['acc', 'where to (under)', 'where to']),
    'с': several('with, from', ['ins', 'with (together with)', 'with'], ['gen', 'from, off, or since (с утра)', 'from']),
  },
  { 'безо': 'без', 'изо': 'из', 'ото': 'от', 'ко': 'к', 'об': 'о', 'обо': 'о', 'надо': 'над', 'передо': 'перед', 'во': 'в', 'подо': 'под', 'со': 'с' },
);

const UK_PREPS = withAliases<Prep>(
  {
    'без': only('gen', 'without'),
    'для': only('gen', 'for'),
    'до': only('gen', 'to, until'),
    'від': only('gen', 'from'),
    'біля': only('gen', 'near, by'),
    'коло': only('gen', 'near'),
    'після': only('gen', 'after'),
    'замість': only('gen', 'instead of'),
    'крім': only('gen', 'except'),
    'серед': only('gen', 'among'),
    'навколо': only('gen', 'around'),
    'проти': only('gen', 'against'),
    'щодо': only('gen', 'about, concerning'),
    'протягом': only('gen', 'during'),
    'навпроти': only('gen', 'opposite'),
    'уздовж': only('gen', 'along'),
    'з-за': only('gen', 'from behind, because of'),
    'з-під': only('gen', 'from under'),
    'посеред': only('gen', 'in the middle of'),
    'поблизу': only('gen', 'near'),
    'завдяки': only('dat', 'thanks to'),
    'всупереч': only('dat', 'despite'),
    'через': only('acc', 'through, across, because of'),
    'про': only('acc', 'about'),
    'крізь': only('acc', 'through'),
    'повз': only('acc', 'past'),
    'над': only('ins', 'above, over'),
    'перед': only('ins', 'in front of, before'),
    'між': only('ins', 'between'),
    'по': mostly('loc', 'around, along'),
    'при': only('loc', 'at, in the presence of'),
    'з': several('with, from', ['ins', 'with (together with)', 'with'], ['gen', 'from, out of, or off', 'from, out of']),
    'у': several('in, into, at', ['loc', 'where something is (in)', 'where something is'], ['acc', 'where to (into), a day (у понеділок), or a game (грати в карти)', 'where to'], ['gen', 'at someone’s, by (у мене = I have)', 'at someone’s']),
    'на': several('on, to', ['loc', 'where something is (on, at)', 'where something is'], ['acc', 'where to, what something is aimed at (дивитися на, схожий на), or for how long (на тиждень)', 'where to']),
    'за': several('behind, for', ['ins', 'where something is (behind), or following (за мною)', 'where something is'], ['acc', 'what you thank or pay for, how long something takes (за годину), “than” after a comparative (більший за), or where to (behind)', 'what for, or where to']),
    'під': several('under', ['ins', 'where something is (under)', 'where something is'], ['acc', 'where to (under)', 'where to']),
    'о': several('at, against', ['loc', 'at a time (о п’ятій)', 'at a time'], ['acc', 'against (об стіну)', 'against']),
  },
  { 'із': 'з', 'зі': 'з', 'зо': 'з', 'в': 'у', 'окрім': 'крім', 'довкола': 'навколо', 'впродовж': 'протягом', 'вздовж': 'уздовж', 'поміж': 'між', 'об': 'о' },
);

const PL_PREPS = withAliases<Prep>(
  {
    'bez': only('gen', 'without'),
    'dla': only('gen', 'for'),
    'do': only('gen', 'to, into, until'),
    'od': only('gen', 'from, since'),
    'u': only('gen', 'at someone’s (u lekarza)'),
    'obok': only('gen', 'next to'),
    'koło': only('gen', 'near'),
    'około': only('gen', 'about, around'),
    'podczas': only('gen', 'during'),
    'według': only('gen', 'according to'),
    'wśród': only('gen', 'among'),
    'zamiast': only('gen', 'instead of'),
    'oprócz': only('gen', 'apart from'),
    'wokół': only('gen', 'around'),
    'mimo': mostly('gen', 'despite'),
    'naprzeciwko': only('gen', 'opposite'),
    'wzdłuż': only('gen', 'along'),
    'spod': only('gen', 'from under'),
    'zza': only('gen', 'from behind'),
    'blisko': only('gen', 'near'),
    'dzięki': only('dat', 'thanks to'),
    'ku': only('dat', 'towards'),
    'przeciwko': only('dat', 'against'),
    'wbrew': only('dat', 'contrary to'),
    'przez': only('acc', 'through, across, for (a time), by'),
    'przy': only('loc', 'by, at, during'),
    'z': several('with, from', ['ins', 'with (together with)', 'with'], ['gen', 'from, out of, or off', 'from, out of']),
    'na': several('on, to', ['loc', 'where something is (on, at)', 'where something is'], ['acc', 'where to, what something is aimed at (czekać na, patrzeć na), or for how long (na tydzień)', 'where to']),
    'w': several('in', ['loc', 'where something is (in)', 'where something is'], ['acc', 'a day (w poniedziałek), or after verbs like grać w and wierzyć w', 'a day']),
    'o': several('about, at, for', ['loc', 'about (mówić o), or at a time (o piątej)', 'about'], ['acc', 'for or about after verbs like prosić o, pytać o and dbać o', 'for, as after prosić o']),
    'po': several('after, around, for', ['loc', 'after (po obiedzie), or around (po mieście)', 'after, around'], ['acc', 'going to get something (po chleb), or up to (po kolana)', 'going to get something']),
    'nad': several('above, by', ['ins', 'where something is (above, or by a lake or the sea: nad morzem)', 'where something is'], ['acc', 'where to (nad morze)', 'where to']),
    'pod': several('under', ['ins', 'where something is (under, or near a town)', 'where something is'], ['acc', 'where to (under)', 'where to']),
    'przed': several('in front of, before', ['ins', 'in front of or before', 'in front of'], ['acc', 'where to (in front of)', 'where to']),
    'za': several('behind, for', ['ins', 'where something is (behind), or following', 'where something is'], ['acc', 'what you thank or pay for, in (a time from now: za godzinę), or where to (behind)', 'what for, or where to']),
    'między': several('between', ['ins', 'where something is (between)', 'where something is'], ['acc', 'where to (between)', 'where to']),
    'poza': several('outside, beyond', ['ins', 'outside, or apart from', 'outside'], ['acc', 'beyond (where to)', 'beyond']),
  },
  { 'ze': 'z', 'we': 'w', 'nade': 'nad', 'pode': 'pod', 'przede': 'przed', 'prócz': 'oprócz', 'dookoła': 'wokół', 'naprzeciw': 'naprzeciwko', 'przeciw': 'przeciwko' },
);

const PREPS: Record<CaseLang, Record<string, Prep>> = { ru: RU_PREPS, uk: UK_PREPS, pl: PL_PREPS };

/** Two-word prepositions ending in a noun; all take the genitive. */
const COMPOUND_PREPS: Record<CaseLang, Record<string, string>> = {
  ru: { 'с помощью': 'with the help of', 'в течение': 'during', 'во время': 'during', 'в результате': 'as a result of', 'в качестве': 'as', 'в виде': 'in the form of', 'в ходе': 'in the course of', 'на протяжении': 'throughout' },
  uk: { 'за допомогою': 'with the help of', 'під час': 'during', 'у результаті': 'as a result of', 'в результаті': 'as a result of', 'у вигляді': 'in the form of', 'в вигляді': 'in the form of' },
  pl: { 'za pomocą': 'with the help of', 'w ciągu': 'within, during', 'w czasie': 'during', 'z powodu': 'because of', 'w wyniku': 'as a result of', 'w trakcie': 'during', 'na temat': 'about', 'w sprawie': 'about, concerning', 'w postaci': 'in the form of' },
};

/** After у мене, a following є, немає, був… means having: у + genitive. */
const UK_HAVE = set('є немає нема був була було були буде будуть');

/** Words that put what follows in the genitive: one word (нет) or two (не было, nie ma). */
const NEGATION: Record<CaseLang, { single: Record<string, string>; pairs: Record<string, string> }> = {
  ru: { single: { 'нет': 'there is no', 'нету': 'there is no' }, pairs: { 'не было': 'there was no', 'не будет': 'there will be no' } },
  uk: { single: { 'немає': 'there is no', 'нема': 'there is no' }, pairs: { 'не було': 'there was no', 'не буде': 'there will be no' } },
  pl: { single: {}, pairs: { 'nie ma': 'there is no, or does not have', 'nie było': 'there was no', 'nie będzie': 'there will be no' } },
};

const QUANTITY: Record<CaseLang, Record<string, string>> = {
  ru: { 'много': 'a lot of, many', 'мало': 'few, little', 'немного': 'a little, a few', 'немало': 'quite a lot of', 'несколько': 'several', 'сколько': 'how many, how much', 'столько': 'so many, so much', 'больше': 'more', 'меньше': 'less, fewer' },
  uk: { 'багато': 'a lot of, many', 'мало': 'few, little', 'небагато': 'not many', 'трохи': 'a little', 'кілька': 'a few, several', 'декілька': 'a few, several', 'скільки': 'how many, how much', 'стільки': 'so many, so much', 'чимало': 'quite a lot of', 'більше': 'more', 'менше': 'less, fewer' },
  pl: { 'dużo': 'a lot of', 'mało': 'few, little', 'wiele': 'many', 'niewiele': 'not many', 'trochę': 'a little', 'kilka': 'a few, several', 'ile': 'how many, how much', 'tyle': 'so many, so much', 'parę': 'a couple of', 'sporo': 'quite a lot of', 'więcej': 'more', 'mniej': 'less, fewer', 'mnóstwo': 'lots of' },
};
/** Quantity words for things counted one by one: the genitive plural (несколько дней, kilka możliwości). */
const COUNTING: ReadonlySet<string> = set('несколько кілька декілька kilka parę wiele niewiele');

/**
 * Numerals in the form they take when counting (два стола): 2–4 ("few", "both"), one and a half, and 5 up ("many").
 * Russian 2–4 take the genitive singular; Ukrainian and Polish 2–4 the nominative plural; 5 up the genitive plural.
 */
type NumKind = 'few' | 'both' | 'half' | 'many';
const numerals = (groups: Record<NumKind, string>) => Object.fromEntries(Object.entries(groups).flatMap(([kind, list]) => list.split(' ').map((w) => [w, kind as NumKind])));
const NUMERALS: Record<CaseLang, Record<string, NumKind>> = {
  ru: numerals({
    few: 'два две три четыре',
    both: 'оба обе',
    half: 'полтора полторы',
    many: 'пять шесть семь восемь девять десять одиннадцать двенадцать тринадцать четырнадцать пятнадцать шестнадцать семнадцать восемнадцать девятнадцать двадцать тридцать сорок пятьдесят шестьдесят семьдесят восемьдесят девяносто сто двести триста четыреста пятьсот шестьсот семьсот восемьсот девятьсот',
  }),
  uk: numerals({
    few: 'два дві три чотири',
    both: 'обидва обидві',
    half: 'півтора півтори',
    many: "п'ять шість сім вісім дев'ять десять одинадцять дванадцять тринадцять чотирнадцять п'ятнадцять шістнадцять сімнадцять вісімнадцять дев'ятнадцять двадцять тридцять сорок п'ятдесят шістдесят сімдесят вісімдесят дев'яносто сто двісті триста чотириста п'ятсот шістсот сімсот вісімсот дев'ятсот",
  }),
  pl: numerals({
    few: 'dwa dwie trzy cztery dwaj trzej czterej',
    both: 'oba obie obaj',
    half: 'półtora półtorej',
    many: 'pięć sześć siedem osiem dziewięć dziesięć jedenaście dwanaście trzynaście czternaście piętnaście szesnaście siedemnaście osiemnaście dziewiętnaście dwadzieścia trzydzieści czterdzieści pięćdziesiąt sześćdziesiąt siedemdziesiąt osiemdziesiąt dziewięćdziesiąt sto dwieście trzysta czterysta pięćset sześćset siedemset osiemset dziewięćset',
  }),
};

interface VerbRule {
  re: RegExp;
  /** The verb as shown in the reason (its infinitive). */
  inf: string;
  gloss: string;
  /** The cases it takes, with what each is for when it takes several. */
  cases: Partial<Record<Case, string>>;
  /** predicative: what someone is or becomes; transport: the vehicle (jechać autobusem). */
  kind?: 'predicative' | 'transport';
  /** Polish reflexive verb: counts only with się in the clause. */
  reflexive?: boolean;
}

const RU_VERBS: VerbRule[] = [
  { re: /^(помога\S*|помог|помогла|помогло|помогли|помогу|помогут|поможе\S*|помочь|помоги|помогите)$/, inf: 'помогать', gloss: 'to help', cases: { dat: '' } },
  { re: /^(по)?звон(ю|ишь|ит|им|ите|ят|ил|ила|ило|или|ить|и)$/, inf: 'звонить', gloss: 'to phone', cases: { dat: '' } },
  { re: /^(отвеча\S*|отвечу|ответ(ишь|ит|им|ите|ят|ил|ила|или|ить|ь|ьте))$/, inf: 'отвечать', gloss: 'to answer', cases: { dat: '' } },
  { re: /^(по)?совет(ую|уешь|ует|уем|уете|уют|овал|овала|овали|овать|уй|уйте)$/, inf: 'советовать', gloss: 'to advise', cases: { dat: '' } },
  { re: /^(по)?вер(ю|ишь|ит|им|ите|ят|ил|ила|или|ить|ь|ьте)$/, inf: 'верить', gloss: 'to believe, to trust', cases: { dat: '' } },
  { re: /^(по)?меша(ю|ешь|ет|ем|ете|ют|л|ла|ли|ть)$/, inf: 'мешать', gloss: 'to disturb', cases: { dat: '' } },
  { re: /^(об|по)?раду(юсь|ешься|ется|емся|етесь|ются)$|^(об|по)?радова(лся|лась|лись|ться)$/, inf: 'радоваться', gloss: 'to be glad about', cases: { dat: '' } },
  { re: /^(по)?обеща(ю|ешь|ет|ем|ете|ют|л|ла|ли|ть)$/, inf: 'обещать', gloss: 'to promise', cases: { dat: '' } },
  { re: /^спасибо$/, inf: 'спасибо', gloss: 'thank you', cases: { dat: '' } },
  { re: /^(по)?благодар(ю|ишь|ит|им|ите|ят|ил|ила|или|ить)$/, inf: 'благодарить', gloss: 'to thank', cases: { acc: '' } },
  { re: /^бо(юсь|ишься|ится|имся|итесь|ятся|ялся|ялась|ялись|яться)$/, inf: 'бояться', gloss: 'to be afraid of', cases: { gen: '' } },
  { re: /^избега(ю|ешь|ет|ем|ете|ют|л|ла|ли|ть)$/, inf: 'избегать', gloss: 'to avoid', cases: { gen: '' } },
  { re: /^(по)?жела(ю|ешь|ет|ем|ете|ют|л|ла|ли|ть)$/, inf: 'желать', gloss: 'to wish', cases: { dat: 'the person', gen: 'what is wished' } },
  { re: /^(вос)?польз(уюсь|уешься|уется|уемся|уетесь|уются|овался|овалась|овались|оваться)$/, inf: 'пользоваться', gloss: 'to use', cases: { ins: '' } },
  { re: /^(за)?интерес(уюсь|уешься|уется|уемся|уетесь|уются|овался|овалась|овались|оваться)$/, inf: 'интересоваться', gloss: 'to be interested in', cases: { ins: '' } },
  { re: /^(занима|займ|заня)\S*(сь|ся)$/, inf: 'заниматься', gloss: 'to do, to be busy with', cases: { ins: '' } },
  { re: /^(горжусь|горд(ишься|ится|имся|итесь|ятся|ился|илась|ились|иться))$/, inf: 'гордиться', gloss: 'to be proud of', cases: { ins: '' } },
  { re: /^владе(ю|ешь|ет|ем|ете|ют|л|ла|ли|ть)$/, inf: 'владеть', gloss: 'to own, to master', cases: { ins: '' } },
  { re: /^увлека\S*(сь|ся)$/, inf: 'увлекаться', gloss: 'to be keen on', cases: { ins: '' } },
  { re: /^управля(ю|ешь|ет|ем|ете|ют|л|ла|ли|ть)$/, inf: 'управлять', gloss: 'to run, to drive', cases: { ins: '' } },
  { re: /^(был|была|было|были|буду|будешь|будет|будем|будете|будут|быть|будь|будьте)$/, inf: 'быть', gloss: 'to be', cases: { ins: '' }, kind: 'predicative' },
  { re: /^(стал|стала|стало|стали|стану|станешь|станет|станем|станете|станут|стать|стань|станьте|станов(люсь|ишься|ится|имся|итесь|ятся|ился|илась|ились|иться))$/, inf: 'стать', gloss: 'to become', cases: { ins: '' }, kind: 'predicative' },
  { re: /^явля(юсь|ешься|ется|емся|етесь|ются|лся|лась|лись|ться)$/, inf: 'являться', gloss: 'to be', cases: { ins: '' }, kind: 'predicative' },
  { re: /^(по|при)?(еду|едешь|едет|едем|едете|едут|ехал|ехала|ехали|ехать|езжу|ездишь|ездит|ездим|ездите|ездят|ездил|ездила|ездили|ездить)$/, inf: 'ехать', gloss: 'to go by vehicle', cases: { ins: '' }, kind: 'transport' },
];

const UK_VERBS: VerbRule[] = [
  { re: /^(по)?дяку(ю|єш|є|ємо|єте|ють|вав|вала|вали|вати|й|йте)$/, inf: 'дякувати', gloss: 'to thank', cases: { dat: '' } },
  { re: /^(допомага\S*|допоможу|допоможеш|допоможе|допоможемо|допоможете|допоможуть|допоміг|допомогла|допомогло|допомогли|допомогти|допоможи|допоможіть)$/, inf: 'допомагати', gloss: 'to help', cases: { dat: '' } },
  { re: /^(по)?дзвон(ю|иш|ить|имо|ите|ять|ив|ила|или|ити|и|іть)$/, inf: 'дзвонити', gloss: 'to phone', cases: { dat: '' } },
  { re: /^(за)?телефону(ю|єш|є|ємо|єте|ють|вав|вала|вали|вати|й|йте)$/, inf: 'телефонувати', gloss: 'to phone', cases: { dat: '' } },
  { re: /^(відповіда\S*|відповім|відповіси|відповість|відповімо|відповісте|відповідять|відповів|відповіла|відповіли|відповісти)$/, inf: 'відповідати', gloss: 'to answer, to match', cases: { dat: '' } },
  { re: /^(по)?рад(жу|иш|ить|имо|ите|ять|ив|ила|или|ити)$/, inf: 'радити', gloss: 'to advise', cases: { dat: '' } },
  { re: /^заважа(ю|єш|є|ємо|єте|ють|в|ла|ли|ти)$/, inf: 'заважати', gloss: 'to disturb', cases: { dat: '' } },
  { re: /^(по)?вір(ю|иш|ить|имо|ите|ять|ив|ила|или|ити)$/, inf: 'вірити', gloss: 'to believe, to trust', cases: { dat: '' } },
  { re: /^(по)?обіця(ю|єш|є|ємо|єте|ють|в|ла|ли|ти)$/, inf: 'обіцяти', gloss: 'to promise', cases: { dat: '' } },
  { re: /^бо(юся|юсь|їшся|їться|їмося|їмось|їтеся|їтесь|яться|явся|ялася|ялась|ялися|ялись|ятися|ятись)$/, inf: 'боятися', gloss: 'to be afraid of', cases: { gen: '' } },
  { re: /^(с)?корист\S*(ся|сь)$/, inf: 'користуватися', gloss: 'to use', cases: { ins: '' } },
  { re: /^(за)?цікав\S*(ся|сь)$/, inf: 'цікавитися', gloss: 'to be interested in', cases: { ins: '' } },
  { re: /^(займ|зайня)\S*(ся|сь)$/, inf: 'займатися', gloss: 'to do, to be busy with', cases: { ins: '' } },
  { re: /^пиша\S*(ся|сь)$/, inf: 'пишатися', gloss: 'to be proud of', cases: { ins: '' } },
  { re: /^захоплю\S*(ся|сь)$/, inf: 'захоплюватися', gloss: 'to be keen on', cases: { ins: '' } },
  { re: /^керу(ю|єш|є|ємо|єте|ють|вав|вала|вали|вати)$/, inf: 'керувати', gloss: 'to run, to drive', cases: { ins: '' } },
  { re: /^(був|була|було|були|буду|будеш|буде|будемо|будете|будуть|бути|будь|будьте)$/, inf: 'бути', gloss: 'to be', cases: { ins: '' }, kind: 'predicative' },
  { re: /^(став|стала|стало|стали|стану|станеш|стане|станемо|станете|стануть|стати|стань|станьте|стаю|стаєш|стає|стаємо|стаєте|стають|ставав|ставала|ставали|ставати)$/, inf: 'стати', gloss: 'to become', cases: { ins: '' }, kind: 'predicative' },
  { re: /^(по)?(їду|їдеш|їде|їдемо|їдете|їдуть|їхав|їхала|їхали|їхати|їжджу|їздиш|їздить|їздимо|їздите|їздять|їздив|їздила|їздили|їздити)$/, inf: 'їхати', gloss: 'to go by vehicle', cases: { ins: '' }, kind: 'transport' },
];

const PL_VERBS: VerbRule[] = [
  { re: /^(po)?dzięk(uję|ujesz|uje|ujemy|ujecie|ują|owałem|owałam|ował|owała|owaliśmy|owali|owały|ować|uj|ujcie)$/, inf: 'dziękować', gloss: 'to thank', cases: { dat: '' } },
  { re: /^(pomaga\S*|pomogę|pomożesz|pomoże|pomożemy|pomożecie|pomogą|pomogłem|pomogłam|pomógł|pomogła|pomogli|pomogły|pomóc|pomóż|pomóżcie)$/, inf: 'pomagać', gloss: 'to help', cases: { dat: '' } },
  { re: /^(za)?ufa(m|sz|my|cie|ją|ł|ła|li|ły|ć|j|jcie)?$/, inf: 'ufać', gloss: 'to trust', cases: { dat: '' } },
  { re: /^(u)?wierz(ę|ysz|y|ymy|ycie|ą|ył|yła|yli|yły|yć)$/, inf: 'wierzyć', gloss: 'to believe', cases: { dat: '' } },
  { re: /^(po)?radz(ę|isz|i|imy|icie|ą|ił|iła|ili|iły|ić)$/, inf: 'radzić', gloss: 'to advise', cases: { dat: '' } },
  { re: /^przeszkadza(m|sz|my|cie|ją|ł|ła|li|ły|ć|j)?$/, inf: 'przeszkadzać', gloss: 'to disturb', cases: { dat: '' } },
  { re: /^(odpowiada\S*|odpowiem|odpowiesz|odpowie|odpowiemy|odpowiecie|odpowiedzą|odpowiedział\S*|odpowiedzieli|odpowiedziały|odpowiedzieć)$/, inf: 'odpowiadać', gloss: 'to answer', cases: { dat: '' } },
  { re: /^(obieca(m|sz|my|cie|ją|ł|ła|li|ły|ć)?|obiecuj\S*)$/, inf: 'obiecywać', gloss: 'to promise', cases: { dat: '' } },
  { re: /^(po)?szuka(m|sz|my|cie|ją|ł|ła|li|ły|ć|j|jcie)?$/, inf: 'szukać', gloss: 'to look for', cases: { gen: '' } },
  { re: /^(po)?słucha(m|sz|my|cie|ją|ł|ła|li|ły|ć|j|jcie)?$/, inf: 'słuchać', gloss: 'to listen to', cases: { gen: '' } },
  { re: /^(potrzebuj\S*|potrzebowa(ł|ła|li|ły|ć))$/, inf: 'potrzebować', gloss: 'to need', cases: { gen: '' } },
  { re: /^(używa\S*|uży(ję|jesz|je|jemy|jecie|ją|ł|ła|li|ły|ć|j))$/, inf: 'używać', gloss: 'to use', cases: { gen: '' } },
  { re: /^unika(m|sz|my|cie|ją|ł|ła|li|ły|ć|j)?$/, inf: 'unikać', gloss: 'to avoid', cases: { gen: '' } },
  { re: /^(na)?ucz(ę|ysz|y|ymy|ycie|ą|ył|yła|yli|yły|yć)$/, inf: 'uczyć się', gloss: 'to learn', cases: { gen: '' }, reflexive: true },
  { re: /^(bo(ję|isz|i|imy|icie|ją)|bał|bała|bali|bały|bać)$/, inf: 'bać się', gloss: 'to be afraid of', cases: { gen: '' }, reflexive: true },
  { re: /^spodziewa\S*$/, inf: 'spodziewać się', gloss: 'to expect', cases: { gen: '' }, reflexive: true },
  { re: /^życz(ę|ysz|y|ymy|ycie|ą|ył|yła|yli|yły|yć)$/, inf: 'życzyć', gloss: 'to wish', cases: { dat: 'the person', gen: 'what is wished' } },
  { re: /^(za)?interes(uję|ujesz|uje|ujemy|ujecie|ują|ował|owała|owali|owały|ować)$/, inf: 'interesować się', gloss: 'to be interested in', cases: { ins: '' }, reflexive: true },
  { re: /^(zajmuj\S*|zajmowa\S*|zajmę|zajmiesz|zajmie|zajmiemy|zajmiecie|zajmą|zająłem|zajęłam|zajął|zajęła|zajęli|zajęły|zająć)$/, inf: 'zajmować się', gloss: 'to deal with, to do', cases: { ins: '' }, reflexive: true },
  { re: /^(za)?opiek(uję|ujesz|uje|ujemy|ujecie|ują|ował|owała|owali|owały|ować)$/, inf: 'opiekować się', gloss: 'to look after', cases: { ins: '' }, reflexive: true },
  { re: /^(jestem|jesteś|jest|jesteśmy|jesteście|są|byłem|byłam|byłeś|byłaś|był|była|było|byliśmy|byłyśmy|byliście|byłyście|byli|były|będę|będziesz|będzie|będziemy|będziecie|będą|być|bądź|bądźcie)$/, inf: 'być', gloss: 'to be', cases: { ins: '' }, kind: 'predicative' },
  { re: /^(zostanę|zostaniesz|zostanie|zostaniemy|zostaniecie|zostaną|zostałem|zostałam|zostałeś|zostałaś|został|została|zostało|zostaliśmy|zostali|zostały|zostać)$/, inf: 'zostać', gloss: 'to become', cases: { ins: '' }, kind: 'predicative' },
  { re: /^(stanę|staniesz|stanie|staniemy|staniecie|staną|stałem|stałam|stał|stała|stało|stali|stały|stać)$/, inf: 'stać się', gloss: 'to become', cases: { ins: '' }, kind: 'predicative', reflexive: true },
  { re: /^(po)?(jadę|jedziesz|jedzie|jedziemy|jedziecie|jadą|jechałem|jechałam|jechał|jechała|jechali|jechały|jechać|jedź|jedźcie|jeżdżę|jeździsz|jeździ|jeździmy|jeździcie|jeżdżą|jeździłem|jeździłam|jeździł|jeździła|jeździli|jeździły|jeździć)$/, inf: 'jechać', gloss: 'to go by vehicle', cases: { ins: '' }, kind: 'transport' },
];

const VERBS: Record<CaseLang, VerbRule[]> = { ru: RU_VERBS, uk: UK_VERBS, pl: PL_VERBS };
const PREDICATIVE: Record<CaseLang, string> = { ru: 'быть (to be) and стать (to become)', uk: 'бути (to be) and стати (to become)', pl: 'być (to be) and zostać (to become)' };

/** Polish verbs whose object goes in the genitive when negated (nie mam czasu): needed when the form could be a subject. */
const PL_TRANSITIVE_EXACT = set('mam masz mamy macie mają mieć jem jesz je jemy jecie jedzą jeść wiem wiesz wie wiemy wiecie wiedzą dać brać');
const PL_TRANSITIVE_STEMS = ['miał', 'mieli', 'lubi', 'lubię', 'zna', 'widz', 'widzi', 'rozumie', 'chc', 'chci', 'potrzeb', 'kup', 'pij', 'pije', 'pił', 'pić', 'jadł', 'jedli', 'czyta', 'przeczyta', 'pamięta', 'słysz', 'kocha', 'robi', 'robię', 'zrobi', 'dosta', 'znajd', 'znalaz', 'znaleźć', 'ogląda', 'obejrz', 'pisz', 'pisa', 'mówi', 'bior', 'bierz', 'brał', 'otwier', 'otworz', 'zamyka', 'zamkn', 'nosz', 'nosi', 'używa', 'szuka', 'słucha', 'zapomni', 'zapomina', 'zapomnia', 'daj', 'dał', 'wypi', 'zjad', 'zje', 'sprzeda', 'wiedział'];
/** Words after nie that are not transitive verbs (nie tylko, nie jest…). */
const PL_NOT_TRANSITIVE = set('tylko za zbyt bardzo zawsze wszystko każdy jest są był była było były byli będzie będą już jeszcze tak to ten ta tu tam teraz dziś zawsze');

/** The instrumental of these nouns says when (летом = in summer), whatever verb comes before. */
const TIME_NOUNS: Record<CaseLang, Record<string, string>> = {
  ru: { 'утро': 'in the morning', 'вечер': 'in the evening', 'ночь': 'at night', 'день': 'during the day', 'лето': 'in summer', 'зима': 'in winter', 'весна': 'in spring', 'осень': 'in autumn' },
  uk: { 'ранок': 'in the morning', 'вечір': 'in the evening', 'ніч': 'at night', 'день': 'during the day', 'літо': 'in summer', 'зима': 'in winter', 'весна': 'in spring', 'осінь': 'in autumn' },
  pl: { 'ranek': 'in the morning', 'wieczór': 'in the evening', 'noc': 'at night', 'dzień': 'by day', 'lato': 'in summer', 'zima': 'in winter', 'wiosna': 'in spring', 'jesień': 'in autumn' },
};

/**
 * Words the search may pass on its way back from the gap: words that can agree with it (possessives, demonstratives,
 * numerals in their other cases, adjectives by their endings) and a few degree words. Anything else ends the search,
 * so "на улице видел кошку" does not blame на for кошку.
 */
const MODIFIERS: Record<CaseLang, ReadonlySet<string>> = {
  ru: set(`мой моя мое мои моего моей моему моим моими моих мою моем твой твоя твое твои твоего твоей твоему твоим твоими твоих твою твоем
    свой своя свое свои своего своей своему своим своими своих свою своем наш наша наше наши нашего нашей нашему нашим нашими наших нашу нашем
    ваш ваша ваше ваши вашего вашей вашему вашим вашими ваших вашу вашем его ее их этот эта это эти этого этой этому этим этими этих эту этом
    тот та то те того той тому тем теми тех ту том весь вся все всего всей всему всем всеми всех всю один одна одно одни одного одной одному
    одним одними одних одну одном сам сама само сами самого самой самому самим самими самих саму самом чей чья чье чьи чьего чьей чьему чьим
    чьими чьих чью двух двум двумя трех трем тремя четырех четырем четырьмя пяти пятью шести семи восьми девяти десяти обоих обеих обоим обеим
    нескольких нескольким несколькими многих многим многими очень совсем слишком так более менее почти еще`),
  uk: set(`мій моя моє мої мого мойого моєї моєму моїй моїм моїми моїх мою моєю твій твоя твоє твої твого твойого твоєї твоєму твоїй твоїм твоїми
    твоїх твою твоєю свій своя своє свої свого свойого своєї своєму своїй своїм своїми своїх свою своєю наш наша наше наші нашого нашої нашому
    нашій нашим нашими наших нашу нашою ваш ваша ваше ваші вашого вашої вашому вашій вашим вашими ваших вашу вашою його її їх їхній їхня їхнє
    їхні їхнього їхньої їхньому їхнім їхніми їхніх їхню їхньою цей ця це ці цього цієї цьому цій цим цими цих цю цією той та те ті того тієї тому
    тій тим тими тих ту тією весь увесь вся все всі всього всієї всьому всій всім всіма всіх всю всією один одна одне одні одного однієї одному
    одній одним одними одних одну однією сам сама саме самі самого самої самому самій самим самими самих саму самою чий чия чиє чиї чийого чиєї
    чийому чиїй чиїм чиїми чиїх чию чиєю двох двом двома трьох трьом трьома чотирьох чотирьом чотирма п'яти п'ятьох п'ятьом п'ятьма шести семи
    восьми дев'яти десяти кількох кільком кількома багатьох багатьом багатьма обох обом обома дуже зовсім занадто надто так більш менш найбільш
    майже ще`),
  pl: set(`mój moja moje moi mojego mojej mojemu moim moimi moich moją twój twoja twoje twoi twojego twojej twojemu twoim twoimi twoich twoją
    swój swoja swoje swoi swojego swojej swojemu swoim swoimi swoich swoją nasz nasza nasze nasi naszego naszej naszemu naszym naszymi naszych
    naszą wasz wasza wasze wasi waszego waszej waszemu waszym waszymi waszych waszą jego jej ich ten ta to ci te tego tej temu tym tymi tych tę
    tą tamten tamta tamto tamci tamte tamtego tamtej tamtemu tamtym tamtymi tamtych tamtą tamtę wszystko wszyscy wszystkie wszystkiego
    wszystkiemu wszystkim wszystkimi wszystkich jeden jedna jedno jedni jedne jednego jednej jednemu jednym jednymi jednych jedną sam sama samo
    sami same samego samej samemu samym samymi samych samą czyj czyja czyje czyi czyjego czyjej czyjemu czyim czyimi czyich czyją dwóch dwu
    dwom dwóm dwoma dwiema trzech trzem trzema czterech czterem czterema pięciu sześciu siedmiu ośmiu dziewięciu dziesięciu kilku kilkoma
    wielu obu obydwu bardzo zbyt całkiem tak bardziej najbardziej prawie jeszcze się`),
};
/** Personal pronouns: they never agree with a following word, so the search stops at them (без меня книги). */
const PERSONAL: Record<CaseLang, ReadonlySet<string>> = {
  ru: set('я ты он она оно мы вы они меня тебя себя нас вас него нее них мне тебе себе нам вам нему ней ним ними мной мною тобой тобою собой собою нем им ей ему'),
  uk: set('я ти він вона воно ми ви вони мене тебе себе нас вас нього неї них мені тобі собі нам вам йому їй їм ньому ній ним нею ними мною тобою собою нім'),
  pl: set('ja ty on ona ono my wy oni one mnie mi mną ciebie cię tobie tobą siebie sobie sobą go niego jemu mu nim niej nią nas nam nami was wam wami nich im nimi'),
};
const ADJECTIVE_END: Record<CaseLang, RegExp> = {
  ru: /(?:ый|ий|ой|ая|яя|ое|ее|ые|ие|ого|его|ому|ему|ым|им|ом|ем|ую|юю|ых|их|ыми|ими|ей)$/,
  uk: /(?:ий|ій|ого|ього|ому|ьому|ої|ьої|єї|ою|ьою|им|ім|их|іх|ими|іми)$/,
  pl: /(?:ego|emu|ej|ym|im|ych|ich|ymi|imi)$/,
};

function passable(lang: CaseLang, word: string): boolean {
  if (PERSONAL[lang].has(word)) return false;
  if (MODIFIERS[lang].has(word)) return true;
  return [...word].length >= 4 && ADJECTIVE_END[lang].test(word);
}

/**
 * The cases (with number) a word passed on the way back can be in, so that it agrees with the gap: "в повному
 * порядку" (повному: dative or locative singular) leaves порядку only its locative. Null when anything goes (его, очень).
 * Written as "case.number"; endings first, then words whose ending says too much or too little.
 */
const AGREEMENT_ENDINGS: Record<CaseLang, Array<[RegExp, string]>> = {
  ru: [
    [/(ыми|ими)$/, 'ins.pl'],
    [/(ого|его)$/, 'gen.sg acc.sg'],
    [/(ому|ему)$/, 'dat.sg'],
    [/(ых|их)$/, 'gen.pl acc.pl loc.pl'],
    [/(ый|ий)$/, 'nom.sg acc.sg'],
    [/ой$/, 'nom.sg acc.sg gen.sg dat.sg ins.sg loc.sg'],
    [/(ая|яя)$/, 'nom.sg'],
    [/(ое|ее)$/, 'nom.sg acc.sg'],
    [/(ые|ие)$/, 'nom.pl acc.pl'],
    [/(ым|им)$/, 'ins.sg dat.pl'],
    [/(ом|ем)$/, 'loc.sg'],
    [/(ую|юю)$/, 'acc.sg'],
    [/ей$/, 'gen.sg dat.sg ins.sg loc.sg'],
  ],
  uk: [
    [/(ими|іми)$/, 'ins.pl'],
    [/(ого|ього)$/, 'gen.sg acc.sg'],
    [/(ому|ьому)$/, 'dat.sg loc.sg'],
    [/(ої|ьої|єї)$/, 'gen.sg'],
    [/(ою|ьою|єю)$/, 'ins.sg'],
    [/(их|іх)$/, 'gen.pl acc.pl loc.pl'],
    [/ій$/, 'nom.sg acc.sg dat.sg loc.sg'],
    [/ий$/, 'nom.sg acc.sg'],
    [/ім$/, 'ins.sg dat.pl loc.sg'],
    [/им$/, 'ins.sg dat.pl'],
  ],
  pl: [
    [/(ymi|imi)$/, 'ins.pl'],
    [/ego$/, 'gen.sg acc.sg'],
    [/emu$/, 'dat.sg'],
    [/(ych|ich)$/, 'gen.pl loc.pl acc.pl'],
    [/ej$/, 'gen.sg dat.sg loc.sg'],
    [/(ym|im)$/, 'ins.sg loc.sg dat.pl'],
  ],
};
const agreementWords = (groups: Record<string, string>) => new Map(Object.entries(groups).flatMap(([cases, list]) => list.split(/\s+/).filter(Boolean).map((w) => [w, cases] as [string, string])));
const AGREEMENT_WORDS: Record<CaseLang, Map<string, string>> = {
  ru: agreementWords({
    'nom.sg acc.sg': 'мой твой свой наш ваш весь один сам чей этот тот мое твое свое наше ваше это то одно само чье',
    'nom.sg acc.sg nom.pl acc.pl': 'все',
    'nom.sg': 'моя твоя своя наша ваша эта та вся одна сама чья',
    'nom.pl acc.pl': 'мои твои свои наши ваши эти те одни сами чьи',
    'acc.sg': 'мою твою свою нашу вашу эту ту всю одну саму чью',
    'gen.sg dat.sg ins.sg loc.sg': 'этой той одной самой',
    'ins.sg dat.pl': 'тем',
    'ins.sg dat.pl loc.sg': 'всем',
    'gen.pl acc.pl loc.pl': 'всех тех двух трех четырех обоих обеих нескольких многих',
    'dat.pl': 'двум трем четырем обоим обеим нескольким многим',
    'ins.pl': 'двумя тремя четырьмя несколькими многими пятью',
    'gen.pl dat.pl loc.pl': 'пяти шести семи восьми девяти десяти',
    '*': 'его ее их очень совсем слишком так более менее почти еще',
  }),
  uk: agreementWords({
    'nom.sg acc.sg': "мій твій свій наш ваш цей той весь увесь один сам чий моє твоє своє наше ваше це те одне саме чиє все їхнє",
    'nom.sg': 'моя твоя своя наша ваша ця та вся одна сама чия їхня',
    'nom.pl acc.pl': 'мої твої свої наші ваші ці ті всі одні самі чиї їхні',
    'acc.sg': 'мою твою свою нашу вашу цю ту всю одну саму чию їхню',
    'dat.sg loc.sg': 'моїй твоїй своїй нашій вашій цій тій всій одній самій чиїй моєму твоєму своєму',
    'ins.sg dat.pl loc.sg': 'моїм твоїм своїм чиїм',
    'gen.pl acc.pl loc.pl': "моїх твоїх своїх чиїх двох трьох чотирьох обох кількох багатьох п'ятьох",
    'ins.pl': "моїми твоїми своїми чиїми всіма двома трьома чотирма обома кількома багатьма п'ятьма",
    'dat.pl': "двом трьом чотирьом обом кільком багатьом п'ятьом",
    'gen.pl dat.pl loc.pl': "п'яти шести семи восьми дев'яти десяти",
    '*': 'його її їх дуже зовсім занадто надто так більш менш найбільш майже ще',
  }),
  pl: agreementWords({
    'nom.sg acc.sg': 'mój twój swój nasz wasz ten tamten jeden sam czyj to tamto jedno samo wszystko',
    'nom.sg': 'moja twoja swoja nasza wasza ta tamta jedna sama czyja',
    'nom.sg acc.sg nom.pl acc.pl': 'moje twoje swoje nasze wasze czyje',
    'nom.pl acc.pl': 'te tamte jedne same wszystkie',
    'nom.pl': 'moi twoi swoi nasi wasi ci tamci jedni sami czyi wszyscy',
    'acc.sg ins.sg': 'moją twoją swoją naszą waszą tą tamtą jedną samą czyją',
    'acc.sg': 'tę tamtę',
    'gen.pl loc.pl acc.pl nom.pl': 'dwóch trzech czterech',
    'gen.pl dat.pl loc.pl': 'dwu',
    'dat.pl': 'dwom dwóm trzem czterem',
    'ins.pl': 'dwoma dwiema trzema czterema kilkoma',
    '*': 'pięciu sześciu siedmiu ośmiu dziewięciu dziesięciu kilku wielu obu obydwu jego jej ich bardzo zbyt całkiem tak bardziej najbardziej prawie jeszcze się',
  }),
};

function agreement(lang: CaseLang, word: string): ReadonlySet<string> | null {
  const listed = AGREEMENT_WORDS[lang].get(word);
  if (listed) return listed === '*' ? null : set(listed);
  const end = AGREEMENT_ENDINGS[lang].find(([re]) => re.test(word));
  return end ? set(end[1]) : null;
}

function agrees(cell: string, cases: ReadonlySet<string>): boolean {
  const n = numberOf(cell);
  return n ? cases.has(`${caseOf(cell)}.${n}`) : cases.has(`${caseOf(cell)}.sg`) || cases.has(`${caseOf(cell)}.pl`);
}

/**
 * What each case is for in general, as sentences: the same uses as the captions of the declension tables (caseRole in
 * shared/paradigms.ts). Given when nothing in the sentence decides the case.
 */
const CASE_USE: Record<CaseLang, Record<Case, string>> = {
  uk: {
    nom: 'The nominative names the subject: who or what does something',
    gen: 'The genitive means “of” and follows words like немає, без, для, від, до and з (out of)',
    dat: 'The dative marks the person something is given, said or done to or for',
    acc: 'The accusative marks the direct object, and where to after у/в and на',
    ins: 'The instrumental means “with” or “by means of”, and follows з (together with)',
    loc: 'The locative is used after у/в and на for where something is, and after по and при',
    voc: 'The vocative is used to call or address someone',
  },
  ru: {
    nom: 'The nominative names the subject: who or what does something',
    gen: 'The genitive means “of” and follows words like нет, без, для, у, из, от and до',
    dat: 'The dative marks the person something is given, said or done to or for, and follows к and по',
    acc: 'The accusative marks the direct object, and where to after в and на; it also follows через',
    ins: 'The instrumental means “with” or “by means of”, and follows с (together with)',
    loc: 'The prepositional is used after в and на for where something is, and after о (about)',
    voc: 'The vocative is used to call or address someone',
  },
  pl: {
    nom: 'The nominative names the subject: who or what does something',
    gen: 'The genitive means “of” and follows words like nie ma, bez, dla, do, od and z (out of)',
    dat: 'The dative marks the person something is given, said or done to or for',
    acc: 'The accusative marks the direct object, and where to after na; it also follows przez',
    ins: 'The instrumental means “with” or “by means of”, and follows z (together with)',
    loc: 'The locative is used after w and na for where something is, and after o (about)',
    voc: 'The vocative is used to call or address someone',
  },
};

interface Found {
  cells: string[];
  reason: string;
}

/** The cells in one case (and number, when given; pronouns without number always fit). */
function inCase(cells: string[], c: Case, number?: 'sg' | 'pl'): string[] {
  return cells.filter((x) => caseOf(x) === c && (!number || !numberOf(x) || numberOf(x) === number));
}

/** A noun whose accusative plural is its nominative plural names a thing, not a person or an animal. */
function inanimate(p: Paradigm | null): boolean {
  if (p?.kind !== 'noun') return false;
  const same = (a: string, b: string) => !!p.cells[a]?.length && p.cells[a].join() === p.cells[b]?.join();
  return same('acc|pl', 'nom|pl') && !same('acc|pl', 'gen|pl');
}

function prepositionReason(lang: CaseLang, word: string, prep: Prep, cells: string[], ctx: Ctx, p: Paradigm | null): Found | null {
  const allowed = prep.senses.map((s) => s.c as string);
  let got = cells.filter((c) => allowed.includes(caseOf(c)));
  if (!got.length) return null;
  let cases = [...new Set(got.map(caseOf))] as Case[];
  if (prep === UK_PREPS['у'] && cases.length > 1 && cases.includes('gen')) {
    if (UK_HAVE.has(ctx.next[0] ?? '')) {
      // у мене є: у + genitive is having, whatever else the pronoun could be.
      got = inCase(got, 'gen');
      cases = ['gen'];
    } else if (cases.includes('loc') || inanimate(p)) {
      // у + genitive is at someone's: not for a form that is also the place (в повному порядку), nor for a thing (грати в карти).
      got = got.filter((c) => caseOf(c) !== 'gen');
      cases = cases.filter((c) => c !== 'gen');
    }
  }
  const name = (c: Case) => caseLabel(lang, c);
  if (prep.senses.length === 1) return { cells: got, reason: `it follows ${quote(word)} (${prep.gloss}), which ${prep.usual ? '' : 'always '}takes the ${name(cases[0])}` };
  const senses = prep.senses.filter((s) => cases.includes(s.c));
  if (senses.length === 1) {
    const other = prep.senses.find((s) => s.c !== senses[0].c)!;
    return { cells: got, reason: `after ${quote(word)}, the ${name(senses[0].c)} means ${senses[0].means}; the ${name(other.c)} would mean ${other.short}` };
  }
  return { cells: got, reason: `after ${quote(word)}, ${joinAnd(senses.map((s) => `the ${name(s.c)} means ${s.means}`))}` };
}

function verbReason(lang: CaseLang, word: string, rule: VerbRule, cells: string[]): Found | null {
  const allowed = Object.keys(rule.cases);
  const got = cells.filter((c) => allowed.includes(caseOf(c)));
  if (!got.length) return null;
  const cases = [...new Set(got.map(caseOf))] as Case[];
  const name = (c: Case) => caseLabel(lang, c);
  if (rule.kind === 'predicative') return { cells: got, reason: `it follows ${quote(word)}, and after ${PREDICATIVE[lang]}, what someone is or becomes goes in the instrumental` };
  if (rule.kind === 'transport') return { cells: got, reason: `it follows ${quote(word)}, and with ${rule.inf} (${rule.gloss}) the instrumental names the means of transport` };
  const head = word === rule.inf ? `it follows ${quote(word)} (${rule.gloss}), which` : `it follows ${quote(word)}, and ${rule.inf} (${rule.gloss})`;
  if (allowed.length === 1) return { cells: got, reason: `${head} takes the ${name(cases[0])}` };
  if (cases.length === 1) return { cells: got, reason: `${head} takes the ${name(cases[0])} for ${rule.cases[cases[0]]}` };
  return { cells: got, reason: `${head} takes ${joinAnd(cases.map((c) => `the ${name(c)} for ${rule.cases[c]}`))}` };
}

function numeralReason(lang: CaseLang, word: string, kind: NumKind, cells: string[], pkind: ParadigmKind | undefined): Found | null {
  if (kind === 'many') {
    const got = inCase(cells, 'gen', 'pl');
    return got.length ? { cells: got, reason: `it follows ${quote(word)}, and numbers from 5 up take the genitive plural` } : null;
  }
  // 2–4 and one and a half: the rule is about nouns (adjectives after them follow other rules).
  if (pkind !== 'noun') return null;
  const [c, number]: [Case, 'sg' | 'pl'] = kind === 'half' || lang === 'ru' ? ['gen', 'sg'] : ['nom', 'pl'];
  const got = inCase(cells, c, number);
  if (!got.length) return null;
  const what = `the ${caseLabel(lang, c)} ${number === 'sg' ? 'singular' : 'plural'}`;
  if (kind === 'few') return { cells: got, reason: `it follows ${quote(word)}, and after 2, 3 and 4 ${LANGUAGE_NAME[lang]} uses ${what}` };
  return { cells: got, reason: `it follows ${quote(word)} (${kind === 'both' ? 'both' : 'one and a half'}), which takes ${what}` };
}

function polishNegatedVerb(verb: string, cells: string[]): Found | null {
  if (PL_NOT_TRANSITIVE.has(verb) || PL_PREPS[verb]) return null;
  const gen = inCase(cells, 'gen');
  if (!gen.length) return null;
  // Only a known transitive verb settles a form that could also be the subject (nie lubię kawy, not *nie przyszły książki).
  if (cells.some((c) => caseOf(c) === 'nom') && !PL_TRANSITIVE_EXACT.has(verb) && !PL_TRANSITIVE_STEMS.some((s) => verb.startsWith(s))) return null;
  return { cells: gen, reason: `after a negated verb (${quote(`nie ${verb}`)}), Polish puts the object in the genitive` };
}

/** The word before the gap that decides its case, if the sentence shows one. */
function caseTrigger(lang: CaseLang, p: Paradigm | null, all: string[], ctx: Ctx): Found | null {
  const pkind = p?.kind;
  const w = ctx.near;
  const neg = NEGATION[lang];
  // Narrowed by the words passed on the way back, which must agree with the gap.
  let cells = all;
  for (let k = w.length - 1, step = 0; k >= 0 && step < 3; k--, step++) {
    const word = w[k];
    const prev = k > 0 ? w[k - 1] : '';
    const pair = prev ? neg.pairs[`${prev} ${word}`] : undefined;
    if (pair) {
      const got = inCase(cells, 'gen');
      return got.length ? { cells: got, reason: `after ${quote(`${prev} ${word}`)} (${pair}), ${LANGUAGE_NAME[lang]} uses the genitive` } : null;
    }
    const compound = prev ? COMPOUND_PREPS[lang][`${prev} ${word}`] : undefined;
    if (compound) {
      const got = inCase(cells, 'gen');
      return got.length ? { cells: got, reason: `it follows ${quote(`${prev} ${word}`)} (${compound}), which always takes the genitive` } : null;
    }
    const prep = PREPS[lang][word];
    // Polish za before an adjective is mostly "too" (za niskie), not the preposition.
    if (prep && lang === 'pl' && word === 'za' && pkind === 'adjective' && cells.some((c) => caseOf(c) === 'nom')) return null;
    if (prep) return prepositionReason(lang, word, prep, cells, ctx, p);
    if (neg.single[word]) {
      const got = inCase(cells, 'gen');
      return got.length ? { cells: got, reason: `after ${quote(word)} (${neg.single[word]}), ${LANGUAGE_NAME[lang]} uses the genitive` } : null;
    }
    // Quantity words and numerals are part of the phrase: when they do not fit, the search goes on past them.
    const quantity = QUANTITY[lang][word];
    if (quantity) {
      const counting = COUNTING.has(word);
      const got = inCase(cells, 'gen', counting ? 'pl' : undefined);
      if (got.length) return { cells: got, reason: `it follows ${quote(word)} (${quantity}), which takes the genitive${counting ? ' plural' : ''}` };
      continue;
    }
    const numeral = NUMERALS[lang][word];
    if (numeral) {
      const found = numeralReason(lang, word, numeral, cells, pkind);
      if (found) return found;
      continue;
    }
    if (lang === 'pl' && prev === 'nie') {
      const found = polishNegatedVerb(word, cells);
      if (found) return found;
    }
    const rule = VERBS[lang].find((v) => v.re.test(word));
    if (rule) {
      if (rule.reflexive && !w.includes('się') && ctx.next[0] !== 'się') return null;
      return verbReason(lang, word, rule, cells);
    }
    if (!passable(lang, word)) return null;
    const cases = agreement(lang, word);
    if (cases) {
      const agreeing = cells.filter((c) => agrees(c, cases));
      // A word that cannot agree with the gap is not part of its phrase (за допомогою шахрайства).
      if (!agreeing.length) return null;
      cells = agreeing;
    }
  }
  return null;
}

/** Мене не буде, Tomka nie ma: what is absent goes in the genitive, before the negation too. */
function absentTrigger(lang: CaseLang, cells: string[], ctx: Ctx): Found | null {
  const neg = NEGATION[lang];
  const n = ctx.next;
  for (const at of [0, 1]) {
    const negation = neg.single[n[at] ?? ''] ? n[at] : neg.pairs[`${n[at] ?? ''} ${n[at + 1] ?? ''}`] ? `${n[at]} ${n[at + 1]}` : null;
    if (!negation) continue;
    const got = inCase(cells, 'gen');
    return got.length ? { cells: got, reason: `with ${quote(negation)} after it, ${LANGUAGE_NAME[lang]} puts what is absent in the genitive` } : null;
  }
  return null;
}

/** Instrumental of time: утром, летом, wieczorem. */
function timeOfDay(lang: CaseLang, cells: string[], lemma: string, form: string): Found | null {
  const gloss = TIME_NOUNS[lang][norm(lang, lemma)];
  const got = gloss ? inCase(cells, 'ins', 'sg') : [];
  return got.length ? { cells: got, reason: `the instrumental of a time of day or a season says when (${quote(form)} means ${gloss})` } : null;
}

const COLUMN_ORDER = ['m', 'n', 'f', 'sg', 'pl', 'pl.vir', 'pl.nvir', '-'];

/** "genitive singular", "genitive masculine or neuter", "nominative or accusative plural, or genitive singular". */
function casesLabel(lang: CaseLang, cells: string[]): string {
  const byRow = new Map<string, Set<string>>();
  for (const c of cells) {
    if (!byRow.has(rowOf(c))) byRow.set(rowOf(c), new Set());
    byRow.get(rowOf(c))!.add(colOf(c));
  }
  const rows = [...byRow.keys()].sort((a, b) => CASES.indexOf(a.split('.')[0]) - CASES.indexOf(b.split('.')[0]));
  const groups: Array<{ rows: string[]; key: string; cols: string[]; anim: string }> = [];
  for (const r of rows) {
    let cols = [...byRow.get(r)!];
    if (cols.includes('pl.vir') && cols.includes('pl.nvir')) cols = [...cols.filter((c) => c !== 'pl.vir' && c !== 'pl.nvir'), 'pl'];
    cols = [...new Set(cols)].sort((a, b) => COLUMN_ORDER.indexOf(a) - COLUMN_ORDER.indexOf(b));
    const anim = r.endsWith('.anim') ? ' (animate)' : r.endsWith('.inan') ? ' (inanimate)' : '';
    const key = `${cols.join(',')}${anim}`;
    const g = groups.find((x) => x.key === key);
    if (g) g.rows.push(r);
    else groups.push({ rows: [r], key, cols, anim });
  }
  const phrases = groups.map((g) => {
    const cases = joinOr([...new Set(g.rows.map((r) => caseLabel(lang, r.split('.')[0])))]);
    const cols = joinOr(g.cols.map(columnLabel).filter(Boolean));
    return `${cases}${cols ? ` ${cols}` : ''}${g.anim}`;
  });
  if (phrases.length > 1 && phrases.some((x) => x.includes(' or '))) return `${phrases.slice(0, -1).join(', ')}, or ${phrases[phrases.length - 1]}`;
  return joinOr(phrases);
}

const DEGREE_USE: Record<string, { name: (cell: string) => string; use: string }> = {
  short: { name: (cell) => `short form ${columnLabel(colOf(cell))}`.trim(), use: 'Short forms are used after the noun, as what is said about it (книга интересна)' },
  comp: { name: () => 'comparative', use: 'The comparative means “more …”' },
  sup: { name: () => 'superlative', use: 'The superlative means “the most …”' },
};

function explainCase(lang: CaseLang, p: Paradigm | null, all: string[], lemma: string, form: string, ctx: Ctx | null): FormExplanation | null {
  const caseCells = all.filter((c) => CASES.includes(caseOf(c)));
  if (!caseCells.length) {
    const degree = DEGREE_USE[rowOf(all[0])];
    if (!degree) return null;
    const label = degree.name(all[0]);
    return { cells: [all[0]], label, reason: degree.use, fromSentence: false, text: `${quote(form)} is the ${label} of ${quote(lemma)}. ${degree.use}.` };
  }
  // The vocative only counts when nothing else fits: in the plural it repeats the nominative.
  const cells = caseCells.some((c) => caseOf(c) !== 'voc') ? caseCells.filter((c) => caseOf(c) !== 'voc') : caseCells;
  const found = ctx ? (caseTrigger(lang, p, cells, ctx) ?? absentTrigger(lang, cells, ctx) ?? timeOfDay(lang, cells, lemma, form)) : null;
  if (found) {
    const label = casesLabel(lang, found.cells);
    return { cells: found.cells, label, reason: found.reason, fromSentence: true, text: `${quote(form)} is the ${label} of ${quote(lemma)}: ${found.reason}.` };
  }
  const label = casesLabel(lang, cells);
  const cases = [...new Set(cells.map(caseOf))] as Case[];
  if (cases.length === 1) {
    const use = CASE_USE[lang][cases[0]];
    return { cells, label, reason: use, fromSentence: false, text: `${quote(form)} is the ${label} of ${quote(lemma)}. ${use}.` };
  }
  return { cells, label, reason: null, fromSentence: false, text: `${quote(form)} can be the ${label} of ${quote(lemma)}: they are spelled the same.` };
}

// ------------------------------------------------------------------ verbs: Spanish, Portuguese

interface TenseText {
  name: string;
  /** What the tense is for, to follow "used". */
  use: string;
}
const TENSES: Record<string, TenseText> = {
  'ind.pres': { name: 'present indicative', use: 'for what happens now or regularly' },
  'ind.pret': { name: 'preterite', use: 'for a completed action in the past' },
  'ind.impf': { name: 'imperfect indicative', use: 'for an ongoing or repeated action in the past, or to describe the past' },
  'ind.plup': { name: 'simple pluperfect', use: 'mostly in writing, for an action before another past action' },
  'ind.fut': { name: 'future', use: 'for what will happen' },
  'cond': { name: 'conditional', use: 'for what would happen, and for polite requests' },
  'sbjv.pres': { name: 'present subjunctive', use: 'after words of wishing, doubt, feeling or purpose' },
  'imp.aff': { name: 'imperative', use: 'for commands and requests' },
  'imp.neg': { name: 'negative imperative', use: 'for telling someone not to do something' },
  'inf.pers': { name: 'personal infinitive', use: 'for an infinitive with its own subject (para nós sabermos)' },
  'c.ind.fut': { name: 'future perfect', use: 'for what will have happened' },
  'c.cond': { name: 'conditional perfect', use: 'for what would have happened' },
  'nfin|ger': { name: 'gerund', use: 'for an action in progress, or the way something is done' },
  'nfin|inf': { name: 'infinitive', use: 'after other verbs and after prepositions' },
};
const TENSES_BY_LANG: Record<VerbLang, Record<string, TenseText>> = {
  es: {
    'sbjv.impf': { name: 'imperfect subjunctive', use: 'for the subjunctive in the past, and for unreal conditions (si tuviera…)' },
    'sbjv.fut': { name: 'future subjunctive', use: 'today only in legal language and set phrases' },
    'c.ind.perf': { name: 'present perfect', use: 'for a past action that still matters now (he comido)' },
    'c.ind.plup': { name: 'pluperfect', use: 'for an action before another past action (había comido)' },
    'c.sbjv.perf': { name: 'present perfect subjunctive', use: 'for a completed action after a subjunctive trigger (que haya comido)' },
    'c.sbjv.plup': { name: 'pluperfect subjunctive', use: 'for unreal situations in the past (si hubiera sabido)' },
    'part': { name: 'past participle', use: 'with haber in compound tenses (he hablado), and as an adjective' },
  },
  pt: {
    'sbjv.impf': { name: 'imperfect subjunctive', use: 'for the subjunctive in the past, and for unreal conditions (se eu tivesse…)' },
    'sbjv.fut': { name: 'future subjunctive', use: 'after se, quando and similar words about the future (se você quiser)' },
    'c.ind.perf': { name: 'present perfect', use: 'for something repeated or still going on up to now (tenho estudado = I have been studying)' },
    'c.ind.plup': { name: 'pluperfect', use: 'for an action before another past action (tinha comido)' },
    'c.sbjv.perf': { name: 'perfect subjunctive', use: 'for a completed action after a subjunctive trigger (que eu tenha comido)' },
    'c.sbjv.plup': { name: 'pluperfect subjunctive', use: 'for unreal situations in the past (se eu tivesse sabido)' },
    'c.sbjv.fut': { name: 'future perfect subjunctive', use: 'for what will have happened, after se or quando (quando tiver terminado)' },
    'part': { name: 'past participle', use: 'with ter in compound tenses (tenho falado), and as an adjective' },
  },
};
const PARTICIPLE_AGREEMENT: Record<string, string> = { 'part|f.sg': ' (feminine)', 'part|m.pl': ' (masculine plural)', 'part|f.pl': ' (feminine plural)' };

function tenseText(lang: VerbLang, tense: string): TenseText {
  if (tense.startsWith('part|')) {
    const base = TENSES_BY_LANG[lang].part;
    return { name: `${base.name}${PARTICIPLE_AGREEMENT[tense] ?? ''}`, use: base.use };
  }
  return TENSES_BY_LANG[lang][tense] ?? TENSES[tense] ?? { name: tense, use: '' };
}

const VERB_TENSE_ORDER = ['ind.pres', 'ind.pret', 'ind.impf', 'ind.plup', 'ind.fut', 'cond', 'sbjv.pres', 'sbjv.impf', 'sbjv.fut', 'imp.aff', 'imp.neg', 'inf.pers', 'c.ind.perf', 'c.ind.plup', 'c.ind.fut', 'c.cond', 'c.sbjv.perf', 'c.sbjv.plup', 'c.sbjv.fut', 'nfin|ger', 'part|m.sg', 'part|f.sg', 'part|m.pl', 'part|f.pl'];
const PERSON_ORDER = ['1s', '2s', '2s.vos', '3s', '1p', '2p', '3p'];

const PERSON_TEXT: Record<VerbLang, Record<string, string>> = {
  es: { '1s': 'yo (I)', '2s': 'tú (you)', '2s.vos': 'vos (you)', '3s': 'él/ella/usted (he/she/you)', '1p': 'nosotros (we)', '2p': 'vosotros (you all)', '3p': 'ellos/ellas/ustedes (they/you all)' },
  pt: { '1s': 'eu (I)', '2s': 'tu (you)', '3s': 'ele/ela/você (he/she/you)', '1p': 'nós (we)', '2p': 'vós (you all)', '3p': 'eles/elas/vocês (they/you all)' },
};
const IMPERATIVE_TEXT: Record<VerbLang, Record<string, string>> = {
  es: { '2s': 'tú (you)', '2s.vos': 'vos (you)', '3s': 'usted (you)', '1p': 'nosotros (let’s)', '2p': 'vosotros (you all)', '3p': 'ustedes (you all)' },
  pt: { '2s': 'tu (you)', '3s': 'você (you)', '1p': 'nós (let’s)', '2p': 'vós (you all)', '3p': 'vocês (you all)' },
};

/** "nosotros (we)"; persons the variety hardly uses say so: "vosotros (you all; Spain only)". */
function personText(lang: VerbLang, tense: string, person: string): string {
  const base = (tense.startsWith('imp.') ? IMPERATIVE_TEXT : PERSON_TEXT)[lang][person] ?? person;
  const note = personNote(lang, person);
  return note ? base.replace(/\)$/, `; ${note})`) : base;
}
const pronounOnly = (lang: VerbLang, tense: string, person: string) => personText(lang, tense, person).split(' (')[0];

const SUBJECTS: Record<VerbLang, Record<string, string>> = {
  es: { 'yo': '1s', 'tú': '2s', 'vos': '2s.vos', 'él': '3s', 'ella': '3s', 'usted': '3s', 'ud': '3s', 'nosotros': '1p', 'nosotras': '1p', 'vosotros': '2p', 'vosotras': '2p', 'ellos': '3p', 'ellas': '3p', 'ustedes': '3p', 'uds': '3p' },
  pt: { 'eu': '1s', 'tu': '2s', 'ele': '3s', 'ela': '3s', 'você': '3s', 'nós': '1p', 'vós': '2p', 'eles': '3p', 'elas': '3p', 'vocês': '3p' },
};
const ROMANCE_PREPS: Record<VerbLang, ReadonlySet<string>> = { es: set('a de con para por sin en entre hacia sobre contra según'), pt: set('a de com para por sem em entre sobre contra até') };
const CLITICS: Record<VerbLang, ReadonlySet<string>> = { es: set('me te se nos os le les lo la los las'), pt: set('me te se nos vos lhe lhes o a os as') };

const SBJV = ['sbjv.pres', 'sbjv.impf', 'c.sbjv.perf', 'c.sbjv.plup'];

interface MoodTrigger {
  pat: Pat;
  tenses: string[];
  text: (matched: string, tense: string) => string;
  /** A single common word (si, cuando, se, quando): only used when no more specific trigger is found. */
  weak?: boolean;
}
const because = (why: string) => (m: string) => `Here it follows ${quote(m)}: ${why} takes the subjunctive.`;
const conjunction = (gloss: string, always = false) => (m: string) => `Here it follows ${quote(m)} (${gloss}), which ${always ? 'always ' : ''}takes the subjunctive.`;

const ES_QUERER = set('quiero quieres quiere queremos queréis quieren quería querías queríamos querían quise quiso quisiera quisieras quisiéramos quisieran querría querrías querríamos querrían');
const ES_ESPERAR = set('espero esperas espera esperamos esperáis esperan esperaba esperábamos esperaban');
const ES_COPULA = set('es era fue será sería');
const esFuture = (gloss: string) => (m: string) => `Here ${quote(m)} (${gloss}) refers to the future, which takes the subjunctive.`;
const ES_MOOD: MoodTrigger[] = [
  { pat: [ES_QUERER, 'que'], tenses: SBJV, text: because('wanting someone to do something') },
  { pat: [ES_ESPERAR, 'que'], tenses: SBJV, text: because('hoping') },
  { pat: [set('prefiero prefieres prefiere preferimos prefieren prefería preferiría'), 'que'], tenses: SBJV, text: because('preferring') },
  { pat: [set('pido pides pide pedimos piden pedía pedí pediste pidió pidieron'), 'que'], tenses: SBJV, text: because('asking someone to do something') },
  { pat: [set('necesito necesitas necesita necesitamos necesitan necesitaba'), 'que'], tenses: SBJV, text: because('needing someone to do something') },
  { pat: [set('dudo dudas duda dudamos dudan dudaba'), 'que'], tenses: SBJV, text: because('doubt') },
  { pat: ['no', set('creo crees cree creemos creen creía pienso piensas piensa pensamos piensan pensaba'), 'que'], tenses: SBJV, text: because('not believing something') },
  { pat: [set('me te le nos os les'), set('alegra alegran gusta molesta sorprende encanta preocupa importa extraña'), 'que'], tenses: SBJV, text: because('a feeling about something') },
  { pat: [ES_COPULA, set('importante necesario mejor posible imposible probable improbable raro normal bueno malo preciso urgente fundamental increíble lógico natural'), 'que'], tenses: SBJV, text: because('saying something is important, necessary or likely') },
  { pat: [ES_COPULA, 'una', set('pena lástima'), 'que'], tenses: SBJV, text: because('a feeling about something') },
  { pat: ['ojalá'], tenses: SBJV, text: conjunction('hopefully, if only', true) },
  { pat: ['para', 'que'], tenses: SBJV, text: conjunction('so that', true) },
  { pat: ['antes', 'de', 'que'], tenses: SBJV, text: conjunction('before', true) },
  { pat: ['sin', 'que'], tenses: SBJV, text: conjunction('without', true) },
  { pat: ['a', 'menos', 'que'], tenses: SBJV, text: conjunction('unless', true) },
  { pat: ['con', 'tal', 'de', 'que'], tenses: SBJV, text: conjunction('provided that', true) },
  { pat: ['en', 'caso', 'de', 'que'], tenses: SBJV, text: conjunction('in case', true) },
  { pat: ['tal', 'vez'], tenses: SBJV, text: conjunction('maybe') },
  { pat: [set('quizás quizá')], tenses: SBJV, text: conjunction('maybe') },
  { pat: ['como', 'si'], tenses: ['sbjv.impf', 'c.sbjv.plup'], text: (m) => `Here it follows ${quote(m)} (as if), which always takes the imperfect or pluperfect subjunctive.` },
  { pat: ['aunque'], tenses: SBJV, text: (m) => `Here ${quote(m)} with the subjunctive means even if.`, weak: true },
  { pat: ['si'], tenses: ['sbjv.impf', 'c.sbjv.plup'], text: (m, t) => `Here ${quote(m)} (if) introduces something unreal or unlikely, which takes the ${tenseText('es', t).name}.`, weak: true },
  { pat: ['cuando'], tenses: ['sbjv.pres', 'c.sbjv.perf'], text: esFuture('when'), weak: true },
  { pat: ['hasta', 'que'], tenses: ['sbjv.pres', 'c.sbjv.perf'], text: esFuture('until'), weak: true },
  { pat: ['en', 'cuanto'], tenses: ['sbjv.pres', 'c.sbjv.perf'], text: esFuture('as soon as'), weak: true },
  { pat: ['tan', 'pronto', 'como'], tenses: ['sbjv.pres', 'c.sbjv.perf'], text: esFuture('as soon as'), weak: true },
  { pat: ['después', 'de', 'que'], tenses: ['sbjv.pres', 'c.sbjv.perf'], text: esFuture('after'), weak: true },
];

const PT_FUTURE_SBJV = ['sbjv.fut', 'c.sbjv.fut'];
const ptFuture = (gloss: string) => (m: string) => `Here ${quote(m)} (${gloss}) refers to the future, which takes the future subjunctive.`;
const PT_MOOD: MoodTrigger[] = [
  { pat: [set('quero queres quer queremos querem queria querias queríamos queriam quis quisesse quiséssemos quisessem'), 'que'], tenses: SBJV, text: because('wanting someone to do something') },
  { pat: [set('espero esperas espera esperamos esperam esperava esperávamos esperavam'), 'que'], tenses: SBJV, text: because('hoping') },
  { pat: [set('prefiro preferes prefere preferimos preferem preferia'), 'que'], tenses: SBJV, text: because('preferring') },
  { pat: [set('peço pedes pede pedimos pedem pedia pedi pediu pediram'), 'que'], tenses: SBJV, text: because('asking someone to do something') },
  { pat: [set('preciso precisa precisamos precisam precisava'), 'que'], tenses: SBJV, text: because('needing someone to do something') },
  { pat: [set('duvido duvidas duvida duvidamos duvidam'), 'que'], tenses: SBJV, text: because('doubt') },
  { pat: ['não', set('acho achas acha achamos acham achava creio penso pensa pensamos pensam'), 'que'], tenses: SBJV, text: because('not believing something') },
  { pat: [set('é era foi será seria'), set('importante necessário melhor possível impossível provável improvável preciso bom ruim fundamental normal natural'), 'que'], tenses: SBJV, text: because('saying something is important, necessary or likely') },
  { pat: ['tomara', 'que'], tenses: SBJV, text: conjunction('hopefully', true) },
  { pat: ['oxalá'], tenses: SBJV, text: conjunction('hopefully', true) },
  { pat: ['quem', 'dera'], tenses: ['sbjv.impf', 'c.sbjv.plup'], text: conjunction('if only', true) },
  { pat: ['para', 'que'], tenses: SBJV, text: conjunction('so that', true) },
  { pat: ['antes', 'que'], tenses: SBJV, text: conjunction('before', true) },
  { pat: ['sem', 'que'], tenses: SBJV, text: conjunction('without', true) },
  { pat: ['a', 'menos', 'que'], tenses: SBJV, text: conjunction('unless', true) },
  { pat: ['mesmo', 'que'], tenses: SBJV, text: conjunction('even if', true) },
  { pat: ['embora'], tenses: SBJV, text: conjunction('although', true) },
  { pat: ['talvez'], tenses: SBJV, text: conjunction('maybe') },
  { pat: ['como', 'se'], tenses: ['sbjv.impf', 'c.sbjv.plup'], text: (m) => `Here it follows ${quote(m)} (as if), which always takes the imperfect or pluperfect subjunctive.` },
  { pat: ['caso'], tenses: ['sbjv.pres', 'sbjv.impf'], text: conjunction('in case'), weak: true },
  {
    pat: ['se'],
    tenses: ['sbjv.impf', 'sbjv.fut', 'c.sbjv.plup', 'c.sbjv.fut'],
    text: (m, t) => (t.includes('fut') ? `Here ${quote(m)} (if) refers to the future, which takes the ${tenseText('pt', t).name}.` : `Here ${quote(m)} (if) introduces something unreal or unlikely, which takes the ${tenseText('pt', t).name}.`),
    weak: true,
  },
  { pat: ['quando'], tenses: PT_FUTURE_SBJV, text: ptFuture('when'), weak: true },
  { pat: ['enquanto'], tenses: PT_FUTURE_SBJV, text: ptFuture('while, as long as'), weak: true },
  { pat: ['assim', 'que'], tenses: PT_FUTURE_SBJV, text: ptFuture('as soon as'), weak: true },
  { pat: ['logo', 'que'], tenses: PT_FUTURE_SBJV, text: ptFuture('as soon as'), weak: true },
  { pat: ['sempre', 'que'], tenses: PT_FUTURE_SBJV, text: ptFuture('whenever'), weak: true },
  { pat: ['depois', 'que'], tenses: PT_FUTURE_SBJV, text: ptFuture('after'), weak: true },
];
const MOOD: Record<VerbLang, MoodTrigger[]> = { es: ES_MOOD, pt: PT_MOOD };

/** The nearest trigger of the subjunctive at most six words before the gap that fits one of its cells. */
function moodTrigger(lang: VerbLang, cells: string[], ctx: Ctx): { cells: string[]; text: string } | null {
  const w = ctx.wide;
  for (const weak of [false, true]) {
    let best: { e: number; t: MoodTrigger; fit: string[] } | null = null;
    for (const t of MOOD[lang]) {
      if (!!t.weak !== weak) continue;
      const fit = cells.filter((c) => t.tenses.includes(tenseOf(c)));
      if (!fit.length) continue;
      for (let e = w.length - 1; e >= Math.max(0, w.length - 7); e--) {
        if (matchAt(w, e, t.pat)) {
          if (!best || e > best.e) best = { e, t, fit };
          break;
        }
      }
    }
    if (best) {
      const matched = w.slice(best.e - best.t.pat.length + 1, best.e + 1).join(' ');
      return { cells: best.fit, text: best.t.text(matched, tenseOf(best.fit[0])) };
    }
  }
  return null;
}

const ES_ESTAR = set('estoy estás está estamos estáis están estaba estabas estábamos estabais estaban estuve estuviste estuvo estuvimos estuvieron estaré estarás estará estaremos estarán estaría estarías estaríamos estarían esté estés estemos estén estuviera estar');
const PT_ESTAR = set('estou estás está estamos estão estava estavas estávamos estavam estive esteve estivemos estiveram estarei estarás estará estaremos estarão estaria estaríamos estariam esteja estejas estejamos estejam estivesse estar');
const ESTAR: Record<VerbLang, ReadonlySet<string>> = { es: ES_ESTAR, pt: PT_ESTAR };
const KEEP_DOING: Record<VerbLang, ReadonlySet<string>> = {
  es: set('sigo sigues sigue seguimos siguen seguía seguían siguió seguir continúo continúas continúa continuamos continúan continuaba continuó continuar'),
  pt: set('sigo segues segue seguimos seguem seguia seguiu seguir continuo continuas continua continuamos continuam continuava continuou continuar fico ficas fica ficamos ficam ficava ficou ficar'),
};
const BETWEEN: Record<VerbLang, ReadonlySet<string>> = { es: set('todavía aún ya también siempre'), pt: set('ainda já também sempre') };
const perfect = (groups: Record<string, string>) => Object.fromEntries(Object.entries(groups).flatMap(([name, list]) => list.split(' ').map((w) => [w, name])));
const PERFECT_AUX: Record<VerbLang, Record<string, string>> = {
  es: perfect({
    'present perfect': 'he has ha hemos habéis han',
    'pluperfect': 'había habías habíamos habíais habían',
    'future perfect': 'habré habrás habrá habremos habréis habrán',
    'conditional perfect': 'habría habrías habríamos habríais habrían',
    'present perfect subjunctive': 'haya hayas hayamos hayáis hayan',
    'pluperfect subjunctive': 'hubiera hubieras hubiéramos hubierais hubieran hubiese hubieses hubiésemos hubieseis hubiesen',
    'perfect infinitive': 'haber',
    'perfect gerund': 'habiendo',
  }),
  pt: perfect({
    'present perfect': 'tenho tens tem temos tendes têm',
    'pluperfect': 'tinha tinhas tínhamos tínheis tinham havia havias havíamos havíeis haviam',
    'future perfect': 'terei terás terá teremos tereis terão',
    'conditional perfect': 'teria terias teríamos teríeis teriam',
    'perfect subjunctive': 'tenha tenhas tenhamos tenhais tenham',
    'pluperfect subjunctive': 'tivesse tivesses tivéssemos tivésseis tivessem',
    'future perfect subjunctive': 'tiver tiveres tivermos tiverdes tiverem',
    'perfect infinitive': 'ter',
    'perfect gerund': 'tendo',
  }),
};
const SER_ESTAR: Record<VerbLang, ReadonlySet<string>> = {
  es: set('es son era eran fue fueron será serán sería sido ser soy eres somos está están estaba estaban estuvo estará estar estoy estás estamos queda quedan quedó quedaron'),
  pt: set('é são era eram foi foram será serão seria sido ser sou és somos está estão estava estavam esteve estará estar estou estamos fica ficam ficou ficaram'),
};

/** estar + gerund, haber + participle, ser/estar + participle: the reason replaces the tense's general use. */
function construction(lang: VerbLang, cells: string[], form: string, ctx: Ctx): string | null {
  const w = ctx.near.filter((x) => !CLITICS[lang].has(x));
  const last = w[w.length - 1] ?? '';
  if (cells.includes('nfin|ger')) {
    const aux = BETWEEN[lang].has(last) ? (w[w.length - 2] ?? '') : last;
    if (ESTAR[lang].has(aux)) return `after ${quote(aux)}${aux === 'estar' ? '' : ' (estar)'}, it describes an action in progress`;
    if (KEEP_DOING[lang].has(aux)) return `after ${quote(aux)}, it means to keep doing something`;
  }
  if (cells.some((c) => c.startsWith('part|'))) {
    const tense = PERFECT_AUX[lang][last];
    if (tense) return `after ${quote(last)}, it forms the ${tense} (${last} ${form})`;
    if (SER_ESTAR[lang].has(last)) return `after ${quote(last)}, it works like an adjective and agrees with the noun it describes`;
  }
  return null;
}

type TimeKind = 'past' | 'future' | 'now' | 'habit';
interface TimeWord {
  pat: Pat;
  kind: TimeKind;
  gloss: (m: string[]) => string;
}
const UNIT_EN: Record<string, string> = {
  año: 'year', semana: 'week', mes: 'month', verano: 'summer', invierno: 'winter', otoño: 'autumn', primavera: 'spring', día: 'day', días: 'day', vez: 'time',
  lunes: 'Monday', martes: 'Tuesday', miércoles: 'Wednesday', jueves: 'Thursday', viernes: 'Friday', sábado: 'Saturday', domingo: 'Sunday',
  mañana: 'morning', mañanas: 'morning', noche: 'night', noches: 'night', tarde: 'afternoon', tardes: 'afternoon',
  ano: 'year', mês: 'month', verão: 'summer', inverno: 'winter', outono: 'autumn', dia: 'day', dias: 'day', segunda: 'Monday', terça: 'Tuesday', quarta: 'Wednesday', quinta: 'Thursday', sexta: 'Friday', manhã: 'morning', noite: 'night',
};
const ES_UNITS = set('año semana mes verano invierno otoño primavera lunes martes miércoles jueves viernes sábado domingo vez');
const PT_UNITS = set('ano semana mês verão inverno outono primavera domingo segunda terça quarta quinta sexta sábado vez');
const TIME_WORDS: Record<VerbLang, TimeWord[]> = {
  es: [
    { pat: ['ayer'], kind: 'past', gloss: () => 'yesterday' },
    { pat: ['anoche'], kind: 'past', gloss: () => 'last night' },
    { pat: [set('anteayer antier')], kind: 'past', gloss: () => 'the day before yesterday' },
    { pat: [set('el la'), ES_UNITS, set('pasado pasada')], kind: 'past', gloss: (m) => `last ${UNIT_EN[m[1]]}` },
    { pat: ['mañana'], kind: 'future', gloss: () => 'tomorrow' },
    { pat: [set('la el'), set('próxima próximo'), ES_UNITS], kind: 'future', gloss: (m) => `next ${UNIT_EN[m[2]]}` },
    { pat: [set('la el'), ES_UNITS, 'que', 'viene'], kind: 'future', gloss: (m) => `next ${UNIT_EN[m[1]]}` },
    { pat: ['ahora'], kind: 'now', gloss: () => 'now' },
    { pat: ['hoy', 'en', 'día'], kind: 'now', gloss: () => 'nowadays' },
    { pat: ['actualmente'], kind: 'now', gloss: () => 'currently' },
    { pat: [set('todos todas'), set('los las'), set('días lunes martes miércoles jueves viernes sábados domingos mañanas noches tardes')], kind: 'habit', gloss: (m) => `every ${UNIT_EN[m[2]] ?? m[2]}` },
    { pat: ['cada', set('día semana mes año mañana noche tarde')], kind: 'habit', gloss: (m) => `every ${UNIT_EN[m[1]]}` },
    { pat: [set('normalmente generalmente usualmente')], kind: 'habit', gloss: () => 'usually' },
    { pat: ['por', 'lo', 'general'], kind: 'habit', gloss: () => 'usually' },
  ],
  pt: [
    { pat: ['ontem'], kind: 'past', gloss: () => 'yesterday' },
    { pat: ['anteontem'], kind: 'past', gloss: () => 'the day before yesterday' },
    { pat: [PT_UNITS, set('passado passada')], kind: 'past', gloss: (m) => `last ${UNIT_EN[m[0]]}` },
    { pat: ['amanhã'], kind: 'future', gloss: () => 'tomorrow' },
    { pat: [set('próximo próxima'), PT_UNITS], kind: 'future', gloss: (m) => `next ${UNIT_EN[m[1]]}` },
    { pat: [PT_UNITS, 'que', 'vem'], kind: 'future', gloss: (m) => `next ${UNIT_EN[m[0]]}` },
    { pat: ['agora'], kind: 'now', gloss: () => 'now' },
    { pat: ['hoje', 'em', 'dia'], kind: 'now', gloss: () => 'nowadays' },
    { pat: ['atualmente'], kind: 'now', gloss: () => 'currently' },
    { pat: ['todos', 'os', 'dias'], kind: 'habit', gloss: () => 'every day' },
    { pat: ['todo', 'dia'], kind: 'habit', gloss: () => 'every day' },
    { pat: ['cada', set('dia semana mês ano manhã noite')], kind: 'habit', gloss: (m) => `every ${UNIT_EN[m[1]]}` },
    { pat: [set('normalmente geralmente')], kind: 'habit', gloss: () => 'usually' },
    { pat: ['em', 'geral'], kind: 'habit', gloss: () => 'usually' },
  ],
};
/** Spanish mañana is "tomorrow" unless it is "the morning" (la mañana, esta mañana, cada mañana…). */
const MORNING_BEFORE = set('la esta una cada toda esa aquella misma');
const TIME_TENSES: Record<TimeKind, string[]> = {
  past: ['ind.pret', 'ind.impf', 'ind.plup', 'c.ind.plup'],
  future: ['ind.fut', 'c.ind.fut', 'ind.pres'],
  now: ['ind.pres'],
  habit: ['ind.pres', 'ind.impf'],
};

function timeWords(lang: VerbLang, all: string[]): Array<{ kind: TimeKind; text: string; gloss: string }> {
  const out: Array<{ kind: TimeKind; text: string; gloss: string }> = [];
  for (let e = 0; e < all.length; e++) {
    for (const t of TIME_WORDS[lang]) {
      if (!matchAt(all, e, t.pat)) continue;
      const m = all.slice(e - t.pat.length + 1, e + 1);
      if (lang === 'es' && t.pat.length === 1 && m[0] === 'mañana' && MORNING_BEFORE.has(all[e - 1] ?? '')) continue;
      out.push({ kind: t.kind, text: m.join(' '), gloss: t.gloss(m) });
    }
  }
  return out;
}

/** A time word that fits one tense of the form (ayer: the preterite of hablamos, not its present). */
function timeReason(lang: VerbLang, cells: string[], ctx: Ctx): { cells: string[]; text: string } | null {
  const fits = timeWords(lang, ctx.all)
    .map((f) => ({ f, fit: cells.filter((c) => TIME_TENSES[f.kind].includes(tenseOf(c))) }))
    .filter((x) => x.fit.length);
  if (!fits.length) return null;
  const left = [...new Set(fits.flatMap((x) => x.fit))];
  const tenses = [...new Set(left.map(tenseOf))];
  // Time words pointing to different tenses (ayer … mañana) leave the tense to the reader.
  if (tenses.length !== 1) return null;
  const { f } = fits[0];
  const tense = tenses[0];
  const w = `${quote(f.text)} (${f.gloss})`;
  const text =
    f.kind === 'past'
      ? `Here ${w} puts it in the past.`
      : f.kind === 'future'
        ? tense === 'ind.pres'
          ? `Here the present is used for a planned future: ${w}.`
          : `Here ${w} puts it in the future.`
        : f.kind === 'now'
          ? `Here ${w} points to the present.`
          : tense === 'ind.impf'
            ? `Here ${w} marks a habit in the past.`
            : `Here ${w} marks a habit.`;
  return { cells: left, text };
}

/** Words that open a clause of their own: a pronoun before them belongs to another verb (tú eres el que adora). */
const CLAUSE_OPENERS: Record<VerbLang, ReadonlySet<string>> = {
  es: set('que quien quienes cual cuales donde cuando como porque si aunque mientras y o pero'),
  pt: set('que quem qual quais onde quando como porque se embora enquanto e ou mas'),
};

function subjectPronoun(lang: VerbLang, ctx: Ctx): { word: string; person: string } | null {
  const w = ctx.near;
  const map = SUBJECTS[lang];
  for (let k = w.length - 1; k >= Math.max(0, w.length - 4); k--) {
    if (CLAUSE_OPENERS[lang].has(w[k])) break;
    if (lang === 'pt' && w[k] === 'gente' && w[k - 1] === 'a' && !ROMANCE_PREPS.pt.has(w[k - 2] ?? '')) return { word: 'a gente', person: '3s' };
    const person = map[w[k]];
    if (person && !ROMANCE_PREPS[lang].has(w[k - 1] ?? '')) return { word: w[k], person };
  }
  const n = ctx.next[0];
  return n && map[n] ? { word: n, person: map[n] } : null;
}

function subjectText(lang: VerbLang, s: { word: string; person: string }): string {
  if (s.word === 'a gente') return 'The subject is “a gente” (we), which takes the third-person singular.';
  if (['usted', 'ud', 'você'].includes(s.word)) return `The subject is ${quote(s.word)}, which takes the third-person form.`;
  if (['ustedes', 'uds', 'vocês'].includes(s.word)) return `The subject is ${quote(s.word)}, which takes the third-person plural.`;
  return `The subject is ${quote(s.word)}.`;
}

/**
 * Cells worth naming: vos is regional in Colombia and shares many forms with other persons (hablaste, recibí), so it
 * is named only when the form is vos's alone or the subject is vos; a rare tense with the same spelling as a common
 * one (Portuguese falaram: preterite, not the literary simple pluperfect) is left out.
 */
function tidyVerbCells(lang: VerbLang, cells: string[], keepVos: boolean): string[] {
  let out = keepVos || cells.every((c) => personOf(c) === '2s.vos') ? cells : cells.filter((c) => personOf(c) !== '2s.vos');
  const rare = lang === 'es' ? ['sbjv.fut'] : ['ind.plup'];
  if (out.some((c) => !rare.includes(tenseOf(c)))) out = out.filter((c) => !rare.includes(tenseOf(c)));
  return out;
}

function verbGroups(cells: string[]): Array<{ tense: string; persons: string[] }> {
  const groups = new Map<string, string[]>();
  for (const c of cells) {
    const t = tenseOf(c);
    if (!groups.has(t)) groups.set(t, []);
    if (personOf(c)) groups.get(t)!.push(personOf(c));
  }
  return [...groups.entries()]
    .sort(([a], [b]) => VERB_TENSE_ORDER.indexOf(a) - VERB_TENSE_ORDER.indexOf(b))
    .map(([tense, persons]) => ({ tense, persons: [...new Set(persons)].sort((a, b) => PERSON_ORDER.indexOf(a) - PERSON_ORDER.indexOf(b)) }));
}

const KNOWN_VERB_ROWS = new Set([...VERB_TENSE_ORDER.filter((t) => !t.includes('|')), 'nfin', 'part']);

/**
 * exact: `all` is the sentence's exact cell alone (explainExact), and only a reason for that cell is looked for. Every
 * step below keeps a subset of the cells, except the negative command, which then has to be that cell.
 */
function explainVerb(lang: VerbLang, p: Paradigm | null, all: string[], lemma: string, form: string, ctx: Ctx | null, exact = false): FormExplanation | null {
  let cells = all.filter((c) => c !== 'nfin|inf' && KNOWN_VERB_ROWS.has(rowOf(c)));
  if (!cells.length) return null;
  const initial = tidyVerbCells(lang, cells, false);
  const reasons: string[] = [];
  let colon: string | null = null;
  let subject: { word: string; person: string } | null = null;
  if (ctx) {
    const near = ctx.near.filter((x) => !CLITICS[lang].has(x));
    const no = lang === 'es' ? 'no' : 'não';
    // A negative command: no + the present subjunctive (no hables), the form the table files as "no hables".
    const negative =
      near.length === 1 && near[0] === no && p ? cellsOf(lang, p, `${no} ${form}`).filter((c) => rowOf(c) === 'imp.neg' && (!exact || cells.includes(c))) : [];
    if (negative.length) {
      cells = negative;
      colon = `with ${quote(no)}, a command uses the present subjunctive form (${no} ${form})`;
    } else {
      // A command opens its clause, with any pronouns after it (háblame): with a subject, a pronoun or anything else
      // before the verb, it is not the imperative. Nor is it for the auxiliary haber.
      const opens = !ctx.near.length || ctx.near.join(' ') === 'por favor';
      const notCommand = cells.filter((c) => !rowOf(c).startsWith('imp.'));
      if (notCommand.length && notCommand.length < cells.length && (!opens || norm(lang, lemma) === 'haber')) cells = notCommand;
      const mood = moodTrigger(lang, cells, ctx);
      if (mood) {
        cells = mood.cells;
        reasons.push(mood.text);
      } else {
        const prev = near[near.length - 1] ?? '';
        const prep = SUBJECTS[lang][prev] ? (near[near.length - 2] ?? '') : prev;
        if (lang === 'pt' && cells.some((c) => rowOf(c) === 'inf.pers') && set('para sem por até de ao após').has(prep)) {
          cells = cells.filter((c) => rowOf(c) === 'inf.pers');
          reasons.push(`Here it follows ${quote(prep)}: after a preposition, the infinitive can take a personal ending for its subject.`);
        } else if (cells.some((c) => rowOf(c) === 'imp.aff') && cells.some((c) => rowOf(c) === 'sbjv.pres') && opens) {
          // A present subjunctive needs a word that calls for it; opening the sentence without one, it is a command.
          cells = cells.filter((c) => rowOf(c) !== 'sbjv.pres');
          reasons.push('Nothing before it calls for the subjunctive, so here it is a command.');
        } else {
          const time = timeReason(lang, cells, ctx);
          if (time) {
            cells = time.cells;
            reasons.push(time.text);
          }
        }
      }
      colon = construction(lang, cells, form, ctx);
    }
    subject = subjectPronoun(lang, ctx);
    if (subject) {
      // A command has no subject before it: a subject pronoun picks among the other cells.
      const fit = cells.filter((c) => personOf(c) === subject!.person && !rowOf(c).startsWith('imp.'));
      const third = ['usted', 'ud', 'ustedes', 'uds', 'você', 'vocês', 'a gente'].includes(subject.word);
      if (!fit.length) subject = null;
      else {
        const narrowed = fit.length < cells.length;
        cells = fit;
        if (narrowed || third || (!reasons.length && !colon)) reasons.push(subjectText(lang, subject));
      }
    }
  }
  cells = tidyVerbCells(lang, cells, subject?.person === '2s.vos');
  const groups = verbGroups(cells);
  // What the sentence ruled out that is spelled the same, said in passing.
  const before = verbGroups(initial);
  // The imperative shares a spelling with the present or the subjunctive in most persons: naming it each time is noise.
  const droppedTenses = before.filter((g) => !groups.some((x) => x.tense === g.tense) && !g.tense.startsWith('imp.')).map((g) => tenseText(lang, g.tense).name);
  const droppedPersons = groups.length === 1 ? (before.find((g) => g.tense === groups[0].tense)?.persons ?? []).filter((x) => !groups[0].persons.includes(x)) : [];
  if (reasons.length && !negativeOnly(colon, lang)) {
    const note = droppedTenses.length
      ? `the ${joinOr(droppedTenses)} ${droppedTenses.length > 1 ? 'are' : 'is'} spelled the same`
      : droppedPersons.length
        ? `${joinOr(droppedPersons.map((x) => pronounOnly(lang, groups[0].tense, x)))} ${droppedPersons.length > 1 ? 'have' : 'has'} the same form`
        : null;
    if (note) reasons[reasons.length - 1] = reasons[reasons.length - 1].replace(/\.$/, ` (${note}).`);
  }
  const persons = (g: { tense: string; persons: string[] }) => joinOr(g.persons.map((x) => personText(lang, g.tense, x)));
  const extra = reasons.length ? ` ${reasons.join(' ')}` : '';
  if (groups.length === 1) {
    const g = groups[0];
    const t = tenseText(lang, g.tense);
    const who = g.persons.length ? `, ${persons(g)}` : '';
    const label = `${t.name}${who}`;
    const text = colon ? `${quote(form)} is the ${t.name} of ${quote(lemma)}${who}: ${colon}.${extra}` : `${quote(form)} is the ${t.name} of ${quote(lemma)}${who}, used ${t.use}.${extra}`;
    return { cells, label, reason: colon ?? (reasons.join(' ') || t.use), fromSentence: !!colon || reasons.length > 0, text };
  }
  const label = groups.map((g) => `${tenseText(lang, g.tense).name}${g.persons.length ? `, ${persons(g)}` : ''}`).join('; ');
  const samePersons = groups.every((g) => g.persons.join() === groups[0].persons.join());
  const text = samePersons
    ? `${quote(form)} can be the ${joinOr(groups.map((g) => tenseText(lang, g.tense).name))} of ${quote(lemma)}${groups[0].persons.length ? `, ${persons(groups[0])}` : ''}: they are spelled the same.${extra}`
    : `${quote(form)} can be the ${joinOr(groups.map((g, i) => `${i ? 'the ' : ''}${tenseText(lang, g.tense).name}${g.persons.length ? ` for ${persons(g)}` : ''}`))} of ${quote(lemma)}: they are spelled the same.${extra}`;
  return { cells, label, reason: reasons.join(' ') || null, fromSentence: reasons.length > 0, text };
}

/**
 * Spanish pronouns join the end of an infinitive, a gerund or a command (ponerme, diciéndole, espérame, vámonos),
 * often with a written accent that keeps the stress. Finds the bare form in the table and explains the join.
 */
const ES_CLITIC = /^(me|te|se|nos|os|le|les|lo|la|los|las)/;
function attachedPronouns(p: Paradigm, form: string, lemma: string): FormExplanation | null {
  const k = canonical(form, 'es');
  const fold = (s: string) => foldLatinDiacritics(canonical(s, 'es'));
  for (let cut = 1; cut < k.length; cut++) {
    const base = k.slice(0, cut);
    let rest = k.slice(cut);
    const pronouns: string[] = [];
    while (rest && pronouns.length < 2) {
      const m = ES_CLITIC.exec(rest);
      // Longest pronoun first, so "los" is not read as "lo" + "s".
      const pick = m ? (['les', 'los', 'las', 'nos', m[1]].find((x) => rest.startsWith(x) && (rest.length === x.length || ES_CLITIC.test(rest.slice(x.length)))) ?? '') : '';
      if (!pick) break;
      pronouns.push(pick);
      rest = rest.slice(pick.length);
    }
    if (rest || !pronouns.length) continue;
    const plain = fold(base);
    // The command loses its final s before nos (vámonos) and its final d before os (sentaos, the vosotros command).
    const bareOf = (c: string) =>
      c === 'nfin|inf' || c === 'nfin|ger' ? [plain] : !c.startsWith('imp.aff|') ? [] : pronouns[0] === 'os' ? [`${plain}d`] : pronouns[0] === 'nos' ? [plain, `${plain}s`] : [plain];
    const cells = Object.entries(p.cells)
      .filter(([c, forms]) => forms.some((f) => bareOf(c).includes(fold(f))))
      .map(([c]) => c);
    const tidy = tidyVerbCells('es', cells, false);
    if (!tidy.length) continue;
    const joined = `with ${pronouns.map(quote).join(' and ')} joined to the end`;
    const bare = p.cells[tidy[0]].find((f) => bareOf(tidy[0]).includes(fold(f))) ?? '';
    const accent = fold(form) !== canonical(form, 'es') && fold(bare) === canonical(bare, 'es') ? '; the written accent keeps the stress where it was' : '';
    const g = verbGroups(tidy)[0];
    const t = tenseText('es', g.tense);
    const who = g.persons.length ? `, ${joinOr(g.persons.map((x) => personText('es', g.tense, x)))}` : '';
    const why = g.tense === 'imp.aff' ? 'a command takes its pronouns after it' : g.tense === 'nfin|ger' ? 'a gerund can take its pronouns after it' : 'an infinitive can take its pronouns after it';
    return { cells: tidy, label: `${t.name}${who}`, reason: `${joined}: ${why}`, fromSentence: false, text: `${quote(form)} is the ${t.name} of ${quote(lemma)}${who}, ${joined}: ${why}${accent}.` };
  }
  return null;
}

/** The negative-command explanation already names the subjunctive: no "spelled the same" note after it. */
function negativeOnly(colon: string | null, lang: VerbLang): boolean {
  return !!colon && colon.startsWith(`with ${quote(lang === 'es' ? 'no' : 'não')}`);
}

// ------------------------------------------------------------------ verbs: Russian, Ukrainian, Polish (1.8.4)

/** What each part of a Russian, Ukrainian or Polish verb is for, to follow "used". */
const SLAVIC_VERB_USE: Record<string, string> = {
  pres: 'for what happens now or regularly',
  fut: 'for what will happen',
  past: 'for what happened or was happening',
  cond: 'for what would happen, and for polite wishes',
  imp: 'for commands and requests',
  'nfin|adv': 'for an action going on at the same time as the main verb',
  'nfin|adv.past': 'for an action finished before the main verb',
  'nfin|imps': 'for something done without saying who did it',
  'part|act': 'as an adjective: (the one) doing it',
  'part|pass': 'as an adjective: done',
};

/**
 * A Russian, Ukrainian or Polish verb form: its tense and person (or gender), and what that part of the verb is for.
 * "“писала” is the past (вона) of “писати”. Used for what happened or was happening; it agrees with the subject."
 */
function explainSlavicVerb(lang: CaseLang, cells: string[], lemma: string, form: string): FormExplanation | null {
  const verbCells = cells.filter((c) => isSlavicVerbCell(lang, c) && c !== 'nfin|inf');
  if (!verbCells.length) return null;
  const rows = [...new Set(verbCells.map((c) => (rowOf(c) === 'nfin' || rowOf(c) === 'part' ? c : rowOf(c))))];
  const labels = [...new Set(verbCells.map((c) => cellLabel(lang, c)))];
  // Every person of one tense (Ukrainian є): name the tense once.
  const label = rows.length === 1 && verbCells.length >= 6 && !rows[0].includes('|') ? `${cellLabel(lang, verbCells[0]).split(' (')[0]} (every person)` : joinOr(labels);
  const use = rows.length === 1 ? SLAVIC_VERB_USE[rows[0]] : null;
  const agree = rows.length === 1 && (rows[0] === 'past' || rows[0] === 'cond') ? (lang === 'pl' ? '; the ending shows the person and gender' : '; it agrees with the subject in gender and number') : '';
  if (labels.length > 1 && rows.length > 1) return { cells: verbCells, label, reason: null, fromSentence: false, text: `${quote(form)} can be the ${label} of ${quote(lemma)}: they are spelled the same.` };
  const reason = use ? `Used ${use}${agree}` : null;
  return { cells: verbCells, label, reason, fromSentence: false, text: `${quote(form)} is the ${label} of ${quote(lemma)}.${reason ? ` ${reason}.` : ''}` };
}

/**
 * A Spanish or Portuguese noun, adjective, determiner or pronoun (1.8.5): “sua” is the feminine singular of “seu”,
 * and what that means for its use.
 */
function explainRomanceNominal(lang: 'es' | 'pt', p: Paradigm, cells: string[], lemma: string, form: string): FormExplanation | null {
  const own = cells.filter((c) => isRomanceNominalCell(lang, c) && c !== 'sg|m' && c !== 'sg|-' && c !== 'subj|-');
  if (!own.length) return null;
  const labels = [...new Set(own.map((c) => cellLabel(lang, c)))];
  const label = joinOr(labels);
  if (labels.length > 1) return { cells: own, label, reason: null, fromSentence: false, text: `${quote(form)} can be the ${label} of ${quote(lemma)}: they are spelled the same.` };
  const [row, col] = own[0].split('|');
  const reason = (() => {
    if (row === 'apoc') return col === 'm' ? `Used right before a masculine singular noun (${lang === 'es' ? 'buen día, algún libro' : 'bom dia'})` : 'Used right before a singular noun (gran idea)';
    if (row === 'neut') return `Used for an idea or for something not named (${lang === 'es' ? 'esto es fácil' : 'isso é fácil'})`;
    if (row === 'obj') return `Used as the object of a verb (${form} ${lang === 'es' ? 've' : 'vê'})`;
    if (row === 'prep') return `Used after a preposition (para ${form})`;
    if (row === 'com') return null;
    if (p.kind === 'noun') return null;
    return 'It agrees with the noun it goes with';
  })();
  return { cells: own, label, reason, fromSentence: false, text: `${quote(form)} is the ${label} of ${quote(lemma)}.${reason ? ` ${reason}.` : ''}` };
}

// ------------------------------------------------------------------ the exact cell of a sentence

/**
 * Cells explainForm can name: a tense or verb form it knows (es, pt); a case, a short form or a degree, and since
 * 2.0.0 a verb's tense and person (ru, uk, pl): a form that is the present of one verb and the future of its perfective
 * look-alike (Polish “wynosi”), or a command spelled like a statement (Russian “договоритесь”).
 */
function explainable(lang: LanguageCode, cell: string): boolean {
  if (lang === 'es' || lang === 'pt') return cell !== 'nfin|inf' && KNOWN_VERB_ROWS.has(rowOf(cell));
  if (lang === 'ru' || lang === 'uk' || lang === 'pl') return CASES.includes(caseOf(cell)) || !!DEGREE_USE[rowOf(cell)] || (cell !== 'nfin|inf' && isSlavicVerbCell(lang, cell));
  return false;
}

/**
 * The exact cell of a form in its sentence, when it can be used: the word has a table (its own, or a built-in one),
 * the table has the cell and the cell holds the form, or, for a Spanish or Portuguese negative imperative, no/não + the
 * form (the tables store the command with its negation: “não obrigue” for obrigue). Null otherwise, and the annotation
 * is then ignored. The server checks the same before it sends a cell, and the web app before it marks one in a table.
 */
/**
 * The annotation for a sentence whose target only looks like a form of the word (a homograph: the noun “parte” filed
 * under partir, a name) or fills a cell its table lacks (a vocative, the Russian locative in -у). Such a sentence gets
 * no grammar note at all, rather than a list of what the form could be elsewhere.
 */
export const NO_NOTE = '-';

/** True when the sentence's annotation says it gets no grammar note (NO_NOTE). */
export function noNote(exact: ExactCell | null | undefined): boolean {
  return exact?.cell === NO_NOTE;
}

export function exactCellOf(
  language: LanguageCode,
  paradigm: Paradigm | null | undefined,
  lemma: string,
  form: string | null | undefined,
  exact: ExactCell | null | undefined,
): string | null {
  const cell = exact?.cell;
  if (!cell || !form || typeof cell !== 'string') return null;
  const p = paradigmFor(language, stripStress(lemma ?? '').trim(), paradigm);
  if (!p || p.indeclinable || !Object.prototype.hasOwnProperty.call(p.cells, cell) || !explainable(language, cell)) return null;
  const forms = p.cells[cell];
  const holds = (f: string) => Array.isArray(forms) && forms.some((x) => norm(language, x) === norm(language, f));
  if (holds(form)) return cell;
  const no = language === 'es' ? 'no' : language === 'pt' ? 'não' : null;
  return no && rowOf(cell) === 'imp.neg' && holds(`${no} ${form}`) ? cell : null;
}

/** A reason as a sentence, ending in a full stop. */
const fullStop = (s: string) => (/[.!?…]$/.test(s) ? s : `${s}.`);

/**
 * The form's one cell in this sentence, named with the annotation's reason: "“українське” is the nominative neuter of
 * “український”: it describes …". Without a reason, the rules give the one this sentence shows for the cell, or its
 * general use; nothing spelled the same is mentioned either way.
 */
function explainExact(lang: LanguageCode, p: Paradigm, cell: string, why: string | null | undefined, lemma: string, form: string, ctx: Ctx | null): FormExplanation | null {
  const given = (typeof why === 'string' ? why : '').replace(/\s+/g, ' ').trim();
  const reason = given.replace(/\.$/, '');
  if (lang === 'es' || lang === 'pt') {
    if (!given) return explainVerb(lang, p, [cell], lemma, form, ctx, true);
    const tense = tenseOf(cell);
    const name = tenseText(lang, tense).name;
    const who = personOf(cell) ? `, ${personText(lang, tense, personOf(cell))}` : '';
    return { cells: [cell], label: `${name}${who}`, reason, fromSentence: true, text: `${quote(form)} is the ${name} of ${quote(lemma)}${who}: ${fullStop(given)}` };
  }
  if ((lang === 'ru' || lang === 'uk' || lang === 'pl') && isSlavicVerbCell(lang, cell)) {
    // "“wynosi” is the present (on, ona, ono) of “wynosić”: its subject is …"
    if (!given) return explainSlavicVerb(lang, [cell], lemma, form);
    const label = cellLabel(lang, cell);
    return { cells: [cell], label, reason, fromSentence: true, text: `${quote(form)} is the ${label} of ${quote(lemma)}: ${fullStop(given)}` };
  }
  if (lang === 'ru' || lang === 'uk' || lang === 'pl') {
    if (!given) return explainCase(lang, p, [cell], lemma, form, ctx);
    const label = CASES.includes(caseOf(cell)) ? casesLabel(lang, [cell]) : DEGREE_USE[rowOf(cell)].name(cell);
    return { cells: [cell], label, reason, fromSentence: true, text: `${quote(form)} is the ${label} of ${quote(lemma)}: ${fullStop(given)}` };
  }
  return null;
}

// ------------------------------------------------------------------ entry point

/**
 * Why the form an answer needed is the one it is: the cells it fills, their name and the reason, in plain English.
 * Null when the form is the dictionary form, the language has no tables, or the form is not in the word's table.
 * With a usable exact cell (exactCellOf), that cell alone is named, whatever else the form could be.
 */
export function explainForm(input: ExplainInput): FormExplanation | null {
  const lang = input.language;
  const raw = stripStress((input.form ?? '').trim());
  const lemma = stripStress((input.lemma ?? '').trim());
  if (!raw || !lemma || norm(lang, raw) === norm(lang, lemma)) return null;
  if (noNote(input.exact)) return null;
  const p = paradigmFor(lang, lemma, input.paradigm);
  if (p?.indeclinable) return null;
  const exact = exactCellOf(lang, p, lemma, raw, input.exact);
  const cells = exact ? [exact] : input.cell ? [input.cell] : p ? cellsOf(lang, p, raw) : [];
  // A capital only because the word opens the sentence is not part of the form.
  const form = raw[0] !== raw[0].toLowerCase() && lemma[0] === lemma[0].toLowerCase() ? raw[0].toLowerCase() + raw.slice(1) : raw;
  if (!cells.length) return lang === 'es' && p?.kind === 'verb' ? attachedPronouns(p, form, lemma) : null;
  const ctx = sentenceContext(lang, input.before, input.after);
  if (exact && p) return explainExact(lang, p, exact, input.exact?.why, lemma, form, ctx);
  if ((lang === 'es' || lang === 'pt') && p && isNominalRomance(p)) return explainRomanceNominal(lang, p, cells, lemma, form);
  if (lang === 'es' || lang === 'pt') return explainVerb(lang, p, cells, lemma, form, ctx);
  if ((lang === 'ru' || lang === 'uk' || lang === 'pl') && p?.kind === 'verb') return explainSlavicVerb(lang, cells, lemma, form);
  if (lang === 'ru' || lang === 'uk' || lang === 'pl') return explainCase(lang, p, cells, lemma, form, ctx);
  return null;
}
