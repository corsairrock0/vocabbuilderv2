// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Spanish and Brazilian Portuguese verb conjugation tables for the frequency sets.
//
// Main source: UniMorph (unimorph/spa, unimorph/por), which is generated from English Wiktionary's
// conjugation tables (CC BY-SA 3.0). The Spanish file stops at exactly 2^20 verb rows, so many very common
// verbs (tener, querer, venir, poner…) are missing from it; Portuguese is a small subset. Verbs missing from
// UniMorph, or whose UniMorph table is incomplete, are conjugated from the verbecc templates
// (bretttolbert/verbecc, GPL-2.0-or-later, derived from Verbiste). Only verbecc's XML data is read here,
// by this file's own parser; none of verbecc's code is used. The agreement between the two sources on
// the verbs both have is measured and written to the report.
//
// Cell keys are "<tense>|<person>" (shared/paradigms.ts lays them out and labels them):
//   tenses   ind.pres ind.pret ind.impf ind.fut cond sbjv.pres sbjv.impf sbjv.fut imp.aff imp.neg
//            es only: (none)    pt only: ind.plup (simple pluperfect), inf.pers (personal infinitive)
//            compound (auxiliary haber / ter + participle): c.ind.perf c.ind.plup c.ind.fut c.cond c.sbjv.perf
//            c.sbjv.plup, pt also c.sbjv.fut
//   persons  1s 2s 3s 1p 2p 3p, Spanish also 2s.vos (voseo)
//   non-finite  nfin|inf  nfin|ger  part|m.sg part|f.sg part|m.pl part|f.pl
import { readFileSync } from 'node:fs';
import { lines } from '../common.mjs';

const PERSONS = ['1s', '2s', '3s', '1p', '2p', '3p'];

// ------------------------------------------------------------------ UniMorph

/** UniMorph "lemma \t form \t FEATS" rows for the wanted lemmas → Map<lemma, [form, Set<feat>][]>. */
export async function readUnimorph(file, wanted) {
  const out = new Map();
  for await (const line of lines(file)) {
    const tab = line.indexOf('\t');
    if (tab < 0) continue;
    const lemma = line.slice(0, tab).normalize('NFC');
    if (!wanted.has(lemma)) continue;
    const [form, feats] = line.slice(tab + 1).split('\t');
    if (!form || !feats) continue;
    let list = out.get(lemma);
    if (!list) out.set(lemma, (list = []));
    list.push([form.normalize('NFC').trim(), new Set(feats.split(/[;+]/))]);
  }
  return out;
}

function personOf(f) {
  const n = f.has('SG') ? 's' : f.has('PL') ? 'p' : null;
  const p = f.has('1') ? '1' : f.has('2') ? '2' : f.has('3') ? '3' : null;
  return n && p ? p + n : null;
}

function tenseOf(f, lang) {
  if (f.has('IMP')) return f.has('NEG') ? 'imp.neg' : 'imp.aff';
  if (f.has('COND')) return 'cond';
  if (f.has('SBJV')) return f.has('PRS') ? 'sbjv.pres' : f.has('FUT') ? 'sbjv.fut' : f.has('PST') ? 'sbjv.impf' : null;
  if (f.has('IND')) {
    if (f.has('PRS')) return 'ind.pres';
    if (f.has('FUT')) return 'ind.fut';
    if (f.has('PST')) {
      if (lang === 'pt' && f.has('PRF')) return 'ind.plup';
      if (f.has('PFV')) return 'ind.pret';
      if (f.has('IPFV')) return 'ind.impf';
    }
  }
  return null;
}

function push(cells, k, form) {
  if (!form || form === '-') return;
  const list = cells[k] ?? (cells[k] = []);
  if (!list.includes(form)) list.push(form);
}

/** UniMorph rows of one verb → cells (before compound tenses and spelling normalisation). */
export function unimorphCells(rows, lang) {
  const cells = {};
  const infm = {}; // Spanish 2SG INFM forms in order: tú, then vos
  for (const [form, f] of rows) {
    if (f.has('PRO')) continue; // Spanish clitic bundles (dámelo …)
    if (f.has('V.PTCP')) {
      if (f.has('PRS')) push(cells, 'nfin|ger', form); // Portuguese gerund
      else if (f.has('PST')) push(cells, `part|${f.has('FEM') ? 'f' : 'm'}.${f.has('PL') ? 'pl' : 'sg'}`, form);
      continue;
    }
    if (f.has('V.CVB')) {
      push(cells, 'nfin|ger', form);
      continue;
    }
    if (f.has('NFIN')) {
      const p = personOf(f);
      if (!p) push(cells, 'nfin|inf', form);
      else if (lang === 'pt') push(cells, `inf.pers|${p}`, form);
      continue;
    }
    const t = tenseOf(f, lang);
    let p = personOf(f);
    if (!t || !p) continue;
    if (lang === 'es') {
      if (f.has('FORM')) {
        // usted / ustedes: only the imperative lacks a third-person row of its own.
        if (!t.startsWith('imp')) continue;
        p = p === '2s' ? '3s' : '3p';
      } else if (p === '2s') {
        (infm[t] ??= []).push(form);
        continue;
      }
    }
    if (t === 'imp.neg') {
      const neg = lang === 'es' ? 'no ' : 'não ';
      push(cells, `${t}|${p}`, form.startsWith(neg) ? form : neg + form);
    } else push(cells, `${t}|${p}`, form);
  }
  for (const [t, forms] of Object.entries(infm)) {
    push(cells, `${t}|2s`, forms[0]);
    if (forms[1]) push(cells, `${t}|2s.vos`, forms[1]);
  }
  return cells;
}

// ------------------------------------------------------------------ verbecc templates

const VERBECC_ES = {
  Indicativo: { presente: 'ind.pres', 'pretérito-imperfecto': 'ind.impf', 'pretérito-perfecto-simple': 'ind.pret', futuro: 'ind.fut' },
  Subjuntivo: { presente: 'sbjv.pres', 'pretérito-imperfecto-1': 'sbjv.impf', 'pretérito-imperfecto-2': 'sbjv.impf', futuro: 'sbjv.fut' },
  Condicional: { presente: 'cond' },
  Imperativo: { afirmativo: 'imp.aff', negativo: 'imp.neg' },
};
const VERBECC_PT = {
  Indicativo: {
    presente: 'ind.pres',
    'pretérito-imperfeito': 'ind.impf',
    'pretérito-mais-que-perfeito': 'ind.plup',
    'pretérito-perfeito': 'ind.pret',
    'futuro-do-presente': 'ind.fut',
  },
  Condicional: { 'futuro-do-pretérito': 'cond' },
  Subjuntivo: { presente: 'sbjv.pres', 'pretérito-imperfeito': 'sbjv.impf', futuro: 'sbjv.fut' },
  Infinitivo: { 'infinitivo-pessoal-presente': 'inf.pers' },
  Imperativo: { afirmativo: 'imp.aff', negativo: 'imp.neg' },
};
// Spanish imperatives list tú, usted, nosotros, vosotros, ustedes; Portuguese ones eu (always "-"), tu, você, nós, vós, vocês.
const IMP_PERSONS = { es: ['2s', '3s', '1p', '2p', '3p'], pt: ['1s', '2s', '3s', '1p', '2p', '3p'] };

/**
 * verbecc's conjugations-<lang>.xml and verbs-<lang>.xml → {conjugate(infinitive) → cells | null, template(infinitive)}.
 * A template is named "<example stem>:<ending>"; a verb's stem is its infinitive minus that ending.
 */
export function readVerbecc(conjugationsFile, verbsFile, lang) {
  const xml = readFileSync(conjugationsFile, 'utf8');
  const map = lang === 'es' ? VERBECC_ES : VERBECC_PT;
  const templates = new Map();
  for (const m of xml.matchAll(/<template name="([^"]+)">([\s\S]*?)<\/template>/g)) {
    const t = { ending: m[1].split(':')[1] ?? '', tenses: [] };
    for (const mood of m[2].matchAll(/<([\p{L}-]+)>([\s\S]*?)<\/\1>/gu)) {
      const moodName = mood[1];
      for (const tense of mood[2].matchAll(/<([\p{L}\d-]+)>([\s\S]*?)<\/\1>/gu)) {
        const persons = [...tense[2].matchAll(/<p>([\s\S]*?)<\/p>/g)].map((p) => [...p[1].matchAll(/<i>([^<]*)<\/i>/g)].map((i) => i[1].trim()));
        t.tenses.push({ mood: moodName, tense: tense[1], persons });
      }
    }
    templates.set(m[1], t);
  }
  const verbs = new Map();
  for (const m of readFileSync(verbsFile, 'utf8').matchAll(/<v><i>([^<]+)<\/i>\s*<t>([^<]+)<\/t><\/v>/g)) {
    if (!verbs.has(m[1])) verbs.set(m[1].normalize('NFC'), m[2]);
  }
  const imp = IMP_PERSONS[lang];
  const conjugate = (inf) => {
    const name = verbs.get(inf);
    const t = name && templates.get(name);
    if (!t || !inf.endsWith(t.ending)) return null;
    const stem = inf.slice(0, inf.length - t.ending.length);
    const cells = {};
    for (const { mood, tense, persons } of t.tenses) {
      const add = (k, endings) => {
        for (const e of endings) if (e && e !== '-') push(cells, k, stem + e);
      };
      if (mood === 'Infinitivo' && tense === 'infinitivo') add('nfin|inf', persons[0] ?? []);
      else if (mood === 'Gerundio' || mood === 'Gerúndio') add('nfin|ger', persons[0] ?? []);
      else if (mood === 'Participo' || mood === 'Particípio') add('part|m.sg', persons[0] ?? []);
      else {
        const key = map[mood]?.[tense];
        if (!key) continue;
        const order = key.startsWith('imp.') ? imp : PERSONS;
        persons.forEach((alts, i) => {
          const p = order[i];
          if (!p) return;
          // Some Spanish templates add the vos form as a second "tú" alternative; voseo is derived separately.
          const list = lang === 'es' && p === '2s' ? alts.slice(0, 1) : alts;
          if (key === 'imp.neg') {
            const neg = lang === 'es' ? 'no ' : 'não ';
            for (const e of list) if (e && e !== '-') push(cells, `${key}|${p}`, neg + stem + e);
          } else add(`${key}|${p}`, list);
        });
      }
    }
    return Object.keys(cells).length ? cells : null;
  };
  return { conjugate, template: (inf) => verbs.get(inf) ?? null, size: verbs.size };
}

// verbecc gives some verbs their adjectival short participle (concluir → concluso, difundir → difuso,
// pasar → paso), which is wrong in compound tenses. Its participle is kept only when it is regular or the
// verb belongs to a family whose participle really is irregular.
const ES_IRREGULAR_PARTICIPLE = /(abrir|cubrir|decir|scribir|hacer|facer|morir|poner|solver|romper|^ver|prever|entrever|^rever|volver|freír|imprimir|proveer|pudrir)$/;
const PT_IRREGULAR_PARTICIPLE =
  /^(?:(?:entre|re)?abrir|(?:des|en|re)?cobrir|(?:ben|contra|des|mal|pre)?dizer|(?:e|de|in|pre|sub|tran|ree|cir|pro)screver|(?:des|re|satis|per|contra)?fazer|[a-zç]*p[ôo]r|(?:ante|pre|re)?ver|(?:ad|con|inter|pro|sobre|de)?vir)$/;

export function regularParticiple(inf, lang) {
  const m = /^(.*?)(ar|er|ir|ír|or|ôr)$/.exec(inf);
  if (!m) return null;
  const [, stem, end] = m;
  if (end === 'ar') return stem + 'ado';
  if (lang === 'es') {
    if (end === 'ír' || /[aeo]$/.test(stem)) return stem + 'ído'; // oír → oído, leer → leído, traer → traído
    return stem + 'ido';
  }
  if (end === 'or' || end === 'ôr') return null;
  if (/[aeiou]$/.test(stem) && !/[gq]u$/.test(stem)) return stem + 'ído'; // sair → saído, doer → doído, construir → construído
  return stem + 'ido';
}

// Portuguese verbs whose only participle is irregular, and verbs with two (the regular one is used with ter).
const PT_STRONG = PT_IRREGULAR_PARTICIPLE;
const PT_ABUNDANT = /^(aceitar|acender|eleger|entregar|enxugar|expressar|expulsar|extinguir|fritar|ganhar|gastar|imprimir|isentar|limpar|matar|morrer|pagar|pegar|prender|salvar|soltar|suspender|benzer|envolver|imergir|emergir|exprimir|frigir|inserir|juntar|revolver|romper|submergir|tingir)$/;

/** Participles of a Portuguese verb from the sources' candidates, checked against the regular form. */
export function portugueseParticiples(inf, candidates) {
  const regular = regularParticiple(inf, 'pt');
  const irregular = candidates.filter((c) => c !== regular && /o$/.test(c));
  if (PT_STRONG.test(inf) && irregular.length) return [irregular[0]];
  if (!regular) return candidates.slice(0, 1);
  if (PT_ABUNDANT.test(inf) && irregular.length) return [regular, irregular[0]];
  return [regular];
}

/** Repairs to verbecc output before it is used (see the agreement figures in the reports). */
export function fixVerbecc(cells, inf, lang) {
  // Drop template debris such as "r)" or "Br)" left from "(Br: …)" annotations in the Portuguese data.
  for (const [k, forms] of Object.entries(cells)) {
    const ok = forms.filter((f) => /^[\p{L} ]+$/u.test(f) && f.replace(/^(no|não) /, '').length > 1);
    if (ok.length) cells[k] = ok;
    else delete cells[k];
  }
  // (Portuguese participles are decided later from both sources: portugueseParticiples.)
  const part = cells['part|m.sg'];
  const regular = regularParticiple(inf, lang);
  if (lang === 'es' && part && regular && !part.includes(regular) && !ES_IRREGULAR_PARTICIPLE.test(inf)) cells['part|m.sg'] = [regular];
  if (lang === 'es' && !part && regular) cells['part|m.sg'] = [regular];
  if (lang === 'es') {
    // Compounds of tener, venir and poner stress the last syllable of the tú imperative: obtén, intervén, propón.
    const imp = cells['imp.aff|2s'];
    if (imp && /(tener|venir|poner)$/.test(inf) && !/^(tener|venir|poner)$/.test(inf)) cells['imp.aff|2s'] = imp.map((f) => f.replace(/([eo])n$/, (_, v) => (v === 'e' ? 'én' : 'ón')));
  }
  if (lang === 'pt' && /ar$/.test(inf) && !cells['ind.pret|1p'] && cells['ind.pres|1p']) cells['ind.pret|1p'] = [...cells['ind.pres|1p']]; // Brazilian falamos
  return cells;
}

/**
 * Portuguese spelling after the 1990 Orthographic Agreement, as used in Brazil since 2009 (both sources mix in
 * older spellings): apóie → apoie, vôo → voo, crêem → creem, agüentar → aguentar; falámos → falamos.
 */
export function brazilianSpelling(form, k) {
  let f = form
    .replace(/ü/g, 'u')
    .replace(/êem$/, 'eem')
    .replace(/ôo(s?)$/, 'oo$1')
    .replace(/([éó])i([aeo]s?|am|em)$/, (_, v, end) => (v === 'é' ? 'e' : 'o') + 'i' + end);
  if (k === 'ind.pret|1p') f = f.replace(/ámos$/, 'amos');
  if (k === 'sbjv.pres|1p' || k === 'imp.aff|1p' || k === 'imp.neg|1p') f = f.replace(/dêmos$/, 'demos');
  return f;
}

/** The personal infinitive is regular for every verb: falar, falares, falar, falarmos, falardes, falarem (pôr → pores). */
export function personalInfinitive(inf) {
  const base = inf.replace(/ôr$/, 'or');
  // A stressed i after a vowel takes an accent: sair → saíres, saírem; construir → construíres.
  const hiatus = /[aeiou]ir$/.test(inf) ? base.replace(/ir$/, 'ír') : base;
  return { '1s': inf, '2s': hiatus + 'es', '3s': inf, '1p': base + 'mos', '2p': base + 'des', '3p': hiatus + 'em' };
}

// ------------------------------------------------------------------ completing a table

/** Spanish voseo from the vosotros forms (habláis → hablás, tengáis → tengás, sois → sos, hablad → hablá). */
export function vosFrom(vosotros, tense) {
  if (!vosotros) return null;
  if (tense === 'imp.aff') {
    const m = /^(.*?)([aeií])d$/.exec(vosotros);
    if (!m) return null;
    const accented = { a: 'á', e: 'é', i: 'í', í: 'í' }[m[2]];
    // Monosyllables take no accent: dad → da, ved → ve, sed → sé (kept distinct from the pronoun se).
    if (!/[aeiouáéíóú]/.test(m[1])) return vosotros === 'sed' ? 'sé' : m[1] + m[2];
    return m[1] + accented;
  }
  if (tense === 'imp.neg') {
    const v = vosFrom(vosotros.replace(/^no /, ''), 'sbjv.pres');
    return v ? `no ${v}` : null;
  }
  const out = vosotros.replace(/([áé])is$/, '$1s').replace(/ois$/, 'os').replace(/ais$/, 'as').replace(/eis$/, 'es');
  return out !== vosotros || /ís$/.test(vosotros) ? out : null;
}

const HABER = {
  'ind.pres': ['he', 'has', 'ha', 'hemos', 'habéis', 'han'],
  'ind.impf': ['había', 'habías', 'había', 'habíamos', 'habíais', 'habían'],
  'ind.fut': ['habré', 'habrás', 'habrá', 'habremos', 'habréis', 'habrán'],
  cond: ['habría', 'habrías', 'habría', 'habríamos', 'habríais', 'habrían'],
  'sbjv.pres': ['haya', 'hayas', 'haya', 'hayamos', 'hayáis', 'hayan'],
  'sbjv.impf': [['hubiera', 'hubiese'], ['hubieras', 'hubieses'], ['hubiera', 'hubiese'], ['hubiéramos', 'hubiésemos'], ['hubierais', 'hubieseis'], ['hubieran', 'hubiesen']],
};
const HABER_VOS = { 'ind.pres': 'has', 'ind.impf': 'habías', 'ind.fut': 'habrás', cond: 'habrías', 'sbjv.pres': 'hayás', 'sbjv.impf': ['hubieras', 'hubieses'] };
const TER = {
  'ind.pres': ['tenho', 'tens', 'tem', 'temos', 'tendes', 'têm'],
  'ind.impf': ['tinha', 'tinhas', 'tinha', 'tínhamos', 'tínheis', 'tinham'],
  'ind.fut': ['terei', 'terás', 'terá', 'teremos', 'tereis', 'terão'],
  cond: ['teria', 'terias', 'teria', 'teríamos', 'teríeis', 'teriam'],
  'sbjv.pres': ['tenha', 'tenhas', 'tenha', 'tenhamos', 'tenhais', 'tenham'],
  'sbjv.impf': ['tivesse', 'tivesses', 'tivesse', 'tivéssemos', 'tivésseis', 'tivessem'],
  'sbjv.fut': ['tiver', 'tiveres', 'tiver', 'tivermos', 'tiverdes', 'tiverem'],
};
const COMPOUND = {
  'ind.pres': 'c.ind.perf',
  'ind.impf': 'c.ind.plup',
  'ind.fut': 'c.ind.fut',
  cond: 'c.cond',
  'sbjv.pres': 'c.sbjv.perf',
  'sbjv.impf': 'c.sbjv.plup',
  'sbjv.fut': 'c.sbjv.fut',
};

/**
 * Finish a verb's cells: participle agreement forms, Brazilian spelling, Spanish voseo where the source has
 * none, the Portuguese -ar preterite "nós" form verbecc leaves empty, and compound tenses.
 */
export function completeVerb(cells, lang, infinitive) {
  const out = {};
  for (const [k, forms] of Object.entries(cells)) out[k] = lang === 'pt' ? [...new Set(forms.map((f) => brazilianSpelling(f, k)))] : [...forms];
  if (!out['nfin|inf']) out['nfin|inf'] = [infinitive];
  if (lang === 'pt') {
    for (const [p, f] of Object.entries(personalInfinitive(infinitive))) out[`inf.pers|${p}`] = [f];
    out['part|m.sg'] = portugueseParticiples(infinitive, out['part|m.sg'] ?? []);
    for (const k of ['part|f.sg', 'part|m.pl', 'part|f.pl']) delete out[k];
  }
  const part = out['part|m.sg']?.[0];
  if (out['part|m.sg']?.every((f) => /o$/.test(f))) {
    const stems = out['part|m.sg'].map((f) => f.slice(0, -1));
    out['part|f.sg'] ??= stems.map((x) => x + 'a');
    out['part|m.pl'] ??= stems.map((x) => x + 'os');
    out['part|f.pl'] ??= stems.map((x) => x + 'as');
  }
  if (lang === 'pt' && !out['ind.pret|1p'] && /ar$/.test(infinitive) && out['ind.pres|1p']) out['ind.pret|1p'] = [...out['ind.pres|1p']];
  if (lang === 'es') {
    for (const t of ['ind.pres', 'sbjv.pres', 'imp.aff', 'imp.neg']) {
      if (out[`${t}|2s.vos`] || !out[`${t}|2p`]) continue;
      const v = infinitive === 'ser' && t === 'ind.pres' ? 'sos' : infinitive === 'ir' && t === 'imp.aff' ? 'andá' : vosFrom(out[`${t}|2p`][0], t);
      if (v) out[`${t}|2s.vos`] = [v];
    }
    // vos takes the tú forms in the other tenses
    for (const t of ['ind.pret', 'ind.impf', 'ind.fut', 'cond', 'sbjv.impf', 'sbjv.fut']) if (!out[`${t}|2s.vos`] && out[`${t}|2s`]) out[`${t}|2s.vos`] = [...out[`${t}|2s`]];
  }
  if (part) {
    const aux = lang === 'es' ? HABER : TER;
    for (const [t, forms] of Object.entries(aux)) {
      PERSONS.forEach((p, i) => {
        const a = forms[i];
        out[`${COMPOUND[t]}|${p}`] = (Array.isArray(a) ? a : [a]).map((x) => `${x} ${part}`);
      });
      if (lang === 'es') {
        const a = HABER_VOS[t];
        out[`${COMPOUND[t]}|2s.vos`] = (Array.isArray(a) ? a : [a]).map((x) => `${x} ${part}`);
      }
    }
  }
  return out;
}

const CORE = ['ind.pres', 'ind.pret', 'ind.impf', 'ind.fut', 'cond', 'sbjv.pres', 'sbjv.impf'];

/** A table that has every core tense for every person (UniMorph's last Spanish verb is cut off mid-table). */
export function isComplete(cells) {
  return CORE.every((t) => PERSONS.every((p) => cells[`${t}|${p}`]?.length)) && !!cells['nfin|ger'] && !!cells['part|m.sg'];
}

/** Compare two tables cell by cell (first forms, accents included) → {cells, same}. */
export function agreement(a, b) {
  let cells = 0;
  let same = 0;
  for (const [k, forms] of Object.entries(a)) {
    if (k.startsWith('c.') || !b[k]?.length || !forms.length) continue;
    cells++;
    if (b[k].includes(forms[0]) || forms.includes(b[k][0])) same++;
  }
  return { cells, same };
}

// ------------------------------------------------------------------ choosing between the sources

const fold = (s) => s.normalize('NFD').replace(/\p{M}/gu, '');

// Endings every Portuguese verb has in these cells, irregular ones included; a form without the expected
// ending is a misplaced or garbled cell in that source (UniMorph has e.g. "estareis" as the tu future).
const PT_ENDINGS = {
  'ind.impf': [/a$/, /as$/, /a$/, /amos$/, /eis$/, /am$/],
  'ind.fut': [/ei$/, /ás$/, /á$/, /emos$/, /eis$/, /ão$/],
  cond: [/ia$/, /ias$/, /ia$/, /íamos$/, /íeis$/, /iam$/],
  'sbjv.impf': [/sse$/, /sses$/, /sse$/, /ssemos$/, /sseis$/, /ssem$/],
  'sbjv.fut': [/r$/, /res$/, /r$/, /rmos$/, /rdes$/, /rem$/],
  'ind.plup': [/ra$/, /ras$/, /ra$/, /ramos$/, /reis$/, /ram$/],
  'ind.pret': [null, /ste$/, null, /mos$/, /stes$/, /ram$/],
  'ind.pres': [null, /s$/, null, /mos$/, /s$/, /(m|ão)$/],
  'sbjv.pres': [null, /s$/, null, /mos$/, /(is|des)$/, /(m|ão)$/],
};

function expectedEnding(k) {
  const [t, p] = k.split('|');
  return PT_ENDINGS[t]?.[PERSONS.indexOf(p)] ?? null;
}

/**
 * One Portuguese cell from both sources → [forms, rule]. Agreement keeps UniMorph's forms (they may list
 * variants); otherwise, in order: split a UniMorph concatenation ("vamosimos" → vamos, imos), trust the source
 * with the ending every verb has in that cell, take verbecc's accents where only accents differ (destruías,
 * reunamos; UniMorph's -oer accents dói, róis are right), else UniMorph's form (destrói, baleio, voo).
 */
export function choosePortuguese(k, u, v, inf) {
  if (!u?.length) return [v, 'verbecc only'];
  if (!v?.length) return [u, 'unimorph only'];
  if (u.some((f) => v.includes(f))) return [u, 'agree'];
  const [u0] = u;
  const [v0] = v;
  if (u.length === 1 && u0.length > v0.length + 1 && (u0.startsWith(v0) || u0.endsWith(v0))) {
    const rest = u0.startsWith(v0) ? u0.slice(v0.length) : u0.slice(0, -v0.length);
    const parts = u0.startsWith(v0) ? [v0, rest] : [rest, v0];
    return [parts.filter((f, i) => f.length > 1 && !(i && fold(f) === fold(parts[0]))), 'split concatenation'];
  }
  const re = expectedEnding(k);
  if (re && re.test(u0) !== re.test(v0)) return re.test(u0) ? [u, 'ending'] : [v, 'ending'];
  if (fold(u0) === fold(v0)) return /oer$/.test(inf) ? [u, 'accents'] : [v, 'accents'];
  return [u, 'unimorph preferred'];
}

/** Portuguese imperatives from the present tenses (tu fala, vós falai; você/nós/vocês and every negative from the subjunctive). */
export function portugueseImperatives(cells, inf) {
  const out = {};
  const pres = (p) => cells[`ind.pres|${p}`]?.[0];
  const sbj = (p) => cells[`sbjv.pres|${p}`];
  if (inf === 'ser') {
    out['imp.aff|2s'] = ['sê'];
    out['imp.aff|2p'] = ['sede'];
  } else {
    const tu = pres('2s');
    if (tu) out['imp.aff|2s'] = /zes$/.test(tu) ? [tu.slice(0, -2), tu.slice(0, -1)] : [/ns$/.test(tu) ? tu.slice(0, -2) + 'm' : tu.replace(/s$/, '')];
    const vos = pres('2p');
    if (vos) out['imp.aff|2p'] = [vos.replace(/s$/, '')];
  }
  for (const p of ['3s', '1p', '3p']) if (sbj(p)) out[`imp.aff|${p}`] = [...sbj(p)];
  for (const p of ['2s', '3s', '1p', '2p', '3p']) if (sbj(p)) out[`imp.neg|${p}`] = sbj(p).map((f) => `não ${f}`);
  return out;
}

/** European -eio variants after the Brazilian ones (negocio before negoceio). */
function brazilianFirst(forms) {
  return [...forms].sort((a, b) => Number(/cei/.test(a) && forms.includes(a.replace('cei', 'ci'))) - Number(/cei/.test(b) && forms.includes(b.replace('cei', 'ci'))));
}

const normalizePt = (cells) => Object.fromEntries(Object.entries(cells).map(([k, forms]) => [k, [...new Set(forms.map((f) => brazilianSpelling(f, k)))]]));

/**
 * The finished table for one verb, or null → {cells, source, rules}. Spanish: UniMorph when its table is complete,
 * else verbecc. Portuguese: both sources cell by cell (choosePortuguese), imperatives derived from the result.
 */
export function verbTable(lang, inf, uRows, verbeccCells) {
  const u = uRows ? unimorphCells(uRows, lang) : null;
  const v = verbeccCells ? fixVerbecc(verbeccCells, inf, lang) : null;
  if (lang === 'es') {
    if (u && isComplete(u)) return { cells: completeVerb(u, lang, inf), source: 'unimorph', rules: {} };
    if (v) return { cells: completeVerb(v, lang, inf), source: 'verbecc', rules: {} };
    return null;
  }
  const un = u && Object.keys(u).length ? normalizePt(u) : null;
  const vn = v ? normalizePt(v) : null;
  if (!un && !vn) return null;
  const rules = {};
  const cells = {};
  for (const k of new Set([...Object.keys(un ?? {}), ...Object.keys(vn ?? {})])) {
    if (k.startsWith('imp.') || k.startsWith('part|') || k.startsWith('inf.pers')) continue;
    const [forms, rule] = choosePortuguese(k, un?.[k], vn?.[k], inf);
    rules[rule] = (rules[rule] ?? 0) + 1;
    if (forms?.length) cells[k] = brazilianFirst(forms);
  }
  cells['part|m.sg'] = [...new Set([...(un?.['part|m.sg'] ?? []), ...(vn?.['part|m.sg'] ?? [])])];
  Object.assign(cells, portugueseImperatives(cells, inf));
  const source = un && vn ? 'unimorph+verbecc' : un ? 'unimorph' : 'verbecc';
  return { cells: completeVerb(cells, lang, inf), source, rules };
}
