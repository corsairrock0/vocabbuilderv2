// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
import { useEffect, useRef, useState } from 'react';
import { LuExternalLink, LuPlay } from 'react-icons/lu';
import type { AnswerSpec } from '../../../../shared/answer.ts';
import type { LanguageCode } from '../../../../shared/languages.ts';
import { explainForm } from '../../../../shared/grammar.ts';
import { drillGroups, paradigmTitle, type Paradigm } from '../../../../shared/paradigms.ts';
import type { VocabDetail } from '../../../../shared/types.ts';
import { ApiError, get, post } from '../../lib/api.ts';
import { navigate } from '../../lib/router.tsx';
import { useActiveClock } from '../../lib/activeTime.ts';
import { Empty, ErrorNote, PageHeader, PageLoading } from '../../components/ui.tsx';
import { GrammarNote, ParadigmTable } from '../../components/ParadigmTable.tsx';
import { Word } from '../session/Exercise.tsx';
import { ActionBar } from '../session/parts.tsx';
import { Alert, AlertDescription } from '../../components/ui/alert.tsx';
import { Badge } from '../../components/ui/badge.tsx';
import { Button } from '../../components/ui/button.tsx';
import { ToggleGroup, ToggleGroupItem } from '../../components/ui/controls.tsx';
import { FieldDescription, FieldLegend, FieldSet } from '../../components/ui/field.tsx';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../../components/ui/tabs.tsx';
import { useFocusMode } from '../../lib/focus.ts';
import { AnswerInput, ContinueButton, FeedbackPanel, gradeAndSave, Progress, remember, remembered, ScopePicker, SizePicker, Summary, usePracticeTarget, useReviewState, type Outcome, type Result, type Scope } from './common.tsx';

export interface FormsItem {
  id: string;
  entryId: number;
  lemma: string;
  display: string;
  gloss: string | null;
  pos: string;
  cell: string;
  label: string;
  tense: { label: string; native: string } | null;
  person: string | null;
  answer: AnswerSpec;
}

interface Counts {
  forms: { words: number; learningWords: number } | null;
}

interface Choices {
  scope: Scope;
  size: number;
  tenses: string[] | null;
  persons: string[] | null;
  /** Which groups the saved choices know: 2 since Slavic verbs had tables (1.8.4), 3 since gender and number (1.8.5). */
  rev?: number;
}
const CHOICES_REV = 3;

/** Forms practice: a table cell is named ("genitive plural", "preterite, tú") and the learner types the form. */
export function FormsPractice() {
  const { language, entry } = usePracticeTarget();
  if (!language) return <PageLoading />;
  return <FormsSetup key={`${language}.${entry?.entryId ?? ''}`} language={language} entry={entry} />;
}

function FormsSetup({ language, entry }: { language: LanguageCode; entry: VocabDetail | null }) {
  const forEntry = !!entry?.paradigm && !entry.paradigm.indeclinable;
  const [summary, setSummary] = useState<Counts | null>(null);
  const [choices, setChoices] = useState<Choices>(() => {
    const c = remembered(`forms.${language}`, { scope: 'learning' as Scope, size: 20, tenses: null, persons: null });
    return forEntry ? { ...c, scope: 'entry' } : c.scope === 'entry' ? { ...c, scope: 'learning' } : c;
  });
  const [phase, setPhase] = useState<'setup' | 'loading' | 'review' | 'run' | 'done'>('setup');
  const [items, setItems] = useState<FormsItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<Result[]>([]);
  const [tables, setTables] = useState<Map<number, Paradigm>>(new Map());

  useEffect(() => {
    get<Counts>(`/api/practice/summary/${language}`).then(setSummary).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);
  useEffect(() => {
    // With nothing being learned yet, start from all words.
    if (summary?.forms && summary.forms.learningWords === 0 && choices.scope === 'learning') setChoices((c) => ({ ...c, scope: 'all' }));
  }, [summary]);

  if (error) return <ErrorNote error={error} />;
  if (!summary) return <PageLoading />;
  if (!summary.forms) {
    return (
      <div className="max-w-2xl">
        <PageHeader title="Forms" />
        <Empty title="No tables for this language">Vietnamese words do not change form, so there are no declension or conjugation tables. Sentence practice works for every language.</Empty>
      </div>
    );
  }
  const title = paradigmTitle(language);
  const groups = drillGroups(language);
  const chosen = (list: typeof groups.tenses, ids: string[] | null) => (ids ? list.filter((g) => ids.includes(g.id)) : list.filter((g) => g.defaultOn)).map((g) => g.id);
  let tenses = chosen(groups.tenses, choices.tenses);
  // Choices saved before a group existed start it from its default: Russian, Ukrainian and Polish verb tenses
  // (1.8.4; such choices name no "v." id) and Spanish and Portuguese gender and number (1.8.5).
  const rev = choices.rev ?? (choices.tenses?.some((id) => id.startsWith('v.')) ? 2 : 1);
  const slavic = language === 'ru' || language === 'uk' || language === 'pl';
  if (choices.tenses && rev < 2 && slavic) tenses = [...tenses, ...groups.tenses.filter((g) => g.kind === 'tense' && g.defaultOn && !tenses.includes(g.id)).map((g) => g.id)];
  if (choices.tenses && rev < 3 && !slavic) tenses = [...tenses, ...groups.tenses.filter((g) => g.id === 'gn' && !tenses.includes(g.id)).map((g) => g.id)];
  const persons = chosen(groups.persons, choices.persons);
  const toggle = (which: 'tenses' | 'persons', id: string) => {
    const cur = which === 'tenses' ? tenses : persons;
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    const c = { ...choices, tenses, persons, [which]: next, rev: CHOICES_REV };
    setChoices(c);
    remember(`forms.${language}`, { ...c, scope: c.scope === 'entry' ? 'learning' : c.scope });
  };

  const start = async () => {
    setPhase('loading');
    setError(null);
    try {
      const r = await post<{ items: FormsItem[]; available: number; tables?: Record<string, Paradigm> }>('/api/practice/forms/batch', {
        language,
        scope: choices.scope,
        entryId: choices.scope === 'entry' ? (entry?.entryId ?? null) : null,
        tenses,
        persons,
        size: choices.size,
      });
      if (!r.items.length) {
        setPhase('setup');
        setError(choices.scope === 'learning' ? 'None of the words you are learning has forms to practice with these choices. Try all words, or turn on more groups.' : 'Nothing matches these choices. Turn on more groups.');
        return;
      }
      setItems(r.items);
      setResults([]);
      setTables(new Map(Object.entries(r.tables ?? {}).map(([k, v]) => [Number(k), v])));
      setPhase('review');
    } catch (err) {
      setPhase('setup');
      setError(err instanceof ApiError && err.isNetwork ? 'Practice needs a connection to your server to load questions.' : err instanceof Error ? err.message : String(err));
    }
  };

  if (phase === 'review') return <FormsReview language={language} items={items} tables={tables} onStart={() => setPhase('run')} onBack={() => setPhase('setup')} />;
  if (phase === 'run') {
    return (
      <FormsRunner
        language={language}
        items={items}
        tables={tables}
        setTables={setTables}
        onDone={(r) => {
          setResults(r);
          setPhase('done');
        }}
      />
    );
  }
  if (phase === 'done') return <Summary title={`${title} practice`} results={results} onAgain={() => void start()} onSetup={() => setPhase('setup')} />;

  const verbs = language === 'es' || language === 'pt';
  // Cases and verb tenses side by side (Russian, Ukrainian, Polish), or verb tenses and gender and number (Spanish,
  // Portuguese); both are sent as `tenses`.
  const toggles = (
    verbs
      ? [
          { legend: 'Verb tenses', list: groups.tenses.filter((g) => g.kind === 'tense') },
          { legend: 'Nouns, adjectives and other words', list: groups.tenses.filter((g) => g.kind !== 'tense') },
        ]
      : [
          { legend: 'Cases', list: groups.tenses.filter((g) => g.kind !== 'tense') },
          { legend: 'Verb tenses', list: groups.tenses.filter((g) => g.kind === 'tense') },
        ]
  ).filter((t) => t.list.length);
  return (
    <div className="max-w-3xl pb-28 md:pb-0" data-lang={language}>
      <PageHeader title={`${title} practice`} description={verbs ? 'A tense and a person, or a gender and number, are named: type the form.' : 'A case and a number, or a verb tense and a person, are named: type the form.'} />
      <div className="space-y-7">
        <ScopePicker
          scope={choices.scope}
          setScope={(s) => {
            const c = { ...choices, scope: s };
            setChoices(c);
            if (s !== 'entry') remember(`forms.${language}`, c);
          }}
          learningWords={summary.forms.learningWords}
          words={summary.forms.words}
          entryLabel={forEntry ? entry!.display : null}
        />
        {toggles.map((t) => (
          <FieldSet key={t.legend} className="gap-2.5">
            <FieldLegend variant="label" className="mb-0">
              {t.legend}
            </FieldLegend>
            <ToggleGroup type="multiple" variant="outline" spacing={2} value={tenses.filter((id) => t.list.some((g) => g.id === id))} onValueChange={(v) => {
              const changed = t.list.find((g) => v.includes(g.id) !== tenses.includes(g.id));
              if (changed) toggle('tenses', changed.id);
            }} aria-label={t.legend}>
              {t.list.map((g) => (
                <ToggleGroupItem key={g.id} value={g.id} title={g.hint} className="rounded-full px-3.5">
                  {g.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </FieldSet>
        ))}
        <FieldSet className="gap-2.5">
          <FieldLegend variant="label" className="mb-0">
            {verbs ? 'Persons' : 'Number'}
          </FieldLegend>
          <ToggleGroup type="multiple" variant="outline" spacing={2} value={persons} onValueChange={(v) => {
            const changed = groups.persons.find((g) => v.includes(g.id) !== persons.includes(g.id));
            if (changed) toggle('persons', changed.id);
          }} aria-label={verbs ? 'Persons' : 'Number'}>
            {groups.persons.map((g) => (
              <ToggleGroupItem key={g.id} value={g.id} title={g.hint} className="rounded-full px-3.5">
                <span className={verbs ? 'word text-[0.95rem]' : ''}>{g.label}</span>
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <FieldDescription>
            {verbs
              ? language === 'es'
                ? 'Vos is used in parts of Colombia (Antioquia, the Valle del Cauca); vosotros only in Spain.'
                : 'Brazil mostly uses você for “you”: tu is regional and vós is not used.'
              : 'For verbs, singular and plural pick the persons too (I, you, he or she; we, you, they).'}
          </FieldDescription>
        </FieldSet>
        <SizePicker
          size={choices.size}
          setSize={(n) => {
            const c = { ...choices, size: n };
            setChoices(c);
            remember(`forms.${language}`, { ...c, scope: c.scope === 'entry' ? 'learning' : c.scope });
          }}
        />
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <p className="hint">Every answer counts toward the word it tests: a word whose memory is due gets its review here.</p>
      </div>
      <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 border-t bg-background/92 px-4 py-3 backdrop-blur-md md:static md:mt-6 md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none">
        <div className="mx-auto max-w-3xl">
          <Button size="xl" className="w-full md:w-auto md:px-10" disabled={phase === 'loading' || !tenses.length || !persons.length} onClick={() => void start()}>
            <LuPlay aria-hidden="true" /> {phase === 'loading' ? 'Loading' : 'Start'}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Before a forms quiz: the words being tested, each with its whole table (the forms that will be asked are marked),
 * so the learner can look them over first.
 */
export function FormsReview({ language, items, tables, onStart, onBack, embedded = false }: { language: LanguageCode; items: FormsItem[]; tables: Map<number, Paradigm>; onStart: () => void; onBack?: () => void; embedded?: boolean }) {
  useFocusMode(!embedded);
  const words: Array<{ item: FormsItem; cells: string[]; labels: string[] }> = [];
  for (const it of items) {
    const w = words.find((x) => x.item.entryId === it.entryId);
    if (w) {
      w.cells.push(it.cell);
      w.labels.push(it.label);
    } else words.push({ item: it, cells: [it.cell], labels: [it.label] });
  }
  return (
    <div className="max-w-3xl pt-6" data-lang={language}>
      <h2 className="text-[1.375rem] leading-tight font-semibold tracking-tight">Look over the {words.length === 1 ? 'table' : 'tables'} first</h2>
      <p className="mt-1 mb-5 text-muted-foreground">
        {words.length === 1 ? 'The word in this quiz.' : `The ${words.length} words in this quiz.`} Only the part you will be asked is shown; the forms are marked.
      </p>
      <Accordion type="multiple" defaultValue={[String(words[0]?.item.entryId)]} className="rounded-xl border bg-card px-4 shadow-xs">
        {words.map((w) => {
          const table = tables.get(w.item.entryId);
          return (
            <AccordionItem key={w.item.entryId} value={String(w.item.entryId)}>
              <AccordionTrigger className="py-3.5 hover:no-underline">
                <span className="min-w-0">
                  <span className="word text-[1.375rem]">{w.item.display}</span>
                  {w.item.gloss && <span className="ml-2.5 text-sm font-normal text-muted-foreground">{w.item.gloss}</span>}
                  <span className="mt-1.5 flex flex-wrap gap-1">
                    {[...new Set(w.labels)].map((l) => (
                      <Badge key={l} variant="soft" className="font-normal">
                        {l}
                      </Badge>
                    ))}
                  </span>
                </span>
              </AccordionTrigger>
              <AccordionContent>{table ? <ParadigmTable language={language} paradigm={table} highlight={w.cells} focus /> : <p className="hint">The table could not be loaded.</p>}</AccordionContent>
            </AccordionItem>
          );
        })}
      </Accordion>
      <ActionBar>
        {onBack && (
          <Button variant="ghost" size="xl" className="px-3 text-muted-foreground" onClick={onBack}>
            Change
          </Button>
        )}
        <Button size="xl" className="flex-1" onClick={onStart}>
          <LuPlay aria-hidden="true" /> Start the quiz
        </Button>
      </ActionBar>
    </div>
  );
}

/** One forms quiz; `embedded` is the form used inside a Comprehensive study session, where `onAnswer` counts each answer as it is given. */
export function FormsRunner({
  language,
  items,
  tables,
  setTables,
  onAnswer,
  onDone,
  embedded = false,
}: {
  language: LanguageCode;
  items: FormsItem[];
  tables: Map<number, Paradigm>;
  setTables: (m: Map<number, Paradigm>) => void;
  onAnswer?: (grade: string) => void;
  onDone: (r: Result[]) => void;
  embedded?: boolean;
}) {
  const [i, setI] = useState(0);
  const [value, setValue] = useState('');
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const review = useReviewState();
  const results = useRef<Result[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  // Study time for the Practice page; inside a session the session counts it.
  const clock = useActiveClock(!embedded);
  const item = items[i];
  const table = tables.get(item.entryId);

  // The word's table is shown with the answer: fetch it once per word, in the background.
  useEffect(() => {
    if (tables.has(item.entryId)) return;
    get<VocabDetail>(`/api/vocab/${item.entryId}`)
      .then((d) => {
        if (d.paradigm) setTables(new Map(tables).set(item.entryId, d.paradigm));
      })
      .catch(() => undefined);
  }, [item.entryId]);

  const answer = (revealed: boolean) => {
    if (outcome) return;
    review.reset();
    const o = gradeAndSave({ language, mode: 'forms', entryId: item.entryId, cell: item.cell, spec: item.answer, response: value, revealed, activeMs: clock.take(), onReview: review.setReview });
    setOutcome(o);
    results.current.push({ key: item.id, entryId: item.entryId, word: item.display, prompt: item.label, expected: item.answer.accepted[0], grade: o.grade });
    onAnswer?.(o.grade);
  };
  const next = () => {
    if (i + 1 >= items.length) return onDone(results.current);
    setI(i + 1);
    setValue('');
    setOutcome(null);
  };

  return (
    <div className="max-w-2xl" data-lang={language}>
      {/* In a session the session's header counts the questions. */}
      {!embedded && <Progress done={i} total={items.length} />}
      <p className="text-muted-foreground">Give this form of</p>
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h1 className="text-[clamp(2.25rem,8vw,3.25rem)] leading-tight" lang={language}>
          <Word text={item.display} />
        </h1>
        {item.gloss && <span className="text-muted-foreground">{item.gloss}</span>}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {item.tense ? (
          <>
            <Badge variant="soft" className="h-8 px-3 text-[0.9375rem] font-semibold">
              {item.tense.label}
            </Badge>
            {item.person && (
              <Badge variant="outline" className="h-8 px-3 text-[0.9375rem]">
                <span className="word">{item.person}</span>
              </Badge>
            )}
            <span className="text-sm text-muted-foreground" lang={language}>
              {item.tense.native}
            </span>
          </>
        ) : (
          <Badge variant="soft" className="h-8 px-3 text-[0.9375rem] font-semibold">
            {item.label}
          </Badge>
        )}
      </div>
      <AnswerInput language={language} value={value} setValue={setValue} onSubmit={() => answer(false)} onReveal={() => answer(true)} locked={!!outcome} inputRef={inputRef} />
      {outcome && (
        <FeedbackPanel
          outcome={{ ...outcome, expected: item.answer.accepted.filter((a) => !/^(no|não) /.test(a) || item.answer.accepted.length === 1).join(', ') }}
          review={review.review}
          actions={
            <>
              {!embedded && (
                <Button variant="outline" size="xl" className="bg-card/80 px-4" onClick={() => navigate(`/words/${item.entryId}`)} aria-label="Open the word">
                  <LuExternalLink aria-hidden="true" />
                </Button>
              )}
              <ContinueButton onClick={next} last={i + 1 >= items.length} embedded={embedded} />
            </>
          }
        >
          {/* The drill named the cell: say what it is used for. */}
          <GrammarNote text={explainForm({ language, paradigm: table ?? null, lemma: item.lemma, form: item.answer.accepted[0], cell: item.cell })?.text} />
          {table && (
            <div className="rounded-xl bg-card/80 p-3">
              <ParadigmTable key={item.id} language={language} paradigm={table} highlight={item.cell} focus />
            </div>
          )}
        </FeedbackPanel>
      )}
    </div>
  );
}
