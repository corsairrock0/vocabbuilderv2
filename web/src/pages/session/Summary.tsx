// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
import { useState } from 'react';
import { LuCalendarCheck, LuCircleCheck, LuFlame, LuLightbulb, LuSprout, LuTarget } from 'react-icons/lu';
import type { ItemResource, SessionExercise, SessionSummary, StudySession } from '../../../../shared/types.ts';
import { LANGUAGES, type LanguageCode } from '../../../../shared/languages.ts';
import { ROUND_SKILLS, type RoundSkill, type RoundTally } from '../../../../shared/activity.ts';
import { KINDS } from '../../../../shared/exercises.ts';
import { paradigmTitle } from '../../../../shared/paradigms.ts';
import { minutesOf } from '../../../../shared/progress.ts';
import { DEFAULT_STUDY_MODE } from '../../../../shared/settings.ts';
import { sessionCounts, type AnswerTally, type ExerciseGroup } from '../../../../shared/summary.ts';
import { count, duration, intervalText, pct, plural } from '../../lib/format.ts';
import { navigate, Link } from '../../lib/router.tsx';
import { langSettings, toast, useApp } from '../../lib/store.ts';
import { ApiError } from '../../lib/api.ts';
import { Spinner } from '../../components/ui.tsx';
import { Alert, AlertDescription, AlertTitle } from '../../components/ui/alert.tsx';
import { Badge } from '../../components/ui/badge.tsx';
import { Progress } from '../../components/ui/basics.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '../../components/ui/item.tsx';
import { Word } from './Exercise.tsx';
import { startSession } from './runtime.ts';

/** A row of "Every skill today": its name, "x of y right" (or what right means there), answers and right ones. */
export interface SkillRow {
  key: string;
  name: string;
  text: string;
  answered: number;
  /** null: no right or wrong (new word cards). */
  right: number | null;
}

/** The practice skills' rows: "Grammar: declension", "Reading: 2 texts" and the rest. */
export function roundRow(language: LanguageCode, skill: RoundSkill, t: RoundTally): SkillRow {
  const of = (what = 'right') => `${t.correct} of ${count(t.answered)} ${what}`;
  const base = { key: skill, answered: t.answered, right: t.correct };
  switch (skill) {
    case 'forms':
      return { ...base, name: `Grammar: ${paradigmTitle(language).toLowerCase()}`, text: of() };
    case 'cloze':
      return { ...base, name: 'Sentences', text: of() };
    case 'identify':
      return { ...base, name: 'Pictures', text: of() };
    case 'read':
      return { ...base, name: 'Reading sentences', text: of('understood in full') };
    case 'say':
      return { ...base, name: 'Speaking', text: of() };
    case 'comprehension':
      return { ...base, name: `Reading: ${plural(t.rounds, 'text')}`, text: `${t.correct} of ${plural(t.answered, 'question')} right` };
    case 'writing':
      return { ...base, name: 'Writing', text: `${t.correct} of ${plural(t.answered, 'sentence')} right` };
  }
}

const GROUP_NAMES: Record<ExerciseGroup, string> = { cards: 'New word cards', words: 'Words (reviews and new)', listening: 'Listening' };

/** The session's own exercises' rows. */
export function exerciseRow(group: ExerciseGroup, t: AnswerTally, known = 0): SkillRow {
  if (group === 'cards') return { key: group, name: GROUP_NAMES.cards, text: `${count(t.answered)} seen${known ? `, ${known} already known` : ''}`, answered: t.answered, right: null };
  return { key: group, name: GROUP_NAMES[group], text: `${t.right} of ${count(t.answered)} right`, answered: t.answered, right: t.right };
}

/** What went wrong with a missed word, from its last miss in the session: "means “to hurry”: you chose “to sleep”". */
export function missNote(ex: SessionExercise, item: ItemResource | undefined): string | null {
  const p = ex.payload as any;
  const r = ex.result;
  if (!r) return null;
  const gloss = item?.senses[0]?.gloss ?? p.gloss ?? '';
  const chosen: string | undefined = p.options?.find((o: { id: string; text: string }) => o.id === r.response)?.text;
  const wrote = !p.options && r.response ? r.response : null;
  const said = chosen ? `you chose “${chosen}”` : wrote ? `you wrote “${wrote}”` : 'you didn’t know it';
  if (KINDS[ex.kind].response === 'self') return 'you rated it Again';
  switch (KINDS[ex.kind].skill) {
    case 'listening':
      return chosen || wrote ? `heard as “${chosen ?? wrote}”` : 'missed by ear';
    case 'recognition':
    case 'comprehension':
      return gloss ? `means “${gloss}”: ${said}` : said;
    case 'recall':
      return gloss ? `for “${gloss}”: ${said}` : said;
    case 'sentence':
    case 'production': {
      const expected = r.expected || p.answer?.accepted?.[0] || p.options?.find((o: { id: string }) => o.id === p.correctId)?.text;
      return expected ? `${ex.kind === 'form_typed' ? 'the form asked for is' : 'the gap takes'} “${expected}”: ${said}` : said;
    }
    default:
      return null;
  }
}

export function Summary({ session, summary, offline }: { session: StudySession; summary: SessionSummary | null; offline: boolean }) {
  const [busy, setBusy] = useState(false);
  const boot = useApp((s) => s.boot);
  // Every question answered, the practice's with the session's own, from the session itself: it matches the counter,
  // and a resumed or reloaded session (the practice is kept with it) shows the same figures, offline too.
  const counts = sessionCounts(session.exercises, session.config.mode === 'comprehensive' ? (session.meta.rounds ?? {}) : {});
  const rows: SkillRow[] = [
    ...(['cards', 'words', 'listening'] as const).filter((g) => counts.exercises[g]).map((g) => exerciseRow(g, counts.exercises[g]!, counts.known)),
    ...ROUND_SKILLS.filter((k) => (counts.rounds[k]?.answered ?? 0) > 0).map((k) => roundRow(session.language, k, counts.rounds[k]!)),
  ];
  const newWords = summary
    ? summary.introduced.map((w) => ({ id: w.itemId, word: w.lemma }))
    : session.exercises.filter((e) => e.kind === 'intro' && e.status === 'done' && e.result?.code !== 'marked_known').map((e) => ({ id: e.itemId, word: session.items[String(e.itemId)]?.display ?? '' }));
  // The words missed, each with what went wrong the last time.
  const misses = (summary?.difficult ?? []).map((w) => {
    const last = session.exercises.filter((e) => e.itemId === w.itemId && e.status === 'done' && e.result && e.result.grade !== 'correct' && e.result.grade !== 'self').sort((a, b) => (b.result!.answeredAt ?? 0) - (a.result!.answeredAt ?? 0))[0];
    return { id: w.itemId, word: w.lemma, note: (last && missNote(last, session.items[String(w.itemId)])) || `${w.gloss}, missed ${plural(w.misses, 'time')}` };
  });
  // Today: the language's daily goal (Settings → Learning), in whole minutes counted as Home and Progress count them;
  // the streak counts days with any study.
  const stats = boot?.languages.find((l) => l.code === session.language)?.stats;
  const goal = langSettings(session.language)?.dailyGoalMinutes ?? 20;
  const todayMin = minutesOf(stats?.studiedTodayMs ?? 0);
  const goalMet = goal > 0 && todayMin >= goal;
  const more = async () => {
    setBusy(true);
    try {
      const id = await startSession({ language: session.language, quick: true, mode: DEFAULT_STUDY_MODE });
      navigate(`/study/${id}`);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not start another session', 'bad');
    } finally {
      setBusy(false);
    }
  };
  const buckets = new Map<string, number>();
  for (const c of [...(summary?.scheduleChanges ?? [])].sort((a, b) => a.scheduledDays - b.scheduledDays)) {
    const key = intervalText(c.scheduledDays);
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  const reviewed = summary?.reviewed ?? null;
  const minutes = duration(summary?.activeMs ?? session.activeMs);
  return (
    <div className="grid gap-6 pb-28 md:pb-0">
      <header>
        <Badge variant="soft" className="mb-3 h-7 px-2.5 text-[0.8125rem]" lang={session.language}>
          <span className="word text-sm">{LANGUAGES[session.language].nativeName}</span>
        </Badge>
        <h1 className="text-[2rem] leading-tight font-semibold tracking-tight">Session complete</h1>
        <p className="mt-2 text-lg text-foreground/85">
          <span data-testid="questions-answered">{plural(counts.answered, 'answer')}</span> in {minutes}
          {counts.accuracy != null && (
            <>
              , <span data-testid="answered-right">{pct(counts.accuracy)}</span> right
            </>
          )}
          .
        </p>
        {(goalMet || (stats?.streakDays ?? 0) > 0) && (
          <p className="mt-3 flex flex-wrap gap-2">
            {goal > 0 && (
              <Badge variant={goalMet ? 'success' : 'secondary'} className="h-7 gap-1.5 px-2.5 text-[0.8125rem]">
                {goalMet ? <LuCircleCheck aria-hidden="true" /> : <LuTarget aria-hidden="true" />}
                {goalMet ? 'Daily goal met' : `${todayMin} of ${goal} min today`}
              </Badge>
            )}
            {stats?.streakDays ? (
              <Badge variant="secondary" className="h-7 gap-1.5 px-2.5 text-[0.8125rem]">
                <LuFlame className="text-warning" aria-hidden="true" /> {stats.streakDays}-day streak
              </Badge>
            ) : null}
          </p>
        )}
        {!summary && <p className="mt-3 text-muted-foreground">{offline ? 'Your answers are saved on this device. The full summary appears after they sync.' : <Spinner label="Saving your results" />}</p>}
      </header>

      {(reviewed != null || newWords.length > 0) && (
        <section aria-labelledby="memory-title" className="space-y-2">
          <h2 id="memory-title" className="px-1 text-base font-semibold tracking-tight">
            What it did to your memory
          </h2>
          <div className="divide-y rounded-xl border bg-card shadow-xs">
            {reviewed != null && (
              <Item size="sm">
                <ItemMedia variant="icon">
                  <LuCalendarCheck aria-hidden="true" />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>{plural(reviewed, 'review')} done</ItemTitle>
                  {buckets.size > 0 && (
                    <ItemDescription className="line-clamp-none">
                      {[...buckets.entries()]
                        .slice(0, 3)
                        .map(([k, n]) => `${count(n)} back ${k}`)
                        .join(' · ')}
                    </ItemDescription>
                  )}
                </ItemContent>
              </Item>
            )}
            {newWords.length > 0 && (
              <Item size="sm" className="flex-wrap">
                <ItemMedia variant="icon">
                  <LuSprout aria-hidden="true" />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>{plural(newWords.length, 'new word')} learning</ItemTitle>
                  <ul className="mt-1.5 flex flex-wrap gap-1.5" lang={session.language}>
                    {newWords.map((w) => (
                      <li key={w.id} className="rounded-full bg-lang-soft px-2.5 py-0.5">
                        <Word text={w.word} className="text-[1rem]" />
                      </li>
                    ))}
                  </ul>
                </ItemContent>
              </Item>
            )}
          </div>
        </section>
      )}

      <section aria-labelledby="skills-title" className="space-y-2" data-testid="summary-skills">
        <h2 id="skills-title" className="px-1 text-base font-semibold tracking-tight">
          Every skill today
        </h2>
        <ul className="divide-y rounded-xl border bg-card shadow-xs">
          {rows.map((r) => (
            <li key={r.key} className="grid gap-2 px-4 py-3" data-answered={r.answered} data-right={r.right ?? undefined} data-skill={r.key}>
              <span className="flex items-baseline justify-between gap-2">
                <span className="font-medium">{r.name}</span>
                <span className="text-sm text-muted-foreground tabular-nums">{r.text}</span>
              </span>
              {r.right != null && <Progress value={r.answered ? (100 * r.right) / r.answered : 0} aria-label={`${r.name}: ${r.text}`} className="h-1.5" />}
            </li>
          ))}
        </ul>
        {!counts.exercises.listening && !session.meta.audioAvailable && <p className="hint px-1">No listening questions: no audio was available.</p>}
        <p className="hint px-1">Every kind of question counts toward the words it tests, a word’s first answer of the day being its review.</p>
      </section>

      {misses.length > 0 && (
        <section aria-labelledby="again-title" className="space-y-2" data-testid="worth-another-look">
          <h2 id="again-title" className="px-1 text-base font-semibold tracking-tight">
            Worth another look
          </h2>
          <ul className="divide-y rounded-xl border bg-card shadow-xs">
            {misses.map((m) => (
              <li key={m.id} className="grid gap-0.5 px-4 py-2.5">
                <Word text={m.word} className="text-lg" />
                <span className="text-sm text-muted-foreground">{m.note}</span>
              </li>
            ))}
          </ul>
          <p className="hint px-1">These come back early in your next session.</p>
        </section>
      )}

      {summary && (
        <Alert>
          <LuLightbulb aria-hidden="true" />
          <AlertTitle>Next</AlertTitle>
          <AlertDescription>{summary.next.suggestion}</AlertDescription>
        </Alert>
      )}

      {counts.skipped > 0 && <p className="hint px-1">{plural(counts.skipped, 'question')} skipped, not counted.</p>}

      <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-md md:static md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none">
        <div className="mx-auto flex max-w-3xl gap-2">
          <Button variant="outline" size="xl" className="flex-1" disabled={busy || offline} onClick={() => void more()}>
            {busy ? 'Planning' : 'Study more'}
          </Button>
          <Button size="xl" className="flex-1" render={<Link to="/" />}>
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}
