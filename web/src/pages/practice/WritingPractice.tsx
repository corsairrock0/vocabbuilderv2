// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Writing (server/learning/writing.ts): an English sentence at the learner's writing level, to be written in the
// language being learned with every word right. The device grades at once (shared/writing.ts, the sentence's accepted
// translations and the learner's own accepted ones); the server grades the answer again and keeps it. A sentence
// answered wrong comes back later; the level moves up once every sentence of it is done. "I was right" counts
// an answer graded wrong as right and accepts its wording from then on. Each word being learned in the translation the
// answer was compared with gets a review (server/learning/scheduling.ts, scheduleFromPractice).
import { useEffect, useRef, useState } from 'react';
import { LuCalendarCheck, LuPenLine, LuPlay } from 'react-icons/lu';
import { READING_LEVELS, readingLevel, type LevelProgress, type ReadingLevel } from '../../../../shared/comprehension.ts';
import { LANGUAGES, type LanguageCode } from '../../../../shared/languages.ts';
import { gradeWriting, type WritingAttemptResult, type WritingGrade, type WritingItem, type WritingMark, type WritingNext, type WritingSummary } from '../../../../shared/writing.ts';
import { ApiError, get, post, uuid } from '../../lib/api.ts';
import { count } from '../../lib/format.ts';
import { enqueue } from '../../lib/outbox.ts';
import { useActiveClock } from '../../lib/activeTime.ts';
import { langSettings, setLocalLanguageSettings, updateLanguageSettings, useApp } from '../../lib/store.ts';
import { Empty, ErrorNote, PageHeader, PageLoading, Segmented } from '../../components/ui.tsx';
import { TypingHelper } from '../session/TypingHelper.tsx';
import { useKeys } from '../session/Exercise.tsx';
import { ActionBar, ContinueButton, FeedbackPanel as SharedFeedbackPanel } from '../session/parts.tsx';
import { Badge } from '../../components/ui/badge.tsx';
import { Progress as KitProgress } from '../../components/ui/basics.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../../components/ui/card.tsx';
import { Textarea } from '../../components/ui/input.tsx';
import { Progress as PracticeHeader } from './common.tsx';

export type WritingGradeName = 'correct' | 'incorrect';

const problem = (e: unknown) => (e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e));

/** "12 of 200 A1 sentences done. Finish them all to move up to A2." */
export function writingProgressText(p: LevelProgress): string {
  if (!p.total) return `There are no ${p.level} sentences yet.`;
  const i = READING_LEVELS.indexOf(p.level);
  const up = i < READING_LEVELS.length - 1 ? READING_LEVELS[i + 1] : null;
  if (p.read >= p.total) return `You have written every ${p.level} sentence right.`;
  return `${count(p.read)} of ${count(p.total)} ${p.level} sentences done.${up ? ` Write them all right to move up to ${up}.` : ''}`;
}

export function WritingPractice() {
  const language = useApp((s) => s.boot?.settings.activeLanguage ?? 'es') as LanguageCode;
  return <WritingSetup key={language} language={language} />;
}

function WritingSetup({ language }: { language: LanguageCode }) {
  const [summary, setSummary] = useState<WritingSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<'setup' | 'run' | 'done'>('setup');
  const [results, setResults] = useState<WritingGradeName[]>([]);
  const level = readingLevel(langSettings(language)?.writingLevel ?? summary?.level);
  const load = () =>
    get<WritingSummary>(`/api/practice/writing/summary/${language}`)
      .then(setSummary)
      .catch((e) => setError(problem(e)));
  useEffect(() => void load(), []);
  if (error) return <ErrorNote error={error} onRetry={() => void load()} />;
  if (!summary) return <PageLoading />;
  const name = LANGUAGES[language].name;
  if (!summary.total) {
    return (
      <div className="max-w-2xl">
        <PageHeader title="Writing" />
        <Empty title={`No ${name} sentences yet`}>Sentences to write come with the app, a level at a time; this language has none in this version yet.</Empty>
      </div>
    );
  }
  if (phase === 'run') {
    return (
      <WritingRunner
        language={language}
        onDone={(r) => {
          setResults(r);
          setPhase('done');
          void load();
        }}
      />
    );
  }
  const progress = summary.levels.find((l) => l.level === level);
  const p = progress ? { level, total: progress.total, read: progress.done } : summary.progress;
  return (
    <div className="max-w-2xl" data-lang={language}>
      <PageHeader title="Writing" description={`Write each English sentence in ${name}. Every word must be right; capitals, punctuation and stress marks don’t count.`} />
      {phase === 'done' && results.length > 0 && (
        <Card size="sm" className="mb-5" role="status">
          <CardContent>
            <span className="font-semibold tabular-nums">{results.filter((g) => g === 'correct').length}</span> of <span className="tabular-nums">{results.length}</span> right.
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Your level: {level}</CardTitle>
          <CardDescription>{writingProgressText(p)}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {p.total > 0 && <KitProgress value={(100 * p.read) / p.total} aria-label={`Writing level ${level}`} />}
          <Segmented
            label="Writing level"
            value={level}
            onChange={(l: ReadingLevel) => {
              setLocalLanguageSettings(language, { writingLevel: l });
              void updateLanguageSettings(language, { writingLevel: l });
            }}
            options={READING_LEVELS.map((l) => ({ value: l, label: l }))}
          />
          <p className="hint">
            {count(summary.done)} of {count(summary.total)} sentences done in all. A sentence you get wrong comes back later. Each word you are learning in a sentence counts toward its memory.
          </p>
        </CardContent>
        <CardFooter>
          <Button size="lg" className="w-full sm:w-auto" onClick={() => setPhase('run')}>
            <LuPlay aria-hidden="true" /> {phase === 'done' ? 'Write more' : 'Start'}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}

/**
 * Sentences one after another: on the Practice page until the learner stops, or (`embedded`, a session's Writing round)
 * the one sentence `initial` names. `onAnswer` gets each answer's grade once the learner moves on, so a "My answer was
 * right" counts.
 */
export function WritingRunner({
  language,
  embedded = false,
  initial,
  onAnswer,
  onDone,
}: {
  language: LanguageCode;
  embedded?: boolean;
  initial?: WritingNext;
  onAnswer?: (grade: WritingGradeName) => void;
  onDone: (results: WritingGradeName[]) => void;
}) {
  const [next, setNext] = useState<WritingNext | null>(initial ?? null);
  const [error, setError] = useState<string | null>(null);
  const answered = useRef<string[]>([]);
  const results = useRef<WritingGradeName[]>([]);
  const started = useRef(false);
  const clock = useActiveClock(!embedded);
  const load = async () => {
    setNext(null);
    setError(null);
    try {
      // Sentences answered here are skipped even while their answers are still on the way to the server.
      setNext(await post<WritingNext>('/api/practice/writing/next', { language, exclude: answered.current.slice(-50) }));
    } catch (e) {
      setError(problem(e));
    }
  };
  useEffect(() => {
    if (initial || started.current) return;
    started.current = true;
    void load();
  }, []);
  const done = () => onDone(results.current);
  if (error) {
    return (
      <div className="mx-auto max-w-2xl">
        <ErrorNote error={error} onRetry={() => void load()} />
        <Button variant="outline" className="mt-4" onClick={done}>
          {embedded ? 'Continue' : 'Done'}
        </Button>
      </div>
    );
  }
  if (!next) return <PageLoading label="Loading a sentence" />;
  if (!next.sentence) {
    return (
      <div className="mx-auto max-w-2xl">
        <Empty title={next.total ? 'Every sentence is written' : 'No sentences yet'}>
          {next.total ? 'You have written every sentence there is for now. More come with new versions of the app.' : 'This language has no sentences to write in this version yet.'}
        </Empty>
        <Button className="mt-4" onClick={done}>
          {embedded ? 'Continue' : 'Done'}
        </Button>
      </div>
    );
  }
  return (
    <SentenceCard
      key={next.sentence.id}
      language={language}
      next={next}
      embedded={embedded}
      takeTime={clock.take}
      onFinished={(grade) => {
        answered.current.push(next.sentence!.id);
        results.current.push(grade);
        onAnswer?.(grade);
        if (embedded) done();
        else void load();
      }}
      onStop={done}
    />
  );
}

function Words({ words, kind }: { words: WritingMark[]; kind: 'answer' | 'right' }) {
  return (
    <span className="word">
      {words.map((w, i) => (
        <span key={i}>
          {i > 0 && ' '}
          {w.ok ? (
            <span>{w.w}</span>
          ) : kind === 'answer' ? (
            <span className="rounded bg-destructive/10 px-0.5 text-destructive line-through decoration-2" title="not in the right translation here">
              {w.w}
            </span>
          ) : (
            <mark className="mark rounded px-0.5" title="missing or different in your answer">
              {w.w}
            </mark>
          )}
        </span>
      ))}
    </span>
  );
}

function SentenceCard({
  language,
  next,
  embedded,
  takeTime,
  onFinished,
  onStop,
}: {
  language: LanguageCode;
  next: WritingNext;
  embedded: boolean;
  takeTime: () => number;
  onFinished: (grade: WritingGradeName) => void;
  onStop: () => void;
}) {
  const s = next.sentence as WritingItem;
  const [value, setValue] = useState('');
  const [grade, setGrade] = useState<WritingGrade | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [server, setServer] = useState<WritingAttemptResult | null>(null);
  const opId = useRef<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const name = LANGUAGES[language].name;
  useEffect(() => inputRef.current?.focus({ preventScroll: true }), []);

  const submit = (reveal = false) => {
    if (grade) return;
    const response = reveal ? '' : value;
    const g = gradeWriting(response, s, language, s.accepted);
    setGrade(g);
    setRevealed(reveal);
    const id = uuid();
    opId.current = id;
    const activeMs = takeTime();
    void enqueue(
      {
        method: 'POST',
        url: '/api/practice/writing/attempts',
        id,
        label: 'Writing answer',
        body: { opId: id, language, sentenceId: s.id, response, answeredAt: Date.now(), ...(activeMs ? { activeMs } : {}) },
      },
      {
        onResult: (r: WritingAttemptResult) => {
          setServer(r);
          setLocalLanguageSettings(language, { writingLevel: r.levelAfter });
        },
      },
    );
  };
  const accept = () => {
    if (!opId.current || accepted) return;
    setAccepted(true);
    void enqueue(
      { method: 'POST', url: '/api/practice/writing/accept', label: 'Writing answer counted as right', body: { opId: opId.current, language } },
      {
        onResult: (r: WritingAttemptResult) => {
          setServer(r);
          setLocalLanguageSettings(language, { writingLevel: r.levelAfter });
        },
      },
    );
  };
  const right = !!grade && (grade.correct || accepted);
  const finish = () => onFinished(right ? 'correct' : 'incorrect');
  useKeys(
    (e) => {
      if (e.key === 'Enter' && !e.shiftKey && grade) {
        finish();
        return true;
      }
    },
    [grade, accepted],
  );
  const progress = server?.progress ?? next.progress;
  return (
    <article className="mx-auto max-w-2xl" data-lang={language} aria-label="Writing">
      {!embedded && (
        <PracticeHeader
          done={progress.read}
          total={progress.total}
          onExit={onStop}
          exitLabel="Done for now"
          label={`Writing level ${progress.level}: ${count(progress.read)} of ${count(progress.total)} sentences`}
          caption={`${progress.level} · ${count(progress.read)}/${count(progress.total)}`}
        />
      )}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {!embedded && (
          <Badge variant="soft" className="h-7 gap-1.5 px-2.5 text-[0.8125rem] font-semibold">
            <LuPenLine aria-hidden="true" /> Writing · {s.level}
          </Badge>
        )}
        {next.fallback && <span className="text-sm text-muted-foreground">your level {next.requested} has none left</span>}
        {next.again && <span className="text-sm text-muted-foreground">you missed it before</span>}
      </div>
      <p className="text-sm text-muted-foreground">Write this in {name}</p>
      <p className="mt-1 text-[1.5rem] leading-snug font-semibold tracking-tight sm:text-[1.75rem]" lang="en">
        {s.en}
      </p>
      {s.context && <p className="mt-1.5 text-sm text-muted-foreground">({s.context})</p>}
      <form
        className="mt-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) submit();
        }}
      >
        <label className="sr-only" htmlFor={`w-${s.id}`}>
          Your answer
        </label>
        <Textarea
          id={`w-${s.id}`}
          ref={inputRef}
          className="word min-h-28 rounded-xl text-[1.25rem] leading-snug"
          lang={language}
          value={value}
          readOnly={!!grade}
          rows={3}
          autoCapitalize="sentences"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder={`In ${name}`}
          onChange={(e) => setValue((e.target as HTMLTextAreaElement).value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !grade) {
              e.preventDefault();
              if (value.trim()) submit();
            }
          }}
        />
        {!grade && <TypingHelper language={language} inputRef={inputRef} setValue={setValue} />}
        {!grade && (
          <ActionBar>
            <Button variant="ghost" size="xl" className="px-3 text-muted-foreground" onClick={() => submit(true)}>
              I don’t know
            </Button>
            <Button type="submit" size="xl" className="flex-1" disabled={!value.trim()} data-testid="check">
              Check
            </Button>
          </ActionBar>
        )}
      </form>
      {grade && (
        <SharedFeedbackPanel
          verdict={right ? 'correct' : revealed ? 'revealed' : 'incorrect'}
          title={grade.correct ? 'Right' : accepted ? 'Counted as right' : revealed ? 'The translation' : 'Not quite'}
          actions={
            <>
              {!grade.correct && !revealed && !accepted && (
                <Button variant="outline" size="xl" className="bg-card/80 px-4" onClick={accept} title="Count your answer as right and accept its wording from now on">
                  I was right
                </Button>
              )}
              <ContinueButton onClick={finish} label={embedded ? 'Continue' : 'Next sentence'} />
            </>
          }
        >
          {!grade.correct && !revealed && !accepted && (
            <dl className="space-y-2">
              <div>
                <dt className="text-sm text-muted-foreground">Your answer</dt>
                <dd className="text-lg">
                  <Words words={grade.answerWords} kind="answer" />
                </dd>
              </div>
              <div>
                <dt className="text-sm text-muted-foreground">A right answer</dt>
                <dd className="text-lg">
                  <Words words={grade.closestWords} kind="right" />
                </dd>
              </div>
            </dl>
          )}
          {(revealed || (grade.correct && grade.closest !== grade.expected) || (!grade.correct && grade.closest !== grade.expected)) && (
            <p>
              <span className="text-sm text-muted-foreground">{revealed ? '' : grade.correct ? 'Also right: ' : 'The usual translation: '}</span>
              <span className="word text-lg">{grade.expected}</span>
            </p>
          )}
          {accepted && <p className="text-sm text-muted-foreground">Your wording now counts as right for this sentence.</p>}
          {server?.levelUp && <p className="font-semibold">You have written every {server.levelBefore} sentence right: your writing level is now {server.levelAfter}.</p>}
          {(server?.reviews ?? 0) > 0 && (
            <Badge variant="outline" className="h-7 gap-1.5 bg-card/70 px-2.5 text-[0.8125rem] font-medium" data-testid="review-badge">
              <LuCalendarCheck className="text-lang" aria-hidden="true" /> Review done for {server!.reviews} {server!.reviews === 1 ? 'word' : 'words'}
            </Badge>
          )}
          <p className="hint">{writingProgressText(progress)}</p>
        </SharedFeedbackPanel>
      )}
    </article>
  );
}
