// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
/**
 * The exact cell of a word in an example sentence, for grammar explanations (shared/grammar.ts).
 *
 * A form can fill several cells of a word's table (українське: the nominative or accusative neuter; hablamos: the
 * present or the preterite), and the rules of shared/grammar.ts can't always tell which one a sentence uses. For the
 * example sentences of the frequency sets, the cell and the reason were annotated offline by AI. They come from
 * <grammarDir>/<lang>.json (data/grammar/ unless VB_GRAMMAR_DIR says otherwise), built by scripts/grammar/build.mjs
 * from data/grammar/src/<lang>.jsonl and keyed by exactKey (language, lemma, form and sentence in comparison form).
 *
 * Exercise payloads that carry a sentence with its target form carry the annotation too (`exact`: session cloze
 * exercises in server/learning/payloads.ts, the sentence-gap practice in server/learning/practice.ts), so the answer
 * feedback names that one cell. A missing file means no annotations, not an error; a file is re-read when it changes.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { App } from '../app.ts';
import { exactKey, type ExactCell } from '../../shared/grammar.ts';
import type { LanguageCode } from '../../shared/languages.ts';
import { log } from '../log.ts';

/** What scripts/grammar/build.mjs writes: entries are key → [cell, why]. */
export interface GrammarFile {
  format: string;
  language: LanguageCode;
  version: string;
  credit: string;
  count: number;
  cells: Record<string, [string, string]>;
}

export interface GrammarData {
  language: LanguageCode;
  version: string;
  cells: Map<string, { cell: string; why: string }>;
}

/** Looks up the annotation of a sentence's target form: (lemma, target, sentence) → its cell and why, or null. */
export type ExactLookup = (lemma: string, target: string, sentence: string) => { cell: string; why: string } | null;

const cache = new Map<string, { mtimeMs: number; size: number; data: GrammarData | null }>();

export function grammarFile(app: App, language: LanguageCode): string {
  return path.join(app.config.grammarDir, `${language}.json`);
}

/** The language's annotations, re-read when the file changes; null when there is no file (or it cannot be read). */
export function loadGrammar(app: App, language: LanguageCode): GrammarData | null {
  const file = grammarFile(app, language);
  if (!existsSync(file)) {
    cache.delete(file);
    return null;
  }
  const { mtimeMs, size } = statSync(file);
  const hit = cache.get(file);
  if (hit && hit.mtimeMs === mtimeMs && hit.size === size) return hit.data;
  let data: GrammarData | null = null;
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<GrammarFile>;
    const cells = new Map<string, { cell: string; why: string }>();
    for (const [key, value] of Object.entries(raw.cells ?? {})) {
      // Keys start with the language (exactKey): a file copied into the wrong name matches nothing.
      if (Array.isArray(value) && typeof value[0] === 'string' && value[0] && typeof value[1] === 'string' && key.startsWith(`${language}|`)) {
        cells.set(key, { cell: value[0], why: value[1] });
      }
    }
    data = { language, version: String(raw.version ?? ''), cells };
  } catch (err) {
    // A broken file must not break study: explanations fall back to the rules until it is rebuilt.
    log.warn('grammar annotations unreadable', { file, error: err instanceof Error ? err.message : String(err) });
  }
  cache.set(file, { mtimeMs, size, data });
  return data;
}

/** The lookup for one language, for a batch of payloads; it finds nothing when the language has no annotations. */
export function exactLookup(app: App, language: LanguageCode): ExactLookup {
  const data = loadGrammar(app, language);
  if (!data?.cells.size) return () => null;
  return (lemma, target, sentence) => (lemma && target && sentence ? (data.cells.get(exactKey(language, lemma, target, sentence)) ?? null) : null);
}

/** The annotation of one sentence's target form, or null. */
export function exactCellFor(app: App, language: LanguageCode, lemma: string, target: string, sentence: string): ExactCell | null {
  return exactLookup(app, language)(lemma, target, sentence);
}
