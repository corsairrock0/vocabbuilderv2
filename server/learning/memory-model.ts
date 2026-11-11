// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
/**
 * The learner's own memory model (2.0.0): the FSRS-6 parameters fitted to their reviews in one language.
 *
 * The scheduler starts with the standard parameters, which describe an average learner. Every review is logged with
 * its rating and time, so once there are enough of them the parameters can be fitted to this learner
 * (shared/fsrs-optimizer.ts). The fit is taken into use only when it predicts the learner's latest reviews, which it
 * has not seen, better than the standard parameters do. Then every word of the language is rescheduled from its
 * whole review history with the new parameters (as after a change of the retention target), so the dates change at
 * once. A later fit that is not better puts the standard parameters back, so the model in use is always what the
 * latest check found. Going back to the standard model reschedules in the same way; nothing is lost either way,
 * because the review log is the truth and the schedule is always recomputed from it.
 *
 * The parameters and the last fit's result are language settings (fsrsParameters, fsrsFit) that only this module
 * writes, so every device sees them.
 */
import type { App } from '../app.ts';
import type { Db } from '../db/database.ts';
import { HttpError } from '../http/http.ts';
import { DEFAULT_PARAMETERS, type Rating } from '../../shared/fsrs.ts';
import { FIT_MIN_REVIEWS, fitParameters, type CardHistory } from '../../shared/fsrs-optimizer.ts';
import type { LanguageCode } from '../../shared/languages.ts';
import type { MemoryFit, MemoryModelChange, MemoryModelStatus } from '../../shared/settings.ts';
import { endOfLocalDay } from '../../shared/time.ts';
import { getLanguageSettings, getTimezone, updateLanguageSettings } from '../services/settings.ts';
import { rescheduleLanguage, validParameters } from './scheduling.ts';

/** Reviews that test the model: review_logs keeps the whole days since the review before. */
function testReviews(db: Db, language: LanguageCode): number {
  return db.get<{ n: number }>('SELECT COUNT(*) AS n FROM review_logs WHERE language_code = ? AND elapsed_days >= 1', language)!.n;
}

export function memoryModelStatus(app: App, language: LanguageCode): MemoryModelStatus {
  const settings = getLanguageSettings(app.db, language);
  const parameters = validParameters(settings.fsrsParameters);
  return {
    language,
    model: parameters ? 'personal' : 'standard',
    reviews: testReviews(app.db, language),
    needed: FIT_MIN_REVIEWS,
    lastFit: settings.fsrsFit,
    parameters: parameters ?? [...DEFAULT_PARAMETERS],
  };
}

/** Every card's reviews in this language, oldest first. */
function histories(db: Db, language: LanguageCode): CardHistory[] {
  const out: Array<Array<{ rating: Rating; reviewedAt: number }>> = [];
  let card = -1;
  for (const r of db.all<{ card_id: number; rating: Rating; reviewed_at: number }>(
    'SELECT card_id, rating, reviewed_at FROM review_logs WHERE language_code = ? ORDER BY card_id, reviewed_at, id',
    language,
  )) {
    if (r.card_id !== card) {
      out.push([]);
      card = r.card_id;
    }
    out[out.length - 1].push({ rating: r.rating, reviewedAt: r.reviewed_at });
  }
  return out;
}

/** Words with a memory due by the end of today. */
function dueToday(db: Db, language: LanguageCode, now: number, tz: string): number {
  return db.get<{ n: number }>(
    `SELECT COUNT(DISTINCT c.item_id) AS n FROM fsrs_cards c JOIN learning_items li ON li.id = c.item_id
      WHERE c.language_code = ? AND li.status = 'active' AND c.state != 0 AND c.due IS NOT NULL AND c.due < ?`,
    language,
    endOfLocalDay(now, tz),
  )!.n;
}

/** Set the parameters (null: the standard ones) and what the fit found, and reschedule the language from its review log. */
function use(app: App, language: LanguageCode, parameters: number[] | null, fit: MemoryFit | null, now: number, deviceId: string | null): { rescheduled: number; dueBefore: number; dueAfter: number } {
  const db = app.db;
  const tz = getTimezone(db, app.config.defaultTimezone);
  return db.tx(() => {
    const dueBefore = dueToday(db, language, now, tz);
    const before = validParameters(getLanguageSettings(db, language).fsrsParameters);
    updateLanguageSettings(db, language, { fsrsParameters: parameters, fsrsFit: fit }, now, deviceId);
    const changed = JSON.stringify(before) !== JSON.stringify(parameters);
    const rescheduled = changed ? rescheduleLanguage(db, language) : 0;
    return { rescheduled, dueBefore, dueAfter: dueToday(db, language, now, tz) };
  });
}

const running = new Set<LanguageCode>();

/**
 * Fit the model to the learner's reviews in this language, and use it when it predicts their latest reviews better
 * than the standard model. The fit runs in steps that let other requests through.
 */
export async function fitMemoryModel(app: App, language: LanguageCode, now: number, deviceId: string | null): Promise<MemoryModelChange> {
  if (running.has(language)) throw new HttpError(409, 'fit_running', 'The model is already being fitted for this language.');
  running.add(language);
  try {
    const fit = await fitParameters(histories(app.db, language), { pause: () => new Promise<void>((resolve) => setImmediate(resolve)) });
    if (fit.status === 'too_few') return { ...memoryModelStatus(app, language), outcome: 'too_few', rescheduled: 0, dueBefore: 0, dueAfter: 0, settings: getLanguageSettings(app.db, language) };
    const record: MemoryFit = {
      at: now,
      status: fit.status,
      reviews: fit.reviews,
      judgedOn: fit.standard!.reviews,
      recalled: fit.standard!.recalled,
      standardPredicted: fit.standard!.predicted,
      fittedPredicted: fit.fitted!.predicted,
      standardLoss: fit.standard!.logLoss,
      fittedLoss: fit.fitted!.logLoss,
    };
    // Not better: the standard parameters are in use from here on (they replace an earlier fit, which the latest
    // reviews no longer bear out), and the result is kept to show.
    const personal = !!validParameters(getLanguageSettings(app.db, language).fsrsParameters);
    const change = use(app, language, fit.status === 'better' ? fit.parameters : null, record, now, deviceId);
    const outcome = fit.status === 'better' ? 'fitted' : personal ? 'reverted' : 'kept';
    return { ...memoryModelStatus(app, language), outcome, ...change, settings: getLanguageSettings(app.db, language) };
  } finally {
    running.delete(language);
  }
}

/** Back to the standard parameters. */
export function resetMemoryModel(app: App, language: LanguageCode, now: number, deviceId: string | null): MemoryModelChange {
  if (running.has(language)) throw new HttpError(409, 'fit_running', 'The model is being fitted for this language. Try again in a moment.');
  const change = use(app, language, null, null, now, deviceId);
  return { ...memoryModelStatus(app, language), outcome: 'reset', ...change, settings: getLanguageSettings(app.db, language) };
}
