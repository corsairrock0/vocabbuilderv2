// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
/**
 * Progress → More detail: the detailed statistics in closed sections (memory strength, accuracy by question type, words
 * by frequency, the 90-day study history), from GET /api/stats/language/:code (server/services/stats.ts). Nothing is
 * fetched until one of them is opened.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { SKILL_LABELS } from '../../../shared/exercises.ts';
import type { LanguageCode } from '../../../shared/languages.ts';
import { listJoin } from '../../../shared/stats.ts';
import type { LanguageStats } from '../../../shared/types.ts';
import { GoalBars } from '../components/charts.tsx';
import { ErrorNote, Meter } from '../components/ui.tsx';
import { Spinner } from '../components/ui/basics.tsx';
import { Button } from '../components/ui/button.tsx';
import { Card } from '../components/ui/card.tsx';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table.tsx';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger, Collapsible, CollapsibleContent, CollapsibleTrigger } from '../components/ui/tabs.tsx';
import { ApiError, get } from '../lib/api.ts';
import { count, dayText, duration, pct, plural } from '../lib/format.ts';

interface Detailed {
  language: LanguageCode;
  summary: LanguageStats;
  skills: Array<{ skill: string; itemsWithEvidence: number; attempts: number; accuracy: number | null; itemsDemonstratedAfterDelay: number }>;
  byKind: Array<{ kind: string; label: string; attempts: number; accuracy: number | null }>;
  frequencyTiers: Array<{ label: string; total: number; introduced: number; learned: number; known: number }>;
  unrankedEntries: number;
  /** Per day: session answers (attempts; reviews among them), practice answers, reading texts and their questions. */
  history: Array<{ day: string; minutes: number; reviews: number; introduced: number; attempts: number; accuracy: number | null; practice: number; texts: number; questions: number; answers: number }>;
  retention: { estimatedReceptive: number | null; estimatedProductive: number | null; cardsInReview: number; observedDelayedRecall: number | null; observedReviews: number; note: string };
  efficiency: {
    studyHours30d: number;
    successfulDelayedRecallsPerHour: number | null;
    reviewsPerDay30d: number;
    sessions30d: number;
    averageSessionMinutes: number | null;
    introduced30d: number;
    practice30d: number;
    texts30d: number;
  };
}

type Day = Detailed['history'][number];

export function MoreDetail({ language, goalMinutes }: { language: LanguageCode; goalMinutes: number }) {
  const [data, setData] = useState<Detailed | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Fetched once a section is first opened, then kept (and fetched again for another language).
  const [wanted, setWanted] = useState(false);
  useEffect(() => {
    setData(null);
    setError(null);
  }, [language]);
  useEffect(() => {
    if (!wanted || data?.language === language) return;
    let live = true;
    get<Detailed>(`/api/stats/language/${language}?days=90`)
      .then((d) => live && setData(d))
      .catch((e) => live && setError(e instanceof ApiError && e.isNetwork ? 'These figures need a connection to your server.' : e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [wanted, language, data]);
  const shown = data?.language === language ? data : null;
  const body = (render: (d: Detailed) => ReactNode) =>
    error ? (
      <ErrorNote error={error} />
    ) : shown ? (
      render(shown)
    ) : (
      <div className="flex items-center gap-2 py-2 text-muted-foreground">
        <Spinner label="Loading" /> Loading
      </div>
    );

  return (
    <section aria-labelledby="more-title" className="flex flex-col gap-3">
      <h2 id="more-title" className="px-1 text-base font-semibold tracking-tight">
        More detail
      </h2>
      <Card className="gap-0 py-0">
        <Accordion type="multiple" onValueChange={(open) => open.length > 0 && setWanted(true)}>
          <Detail value="memory" title="Memory strength" sub="how likely you are to recall your words now">
            {body((d) => (
              <MemoryStrength d={d} />
            ))}
          </Detail>
          <Detail value="types" title="Accuracy by question type" sub="choosing, typing, listening, speaking…">
            {body((d) => (
              <ByQuestionType d={d} />
            ))}
          </Detail>
          <Detail value="frequency" title="Words by frequency" sub="how much of each frequency band you know">
            {body((d) => (
              <ByFrequency d={d} />
            ))}
          </Detail>
          <Detail value="history" title="Study history" sub="every day of the last 90 days">
            {body((d) => (
              <StudyHistory d={d} goalMinutes={goalMinutes} />
            ))}
          </Detail>
        </Accordion>
      </Card>
    </section>
  );
}

function Detail({ value, title, sub, children }: { value: string; title: string; sub: string; children: ReactNode }) {
  return (
    <AccordionItem value={value} className="px-5">
      <AccordionTrigger className="items-center py-3.5 hover:no-underline">
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[0.9375rem] font-semibold">{title}</span>
          <span className="text-sm font-normal text-muted-foreground">{sub}</span>
        </span>
      </AccordionTrigger>
      <AccordionContent className="pb-5 text-[0.9375rem]">{children}</AccordionContent>
    </AccordionItem>
  );
}

function MemoryStrength({ d }: { d: Detailed }) {
  const s = d.summary;
  return (
    <div className="space-y-6">
      <div>
        <p className="mb-4 text-sm text-muted-foreground">{d.retention.note}</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Big value={pct(d.retention.estimatedReceptive)} label="likely to recognise a word now" hint="an estimate from your reviews" />
          <Big value={pct(d.retention.estimatedProductive)} label="likely to recall a word now" hint="an estimate from your reviews" />
          <Big value={pct(d.retention.observedDelayedRecall)} label="right in reviews on a later day" hint={`${plural(d.retention.observedReviews, 'review')}, last 30 days`} />
        </div>
        <p className="hint mt-3">{plural(d.retention.cardsInReview, 'word')} in review.</p>
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Big value={s.introduced} label="words met" />
        <Big value={s.learned} label="learned" hint="right again on a later day" />
        <Big value={s.mature} label="well known" hint="the memory lasts 21 days or more" />
        <Big value={s.mastered} label="mastered" hint="recognising and recalling both last 21 days or more" />
      </div>
      <p className="hint">Vocabulary counts measure progress, not overall proficiency.</p>
    </div>
  );
}

function ByQuestionType({ d }: { d: Detailed }) {
  const skills = d.skills.filter((x) => x.attempts > 0);
  if (!d.byKind.length) return <p className="text-muted-foreground">Study a session to see how you do with each kind of question.</p>;
  return (
    <div className="space-y-6">
      <div>
        <p className="mb-2 text-sm text-muted-foreground">Study sessions, last 90 days: answers and the share right.</p>
        <Table className="text-[0.9375rem]">
          <TableHeader className="sr-only">
            <TableRow>
              <TableHead>Question type</TableHead>
              <TableHead>Answers</TableHead>
              <TableHead>Right</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {d.byKind.map((k) => (
              <TableRow key={k.kind}>
                <TableCell className="px-0">{k.label}</TableCell>
                <TableCell className="text-right text-muted-foreground tabular-nums">{count(k.attempts)}</TableCell>
                <TableCell className="w-16 px-0 text-right font-semibold tabular-nums">{pct(k.accuracy)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {skills.length > 0 && (
        <div>
          <h4 className="mb-1 font-semibold">By ability</h4>
          <p className="mb-3 text-sm text-muted-foreground">Every session answer so far, and how many words show the ability on a later day than first seen.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {skills.map((x) => (
              <Meter
                key={x.skill}
                label={SKILL_LABELS[x.skill as keyof typeof SKILL_LABELS] ?? x.skill.replace('_assisted', ' (assisted)')}
                value={x.accuracy}
                sub={`${plural(x.itemsDemonstratedAfterDelay, 'word')} on a later day, ${plural(x.attempts, 'answer')}`}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ByFrequency({ d }: { d: Detailed }) {
  if (!d.frequencyTiers.length) return <p className="text-muted-foreground">Load the most frequent words, or import a frequency list, to see how much of each band you know.</p>;
  return (
    <div>
      <p className="mb-3 text-sm text-muted-foreground">Known: learned or marked as known. The lighter part is being learned.</p>
      <ul className="space-y-3">
        {d.frequencyTiers.map((t) => {
          const learning = Math.max(0, t.introduced - t.learned);
          return (
            <li key={t.label}>
              <div className="flex justify-between gap-3 text-sm">
                <span>Ranks {t.label}</span>
                <span className="text-muted-foreground">
                  {count(t.known)} known{learning ? `, ${count(learning)} being learned` : ''} of {count(t.total)}
                </span>
              </div>
              <div className="mt-1 flex h-2 gap-0.5 overflow-hidden rounded-full bg-lang/15" role="img" aria-label={`Ranks ${t.label}: ${count(t.known)} known and ${count(learning)} being learned of ${count(t.total)} words`}>
                <div className="bg-lang" style={{ width: `${(t.known / t.total) * 100}%` }} />
                <div className="bg-lang opacity-40" style={{ width: `${(learning / t.total) * 100}%` }} />
              </div>
            </li>
          );
        })}
      </ul>
      {d.unrankedEntries > 0 && <p className="hint mt-3">{plural(d.unrankedEntries, 'word')} have no rank.</p>}
    </div>
  );
}

function StudyHistory({ d, goalMinutes }: { d: Detailed; goalMinutes: number }) {
  const n = d.history.length;
  const bars = (amount: (x: Day) => number, value: (x: Day) => string) =>
    d.history.map((x) => ({ key: x.day, minutes: amount(x), day: dayText(x.day, { weekday: 'short', month: 'short', day: 'numeric' }), value: value(x) }));
  const axis = { start: dayText(d.history[0].day), end: 'today' };
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">{periodLine(d.history)}</p>
      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <p className="mb-1 text-sm text-muted-foreground">Minutes studied per day (the dashed line is your daily goal)</p>
          <GoalBars
            bars={bars((x) => x.minutes, (x) => `${x.minutes} min`)}
            goal={goalMinutes}
            height={72}
            columns={['Day', 'Minutes studied']}
            axis={axis}
            label={`Minutes studied per day over ${n} days, against the ${goalMinutes}-minute daily goal`}
          />
        </div>
        <div>
          <p className="mb-1 text-sm text-muted-foreground">Answers per day: sessions, practice and reading</p>
          <GoalBars bars={bars((x) => x.answers, answersValue)} height={72} columns={['Day', 'Answers']} axis={axis} label={`Answers per day over ${n} days, in sessions, practice and reading`} />
        </div>
        <div>
          <p className="mb-1 text-sm text-muted-foreground">Reviews per day</p>
          <GoalBars bars={bars((x) => x.reviews, (x) => plural(x.reviews, 'review'))} height={72} columns={['Day', 'Reviews']} axis={axis} label={`Reviews per day over ${n} days`} />
        </div>
      </div>
      <DayTable days={d.history} />
      <div>
        <h4 className="mb-2 font-semibold">Study efficiency (30 days)</h4>
        <ul className="space-y-1 text-[0.95rem]">
          <li>
            {d.efficiency.studyHours30d.toFixed(1)} hours of study, sessions and practice together; {plural(d.efficiency.sessions30d, 'session')}
            {d.efficiency.averageSessionMinutes ? ` of about ${Math.round(d.efficiency.averageSessionMinutes)} min each` : ''}.
          </li>
          <li>{d.efficiency.successfulDelayedRecallsPerHour != null ? `${d.efficiency.successfulDelayedRecallsPerHour.toFixed(0)} successful delayed recalls per study hour.` : 'Not enough study time yet for recall-per-hour figures.'}</li>
          <li>
            {listJoin([
              `${d.efficiency.reviewsPerDay30d.toFixed(1)} reviews per day`,
              plural(d.efficiency.introduced30d, 'new word'),
              plural(d.efficiency.practice30d, 'practice answer'),
              `${plural(d.efficiency.texts30d, 'text')} read`,
            ])}
            .
          </li>
        </ul>
      </div>
    </div>
  );
}

/** A day's answers: "46 answers: 30 in sessions (12 reviews), 13 practice, 3 reading questions (1 text)". */
function answersValue(d: Day): string {
  if (!d.answers) return 'no answers';
  const parts = [`${count(d.attempts)} in sessions${d.reviews ? ` (${plural(d.reviews, 'review')})` : ''}`];
  if (d.practice) parts.push(`${count(d.practice)} practice`);
  if (d.texts) parts.push(`${plural(d.questions, 'reading question')} (${plural(d.texts, 'text')})`);
  return `${plural(d.answers, 'answer')}: ${parts.join(', ')}`;
}

/** The period's totals, each answer counted once: "312 answers in all: 240 in sessions (150 of them reviews), 60 in practice and 12 reading questions (4 texts)." */
function periodLine(days: Day[]): string {
  const sum = (k: 'answers' | 'attempts' | 'reviews' | 'practice' | 'texts' | 'questions' | 'minutes') => days.reduce((s, x) => s + x[k], 0);
  if (!sum('answers') && !sum('minutes')) return 'Nothing studied in this period yet.';
  const parts = [`${count(sum('attempts'))} in sessions (${count(sum('reviews'))} of them reviews)`, `${count(sum('practice'))} in practice`];
  parts.push(`${plural(sum('questions'), 'reading question')} (${plural(sum('texts'), 'text')})`);
  return `${plural(sum('answers'), 'answer')} in all: ${listJoin(parts)}. ${duration(sum('minutes') * 60_000)} of study.`;
}

/** The charts' numbers as a table, days with study only, newest first. */
function DayTable({ days }: { days: Day[] }) {
  const studied = days.filter((x) => x.answers > 0 || x.minutes > 0 || x.introduced > 0).reverse();
  if (!studied.length) return null;
  return (
    <Collapsible>
      <CollapsibleTrigger render={<Button variant="outline" size="sm" />}>Show the numbers per day</CollapsibleTrigger>
      <CollapsibleContent className="mt-3">
        <Table className="min-w-[30rem]">
          <TableHeader>
            <TableRow>
              <TableHead className="pl-0">Day</TableHead>
              <TableHead className="text-right">Minutes</TableHead>
              <TableHead className="text-right">In sessions</TableHead>
              <TableHead className="text-right">Reviews</TableHead>
              <TableHead className="text-right">Practice</TableHead>
              <TableHead className="pr-0 text-right">Texts</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {studied.map((x) => (
              <TableRow key={x.day}>
                <TableCell className="pl-0 whitespace-nowrap">{dayText(x.day, { dateStyle: 'medium' })}</TableCell>
                <TableCell className="text-right tabular-nums">{x.minutes}</TableCell>
                <TableCell className="text-right tabular-nums">{x.attempts}</TableCell>
                <TableCell className="text-right tabular-nums">{x.reviews}</TableCell>
                <TableCell className="text-right tabular-nums">{x.practice}</TableCell>
                <TableCell className="pr-0 text-right tabular-nums">{x.texts}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** A figure and what it counts; the hint shows as text (not a hover title) so touch and screen-reader users get it too. */
function Big({ value, label, hint }: { value: string | number; label: string; hint?: string }) {
  return (
    <div>
      <div className="text-2xl leading-none font-semibold tracking-tight tabular-nums">{typeof value === 'number' ? count(value) : value}</div>
      <div className="mt-1 text-sm text-muted-foreground">{label}</div>
      {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}
