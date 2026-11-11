// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
/**
 * Home's "Today's session": what a session started now would hold. The server plans one exactly as Start would and
 * discards it (GET /api/sessions/preview: minutes, reviews, new words and questions per type). While it answers, and
 * without a connection, the figures come from what Home already has: the reviews due today, the new words left for
 * today, the language's session length, and the practice a Comprehensive session of that length plans (shared/mix.ts).
 */
import { useEffect, useState } from 'react';
import type { LanguageCode } from '../../../shared/languages.ts';
import { planPractice, roundType, type QuestionType } from '../../../shared/mix.ts';
import type { LanguageSettings } from '../../../shared/settings.ts';
import { listJoin } from '../../../shared/stats.ts';
import type { LanguageSummary, StudyPreview } from '../../../shared/types.ts';
import { get } from './api.ts';

/** A kind of question Home names; reviews and new words together are "words". */
export type TodaySkill = 'words' | Exclude<QuestionType, 'review' | 'new'>;

export interface TodayPlan {
  minutes: number;
  reviews: number;
  newWords: number;
  /** The kinds of question mixed in, in the start screen's order. */
  skills: TodaySkill[];
  /** Nothing could be planned: why, as Start would say it. */
  empty: string | null;
  /** From the server's plan (false: worked out on this device). */
  planned: boolean;
  /** The server plan's number of questions and its mix by type (absent in a plan worked out here). */
  total?: number;
  parts?: Array<{ type: QuestionType; count: number }>;
}

const ORDER: TodaySkill[] = ['words', 'listening', 'grammar', 'sentences', 'pictures', 'speaking', 'reading', 'writing'];
const PHRASES: Record<TodaySkill, string> = {
  words: 'words',
  listening: 'listening',
  grammar: 'grammar',
  sentences: 'sentences',
  pictures: 'pictures',
  speaking: 'speaking',
  reading: 'one short text',
  writing: 'writing',
};

function skillsOf(types: QuestionType[]): TodaySkill[] {
  const set = new Set<TodaySkill>(types.map((t) => (t === 'review' || t === 'new' ? 'words' : t)));
  return ORDER.filter((s) => set.has(s));
}

/** "Words, listening, grammar, sentences, pictures, speaking and one short text, all in one session." */
export function skillsLine(skills: TodaySkill[]): string {
  if (!skills.length) return '';
  const text = listJoin(skills.map((s) => PHRASES[s]));
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}${skills.length > 1 ? ', all in one session' : ''}.`;
}

export function planFromPreview(p: StudyPreview): TodayPlan {
  return { minutes: p.minutes, reviews: p.reviews, newWords: p.newWords, skills: skillsOf(p.parts.map((x) => x.type)), empty: p.empty, planned: true, total: p.total, parts: p.parts.map((x) => ({ type: x.type, count: x.count })) };
}

/**
 * The plan worked out on this device: today's reviews and the new words left for today (as a quick session takes them),
 * the session length, and a Comprehensive session's practice for that length. `audio`: questions by ear are possible
 * (Forvo recordings or device speech).
 */
export function fallbackPlan(lang: LanguageSummary, settings: LanguageSettings | undefined, audio: boolean): TodayPlan {
  const s = lang.stats;
  const minutes = settings?.sessionMinutes ?? 20;
  const reviews = s.due;
  const newWords = Math.min(s.newAvailable, Math.max(0, (settings?.dailyNewTarget ?? 10) - s.introducedToday));
  const types: QuestionType[] = [];
  if (reviews) types.push('review');
  if (newWords) types.push('new');
  if (audio && reviews + newWords > 0) types.push('listening');
  for (const slot of planPractice({ language: lang.code, minutes, exercises: reviews + newWords })) types.push(roundType(slot.kind));
  return { minutes, reviews, newWords, skills: skillsOf(types), empty: null, planned: false };
}

/** The last plan the server gave per language, shown at once on the next visit while a fresh one loads. */
const lastPlans = new Map<LanguageCode, TodayPlan>();

export function loadTodayPlan(language: LanguageCode, id?: string): Promise<TodayPlan> {
  return get<StudyPreview>(`/api/sessions/preview?lang=${language}&quick=1${id ? `&id=${encodeURIComponent(id)}` : ''}`).then((p) => {
    const plan = planFromPreview(p);
    lastPlans.set(language, plan);
    return plan;
  });
}

/**
 * Today's plan for a language, asked again when what it depends on changes (a session done, words added). `loading`:
 * the figures shown are not the server's latest yet.
 */
export function useTodayPlan(lang: LanguageSummary, settings: LanguageSettings | undefined, audio: boolean, id?: string): { plan: TodayPlan; loading: boolean } {
  const s = lang.stats;
  const key = [lang.code, s.total, s.due, s.newAvailable, s.introducedToday, s.reviewsToday, settings?.sessionMinutes, settings?.dailyNewTarget, id].join(':');
  const [loaded, setLoaded] = useState<{ key: string; plan: TodayPlan | null } | null>(null);
  useEffect(() => {
    let live = true;
    loadTodayPlan(lang.code, id)
      .then((plan) => live && setLoaded({ key, plan }))
      // No answer (offline, or a server without previews): the plan worked out here stands.
      .catch(() => live && setLoaded({ key, plan: null }));
    return () => {
      live = false;
    };
  }, [key]);
  const done = loaded?.key === key;
  const plan = done ? (loaded.plan ?? fallbackPlan(lang, settings, audio)) : (lastPlans.get(lang.code) ?? fallbackPlan(lang, settings, audio));
  return { plan, loading: !done };
}
