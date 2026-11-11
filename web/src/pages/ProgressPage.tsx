// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
/**
 * Progress (/progress; /stats, /stats/:code and /progress/:code lead here, a language in the path becoming the active
 * one): for the active language, in this order — your words (known, being learned, not started; words known over the
 * last 90 days; the most frequent words; the next milestone), the period (7 days, 30 days, all time) of the two sections
 * after it, your skills, study time against the daily goal, reviews coming up, the words that need work, and more detail
 * in closed sections. Figures: GET /api/stats/progress/:code and …/period (server/services/progress.ts).
 */
import { useEffect, useState, type ReactNode } from 'react';
import { LuChartNoAxesColumn, LuChevronRight, LuFlame, LuMinus, LuTrendingDown, LuTrendingUp } from 'react-icons/lu';
import { LANGUAGES, LANGUAGE_CODES, type LanguageCode } from '../../../shared/languages.ts';
import { SKILL_NAMES, trendText, type ProgressOverview, type ProgressPeriod, type ProgressSkill, type ProgressSkillKey } from '../../../shared/progress.ts';
import type { Focus } from '../../../shared/settings.ts';
import { DEFAULT_STATS_WINDOW, STATS_WINDOWS, type StatsWindow } from '../../../shared/stats.ts';
import { addDays } from '../../../shared/time.ts';
import { CountBars, GoalBars, GoalKey, KnownLine, ShareBar } from '../components/charts.tsx';
import { Empty, ErrorNote, PageHeader, PageLoading } from '../components/ui.tsx';
import { Badge } from '../components/ui/badge.tsx';
import { Progress as Bar, Skeleton } from '../components/ui/basics.tsx';
import { Button } from '../components/ui/button.tsx';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '../components/ui/card.tsx';
import { ToggleGroup, ToggleGroupItem } from '../components/ui/controls.tsx';
import { cn } from '../lib/utils.ts';
import { ApiError, get } from '../lib/api.ts';
import { count, dayText, duration, pct, plural } from '../lib/format.ts';
import { Link, navigate, useLocation } from '../lib/router.tsx';
import { setActiveLanguage, toast, useApp } from '../lib/store.ts';
import { Word } from './session/Exercise.tsx';
import { SKILL_ICONS } from './session/QuestionType.tsx';
import { startSession } from './session/runtime.ts';
import { MoreDetail } from './ProgressDetail.tsx';

const WINDOW_LABELS: Record<StatsWindow, string> = { '7': '7 days', '30': '30 days', all: 'All time' };
/** "answers right, last 30 days" */
const WINDOW_SPANS: Record<StatsWindow, string> = { '7': 'last 7 days', '30': 'last 30 days', all: 'all time' };
/** "Weakest this month: sentences." */
const WEAKEST_WHEN: Record<StatsWindow, string> = { '7': 'this week', '30': 'this month', all: 'so far' };

/** Where each skill card leads: a Practice page, or (for the skills only sessions train) a session with that focus. */
const PRACTICE: Record<ProgressSkillKey, { to?: string; focus?: Focus; action: string }> = {
  words: { focus: 'balanced', action: 'Start a session' },
  listening: { focus: 'listening', action: 'Start a session with more listening' },
  writing: { to: '/practice/writing', action: 'Write sentences' },
  grammar: { to: '/practice/forms', action: 'Practice forms' },
  sentences: { to: '/practice/cloze', action: 'Practice sentence gaps' },
  pictures: { to: '/practice/identify', action: 'Practice with pictures' },
  speaking: { to: '/practice/read', action: 'Practice saying sentences' },
  reading: { to: '/practice/comprehension', action: 'Read a text' },
};

const errorText = (e: unknown) => (e instanceof ApiError && e.isNetwork ? 'Progress needs a connection to your server.' : e instanceof Error ? e.message : String(e));

export function ProgressPage() {
  const { path } = useLocation();
  const booted = useApp((s) => !!s.boot);
  const active = useApp((s) => s.boot?.settings.activeLanguage ?? 'es') as LanguageCode;
  const fromPath = path.split('/')[2] as LanguageCode | undefined;
  const pathLanguage = fromPath && LANGUAGE_CODES.includes(fromPath) ? fromPath : null;
  const language = pathLanguage ?? active;
  const goalMinutes = useApp((s) => s.boot?.languageSettings[language]?.dailyGoalMinutes ?? 20);
  // A language in the path (an old /stats/pl link) becomes the active one, and the address becomes /progress.
  useEffect(() => {
    if (!booted) return;
    if (pathLanguage && pathLanguage !== active) setActiveLanguage(pathLanguage);
    if (path !== '/progress') navigate('/progress', { replace: true });
  }, [booted, path]);

  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const onChange = () => setRefresh((n) => n + 1);
    window.addEventListener('vb:data-changed', onChange);
    return () => window.removeEventListener('vb:data-changed', onChange);
  }, []);

  const [overview, setOverview] = useState<ProgressOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setError(null);
    get<ProgressOverview>(`/api/stats/progress/${language}`)
      .then((d) => live && setOverview(d))
      .catch((e) => live && setError(errorText(e)));
    return () => {
      live = false;
    };
  }, [language, refresh]);

  // The period of the skills and study time, kept while switching languages.
  const [span, setSpan] = useState<StatsWindow>(DEFAULT_STATS_WINDOW);
  const [period, setPeriod] = useState<ProgressPeriod | null>(null);
  const [periodError, setPeriodError] = useState<string | null>(null);
  const [periodLoading, setPeriodLoading] = useState(true);
  useEffect(() => {
    let live = true;
    setPeriodLoading(true);
    setPeriodError(null);
    get<ProgressPeriod>(`/api/stats/progress/${language}/period?window=${span}`)
      .then((d) => live && setPeriod(d))
      .catch((e) => live && setPeriodError(errorText(e)))
      .finally(() => live && setPeriodLoading(false));
    return () => {
      live = false;
    };
  }, [language, span, refresh, goalMinutes]);

  const o = overview?.language === language ? overview : null;
  // While another period loads, the figures shown stay in place, dimmed, so nothing jumps.
  const p = period?.language === language ? period : null;
  const lang = LANGUAGES[language];
  const nothing = o && o.words.known + o.words.learning + o.words.notStarted === 0;

  return (
    <div data-lang={language} className="mx-auto max-w-3xl">
      <PageHeader title="Progress" description={`How your ${lang.name} is growing.`} />
      {error && !o && <ErrorNote error={error} onRetry={() => setRefresh((n) => n + 1)} />}
      {!o && !error && <PageLoading label="Loading your progress" />}
      {nothing && (
        <Empty
          icon={<LuChartNoAxesColumn />}
          title={`No ${lang.name} words yet`}
          action={
            <Button render={<Link to="/" />}>
              Add words on Today
            </Button>
          }
        >
          Load the most frequent words, a starter set or your own list. Your progress shows here once you study.
        </Empty>
      )}
      {o && !nothing && (
        <div className="flex flex-col gap-5">
          <YourWords w={o.words} language={language} />
          <section aria-labelledby="skills-title" className="flex flex-col gap-3" data-testid="skills">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-1">
              <h2 id="skills-title" className="text-base font-semibold tracking-tight">
                Your skills
              </h2>
              <ToggleGroup type="single" variant="outline" size="sm" value={span} onValueChange={(v) => v && setSpan(v as StatsWindow)} aria-label="Time period">
                {STATS_WINDOWS.map((w) => (
                  <ToggleGroupItem key={w} value={w} className="px-3">
                    {WINDOW_LABELS[w]}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
            {periodError && !p && <ErrorNote error={periodError} onRetry={() => setRefresh((n) => n + 1)} />}
            {!p && !periodError && (
              <div className="grid grid-cols-2 gap-2.5" role="status" aria-label="Loading your skills">
                {Array.from({ length: 6 }, (_, i) => (
                  <Skeleton key={i} className="h-28 rounded-xl" />
                ))}
              </div>
            )}
            {p && (
              <div className={cn('flex flex-col gap-3 transition-opacity', periodLoading && 'opacity-60')} aria-busy={periodLoading}>
                <Skills p={p} language={language} />
              </div>
            )}
          </section>
          {p && (
            <div className={cn('transition-opacity', periodLoading && 'opacity-60')} aria-busy={periodLoading}>
              <StudyTime p={p} />
            </div>
          )}
          <ComingUp c={o.comingUp} />
          <NeedWork words={o.needWork} language={language} />
          <MoreDetail language={language} goalMinutes={goalMinutes} />
        </div>
      )}
    </div>
  );
}

function Tile({ id, title, aside, children, className }: { id: string; title: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Card aria-labelledby={id} role="region" className="gap-4">
      <CardHeader>
        <CardTitle>
          <h2 id={id}>{title}</h2>
        </CardTitle>
        {aside && <CardAction>{aside}</CardAction>}
      </CardHeader>
      <CardContent className={cn('flex flex-col gap-3', className)}>{children}</CardContent>
    </Card>
  );
}

/** "26%": rounded down, so a share short of all never shows as 100%. */
const shareText = (part: number, whole: number) => `${Math.floor((100 * part) / whole)}%`;

function milestoneLine(m: ProgressOverview['words']['milestone']): string | null {
  if (!m) return null;
  const when = m.weeks == null ? '' : m.weeks > 52 ? ', more than a year at this pace' : m.weeks === 1 ? ', about a week at this pace' : `, about ${m.weeks} weeks at this pace`;
  return `Next milestone: ${count(m.target)} words known${when}.`;
}

function YourWords({ w, language }: { w: ProgressOverview['words']; language: LanguageCode }) {
  const h = w.history.known;
  const first = h[0] ?? 0;
  const last = h[h.length - 1] ?? 0;
  const trend = first === last ? `steady at ${count(last)}` : `${first < last ? 'rising' : 'falling'} from ${count(first)} to ${count(last)}`;
  const milestone = milestoneLine(w.milestone);
  const gained = last - first;
  return (
    <Card aria-labelledby="words-title" role="region" className="gap-4">
      <CardContent className="flex flex-col gap-4">
        <h2 id="words-title" className="sr-only">
          Your words
        </h2>
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2" data-testid="word-counts">
          <p className="flex items-baseline gap-2">
            <span className="text-[2.75rem] leading-none font-semibold tracking-tight tabular-nums">{count(w.known)}</span>
            <span className="text-muted-foreground">{w.known === 1 ? 'word known' : 'words known'}</span>
          </p>
          <p className="flex gap-4 text-sm text-muted-foreground">
            <span>
              <span className="font-semibold text-foreground tabular-nums">{count(w.learning)}</span> being learned
            </span>
            <span>
              <span className="font-semibold text-foreground tabular-nums">{count(w.notStarted)}</span> not started
            </span>
          </p>
        </div>
        {gained > 0 && (
          <Badge variant="success" className="w-fit gap-1">
            <LuTrendingUp aria-hidden="true" /> {count(gained)} more than {h.length} days ago
          </Badge>
        )}
        <KnownLine
          values={h}
          days={h.map((_, i) => dayText(addDays(w.history.firstDay, i), { weekday: 'short', month: 'short', day: 'numeric' }))}
          label={`Words known over the last ${h.length} days, ${trend}`}
          axis={{ start: dayText(w.history.firstDay), middle: `Words known, ${h.length} days`, end: 'today' }}
        />
        {(w.common || milestone) && (
          <div className="flex flex-col gap-1.5 border-t pt-4" data-lang={language}>
            {w.common && (
              <>
                <div className="flex flex-wrap justify-between gap-x-3 text-[0.9375rem]">
                  <span>The {count(w.common.size)} most common words</span>
                  <span className="font-semibold tabular-nums">{shareText(w.common.known, w.common.size)} known</span>
                </div>
                <ShareBar value={w.common.known / w.common.size} label={`${shareText(w.common.known, w.common.size)} of the ${count(w.common.size)} most common words known: ${count(w.common.known)} of ${count(w.common.size)}`} />
              </>
            )}
            {milestone && <p className="mt-1 text-sm text-muted-foreground">{milestone}</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Skills({ p, language }: { p: ProgressPeriod; language: LanguageCode }) {
  const [busy, setBusy] = useState<ProgressSkillKey | null>(null);
  const start = async (key: ProgressSkillKey, focus: Focus) => {
    setBusy(key);
    try {
      const id = await startSession({ language, quick: true, focus });
      navigate(`/study/${id}`);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'active_session_exists') navigate(`/study/${(err.details as { sessionId: string }).sessionId}`);
      else toast(err instanceof Error ? err.message : 'Could not start a session', 'bad');
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {p.skills.map((s) => (
          <SkillCard key={s.key} s={s} period={p.window} busy={busy === s.key} onStart={(focus) => void start(s.key, focus)} />
        ))}
      </div>
      <p className="px-1 text-sm text-muted-foreground">
        The share of answers right, {WINDOW_SPANS[p.window]}. Tap a skill to practice it.{p.weakest ? ` Weakest ${WEAKEST_WHEN[p.window]}: ${SKILL_NAMES[p.weakest].toLowerCase()}.` : ''}
      </p>
    </>
  );
}

/** "1,240 answers", "430 typed answers", "48 sentences". */
function answersText(s: ProgressSkill): string {
  if (s.key === 'writing') return `${count(s.answers)} typed answer${s.answers === 1 ? '' : 's'}`;
  if (s.key === 'speaking') return plural(s.answers, 'sentence');
  return plural(s.answers, 'answer');
}

function SkillCard({ s, period, busy, onStart }: { s: ProgressSkill; period: StatsWindow; busy: boolean; onStart: (focus: Focus) => void }) {
  const go = PRACTICE[s.key];
  const name = SKILL_NAMES[s.key];
  const reading = s.reading;
  const none = period === 'all' ? 'No answers yet' : `No answers in the last ${period} days`;
  const trend =
    s.trend == null
      ? null
      : s.trend > 1
        ? { text: trendText(s.trend), short: trendText(s.trend), variant: 'success' as const, Icon: LuTrendingUp }
        : s.trend < -1
          ? { text: trendText(s.trend), short: trendText(s.trend), variant: 'warning' as const, Icon: LuTrendingDown }
          : { text: trendText(s.trend), short: 'steady', variant: 'secondary' as const, Icon: LuMinus };
  const texts = reading && reading.levelTexts > 0 ? `${count(reading.levelRead)} of ${count(reading.levelTexts)} ${reading.level} texts read` : null;
  // Reading leads with the level; its share right covers text questions and sentences read.
  const value = reading ? reading.level : s.accuracy == null ? '—' : pct(s.accuracy);
  const answers = !s.answers ? none : reading ? `${pct(s.accuracy)} right, ${plural(s.answers, 'answer')}` : answersText(s);
  const summary = [reading ? `level ${reading.level}` : s.accuracy != null ? `${pct(s.accuracy)} right` : null, texts, trend?.text, answers.charAt(0).toLowerCase() + answers.slice(1)].filter(Boolean).join(', ');
  const Icon = SKILL_ICONS[s.key];
  const body = (
    <>
      <span className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
          {Icon && <Icon className="size-4 shrink-0 text-lang" aria-hidden="true" />}
          <span className="truncate">{name}</span>
        </span>
        <LuChevronRight className="size-4 shrink-0 text-muted-foreground/50" aria-hidden="true" />
      </span>
      <span className={cn('text-[1.75rem] leading-tight font-semibold tracking-tight tabular-nums', value === '—' && 'text-muted-foreground')}>{value}</span>
      {reading && reading.levelTexts > 0 && (
        <span className="flex flex-col gap-1">
          <Bar value={(100 * reading.levelRead) / reading.levelTexts} className="h-1.5" aria-hidden="true" />
          <span className="text-xs text-muted-foreground">{texts}</span>
        </span>
      )}
      {trend && (
        <Badge variant={trend.variant} className="w-fit gap-1 px-1.5 font-medium">
          <trend.Icon aria-hidden="true" />
          {trend.short}
        </Badge>
      )}
      <span className="mt-auto pt-1 text-xs text-muted-foreground">{answers}</span>
    </>
  );
  const className =
    'flex min-h-[7.75rem] flex-col gap-1.5 rounded-xl border bg-card p-3.5 text-left shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-60 [@media(hover:hover)]:hover:border-foreground/25 [@media(hover:hover)]:hover:bg-accent/40';
  const label = `${name}: ${summary}. ${go.action}.`;
  if (go.to) {
    return (
      <Link to={go.to} className={className} aria-label={label}>
        {body}
      </Link>
    );
  }
  return (
    <button type="button" className={className} aria-label={label} disabled={busy} aria-busy={busy} onClick={() => onStart(go.focus!)}>
      {body}
    </button>
  );
}

/**
 * "8 h 12 min in the last 30 days, 16 min a day on average. Goal met on 16 of 30 days." A period that began before the
 * language was first studied says so: "… in the 3 days since you started on Nov 6, …".
 */
function timeSummary(t: ProgressPeriod['time'], window: StatsWindow): string {
  if (!t.begun) return `No study time yet. Your goal: ${t.goalMinutes} minutes a day.`;
  const goal = t.goal.of ? `Goal met on ${t.goal.met} of ${plural(t.goal.of, 'day')}.` : `Your goal: ${t.goalMinutes} minutes a day.`;
  if (t.unit === 'week') return `${duration(t.totalMs)} since ${dayText(t.from)}, ${t.averageMinutes} min a day on average. ${goal}`;
  if (t.shortened && t.days === 1) return `${t.totalMs ? duration(t.totalMs) : 'No study time yet'} today, the first day you studied. ${goal}`;
  const span = t.shortened ? `in the ${t.days} days since you started on ${dayText(t.from)}` : `in the last ${window} days`;
  if (!t.totalMs) return `No study time ${span}.`;
  return `${duration(t.totalMs)} ${span}, ${t.averageMinutes} min a day on average. ${goal}`;
}

function StudyTime({ p }: { p: ProgressPeriod }) {
  const t = p.time;
  const daily = t.unit === 'day';
  const bars = t.bars.map((b) => ({
    key: b.day,
    minutes: b.minutes,
    day: daily ? dayText(b.day, { weekday: 'short', month: 'short', day: 'numeric' }) : `Week of ${dayText(b.day)}`,
    value: daily ? `${b.minutes} min` : `${b.minutes} min a day`,
  }));
  // Like the summary, a period cut short by the first day studied says so.
  const which = !t.shortened ? `on each of the last ${t.bars.length} days` : t.days === 1 ? 'today, the first day you studied' : `on each of the ${t.days} days since you started on ${dayText(t.from)}`;
  const label = daily
    ? `Minutes studied ${which}; the dashed line is the ${t.goalMinutes}-minute daily goal`
    : `Minutes studied a day, averaged per week, since ${dayText(t.from)}; the dashed line is the ${t.goalMinutes}-minute daily goal`;
  return (
    <Tile
      id="time-title"
      title="Study time"
      aside={
        t.streakDays ? (
          <Badge variant="soft" className="gap-1">
            <LuFlame aria-hidden="true" /> {t.streakDays}-day streak
          </Badge>
        ) : undefined
      }
    >
      {/* Nothing studied in this language yet: no chart of empty days. Keyed by period, so a new period reads out its
          latest day rather than the place picked in the last one. */}
      {t.begun && (
        <GoalBars
          key={p.window}
          bars={bars}
          goal={t.goalMinutes}
          label={label}
          columns={daily ? ['Day', 'Minutes studied'] : ['Week', 'Minutes a day']}
          height={100}
          axis={{ start: t.bars.length ? dayText(t.bars[0].day) : '', end: daily ? 'today' : 'this week' }}
          testId="study-time-chart"
        />
      )}
      <p className="text-[0.9375rem]">{timeSummary(t, p.window)}</p>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
        <GoalKey>Daily goal: {t.goalMinutes} min</GoalKey>
        <Link to="/settings/learning" className="rounded underline decoration-dotted underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-ring">
          Change the goal
        </Link>
      </p>
    </Tile>
  );
}

function ComingUp({ c }: { c: ProgressOverview['comingUp'] }) {
  const short = c.days.map((d, i) => (i === 0 ? 'Today' : dayText(d.day, { weekday: 'short' })));
  const long = c.days.map((d, i) => (i === 0 ? 'today' : dayText(d.day, { weekday: 'long' })));
  const minutes = c.minutesPerDay < 1 ? 'Less than a minute' : `About ${plural(c.minutesPerDay, 'minute')}`;
  return (
    <Tile id="coming-title" title="Coming up">
      <CountBars
        bars={c.days.map((d, i) => ({ key: d.day, value: d.due, label: short[i], title: `${dayText(d.day, { weekday: 'long', month: 'short', day: 'numeric' })}: ${plural(d.due, 'review')}` }))}
        label={`Reviews due each day this week: ${c.days.map((d, i) => `${long[i]} ${d.due}`).join(', ')}`}
      />
      <p className="text-[0.9375rem]">{c.total ? `${plural(c.total, 'review')} this week. ${minutes} a day keeps you up to date.` : 'Nothing is due in the next 7 days.'}</p>
      <p className="hint">A due word is reviewed by any question that tests it, in a session or on the Practice pages.</p>
    </Tile>
  );
}

function NeedWork({ words, language }: { words: ProgressOverview['needWork']; language: LanguageCode }) {
  return (
    <Tile id="work-title" title="Words that need work" className="gap-2">
      {words.length === 0 ? (
        <p className="text-muted-foreground">No words missed in the last 30 days.</p>
      ) : (
        <>
          <ul className="-mx-2 divide-y">
            {words.map((m) => (
              <li key={m.entryId}>
                <Link
                  to={`/words/${m.entryId}`}
                  className="flex items-center justify-between gap-3 rounded-lg px-2 py-2.5 outline-none focus-visible:ring-2 focus-visible:ring-ring [@media(hover:hover)]:hover:bg-accent/60"
                >
                  <span className="flex min-w-0 flex-col">
                    <span lang={language}>
                      <Word text={m.lemma} className="text-[1.1875rem] leading-snug" />
                    </span>
                    <span className="truncate text-sm text-muted-foreground">{m.gloss}</span>
                  </span>
                  <span className="shrink-0 text-sm whitespace-nowrap text-muted-foreground tabular-nums">
                    missed {m.misses} of {m.answers}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <Button variant="outline" size="lg" className="mt-2 w-full" render={<Link to={`/practice/cloze?entries=${words.map((m) => m.entryId).join(',')}`} />}>
            Practice these {words.length}
          </Button>
          <p className="hint text-center">Sentence gaps with these words. Each answer counts toward the word’s memory.</p>
        </>
      )}
    </Tile>
  );
}
