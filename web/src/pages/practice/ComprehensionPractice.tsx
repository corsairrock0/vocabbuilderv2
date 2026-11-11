// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Reading comprehension (server/learning/comprehension.ts): an AI-written text at the learner's reading level, then its
// questions one after another. Two kinds share the level: everyday texts (about 75 words, three questions, easiest
// first) and longer passages (about 150 words, four questions). All questions but one right is a pass. The level moves
// up once every text of it, of both kinds, has been read, pass or fail. A text once read never comes back. Reading is
// not a word's review: nothing here changes when words are due.
//
// 2.0.0 layout: the text fills the screen in serif; its questions open in a panel docked at the bottom, one at a time,
// so the text stays in view (and scrolls) while the learner answers. Each answer shows why at once; answered
// questions collect under the text, and the result rises from the bottom like every other feedback.
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { LuBookOpen, LuCheck, LuChevronDown, LuEye, LuEyeOff, LuListChecks, LuPlay, LuX } from 'react-icons/lu';
import {
  COMPREHENSION_KINDS,
  isPass,
  levelAbove,
  levelDone,
  levelRank,
  passMark,
  predictedLevel,
  questionsInLanguage,
  READING_LEVELS,
  readingLevel,
  type ComprehensionKind,
  type ComprehensionNext,
  type ComprehensionPassage,
  type ComprehensionQuestion,
  type ComprehensionResult,
  type ComprehensionSummary,
  type Genre,
  type LevelProgress,
  type ReadingLevel,
  type ShortFormat,
} from '../../../../shared/comprehension.ts';
import { LANGUAGES, type LanguageCode } from '../../../../shared/languages.ts';
import { listJoin } from '../../../../shared/stats.ts';
import { ApiError, get, post, uuid } from '../../lib/api.ts';
import { count } from '../../lib/format.ts';
import { enqueue } from '../../lib/outbox.ts';
import { Link } from '../../lib/router.tsx';
import { useActiveClock } from '../../lib/activeTime.ts';
import { langSettings, setLocalLanguageSettings, updateLanguageSettings, useApp } from '../../lib/store.ts';
import { cn } from '../../lib/utils.ts';
import { AiPassageNote, Empty, ErrorNote, PageHeader, PageLoading, Segmented } from '../../components/ui.tsx';
import { Alert, AlertDescription } from '../../components/ui/alert.tsx';
import { Badge } from '../../components/ui/badge.tsx';
import { Progress as Meter } from '../../components/ui/basics.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Card, CardContent } from '../../components/ui/card.tsx';
import { RadioGroup, RadioGroupItem } from '../../components/ui/controls.tsx';
import { Field, FieldContent, FieldDescription, FieldLabel, FieldLegend, FieldSet, FieldTitle } from '../../components/ui/field.tsx';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../../components/ui/tabs.tsx';
import { useKeys } from '../session/Exercise.tsx';
import { ActionBar, BottomPanel, ContinueButton, FeedbackPanel, OptionButton } from '../session/parts.tsx';
import { Progress as PracticeHeader, remember, remembered } from './common.tsx';

export interface QuestionGrade {
  grade: 'correct' | 'incorrect';
}

const GENRES: Record<Genre, string> = { literature: 'Literature', history: 'History', humanities: 'Humanities', science: 'Science', everyday: 'Everyday life' };
const FORMATS: Record<ShortFormat, string> = {
  story: 'Story',
  dialogue: 'Dialogue',
  message: 'Chat message',
  email: 'Email',
  notice: 'Notice',
  diary: 'Diary',
  instructions: 'Instructions',
  advert: 'Advert',
  description: 'Description',
};
const KINDS: Record<ComprehensionKind, { label: string; noun: string; one: string; note: string }> = {
  short: { label: 'Everyday texts', noun: 'everyday texts', one: 'text', note: 'About 75 words of everyday life: dialogues, messages, notices, short stories. Three questions; easiest first.' },
  long: { label: 'Longer passages', noun: 'longer passages', one: 'passage', note: 'About 150 words on literature, history, the humanities and science. Four questions.' },
};

/** What each level reads like (the writing rules are in data/reading/README.md). */
const LEVEL_NOTES: Record<ReadingLevel, string> = {
  A1: 'Beginner: short sentences, mostly in the present.',
  A2: 'Elementary: everyday situations and short stories, with the past and the future.',
  B1: 'Intermediate: stories with a turn, how things work, history told simply.',
  B2: 'Upper intermediate: arguments, causes and effects, character and motive.',
  C1: 'Advanced: essays, literary fiction, and history and science in depth.',
};

const problem = (e: unknown) => (e instanceof ApiError && e.isNetwork ? 'Reading comprehension needs a connection to your server.' : e instanceof Error ? e.message : String(e));
const isKind = (k: unknown): k is ComprehensionKind => k === 'short' || k === 'long';

/**
 * How far through a level the learner is and what moves them on: "12 of 40 A2 texts read. Read them all to move up to
 * B1." Texts of both kinds count; a level without texts is never done.
 */
export function levelProgressText(p: LevelProgress): string {
  if (p.total === 0) return `There are no ${p.level} texts yet, so your level stays ${p.level} until they come.`;
  const read = `${count(p.read)} of ${count(p.total)} ${p.level} texts read`;
  if (p.level === 'C1') return `${read}. C1 is the top level.`;
  return levelDone(p) ? `${read}: the next text you read moves you up to ${levelAbove(p.level)}.` : `${read}. Read them all to move up to ${levelAbove(p.level)}.`;
}

/** The level line under a text's result: moved up (through which levels), or how far through the level they are. */
export function levelResultText(r: Pick<ComprehensionResult, 'levelBefore' | 'levelAfter' | 'levelUp' | 'progress'>): string {
  if (r.levelUp) {
    const done = READING_LEVELS.slice(levelRank(r.levelBefore), levelRank(r.levelAfter));
    return `You have read every ${listJoin(done)} text: your reading level is now ${r.levelAfter}.`;
  }
  return r.progress && r.progress.level === r.levelAfter ? levelProgressText(r.progress) : `Your reading level stays ${r.levelAfter}.`;
}

/** Paragraphs are separated by a blank line; a single line break inside one (a dialogue, a list) stays a line break. */
export const paragraphs = (text: string) =>
  text
    .split(/\n\s*\n/)
    .map((t) => t.trim())
    .filter(Boolean);

/** 0…n-1 in a random order. */
function shuffled(n: number): number[] {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function ComprehensionPractice() {
  const language = useApp((s) => s.boot?.settings.activeLanguage ?? 'es') as LanguageCode;
  return <ComprehensionSetup key={language} language={language} />;
}

function ComprehensionSetup({ language }: { language: LanguageCode }) {
  const boot = useApp((s) => s.boot);
  const [summary, setSummary] = useState<ComprehensionSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<'setup' | 'run'>('setup');
  // The kind chosen last on this device; the first time, everyday texts when there are any.
  const [kind, setKind] = useState<ComprehensionKind | null>(() => {
    const k = remembered<{ kind: unknown }>(`comprehension.${language}`, { kind: null }).kind;
    return isKind(k) ? k : null;
  });
  const load = () =>
    get<ComprehensionSummary>(`/api/practice/comprehension/summary/${language}`)
      .then((s) => {
        setSummary(s);
        setError(null);
        setKind((k) => k ?? (s.kinds.short.total > 0 ? 'short' : 'long'));
      })
      .catch((e) => setError(problem(e)));
  useEffect(() => {
    void load();
  }, []);
  const choose = (k: ComprehensionKind) => {
    setKind(k);
    remember(`comprehension.${language}`, { kind: k });
  };

  if (!boot) return <PageLoading />;
  const level = readingLevel(boot.languageSettings[language]?.readingLevel);
  if (phase === 'run' && kind) {
    return (
      <ComprehensionRunner
        language={language}
        kind={kind}
        level={level}
        onDone={() => {
          setPhase('setup');
          void load();
        }}
      />
    );
  }
  const lang = LANGUAGES[language];
  const ofKind = summary && kind ? summary.kinds[kind] : null;
  const here = ofKind?.levels.find((x) => x.level === level);
  // The level shown (the learner's, or the one just chosen), both kinds together: all of its texts move it up.
  const atLevel: LevelProgress | null = summary
    ? COMPREHENSION_KINDS.reduce<LevelProgress>(
        (sum, k) => {
          const c = summary.kinds[k].levels.find((x) => x.level === level);
          return { ...sum, total: sum.total + (c?.total ?? 0), read: sum.read + (c?.read ?? 0) };
        },
        { level, total: 0, read: 0 },
      )
    : null;
  const ready = !!summary && !!kind && !!ofKind && summary.total > 0;
  const canStart = ready && ofKind!.total > 0 && ofKind!.available > 0;
  return (
    <div className={cn('max-w-2xl', canStart && 'pb-28 md:pb-0')} data-lang={language}>
      <PageHeader
        title="Reading comprehension"
        back={
          <Link to="/practice" className="text-sm text-muted-foreground underline-offset-2 hover:underline">
            Practice
          </Link>
        }
        description={`Read a short text in ${lang.name}, then answer questions on what it says.`}
      />
      {!summary || !kind || !ofKind ? (
        error ? (
          <ErrorNote error={error} onRetry={() => void load()} />
        ) : (
          <PageLoading />
        )
      ) : summary.total === 0 ? (
        <Empty icon={<LuBookOpen />} title={`No ${lang.name} texts yet`}>
          They come with updates of the app.
        </Empty>
      ) : (
        <Card>
          <CardContent className="space-y-7">
            <FieldSet className="gap-3">
              <FieldLegend variant="label" className="mb-0">
                What to read
              </FieldLegend>
              <RadioGroup value={kind} onValueChange={(v) => isKind(v) && choose(v)} aria-label="What to read" className="gap-2 sm:grid-cols-2">
                {(['short', 'long'] as const).map((k) => {
                  const c = summary.kinds[k];
                  return (
                    <FieldLabel key={k} htmlFor={`kind-${k}`}>
                      <Field orientation="horizontal" data-state={kind === k ? 'checked' : 'unchecked'}>
                        <FieldContent>
                          <FieldTitle>{KINDS[k].label}</FieldTitle>
                          <FieldDescription>{KINDS[k].note}</FieldDescription>
                          <FieldDescription className="tabular-nums">{c.total ? `${count(c.read)} of ${count(c.total)} read` : 'None yet'}</FieldDescription>
                        </FieldContent>
                        <RadioGroupItem value={k} id={`kind-${k}`} />
                      </Field>
                    </FieldLabel>
                  );
                })}
              </RadioGroup>
            </FieldSet>
            <FieldSet className="gap-3">
              <FieldLegend variant="label" className="mb-0">
                Your level
              </FieldLegend>
              <Segmented label="Reading level" value={level} onChange={(l: ReadingLevel) => void updateLanguageSettings(language, { readingLevel: l })} options={READING_LEVELS.map((l) => ({ value: l, label: l }))} />
              <FieldDescription>
                {LEVEL_NOTES[level]} Questions are in {questionsInLanguage(level) ? lang.name : 'English'}.
              </FieldDescription>
            </FieldSet>
            {atLevel && (
              <LevelMeter
                p={atLevel}
                kindLine={
                  atLevel.total > 0
                    ? here?.total
                      ? `${level} ${KINDS[kind].noun}: ${count(here.read)} of ${count(here.total)} read, ${count(here.passed)} passed.`
                      : `No ${level} ${KINDS[kind].noun} yet, so you get the nearest level.`
                    : undefined
                }
              />
            )}
            {ofKind.total === 0 ? (
              <Alert variant="info">
                <AlertDescription>
                  There are no {KINDS[kind].noun} in {lang.name} yet. Choose {kind === 'short' ? 'longer passages' : 'everyday texts'} instead.
                </AlertDescription>
              </Alert>
            ) : (
              ofKind.available === 0 && (
                <Alert variant="info">
                  <AlertDescription>
                    You have read all {count(ofKind.total)} {KINDS[kind].noun} in {lang.name}. New ones come with updates of the app.
                  </AlertDescription>
                </Alert>
              )
            )}
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      )}
      <p className="hint mt-6 max-w-[62ch]">
        The texts and their questions were written by an AI (Claude) and checked by a second AI, not by a native speaker. Reading doesn’t change when words are due.
      </p>
      {canStart && (
        <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 border-t bg-background/92 px-4 py-3 backdrop-blur-md md:static md:mt-6 md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none">
          <div className="mx-auto max-w-3xl">
            <Button size="xl" className="w-full md:w-auto md:px-10" onClick={() => setPhase('run')}>
              <LuPlay aria-hidden="true" /> Start reading
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** The level as a bar ("A1 · 12 of 40 texts read") and the one thing that moves the learner on. */
function LevelMeter({ p, kindLine }: { p: LevelProgress; kindLine?: string }) {
  const up = p.level === 'C1' ? null : levelAbove(p.level);
  const sentence =
    p.total === 0
      ? `No ${p.level} texts yet, so you get the nearest level. Your level stays ${p.level} until they come.`
      : !up
        ? 'C1 is the top level.'
        : levelDone(p)
          ? `The next text you read moves you up to ${up}.`
          : `Read every ${p.level} text, of both kinds, to move up to ${up}.`;
  return (
    <div className="space-y-2 rounded-xl bg-muted/60 p-4">
      {p.total > 0 && (
        <>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="font-medium tabular-nums">
              {p.level} · {count(p.read)} of {count(p.total)} texts read
            </span>
            {up && <span className="text-muted-foreground">Next: {up}</span>}
          </div>
          <Meter value={(100 * p.read) / p.total} aria-label={`Reading level ${p.level}: ${p.read} of ${p.total} texts read`} />
        </>
      )}
      <p className="text-sm text-muted-foreground" data-testid="level-progress">
        {sentence}
        {kindLine ? ` ${kindLine}` : ''}
      </p>
    </div>
  );
}

/**
 * Texts of one kind one after another until the learner is done. `level` is the level to start at (default: the
 * learner's). `embedded` is the form used as a round of a Comprehensive study session: one text, then back to the
 * session; `initial` is a text that round already fetched. `onAnswer` gets the grade of each question once the
 * text is answered in full (when it is stored), `onDone` a grade per question answered.
 */
export function ComprehensionRunner({
  language,
  kind = 'long',
  level,
  embedded = false,
  initial,
  onAnswer,
  onDone,
}: {
  language: LanguageCode;
  kind?: ComprehensionKind;
  level?: ReadingLevel;
  embedded?: boolean;
  initial?: ComprehensionNext;
  onAnswer?: (grade: QuestionGrade['grade']) => void;
  onDone: (results: QuestionGrade[]) => void;
}) {
  const [next, setNext] = useState<ComprehensionNext | null>(initial ?? null);
  const [error, setError] = useState<string | null>(null);
  const finished = useRef<string[]>([]);
  const results = useRef<QuestionGrade[]>([]);
  const asked = useRef<ReadingLevel | undefined>(level);
  const started = useRef(false);
  // Study time for the Practice page (reading and answering each text); inside a session the session counts it.
  const clock = useActiveClock(!embedded);
  const load = async (lvl: ReadingLevel | undefined) => {
    asked.current = lvl;
    setNext(null);
    setError(null);
    try {
      // Texts read here are skipped even while their attempts are still on the way to the server.
      setNext(await post<ComprehensionNext>('/api/practice/comprehension/next', { language, kind, level: lvl ?? null, exclude: finished.current.slice(-50) }));
    } catch (e) {
      setError(problem(e));
    }
  };
  useEffect(() => {
    if (initial || started.current) return;
    started.current = true;
    void load(level);
  }, []);
  const done = () => onDone(results.current);

  if (error) {
    return (
      <div className="mx-auto max-w-2xl space-y-4" data-lang={language}>
        <ErrorNote error={error} onRetry={() => void load(asked.current)} />
        <Button variant="outline" onClick={done}>
          {embedded ? 'Continue' : 'Done'}
        </Button>
      </div>
    );
  }
  if (!next) return <PageLoading label="Loading a text" />;
  if (!next.passage) return <NoPassage language={language} next={next} embedded={embedded} onRetry={() => void load(asked.current)} onDone={done} />;
  const passage = next.passage;
  return (
    <PassageView
      key={passage.id}
      language={language}
      passage={passage}
      next={next}
      embedded={embedded}
      takeTime={clock.take}
      onAnswer={onAnswer}
      onFinished={(grades) => {
        finished.current.push(passage.id);
        results.current.push(...grades);
      }}
      onNext={(lvl) => void load(lvl)}
      onDone={done}
    />
  );
}

function NoPassage({ language, next, embedded, onRetry, onDone }: { language: LanguageCode; next: ComprehensionNext; embedded: boolean; onRetry: () => void; onDone: () => void }) {
  const name = LANGUAGES[language].name;
  const noun = KINDS[next.kind].noun;
  // Unread texts the device asked to skip: their attempts have not reached the server yet.
  const saving = next.total > 0 && next.available > 0;
  const [title, text] =
    next.total === 0
      ? [`No ${noun} yet`, `There are no ${noun} in ${name} yet. They come with updates of the app.`]
      : saving
        ? ['Your last answers are still being saved', 'The texts you just read are not saved on the server yet. Try again in a moment.']
        : [`You have read all the ${noun}`, `You have read all ${count(next.total)} ${noun} in ${name}. New ones come with updates of the app.`];
  return (
    <div className="mx-auto max-w-2xl" data-lang={language}>
      <Empty
        icon={<LuBookOpen />}
        title={title}
        action={
          <div className="flex flex-wrap justify-center gap-2">
            {saving && (
              <Button variant="outline" onClick={onRetry}>
                Try again
              </Button>
            )}
            <Button onClick={onDone}>{embedded ? 'Continue' : 'Done'}</Button>
          </div>
        }
      >
        {text}
      </Empty>
    </div>
  );
}

const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.classList.contains('reduce-motion');

function PassageView({
  language,
  passage: p,
  next,
  embedded,
  takeTime,
  onAnswer,
  onFinished,
  onNext,
  onDone,
}: {
  language: LanguageCode;
  passage: ComprehensionPassage;
  next: ComprehensionNext;
  embedded: boolean;
  takeTime: () => number;
  onAnswer?: (grade: QuestionGrade['grade']) => void;
  onFinished: (grades: QuestionGrade[]) => void;
  onNext: (level: ReadingLevel) => void;
  onDone: () => void;
}) {
  const id = useId();
  const native = questionsInLanguage(p.level);
  // Each question's options in a random order, kept while this text is shown: the writers spread the right answers
  // over the four positions in each text, so in stored order the last one could be found by elimination.
  // order[q][k] is the stored index of the option shown k-th; answers go back to the server as stored indexes.
  const order = useMemo(() => p.questions.map((q) => shuffled(q.options.length)), [p.id]);
  const [chosen, setChosen] = useState<number[]>([]);
  // The question in the panel; the panel opens when the learner asks for the questions and can be hidden to read.
  const [shown, setShown] = useState(0);
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<ComprehensionResult | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [translation, setTranslation] = useState(false);
  const translationRef = useRef<HTMLElement>(null);
  const total = p.questions.length;
  const complete = chosen.length >= total;
  const Title = embedded ? 'h3' : 'h2';
  const label = p.kind === 'short' && p.format ? FORMATS[p.format] : GENRES[p.genre];

  const submit = (answers: number[]) => {
    const grades = answers.map((a, i) => a === p.questions[i].answer);
    const correct = grades.filter(Boolean).length;
    const passed = isPass(correct, total);
    const before = readingLevel(langSettings(language)?.readingLevel);
    // The level moves up when this was the last unread text of it (from the progress sent with the text).
    const { level: after, progress } = predictedLevel(before, next.progress, p.level);
    // Shown at once with the shared rules; the server grades again and keeps the level, and its result replaces this.
    setResult({
      passageId: p.id,
      correct,
      total,
      passed,
      levelBefore: before,
      levelAfter: after,
      levelUp: levelRank(after) > levelRank(before),
      progress,
      results: answers.map((a, i) => ({ chosen: a, answer: p.questions[i].answer, correct: grades[i] })),
    });
    if (after !== before) setLocalLanguageSettings(language, { readingLevel: after });
    const opId = uuid();
    const activeMs = takeTime();
    void enqueue(
      {
        method: 'POST',
        url: '/api/practice/comprehension/attempts',
        id: opId,
        label: 'Reading comprehension',
        body: { opId, language, passageId: p.id, answers, answeredAt: Date.now(), ...(activeMs ? { activeMs } : {}) },
      },
      {
        onResult: (r: ComprehensionResult) => {
          setResult(r);
          setLocalLanguageSettings(language, { readingLevel: r.levelAfter });
        },
      },
    );
    onFinished(grades.map((ok) => ({ grade: ok ? 'correct' : 'incorrect' })));
    // The text is stored with all its answers at once, so its questions count now, together: a text left half read is
    // not stored, comes back whole, and is never counted twice.
    for (const ok of grades) onAnswer?.(ok ? 'correct' : 'incorrect');
  };

  const choose = (question: number, stored: number) => {
    if (question !== chosen.length || complete) return;
    const all = [...chosen, stored];
    setChosen(all);
    if (all.length === total) submit(all);
  };
  const advance = () => {
    if (shown + 1 < total) setShown(shown + 1);
    else {
      setOpen(false);
      setShowResult(true);
    }
  };

  // With the panel closed, Enter opens the questions.
  useKeys(
    (e) => {
      if (open || showResult || e.key !== 'Enter') return;
      setOpen(true);
      return true;
    },
    [open, showResult],
  );

  useEffect(() => {
    if (translation) translationRef.current?.scrollIntoView({ block: 'start', behavior: calm() ? 'auto' : 'smooth' });
  }, [translation]);

  return (
    <div className="mx-auto max-w-2xl" data-lang={language}>
      {!embedded && <PracticeHeader done={chosen.length} total={total} onExit={onDone} exitLabel="Done reading" label={`${chosen.length} of ${total} questions answered`} caption={`${chosen.length} / ${total}`} />}
      <article aria-labelledby={`${id}-title`} data-passage={p.id}>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="soft" className="h-7 px-2.5 text-[0.8125rem] font-semibold">
            {p.level}
          </Badge>
          <Badge variant="outline" className="h-7 px-2.5 text-[0.8125rem] font-normal">
            {label ?? p.genre}
          </Badge>
          <AiPassageNote className="ml-auto" />
        </div>
        {next.fallback && (
          <p className="hint mt-2">
            No {next.requested} {KINDS[p.kind].one} is left to read, so this one is {p.level}.
          </p>
        )}
        <Title id={`${id}-title`} lang={language} className="word mt-4 text-[1.625rem] leading-tight sm:text-[2rem]">
          {p.title}
        </Title>
        <div lang={language} className="word mt-5 max-w-[36rem] space-y-4 text-[1.1875rem] leading-[1.75] font-normal sm:text-[1.25rem]">
          {paragraphs(p.text).map((t, i) => (
            <p key={i} className="whitespace-pre-line">
              {t}
            </p>
          ))}
        </div>
      </article>

      {translation && (
        <section ref={translationRef} lang="en" aria-label="Translation" className="mt-8 scroll-mt-20 rounded-xl border bg-muted/50 p-5">
          <p className="font-semibold">{p.titleEn}</p>
          <div className="mt-2 space-y-3 leading-relaxed">
            {paragraphs(p.translation).map((t, i) => (
              <p key={i} className="whitespace-pre-line">
                {t}
              </p>
            ))}
          </div>
        </section>
      )}

      {(showResult ? total : shown) > 0 && (
        <AnswerList id={id} questions={p.questions.slice(0, showResult ? total : shown)} chosen={chosen} native={native} language={language} heading={embedded ? 'h4' : 'h3'} />
      )}

      {!showResult &&
        (open ? (
          <QuestionPanel
            key={shown}
            id={`${id}-q${shown}`}
            index={shown}
            total={total}
            question={p.questions[shown]}
            order={order[shown]}
            picked={shown < chosen.length ? chosen[shown] : null}
            native={native}
            language={language}
            heading={embedded ? 'h4' : 'h3'}
            onChoose={(stored) => choose(shown, stored)}
            onNext={advance}
            onHide={() => setOpen(false)}
          />
        ) : (
          <ActionBar>
            <Button size="xl" className="flex-1" onClick={() => setOpen(true)}>
              <LuListChecks aria-hidden="true" /> {chosen.length === 0 && shown === 0 ? `Answer ${total} questions` : `Question ${shown + 1} of ${total}`}
            </Button>
          </ActionBar>
        ))}

      {showResult && result && (
        <FeedbackPanel
          verdict={result.passed ? 'correct' : 'close'}
          title={`${result.correct} of ${result.total} right`}
          actions={
            embedded ? (
              <ContinueButton onClick={onDone} />
            ) : (
              <>
                <Button variant="outline" size="xl" className="bg-card/80 px-5" onClick={onDone}>
                  Done
                </Button>
                <ContinueButton onClick={() => onNext(result.levelAfter)} label={`Next ${KINDS[p.kind].one}`} />
              </>
            )
          }
        >
          <p>{result.passed ? 'Passed.' : `Passing takes ${passMark(result.total)} of ${result.total}.`}</p>
          <p className="text-muted-foreground" data-testid="level-result">
            {levelResultText(result)}
          </p>
          <Button variant="outline" size="sm" className="bg-card/70" aria-expanded={translation} onClick={() => setTranslation(!translation)}>
            {translation ? <LuEyeOff aria-hidden="true" /> : <LuEye aria-hidden="true" />} {translation ? 'Hide the translation' : 'Show the translation'}
          </Button>
        </FeedbackPanel>
      )}
    </div>
  );
}

/**
 * One question in the panel docked under the text: its options (keys 1–4), then at once whether it was right and why,
 * and Next question (Enter). The chevron hides the panel to read the whole text again.
 */
function QuestionPanel({
  id,
  index,
  total,
  question: q,
  order,
  picked,
  native,
  language,
  heading: H,
  onChoose,
  onNext,
  onHide,
}: {
  id: string;
  index: number;
  total: number;
  question: ComprehensionQuestion;
  order: number[];
  picked: number | null;
  native: boolean;
  language: LanguageCode;
  heading: 'h3' | 'h4';
  onChoose: (stored: number) => void;
  onNext: () => void;
  onHide: () => void;
}) {
  const done = picked != null;
  const right = done && picked === q.answer;
  // B2 and C1 questions are in the text's language and use its type; earlier levels ask in English.
  const lang = native ? language : 'en';
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!done) first.current?.focus({ preventScroll: true });
  }, []);
  useKeys(
    (e) => {
      if (done) return;
      if (e.key === 'Escape') {
        onHide();
        return true;
      }
      const n = Number(e.key);
      if (n >= 1 && n <= order.length) {
        onChoose(order[n - 1]);
        return true;
      }
    },
    [done, order],
  );
  return (
    <BottomPanel aria-labelledby={`${id}-text`} footer={done ? <ContinueButton onClick={onNext} label={index + 1 < total ? 'Next question' : 'See your result'} /> : undefined}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-muted-foreground tabular-nums">
          Question {index + 1} of {total}
        </p>
        <Button variant="ghost" size="icon-sm" className="-mr-2 text-muted-foreground" onClick={onHide} aria-label="Hide the question to read the text">
          <LuChevronDown className="size-5" aria-hidden="true" />
        </Button>
      </div>
      <H id={`${id}-text`} lang={lang} className={cn('mt-1 text-[1.125rem] leading-snug font-semibold', native && 'word text-[1.25rem]')}>
        {q.q}
      </H>
      <div className="mt-3 grid gap-2" role="group" aria-labelledby={`${id}-text`}>
        {order.map((stored, k) => (
          <OptionButton
            key={stored}
            ref={k === 0 ? first : undefined}
            index={k + 1}
            state={!done ? undefined : stored === q.answer ? 'correct' : stored === picked ? 'wrong' : 'dim'}
            disabled={done}
            onClick={() => onChoose(stored)}
            className="min-h-12 text-base"
          >
            <span lang={lang} className={native ? 'word text-[1.125rem] leading-snug' : 'leading-snug'}>
              {q.options[stored]}
            </span>
          </OptionButton>
        ))}
      </div>
      {done && (
        <p role="status" lang="en" className={cn('mt-3 flex animate-in gap-2 rounded-xl px-3 py-2.5 text-[0.9375rem] fade-in-0', right ? 'bg-success-soft' : 'bg-destructive-soft')}>
          {right ? <LuCheck className="mt-0.5 size-[1.125rem] shrink-0 text-success" strokeWidth={2.75} aria-hidden="true" /> : <LuX className="mt-0.5 size-[1.125rem] shrink-0 text-destructive" strokeWidth={2.75} aria-hidden="true" />}
          <span>
            <span className="font-semibold">{right ? 'Right.' : 'Not this one.'}</span> {q.explain}
          </span>
        </p>
      )}
    </BottomPanel>
  );
}

/** The questions answered so far, under the text: each with the learner's answer, the right one, and why. */
function AnswerList({ id, questions, chosen, native, language, heading: H }: { id: string; questions: ComprehensionQuestion[]; chosen: number[]; native: boolean; language: LanguageCode; heading: 'h3' | 'h4' }) {
  const lang = native ? language : 'en';
  return (
    <section className="mt-10" aria-labelledby={`${id}-answers`}>
      <H id={`${id}-answers`} className="text-base font-semibold">
        Your answers
      </H>
      <ol className="mt-3 divide-y rounded-xl border bg-card">
        {questions.map((q, k) => {
          const right = chosen[k] === q.answer;
          return (
            <li key={k} className="flex gap-3 p-4">
              <span className={cn('mt-0.5 grid size-6 shrink-0 place-items-center rounded-full text-white dark:text-background', right ? 'bg-success' : 'bg-destructive')}>
                {right ? <LuCheck className="size-3.5" strokeWidth={3} aria-label="Right" /> : <LuX className="size-3.5" strokeWidth={3} aria-label="Wrong" />}
              </span>
              <Collapsible className="min-w-0 flex-1">
                <p lang={lang} className={cn('font-medium leading-snug', native && 'word text-[1.0625rem]')}>
                  {q.q}
                </p>
                <p lang={lang} className={cn('mt-1 text-[0.9375rem]', !right && 'text-muted-foreground line-through decoration-destructive/60', native && 'word')}>
                  {q.options[chosen[k]]}
                </p>
                {!right && (
                  <p className="text-[0.9375rem]">
                    <span className="text-muted-foreground">Right answer: </span>
                    <span lang={lang} className={cn('font-medium', native && 'word')}>
                      {q.options[q.answer]}
                    </span>
                  </p>
                )}
                <CollapsibleTrigger className="mt-1 -ml-1 rounded px-1 text-sm text-muted-foreground underline-offset-2 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50">Why</CollapsibleTrigger>
                <CollapsibleContent>
                  <p lang="en" className="mt-1 text-sm text-muted-foreground">
                    {q.explain}
                  </p>
                </CollapsibleContent>
              </Collapsible>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
