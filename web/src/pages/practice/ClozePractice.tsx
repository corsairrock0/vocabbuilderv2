// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
import { useEffect, useRef, useState } from 'react';
import { LuExternalLink, LuPlay } from 'react-icons/lu';
import type { AnswerSpec } from '../../../../shared/answer.ts';
import type { ExactCell } from '../../../../shared/grammar.ts';
import type { LanguageCode } from '../../../../shared/languages.ts';
import { canonical, stripStress } from '../../../../shared/text.ts';
import type { VocabDetail } from '../../../../shared/types.ts';
import { ApiError, get, post } from '../../lib/api.ts';
import { navigate } from '../../lib/router.tsx';
import { useActiveClock } from '../../lib/activeTime.ts';
import { settings } from '../../lib/store.ts';
import { AiSentenceNote, ErrorNote, PageHeader, PageLoading } from '../../components/ui.tsx';
import { Word, useKeys } from '../session/Exercise.tsx';
import { OptionButton } from '../session/parts.tsx';
import { Alert, AlertDescription } from '../../components/ui/alert.tsx';
import { Button } from '../../components/ui/button.tsx';
import { ToggleGroup, ToggleGroupItem } from '../../components/ui/controls.tsx';
import { FieldLegend, FieldSet } from '../../components/ui/field.tsx';
import { AnswerInput, ContinueButton, FeedbackPanel, gradeAndSave, PracticeExplanation, PracticeTable, Progress, remember, remembered, ScopePicker, SizePicker, Summary, useEntriesParam, usePracticeTarget, useReviewState, type Outcome, type Result, type Scope } from './common.tsx';

export interface ClozeItem {
  id: string;
  entryId: number;
  sentenceId: number;
  before: string;
  after: string;
  beforeDisplay?: string;
  afterDisplay?: string;
  target: string;
  translation: string | null;
  lemma: string;
  display: string;
  gloss: string | null;
  pos: string;
  needed: string | null;
  /** The cell the target fills in this sentence and why (AI-annotated, data/grammar/): the feedback names that cell. */
  exact?: ExactCell;
  answer: AnswerSpec;
  choices: string[] | null;
  source: { name: string; url: string | null; ai?: boolean } | null;
}

interface Counts {
  cloze: { words: number; learningWords: number; sentences: number };
}

interface Choices {
  scope: Scope;
  size: number;
  choices: boolean;
}

/** Sentence practice: one word is taken out of an everyday sentence; type it in the form the sentence needs. */
export function ClozePractice() {
  const { language, entry } = usePracticeTarget();
  // ?entries=1,2,3: a few chosen words (Progress → Words that need work), in the active language.
  const entries = useEntriesParam();
  if (!language) return <PageLoading />;
  return <ClozeSetup key={`${language}.${entry?.entryId ?? ''}.${entries?.join(',') ?? ''}`} language={language} entry={entry} entries={entry ? null : entries} />;
}

function ClozeSetup({ language, entry, entries }: { language: LanguageCode; entry: VocabDetail | null; entries: number[] | null }) {
  const forEntry = !!entry?.examples.some((x) => x.target);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [choices, setChoices] = useState<Choices>(() => {
    const c = remembered(`cloze.${language}`, { scope: 'learning' as Scope, size: 20, choices: false });
    if (entries) return { ...c, scope: 'entries' };
    return forEntry ? { ...c, scope: 'entry' } : c.scope === 'entry' || c.scope === 'entries' ? { ...c, scope: 'learning' } : c;
  });
  const [phase, setPhase] = useState<'setup' | 'loading' | 'run' | 'done'>('setup');
  const [items, setItems] = useState<ClozeItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<Result[]>([]);

  useEffect(() => {
    get<Counts>(`/api/practice/summary/${language}`).then(setCounts).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);
  useEffect(() => {
    if (counts && counts.cloze.learningWords === 0 && choices.scope === 'learning') setChoices((c) => ({ ...c, scope: 'all' }));
  }, [counts]);

  if (error && !counts) return <ErrorNote error={error} />;
  if (!counts) return <PageLoading />;
  const save = (c: Choices) => {
    setChoices(c);
    remember(`cloze.${language}`, { ...c, scope: c.scope === 'entry' || c.scope === 'entries' ? 'learning' : c.scope });
  };

  const start = async () => {
    setPhase('loading');
    setError(null);
    try {
      const r = await post<{ items: ClozeItem[]; available: number }>('/api/practice/cloze/batch', {
        language,
        scope: choices.scope,
        entryId: choices.scope === 'entry' ? (entry?.entryId ?? null) : null,
        entryIds: choices.scope === 'entries' ? entries : null,
        choices: choices.choices,
        size: choices.size,
      });
      if (!r.items.length) {
        setPhase('setup');
        setError(
          choices.scope === 'learning'
            ? 'None of the words you are learning has an example sentence yet. Try all words.'
            : choices.scope === 'entries'
              ? 'None of these words has an example sentence yet.'
              : 'No sentences are available for these words.',
        );
        return;
      }
      setItems(r.items);
      setResults([]);
      setPhase('run');
    } catch (err) {
      setPhase('setup');
      setError(err instanceof ApiError && err.isNetwork ? 'Practice needs a connection to your server to load sentences.' : err instanceof Error ? err.message : String(err));
    }
  };

  if (phase === 'run') {
    return (
      <ClozeRunner
        language={language}
        items={items}
        onDone={(r) => {
          setResults(r);
          setPhase('done');
        }}
      />
    );
  }
  if (phase === 'done') return <Summary title="Sentence practice" results={results} onAgain={() => void start()} onSetup={() => setPhase('setup')} />;

  return (
    <div className="max-w-3xl pb-28 md:pb-0" data-lang={language}>
      <PageHeader title="Sentence practice" description="A word is missing from an everyday sentence: give it in the form the sentence needs." />
      <div className="space-y-7">
        <ScopePicker
          scope={choices.scope}
          setScope={(s) => save({ ...choices, scope: s })}
          learningWords={counts.cloze.learningWords}
          words={counts.cloze.words}
          entryLabel={forEntry ? entry!.display : null}
          entriesCount={entries?.length ?? 0}
        />
        <FieldSet className="gap-2.5">
          <FieldLegend variant="label" className="mb-0">
            Answer by
          </FieldLegend>
          <ToggleGroup type="single" variant="outline" spacing={2} value={choices.choices ? 'choose' : 'type'} onValueChange={(v) => v && save({ ...choices, choices: v === 'choose' })} aria-label="Answer by">
            <ToggleGroupItem value="type" className="flex-1 sm:flex-none">
              Typing the word
            </ToggleGroupItem>
            <ToggleGroupItem value="choose" className="flex-1 sm:flex-none">
              Choosing from four
            </ToggleGroupItem>
          </ToggleGroup>
        </FieldSet>
        <SizePicker size={choices.size} setSize={(n) => save({ ...choices, size: n })} />
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <p className="hint">
          Sentences come from Tatoeba (most with an English translation) and annotated text collections; words no collection covers have sentences written by an AI, marked as such. Every answer counts toward the word it tests.
        </p>
      </div>
      <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 border-t bg-background/92 px-4 py-3 backdrop-blur-md md:static md:mt-6 md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none">
        <div className="mx-auto max-w-3xl">
          <Button size="xl" className="w-full md:w-auto md:px-10" disabled={phase === 'loading'} onClick={() => void start()}>
            <LuPlay aria-hidden="true" /> {phase === 'loading' ? 'Loading' : 'Start'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Sentence({ item, filled }: { item: ClozeItem; filled?: string | null }) {
  const stress = settings().showStressMarks;
  const before = stress && item.beforeDisplay != null ? item.beforeDisplay : item.before;
  const after = stress && item.afterDisplay != null ? item.afterDisplay : item.after;
  return (
    <p className="word text-[1.5rem] leading-[1.55] sm:text-[1.75rem]">
      {before}
      {filled ? <span className="mark">{filled}</span> : <span className="blank" aria-label="missing word">&nbsp;</span>}
      {after}
    </p>
  );
}

/** One round of sentence gaps; `embedded` is the form used inside a Comprehensive study session, where `onAnswer` counts each answer as it is given. */
export function ClozeRunner({ language, items, onAnswer, onDone, embedded = false }: { language: LanguageCode; items: ClozeItem[]; onAnswer?: (grade: string) => void; onDone: (r: Result[]) => void; embedded?: boolean }) {
  const [i, setI] = useState(0);
  const [value, setValue] = useState('');
  const [hint, setHint] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const review = useReviewState();
  const results = useRef<Result[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  // Study time for the Practice page; inside a session the session counts it.
  const clock = useActiveClock(!embedded);
  const item = items[i];
  const sameAsLemma = canonical(item.target, language) === canonical(item.lemma, language);

  const finish = (o: Outcome) => {
    setOutcome(o);
    results.current.push({ key: item.id, entryId: item.entryId, word: item.display, prompt: `${item.before}…${item.after}`.slice(0, 70), expected: item.target, grade: o.grade });
    onAnswer?.(o.grade);
  };
  const answer = (revealed: boolean) => {
    if (outcome) return;
    review.reset();
    finish(gradeAndSave({ language, mode: 'cloze', entryId: item.entryId, sentenceId: item.sentenceId, spec: item.answer, response: value, revealed, activeMs: clock.take(), hintsUsed: hint ? 1 : 0, onReview: review.setReview }));
  };
  const choose = (opt: string) => {
    if (outcome) return;
    setPicked(opt);
    review.reset();
    finish(gradeAndSave({ language, mode: 'cloze', entryId: item.entryId, sentenceId: item.sentenceId, spec: item.answer, response: opt, choice: true, activeMs: clock.take(), onReview: review.setReview }));
  };
  const next = () => {
    if (i + 1 >= items.length) return onDone(results.current);
    setI(i + 1);
    setValue('');
    setHint(false);
    setPicked(null);
    setOutcome(null);
  };
  useKeys((e) => {
    if (outcome || !item.choices) return;
    const n = Number(e.key);
    if (n >= 1 && n <= item.choices.length) {
      choose(item.choices[n - 1]);
      return true;
    }
  }, [outcome, item]);

  return (
    <div className="max-w-2xl" data-lang={language}>
      {/* In a session the session's header counts the questions. */}
      {!embedded && <Progress done={i} total={items.length} />}
      <Sentence item={item} filled={outcome ? item.target : null} />
      {item.translation && <p className="mt-2 text-muted-foreground">{item.translation}</p>}
      {item.source?.ai && <AiSentenceNote className="mt-1" />}
      <p className="mt-3 text-[0.95rem]">
        <span className="text-muted-foreground">The missing word means </span>
        <span className="font-semibold">{item.gloss ?? '—'}</span>
        {(hint || outcome) && !sameAsLemma && (
          <span>
            <span className="text-muted-foreground">; dictionary form </span>
            <Word text={item.display} />
          </span>
        )}
        {(hint || outcome) && sameAsLemma && !outcome && <span className="text-muted-foreground">; it starts with “{stripStress(item.target)[0]}” ({[...stripStress(item.target)].length} letters)</span>}
        {(hint || outcome) && item.needed && <span className="text-muted-foreground"> — here: {item.needed}</span>}
      </p>
      {item.choices ? (
        <div className="mt-8 grid gap-2.5 sm:grid-cols-2" role="group" aria-label="Choose the missing word">
          {item.choices.map((c, k) => {
            const state = !outcome ? undefined : canonical(c, language) === canonical(item.target, language) ? 'correct' : c === picked ? 'wrong' : 'dim';
            return (
              <OptionButton key={c} index={k + 1} state={state} disabled={!!outcome} onClick={() => choose(c)} lang={language}>
                <span className="word text-[1.3rem]">{c}</span>
              </OptionButton>
            );
          })}
        </div>
      ) : (
        <AnswerInput
          language={language}
          value={value}
          setValue={setValue}
          onSubmit={() => answer(false)}
          onReveal={() => answer(true)}
          hint={{ label: 'Hint', shown: hint, show: () => setHint(true) }}
          locked={!!outcome}
          inputRef={inputRef}
        />
      )}
      {outcome && (
        <FeedbackPanel
          outcome={{ ...outcome, response: item.choices ? '' : outcome.response, expected: item.target }}
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
          <PracticeExplanation language={language} entryId={item.entryId} lemma={item.lemma} display={item.display} form={item.target} before={item.before} after={item.after} exact={item.exact} />
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Word text={item.display} className="text-xl" />
            <span className="text-muted-foreground">{item.gloss}</span>
          </p>
          <PracticeTable language={language} entryId={item.entryId} lemma={item.lemma} display={item.display} form={item.target} before={item.before} after={item.after} exact={item.exact} missed={outcome.grade !== 'correct'} />
          {item.source && (
            <p className="hint">
              Sentence:{' '}
              {item.source.url ? (
                <a href={item.source.url} target="_blank" rel="noopener noreferrer" className="underline decoration-dotted underline-offset-2">
                  {item.source.name}
                </a>
              ) : (
                item.source.name
              )}
            </p>
          )}
        </FeedbackPanel>
      )}
    </div>
  );
}
