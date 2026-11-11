// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Gender and number tables for Spanish and Portuguese nouns, adjectives, determiners and pronouns (1.8.5), and a
// clean-up of the forms lists of words without a table in every language.
//
// The dictionary data lists a word's forms without saying which is which (seu: sua, seus, suas), mixed with
// misspellings (dia, aqui), diminutives (coisinha), other words (bienes under bien) and, under a few function words,
// crude slang. A table is built only from forms the dictionary lists and that the spelling rules confirm: the
// feminine of the dictionary form (bueno → buena, português → portuguesa), the plural of either (casa → casas,
// canción → canciones, animal → animais, homem → homens), and in Spanish the short form before a noun (bueno → buen,
// alguno → algún). Articles, demonstratives, the possessives with irregular feminines and a few pronouns have tables of
// their own, below. Cells are "<row>|<column>": rows sg, pl, apoc (the short form before a noun), neut (the neuter
// esto, isso, lo) and, for yo and tú, subj, obj, prep, com; columns m, f, or - for a word whose forms don't change for
// gender.
import { foldLatinDiacritics } from '../../../shared/text.ts';
import { crudeHits } from '../crude.mjs';
import { readMorfologik } from './morfologik.mjs';

const MORFOLOGIK = 'morfologik/morfologik-polish/src/main/resources/morfologik/stemming/polish';

/**
 * Every form PoliMorf (in the Morfologik dictionary) gives each Polish lemma of the set, to tell a real form that
 * differs only by ą/a or ę/e from a misspelt copy. `src(path)` resolves a path under the sources folder; null when
 * the dictionary is not there.
 */
export function polishFormsOf(src, lemmas, exists) {
  const dict = src(`${MORFOLOGIK}/polish.dict`);
  const info = src(`${MORFOLOGIK}/polish.info`);
  if (exists && (!exists(dict) || !exists(info))) return null;
  const rows = readMorfologik(dict, info, new Set(lemmas));
  const out = new Map();
  for (const [lemma, list] of rows) out.set(lemma, new Set(list.map(([form]) => form.normalize('NFC'))));
  return (lemma) => out.get(lemma) ?? null;
}

export const NOMINAL_SOURCE = {
  rules: 'Wiktionary forms, sorted by spelling rules',
  own: 'VocabBuilder',
};

export const NOMINAL_DESCRIPTION = {
  es: 'Gender and number tables: the forms English Wiktionary lists for each word (Vuizur\'s Wiktionary dictionaries, CC BY-SA 3.0), kept only where the spelling rules confirm them as the feminine, the plural or the short form before a noun (buen, algún); our own tables for the articles, demonstratives, uno, cualquiera and the pronouns él, yo and tú.',
  pt: 'Gender and number tables: the forms English Wiktionary lists for each word (Vuizur\'s Wiktionary dictionaries, CC BY-SA 3.0), kept only where the spelling rules confirm them as the feminine or the plural; our own tables for the articles, demonstratives, qualquer, bom and mau, and the possessives with irregular feminines (meu, minha).',
};

/** Our own tables: [row|column, forms] pairs. */
const OWN = {
  es: {
    el: { kind: 'pronoun', cells: { 'sg|m': ['el'], 'sg|f': ['la'], 'pl|m': ['los'], 'pl|f': ['las'], 'neut|-': ['lo'] } },
    uno: { kind: 'pronoun', cells: { 'sg|m': ['uno'], 'apoc|m': ['un'], 'sg|f': ['una'], 'pl|m': ['unos'], 'pl|f': ['unas'] } },
    este: { kind: 'pronoun', cells: { 'sg|m': ['este'], 'sg|f': ['esta'], 'pl|m': ['estos'], 'pl|f': ['estas'], 'neut|-': ['esto'] } },
    ese: { kind: 'pronoun', cells: { 'sg|m': ['ese'], 'sg|f': ['esa'], 'pl|m': ['esos'], 'pl|f': ['esas'], 'neut|-': ['eso'] } },
    aquel: { kind: 'pronoun', cells: { 'sg|m': ['aquel'], 'sg|f': ['aquella'], 'pl|m': ['aquellos'], 'pl|f': ['aquellas'], 'neut|-': ['aquello'] } },
    él: { kind: 'pronoun', cells: { 'sg|m': ['él'], 'sg|f': ['ella'], 'pl|m': ['ellos'], 'pl|f': ['ellas'], 'neut|-': ['ello'] } },
    cualquiera: { kind: 'pronoun', cells: { 'sg|-': ['cualquiera'], 'apoc|-': ['cualquier'], 'pl|-': ['cualesquiera'] } },
    yo: { kind: 'pronoun', cells: { 'subj|-': ['yo'], 'obj|-': ['me'], 'prep|-': ['mí'], 'com|-': ['conmigo'] } },
    tú: { kind: 'pronoun', cells: { 'subj|-': ['tú'], 'obj|-': ['te'], 'prep|-': ['ti'], 'com|-': ['contigo'] } },
  },
  pt: {
    o: { kind: 'pronoun', cells: { 'sg|m': ['o'], 'sg|f': ['a'], 'pl|m': ['os'], 'pl|f': ['as'] } },
    um: { kind: 'pronoun', cells: { 'sg|m': ['um'], 'sg|f': ['uma'], 'pl|m': ['uns'], 'pl|f': ['umas'] } },
    este: { kind: 'pronoun', cells: { 'sg|m': ['este'], 'sg|f': ['esta'], 'pl|m': ['estes'], 'pl|f': ['estas'], 'neut|-': ['isto'] } },
    esse: { kind: 'pronoun', cells: { 'sg|m': ['esse'], 'sg|f': ['essa'], 'pl|m': ['esses'], 'pl|f': ['essas'], 'neut|-': ['isso'] } },
    aquele: { kind: 'pronoun', cells: { 'sg|m': ['aquele'], 'sg|f': ['aquela'], 'pl|m': ['aqueles'], 'pl|f': ['aquelas'], 'neut|-': ['aquilo'] } },
    meu: { kind: 'pronoun', cells: { 'sg|m': ['meu'], 'sg|f': ['minha'], 'pl|m': ['meus'], 'pl|f': ['minhas'] } },
    teu: { kind: 'pronoun', cells: { 'sg|m': ['teu'], 'sg|f': ['tua'], 'pl|m': ['teus'], 'pl|f': ['tuas'] } },
    seu: { kind: 'pronoun', cells: { 'sg|m': ['seu'], 'sg|f': ['sua'], 'pl|m': ['seus'], 'pl|f': ['suas'] } },
    qualquer: { kind: 'pronoun', cells: { 'sg|-': ['qualquer'], 'pl|-': ['quaisquer'] } },
    bom: { kind: 'adjective', cells: { 'sg|m': ['bom'], 'sg|f': ['boa'], 'pl|m': ['bons'], 'pl|f': ['boas'] } },
    mau: { kind: 'adjective', cells: { 'sg|m': ['mau'], 'sg|f': ['má'], 'pl|m': ['maus'], 'pl|f': ['más'] } },
  },
};
/** Parts of speech our own tables are for (a homograph noun, such as este "east", is left to the rules). */
const OWN_POS = new Set(['determiner', 'pronoun', 'article', 'numeral', 'adjective', 'adverb']);

const NOMINAL_POS = new Set(['noun', 'adjective', 'determiner', 'pronoun', 'numeral', 'article']);
/** Adverbs that are also quantity words and agree like adjectives (mucho, muchas; pouco, poucas). */
const QUANTITY_ADVERBS = {
  es: new Set(['mucho', 'poco', 'tanto', 'demasiado', 'bastante', 'cuanto', 'cuánto', 'muchísimo']),
  pt: new Set(['muito', 'pouco', 'tanto', 'quanto', 'bastante']),
};

const fold = (s) => foldLatinDiacritics(s).toLowerCase();
const nfc = (s) => s.normalize('NFC');
/** How many letters carry an accent, tilde or other mark. */
const marks = (s) => [...s.normalize('NFD')].filter((c) => /\p{M}/u.test(c)).length + (s.match(/[đłĐŁ]/g)?.length ?? 0);

/** Candidate feminines of a masculine singular. */
function feminines(lang, m) {
  const out = new Set();
  const stem = (n) => m.slice(0, m.length - n);
  if (lang === 'es') {
    if (m.endsWith('o')) out.add(stem(1) + 'a');
    if (m.endsWith('e')) out.add(stem(1) + 'a');
    // alemán → alemana, inglés → inglesa, llorón → llorona: the written accent goes with the new syllable.
    if (/[áéíóú][ns]$/.test(m)) out.add(m.slice(0, -2) + foldLatinDiacritics(m.slice(-2, -1)) + m.slice(-1) + 'a');
    else if (/[rlnsz]$/.test(m)) out.add(m + 'a');
  } else {
    if (m.endsWith('o')) out.add(stem(1) + 'a');
    if (m.endsWith('e')) out.add(stem(1) + 'a');
    if (m.endsWith('ão')) for (const e of ['ã', 'ona', 'oa']) out.add(stem(2) + e);
    if (m.endsWith('eu')) for (const e of ['ua', 'eia']) out.add(stem(2) + e);
    if (m.endsWith('um')) out.add(m + 'a');
    if (/[rlz]$/.test(m)) out.add(m + 'a');
    if (m.endsWith('ês')) out.add(stem(2) + 'esa');
    if (m.endsWith('u') && !m.endsWith('eu')) out.add(m + 'a');
  }
  return out;
}

/** Does the spelling make `pl` a plural of `sg`? (Accents may move: canción → canciones, joven → jóvenes.) */
function isPlural(lang, sg, pl) {
  if (sg === pl) return false;
  const s = fold(sg);
  const p = fold(pl);
  if (lang === 'es') {
    if (/[aeiou]$/.test(s) && p === s + 's') return true;
    if (/[íú]$/.test(sg) && (p === s + 'es' || p === s + 's')) return true;
    if (s.endsWith('z') && p === s.slice(0, -1) + 'ces') return true;
    if (/[^aeiouz]$/.test(s) && p === s + 'es') return true;
    return false;
  }
  if (/[aeiou]$/.test(s) && p === s + 's') return true; // casa, irmã, café, avó, mãe
  if (s.endsWith('m') && p === s.slice(0, -1) + 'ns') return true; // homem, bom
  if (s.endsWith('ao') && ['oes', 'aes', 'aos'].some((e) => p === s.slice(0, -2) + e)) return true; // mão, pão, avião
  if (/[rz]$/.test(s) && p === s + 'es') return true; // flor, luz
  if (s.endsWith('s') && /[áéíóúâêô]s$/.test(sg) && p === s + 'es') return true; // inglês, país, mês
  if (s.endsWith('al') && p === s.slice(0, -1) + 'is') return true; // animal
  if (s.endsWith('el') && p === s.slice(0, -2) + 'eis') return true; // papel, nível
  if (s.endsWith('ol') && p === s.slice(0, -2) + 'ois') return true; // anzol
  if (s.endsWith('ul') && p === s.slice(0, -2) + 'uis') return true; // azul
  if (s.endsWith('il') && (p === s.slice(0, -1) + 's' || p === s.slice(0, -2) + 'eis')) return true; // barril, fácil
  return false;
}

/** The Spanish short form before a noun: bueno → buen, alguno → algún, primero → primer, grande → gran. */
function isApocope(lang, lemma, f) {
  if (lang !== 'es') return false;
  if (lemma === 'grande') return f === 'gran';
  if (lemma === 'santo') return false;
  return lemma.endsWith('o') && fold(f) === fold(lemma.slice(0, -1)) && f !== lemma;
}

const kindOf = (pos) => (pos === 'noun' ? 'noun' : pos === 'numeral' ? 'numeral' : pos === 'adjective' || pos === 'adverb' ? 'adjective' : 'pronoun');

/** A gender and number table built from the listed forms, or null when they don't make one. */
export function romanceNominalParadigm(lang, entry) {
  if (lang !== 'es' && lang !== 'pt') return null;
  const lemma = nfc(entry.lemma ?? '');
  if (!lemma || /\s/.test(lemma)) return null;
  const own = OWN[lang][lemma];
  if (own && OWN_POS.has(entry.pos)) return { kind: own.kind, source: NOMINAL_SOURCE.own, cells: structuredClone(own.cells) };
  const quantity = entry.pos === 'adverb' && QUANTITY_ADVERBS[lang].has(lemma);
  // A word filed under another part of speech that is also an adjective or determiner (the interjection bueno, the
  // prepositions bajo, segundo and quanto) gets a table only when its forms have a feminine: sobre's "sobres"
  // (envelopes) or contra's "contras" make none.
  const otherPos = !NOMINAL_POS.has(entry.pos) && !quantity;
  const forms = [...new Set((entry.forms ?? []).map((f) => nfc(f.form ?? '')).filter((f) => f && f !== lemma && !/\s/.test(f)))];
  if (!forms.length) return null;
  const cells = {};
  const put = (k, f) => {
    if (!cells[k]) cells[k] = [];
    if (!cells[k].includes(f)) cells[k].push(f);
  };
  // A word whose dictionary form is plural (varios, ambos, doscientos): its feminine plural.
  if (/os$/.test(lemma) && entry.pos !== 'noun') {
    const fem = forms.find((f) => f === lemma.slice(0, -2) + 'as');
    if (fem) return { kind: kindOf(entry.pos), source: NOMINAL_SOURCE.rules, cells: { 'pl|m': [lemma], 'pl|f': [fem] } };
  }
  if (entry.pos === 'numeral' && !['mil', 'ciento', 'milhão', 'millón'].includes(lemma)) return null;
  const femCandidates = feminines(lang, lemma);
  // A feminine that is also crude slang (perra, polla, bicha) is left out unless the word itself is such a word.
  const crudeLemma = crudeHits(lang, lemma, '').length > 0;
  const fem = forms.filter((f) => femCandidates.has(f) && (crudeLemma || !crudeHits(lang, f, '').length));
  const gendered = fem.length > 0;
  if (otherPos && !gendered) return null;
  const col = gendered ? 'm' : '-';
  put(`sg|${col}`, lemma);
  for (const f of fem) put('sg|f', f);
  for (const f of forms) {
    if (fem.includes(f)) continue;
    if (isPlural(lang, lemma, f)) put(`pl|${col}`, f);
    else if (fem.some((x) => isPlural(lang, x, f))) put('pl|f', f);
    else if (isApocope(lang, lemma, f)) put(`apoc|${col}`, f);
  }
  if (Object.keys(cells).length < 2) return null;
  return { kind: kindOf(entry.pos), source: NOMINAL_SOURCE.rules, cells };
}

/** The forms of a table in order, without the dictionary form. */
export function tableForms(p, lemma) {
  const out = [];
  for (const v of Object.values(p.cells)) for (const f of v) if (f !== lemma && !out.includes(f)) out.push(f);
  return out;
}

// ------------------------------------------------------------------ forms lists of words without a table

const FUNCTION_POS = new Set(['preposition', 'conjunction', 'particle', 'interjection', 'phrase']);
/** Forms of function words that are real variants of the word. */
const FUNCTION_KEEP = {
  ru: { же: ['ж'], бы: ['б'], чтобы: ['чтоб'], что: ['чего', 'чему', 'чем'] },
  uk: { що: ['чого', 'чому', 'чим', 'чім'] },
  pl: {},
  es: {},
  pt: {},
  vi: {},
};
/** Russian prepositions take -о before some consonant clusters (во, со, ко, изо); Polish ones take -e (we, ze, przeze). */
const prepositionVariant = (lang, lemma, f) => (lang === 'ru' && f === lemma + 'о') || (lang === 'pl' && f === lemma + 'e');
/** Comparative and superlative forms of an adverb (лучше, побольше, lepiej, najlepiej, частіше, найкраще). */
function isDegree(lang, lemma, f, forms) {
  if (lang === 'ru') return /(ее|ей|ше|же|че|ще)$/.test(f) && f.length > 3 && !/^(ее|ей)$/.test(f) ? true : f.startsWith('по') && forms.includes(f.slice(2));
  if (lang === 'uk') return /(іше|ше|же|че|ще)$/.test(f) && f.length > 3 ? true : f.startsWith('най') && forms.includes(f.slice(3));
  if (lang === 'pl') return f.startsWith('naj') || /ej$/.test(f);
  return false;
}
/** Quantity words whose case forms are kept (нескольких, багатьох, wielu). */
const QUANTITY = {
  ru: new Set(['несколько', 'много', 'мало', 'сколько', 'столько']),
  uk: new Set(['багато', 'небагато', 'кілька', 'декілька', 'скільки', 'стільки', 'все', 'усе']),
  pl: new Set(['kilka', 'wiele', 'ile', 'tyle', 'parę']),
};

/**
 * Spanish and Portuguese words that differ from another only by an accent and are both standard (el/él, esta/está,
 * tem/têm): never taken for a misspelt copy.
 */
const ACCENT_PAIRS = {
  es: new Set(['el', 'tu', 'mi', 'te', 'se', 'si', 'de', 'mas', 'aun', 'solo', 'este', 'ese', 'aquel', 'esta', 'esto', 'eso', 'estos', 'esos', 'estas', 'esas', 'aquella', 'aquellos', 'aquellas', 'que', 'quien', 'quienes', 'cual', 'cuales', 'cuanto', 'cuanta', 'cuantos', 'cuantas', 'donde', 'adonde', 'como', 'cuando', 'o']),
  pt: new Set(['e', 'a', 'as', 'para', 'por', 'pode', 'tem', 'vem', 'nos', 'pelo', 'pela', 'pelos', 'pelas', 'pais', 'avo', 'mas', 'se', 'esta', 'estas', 'esse', 'este', 'de', 'da', 'do', 'nó', 'pe', 'pos', 'ate', 'so', 'secretaria', 'sabia', 'magoa', 'fabrica', 'pratica', 'musica', 'duvida', 'publico', 'numero', 'medico', 'continuo', 'pratico']),
};

/**
 * Clean a forms list: copies that only lack the language's accents or letters out (dia beside día, juz beside już),
 * and for words without a table, forms of other words out (all forms of a function word but its real variants, such
 * as во, ze, ж, which also takes out the crude slang the dictionary data has under на and по; an adverb's forms other
 * than its comparatives or a quantity word's case forms). Returns the dropped forms.
 */
export function cleanForms(lang, entry, { junkOnly = false, formsOf = null } = {}) {
  const lemma = nfc(entry.lemma ?? '');
  const list = entry.forms ?? [];
  const all = [lemma, ...list.map((f) => nfc(f.form ?? ''))];
  const dropped = [];
  const keep = list.filter((f) => {
    const form = nfc(f.form ?? '');
    const why = (() => {
      if (!form) return 'empty';
      const inTable = entry.paradigm && Object.values(entry.paradigm.cells ?? {}).some((v) => v.includes(form));
      // Polish has real pairs that differ only in ą/a or ę/e (największa, największą): the dictionary decides.
      const valid = formsOf?.(lemma)?.has(form) ?? false;
      const checkAccents = lang === 'pl' ? !!formsOf : lang !== 'ru' && lang !== 'uk';
      if (checkAccents && !inTable && !valid && !ACCENT_PAIRS[lang]?.has(form) && all.some((g) => g !== form && fold(g) === fold(form) && marks(g) > marks(form))) return 'accents';
      if (entry.paradigm || junkOnly) return null;
      if (FUNCTION_POS.has(entry.pos)) return (FUNCTION_KEEP[lang]?.[lemma] ?? []).includes(form) || (entry.pos === 'preposition' && prepositionVariant(lang, lemma, form)) ? null : 'function word';
      if (entry.pos === 'adverb' && lang === 'pl' && formsOf) return valid || isDegree(lang, lemma, form, all) ? null : 'not a form';
      if (entry.pos === 'adverb' && (lang === 'ru' || lang === 'uk' || lang === 'pl')) return QUANTITY[lang].has(lemma) || isDegree(lang, lemma, form, all) ? null : 'not a form';
      if (entry.pos === 'adverb' && (lang === 'es' || lang === 'pt')) return 'not a form';
      return null;
    })();
    if (why) dropped.push({ form, why });
    return !why;
  });
  entry.forms = keep;
  return dropped;
}

/**
 * Give Spanish and Portuguese words their gender and number tables and clean every word's forms list (all six
 * languages). Run after the sentences are chosen, like the verb tables, so nothing else changes.
 */
export function attachNominalTables(lang, entries, { formsOf = null } = {}) {
  const stats = { tables: 0, own: 0, byKind: {}, formsDropped: 0, droppedBy: {}, samples: [] };
  const count = (e, list) => {
    for (const d of list) {
      stats.formsDropped++;
      stats.droppedBy[d.why] = (stats.droppedBy[d.why] ?? 0) + 1;
      if (stats.samples.length < 2000) stats.samples.push(`${e.lemma}: ${d.form} (${d.why})`);
    }
  };
  for (const e of entries) {
    // Misspelt copies and crude slang go first, so a table is never built from them.
    count(e, cleanForms(lang, e, { junkOnly: true, formsOf }));
    if (!e.paradigm) {
      const p = romanceNominalParadigm(lang, e);
      if (p) {
        e.paradigm = p;
        e.forms = tableForms(p, nfc(e.lemma)).map((form) => ({ form, display: null, tags: [] }));
        stats.tables++;
        if (p.source === NOMINAL_SOURCE.own) stats.own++;
        stats.byKind[p.kind] = (stats.byKind[p.kind] ?? 0) + 1;
      }
    }
    count(e, cleanForms(lang, e, { formsOf }));
  }
  return stats;
}

/** The report section ("## Gender and number tables" for es and pt, "## Forms lists" for every language). */
export function nominalReport(lang, stats) {
  const L = [];
  const n = (x) => x.toLocaleString('en');
  if (lang === 'es' || lang === 'pt') {
    L.push('## Gender and number tables', '', NOMINAL_DESCRIPTION[lang], '');
    L.push(`- Words with a table: ${n(stats.tables)} (${Object.entries(stats.byKind).map(([k, v]) => `${k}s ${n(v)}`).join(', ')}), ${n(stats.own)} of them from our own tables`);
    L.push('');
  }
  L.push('## Forms lists', '');
  const why = { crude: 'crude slang', accents: 'copies without the accents or letters of another form (dia beside día)', 'function word': 'listed under a function word without being a form of it', 'not a form': 'listed under an adverb without being its comparative or a form of it', empty: 'empty' };
  L.push(`- Forms left out: ${n(stats.formsDropped)}${stats.formsDropped ? ` (${Object.entries(stats.droppedBy).map(([k, v]) => `${why[k] ?? k}: ${n(v)}`).join('; ')})` : ''}`);
  L.push('');
  return L;
}
