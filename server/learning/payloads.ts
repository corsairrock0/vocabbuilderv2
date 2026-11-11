// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
/** Builds self-contained exercise payloads (prompt, options, accepted answers) from vocabulary data. */
import type { AnswerSpec } from '../../shared/answer.ts';
import type { ExerciseKind } from '../../shared/exercises.ts';
import type { LanguageCode } from '../../shared/languages.ts';
import { canonical, editDistance, englishCore, foldLatinDiacritics, hideWord, soundVariants, stripStress } from '../../shared/text.ts';
import type { ExercisePayload, ItemResource, Option } from '../../shared/types.ts';
import { cellLabel, drillCells, formsSpec, type Paradigm } from '../../shared/paradigms.ts';
import { exactCellOf, noNote, type ExactCell } from '../../shared/grammar.ts';
import type { ExactLookup } from './grammar.ts';

export interface PoolEntry {
  entryId: number;
  lemma: string;
  display: string;
  pos: string;
  gloss: string;
}

export interface BuildContext {
  rand: () => number;
  pool: PoolEntry[];
  language: LanguageCode;
  audioOk: boolean;
  /** The annotated cell of a sentence's target form (data/grammar/, server/learning/grammar.ts); none without it. */
  exact?: ExactLookup;
}

type Entry = Omit<ItemResource, 'variants'> & { paradigm?: Paradigm | null };

export function shuffle<T>(arr: T[], rand: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const OPTION_IDS = ['a', 'b', 'c', 'd', 'e', 'f'];

function makeOptions(correct: string, distractors: string[], rand: () => number, sub?: Map<string, string>): { options: Option[]; correctId: string } {
  const texts = shuffle([correct, ...distractors], rand);
  const options = texts.map((text, i) => ({ id: OPTION_IDS[i], text, ...(sub?.get(text) ? { sub: sub.get(text) } : {}) }));
  return { options, correctId: options.find((o) => o.text === correct)!.id };
}

const plain = (s: string) => stripStress(s);
const graphemes = (s: string) => [...s];

function translationKeys(e: Entry): Set<string> {
  const keys = new Set<string>();
  for (const s of e.senses) {
    keys.add(englishCore(s.gloss));
    for (const t of s.translations) keys.add(englishCore(t));
  }
  return keys;
}

function folded(s: string, lang: LanguageCode): string {
  const c = canonical(s, lang);
  return lang === 'ru' || lang === 'uk' ? c.replace(/ё/g, 'е') : foldLatinDiacritics(c);
}

function pickDistractors(e: Entry, ctx: BuildContext, count: number, textOf: (p: PoolEntry) => string, exclude: (p: PoolEntry) => boolean): string[] {
  const seen = new Set<string>([textOf({ entryId: e.entryId, lemma: e.lemma, display: e.display, pos: e.pos, gloss: e.senses[0]?.gloss ?? '' }).toLowerCase()]);
  const candidates = ctx.pool.filter((p) => p.entryId !== e.entryId && textOf(p) && !exclude(p));
  const same = shuffle(candidates.filter((p) => p.pos === e.pos), ctx.rand);
  const other = shuffle(candidates.filter((p) => p.pos !== e.pos), ctx.rand);
  const out: string[] = [];
  for (const p of [...same, ...other]) {
    const t = textOf(p);
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length >= count) break;
  }
  return out;
}

function glossDistractors(e: Entry, ctx: BuildContext, count = 3): string[] {
  const keys = translationKeys(e);
  return pickDistractors(e, ctx, count, (p) => p.gloss, (p) => keys.has(englishCore(p.gloss)));
}

function wordDistractors(e: Entry, ctx: BuildContext, count = 3): string[] {
  const keys = translationKeys(e);
  const lemmaKey = canonical(e.lemma, ctx.language);
  return pickDistractors(
    e,
    ctx,
    count,
    (p) => p.display || p.lemma,
    (p) => canonical(p.lemma, ctx.language) === lemmaKey || keys.has(englishCore(p.gloss)),
  );
}

function similarWords(e: Entry, ctx: BuildContext, max = 3): string[] {
  const target = folded(e.lemma, ctx.language);
  const scored = ctx.pool
    .filter((p) => p.entryId !== e.entryId && canonical(p.lemma, ctx.language) !== canonical(e.lemma, ctx.language))
    .map((p) => ({ p, d: editDistance(folded(p.lemma, ctx.language), target, 2) }))
    .filter((x) => x.d <= 2)
    .sort((a, b) => a.d - b.d);
  return scored.slice(0, max).map((x) => x.p.display || x.p.lemma);
}

function confusableLemmas(e: Entry, ctx: BuildContext, target: string): string[] {
  const t = folded(target, ctx.language);
  return ctx.pool
    .filter((p) => p.entryId !== e.entryId)
    .map((p) => plain(p.lemma))
    .filter((l) => canonical(l, ctx.language) !== canonical(target, ctx.language) && editDistance(folded(l, ctx.language), t, 2) <= 2)
    .slice(0, 25);
}

function confusableGlosses(e: Entry, ctx: BuildContext, accepted: string[]): string[] {
  const acc = accepted.map(englishCore);
  const accSet = new Set(acc);
  const keys = translationKeys(e);
  return ctx.pool
    .filter((p) => p.entryId !== e.entryId && p.gloss && !keys.has(englishCore(p.gloss)) && !accSet.has(englishCore(p.gloss)))
    .filter((p) => acc.some((a) => editDistance(englishCore(p.gloss), a, 2) <= 2))
    .map((p) => p.gloss)
    .slice(0, 25);
}

type Example = Entry['examples'][number];

/** The meaning (index into senses) a sentence shows: its linked meaning, or the only meaning of a one-meaning word. */
export function meaningOf(e: Pick<Entry, 'senses'>, x: Pick<Example, 'sense'>): number | null {
  if (x.sense != null) return e.senses[x.sense] ? x.sense : null;
  return e.senses.length === 1 ? 0 : null;
}

/**
 * A sentence with a gap-able target. needMeaning: only sentences whose meaning is known, for questions that quiz the
 * meaning (a multi-meaning word's unlinked sentence could show any of them).
 */
function exampleWithTarget(e: Entry, rand: () => number, needMeaning = false) {
  const ok = e.examples.filter((x) => x.target && x.start != null && x.end != null && x.translation && (!needMeaning || meaningOf(e, x) != null));
  if (!ok.length) return null;
  return ok[Math.floor(rand() * ok.length)];
}

/** The meaning shown by a sentence, for display with the answer. */
function meaningPart(e: Entry, x: Example): { meaning?: string } {
  const k = meaningOf(e, x);
  return k != null && e.senses.length > 1 ? { meaning: e.senses[k].gloss } : {};
}

/**
 * The cell the sentence's target fills there and why, from the annotations (data/grammar/), when the word's table
 * confirms it (the cell holds the target): the feedback then names that one cell. Undefined otherwise.
 */
export function exactOf(language: LanguageCode, e: Pick<Entry, 'lemma' | 'paradigm'>, x: Pick<Example, 'text' | 'target'>, lookup: ExactLookup | undefined): ExactCell | undefined {
  const found = x.target && lookup ? lookup(e.lemma, x.target, x.text) : null;
  if (found && noNote(found)) return { cell: found.cell, why: found.why };
  return found && exactCellOf(language, e.paradigm, e.lemma, x.target, found) ? { cell: found.cell, why: found.why } : undefined;
}

/** A sentence split around its target word (with the stress-marked display split the same way). */
export function splitSentence(ex: { text: string; display?: string | null; target?: string | null; start?: number | null; end?: number | null; translation?: string | null; ai?: boolean }) {
  const before = ex.text.slice(0, ex.start!);
  const after = ex.text.slice(ex.end!);
  let beforeDisplay: string | undefined;
  let afterDisplay: string | undefined;
  if (ex.display && ex.target) {
    // Map the plain-text range onto the stress-marked display string.
    const disp = ex.display;
    let di = 0;
    let pi = 0;
    const map: number[] = [];
    while (di <= disp.length) {
      map[pi] = di;
      if (di === disp.length) break;
      const ch = disp[di];
      if (ch === '́' || ch === '̀') {
        di++;
        continue;
      }
      di++;
      pi++;
    }
    if (map[ex.start!] != null && map[ex.end!] != null) {
      let endIdx = map[ex.end!];
      while (disp[endIdx] === '́' || disp[endIdx] === '̀') endIdx++;
      beforeDisplay = disp.slice(0, map[ex.start!]);
      afterDisplay = disp.slice(endIdx);
    }
  }
  return { before, after, beforeDisplay, afterDisplay, translation: ex.translation ?? '', ...(ex.ai ? { ai: true } : {}) };
}

function sameMeaningWords(e: Entry, ctx: BuildContext): string[] {
  const g = englishCore(e.senses[0]?.gloss ?? '');
  if (!g) return [];
  return ctx.pool.filter((p) => p.entryId !== e.entryId && englishCore(p.gloss) === g).map((p) => plain(p.lemma)).slice(0, 10);
}

function recallSpec(e: Entry, ctx: BuildContext): AnswerSpec {
  const accepted = [...new Set([plain(e.lemma), plain(e.display)].filter(Boolean))];
  const accKeys = new Set(accepted.map((a) => canonical(a, ctx.language)));
  const sameMeaning = sameMeaningWords(e, ctx).filter((w) => !accKeys.has(canonical(w, ctx.language)));
  return {
    lang: ctx.language,
    accepted,
    otherForms: e.forms.map((f) => ({ form: plain(f.form), tags: f.tags })).filter((f) => !accKeys.has(canonical(f.form, ctx.language))),
    confusables: confusableLemmas(e, ctx, e.lemma).filter((w) => !sameMeaning.includes(w)),
    sameMeaning,
  };
}

export function buildPayload(kind: ExerciseKind, e: Entry, ctx: BuildContext): ExercisePayload | null {
  const gloss = e.senses[0]?.gloss ?? '';
  const word = e.display || e.lemma;
  // Questions that show the meaning and ask for the word must not show the word inside the meaning.
  const forms = [e.lemma, plain(e.display || ''), ...e.forms.map((f) => plain(f.form))];
  const askGloss = hideWord(gloss, forms, ctx.language);
  const askNote = e.senses[0]?.note ? hideWord(e.senses[0].note, forms, ctx.language, true) : null;
  switch (kind) {
    case 'intro':
      return { kind, entryId: e.entryId };
    case 'meaning_choice': {
      const d = glossDistractors(e, ctx);
      if (d.length < 1 || !gloss) return null;
      return { kind, entryId: e.entryId, word, plain: plain(word), pos: e.pos, ...makeOptions(gloss, d, ctx.rand) };
    }
    case 'meaning_typed': {
      const primary = e.senses[0];
      if (!primary) return null;
      const accepted = [...new Set([primary.gloss, ...primary.translations])];
      return {
        kind,
        entryId: e.entryId,
        word,
        plain: plain(word),
        pos: e.pos,
        answer: {
          lang: 'en',
          accepted,
          otherMeanings: e.senses.slice(1).flatMap((s) => [s.gloss, ...s.translations]),
          confusables: confusableGlosses(e, ctx, accepted),
        },
      };
    }
    case 'context_meaning': {
      // The right answer is the meaning this sentence shows, which need not be the word's first meaning.
      const ex = exampleWithTarget(e, ctx.rand, true);
      if (!ex) return null;
      const shown = e.senses[meaningOf(e, ex)!]?.gloss;
      if (!shown) return null;
      const d = glossDistractors(e, ctx);
      if (!d.length) return null;
      return {
        kind,
        entryId: e.entryId,
        sentence: ex.text,
        sentenceDisplay: ex.display ?? undefined,
        highlight: [ex.start!, ex.end!],
        translation: ex.translation ?? '',
        ...(ex.ai ? { ai: true } : {}),
        ...makeOptions(shown, d, ctx.rand),
      };
    }
    case 'word_choice': {
      // Exclude other words with the same English meaning from the options (both would be "right").
      const same = new Set(sameMeaningWords(e, ctx).map((w) => canonical(w, ctx.language)));
      const d = wordDistractors(e, ctx).filter((w) => !same.has(canonical(plain(w), ctx.language)));
      if (!d.length || !gloss) return null;
      return { kind, entryId: e.entryId, gloss: askGloss, note: askNote, pos: e.pos, gender: e.gender, ...makeOptions(word, d, ctx.rand) };
    }
    case 'recall_typed': {
      if (!gloss) return null;
      const p = plain(e.lemma);
      return {
        kind,
        entryId: e.entryId,
        gloss: askGloss,
        note: askNote,
        pos: e.pos,
        gender: e.gender,
        aspect: e.aspect,
        hint: { first: graphemes(p)[0] ?? '', length: graphemes(p).length },
        answer: recallSpec(e, ctx),
      };
    }
    case 'cloze_choice': {
      const ex = exampleWithTarget(e, ctx.rand);
      if (!ex) return null;
      const target = ex.target!;
      const tKey = canonical(target, ctx.language);
      const otherForms = [...new Set(e.forms.map((f) => plain(f.form)).concat(plain(e.lemma)))].filter((f) => canonical(f, ctx.language) !== tKey);
      const exact = exactOf(ctx.language, e, ex, ctx.exact);
      const parts = { ...splitSentence(ex), ...meaningPart(e, ex), ...(exact ? { exact } : {}) };
      // Options take the target's capitalisation, so a sentence-initial blank does not give the answer away.
      const asTarget = (w: string) => matchCase(w, target, ctx.language);
      if (otherForms.length >= 2) {
        const d = shuffle(otherForms, ctx.rand).slice(0, 3).map(asTarget);
        return { kind, entryId: e.entryId, mode: 'form', lemmaHint: word, ...parts, ...makeOptions(target, d, ctx.rand) };
      }
      // A sound variant of the target (Ukrainian у for в) would be a second right answer.
      const variants = soundVariants(target, ctx.language).variants;
      const d = pickDistractors(e, ctx, 3, (p) => plain(p.lemma), (p) => canonical(p.lemma, ctx.language) === canonical(e.lemma, ctx.language) || variants.includes(canonical(p.lemma, ctx.language))).map(asTarget);
      if (!d.length) return null;
      return { kind, entryId: e.entryId, mode: 'word', ...parts, ...makeOptions(target, d, ctx.rand) };
    }
    case 'cloze_typed': {
      const ex = exampleWithTarget(e, ctx.rand);
      if (!ex) return null;
      const target = ex.target!;
      const tKey = canonical(target, ctx.language);
      const exact = exactOf(ctx.language, e, ex, ctx.exact);
      // The hint names the form the gap needs: the sentence's own cell when it is known, else every cell holding it.
      const formTags = exact ? (noNote(exact) ? undefined : [cellLabel(ctx.language, exact.cell)]) : e.forms.find((f) => canonical(f.form, ctx.language) === tKey)?.tags;
      const others = [...e.forms.map((f) => ({ form: plain(f.form), tags: f.tags })), { form: plain(e.lemma), tags: ['dictionary form'] }].filter(
        (f) => canonical(f.form, ctx.language) !== tKey,
      );
      return {
        kind,
        entryId: e.entryId,
        lemmaHint: word,
        tags: formTags,
        ...splitSentence(ex),
        ...meaningPart(e, ex),
        ...(exact ? { exact } : {}),
        answer: { lang: ctx.language, accepted: [target, ...freeVariants(target, ctx.language)], otherForms: others, confusables: confusableLemmas(e, ctx, target) },
      };
    }
    case 'form_typed': {
      if (!['noun', 'verb', 'adjective', 'pronoun'].includes(e.pos)) return null;
      // With a declension or conjugation table, ask for one of its cells by name ("genitive plural", "preterite (yo)").
      if (e.paradigm) {
        if (e.paradigm.indeclinable) return null;
        const cells = drillCells(ctx.language, e.paradigm);
        if (!cells.length) return null;
        const cell = cells[Math.floor(ctx.rand() * cells.length)];
        return { kind, entryId: e.entryId, lemma: plain(e.lemma), display: word, tags: [cellLabel(ctx.language, cell)], cell, answer: formsSpec(ctx.language, e.paradigm, cell, e.lemma) };
      }
      const lemmaKey = canonical(e.lemma, ctx.language);
      const candidates = e.forms.filter((f) => f.tags.length && canonical(f.form, ctx.language) !== lemmaKey);
      if (!candidates.length) return null;
      const f = candidates[Math.floor(ctx.rand() * candidates.length)];
      const others = e.forms.filter((x) => x !== f).map((x) => ({ form: plain(x.form), tags: x.tags }));
      others.push({ form: plain(e.lemma), tags: ['dictionary form'] });
      return {
        kind,
        entryId: e.entryId,
        lemma: plain(e.lemma),
        display: word,
        tags: f.tags,
        answer: { lang: ctx.language, accepted: [plain(f.form)], otherForms: others.filter((o) => canonical(o.form, ctx.language) !== canonical(f.form, ctx.language)) },
      };
    }
    case 'listen_meaning': {
      if (!ctx.audioOk || !gloss) return null;
      const d = glossDistractors(e, ctx);
      if (!d.length) return null;
      return { kind, entryId: e.entryId, word, ...makeOptions(gloss, d, ctx.rand) };
    }
    case 'listen_choice': {
      if (!ctx.audioOk) return null;
      const similar = similarWords(e, ctx);
      const fill = similar.length >= 3 ? [] : wordDistractors(e, ctx, 3 - similar.length).filter((w) => !similar.includes(w));
      const d = [...similar, ...fill].slice(0, 3);
      if (!d.length) return null;
      return { kind, entryId: e.entryId, gloss: askGloss, contrast: similar.length > 0, ...makeOptions(word, d, ctx.rand) };
    }
    case 'dictation': {
      if (!ctx.audioOk) return null;
      return { kind, entryId: e.entryId, gloss: askGloss, answer: recallSpec(e, ctx) };
    }
    case 'speak_flashcard':
      if (!gloss) return null;
      return { kind, entryId: e.entryId, gloss: askGloss, pos: e.pos, word, plain: plain(word) };
    case 'sentence_create':
      return {
        kind,
        entryId: e.entryId,
        word,
        gloss,
        // Only sentences that show the meaning the card names (the first one).
        examples: e.examples
          .filter((x) => x.translation && meaningOf(e, x) === 0)
          .slice(0, 2)
          .map((x) => ({ text: x.display || x.text, translation: x.translation ?? '', ...(x.ai ? { ai: true } : {}) })),
      };
    case 'shadowing':
      if (!ctx.audioOk) return null;
      return { kind, entryId: e.entryId, word, gloss };
    case 'picture_choice': {
      if (!e.imageUrl) return null;
      const d = wordDistractors(e, ctx);
      if (!d.length) return null;
      return { kind, entryId: e.entryId, imageUrl: e.imageUrl, ...makeOptions(word, d, ctx.rand) };
    }
  }
}

/** Give `word` the capitalisation pattern of `model`: Capitalised, UPPER or unchanged. */
/** Ukrainian в/у, і/й, з/із/зі: a variant chosen for sound is as right as the sentence's own word. */
function freeVariants(target: string, language: LanguageCode): string[] {
  const sound = soundVariants(target, language);
  return sound.free ? sound.variants.map((v) => matchCase(v, target, language)) : [];
}

export function matchCase(word: string, model: string, language: string): string {
  if (!word) return word;
  const first = model.charAt(0);
  const isUpper = (c: string) => c !== c.toLocaleLowerCase(language) && c === c.toLocaleUpperCase(language);
  if (model.length > 1 && [...model].every((c) => !/\p{L}/u.test(c) || isUpper(c))) return word.toLocaleUpperCase(language);
  if (isUpper(first)) return word.charAt(0).toLocaleUpperCase(language) + word.slice(1);
  return word;
}
