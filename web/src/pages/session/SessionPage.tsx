// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
import { useCallback, useEffect, useRef, useState } from 'react';
import { LuCloudOff, LuInfo, LuKeyboard, LuTimer, LuTriangleAlert, LuX } from 'react-icons/lu';
import type { AttemptResponse, SessionSummary, StudySession } from '../../../../shared/types.ts';
import { ApiError, get } from '../../lib/api.ts';
import { flush, pendingForSession } from '../../lib/outbox.ts';
import { navigate } from '../../lib/router.tsx';
import { langSettings, loadBootstrap, toast } from '../../lib/store.ts';
import { stopAudio } from '../../lib/audio.ts';
import { ErrorNote, PageLoading } from '../../components/ui.tsx';
import { Alert, AlertDescription, AlertTitle } from '../../components/ui/alert.tsx';
import { Kbd, KbdGroup, Progress, Skeleton } from '../../components/ui/basics.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../../components/ui/dialog.tsx';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../../components/ui/tabs.tsx';
import { SyncIndicator, useSync } from '../../components/Shell.tsx';
import { identifyExhausted, identifyRoundPlan, ROUND_MAX_ANSWERS, roundTotals, skillOf, splitActiveMs, type RoundEvent, type RoundKind, type RoundTallies } from '../../../../shared/activity.ts';
import { comingUp, exerciseType, planFromHere, practiceLeft, roundType, slotDue, slotState, type PracticeSlot } from '../../../../shared/mix.ts';
import { sessionCounts } from '../../../../shared/summary.ts';
import { useActiveClock } from '../../lib/activeTime.ts';
import { ExerciseView, useKeys } from './Exercise.tsx';
import { SessionBusy } from './parts.tsx';
import { TypeLabel } from './QuestionType.tsx';
import { Summary } from './Summary.tsx';
import {
  completeRemote,
  itemFor,
  loadSession,
  mergeServer,
  pendingExercises,
  saveLocal,
  sessionEvent,
  setSessionRunning,
  submitAnswer,
  whenWritesSettled,
  withQueuedRounds,
  withRoundAnswers,
  type AnswerInput,
  type LocalOutcome,
} from './runtime.ts';
import { loadRound, PracticeRound, roundQuestions, sessionWords, type Round, type RoundResult } from './PracticeRounds.tsx';

/**
 * Active study time in the session (page visible and some interaction within the last 90 seconds), practice rounds
 * included: `take()` hands over the time since the last take, `totalMs()` is everything this page has counted. The
 * header re-renders every 5 seconds to show it.
 */
function useActiveTimer() {
  const clock = useActiveClock();
  const taken = useRef(0);
  const [, force] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => force((x) => x + 1), 5000);
    return () => clearInterval(iv);
  }, []);
  return {
    take: () => {
      const ms = clock.take();
      taken.current += ms;
      return ms;
    },
    totalMs: () => taken.current + clock.peek(),
  };
}

/** The practice planned with a Comprehensive session (shared/mix.ts; one planned by an earlier version gets it on load). */
export function practicePlan(s: StudySession): PracticeSlot[] {
  return s.config.mode === 'comprehensive' ? (s.meta.practice ?? []) : [];
}

/**
 * A Comprehensive session planned before the mix (by an earlier version) gets its practice when it is opened, from where
 * it is (planFromHere), kept on this device.
 */
function withPractice(s: StudySession): StudySession {
  if (s.config.mode !== 'comprehensive' || s.meta.practice) return s;
  const done = exercisesDone(s);
  return { ...s, meta: { ...s.meta, practice: planFromHere({ language: s.language, minutes: s.config.minutes, done, left: s.exercises.length - done }) } };
}

/** The session's exercises done, answered or skipped: a slot of the mix comes after so many. */
const exercisesDone = (s: StudySession) => s.exercises.filter((e) => e.status !== 'pending').length;

/** The slot on screen: its id (its `round` events carry it), what it asks, the answers it had before (a resumed slot) and those given since. */
interface LiveRound {
  id: string;
  kind: RoundKind;
  from: number;
  grades: string[];
}

export function SessionPage({ sessionId }: { sessionId: string }) {
  const [session, setSession] = useState<StudySession | null>(null);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [server, setServer] = useState<Record<string, AttemptResponse>>({});
  const [finished, setFinished] = useState(false);
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [menu, setMenu] = useState(false);
  const sync = useSync();
  const [help, setHelp] = useState(false);
  const [timeNoticeDismissed, setTimeNoticeDismissed] = useState(false);
  const [planDismissed, setPlanDismissed] = useState(false);
  const ref = useRef<StudySession | null>(null);
  const timer = useActiveTimer();
  // Comprehensive mode: the practice of the session's mix, slot by slot between the exercises (shared/mix.ts). Every
  // answer in a slot is one of the session's questions: the counter counts it at once and the session keeps it.
  const [round, setRound] = useState<Round | null>(null);
  const roundLoading = useRef(false);
  /**
   * A slot is being fetched. What was on screen stays until it arrives (the answered exercise, or the slot just
   * finished) with Continue waiting, so nothing already answered flashes by; `blank` when there is nothing to keep (a
   * session resumed at a slot).
   */
  const [slotWait, setSlotWait] = useState<null | 'keep' | 'blank'>(null);
  const live = useRef<LiveRound | null>(null);
  /** The id of the slot shown (kept after the slot is over, while it waits on screen for what comes next). */
  const shownSlot = useRef('round');
  /** A filled-up Identify slot came back short: the learner's words have no more pictures for the minimum. */
  const identifyOut = useRef(false);
  /** The latest continueSession, for the steps that run after a slot loads. */
  const cont = useRef<(wait?: 'keep' | 'blank') => void>(() => undefined);
  const strictness = session ? (langSettings(session.language)?.spellingStrictness ?? 'normal') : 'normal';

  const update = (s: StudySession) => {
    ref.current = s;
    setSession(s);
  };
  /** Answers given in the rounds, per skill, as the session keeps them (the Identify minimum counts from these). */
  const tallies = (): RoundTallies => ref.current?.meta.rounds ?? {};

  /**
   * Send the active time not yet sent with an answer (a practice round, the last feedback screen), so the session and
   * the day's study time include it. Long stretches go in parts the server accepts.
   */
  const bankTime = () => {
    const s = ref.current;
    if (!s) return;
    for (const ms of splitActiveMs(timer.take())) void sessionEvent(s.id, 'heartbeat', { activeMsDelta: ms });
  };

  const fetchSummary = useCallback(async () => {
    try {
      await whenWritesSettled();
      await flush();
      // Round answers still on their way stay counted. The queue is read first: an answer no longer in it has reached
      // the server before the session is fetched.
      const queued = await pendingForSession(sessionId);
      const fresh = withQueuedRounds(await get<StudySession>(`/api/sessions/${sessionId}`), queued);
      if (fresh.summary) {
        setSummary(fresh.summary);
        update(fresh);
        await saveLocal(fresh);
      } else if (fresh.status !== 'completed') {
        await completeRemote(sessionId, (r) => r?.summary && setSummary(r.summary));
        await flush();
      }
      void loadBootstrap();
    } catch {
      /* offline: the local summary is shown */
    }
  }, [sessionId]);

  useEffect(() => {
    let alive = true;
    setSessionRunning(true);
    loadSession(sessionId, (l) => langSettings(l)?.spellingStrictness ?? 'normal')
      .then(({ session: loaded, offline: off }) => {
        if (!alive) return;
        const s = withPractice(loaded);
        update(s);
        if (s !== loaded) void saveLocal(s);
        setOffline(off);
        const first = pendingExercises(s)[0];
        setCurrentId(first?.id ?? null);
        const over = s.status === 'completed' || s.status === 'abandoned';
        if (!over && (s.status === 'paused' || s.status === 'prepared')) void sessionEvent(s.id, s.status === 'prepared' ? 'start' : 'resume');
        // Resumed with a slot of the mix due (left in the middle of one, or before the last ones): it comes first.
        if (!over && exercisesDone(s) > 0 && slotDue(practicePlan(s), s.meta, exercisesDone(s), !first)) cont.current('blank');
        else if (!first || over) {
          setFinished(true);
          if (s.summary) setSummary(s.summary);
          else void fetchSummary();
        }
      })
      .catch((err) => alive && setError(err instanceof ApiError && err.status === 404 ? 'This session no longer exists.' : err instanceof Error ? err.message : String(err)));
    return () => {
      alive = false;
      setSessionRunning(false);
      stopAudio();
      const s = ref.current;
      if (s && pendingExercises(s).length) {
        const [first = 0, ...rest] = splitActiveMs(timer.take());
        for (const ms of rest) void sessionEvent(s.id, 'heartbeat', { activeMsDelta: ms });
        void sessionEvent(s.id, 'pause', { activeMsDelta: first });
      }
    };
  }, [sessionId]);

  const next = useCallback(() => {
    const s = ref.current;
    if (!s) return;
    const nx = pendingExercises(s)[0];
    setCurrentId(nx?.id ?? null);
    window.scrollTo({ top: 0 });
    if (!nx) {
      bankTime();
      setFinished(true);
      void fetchSummary();
    }
  }, [fetchSummary]);

  /** A slot of the mix, filled now with the questions it has left, from the words met so far; null: nothing to ask. */
  const loadSlot = async (s: StudySession, slot: PracticeSlot): Promise<Round | null> => {
    if (!navigator.onLine) return null;
    const words = sessionWords(s);
    const size = Math.max(1, slot.size - slotState(slot, s.meta).answers);
    if (slot.kind === 'identify') {
      // At least what the session still owes for its Identify minimum, filled up from the learner's other words.
      const plan = identifyRoundPlan(tallies(), identifyOut.current, size);
      const r = await loadRound('identify', s.language, words, s.config.difficulty, plan.size, plan);
      if (r?.kind === 'identify' && identifyExhausted(plan, r.items.length)) identifyOut.current = true;
      return r;
    }
    // Speaking: sentences to say, or to read when none can be said yet (they count as reading).
    if (slot.kind === 'say') return (await loadRound('say', s.language, words, s.config.difficulty, size)) ?? loadRound('read', s.language, words, s.config.difficulty, size);
    return loadRound(slot.kind, s.language, words, s.config.difficulty, size);
  };

  /**
   * The answers of a slot so far (`end`: it is over, perhaps with nothing asked): counted in the session at once (the
   * counter moves), saved on this device and sent as a `round` event, which works offline like every session event.
   */
  const saveRound = (r: LiveRound, end = false) => {
    const s = ref.current;
    if (!s) return;
    const ev: RoundEvent = { roundId: r.id, skill: skillOf(r.kind), grades: r.grades.slice(0, Math.max(0, ROUND_MAX_ANSWERS - r.from)), from: r.from, ...(end ? { end: true } : {}) };
    const updated = withRoundAnswers(s, ev);
    if (updated === s) return;
    update(updated);
    void saveLocal(updated);
    void sessionEvent(s.id, 'round', ev);
  };

  /** After an exercise or a slot: in Comprehensive mode the next slot of the mix when one is due, else the next exercise. */
  const continueSession = useCallback(
    (wait: 'keep' | 'blank' = 'keep') => {
      const s = ref.current;
      if (!s || roundLoading.current) return;
      /** On to the next exercise (or the summary); a slot that was on screen goes with the same render. */
      const toExercise = () => {
        setSlotWait(null);
        setRound(null);
        next();
      };
      if (s.config.mode !== 'comprehensive') return toExercise();
      const slot = slotDue(practicePlan(s), s.meta, exercisesDone(s), pendingExercises(s).length === 0);
      if (!slot) return toExercise();
      roundLoading.current = true;
      setSlotWait(wait);
      void loadSlot(s, slot)
        .catch(() => null)
        .then((r) => {
          roundLoading.current = false;
          const from = slotState(slot, ref.current?.meta ?? s.meta).answers;
          if (r) {
            live.current = { id: slot.id, kind: r.kind, from, grades: [] };
            shownSlot.current = slot.id;
            setSlotWait(null);
            setRound(r);
            window.scrollTo({ top: 0 });
            return;
          }
          // Nothing to ask (no content for these words yet, or offline): the slot is skipped and the total shrinks.
          saveRound({ id: slot.id, kind: slot.kind, from, grades: [] }, true);
          if (ref.current && slotState(slot, ref.current.meta).ended) cont.current(wait);
          else toExercise();
        });
    },
    [next],
  );
  cont.current = continueSession;
  /** For the exercise on screen: on to what comes next (it stays, its Continue waiting, while a slot is fetched). */
  const goOn = useCallback(() => continueSession(), [continueSession]);

  /** One more answer in the slot on screen: one more of the session's questions. */
  const roundAnswer = (grade: string) => {
    const r = live.current;
    if (!r) return;
    r.grades = [...r.grades, grade];
    saveRound(r);
  };

  const roundDone = (res: RoundResult) => {
    // Every answer was counted as it was given (a runner that reports more counts them too); the slot is over.
    const r = live.current;
    if (r) {
      if (res.grades.length > r.grades.length) r.grades = res.grades;
      saveRound(r, true);
    }
    live.current = null;
    // The slot's time goes to the session now, not with the next answer (which can carry at most five minutes).
    bankTime();
    // The slot stays on screen until what comes next is ready: the next slot replaces it, or the next exercise does.
    continueSession();
  };

  const commit = useCallback(
    (input: AnswerInput, outcome: LocalOutcome) => {
      const s = ref.current;
      if (!s || !currentId) return;
      const ex = s.exercises.find((e) => e.id === currentId);
      if (!ex || ex.status !== 'pending') return;
      const { next: updated, saved } = submitAnswer(s, ex, input, outcome, timer.take(), {
        onServer: (r) => {
          setServer((prev) => ({ ...prev, [r.exerciseId]: r }));
          if (ref.current) {
            const merged = mergeServer(ref.current, r);
            update(merged);
            void saveLocal(merged);
          }
        },
        onError: (e) => toast(`An answer could not be saved: ${e.message}`, 'bad'),
      });
      update(updated);
      saved.catch(() => toast('This device could not store your answer offline; keep the app open until it syncs.', 'bad'));
    },
    [currentId],
  );

  // A follow-up exercise planned on this device can be withdrawn when the server's answer arrives: move on.
  useEffect(() => {
    if (!session || finished || !currentId) return;
    if (!session.exercises.some((e) => e.id === currentId)) {
      const nx = pendingExercises(session)[0];
      setCurrentId(nx?.id ?? null);
      if (!nx) {
        setFinished(true);
        void fetchSummary();
      }
    }
  }, [session, currentId, finished, fetchSummary]);

  const skip = useCallback(() => {
    const s = ref.current;
    if (!s || !currentId) return;
    const updated = { ...s, exercises: s.exercises.map((e) => (e.id === currentId ? { ...e, status: 'skipped' as const } : e)) };
    update(updated);
    void saveLocal(updated);
    void sessionEvent(s.id, 'skip', { exerciseId: currentId, activeMsDelta: Math.round(timer.take()) });
    continueSession('blank');
  }, [currentId, continueSession]);

  const endNow = async () => {
    const s = ref.current;
    if (!s) return;
    setMenu(false);
    const updated = { ...s, exercises: s.exercises.map((e) => (e.status === 'pending' ? { ...e, status: 'skipped' as const } : e)) };
    update(updated);
    await saveLocal(updated);
    bankTime(); // sent before the session is completed, so its active time includes it
    await completeRemote(s.id, (r) => r?.summary && setSummary(r.summary));
    setFinished(true);
    void fetchSummary();
  };

  const wrapUp = async () => {
    const s = ref.current;
    if (!s) return;
    const notIntroduced = new Set(s.exercises.filter((e) => e.kind === 'intro' && e.status === 'pending').map((e) => e.itemId));
    const updated = { ...s, exercises: s.exercises.map((e) => (e.status === 'pending' && (e.priority === 'optional' || notIntroduced.has(e.itemId)) ? { ...e, status: 'skipped' as const } : e)) };
    update(updated);
    await saveLocal(updated);
    // Out of time: reviews come first, so the practice still planned is dropped too (the total shrinks).
    for (const slot of practicePlan(updated)) {
      const st = slotState(slot, ref.current?.meta ?? updated.meta);
      if (!st.ended && slot.id !== live.current?.id) saveRound({ id: slot.id, kind: slot.kind, from: st.answers, grades: [] }, true);
    }
    await sessionEvent(s.id, 'wrap_up', { activeMsDelta: Math.round(timer.take()) });
    setTimeNoticeDismissed(true);
    const nx = pendingExercises(updated)[0];
    if (!nx || !updated.exercises.some((e) => e.id === currentId && e.status === 'pending')) next();
  };

  const exit = () => {
    navigate('/');
  };

  useKeys((e) => {
    if (e.key === 'Escape') {
      setMenu(true);
      return true;
    }
    if (e.key === '?') {
      setHelp(true);
      return true;
    }
  }, []);

  if (error)
    return (
      <div className="mx-auto max-w-2xl space-y-4 p-6">
        <ErrorNote error={error} />
        <Button variant="outline" onClick={exit}>
          Back to Today
        </Button>
      </div>
    );
  if (!session) return <PageLoading label="Loading your session" />;

  // The counter: the session's exercises answered or skipped and, in Comprehensive mode, every answer given in its
  // practice, against those plus what is still to come: the exercises left and the questions the mix's slots have left
  // (the slot on screen as loaded). The slots are planned with the session, so the total holds steady; it shrinks when a
  // slot comes back smaller or has nothing to ask. Other modes count their exercises.
  const comprehensive = session.config.mode === 'comprehensive';
  const plan = practicePlan(session);
  const doneExercises = exercisesDone(session);
  const exercisesLeft = session.exercises.length - doneExercises;
  const done = doneExercises + (comprehensive ? roundTotals(session.meta.rounds ?? {}).answered : 0);
  const onScreen = round && live.current && !finished ? { id: live.current.id, questions: live.current.from + roundQuestions(round) } : null;
  const total = done + (finished ? 0 : exercisesLeft + practiceLeft(plan, session.meta, onScreen));
  const ex = session.exercises.find((e) => e.id === currentId) ?? (finished ? null : pendingExercises(session)[0] ?? null);
  const activeMs = session.activeMs + timer.totalMs();
  const budgetMs = session.meta.budgetSeconds * 1000;
  const overTime = activeMs > budgetMs * 1.1 && !timeNoticeDismissed && pendingExercises(session).length > 0;
  const isNew = (e: { itemId: number }) => !!session.items[String(e.itemId)]?.isNew;
  const right = sessionCounts(session.exercises, session.meta.rounds ?? {}).right;
  const showSummary = finished || (!round && !ex);
  const minutesText = `${Math.floor(activeMs / 60000)} of ${Math.round(budgetMs / 60000)} min`;

  return (
    <div data-lang={session.language} className="min-h-dvh bg-background">
      {!showSummary && (
        <header className="safe-top sticky top-0 z-30 border-b bg-background/92 backdrop-blur-md">
          <div className="mx-auto flex max-w-3xl items-center gap-3 px-2 py-2 sm:px-4">
            <Button variant="ghost" size="icon" onClick={() => setMenu(true)} aria-label="Pause or leave the session (Esc)">
              <LuX className="size-[1.375rem]" aria-hidden="true" />
            </Button>
            {/* Read out as questions done of the total, not as a percentage. */}
            <Progress value={total ? (done / total) * 100 : 0} aria-label="Session progress" aria-valuenow={done} aria-valuemax={total} aria-valuetext={`${done} of ${total} questions done`} className="h-2.5 flex-1" />
            <span className="min-w-12 text-right text-sm text-muted-foreground tabular-nums" data-testid="session-count">
              {done} / {total}
            </span>
            {(sync.state !== 'saved' || offline) && <SyncIndicator compact />}
          </div>
        </header>
      )}

      <main className="mx-auto max-w-3xl px-4 pt-6 sm:px-6 sm:pt-10" style={{ paddingBottom: 'calc(var(--dock-h, 0px) + 2rem)' }}>
        {done === 0 && !finished && !planDismissed && session.meta?.adaptations?.length ? (
          <Alert className="mb-6">
            <LuInfo aria-hidden="true" />
            <AlertDescription className="text-foreground/85">
              <p>
                {session.meta.newPlanned < session.meta.newRequested
                  ? `Fewer new words today (${session.meta.newPlanned} of ${session.meta.newRequested}): you have ${session.meta.reviewsPlanned} review${session.meta.reviewsPlanned === 1 ? '' : 's'}.`
                  : `${session.meta.reviewsPlanned} review${session.meta.reviewsPlanned === 1 ? '' : 's'} and ${session.meta.newPlanned} new word${session.meta.newPlanned === 1 ? '' : 's'} planned.`}
              </p>
              <Collapsible>
                <div className="flex gap-1">
                  <CollapsibleTrigger render={<Button variant="link" size="sm" className="h-auto px-0 text-muted-foreground" />}>Why?</CollapsibleTrigger>
                  <Button variant="link" size="sm" className="ml-3 h-auto px-0 text-muted-foreground" onClick={() => setPlanDismissed(true)}>
                    Dismiss
                  </Button>
                </div>
                <CollapsibleContent>
                  <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                    {session.meta.adaptations.map((a) => (
                      <li key={a}>{a}</li>
                    ))}
                  </ul>
                </CollapsibleContent>
              </Collapsible>
            </AlertDescription>
          </Alert>
        ) : null}
        {sync.volatile && (
          <Alert variant="warning" className="mb-4">
            <LuTriangleAlert aria-hidden="true" />
            <AlertDescription className="text-foreground/85">
              This device cannot store answers right now (storage full or blocked), so {sync.pending} unsent answer{sync.pending === 1 ? ' is' : 's are'} kept in memory. Keep the app open until “All changes saved” appears.
            </AlertDescription>
          </Alert>
        )}
        {offline && !finished && (
          <Alert variant="warning" className="mb-4">
            <LuCloudOff aria-hidden="true" />
            <AlertDescription className="text-foreground/85">You are offline. Answers are saved on this device and sync when you reconnect. Native audio is unavailable offline.</AlertDescription>
          </Alert>
        )}
        {overTime && !finished && (
          <Alert className="mb-6">
            <LuTimer aria-hidden="true" />
            <AlertTitle>You have reached your planned time</AlertTitle>
            <AlertDescription>
              <p>Finish the words you have started and the due reviews, or keep going with everything.</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" onClick={() => void wrapUp()}>
                  Wrap up
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setTimeNoticeDismissed(true)}>
                  Keep going
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        )}
        <SessionBusy.Provider value={slotWait === 'keep'}>
          {round && !finished ? (
            <>
              <TypeLabel type={roundType(round.kind)} />
              <PracticeRound key={shownSlot.current} id={shownSlot.current} busy={slotWait != null} round={round} language={session.language} onAnswer={roundAnswer} onDone={roundDone} />
            </>
          ) : slotWait === 'blank' && !finished ? (
            <div role="status" className="space-y-4 pt-2" data-testid="slot-loading">
              <span className="sr-only">Loading the next question</span>
              <Skeleton className="h-5 w-28" />
              <Skeleton className="h-9 w-3/4" />
              <Skeleton className="h-14 w-full rounded-xl" />
              <Skeleton className="h-14 w-full rounded-xl" />
            </div>
          ) : showSummary ? (
            <Summary session={session} summary={summary} offline={offline} />
          ) : (
            <ExerciseView
              key={ex!.id}
              ex={ex!}
              item={itemFor(session, ex!)}
              language={session.language}
              strictness={strictness}
              server={server[ex!.id] ?? null}
              commit={commit}
              next={goOn}
              skip={skip}
              label={comprehensive ? <TypeLabel type={exerciseType(ex!.kind, isNew(ex!))} note={ex!.origin === 'remediation' ? 'another try' : null} /> : undefined}
            />
          )}
        </SessionBusy.Provider>
      </main>

      <Dialog open={menu} onOpenChange={setMenu}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Session paused</DialogTitle>
            <DialogDescription>Your progress is saved after every answer. Leave now and resume on any device.</DialogDescription>
          </DialogHeader>
          <ul className="grid grid-cols-3 gap-2 text-center" data-testid="pause-stats">
            <li className="rounded-xl bg-muted px-2 py-3">
              <span className="block text-lg font-semibold tabular-nums">
                {done}/{total}
              </span>
              <span className="text-xs text-muted-foreground">done</span>
            </li>
            <li className="rounded-xl bg-muted px-2 py-3">
              <span className="block text-lg font-semibold tabular-nums">{minutesText.split(' of ')[0]}</span>
              <span className="text-xs text-muted-foreground">of {Math.round(budgetMs / 60000)} min</span>
            </li>
            <li className="rounded-xl bg-muted px-2 py-3">
              <span className="block text-lg font-semibold tabular-nums" data-testid="right-so-far">
                {right}
              </span>
              <span className="text-xs text-muted-foreground">right so far</span>
            </li>
          </ul>
          <div className="grid gap-2">
            <Button size="lg" onClick={() => setMenu(false)}>
              Keep going
            </Button>
            <Button size="lg" variant="outline" onClick={exit}>
              Leave and resume later
            </Button>
            <Button size="lg" variant="ghost" onClick={() => void endNow()}>
              End now and see the summary
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground [@media(pointer:coarse)]:hidden"
              onClick={() => {
                setMenu(false);
                setHelp(true);
              }}
            >
              <LuKeyboard aria-hidden="true" /> Keyboard shortcuts
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={help} onOpenChange={setHelp}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Keyboard shortcuts</DialogTitle>
          </DialogHeader>
          <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2.5 text-[0.95rem]">
            <dt>
              <Kbd>Enter</Kbd>
            </dt>
            <dd>Check the answer or continue</dd>
            <dt>
              <Kbd>Space</Kbd>
            </dt>
            <dd>Show the answer on flashcards</dd>
            <dt>
              <KbdGroup>
                <Kbd>1</Kbd>–<Kbd>4</Kbd>
              </KbdGroup>
            </dt>
            <dd>Choose an option, or rate Again, Hard, Good, Easy</dd>
            <dt>
              <Kbd>R</Kbd>
            </dt>
            <dd>Play the pronunciation again (when not typing)</dd>
            <dt>
              <Kbd>Esc</Kbd>
            </dt>
            <dd>Pause</dd>
          </dl>
        </DialogContent>
      </Dialog>
    </div>
  );
}
