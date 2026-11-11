// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
/**
 * The Skills section of the statistics: per language and over a window of local days, the skills a Comprehensive
 * session trains, each from where its answers are stored:
 *   vocabulary            the words being learned and learned, and observed retention of recognition and recall from the
 *                         review log (due reviews a day or more after the previous one), with the model's estimate now;
 *   listening, speaking   session exercises by ear (listen for the meaning, which word, dictation) and said aloud (say
 *                         it, shadowing; self-rated) from exercise_attempts, and the due reviews done that way;
 *   word forms, sentence  practice_attempts (modes forms, cloze, identify, read, say), from the Practice pages and the
 *   gaps, Identify, Read  rounds inside sessions; forms also by case or tense (the cell is stored on each attempt);
 *   and say
 *   reading               comprehension_attempts (one row per text) and the readingLevel language setting.
 * Every figure is aggregated in SQL over an indexed range. Nothing here writes, and none of it touches FSRS.
 */
import type { App } from '../app.ts';
import { KINDS, type ExerciseKind, type Skill } from '../../shared/exercises.ts';
import { READING_LEVELS, type ComprehensionKind, type ReadingLevel } from '../../shared/comprehension.ts';
import type { LanguageCode } from '../../shared/languages.ts';
import { hasParadigms } from '../../shared/paradigms.ts';
import { groupTallies, tally, weakestGroups, WEAKEST_MIN_ANSWERS, windowFirstDay, type RetentionFigure, type SkillStats, type StatsWindow } from '../../shared/stats.ts';
import { localDay, startOfLocalDay } from '../../shared/time.ts';
import { currentReadingLevel, loadComprehension } from '../learning/comprehension.ts';
import { loadIdentify } from '../learning/identify.ts';
import { estimatedRecall, PRACTICE_MODE_SQL } from './stats.ts';

const kindsOf = (skill: Skill) => (Object.keys(KINDS) as ExerciseKind[]).filter((k) => KINDS[k].skill === skill);
/** listen_meaning, listen_choice, dictation */
export const LISTENING_KINDS = kindsOf('listening');
/** speak_flashcard, shadowing */
export const SPEAKING_KINDS = kindsOf('speaking');
const sqlList = (xs: readonly string[]) => `(${xs.map((x) => `'${x}'`).join(', ')})`;
/** Everyday texts first: they are the ones Comprehensive sessions give. */
const KIND_ORDER: ComprehensionKind[] = ['short', 'long'];

export function skillStats(app: App, language: LanguageCode, window: StatsWindow, now: number, tz: string): SkillStats {
  const db = app.db;
  const firstDay = windowFirstDay(window, localDay(now, tz));
  const fromDay = firstDay ?? '0000-01-01';
  const since = firstDay ? startOfLocalDay(firstDay, tz) : 0;

  // Vocabulary: as on the Words page (learning = introduced, or not yet recognised after a delay), now.
  const words = db.get<{ learning: number; learned: number; known: number }>(
    `SELECT COALESCE(SUM(li.status = 'introduced' OR (li.status = 'active' AND (r.state IS NULL OR r.state = 0 OR COALESCE(r.reps, 0) < 2 OR r.stability < 3))), 0) AS learning,
            COALESCE(SUM(li.status = 'active' AND r.reps >= 2 AND r.stability >= 3), 0) AS learned,
            COALESCE(SUM(li.status = 'known'), 0) AS known
       FROM learning_items li
       JOIN vocabulary_entries e ON e.id = li.entry_id AND e.deleted_at IS NULL
       LEFT JOIN fsrs_cards r ON r.item_id = li.id AND r.skill = 'receptive'
      WHERE li.language_code = ?`,
    language,
  )!;
  const retentionRows = db.all<{ skill: string; n: number; ok: number }>(
    `SELECT skill, COUNT(*) AS n, COALESCE(SUM(rating > 1), 0) AS ok FROM review_logs
      WHERE language_code = ? AND local_day >= ? AND rating_source != 'aggregate' AND COALESCE(elapsed_days, 0) >= 1
      GROUP BY skill`,
    language,
    fromDay,
  );
  const retention = (skill: 'receptive' | 'productive'): RetentionFigure => {
    const r = retentionRows.find((x) => x.skill === skill);
    const t = tally(r?.n, r?.ok);
    return { reviews: t.answers, recalled: t.correct, retention: t.accuracy, estimated: estimatedRecall(db, language, skill, now).value };
  };

  // Listening and speaking: the session's exercises by ear and aloud, and the due reviews among them.
  const earAndVoice = [...LISTENING_KINDS, ...SPEAKING_KINDS];
  const exercises = db.all<{ kind: ExerciseKind; n: number; ok: number }>(
    `SELECT kind, COUNT(*) AS n, COALESCE(SUM(grade = 'correct' OR (grade = 'self' AND COALESCE(self_rating, 0) >= 2)), 0) AS ok
       FROM exercise_attempts WHERE language_code = ? AND kind IN ${sqlList(earAndVoice)} AND answered_at >= ? GROUP BY kind`,
    language,
    since,
  );
  const reviewsByKind = db.all<{ kind: ExerciseKind; n: number; ok: number }>(
    `SELECT exercise_kind AS kind, COUNT(*) AS n, COALESCE(SUM(rating > 1), 0) AS ok FROM review_logs
      WHERE language_code = ? AND local_day >= ? AND rating_source != 'aggregate' AND exercise_kind IN ${sqlList(earAndVoice)}
      GROUP BY exercise_kind`,
    language,
    fromDay,
  );
  const sum = (rows: Array<{ kind: ExerciseKind; n: number; ok: number }>, kinds: ExerciseKind[]) => {
    const xs = rows.filter((r) => kinds.includes(r.kind));
    return tally(
      xs.reduce((s, r) => s + r.n, 0),
      xs.reduce((s, r) => s + r.ok, 0),
    );
  };

  // Practice: forms, sentence gaps, Identify, Read and Say it, from the Practice pages and the session rounds.
  const practice = db.all<{ mode: string; n: number; ok: number; understood: number; partly: number; named: number }>(
    `SELECT mode, COUNT(*) AS n, COALESCE(SUM(grade = 'correct'), 0) AS ok, COALESCE(SUM(grade = 'understood'), 0) AS understood,
            COALESCE(SUM(grade = 'partly'), 0) AS partly, COUNT(DISTINCT CASE WHEN grade = 'correct' THEN cell END) AS named
       FROM practice_attempts WHERE language_code = ? AND mode IN ${PRACTICE_MODE_SQL} AND answered_at >= ? GROUP BY mode`,
    language,
    since,
  );
  const mode = (m: string) => practice.find((r) => r.mode === m);
  let forms: SkillStats['forms'] = null;
  if (hasParadigms(language)) {
    // The cell asked for is stored on each attempt; cells add up to their case or tense.
    const groups = groupTallies(
      language,
      db
        .all<{ cell: string | null; n: number; ok: number }>(
          `SELECT cell, COUNT(*) AS n, COALESCE(SUM(grade = 'correct'), 0) AS ok FROM practice_attempts
            WHERE language_code = ? AND mode = 'forms' AND answered_at >= ? GROUP BY cell`,
          language,
          since,
        )
        .map((r) => ({ cell: r.cell, answers: r.n, correct: r.ok })),
    );
    forms = {
      ...tally(mode('forms')?.n, mode('forms')?.ok),
      weakest: weakestGroups(groups, { min: WEAKEST_MIN_ANSWERS }),
      minAnswers: WEAKEST_MIN_ANSWERS,
      rated: groups.filter((g) => g.answers >= WEAKEST_MIN_ANSWERS).length,
    };
  }
  const identify = loadIdentify(app) || mode('identify') ? { ...tally(mode('identify')?.n, mode('identify')?.ok), named: mode('identify')?.named ?? 0 } : null;

  // Reading comprehension: texts count once each (whatever the attempts), questions every time they were answered.
  const readingRows = db.all<{ kind: ComprehensionKind; level: ReadingLevel; texts: number; passed: number; q: number; ok: number }>(
    `SELECT kind, level, COUNT(DISTINCT passage_id) AS texts, COUNT(DISTINCT CASE WHEN passed = 1 THEN passage_id END) AS passed,
            COALESCE(SUM(total), 0) AS q, COALESCE(SUM(correct), 0) AS ok
       FROM comprehension_attempts WHERE language_code = ? AND answered_at >= ? GROUP BY kind, level`,
    language,
    since,
  );
  const anyReading =
    (loadComprehension(app, language)?.passages.length ?? 0) > 0 || !!db.get('SELECT 1 FROM comprehension_attempts WHERE language_code = ? LIMIT 1', language);
  const reading = anyReading
    ? {
        level: currentReadingLevel(app, language),
        texts: readingRows.reduce((s, r) => s + r.texts, 0),
        passed: readingRows.reduce((s, r) => s + r.passed, 0),
        questions: tally(
          readingRows.reduce((s, r) => s + r.q, 0),
          readingRows.reduce((s, r) => s + r.ok, 0),
        ),
        byKind: KIND_ORDER.map((kind) => {
          const levels = READING_LEVELS.map((level) => {
            const r = readingRows.find((x) => x.kind === kind && x.level === level);
            return { level, texts: r?.texts ?? 0, passed: r?.passed ?? 0 };
          }).filter((l) => l.texts > 0);
          return { kind, texts: levels.reduce((s, l) => s + l.texts, 0), passed: levels.reduce((s, l) => s + l.passed, 0), levels };
        }).filter((k) => k.texts > 0),
      }
    : null;

  const studiedAtAll =
    words.learning + words.learned + words.known > 0 ||
    !!db.get(
      `SELECT 1 WHERE EXISTS (SELECT 1 FROM exercise_attempts WHERE language_code = ?) OR EXISTS (SELECT 1 FROM practice_attempts WHERE language_code = ?)
          OR EXISTS (SELECT 1 FROM comprehension_attempts WHERE language_code = ?)`,
      language,
      language,
      language,
    );

  return {
    language,
    window,
    firstDay,
    nothingYet: !studiedAtAll,
    vocabulary: { learning: words.learning, learned: words.learned, known: words.known, recognition: retention('receptive'), recall: retention('productive') },
    listening: { ...sum(exercises, LISTENING_KINDS), reviews: sum(reviewsByKind, LISTENING_KINDS) },
    speaking: { ...sum(exercises, SPEAKING_KINDS), reviews: sum(reviewsByKind, SPEAKING_KINDS) },
    forms,
    cloze: tally(mode('cloze')?.n, mode('cloze')?.ok),
    identify,
    read: { ...tally(mode('read')?.n, mode('read')?.understood), partly: mode('read')?.partly ?? 0 },
    say: tally(mode('say')?.n, mode('say')?.ok),
    reading,
  };
}
