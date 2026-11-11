// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
import { useState, type ReactNode } from 'react';
import { Button } from './ui/button.tsx';
import type { LanguageCode } from '../../../shared/languages.ts';
import { exactCellOf, explainForm, noNote, paradigmFor, type ExactCell } from '../../../shared/grammar.ts';
import { caseRole, cellLabel, cellsForForm, isNominalRomance, paradigmTable, personNote, verbGroups, type Paradigm, type TableCell, type TableSection } from '../../../shared/paradigms.ts';
import { stripStress } from '../../../shared/text.ts';
import { settings } from '../lib/store.ts';

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

function Forms({ cell, marked }: { cell: TableCell | null; marked: Set<string> }) {
  if (!cell) return <span className="text-muted-foreground" aria-label="no form">—</span>;
  const stress = settings().showStressMarks;
  const text = cell.forms.map((f) => (stress ? f : stripStress(f))).join(', ');
  return marked.has(cell.key) ? (
    <mark className="word mark rounded px-1">{text}</mark>
  ) : (
    <span className="word">{text}</span>
  );
}

const sectionCells = (s: TableSection) => s.rows.flatMap((r) => [...r.cells, ...(r.sub?.flatMap((x) => x.cells) ?? [])]).filter((c): c is TableCell => !!c);

/** The case in the first column: its colour, name and what it is used for ("of, without; after немає"). */
function CaseHead({ language, caseKey, label, extra }: { language: LanguageCode; caseKey: string; label: string; extra?: string }) {
  const role = caseRole(language, caseKey);
  return (
    <span className={`case-head case-${caseKey}`}>
      <span className="font-semibold">{cap(label)}</span>
      {role && <span className="block text-xs leading-snug text-muted-foreground">{role}</span>}
      {extra && <span className="block text-xs text-muted-foreground">{extra}</span>}
    </span>
  );
}

/**
 * Case × number/gender grid (or, for Spanish and Portuguese, number × gender). Identical rows span all columns; the
 * animate/inanimate accusative takes two lines.
 */
function DeclensionSection({ language, s, marked }: { language: LanguageCode; s: TableSection; marked: Set<string> }) {
  const single = s.columns.length === 1 && !s.columns[0].label;
  return (
    <table className="paradigm w-full border-collapse text-[0.98rem]">
      {!single && (
        <thead>
          <tr className="border-b border-border">
            <th scope="col" className="py-1.5 pr-3 text-left text-sm font-semibold text-muted-foreground">
              {s.id === 'cases' ? 'Case' : <span className="sr-only">Number</span>}
            </th>
            {s.columns.map((c) => (
              <th key={c.key} scope="col" className="px-2 py-1.5 text-left text-sm font-semibold text-muted-foreground">
                <span className="sm:hidden" title={c.label}>
                  {c.short}
                </span>
                <span className="hidden sm:inline">{c.label}</span>
              </th>
            ))}
          </tr>
        </thead>
      )}
      <tbody>
        {s.rows.flatMap((r): ReactNode[] => {
          if (r.sub) {
            const [a, b] = r.sub;
            const same = s.columns.map((_, i) => (a.cells[i]?.forms.join() ?? '') === (b.cells[i]?.forms.join() ?? ''));
            return [
              <tr key={`${r.key}-a`}>
                <th scope="row" rowSpan={2} className="py-1.5 pr-3 text-left align-top font-normal">
                  <CaseHead language={language} caseKey={r.key} label={r.label} extra="inanimate / animate" />
                </th>
                {s.columns.map((c, i) => (
                  <td key={c.key} rowSpan={same[i] ? 2 : 1} className={`px-2 pt-1.5 align-top ${same[i] ? 'border-b border-border pb-1.5' : ''}`}>
                    <Forms cell={a.cells[i]} marked={marked} />
                  </td>
                ))}
              </tr>,
              <tr key={`${r.key}-b`} className="border-b border-border">
                {s.columns.map((c, i) =>
                  same[i] ? null : (
                    <td key={c.key} className="px-2 pb-1.5 align-top">
                      <Forms cell={b.cells[i]} marked={marked} />
                    </td>
                  ),
                )}
              </tr>,
            ];
          }
          const caseRow = /^(nom|gen|dat|acc|ins|loc|voc)/.test(r.key);
          return [
            <tr key={r.key} className="border-b border-border last:border-0">
              <th scope="row" className="py-1.5 pr-3 text-left align-top font-normal">
                {caseRow ? <CaseHead language={language} caseKey={r.key} label={r.label} /> : cap(r.label)}
              </th>
              {r.merged ? (
                <td colSpan={s.columns.length} className="px-2 py-1.5 align-top">
                  <Forms cell={r.cells.find(Boolean) ?? null} marked={r.cells.some((x) => x && marked.has(x.key)) ? new Set([r.cells.find(Boolean)!.key]) : marked} />
                </td>
              ) : (
                r.cells.map((cell, i) => (
                  <td key={s.columns[i].key} className="px-2 py-1.5 align-top">
                    <Forms cell={cell} marked={marked} />
                  </td>
                ))
              )}
            </tr>,
          ];
        })}
      </tbody>
    </table>
  );
}

/** One tense: the personal pronouns in the first column, the forms beside them (by gender for the Polish past). */
function TenseCard({ language, s, marked }: { language: LanguageCode; s: TableSection; marked: Set<string> }) {
  if (s.columns.length > 1) return <GridCard s={s} marked={marked} />;
  return (
    <section className="rounded-xl border border-border bg-card p-3" aria-labelledby={`tense-${s.id}`}>
      <h4 id={`tense-${s.id}`} className="font-semibold leading-tight">
        {s.title}
      </h4>
      {s.subtitle && <p className="hint">{s.subtitle}</p>}
      <table className="mt-2 w-full text-[0.98rem]">
        <thead className="sr-only">
          <tr>
            <th scope="col">Pronoun</th>
            <th scope="col">Form</th>
          </tr>
        </thead>
        <tbody>
          {s.rows.map((r) => {
            const note = personNote(language, r.key);
            return (
              <tr key={r.key} className={`border-b border-border last:border-0 ${note ? 'opacity-60' : ''}`}>
                <th scope="row" className="w-[42%] py-1 pr-3 text-left align-top text-sm font-normal text-muted-foreground">
                  <span className="word">{r.label}</span>
                  {note && <span className="block text-xs">{note}</span>}
                </th>
                <td className="py-1 align-top">
                  <Forms cell={r.cells[0]} marked={marked} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

/** A tense whose forms also change with gender (the Polish past and conditional): pronouns down, genders across. */
function GridCard({ s, marked }: { s: TableSection; marked: Set<string> }) {
  return (
    <section className="rounded-xl border border-border bg-card p-3" aria-labelledby={`tense-${s.id}`}>
      <h4 id={`tense-${s.id}`} className="font-semibold leading-tight">
        {s.title}
      </h4>
      {s.subtitle && <p className="hint">{s.subtitle}</p>}
      <table className="mt-2 w-full text-[0.98rem]">
        <thead>
          <tr className="border-b border-border">
            <th scope="col" className="sr-only">
              Pronoun
            </th>
            {s.columns.map((c) => (
              <th key={c.key} scope="col" className="px-1 py-1 text-left text-xs font-semibold text-muted-foreground">
                <span title={c.label}>{c.short}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {s.rows.map((r) => (
            <tr key={r.key} className="border-b border-border last:border-0">
              <th scope="row" className="py-1 pr-2 text-left align-top text-sm font-normal text-muted-foreground">
                <span className="word">{r.label}</span>
              </th>
              {r.cells.map((cell, i) => (
                <td key={s.columns[i].key} className="px-1 py-1 align-top">
                  <Forms cell={cell} marked={marked} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function FullConjugation({ language, sections, marked }: { language: LanguageCode; sections: TableSection[]; marked: Set<string> }) {
  const groups = verbGroups(language);
  const forms = sections.find((s) => s.id === 'nonfinite');
  return (
    <div className="space-y-3">
      {forms && (
        <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-3">
          {forms.rows.map((r) => (
            <div key={r.key}>
              <dt className="text-sm text-muted-foreground">{cap(r.label)}</dt>
              <dd>
                <Forms cell={r.cells[0]} marked={marked} />
              </dd>
            </div>
          ))}
        </dl>
      )}
      {groups.map((g, gi) => {
        const cards = sections.filter((s) => g.tenses.includes(s.id));
        if (!cards.length) return null;
        const hasMark = cards.some((s) => sectionCells(s).some((c) => marked.has(c.key)));
        return (
          <details key={g.id} open={gi === 0 || hasMark} className="group">
            <summary className="cursor-pointer select-none py-1 font-semibold">
              {g.title} <span className="font-normal text-muted-foreground">({cards.length})</span>
            </summary>
            <div className="mt-2 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {cards.map((s) => (
                <TenseCard key={s.id} language={language} s={s} marked={marked} />
              ))}
            </div>
          </details>
        );
      })}
    </div>
  );
}

/**
 * A word's declension or conjugation table. Declensions name each case with what it is used for; conjugations give
 * each tense with the personal pronouns down the side (persons the variety hardly uses are dimmed).
 *
 * `highlight` marks cells (an answer's place in the table). With `focus`, only the tenses or sections holding the
 * marked cells are shown at first, with a button for the whole table. `only` is the older single-cell form of focus.
 */
export function ParadigmTable({
  language,
  paradigm,
  highlight,
  focus,
  only,
}: {
  language: LanguageCode;
  paradigm: Paradigm;
  highlight?: string | string[] | null;
  focus?: boolean;
  only?: string | null;
}) {
  const [whole, setWhole] = useState(false);
  if (paradigm.indeclinable) return <p>{paradigm.kind === 'verb' ? 'This verb has no table.' : 'Indeclinable: the same form in every case and number.'}</p>;
  const sections = paradigmTable(language, paradigm);
  if (!sections.length) return null;
  const marked = new Set<string>(highlight == null ? [] : Array.isArray(highlight) ? highlight : [highlight]);
  if (only) marked.add(only);
  const focused = (focus || only) && marked.size > 0 && !whole ? sections.filter((s) => s.id !== 'nonfinite' && sectionCells(s).some((c) => marked.has(c.key))) : [];
  const nonfiniteMarked = sections.find((s) => s.id === 'nonfinite' && sectionCells(s).some((c) => marked.has(c.key)));
  const showFocused = focused.length > 0 || (!!nonfiniteMarked && (focus || only) && !whole);
  const more = showFocused && (
    <button
      type="button"
      className="mt-1.5 -ml-1 rounded px-1 text-sm font-medium text-muted-foreground underline decoration-dotted underline-offset-2 outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
      onClick={() => setWhole(true)}
    >
      Show the whole table
    </button>
  );

  if (paradigm.kind === 'verb') {
    if (showFocused) {
      return (
        <div className="space-y-3">
          {nonfiniteMarked && (
            <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-3">
              {nonfiniteMarked.rows.map((r) => (
                <div key={r.key}>
                  <dt className="text-sm text-muted-foreground">{cap(r.label)}</dt>
                  <dd>
                    <Forms cell={r.cells[0]} marked={marked} />
                  </dd>
                </div>
              ))}
            </dl>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            {focused.map((s) => (
              <TenseCard key={s.id} language={language} s={s} marked={marked} />
            ))}
          </div>
          {more}
        </div>
      );
    }
    return <FullConjugation language={language} sections={sections} marked={marked} />;
  }
  const shown = showFocused ? focused : sections;
  return (
    <div className="space-y-4 overflow-x-auto">
      {shown.map((s) => (
        <div key={s.id}>
          {sections.length > 1 && <h4 className="mb-1 font-semibold">{s.title}</h4>}
          {s.subtitle && <p className="mb-1 text-sm text-muted-foreground">{s.subtitle}</p>}
          <DeclensionSection language={language} s={s} marked={marked} />
        </div>
      ))}
      {more}
    </div>
  );
}

/**
 * Where an answer sits in a word's table and why. `cells`: the cells holding it (or the cell a question asked for),
 * narrowed by the sentence when it settles them, and only the sentence's exact cell when its payload carries one
 * (`exact`, annotated in data/grammar/); `inflected`: it is not the dictionary form; `note`: the explanation from
 * shared/grammar.ts ("“чого” is the genitive of “що”: it follows “для” (for), which always takes the genitive."),
 * shown with right answers too. A word without a table may still have a built-in one for explanations (що, что).
 */
export function answerInTable(
  language: LanguageCode,
  paradigm: Paradigm | null | undefined,
  lemma: string,
  display: string,
  form: string | null | undefined,
  asked?: string | null,
  sentence?: { before?: string | null; after?: string | null; exact?: ExactCell | null } | null,
) {
  const table = paradigmFor(language, lemma, paradigm);
  // The sentence's word only looks like a form of this one, or fills a cell the table lacks: no note, nothing marked.
  if (noNote(sentence?.exact)) return { cells: [] as string[], inflected: false, note: null };
  const explanation = form ? explainForm({ language, paradigm: table, lemma, form, cell: asked, before: sentence?.before, after: sentence?.after, exact: sentence?.exact }) : null;
  // The exact cell also marks the table where no line explains the form (a dictionary form filling several cells).
  const exact = form ? exactCellOf(language, table, lemma, form, sentence?.exact) : null;
  const cells = explanation?.cells ?? (exact ? [exact] : asked ? [asked] : cellsForForm(table, form));
  const norm = (x: string) => stripStress(x).toLowerCase().trim();
  const inflected = !!form && cells.length > 0 && norm(form) !== norm(lemma);
  const labels = [...new Set(cells.map((c) => cellLabel(language, c)))].slice(0, 2).join(' or ');
  return { cells, inflected, note: explanation?.text ?? (inflected ? `“${form}” is the ${labels} of ${stripStress(display)}.` : null) };
}

/** Why the answer has its form: one or two sentences in the feedback, outside the table toggle. */
export function GrammarNote({ text }: { text: string | null | undefined }) {
  return text ? <p className="text-[0.95rem]">{text}</p> : null;
}

/** "Conjugation" / "Declension" / "forms" (Spanish and Portuguese gender and number) button text for a word's table. */
export function tableButtonLabel(paradigm: Paradigm, open: boolean): string {
  const what = paradigm.kind === 'verb' ? 'conjugation' : isNominalRomance(paradigm) ? 'forms' : 'declension';
  return open ? `Hide the ${what} table` : `Show the ${what} table`;
}

/** A button that opens a word's table under it (feedback panels, new-word cards, the review before a forms quiz). */
export function TableToggle({
  language,
  paradigm,
  highlight,
  focus = true,
  initiallyOpen = false,
  emphasis = false,
  note,
}: {
  language: LanguageCode;
  paradigm: Paradigm | null | undefined;
  highlight?: string[] | null;
  focus?: boolean;
  initiallyOpen?: boolean;
  /** The answer was a form from this table that the learner missed: the button is shown as the main way to check it. */
  emphasis?: boolean;
  note?: string | null;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  if (!paradigm || paradigm.indeclinable) return null;
  return (
    <div>
      {note && <p className="text-[0.95rem]">{note}</p>}
      <Button type="button" variant={emphasis ? 'outline' : 'ghost'} size="sm" className={emphasis ? 'mt-1' : 'mt-1 -ml-2.5 text-muted-foreground'} aria-expanded={open} onClick={() => setOpen(!open)}>
        {tableButtonLabel(paradigm, open)}
      </Button>
      {open && (
        <div className="mt-2 rounded-xl border bg-card p-3 shadow-xs">
          <ParadigmTable language={language} paradigm={paradigm} highlight={highlight} focus={focus} />
        </div>
      )}
    </div>
  );
}
