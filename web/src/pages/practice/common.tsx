// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { LuEye, LuLightbulb, LuRotateCcw, LuX } from 'react-icons/lu';
import { checkAnswer, type AnswerSpec } from '../../../../shared/answer.ts';
import { LANGUAGES, type LanguageCode } from '../../../../shared/languages.ts';
import { canonical } from '../../../../shared/text.ts';
import type { VocabDetail } from '../../../../shared/types.ts';
import { get, uuid } from '../../lib/api.ts';
import { enqueue } from '../../lib/outbox.ts';
import { langSettings, useApp } from '../../lib/store.ts';
import { Link, navigate } from '../../lib/router.tsx';
import { useFocusMode } from '../../lib/focus.ts';
import { TypingHelper } from '../session/TypingHelper.tsx';
import { answerInTable, GrammarNote, TableToggle } from '../../components/ParadigmTable.tsx';
import type { Paradigm } from '../../../../shared/paradigms.ts';
import type { ExactCell } from '../../../../shared/grammar.ts';
import { ActionBar, AnswerLine, ContinueButton as SharedContinueButton, FeedbackPanel as SharedFeedbackPanel, ReviewBadge } from '../session/parts.tsx';
import { Progress as KitProgress } from '../../components/ui/basics.tsx';
import { Button } from '../../components/ui/button.tsx';
import { RadioGroup, RadioGroupItem, ToggleGroup, ToggleGroupItem } from '../../components/ui/controls.tsx';
import { Field, FieldContent, FieldDescription, FieldLabel, FieldLegend, FieldSet, FieldTitle } from '../../components/ui/field.tsx';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '../../components/ui/input-group.tsx';
import { cn } from '../../lib/utils.ts';

/** entries: a few words named in the address (?entries=1,2,3), such as Progress's words that need work. */
export type Scope = 'learning' | 'all' | 'entry' | 'entries';
export type Grade = 'correct' | 'close' | 'incorrect' | 'revealed';

export interface Outcome {
  grade: Grade;
  message: string;
  expected: string;
  response: string;
}

/** Grade at once on the device, then queue the attempt; the server grades again and records its own result. */
export function gradeAndSave(input: {
  language: LanguageCode;
  mode: 'forms' | 'cloze' | 'identify';
  entryId: number;
  cell?: string | null;
  sentenceId?: number | null;
  spec: AnswerSpec;
  response: string;
  revealed?: boolean;
  choice?: boolean;
  /** Active time since the previous answer on a Practice page (useActiveClock); 0 in a session's round. */
  activeMs?: number;
  /** Hints shown before answering (a hinted right answer counts as Hard for the word's memory). */
  hintsUsed?: number;
  /** What the answer did to the word's memory once the server has it (2.0.0): its review, or null for practice only. */
  onReview?: (review: PracticeReview | null) => void;
}): Outcome {
  const strictness = langSettings(input.language)?.spellingStrictness ?? 'normal';
  let o: Outcome;
  if (input.revealed) o = { grade: 'revealed', message: '', expected: input.spec.accepted[0], response: '' };
  else if (input.choice) {
    const ok = canonical(input.response, input.language) === canonical(input.spec.accepted[0], input.language);
    o = { grade: ok ? 'correct' : 'incorrect', message: '', expected: input.spec.accepted[0], response: input.response };
  } else {
    const c = checkAnswer(input.response, input.spec, strictness);
    o = { grade: c.grade, message: c.message, expected: c.expected, response: input.response };
  }
  const opId = uuid();
  void enqueue({
    method: 'POST',
    url: '/api/practice/attempts',
    id: opId,
    label: input.mode === 'forms' ? 'Forms practice answer' : input.mode === 'identify' ? 'Identify answer' : 'Sentence practice answer',
    body: {
      opId,
      mode: input.mode,
      entryId: input.entryId,
      cell: input.cell ?? null,
      sentenceId: input.sentenceId ?? null,
      response: input.revealed ? null : input.response,
      revealed: !!input.revealed,
      choice: !!input.choice,
      answeredAt: Date.now(),
      ...(input.activeMs ? { activeMs: input.activeMs } : {}),
      ...(input.hintsUsed ? { hintsUsed: input.hintsUsed } : {}),
    },
  }, input.onReview ? { onResult: (r: { review?: PracticeReview | null }) => input.onReview!(r?.review ?? null) } : undefined);
  return o;
}

/** The review a practice answer counted as (AttemptResult.review). */
export interface PracticeReview {
  skill: string;
  scheduledDays: number;
  dueAfter: number;
}

/**
 * The review state of the answer on screen: undefined while the server has not answered (offline: saved for later),
 * null when the answer was practice only, or the review it counted as.
 */
export function useReviewState() {
  const [review, setReview] = useState<PracticeReview | null | undefined>(undefined);
  return { review, setReview, reset: () => setReview(undefined) };
}

/** "Review done · back in 9 days" for a practice answer that counted as the word's review. */
export function PracticeReviewBadge({ review }: { review: PracticeReview | null | undefined }) {
  if (review === undefined) return navigator.onLine ? null : <ReviewBadge changes={[]} offline />;
  if (!review) return null;
  return <ReviewBadge changes={[{ scheduledDays: review.scheduledDays }]} />;
}

const paradigms = new Map<number, Promise<Paradigm | null>>();

/** A word's table, fetched once per word and kept for the page's lifetime (practice items don't carry it). */
export function useParadigm(entryId: number | null): Paradigm | null | undefined {
  const [p, setP] = useState<Paradigm | null | undefined>(undefined);
  useEffect(() => {
    if (!entryId) return;
    let alive = true;
    let pending = paradigms.get(entryId);
    if (!pending) {
      pending = get<VocabDetail>(`/api/vocab/${entryId}`)
        .then((d) => d.paradigm ?? null)
        .catch(() => {
          paradigms.delete(entryId);
          return null;
        });
      paradigms.set(entryId, pending);
    }
    void pending.then((x) => alive && setP(x));
    return () => {
      alive = false;
    };
  }, [entryId]);
  return p;
}

interface PracticeAnswer {
  language: LanguageCode;
  entryId: number;
  lemma: string;
  display: string;
  form: string;
  /** The sentence around a gap, which can settle the case or tense. */
  before?: string | null;
  after?: string | null;
  /** The cell the gap's form fills in this sentence, and why, when the item carries one (data/grammar/). */
  exact?: ExactCell | null;
}

/**
 * Why the answer has its form ("“чого” is the genitive of “що”: it follows “для” (for)…"), shown after every answer
 * whose expected form is not the dictionary form, right or wrong. Appears once the word's table has loaded.
 */
export function PracticeExplanation({ language, entryId, lemma, display, form, before, after, exact }: PracticeAnswer) {
  const paradigm = useParadigm(entryId);
  if (paradigm === undefined || paradigm?.indeclinable) return null;
  return <GrammarNote text={answerInTable(language, paradigm, lemma, display, form, null, { before, after, exact }).note} />;
}

/** The word's table under a practice answer, offered as the main way to check a missed inflected form. */
export function PracticeTable({ language, entryId, lemma, display, form, before, after, exact, missed }: PracticeAnswer & { missed: boolean }) {
  const paradigm = useParadigm(entryId);
  if (!paradigm || paradigm.indeclinable) return null;
  const a = answerInTable(language, paradigm, lemma, display, form, null, { before, after, exact });
  return <TableToggle key={`${entryId}:${form}`} language={language} paradigm={paradigm} highlight={a.cells} emphasis={missed && a.inflected} />;
}

/**
 * The header of a practice run (focus mode): X to leave, the progress bar and "4 / 20", like a study session's. The
 * shell hides its own bars while it is on screen.
 */
/**
 * The header of a practice run in focus mode: leave (X), the bar, and where the learner is ("3 / 20" by default, or
 * `caption`, such as a writing level's "A1 · 66/200"). `label` names the bar for screen readers.
 */
export function Progress({ done, total, onExit, caption, label, exitLabel = 'Leave this practice' }: { done: number; total: number; onExit?: () => void; caption?: ReactNode; label?: string; exitLabel?: string }) {
  useFocusMode(true);
  return (
    <div className="safe-top sticky top-0 z-30 -mx-4 mb-6 border-b bg-background/92 backdrop-blur-md sm:-mx-6">
      <div className="mx-auto flex max-w-3xl items-center gap-3 px-2 py-2 sm:px-4">
        <Button variant="ghost" size="icon" onClick={onExit ?? (() => navigate('/practice'))} aria-label={exitLabel}>
          <LuX className="size-[1.375rem]" aria-hidden="true" />
        </Button>
        <KitProgress value={(100 * done) / Math.max(total, 1)} className="h-2.5 flex-1" aria-label={label ?? `Question ${Math.min(done + 1, total)} of ${total}`} aria-valuenow={done} aria-valuemax={total} />
        <span className="min-w-12 text-right text-sm text-muted-foreground tabular-nums">{caption ?? `${Math.min(done + 1, total)} / ${total}`}</span>
      </div>
    </div>
  );
}

const GENERIC = new Set(['Correct.', 'Not quite.', '']);

/**
 * A practice answer's feedback: the shared bottom panel (session/parts.tsx) with the verdict, the grader's message,
 * what was written, the content (`children`: the answer, why, the table) and `actions` (Continue) at the bottom.
 */
export function FeedbackPanel({ outcome, children, actions, review, serif = true }: { outcome: Outcome; children?: ReactNode; actions: ReactNode; review?: PracticeReview | null; serif?: boolean }) {
  const g = outcome.grade;
  const message = !GENERIC.has(outcome.message) && g !== 'revealed' && !(outcome.expected && outcome.message.includes(outcome.expected)) ? outcome.message : null;
  return (
    <SharedFeedbackPanel verdict={g === 'revealed' ? 'revealed' : g} actions={actions}>
      {message && <p>{message}</p>}
      {g !== 'correct' && outcome.expected && <AnswerLine serif={serif}>{outcome.expected}</AnswerLine>}
      {g !== 'correct' && outcome.response && (
        <p className="text-sm text-muted-foreground">
          You wrote <span className={cn('line-through decoration-destructive/60', serif && 'word text-base')}>{outcome.response}</span>
        </p>
      )}
      {children}
      {review !== undefined && (
        <div>
          <PracticeReviewBadge review={review} />
        </div>
      )}
    </SharedFeedbackPanel>
  );
}

/** The typed answer with the language's typing helper; Check and "I don't know" in the bottom bar, the hint in the field. */
export function AnswerInput({
  language,
  value,
  setValue,
  onSubmit,
  onReveal,
  hint,
  locked,
  inputRef,
}: {
  language: LanguageCode;
  value: string;
  setValue: (v: string) => void;
  onSubmit: () => void;
  onReveal: () => void;
  hint?: { label: string; shown: boolean; show: () => void } | null;
  locked: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
}) {
  useEffect(() => {
    if (!locked) inputRef.current?.focus({ preventScroll: true });
  }, [locked]);
  return (
    <form
      className="mt-8"
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim()) onSubmit();
      }}
    >
      <label className="sr-only" htmlFor="practice-answer">
        Your answer
      </label>
      <InputGroup className="h-14 rounded-xl">
        <InputGroupInput
          id="practice-answer"
          ref={inputRef}
          className="word h-full text-[1.375rem]"
          lang={language}
          value={value}
          readOnly={locked}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="done"
          placeholder={`Type in ${LANGUAGES[language].name}`}
          onChange={(e) => setValue((e.target as HTMLInputElement).value)}
        />
        {hint && !hint.shown && !locked && (
          <InputGroupAddon align="inline-end">
            <InputGroupButton size="sm" variant="ghost" className="text-muted-foreground" onClick={hint.show}>
              <LuLightbulb aria-hidden="true" /> {hint.label}
            </InputGroupButton>
          </InputGroupAddon>
        )}
      </InputGroup>
      {!locked && (
        <>
          <TypingHelper language={language} inputRef={inputRef as RefObject<HTMLInputElement>} setValue={setValue} />
          <ActionBar>
            <Button variant="ghost" size="xl" className="px-3 text-muted-foreground" onClick={onReveal}>
              <LuEye aria-hidden="true" /> I don’t know
            </Button>
            <Button type="submit" size="xl" className="flex-1" disabled={!value.trim()} data-testid="check">
              Check
            </Button>
          </ActionBar>
        </>
      )}
    </form>
  );
}

/** `embedded`: the last question of a practice round inside a study session goes on with the session, not to results. */
export function ContinueButton({ onClick, last, embedded = false }: { onClick: () => void; last: boolean; embedded?: boolean }) {
  return <SharedContinueButton onClick={onClick} label={last && !embedded ? 'See results' : 'Continue'} />;
}

export interface Result {
  key: string;
  entryId: number;
  word: string;
  prompt: string;
  expected: string;
  grade: Grade;
}

export function Summary({ results, onAgain, onSetup, title }: { results: Result[]; onAgain: () => void; onSetup: () => void; title: string }) {
  const right = results.filter((r) => r.grade === 'correct').length;
  const missed = results.filter((r) => r.grade !== 'correct');
  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-[1.75rem] leading-tight font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-lg text-foreground/85">
          <span className="font-semibold tabular-nums">{right}</span> of <span className="tabular-nums">{results.length}</span> right.
          {missed.length > 0 ? ' The ones you missed come back first next time.' : ' Nothing to go over.'}
        </p>
        <KitProgress value={results.length ? (100 * right) / results.length : 0} className="mt-3 h-2" aria-hidden="true" />
      </div>
      {missed.length > 0 && (
        <section className="space-y-2">
          <h2 className="px-1 text-base font-semibold tracking-tight">Worth another look</h2>
          <ul className="divide-y rounded-xl border bg-card shadow-xs">
            {missed.map((r) => (
              <li key={r.key} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3">
                <span className="min-w-0">
                  <Link to={`/words/${r.entryId}`} className="word text-lg underline decoration-dotted underline-offset-4">
                    {r.word}
                  </Link>
                  <span className="ml-2 text-muted-foreground">{r.prompt}</span>
                </span>
                <span className="word text-lg">{r.expected}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="lg" onClick={onAgain}>
          <LuRotateCcw aria-hidden="true" /> Practice again
        </Button>
        <Button size="lg" variant="outline" onClick={onSetup}>
          Change what to practice
        </Button>
        <Button size="lg" variant="ghost" render={<Link to="/practice" />}>
          Back to Practice
        </Button>
      </div>
    </div>
  );
}

/** Per-language practice choices remembered on this device (best effort: storage may be unavailable). */
export function remembered<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`vb.practice.${key}`);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

export function remember(key: string, value: unknown) {
  try {
    localStorage.setItem(`vb.practice.${key}`, JSON.stringify(value));
  } catch {
    /* storage unavailable: the choice lasts for this visit */
  }
}

export function useEntryParam(): number | null {
  const q = new URLSearchParams(location.search);
  const n = Number(q.get('entry'));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** The words named in ?entries=1,2,3 (at most 50), or null when there are none. */
export function useEntriesParam(): number[] | null {
  const raw = new URLSearchParams(location.search).get('entries') ?? '';
  const ids = [...new Set(raw.split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 50);
  return ids.length ? ids : null;
}

/**
 * The language to practice and the word named in ?entry=, if any. A word opened from its page is practiced in its
 * own language, whichever language is active. `language` is null while that word loads.
 */
export function usePracticeTarget(): { language: LanguageCode | null; entry: VocabDetail | null } {
  const active = useApp((s) => s.boot?.settings.activeLanguage ?? 'es') as LanguageCode;
  const entryId = useEntryParam();
  const [entry, setEntry] = useState<VocabDetail | null | undefined>(entryId ? undefined : null);
  useEffect(() => {
    if (!entryId) {
      setEntry(null);
      return;
    }
    let live = true;
    setEntry(undefined);
    get<VocabDetail>(`/api/vocab/${entryId}`)
      .then((d) => live && setEntry(d))
      .catch(() => live && setEntry(null));
    return () => {
      live = false;
    };
  }, [entryId]);
  if (entry === undefined) return { language: null, entry: null };
  return { language: entry?.language ?? active, entry };
}

export function ScopePicker({
  scope,
  setScope,
  learningWords,
  words,
  entryLabel,
  entriesCount = 0,
}: {
  scope: Scope;
  setScope: (s: Scope) => void;
  learningWords: number;
  words: number;
  entryLabel: string | null;
  /** Words named in the address (useEntriesParam), offered first. */
  entriesCount?: number;
}) {
  const options: Array<{ value: Scope; label: string; sub: string }> = [];
  if (entriesCount) options.push({ value: 'entries', label: `These ${entriesCount.toLocaleString('en')} words`, sub: 'the ones you chose' });
  if (entryLabel) options.push({ value: 'entry', label: `Only ${entryLabel}`, sub: 'this word' });
  options.push({ value: 'learning', label: 'Words I’m learning', sub: `${learningWords.toLocaleString('en')} words, due ones first` });
  options.push({ value: 'all', label: 'All words', sub: `${words.toLocaleString('en')} words` });
  return (
    <FieldSet className="gap-2.5">
      <FieldLegend variant="label" className="mb-0">
        Which words
      </FieldLegend>
      <RadioGroup value={scope} onValueChange={(v) => setScope(v as Scope)} aria-label="Which words" className="gap-2 sm:grid-cols-3">
        {options.map((o) => (
          <FieldLabel key={o.value} htmlFor={`scope-${o.value}`}>
            <Field orientation="horizontal" data-state={scope === o.value ? 'checked' : 'unchecked'}>
              <FieldContent>
                <FieldTitle>{o.label}</FieldTitle>
                <FieldDescription>{o.sub}</FieldDescription>
              </FieldContent>
              <RadioGroupItem value={o.value} id={`scope-${o.value}`} />
            </Field>
          </FieldLabel>
        ))}
      </RadioGroup>
    </FieldSet>
  );
}

export function SizePicker({ size, setSize }: { size: number; setSize: (n: number) => void }) {
  return (
    <FieldSet className="gap-2.5">
      <FieldLegend variant="label" className="mb-0">
        How many
      </FieldLegend>
      <ToggleGroup type="single" variant="outline" spacing={2} value={String(size)} onValueChange={(v) => v && setSize(Number(v))} aria-label="How many questions">
        {[10, 20, 30].map((n) => (
          <ToggleGroupItem key={n} value={String(n)} className="min-w-16">
            {n}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </FieldSet>
  );
}

export function useStable<T>(v: T) {
  const [x] = useState(v);
  return x;
}
