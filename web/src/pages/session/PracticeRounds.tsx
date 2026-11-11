// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
/**
 * The practice of a Comprehensive session's mix (shared/mix.ts): grammar (conjugation or declension), sentence gaps,
 * pictures (Identify), speaking (Say it, or Read when nothing can be said yet) on the words met in this session, and one
 * short everyday text at the learner's reading level. Each slot of the plan is loaded when the session reaches it and
 * shown in the same flow as the exercises, with the practice pages' runners (`embedded`). Every session asks at least
 * five Identify questions when the learner's words have the pictures (shared/activity.ts, identifyRoundPlan): its
 * Identify slots fill up from the words being learned, then all the learner's words, until it has. Practice answers go
 * to practice, Writing or comprehension attempts; forms, gaps, pictures and Writing also count as reviews of the words they
 * test where the review rules allow (server: scheduleFromPractice). Each also counts as one of the session's
 * questions (`onAnswer`), which the session page counts at once and keeps with the session.
 */
import { useState } from 'react';
import { ROUND_SIZE, type IdentifyRoundPlan, type RoundKind } from '../../../../shared/activity.ts';
import type { ComprehensionNext } from '../../../../shared/comprehension.ts';
import type { WritingNext } from '../../../../shared/writing.ts';
import type { LanguageCode } from '../../../../shared/languages.ts';
import type { Paradigm } from '../../../../shared/paradigms.ts';
import type { StudySession } from '../../../../shared/types.ts';
import { post } from '../../lib/api.ts';
import { ClozeRunner, type ClozeItem } from '../practice/ClozePractice.tsx';
import { ComprehensionRunner } from '../practice/ComprehensionPractice.tsx';
import { FormsReview, FormsRunner, type FormsItem } from '../practice/FormsPractice.tsx';
import { IdentifyRunner, type IdentifyItem } from '../practice/IdentifyPractice.tsx';
import { ReadRunner, type ReadItem } from '../practice/ReadPractice.tsx';
import { WritingRunner } from '../practice/WritingPractice.tsx';

export type Round =
  | { kind: 'forms'; items: FormsItem[]; tables: Map<number, Paradigm> }
  | { kind: 'cloze' | 'cloze-typed'; items: ClozeItem[] }
  /** `mine`: some pictures name the session's words; `others`: some name other words, filled up for the minimum. */
  | { kind: 'identify'; items: IdentifyItem[]; others: boolean; mine: boolean }
  | { kind: 'read' | 'say'; items: ReadItem[] }
  | { kind: 'comprehension'; next: ComprehensionNext }
  | { kind: 'writing'; next: WritingNext };

/** The questions a round asks (a reading text: its questions). */
export function roundQuestions(round: Round): number {
  if (round.kind === 'writing') return round.next.sentence ? 1 : 0;
  return round.kind === 'comprehension' ? (round.next.passage?.questions.length ?? 0) : round.items.length;
}

/** The words met so far in the session (answered exercises), most recently answered first. */
export function sessionWords(s: StudySession): number[] {
  const done = s.exercises.filter((e) => e.status === 'done').sort((a, b) => (b.result?.answeredAt ?? 0) - (a.result?.answeredAt ?? 0));
  const ids: number[] = [];
  for (const e of done) {
    const id = s.items[String(e.itemId)]?.entryId;
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids.slice(0, 60);
}

/**
 * One round of a practice mode for these words, `size` questions at most, or null when the mode has nothing for them or
 * the server can't be reached. `identify`: how an Identify round asks (its size, and the scopes to fill up from for the
 * session's minimum). A reading text asks its own questions.
 */
export async function loadRound(kind: RoundKind, language: LanguageCode, entryIds: number[], difficulty: string, size = ROUND_SIZE, identify: IdentifyRoundPlan = { size, fill: [] }): Promise<Round | null> {
  // Grammar and sentence gaps practice the session's own words. Pictures can fill up from the learner's other words,
  // Read and Say it and Writing only prefer the session's words, and a text needs none: a slot reached before any answer
  // still has them.
  if (!entryIds.length && (kind === 'forms' || kind === 'cloze' || kind === 'cloze-typed' || (kind === 'identify' && !identify.fill.length))) return null;
  try {
    if (kind === 'forms') {
      const r = await post<{ items: FormsItem[]; tables?: Record<string, Paradigm> }>('/api/practice/forms/batch', { language, scope: 'entries', entryIds, size });
      return r.items.length ? { kind, items: r.items, tables: new Map(Object.entries(r.tables ?? {}).map(([k, v]) => [Number(k), v])) } : null;
    }
    if (kind === 'cloze' || kind === 'cloze-typed') {
      const r = await post<{ items: ClozeItem[] }>('/api/practice/cloze/batch', { language, scope: 'entries', entryIds, size, choices: kind === 'cloze' });
      return r.items.length ? { kind, items: r.items } : null;
    }
    if (kind === 'identify') {
      // The session's words first; while the session owes Identify questions, the server fills up from the words being
      // learned, then all the learner's words, in the same request.
      const r = await post<{ items: IdentifyItem[] }>('/api/practice/identify/batch', {
        language,
        scope: 'entries',
        entryIds,
        size: identify.size,
        choices: difficulty !== 'challenging',
        ...(identify.fill.length ? { fill: identify.fill } : {}),
      });
      const own = new Set(entryIds);
      return r.items.length ? { kind, items: r.items, mine: r.items.some((i) => own.has(i.entryId)), others: r.items.some((i) => !own.has(i.entryId)) } : null;
    }
    if (kind === 'writing') {
      // One sentence at the learner's writing level, one using the session's words when there is one; none left skips
      // the round.
      const next = await post<WritingNext>('/api/practice/writing/next', { language, ...(entryIds.length ? { entryIds } : {}) });
      return next.sentence ? { kind, next } : null;
    }
    if (kind === 'comprehension') {
      // One text at the learner's reading level, not tied to the session's words: a short everyday text, which is quick
      // between exercises, or a longer passage when no short one is left at that level; none left skips the round.
      const next = (k: 'short' | 'long') => post<ComprehensionNext>('/api/practice/comprehension/next', { language, kind: k });
      const short = await next('short');
      if (short.passage && !short.fallback) return { kind, next: short };
      const long = await next('long');
      if (long.passage && !long.fallback) return { kind, next: long };
      const other = short.passage ? short : long.passage ? long : null;
      return other ? { kind, next: other } : null;
    }
    const r = await post<{ items: ReadItem[] }>('/api/practice/read/batch', { language, mode: kind, size, entryIds });
    return r.items.length ? { kind, items: r.items } : null;
  } catch {
    return null;
  }
}

/** A finished round: its kind and the grade of each answer (questions, for a reading text). */
export interface RoundResult {
  kind: RoundKind;
  grades: string[];
}

/**
 * A practice slot inside a study session, in the session's own chrome (the page names its type); `onAnswer` gets the
 * grade of each answer as it is given.
 */
export function PracticeRound({
  round,
  language,
  onAnswer,
  onDone,
  id,
  busy = false,
}: {
  round: Round;
  language: LanguageCode;
  onAnswer: (grade: string) => void;
  onDone: (r: RoundResult) => void;
  /** The slot's id in the session's plan. */
  id?: string;
  /** The slot is over and what comes next is being fetched: it stays on screen until then. */
  busy?: boolean;
}) {
  const [phase, setPhase] = useState<'review' | 'run'>(round.kind === 'forms' ? 'review' : 'run');
  const [tables, setTables] = useState<Map<number, Paradigm>>(round.kind === 'forms' ? round.tables : new Map());
  const finish = (results: Array<{ grade: string }>) => onDone({ kind: round.kind, grades: results.map((r) => r.grade) });
  return (
    <section aria-label="Practice" data-round={round.kind} data-round-id={id} aria-busy={busy || undefined}>
      {/* Where the pictures come from, when not only from this session's words. */}
      {round.kind === 'identify' && round.others && <p className="hint mb-4">{round.mine ? 'With words from this session and others of yours.' : 'With other words of yours.'}</p>}
      {round.kind === 'forms' ? (
        phase === 'review' ? (
          <FormsReview embedded language={language} items={round.items} tables={tables} onStart={() => setPhase('run')} />
        ) : (
          <FormsRunner embedded language={language} items={round.items} tables={tables} setTables={setTables} onAnswer={onAnswer} onDone={finish} />
        )
      ) : (
        <RoundRunner round={round} language={language} onAnswer={onAnswer} onDone={finish} />
      )}
    </section>
  );
}

function RoundRunner({
  round,
  language,
  onAnswer,
  onDone,
}: {
  round: Exclude<Round, { kind: 'forms' }>;
  language: LanguageCode;
  onAnswer: (grade: string) => void;
  onDone: (results: Array<{ grade: string }>) => void;
}) {
  switch (round.kind) {
    case 'cloze':
    case 'cloze-typed':
      return <ClozeRunner embedded language={language} items={round.items} onAnswer={onAnswer} onDone={onDone} />;
    case 'identify':
      return <IdentifyRunner embedded language={language} items={round.items} onAnswer={onAnswer} onDone={onDone} />;
    case 'read':
    case 'say':
      return <ReadRunner embedded language={language} mode={round.kind} items={round.items} onAnswer={onAnswer} onDone={onDone} />;
    case 'comprehension':
      return <ComprehensionRunner embedded language={language} kind={round.next.kind} initial={round.next} onAnswer={onAnswer} onDone={onDone} />;
    case 'writing':
      return <WritingRunner embedded language={language} initial={round.next} onAnswer={onAnswer} onDone={(grades) => onDone(grades.map((grade) => ({ grade })))} />;
  }
}
