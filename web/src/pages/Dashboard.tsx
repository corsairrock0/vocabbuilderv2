// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
/**
 * Today (Home) for the active language: the session to do now in one sentence and one bar of its mix, its length, and
 * Start in one tap (Session options opens the full options); the last seven days against the daily goal; words known
 * toward the next round number; and the other languages. A language without words offers ways to add some instead.
 */
import { useEffect, useState } from 'react';
import { LuCheck, LuChevronRight, LuCloudOff, LuDownload, LuFileUp, LuFlame, LuGraduationCap, LuPlay, LuPlus, LuRotateCcw, LuSlidersHorizontal } from 'react-icons/lu';
import { LANGUAGES, type LanguageCode } from '../../../shared/languages.ts';
import { TYPE_INFO, type QuestionType } from '../../../shared/mix.ts';
import { DEFAULT_STUDY_MODE } from '../../../shared/settings.ts';
import type { LanguageSettings } from '../../../shared/settings.ts';
import { listJoin } from '../../../shared/stats.ts';
import type { LanguageSummary } from '../../../shared/types.ts';
import { SetUpdateNote } from '../components/SetUpdateNote.tsx';
import { ErrorNote, PageLoading } from '../components/ui.tsx';
import { Alert, AlertDescription } from '../components/ui/alert.tsx';
import { Badge } from '../components/ui/badge.tsx';
import { Progress, Skeleton } from '../components/ui/basics.tsx';
import { Button } from '../components/ui/button.tsx';
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../components/ui/card.tsx';
import { ToggleGroup, ToggleGroupItem } from '../components/ui/controls.tsx';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from '../components/ui/empty.tsx';
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '../components/ui/item.tsx';
import { ApiError, post, uuid } from '../lib/api.ts';
import { count, dayText, duration, plural } from '../lib/format.ts';
import { Link, navigate } from '../lib/router.tsx';
import { loadBootstrap, setActiveLanguage, toast, updateLanguageSettings, useApp } from '../lib/store.ts';
import { useTodayPlan, type TodayPlan } from '../lib/todayPlan.ts';
import { cn } from '../lib/utils.ts';
import { TYPE_ICONS } from './session/QuestionType.tsx';
import { cachedOfflineSessions, startSession } from './session/runtime.ts';

const LENGTHS = [10, 20, 30];
const MILESTONES = [25, 50, 100, 250, 500, 750, 1000, 1500, 2000, 2500, 3000, 4000, 5000, 6000, 8000, 10000];

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export function Dashboard() {
  const boot = useApp((s) => s.boot);
  const bootError = useApp((s) => s.bootError);
  const [offline, setOffline] = useState<Array<{ id: string; language: LanguageCode; total: number }>>([]);
  useEffect(() => {
    void loadBootstrap();
    void cachedOfflineSessions().then(setOffline);
    const onChange = () => void cachedOfflineSessions().then(setOffline);
    window.addEventListener('vb:data-changed', onChange);
    return () => window.removeEventListener('vb:data-changed', onChange);
  }, []);
  if (!boot) return bootError ? <ErrorNote error={bootError} onRetry={() => void loadBootstrap()} /> : <PageLoading />;
  const code = boot.settings.activeLanguage;
  const lang = boot.languages.find((l) => l.code === code) ?? boot.languages[0];
  const settings = boot.languageSettings[lang.code];
  const audio = boot.forvo.configured || !!settings?.ttsFallback;

  return (
    <div className="mx-auto max-w-4xl" data-lang={lang.code}>
      <header className="mb-5">
        <p className="text-muted-foreground">{greeting()}</p>
        <h1 className="word mt-0.5 text-[2.375rem] leading-tight tracking-[-0.01em]" lang={lang.code}>
          {LANGUAGES[lang.code].nativeName}
        </h1>
      </header>
      <div className="grid items-start gap-4 lg:grid-cols-[1.15fr_1fr]">
        {lang.stats.total === 0 ? <GetStarted lang={lang} /> : lang.activeSession ? <Unfinished lang={lang} /> : <TodaysSession key={lang.code} lang={lang} settings={settings} audio={audio} />}
        <div className="grid gap-4">
          <LastSevenDays lang={lang} goal={settings?.dailyGoalMinutes ?? 20} />
          {lang.stats.total > 0 && <WordsKnown lang={lang} readingLevel={settings?.readingLevel ?? 'A1'} />}
        </div>
      </div>
      <SetUpdateNote language={lang.code} className="mt-4" />
      {offline.length > 0 && (
        <Alert className="mt-4">
          <LuCloudOff aria-hidden="true" />
          <AlertDescription className="text-foreground/85">
            <p>
              {plural(offline.length, 'session')} saved for offline study:{' '}
              {offline.map((s, i) => (
                <span key={s.id}>
                  {i > 0 && ', '}
                  <Link to={`/study/${s.id}`} className="font-medium text-foreground underline underline-offset-2">
                    {LANGUAGES[s.language].name}
                  </Link>
                </span>
              ))}
            </p>
          </AlertDescription>
        </Alert>
      )}
      <OtherLanguages langs={boot.languages.filter((l) => l.code !== lang.code)} />
    </div>
  );
}

/** "35 reviews and 6 new words, with practice of every kind" */
function planSentence(plan: TodayPlan): string {
  const words = [plan.reviews ? plural(plan.reviews, 'review') : '', plan.newWords ? plural(plan.newWords, 'new word') : ''].filter(Boolean);
  const practice = plan.skills.filter((s) => s !== 'words').length;
  if (!words.length) return practice ? 'No words due: practice of every kind' : 'Nothing due right now';
  const head = listJoin(words);
  return practice >= 5 ? `${head}, with practice of every kind` : practice ? `${head}, with practice` : head;
}

function TodaysSession({ lang, settings, audio }: { lang: LanguageSummary; settings: LanguageSettings | undefined; audio: boolean }) {
  // One id for the plan shown and the session Start creates, so the numbers here are the session's.
  const [planId, setPlanId] = useState(() => uuid());
  const { plan, loading } = useTodayPlan(lang, settings, audio, planId);
  const [busy, setBusy] = useState(false);
  const minutes = settings?.sessionMinutes ?? 30;
  const start = async () => {
    setBusy(true);
    try {
      const id = await startSession({ id: planId, language: lang.code, quick: true, mode: DEFAULT_STUDY_MODE });
      navigate(`/study/${id}`);
    } catch (err) {
      setPlanId(uuid());
      if (err instanceof ApiError && err.code === 'active_session_exists') navigate(`/study/${(err.details as { sessionId: string }).sessionId}`);
      else toast(err instanceof Error ? err.message : 'Could not start a session', 'bad');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card role="region" aria-labelledby="today-title" aria-busy={loading}>
      <CardHeader>
        <CardTitle id="today-title" className="text-lg">
          Today’s session
        </CardTitle>
        <CardDescription data-testid="today-sentence" className="text-[0.9375rem]">
          {plan.empty ?? (
            <>
              <span className="text-foreground">{planSentence(plan)}</span>
              {plan.total ? <span> · {plural(plan.total, 'question')}</span> : null}
            </>
          )}
        </CardDescription>
      </CardHeader>
      {!plan.empty && (
        <CardContent className="space-y-5">
          {plan.parts?.length ? <MixBar parts={plan.parts} /> : <Skeleton className="h-2 w-full rounded-full" />}
          <ul className="sr-only" data-testid="today-plan">
            <li>{plural(plan.reviews, 'review')} due</li>
            <li>{plural(plan.newWords, 'new word')}</li>
            <li>{plural(plan.skills.length, 'skill')} mixed in</li>
          </ul>
          <ToggleGroup
            type="single"
            variant="outline"
            spacing={2}
            value={LENGTHS.includes(minutes) ? String(minutes) : ''}
            onValueChange={(v) => v && void updateLanguageSettings(lang.code, { sessionMinutes: Number(v) })}
            aria-label="Session length"
            className="w-full"
          >
            {LENGTHS.map((m) => (
              <ToggleGroupItem key={m} value={String(m)} className="flex-1">
                {m} min
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </CardContent>
      )}
      <CardFooter className="flex-col gap-1.5">
        <Button variant="lang" size="xl" className="w-full" disabled={busy || !!plan.empty} onClick={() => void start()}>
          <LuPlay aria-hidden="true" /> {busy ? 'Planning your session' : 'Start'}
        </Button>
        <Button variant="ghost" className="w-full text-muted-foreground" render={<Link to="/study" />}>
          <LuSlidersHorizontal aria-hidden="true" /> Session options
        </Button>
      </CardFooter>
    </Card>
  );
}

/** The session's mix as one thin bar in the language colour, with the biggest parts named below. */
function MixBar({ parts }: { parts: Array<{ type: QuestionType; count: number }> }) {
  const total = parts.reduce((a, p) => a + p.count, 0) || 1;
  const shades = [1, 0.72, 0.52, 0.38, 0.28, 0.2, 0.15, 0.12, 0.1];
  const sorted = [...parts].sort((a, b) => b.count - a.count);
  const shade = new Map(sorted.map((p, i) => [p.type, shades[Math.min(i, shades.length - 1)]]));
  const named = sorted.slice(0, 4);
  return (
    <div className="space-y-2.5" data-testid="mix-bar">
      <div className="flex h-2 gap-0.5 overflow-hidden rounded-full" aria-hidden="true">
        {parts.map((p) => (
          <span key={p.type} className="h-full bg-lang" style={{ width: `${(p.count / total) * 100}%`, opacity: shade.get(p.type) }} />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-[0.8125rem] text-muted-foreground">
        {named.map((p) => {
          const Icon = TYPE_ICONS[p.type];
          return (
            <li key={p.type} className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-lang" style={{ opacity: shade.get(p.type) }} aria-hidden="true" />
              <Icon className="size-3.5" aria-hidden="true" />
              <span>
                {TYPE_INFO[p.type].plural} <span className="font-medium text-foreground tabular-nums">{p.count}</span>
              </span>
            </li>
          );
        })}
        {sorted.length > named.length && <li>+ {plural(sorted.length - named.length, 'more kind')}</li>}
      </ul>
    </div>
  );
}

function Unfinished({ lang }: { lang: LanguageSummary }) {
  const s = lang.activeSession!;
  const pct = s.total ? (s.done / s.total) * 100 : 0;
  return (
    <Card role="region" aria-labelledby="today-title">
      <CardHeader>
        <CardTitle id="today-title" className="text-lg">
          Resume your session
        </CardTitle>
        <CardDescription>
          {count(s.done)} of {plural(s.total, 'question')} done.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Progress value={pct} aria-label="Session progress" />
      </CardContent>
      <CardFooter>
        <Button variant="lang" size="xl" className="w-full" onClick={() => navigate(`/study/${s.id}`)}>
          <LuRotateCcw aria-hidden="true" /> Resume session
        </Button>
      </CardFooter>
    </Card>
  );
}

/** A language without words: the bundled most frequent words, a starter set, or an import. */
function GetStarted({ lang }: { lang: LanguageSummary }) {
  const p = LANGUAGES[lang.code];
  const [loading, setLoading] = useState<'starter' | 'frequency' | null>(null);
  const load = async (kind: 'starter' | 'frequency') => {
    setLoading(kind);
    try {
      if (kind === 'starter') {
        const r = await post<{ stats: { created: number } }>('/api/import/starter', { language: lang.code });
        toast(`Added ${r.stats.created} starter words for ${p.name}.`, 'good');
      } else {
        const r = await post<{ stats: { created: number; merged: number } }>('/api/import/frequency-set', { language: lang.code });
        toast(`Added ${r.stats.created.toLocaleString('en')} of the most frequent ${p.name} words.`, 'good');
      }
      await loadBootstrap();
    } catch (err) {
      toast(err instanceof Error ? err.message : kind === 'starter' ? 'Could not load the starter set' : 'Could not load the most frequent words', 'bad');
    } finally {
      setLoading(null);
    }
  };
  return (
    <Empty role="region" aria-labelledby="today-title" className="border-solid bg-card shadow-xs">
      <EmptyHeader>
        <EmptyTitle id="today-title">Add words to start</EmptyTitle>
        <EmptyDescription>No {p.name} words yet. Load the most frequent words, a small starter set, or your own list.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        {lang.frequencySet && (
          <Button variant="lang" size="lg" className="w-full" disabled={!!loading} onClick={() => void load('frequency')}>
            <LuDownload aria-hidden="true" /> {loading === 'frequency' ? 'Adding words' : `Load the ${lang.frequencySet.words.toLocaleString('en')} most frequent words`}
          </Button>
        )}
        <div className="grid w-full grid-cols-2 gap-2">
          <Button variant="outline" disabled={!!loading} onClick={() => void load('starter')}>
            <LuDownload aria-hidden="true" /> {loading === 'starter' ? 'Loading' : 'Load a starter set'}
          </Button>
          <Button variant="outline" render={<Link to={`/import?lang=${lang.code}`} />}>
            <LuFileUp aria-hidden="true" /> Import a list
          </Button>
        </div>
      </EmptyContent>
    </Empty>
  );
}

/**
 * The last seven days as rings filling toward the daily goal (a day before the language was first studied stays
 * dotted), with the minutes in those days and the streak.
 */
function LastSevenDays({ lang, goal }: { lang: LanguageSummary; goal: number }) {
  const activity = lang.stats.activity14d;
  // The server's today (in the learner's timezone) is the last of the 14 days.
  const today = activity[activity.length - 1]?.day ?? new Date().toISOString().slice(0, 10);
  const days = activity.slice(-7);
  const first = lang.stats.firstStudyDay;
  const minutes = days.reduce((a, d) => a + (d.minutes ?? 0), 0);
  const met = days.filter((d) => d.minutes >= goal).length;
  const value = (d: (typeof days)[number]) => (first && d.day < first ? 'before you started' : `${d.minutes} min${d.day === today ? ' so far' : ''}`);
  return (
    <Card role="region" aria-labelledby="week-title" size="sm">
      <CardHeader>
        <CardTitle id="week-title">Last 7 days</CardTitle>
        <CardDescription>{minutes ? `${duration(minutes * 60_000)} · goal met on ${met} of 7 days` : `Your goal: ${goal} minutes a day`}</CardDescription>
        {lang.stats.streakDays > 0 && (
          <CardAction>
            <Badge variant="secondary" className="h-7 gap-1.5 px-2.5 text-[0.8125rem] font-semibold">
              <LuFlame className="text-warning" aria-hidden="true" />
              {lang.stats.streakDays}-day streak
            </Badge>
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        <ul className="grid grid-cols-7 gap-1" data-testid="week-chart" aria-label={`Minutes studied each of the last seven days against a ${goal}-minute goal`}>
          {days.map((d) => {
            const before = !!first && d.day < first;
            const frac = before ? 0 : Math.min(1, d.minutes / Math.max(1, goal));
            const isToday = d.day === today;
            return (
              <li key={d.day} className="flex flex-col items-center gap-1.5" title={`${dayText(d.day, { weekday: 'long' })}: ${value(d)}`}>
                <DayRing frac={frac} done={!before && d.minutes >= goal} dotted={before} today={isToday} />
                <span className={cn('text-xs', isToday ? 'font-semibold text-foreground' : 'text-muted-foreground')} aria-hidden="true">
                  {dayText(d.day, { weekday: 'narrow' })}
                </span>
                <span className="sr-only">
                  {dayText(d.day, { weekday: 'long' })}: {value(d)}
                </span>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

function DayRing({ frac, done, dotted, today }: { frac: number; done: boolean; dotted: boolean; today: boolean }) {
  const r = 15;
  const c = 2 * Math.PI * r;
  return (
    <span className="relative grid size-9 place-items-center" aria-hidden="true">
      <svg viewBox="0 0 36 36" className="size-9 -rotate-90">
        <circle cx="18" cy="18" r={r} fill="none" strokeWidth="3.5" className={cn(dotted ? 'stroke-border' : today ? 'stroke-lang/20' : 'stroke-muted')} strokeDasharray={dotted ? '2 3.2' : undefined} />
        {frac > 0 && <circle cx="18" cy="18" r={r} fill="none" strokeWidth="3.5" strokeLinecap="round" className="stroke-lang transition-[stroke-dasharray] duration-700" strokeDasharray={`${Math.max(0.04, frac) * c} ${c}`} />}
      </svg>
      {done && <LuCheck className="absolute size-4 text-lang" strokeWidth={3} />}
    </span>
  );
}

/** Words known, with how far it is to the next round number, leading to Progress. */
function WordsKnown({ lang, readingLevel }: { lang: LanguageSummary; readingLevel: string }) {
  // A bootstrap cached by an earlier version (an offline start after an update) has no such counts.
  const known = lang.stats.known ?? 0;
  const next = MILESTONES.find((m) => m > known) ?? known + 1000;
  const prev = [...MILESTONES].reverse().find((m) => m <= known) ?? 0;
  return (
    <Item variant="outline" className="rounded-xl shadow-xs" render={<Link to="/progress" />}>
      <ItemMedia variant="icon">
        <LuGraduationCap aria-hidden="true" />
      </ItemMedia>
      <ItemContent className="gap-1.5">
        <ItemTitle className="text-base">{plural(known, 'word')} known</ItemTitle>
        <Progress value={((known - prev) / Math.max(1, next - prev)) * 100} aria-label={`Toward ${next.toLocaleString('en')} words`} className="h-1.5" />
        <ItemDescription>
          {(next - known).toLocaleString('en')} to {next.toLocaleString('en')} · {count(lang.stats.learning ?? 0)} being learned · reading {readingLevel}
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        <LuChevronRight className="size-5 text-muted-foreground" aria-hidden="true" />
      </ItemActions>
    </Item>
  );
}

/** The other languages with words, to switch to (what is due, Resume for an open session); the rest in one row. */
function OtherLanguages({ langs }: { langs: LanguageSummary[] }) {
  const open = (code: LanguageCode) => {
    setActiveLanguage(code);
    window.scrollTo({ top: 0 });
  };
  const started = langs.filter((l) => l.stats.total > 0);
  const empty = langs.filter((l) => l.stats.total === 0);
  return (
    <section aria-labelledby="langs-title" className="mt-10">
      <h2 id="langs-title" className="mb-2 px-1 text-base font-semibold tracking-tight">
        Other languages
      </h2>
      <div className="divide-y rounded-xl border bg-card shadow-xs">
        {started.map((l) => {
          const p = LANGUAGES[l.code];
          const s = l.stats;
          return (
            <div key={l.code} data-lang={l.code} className="flex items-center gap-3 px-4 py-2.5">
              <button className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-lg text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50" onClick={() => open(l.code)}>
                <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-lang-soft text-xl leading-none" aria-hidden="true">
                  {p.flag}
                </span>
                <span className="min-w-0">
                  <span className="sr-only">Switch to </span>
                  <span className="word block truncate text-lg" lang={l.code}>
                    {p.nativeName}
                  </span>
                  <span className="hint block truncate">{[l.activeSession ? 'unfinished session' : `${count(s.due)} due`, `${count(s.known ?? 0)} known`].join(' · ')}</span>
                </span>
              </button>
              {l.activeSession && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setActiveLanguage(l.code);
                    navigate(`/study/${l.activeSession!.id}`);
                  }}
                >
                  Resume
                </Button>
              )}
            </div>
          );
        })}
        {empty.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 px-4 py-3">
            <span className="mr-1 flex items-center gap-1.5 text-sm text-muted-foreground">
              <LuPlus className="size-4" aria-hidden="true" /> Add a language
            </span>
            {empty.map((l) => (
              <Button key={l.code} data-lang={l.code} variant="outline" size="sm" className="rounded-full" onClick={() => open(l.code)} aria-label={`Switch to ${LANGUAGES[l.code].name}`}>
                <span aria-hidden="true">{LANGUAGES[l.code].flag}</span>
                <span className="word">{LANGUAGES[l.code].nativeName}</span>
              </Button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
