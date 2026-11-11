// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Read and say: real sentences built from the words the learner knows (server/learning/reading.ts).
//   Read    at most one new word per sentence; tap any word for its meaning; check the translation; say how much
//           you understood. A new word can go to the front of the next session.
//   Say it  a sentence of known words shown in English; say or type it, then compare word by word.
import { useEffect, useRef, useState } from 'react';
import { LuBookOpenText, LuCheck, LuEye, LuMic, LuPlus, LuVolume2 } from 'react-icons/lu';
import { LANGUAGES, type LanguageCode } from '../../../../shared/languages.ts';
import { compareWords } from '../../../../shared/compare.ts';
import { ApiError, get, post, uuid } from '../../lib/api.ts';
import { speakSentence } from '../../lib/audio.ts';
import { count } from '../../lib/format.ts';
import { enqueue } from '../../lib/outbox.ts';
import { Link } from '../../lib/router.tsx';
import { useActiveClock } from '../../lib/activeTime.ts';
import { langSettings, toast, useApp } from '../../lib/store.ts';
import { AiSentenceNote, PageHeader, PageLoading } from '../../components/ui.tsx';
import { useKeys } from '../session/Exercise.tsx';
import { ActionBar, ContinueButton, FeedbackPanel as SharedFeedbackPanel } from '../session/parts.tsx';
import { Alert, AlertDescription } from '../../components/ui/alert.tsx';
import { Badge } from '../../components/ui/badge.tsx';
import { Kbd } from '../../components/ui/basics.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../../components/ui/card.tsx';
import { Empty } from '../../components/ui.tsx';
import { AnswerInput, Progress } from './common.tsx';

export type Mode = 'read' | 'say';
interface Token {
  t: string;
  e?: number;
  s?: 'known' | 'new' | 'other';
}
export interface ReadItem {
  sentenceId: number;
  entryId: number;
  text: string;
  translation: string;
  ai: boolean;
  tokens: Token[];
  newEntryId: number | null;
  words: Record<number, { lemma: string; display: string; pos: string | null; gloss: string }>;
}
interface Summary {
  knownWords: number;
  readable: number;
  sayable: number;
  newWords: number;
}
type ReadGrade = 'understood' | 'partly' | 'not';
type SayGrade = 'correct' | 'close' | 'incorrect' | 'revealed';
interface Result {
  item: ReadItem;
  grade: ReadGrade | SayGrade;
  queued?: boolean;
}

const MIN_WORDS = 20;

/** `activeMs`: active time since the previous sentence on the Practice page; 0 in a session's round (the session counts it). */
function save(mode: Mode, item: ReadItem, grade: ReadGrade | SayGrade, response: string | null, activeMs: number) {
  const opId = uuid();
  void enqueue({
    method: 'POST',
    url: '/api/practice/read/attempts',
    id: opId,
    label: mode === 'read' ? 'Reading practice' : 'Speaking practice',
    body: { opId, mode, sentenceId: item.sentenceId, grade, response, answeredAt: Date.now(), ...(activeMs ? { activeMs } : {}) },
  });
}

/** Speak a sentence with the device voice, when device speech is on for the language. */
function useVoice(language: LanguageCode) {
  const ls = langSettings(language);
  const enabled = !!ls?.ttsFallback && typeof speechSynthesis !== 'undefined';
  return enabled ? (text: string) => speakSentence(text, LANGUAGES[language].ttsLocales, ls?.ttsVoice ?? null, ls?.playbackRate ?? 1) : null;
}

export function ReadPractice() {
  const language = useApp((s) => s.boot?.settings.activeLanguage ?? 'es') as LanguageCode;
  return <ReadSetup key={language} language={language} />;
}

function ReadSetup({ language }: { language: LanguageCode }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<'setup' | 'loading' | 'run' | 'done'>('setup');
  const [mode, setMode] = useState<Mode>('read');
  const [items, setItems] = useState<ReadItem[]>([]);
  const [results, setResults] = useState<Result[]>([]);
  useEffect(() => {
    get<Summary>(`/api/practice/read/summary/${language}`)
      .then(setSummary)
      .catch((e) => setError(e instanceof ApiError && e.isNetwork ? 'Reading needs a connection to your server.' : e instanceof Error ? e.message : String(e)));
  }, []);
  const start = async (m: Mode) => {
    setMode(m);
    setPhase('loading');
    setError(null);
    try {
      const r = await post<{ items: ReadItem[] }>('/api/practice/read/batch', { language, mode: m, size: 10 });
      if (!r.items.length) {
        setPhase('setup');
        setError(m === 'read' ? 'No sentence fits what you know yet. Learn a few more words, then try again.' : 'No sentence is made only of words you know yet. Read for a while first, or learn a few more words.');
        return;
      }
      setItems(r.items);
      setResults([]);
      setPhase('run');
    } catch (e) {
      setPhase('setup');
      setError(e instanceof ApiError && e.isNetwork ? 'Reading needs a connection to your server.' : e instanceof Error ? e.message : String(e));
    }
  };
  const lang = LANGUAGES[language];
  if (phase === 'run') return <ReadRunner language={language} mode={mode} items={items} onDone={(r) => (setResults(r), setPhase('done'))} />;
  if (phase === 'done') return <Done language={language} mode={mode} results={results} again={() => void start(mode)} other={() => void start(mode === 'read' ? 'say' : 'read')} />;
  if (!summary) return error ? <p className="text-destructive">{error}</p> : <PageLoading />;
  const tooFew = summary.knownWords < MIN_WORDS;
  return (
    <div className="max-w-3xl" data-lang={language}>
      <PageHeader
        title="Read and say"
        description={`Real ${lang.name} sentences chosen from what you know. Reading brings in one new word at a time; saying turns it around, from English, with words you already have.`}
      />
      {tooFew ? (
        <Empty title="Learn a few words first" action={<Button variant="lang" render={<Link to="/" />}>Study new words</Button>}>
          You know {count(summary.knownWords)} {lang.name} words. Sentences appear here once you know about {MIN_WORDS}; most come after the first hundred.
        </Empty>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <Card>
            <CardHeader>
              <span className="mb-1 grid size-10 place-items-center rounded-lg bg-lang-soft text-lang">
                <LuBookOpenText className="size-5" aria-hidden="true" />
              </span>
              <CardTitle className="text-lg">Read</CardTitle>
              <CardDescription>Sentences with at most one word you have not met. Tap any word for its meaning, then check the translation.</CardDescription>
            </CardHeader>
            <CardContent className="flex-1">
              <p className="hint">
                {count(summary.readable)} sentences fit what you know, with {count(summary.newWords)} new words waiting in them.
              </p>
            </CardContent>
            <CardFooter>
              <Button size="lg" className="w-full" disabled={phase === 'loading'} onClick={() => void start('read')}>
                Start reading
              </Button>
            </CardFooter>
          </Card>
          <Card>
            <CardHeader>
              <span className="mb-1 grid size-10 place-items-center rounded-lg bg-lang-soft text-lang">
                <LuMic className="size-5" aria-hidden="true" />
              </span>
              <CardTitle className="text-lg">Say it</CardTitle>
              <CardDescription>An English sentence made only of words you know. Say it or type it in {lang.name}, then compare it word by word.</CardDescription>
            </CardHeader>
            <CardContent className="flex-1">
              <p className="hint">{count(summary.sayable)} sentences use only words you know.</p>
            </CardContent>
            <CardFooter>
              <Button size="lg" className="w-full" disabled={phase === 'loading' || summary.sayable === 0} onClick={() => void start('say')}>
                Start saying
              </Button>
            </CardFooter>
          </Card>
        </div>
      )}
      {error && (
        <Alert variant="destructive" className="mt-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <p className="hint mt-6">Sentences you read or said in the last week are not repeated.</p>
    </div>
  );
}

/**
 * One round of Read or Say it; `embedded` is the form used inside a Comprehensive study session, where `onAnswer`
 * counts each answer as it is given (a sentence said counts once it is checked, before Continue).
 */
export function ReadRunner({ language, mode, items, onAnswer, onDone, embedded = false }: { language: LanguageCode; mode: Mode; items: ReadItem[]; onAnswer?: (grade: string) => void; onDone: (r: Result[]) => void; embedded?: boolean }) {
  const [i, setI] = useState(0);
  const [results, setResults] = useState<Result[]>([]);
  // Study time for the Practice page; inside a session the session counts it.
  const clock = useActiveClock(!embedded);
  const item = items[i];
  const next = (r: Result) => {
    const all = [...results, r];
    setResults(all);
    if (i + 1 >= items.length) onDone(all);
    else setI(i + 1);
  };
  return (
    <div className="mx-auto max-w-2xl" data-lang={language}>
      {/* In a session the session's header counts the questions. */}
      {!embedded && <Progress done={i} total={items.length} onExit={() => onDone(results)} />}
      {embedded && (
        <Button variant="ghost" size="sm" className="-ml-2.5 mb-2 text-muted-foreground" onClick={() => onDone(results)}>
          Skip {items.length - i === 1 ? 'this sentence' : 'these sentences'}
        </Button>
      )}
      {mode === 'read' ? (
        <ReadCard key={item.sentenceId} language={language} item={item} onAnswer={onAnswer} onNext={next} takeTime={clock.take} />
      ) : (
        <SayCard key={item.sentenceId} language={language} item={item} onAnswer={onAnswer} onNext={next} takeTime={clock.take} />
      )}
    </div>
  );
}

/** The sentence as tappable words; the new word is marked, and the tapped word's meaning shows below. */
function SentenceWords({ item, picked, onPick, reveal }: { item: ReadItem; picked: number | null; onPick: (e: number) => void; reveal?: boolean }) {
  return (
    <p className="word text-[1.6rem] leading-[1.7] sm:text-[1.85rem]">
      {item.tokens.map((tok, k) =>
        tok.e != null ? (
          <button
            key={k}
            type="button"
            onClick={() => onPick(tok.e!)}
            aria-pressed={picked === tok.e}
            aria-label={`${tok.t}${tok.s === 'new' ? ', new word' : ''}: show meaning`}
            className={`rounded-md px-0.5 underline-offset-[6px] transition-colors ${
              tok.s === 'new' ? 'text-lang underline decoration-lang decoration-2' : reveal ? '' : 'decoration-border hover:underline'
            } ${picked === tok.e ? 'bg-lang-soft' : 'hover:bg-muted'}`}
          >
            {tok.t}
          </button>
        ) : (
          <span key={k}>{tok.t}</span>
        ),
      )}
    </p>
  );
}

function WordMeaning({ item, entryId, onLearn, queued }: { item: ReadItem; entryId: number; onLearn?: () => void; queued?: boolean }) {
  const w = item.words[entryId];
  if (!w) return null;
  const isNew = item.newEntryId === entryId;
  return (
    <div className="mt-4 flex animate-in flex-wrap items-start justify-between gap-3 rounded-xl border bg-card px-4 py-3 shadow-xs fade-in-0 slide-in-from-bottom-2">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2">
          <span className="word text-xl">{w.display}</span>
          {w.pos && <span className="text-sm text-muted-foreground">{w.pos}</span>}
          {isNew && <Badge variant="soft">new</Badge>}
        </p>
        <p className="mt-0.5 text-muted-foreground">{w.gloss}</p>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {isNew && onLearn && (
          <Button variant="outline" size="sm" disabled={queued} onClick={onLearn}>
            {queued ? <LuCheck aria-hidden="true" /> : <LuPlus aria-hidden="true" />} {queued ? 'In your next session' : 'Learn it next'}
          </Button>
        )}
        <Button variant="ghost" size="sm" render={<Link to={`/words/${entryId}`} />}>
          Open word
        </Button>
      </div>
    </div>
  );
}

function ReadCard({ language, item, onAnswer, onNext, takeTime }: { language: LanguageCode; item: ReadItem; onAnswer?: (grade: string) => void; onNext: (r: Result) => void; takeTime: () => number }) {
  const [picked, setPicked] = useState<number | null>(item.newEntryId);
  const [shown, setShown] = useState(false);
  const [queued, setQueued] = useState(false);
  const speak = useVoice(language);
  const grade = (g: ReadGrade) => {
    save('read', item, g, null, takeTime());
    onAnswer?.(g);
    onNext({ item, grade: g, queued });
  };
  const learn = async () => {
    if (item.newEntryId == null) return;
    try {
      await post('/api/practice/read/learn-next', { entryId: item.newEntryId });
      setQueued(true);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'bad');
    }
  };
  useKeys(
    (e) => {
      if (!shown && (e.key === 'Enter' || e.key === ' ')) return (setShown(true), true);
      if (shown && e.key === '1') return (grade('understood'), true);
      if (shown && e.key === '2') return (grade('partly'), true);
      if (shown && e.key === '3') return (grade('not'), true);
    },
    [shown, queued],
  );
  return (
    <article data-reading={item.sentenceId}>
      <p className="mb-3 text-sm font-medium text-muted-foreground">{item.newEntryId != null ? 'One new word. Tap any word for its meaning.' : 'Every word is one you know. Tap any word for its meaning.'}</p>
      <SentenceWords item={item} picked={picked} onPick={(e) => setPicked(picked === e ? null : e)} />
      {item.ai && <AiSentenceNote className="mt-1" />}
      {speak && (
        <Button variant="ghost" size="sm" className="-ml-2.5 mt-2 text-muted-foreground" onClick={() => speak(item.text)}>
          <LuVolume2 aria-hidden="true" /> Listen (device voice)
        </Button>
      )}
      {picked != null && <WordMeaning item={item} entryId={picked} onLearn={() => void learn()} queued={queued} />}
      {shown ? (
        <SharedFeedbackPanel
          verdict="self"
          title="The translation"
          actions={
            <div className="w-full">
              <p className="mb-2 text-sm text-muted-foreground">How much did you understand before you looked?</p>
              <div className="grid grid-cols-3 gap-2">
                <Button variant="outline" size="xl" className="bg-card/80 px-2" onClick={() => grade('not')}>
                  Not much <Kbd className="hidden [@media(hover:hover)]:inline-flex">3</Kbd>
                </Button>
                <Button variant="outline" size="xl" className="bg-card/80 px-2" onClick={() => grade('partly')}>
                  Partly <Kbd className="hidden [@media(hover:hover)]:inline-flex">2</Kbd>
                </Button>
                <Button size="xl" className="px-2" onClick={() => grade('understood')}>
                  All of it <Kbd className="hidden [@media(hover:hover)]:inline-flex">1</Kbd>
                </Button>
              </div>
            </div>
          }
        >
          <p className="text-lg">{item.translation}</p>
        </SharedFeedbackPanel>
      ) : (
        <ActionBar>
          <Button size="xl" className="flex-1" onClick={() => setShown(true)}>
            <LuEye aria-hidden="true" /> Check the translation
          </Button>
        </ActionBar>
      )}
    </article>
  );
}

function SayCard({ language, item, onAnswer, onNext, takeTime }: { language: LanguageCode; item: ReadItem; onAnswer?: (grade: string) => void; onNext: (r: Result) => void; takeTime: () => number }) {
  const [value, setValue] = useState('');
  const [result, setResult] = useState<{ grade: SayGrade; cmp: ReturnType<typeof compareWords> | null } | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const speak = useVoice(language);
  const check = (revealed: boolean) => {
    if (revealed) {
      setResult({ grade: 'revealed', cmp: null });
      save('say', item, 'revealed', null, takeTime());
      onAnswer?.('revealed');
      return;
    }
    const cmp = compareWords(value, item.text, language);
    const grade: SayGrade = cmp.score >= 0.95 ? 'correct' : cmp.score >= 0.7 ? 'close' : 'incorrect';
    setResult({ grade, cmp });
    save('say', item, grade, value, takeTime());
    onAnswer?.(grade);
  };
  useKeys(
    (e) => {
      if (result && e.key === 'Enter') return (onNext({ item, grade: result.grade }), true);
    },
    [result],
  );
  return (
    <article data-saying={item.sentenceId}>
      <p className="mb-3 text-sm font-medium text-muted-foreground">Say it in {LANGUAGES[language].name}, aloud or typed. Every word is one you know.</p>
      <p className="text-[1.5rem] leading-snug font-semibold tracking-tight sm:text-[1.75rem]">{item.translation}</p>
      {!result && (
        <>
          <AnswerInput language={language} value={value} setValue={setValue} onSubmit={() => check(false)} onReveal={() => check(true)} locked={false} inputRef={inputRef} />
          <Button variant="ghost" size="sm" className="-ml-2.5 mt-2 text-muted-foreground" onClick={() => check(true)}>
            <LuMic aria-hidden="true" /> I said it aloud: show the sentence
          </Button>
        </>
      )}
      {result && (
        <SharedFeedbackPanel
          verdict={result.grade === 'correct' ? 'correct' : result.grade === 'close' ? 'close' : result.grade === 'revealed' ? 'self' : 'incorrect'}
          title={result.grade === 'correct' ? 'That’s the sentence' : result.grade === 'close' ? 'Nearly' : result.grade === 'revealed' ? 'The sentence' : 'Compare with the sentence'}
          actions={
            <>
              {speak && (
                <Button variant="outline" size="xl" className="bg-card/80 px-4" onClick={() => speak(item.text)} aria-label="Listen (device voice)">
                  <LuVolume2 aria-hidden="true" />
                </Button>
              )}
              <ContinueButton onClick={() => onNext({ item, grade: result.grade })} />
            </>
          }
        >
          {result.cmp ? (
            <p className="word mt-2 text-[1.35rem] leading-relaxed">
              {result.cmp.original.map((o, k) => (
                <span key={k}>
                  <span className={o.ok ? 'text-success' : 'rounded bg-destructive-soft px-0.5 text-destructive underline decoration-destructive decoration-dotted underline-offset-4'} title={o.ok ? undefined : 'Missing or different in yours'}>
                    {o.w}
                  </span>{' '}
                </span>
              ))}
            </p>
          ) : (
            <SentenceWords item={item} picked={picked} onPick={(e) => setPicked(picked === e ? null : e)} reveal />
          )}
          {result.cmp && result.cmp.extra.length > 0 && (
            <p className="mt-1 text-sm">
              In yours but not in the sentence: <span className="word">{result.cmp.extra.join(', ')}</span>
            </p>
          )}
          {result.cmp && <p className="mt-2 text-sm text-muted-foreground">You wrote: <span className="word">{value}</span></p>}
          {picked != null && <WordMeaning item={item} entryId={picked} />}
          {item.ai && <AiSentenceNote className="mt-2" />}
        </SharedFeedbackPanel>
      )}
    </article>
  );
}

function Done({ language, mode, results, again, other }: { language: LanguageCode; mode: Mode; results: Result[]; again: () => void; other: () => void }) {
  const n = (g: string) => results.filter((r) => r.grade === g).length;
  const met = results.filter((r) => r.item.newEntryId != null);
  return (
    <div className="mx-auto max-w-2xl" data-lang={language}>
      <PageHeader title={mode === 'read' ? 'Reading done' : 'Saying done'} />
      {mode === 'read' ? (
        <p className="text-lg">
          {count(results.length)} sentences: all understood {n('understood')}, partly {n('partly')}, not much {n('not')}.
        </p>
      ) : (
        <p className="text-lg">
          {count(results.length)} sentences: right {n('correct')}, nearly {n('close')}, to work on {n('incorrect') + n('revealed')}.
        </p>
      )}
      {met.length > 0 && (
        <section className="mt-6">
          <h2 className="text-lg font-semibold">New words you met</h2>
          <ul className="mt-2 space-y-1">
            {met.map((r) => {
              const w = r.item.words[r.item.newEntryId!];
              return (
                <li key={r.item.sentenceId}>
                  <Link to={`/words/${r.item.newEntryId}`} className="word underline-offset-2 hover:underline">
                    {w?.display}
                  </Link>
                  <span className="text-muted-foreground"> — {w?.gloss}</span>
                  {r.queued && (
                    <Badge variant="soft" className="ml-2">
                      in your next session
                    </Badge>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
      <div className="mt-8 flex flex-wrap gap-2">
        <Button size="lg" onClick={again}>
          {mode === 'read' ? 'Read more' : 'Say more'}
        </Button>
        <Button size="lg" variant="outline" onClick={other}>
          {mode === 'read' ? 'Now say some' : 'Now read some'}
        </Button>
        <Button size="lg" variant="ghost" render={<Link to="/practice" />}>
          Back to Practice
        </Button>
      </div>
    </div>
  );
}
