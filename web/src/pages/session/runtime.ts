// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
/**
 * Client-side session runtime.
 *
 * The server plans the session and stays authoritative for grading and scheduling. To keep
 * study fast and possible offline, the client grades instantly with the same shared code,
 * applies the same deterministic remediation, caches the session in IndexedDB and queues
 * each attempt in the outbox (idempotent operation ids). When the server replies, its result
 * (including the new review interval) is merged in. The answers of a Comprehensive session's
 * practice rounds go the same way as `round` events, counted alike on both sides (mergeRound).
 */
import { mergeRound, type RoundEvent } from '../../../../shared/activity.ts';
import { checkAnswer, checkChoice, type CheckResult, type Grade } from '../../../../shared/answer.ts';
import { KINDS, planRemediation, suggestRating, type ExerciseKind } from '../../../../shared/exercises.ts';
import type { Rating } from '../../../../shared/fsrs.ts';
import type { LanguageCode } from '../../../../shared/languages.ts';
import type { StudyMode } from '../../../../shared/settings.ts';
import type { Strictness } from '../../../../shared/answer.ts';
import type { AttemptRequest, AttemptResponse, ItemResource, SessionExercise, StudySession } from '../../../../shared/types.ts';
import { ApiError, deviceId, get, post, uuid } from '../../lib/api.ts';
import { idb } from '../../lib/idb.ts';
import { enqueue, listQueue, type QueuedOp } from '../../lib/outbox.ts';

let running = false;
export const isSessionRunning = () => running;
export const setSessionRunning = (v: boolean) => {
  running = v;
};

export interface StartOptions {
  language: LanguageCode;
  quick?: boolean;
  /** Without one the server plans a Comprehensive session (DEFAULT_STUDY_MODE). */
  mode?: StudyMode;
  minutes?: number;
  newWords?: number;
  difficulty?: 'easy' | 'normal' | 'challenging';
  focus?: 'balanced' | 'listening' | 'speaking' | 'reading' | 'writing';
  frequencyMin?: number | null;
  frequencyMax?: number | null;
  tag?: string | null;
  replaceActive?: boolean;
  prepared?: boolean;
  /** The id to start the session with (the start screen previews its plan under it). */
  id?: string;
}

export async function saveLocal(session: StudySession) {
  try {
    await idb.put('sessions', { ...session, cachedAt: Date.now() });
  } catch {
    /* no offline storage available */
  }
}

export async function startSession({ id = uuid(), ...opts }: StartOptions): Promise<string> {
  const session = await post<StudySession>('/api/sessions', { id, ...opts }, { idempotencyKey: `create-${id}` });
  await saveLocal(session);
  return session.id;
}

export async function prepareOfflineSession(opts: StartOptions): Promise<StudySession> {
  const id = uuid();
  // A session of its own: never the id the start screen keeps for Start.
  const session = await post<StudySession>('/api/sessions', { ...opts, id, prepared: true }, { idempotencyKey: `create-${id}` });
  await saveLocal(session);
  return session;
}

export async function cachedOfflineSessions(): Promise<Array<{ id: string; language: LanguageCode; total: number }>> {
  try {
    const all = await idb.getAll<StudySession & { cachedAt: number }>('sessions');
    return all
      .filter((s) => s.status === 'prepared' && s.exercises.some((e) => e.status === 'pending'))
      .map((s) => ({ id: s.id, language: s.language, total: s.exercises.length }));
  } catch {
    return [];
  }
}

export async function forgetCachedSession(id: string) {
  try {
    await idb.delete('sessions', id);
  } catch {
    /* ignore */
  }
}

export function pendingExercises(s: StudySession): SessionExercise[] {
  return s.exercises.filter((e) => e.status === 'pending').sort((a, b) => a.seq - b.seq);
}

export function itemFor(s: StudySession, ex: SessionExercise): ItemResource {
  return s.items[String(ex.itemId)];
}

export interface AnswerInput {
  response?: string | null;
  choiceId?: string | null;
  hintsUsed?: number;
  revealed?: boolean;
  selfRating?: Rating | null;
  override?: boolean;
  ratingOverride?: Rating | null;
  markKnown?: boolean;
  latencyMs?: number | null;
}

export interface LocalOutcome {
  grade: Grade | 'self';
  check: CheckResult | null;
  suggested: Rating | null;
  final: Rating | null;
  expectedText: string;
}

export function gradeLocal(ex: SessionExercise, input: AnswerInput, strictness: Strictness): LocalOutcome {
  const info = KINDS[ex.kind];
  const p = ex.payload as any;
  let check: CheckResult | null = null;
  let grade: Grade | 'self' = 'self';
  if (info.response === 'choice') check = checkChoice(input.choiceId, p.correctId);
  else if (info.response === 'typed') check = checkAnswer(input.response ?? '', p.answer, strictness);
  if (check) grade = check.grade;
  if (input.revealed && (info.response === 'choice' || info.response === 'typed')) {
    grade = 'incorrect';
    check = { ...(check as CheckResult), grade: 'incorrect', code: 'incorrect', message: 'Answer revealed.' };
  }
  if (input.override && info.response === 'typed' && grade !== 'correct') {
    grade = 'correct';
    check = { ...(check as CheckResult), grade: 'correct', code: 'exact', message: 'Marked correct by you.' };
  }
  const selfRating = info.response === 'self' ? (input.selfRating ?? null) : null;
  const suggested: Rating | null = ex.kind === 'intro' ? null : suggestRating({ kind: ex.kind, grade, hintsUsed: input.hintsUsed ?? 0, revealed: input.revealed, selfRating });
  const final = ex.kind === 'intro' ? null : ((input.ratingOverride ?? suggested) as Rating);
  let expectedText = check?.expected ?? '';
  if (info.response === 'choice') expectedText = p.options?.find((o: any) => o.id === p.correctId)?.text ?? '';
  return { grade, check, suggested, final, expectedText };
}

/** Apply an answered exercise to the local session (status, remediation, skips) — mirrors the server. */
export function applyLocally(s: StudySession, ex: SessionExercise, input: AnswerInput, outcome: LocalOutcome, attemptKey: string, answeredAt: number): StudySession {
  const exercises = s.exercises.map((e) => ({ ...e }));
  const target = exercises.find((e) => e.id === ex.id)!;
  const wasPending = target.status === 'pending';
  target.status = 'done';
  target.result = {
    attemptId: -1,
    grade: outcome.grade,
    code: outcome.check?.code ?? (input.markKnown ? 'marked_known' : ''),
    message: outcome.check?.message ?? '',
    expected: outcome.expectedText,
    response: input.response ?? input.choiceId ?? null,
    rating: outcome.final,
    countedAsReview: false,
    answeredAt,
  };
  void attemptKey;
  if (ex.kind === 'intro' && input.markKnown) {
    for (const e of exercises) if (e.itemId === ex.itemId && e.status === 'pending') e.status = 'skipped';
  }
  if (wasPending && ex.kind !== 'intro') {
    const remCount = exercises.filter((e) => e.itemId === ex.itemId && e.origin === 'remediation').length;
    const pending = exercises.filter((e) => e.status === 'pending').sort((a, b) => a.seq - b.seq);
    const variants = s.items[String(ex.itemId)]?.variants ?? {};
    const rem = planRemediation({
      exercise: { id: ex.id, kind: ex.kind, itemId: ex.itemId, seq: ex.seq },
      grade: outcome.grade,
      selfRating: input.selfRating ?? null,
      remediationsSoFar: remCount,
      availableKinds: Object.keys(variants) as ExerciseKind[],
      pending,
    });
    if (rem && variants[rem.kind] && !exercises.some((e) => e.id === rem.id)) {
      exercises.push({
        id: rem.id,
        seq: rem.seq,
        stage: rem.stage,
        kind: rem.kind,
        itemId: rem.itemId,
        cardSkill: rem.cardSkill,
        priority: rem.priority,
        origin: 'remediation',
        parentId: rem.parentId,
        status: 'pending',
        payload: variants[rem.kind]!,
        result: null,
      });
    }
  }
  return { ...s, status: s.status === 'prepared' || s.status === 'paused' ? 'active' : s.status, exercises };
}

/** Merge the server's authoritative response into the local session. */
export function mergeServer(s: StudySession, r: AttemptResponse): StudySession {
  const exercises = s.exercises.map((e) => {
    if (e.id === r.exerciseId && r.result) return { ...e, status: 'done' as const, result: { ...e.result, ...r.result, message: r.result.message || e.result?.message || '' } };
    if (r.skipped.includes(e.id)) return { ...e, status: 'skipped' as const };
    return e;
  });
  for (const ins of r.inserted) if (!exercises.some((e) => e.id === ins.id)) exercises.push(ins);
  // The server decides follow-up exercises: drop local-only remediation for this answer that it did not create
  // (still pending ones only; an answered one is adopted by the server when its answer arrives).
  const serverRem = new Set(r.inserted.map((x) => x.id));
  const filtered = exercises.filter((e) => !(e.origin === 'remediation' && e.parentId === r.exerciseId && e.status === 'pending' && !serverRem.has(e.id)));
  return { ...s, exercises: filtered, status: r.session.status, activeMs: r.session.activeMs };
}

let writeChain: Promise<unknown> = Promise.resolve();

/**
 * Record an answer: the new local session state is returned synchronously (so the UI can
 * advance immediately); saving to IndexedDB and queueing the server write happen in order
 * in the background (`saved`).
 */
export function submitAnswer(
  s: StudySession,
  ex: SessionExercise,
  input: AnswerInput,
  outcome: LocalOutcome,
  activeMsDelta: number,
  handlers: { onServer: (r: AttemptResponse) => void; onError: (e: ApiError) => void },
): { next: StudySession; saved: Promise<unknown> } {
  const opId = uuid();
  const answeredAt = Date.now();
  const body: AttemptRequest = {
    opId,
    exerciseId: ex.id,
    response: input.response ?? null,
    choiceId: input.choiceId ?? null,
    hintsUsed: input.hintsUsed ?? 0,
    revealed: input.revealed ?? false,
    latencyMs: input.latencyMs != null ? Math.round(input.latencyMs) : null,
    answeredAt,
    selfRating: input.selfRating ?? null,
    override: input.override ?? false,
    ratingOverride: input.ratingOverride ?? null,
    markKnown: input.markKnown ?? false,
    kind: ex.kind,
    activeMsDelta: Math.round(activeMsDelta),
    deviceId,
    offline: !navigator.onLine,
  };
  const next = applyLocally(s, ex, input, outcome, opId, answeredAt);
  const saved = (writeChain = writeChain
    .catch(() => undefined)
    .then(() => saveLocal(next))
    .then(() =>
      enqueue({ id: opId, method: 'POST', url: `/api/sessions/${s.id}/attempts`, body, label: 'Study answer', sessionId: s.id }, { onResult: handlers.onServer, onError: handlers.onError }),
    ));
  return { next, saved };
}

/**
 * heartbeat: active time spent outside the session's own exercises (a practice round, the last feedback screen).
 * round: the answers of a practice slot so far (RoundEvent), sent after each answer and when the slot is over.
 */
export function sessionEvent(sessionId: string, type: 'pause' | 'resume' | 'skip' | 'wrap_up' | 'start' | 'heartbeat' | 'round', extra: { exerciseId?: string; activeMsDelta?: number } & Partial<RoundEvent> = {}) {
  const body = { type, at: Date.now(), ...extra };
  return (writeChain = writeChain.catch(() => undefined).then(() => enqueue({ method: 'POST', url: `/api/sessions/${sessionId}/events`, body, label: 'Session progress', sessionId })));
}

/** The session with a practice round's answers so far counted in its meta, as the server counts the `round` event. */
export function withRoundAnswers(s: StudySession, ev: RoundEvent): StudySession {
  const meta = mergeRound(s.meta, ev);
  return meta === s.meta ? s : { ...s, meta };
}

/**
 * Round events still queued on this device, counted on top of a session as the server returned it (each round once,
 * however many of its events the server already has).
 */
export function withQueuedRounds(s: StudySession, ops: QueuedOp[]): StudySession {
  let out = s;
  for (const op of ops) {
    const b = op.body as ({ type?: string } & Partial<RoundEvent>) | null;
    if (op.status === 'failed' || !op.url.endsWith('/events') || b?.type !== 'round' || !b.roundId || !b.skill || !b.grades) continue;
    out = withRoundAnswers(out, { roundId: b.roundId, skill: b.skill, grades: b.grades, from: b.from, end: b.end });
  }
  return out;
}

export function completeRemote(sessionId: string, onResult?: (r: any) => void) {
  return (writeChain = writeChain.catch(() => undefined).then(() => enqueue({ method: 'POST', url: `/api/sessions/${sessionId}/complete`, body: {}, label: 'Finish session', sessionId }, { onResult })));
}

export function whenWritesSettled(): Promise<unknown> {
  return writeChain.catch(() => undefined);
}

/** Re-apply attempts that are still queued on this device on top of a freshly fetched server session. */
function applyQueued(s: StudySession, ops: QueuedOp[], strictness: Strictness): StudySession {
  let out = s;
  for (const op of ops) {
    // A change the server rejected is not progress: the exercise stays open until the learner retries or discards it.
    if (op.status === 'failed' || !op.url.endsWith('/attempts')) continue;
    const b = op.body as AttemptRequest;
    const ex = out.exercises.find((e) => e.id === b.exerciseId);
    if (!ex || ex.status === 'done') continue;
    const input: AnswerInput = { response: b.response, choiceId: b.choiceId, hintsUsed: b.hintsUsed, revealed: b.revealed, selfRating: b.selfRating ?? null, override: b.override, ratingOverride: b.ratingOverride ?? null, markKnown: b.markKnown };
    out = applyLocally(out, ex, input, gradeLocal(ex, input, strictness), b.opId, b.answeredAt);
  }
  for (const op of ops) {
    if (op.status !== 'failed' && op.url.endsWith('/events') && (op.body as any).type === 'skip') {
      out = { ...out, exercises: out.exercises.map((e) => (e.id === (op.body as any).exerciseId && e.status === 'pending' ? { ...e, status: 'skipped' as const } : e)) };
    }
  }
  return withQueuedRounds(out, ops);
}

export async function loadSession(id: string, strictnessFor: (language: LanguageCode) => Strictness): Promise<{ session: StudySession; offline: boolean }> {
  const queued = (await listQueue()).filter((o) => o.sessionId === id);
  try {
    const server = await get<StudySession>(`/api/sessions/${id}`);
    const merged = applyQueued(server, queued, strictnessFor(server.language));
    await saveLocal(merged);
    return { session: merged, offline: false };
  } catch (err) {
    if (err instanceof ApiError && err.isNetwork) {
      const cached = await idb.get<StudySession>('sessions', id).catch(() => undefined);
      if (cached) return { session: applyQueued(cached, queued, strictnessFor(cached.language)), offline: true };
    }
    throw err;
  }
}
