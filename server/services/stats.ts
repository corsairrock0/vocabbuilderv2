// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
/**
 * Learning statistics. Observed accuracy (what happened) is always reported separately from
 * estimated recall probability (FSRS model prediction); neither is presented as proof of proficiency.
 */
import type { Db } from '../db/database.ts';
import { simulateWorkload, type FsrsScheduler } from '../../shared/fsrs.ts';
import { schedulerFor, validParameters } from '../learning/scheduling.ts';
import { KINDS, MATURE_STABILITY_DAYS, SKILLS, type ExerciseKind } from '../../shared/exercises.ts';
import { LANGUAGE_CODES, LANGUAGES, type LanguageCode } from '../../shared/languages.ts';
import { dayAnswers, emptyDay, isStudyDay, PRACTICE_MODES, streak, type DayActivity } from '../../shared/stats.ts';
import type { LanguageStats } from '../../shared/types.ts';
import { addDays, endOfLocalDay, localDay, startOfLocalDay } from '../../shared/time.ts';
import { getLanguageSettings } from './settings.ts';

const DAY = 86_400_000;

/** SQL list of the practice modes, so practice queries use the (language, mode, time) index. */
export const PRACTICE_MODE_SQL = `(${PRACTICE_MODES.map((m) => `'${m}'`).join(', ')})`;

/**
 * Study per local day from `firstDay` on, in one language or in all: session figures and study time from daily_stats,
 * practice answers from practice_attempts and writing_attempts (Writing sentences count as practice answers), reading
 * texts from comprehension_attempts. Every answer is in exactly one of these, so the figures add up without counting
 * anything twice. Days without study are left out.
 */
export function activityByDay(db: Db, language: LanguageCode | null, firstDay: string, tz: string): Map<string, DayActivity> {
  const langs = JSON.stringify(language ? [language] : LANGUAGE_CODES);
  const since = startOfLocalDay(firstDay, tz);
  const out = new Map<string, DayActivity>();
  const day = (d: string) => out.get(d) ?? out.set(d, emptyDay(d)).get(d)!;
  for (const r of db.all<{ d: string; ms: number; n: number; ok: number; rev: number; intro: number }>(
    `SELECT local_day AS d, SUM(study_ms) AS ms, SUM(attempts) AS n, SUM(correct) AS ok, SUM(reviews) AS rev, SUM(introduced) AS intro
       FROM daily_stats WHERE language_code IN (SELECT value FROM json_each(?)) AND local_day >= ? GROUP BY local_day`,
    langs,
    firstDay,
  )) {
    Object.assign(day(r.d), { studyMs: r.ms ?? 0, sessionAnswers: r.n ?? 0, sessionCorrect: r.ok ?? 0, reviews: r.rev ?? 0, introduced: r.intro ?? 0 });
  }
  // Read from the (language, local day) index alone (migration 0006).
  for (const r of db.all<{ d: string; n: number }>(
    `SELECT local_day AS d, COUNT(*) AS n FROM practice_attempts
      WHERE language_code IN (SELECT value FROM json_each(?)) AND local_day >= ? GROUP BY local_day`,
    langs,
    firstDay,
  )) {
    day(r.d).practice = r.n;
  }
  for (const r of db.all<{ d: string; n: number }>(
    `SELECT local_day AS d, COUNT(*) AS n FROM writing_attempts
      WHERE language_code IN (SELECT value FROM json_each(?)) AND local_day >= ? GROUP BY local_day`,
    langs,
    firstDay,
  )) {
    day(r.d).practice += r.n;
  }
  for (const r of db.all<{ d: string; texts: number; q: number }>(
    `SELECT local_day AS d, COUNT(*) AS texts, SUM(total) AS q FROM comprehension_attempts
      WHERE language_code IN (SELECT value FROM json_each(?)) AND answered_at >= ? GROUP BY local_day`,
    langs,
    since,
  )) {
    if (r.d >= firstDay) Object.assign(day(r.d), { texts: r.texts, questions: r.q ?? 0 });
  }
  for (const [d, a] of out) if (!isStudyDay(a)) out.delete(d);
  return out;
}

/** The days with any study, for streaks. */
function studyDays(days: Map<string, DayActivity>): Set<string> {
  return new Set(days.keys());
}

/** How far back `recent` (activityByDay from today − RECENT_DAYS) looks; a longer streak is followed up to 400 days. */
const RECENT_DAYS = 60;

function streakOf(db: Db, language: LanguageCode | null, today: string, tz: string, recent: Map<string, DayActivity>): number {
  const n = streak(studyDays(recent), today);
  // A streak reaching the start of the recent days may go back further: only then read the longer history.
  return n < RECENT_DAYS ? n : streak(studyDays(activityByDay(db, language, addDays(today, -400), tz)), today);
}

/** Days in a row with study in one language (or all), as on Home: ending today, or yesterday when today has none yet. */
export function streakDays(db: Db, language: LanguageCode | null, today: string, tz: string): number {
  return streakOf(db, language, today, tz, activityByDay(db, language, addDays(today, -RECENT_DAYS), tz));
}

/**
 * The first local day anything was studied in a language, by the rule of isStudyDay (study time, a session answer or
 * new word, a practice answer, a text), or null. Days before it are not days a daily goal was missed.
 */
export function firstStudyDay(db: Db, language: LanguageCode): string | null {
  return (
    db.get<{ d: string | null }>(
      `SELECT MIN(d) AS d FROM (
         SELECT MIN(local_day) AS d FROM daily_stats WHERE language_code = ? AND (study_ms > 0 OR attempts > 0 OR introduced > 0)
         UNION ALL SELECT MIN(local_day) FROM practice_attempts WHERE language_code = ?
         UNION ALL SELECT MIN(local_day) FROM comprehension_attempts WHERE language_code = ?
         UNION ALL SELECT MIN(local_day) FROM writing_attempts WHERE language_code = ?)`,
      language,
      language,
      language,
      language,
    )?.d ?? null
  );
}

/** When the language was last studied: a session answer, a practice answer or a text read (index lookups only). */
function lastStudiedAt(db: Db, language: LanguageCode, sessions: number | null): number | null {
  const times = [sessions ?? 0];
  for (const mode of PRACTICE_MODES) {
    times.push(db.get<{ t: number | null }>('SELECT MAX(answered_at) AS t FROM practice_attempts WHERE language_code = ? AND mode = ?', language, mode)?.t ?? 0);
  }
  times.push(db.get<{ t: number | null }>('SELECT MAX(answered_at) AS t FROM comprehension_attempts WHERE language_code = ?', language)?.t ?? 0);
  times.push(db.get<{ t: number | null }>('SELECT MAX(answered_at) AS t FROM writing_attempts WHERE language_code = ?', language)?.t ?? 0);
  const t = Math.max(...times);
  return t > 0 ? t : null;
}

export function languageStats(db: Db, language: LanguageCode, now: number, tz: string): LanguageStats {
  const today = localDay(now, tz);
  const endToday = endOfLocalDay(now, tz);
  const counts = db.get<any>(
    `SELECT
       (SELECT COUNT(*) FROM vocabulary_entries WHERE language_code = ? AND deleted_at IS NULL) AS total,
       (SELECT COUNT(*) FROM learning_items li JOIN vocabulary_entries e ON e.id = li.entry_id WHERE li.language_code = ? AND li.status IN ('introduced','active') AND e.deleted_at IS NULL) AS introduced,
       (SELECT COUNT(*) FROM learning_items li JOIN vocabulary_entries e ON e.id = li.entry_id AND e.deleted_at IS NULL JOIN fsrs_cards r ON r.item_id = li.id AND r.skill = 'receptive'
          WHERE li.language_code = ? AND li.status = 'active' AND r.reps >= 2 AND r.stability >= 3) AS learned,
       (SELECT COUNT(*) FROM learning_items li JOIN vocabulary_entries e ON e.id = li.entry_id AND e.deleted_at IS NULL JOIN fsrs_cards r ON r.item_id = li.id AND r.skill = 'receptive'
          WHERE li.language_code = ? AND li.status = 'active' AND r.stability >= ${MATURE_STABILITY_DAYS}) AS mature,
       (SELECT COUNT(*) FROM learning_items li JOIN vocabulary_entries e ON e.id = li.entry_id AND e.deleted_at IS NULL JOIN fsrs_cards r ON r.item_id = li.id AND r.skill = 'receptive'
          JOIN fsrs_cards p ON p.item_id = li.id AND p.skill = 'productive'
          WHERE li.language_code = ? AND li.status = 'active' AND r.stability >= ${MATURE_STABILITY_DAYS} AND p.stability >= ${MATURE_STABILITY_DAYS}) AS mastered,
       (SELECT COUNT(*) FROM learning_items li JOIN vocabulary_entries e ON e.id = li.entry_id AND e.deleted_at IS NULL
          WHERE li.language_code = ? AND li.status = 'known') AS marked_known,
       (SELECT COUNT(*) FROM vocabulary_entries e LEFT JOIN learning_items li ON li.entry_id = e.id
          WHERE e.language_code = ? AND e.deleted_at IS NULL AND (li.id IS NULL OR li.status = 'new')) AS new_available,
       (SELECT COUNT(*) FROM learning_items li WHERE li.language_code = ? AND li.status = 'active' AND (li.is_difficult = 1 OR li.times_forgotten >= 3)) AS difficult,
       (SELECT MAX(last_studied_at) FROM learning_items WHERE language_code = ?) AS last_studied`,
    language, language, language, language, language, language, language, language, language,
  );
  const due = db.get<any>(
    `SELECT COUNT(DISTINCT c.item_id) AS items, SUM(c.skill = 'receptive') AS receptive, SUM(c.skill = 'productive') AS productive
       FROM fsrs_cards c JOIN learning_items li ON li.id = c.item_id JOIN vocabulary_entries e ON e.id = li.entry_id
      WHERE c.language_code = ? AND c.state != 0 AND c.due < ? AND li.status = 'active' AND e.deleted_at IS NULL`,
    language,
    endToday,
  );
  const byDay = activityByDay(db, language, addDays(today, -RECENT_DAYS), tz);
  const todayRow = byDay.get(today);
  const last7 = [...byDay.values()].filter((d) => d.day > addDays(today, -7));
  const att7 = last7.reduce((s, d) => s + d.sessionAnswers, 0);
  const cor7 = last7.reduce((s, d) => s + d.sessionCorrect, 0);
  const skillAcc = db.all<{ skill: string; n: number; ok: number }>(
    "SELECT skill, COUNT(*) AS n, SUM(grade = 'correct' OR (grade = 'self' AND COALESCE(self_rating, 0) >= 2)) AS ok FROM exercise_attempts WHERE language_code = ? AND answered_at > ? AND kind != 'intro' GROUP BY skill",
    language,
    now - 30 * DAY,
  );
  const acc = (skills: string[]) => {
    const rows = skillAcc.filter((r) => skills.includes(r.skill));
    const n = rows.reduce((s, r) => s + r.n, 0);
    return n >= 5 ? rows.reduce((s, r) => s + r.ok, 0) / n : null;
  };
  const activity14d = Array.from({ length: 14 }, (_, i) => {
    const day = addDays(today, i - 13);
    const r = byDay.get(day);
    return { day, minutes: Math.round((r?.studyMs ?? 0) / 60000), reviews: r?.reviews ?? 0, answers: r ? dayAnswers(r) : 0 };
  });
  return {
    total: counts.total,
    introduced: counts.introduced,
    learned: counts.learned,
    // The Progress page's definitions (shared/progress.ts): known = learned or marked known; being learned = met, not
    // yet learned. Learned words are among the introduced ones, so the difference is exactly the words still learning.
    known: counts.learned + counts.marked_known,
    learning: counts.introduced - counts.learned,
    mature: counts.mature,
    mastered: counts.mastered,
    due: due?.items ?? 0,
    dueReceptive: due?.receptive ?? 0,
    dueProductive: due?.productive ?? 0,
    newAvailable: counts.new_available,
    difficult: counts.difficult,
    studiedTodayMs: todayRow?.studyMs ?? 0,
    reviewsToday: todayRow?.reviews ?? 0,
    introducedToday: todayRow?.introduced ?? 0,
    practiceToday: todayRow?.practice ?? 0,
    textsToday: todayRow?.texts ?? 0,
    accuracy7d: att7 >= 5 ? cor7 / att7 : null,
    listeningAccuracy: acc(['listening']),
    recognitionAccuracy: acc(['recognition', 'comprehension']),
    productionAccuracy: acc(['recall', 'production']),
    lastStudiedAt: lastStudiedAt(db, language, counts.last_studied ?? null),
    streakDays: streakOf(db, language, today, tz, byDay),
    firstStudyDay: firstStudyDay(db, language),
    activity14d,
  };
}

/** All languages together: time today and this week, the streak, and today's reviews, new words, practice and texts. */
export function overview(db: Db, now: number, tz: string) {
  const today = localDay(now, tz);
  const weekStart = addDays(today, -6);
  const days = activityByDay(db, null, addDays(today, -RECENT_DAYS), tz);
  const t = days.get(today);
  const endToday = endOfLocalDay(now, tz);
  const dueTotal =
    db.get<{ n: number }>(
      "SELECT COUNT(DISTINCT c.item_id) AS n FROM fsrs_cards c JOIN learning_items li ON li.id = c.item_id WHERE c.state != 0 AND c.due < ? AND li.status = 'active'",
      endToday,
    )?.n ?? 0;
  return {
    todayMs: t?.studyMs ?? 0,
    weekMs: [...days.values()].filter((d) => d.day >= weekStart).reduce((s, d) => s + d.studyMs, 0),
    streakDays: streakOf(db, null, today, tz, days),
    reviewsToday: t?.reviews ?? 0,
    introducedToday: t?.introduced ?? 0,
    practiceToday: t?.practice ?? 0,
    textsToday: t?.texts ?? 0,
    dueTotal,
  };
}

export function detailedStats(db: Db, language: LanguageCode, now: number, tz: string, rangeDays = 90) {
  const since = now - rangeDays * DAY;
  const today = localDay(now, tz);
  const sched = schedulerFor(db, language);

  // Skills: per-item evidence aggregated across the language.
  const skills = SKILLS.map((skill) => {
    const r = db.get<any>(
      `SELECT COUNT(*) AS items, SUM(attempts) AS attempts, SUM(correct) AS correct, SUM(delayed_correct > 0) AS demonstrated
         FROM skill_evidence se JOIN learning_items li ON li.id = se.item_id WHERE li.language_code = ? AND se.skill = ?`,
      language,
      skill,
    );
    return {
      skill,
      itemsWithEvidence: r?.items ?? 0,
      attempts: r?.attempts ?? 0,
      accuracy: r?.attempts ? (r.correct ?? 0) / r.attempts : null,
      itemsDemonstratedAfterDelay: r?.demonstrated ?? 0,
    };
  });

  const byKind = db
    .all<any>(
      // Self-rated exercises (say it aloud, shadowing, own sentences) succeed with a rating of Hard or better,
      // as in the skills figures above; counting only grade = 'correct' showed them as 0%.
      `SELECT kind, COUNT(*) AS n, SUM(grade = 'correct' OR (grade = 'self' AND COALESCE(self_rating, 0) >= 2)) AS ok,
         SUM(grade = 'close') AS close FROM exercise_attempts
        WHERE language_code = ? AND answered_at > ? AND kind != 'intro' GROUP BY kind ORDER BY n DESC`,
      language,
      since,
    )
    .map((r) => ({ kind: r.kind as ExerciseKind, label: KINDS[r.kind as ExerciseKind]?.label ?? r.kind, attempts: r.n, accuracy: r.n ? r.ok / r.n : null, close: r.close }));

  const tiers = [
    [1, 500],
    [501, 1000],
    [1001, 2000],
    [2001, 5000],
    [5001, 10000],
    [10001, 1e9],
  ].map(([lo, hi]) => {
    const r = db.get<any>(
      `SELECT COUNT(*) AS total, SUM(li.status IN ('introduced','active')) AS introduced, SUM(li.status = 'active' AND r.reps >= 2 AND r.stability >= 3) AS learned,
              SUM(li.status = 'known') AS marked_known
         FROM vocabulary_entries e LEFT JOIN learning_items li ON li.entry_id = e.id LEFT JOIN fsrs_cards r ON r.item_id = li.id AND r.skill = 'receptive'
        WHERE e.language_code = ? AND e.deleted_at IS NULL AND COALESCE(e.frequency_rank, e.curated_order) BETWEEN ? AND ?`,
      language,
      lo,
      hi,
    );
    // known: as on the Progress page, learned or marked known.
    return {
      label: hi >= 1e9 ? `${lo}+` : `${lo}–${hi}`,
      total: r?.total ?? 0,
      introduced: r?.introduced ?? 0,
      learned: r?.learned ?? 0,
      known: (r?.learned ?? 0) + (r?.marked_known ?? 0),
    };
  }).filter((t) => t.total > 0);
  const unranked = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM vocabulary_entries WHERE language_code = ? AND deleted_at IS NULL AND frequency_rank IS NULL AND curated_order IS NULL', language)!.n;

  const missed = db.all<any>(
    `SELECT e.id AS entryId, COALESCE(e.display, e.lemma) AS lemma, (SELECT gloss FROM vocabulary_senses s WHERE s.entry_id = e.id ORDER BY sense_order LIMIT 1) AS gloss,
            SUM(a.grade = 'incorrect') AS misses, COUNT(*) AS attempts
       FROM exercise_attempts a JOIN learning_items li ON li.id = a.item_id JOIN vocabulary_entries e ON e.id = li.entry_id
      WHERE a.language_code = ? AND a.answered_at > ? AND a.kind != 'intro'
      GROUP BY e.id HAVING misses > 0 ORDER BY misses DESC, attempts DESC LIMIT 20`,
    language,
    since,
  );

  // Every day of study: session answers (reviews among them), practice answers and reading texts, each counted once.
  const byDay = activityByDay(db, language, addDays(today, -(Math.max(rangeDays, 30) - 1)), tz);
  const historyDays = Math.min(rangeDays, 90);
  const history = Array.from({ length: historyDays }, (_, i) => {
    const day = addDays(today, i - historyDays + 1);
    const d = byDay.get(day) ?? emptyDay(day);
    return {
      day,
      minutes: Math.round(d.studyMs / 60000),
      reviews: d.reviews,
      introduced: d.introduced,
      attempts: d.sessionAnswers,
      accuracy: d.sessionAnswers ? d.sessionCorrect / d.sessionAnswers : null,
      practice: d.practice,
      texts: d.texts,
      questions: d.questions,
      answers: dayAnswers(d),
    };
  });

  // Retention: model estimate vs observed delayed recall.
  const receptive = estimatedRecall(db, language, 'receptive', now, sched);
  const estimated = receptive.value;
  const observed = db.get<any>(
    "SELECT COUNT(*) AS n, SUM(rating > 1) AS ok FROM review_logs WHERE language_code = ? AND reviewed_at > ? AND rating_source != 'aggregate' AND COALESCE(elapsed_days, 0) >= 1",
    language,
    now - 30 * DAY,
  );
  const estimatedProd = estimatedRecall(db, language, 'productive', now, sched).value;

  // Efficiency. Study time is sessions (their practice rounds included) and the Practice pages.
  const last30 = [...byDay.values()].filter((d) => d.day > addDays(today, -30));
  const ms30 = last30.reduce((s, d) => s + d.studyMs, 0);
  const delayedOk = observed?.ok ?? 0;
  const sessions = db.get<any>(
    "SELECT COUNT(*) AS n, AVG(active_ms) AS avg_ms FROM study_sessions WHERE language_code = ? AND status IN ('completed','abandoned') AND created_at > ?",
    language,
    now - 30 * DAY,
  );

  // 14-day due forecast.
  const forecast = Array.from({ length: 14 }, (_, i) => {
    const day = addDays(today, i);
    const start = i === 0 ? 0 : startOfLocalDay(day, tz);
    const end = startOfLocalDay(addDays(day, 1), tz);
    const n = db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM fsrs_cards c JOIN learning_items li ON li.id = c.item_id WHERE c.language_code = ? AND c.state != 0 AND li.status = 'active' AND c.due >= ? AND c.due < ?",
      language,
      start,
      end,
    )!.n;
    return { day, due: n };
  });

  return {
    language,
    name: LANGUAGES[language].name,
    summary: languageStats(db, language, now, tz),
    skills,
    byKind,
    frequencyTiers: tiers,
    unrankedEntries: unranked,
    missed,
    history,
    retention: {
      estimatedReceptive: estimated,
      estimatedProductive: estimatedProd,
      cardsInReview: receptive.cards,
      observedDelayedRecall: observed?.n >= 5 ? delayedOk / observed.n : null,
      observedReviews: observed?.n ?? 0,
      note: 'Estimated recall is the FSRS model’s predicted probability of recalling each word now. Observed delayed recall is the share of reviews (at least one day after the previous one) answered correctly in the last 30 days. Neither is a direct measure of conversational proficiency.',
    },
    efficiency: {
      studyHours30d: ms30 / 3_600_000,
      successfulDelayedRecallsPerHour: ms30 > 10 * 60_000 ? delayedOk / (ms30 / 3_600_000) : null,
      reviewsPerDay30d: last30.reduce((s, d) => s + d.reviews, 0) / 30,
      sessions30d: sessions?.n ?? 0,
      averageSessionMinutes: sessions?.avg_ms ? sessions.avg_ms / 60000 : null,
      introduced30d: last30.reduce((s, d) => s + d.introduced, 0),
      practice30d: last30.reduce((s, d) => s + d.practice, 0),
      texts30d: last30.reduce((s, d) => s + d.texts, 0),
    },
    forecast,
  };
}

/** The FSRS model's average predicted recall now for one memory, over the words in review, and how many there are. */
export function estimatedRecall(db: Db, language: LanguageCode, skill: 'receptive' | 'productive', now: number, sched?: FsrsScheduler): { value: number | null; cards: number } {
  const s = sched ?? schedulerFor(db, language);
  const cards = db.all<{ stability: number; last_review: number }>(
    "SELECT c.stability, c.last_review FROM fsrs_cards c JOIN learning_items li ON li.id = c.item_id WHERE c.language_code = ? AND c.state = 2 AND c.skill = ? AND li.status = 'active'",
    language,
    skill,
  );
  return { value: cards.length ? cards.reduce((sum, c) => sum + s.retrievabilityAt(c.stability, (now - c.last_review) / DAY), 0) / cards.length : null, cards: cards.length };
}

/** Expected workload per 100 words in review for different desired-retention targets. */
export function retentionTradeoff(db: Db, language: LanguageCode) {
  const inReview = db.get<{ n: number }>("SELECT COUNT(*) AS n FROM fsrs_cards WHERE language_code = ? AND state = 2", language)!.n;
  const targets = [0.8, 0.85, 0.9, 0.93, 0.95, 0.97];
  // With the learner's own memory model when one is in use (2.0.0).
  const parameters = validParameters(getLanguageSettings(db, language).fsrsParameters);
  return {
    cardsInReview: inReview,
    options: targets.map((r) => {
      const sim = simulateWorkload({ desiredRetention: r, cards: 150, days: 365, seed: 7, ...(parameters ? { parameters } : {}) });
      return {
        retention: r,
        reviewsPerDayPer100: (sim.reviewsPerDay / 150) * 100,
        reviewsPerDayForYou: inReview ? (sim.reviewsPerDay / 150) * inReview : null,
        reviewsPerWordPerYear: sim.reviewsPerCard,
      };
    }),
    note: `Simulated with ${parameters ? 'your memory model (FSRS-6 fitted to your reviews)' : 'the standard FSRS-6 parameters'} over one year. Higher targets mean more reviews; no single target is optimal for everyone — 0.85–0.92 is a common, practical range.`,
  };
}

export function allLanguageStats(db: Db, now: number, tz: string) {
  return LANGUAGE_CODES.map((code) => ({ code, stats: languageStats(db, code, now, tz) }));
}
