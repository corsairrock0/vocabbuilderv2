// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// The learner's own memory model (2.0.0, server/learning/memory-model.ts): a language's reviews, written by the app's
// own scheduler for a synthetic learner, fitted through the API. Covered: the state before a fit; a learner whose
// memories grow more slowly than the standard model says gets the fitted model, every card rescheduled from its
// history and new reviews scheduled with it; the way back to the standard model restores every card exactly; a
// learner the standard model fits keeps it, with the result on record, and a fit in use that the check no longer
// bears out gives way to the standard model; too few reviews change nothing; the parameters cannot be set through the
// settings API; and the statistics use the model in use.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Client, startTestServer, type TestServer } from '../helpers/harness.ts';
import type { Db } from '../../server/db/database.ts';
import { applyReview, ensureCards, getCard, schedulerFor } from '../../server/learning/scheduling.ts';
import { getLanguageSettings, getTimezone } from '../../server/services/settings.ts';
import { DEFAULT_PARAMETERS, FsrsScheduler, seededRandom, type FsrsCardState, type Rating } from '../../shared/fsrs.ts';
import { FIT_MIN_REVIEWS, PARAMETER_LOWER, PARAMETER_UPPER } from '../../shared/fsrs-optimizer.ts';
import type { LanguageCode } from '../../shared/languages.ts';
import { localDay } from '../../shared/time.ts';

const DAY = 86_400_000;
const HOUR = 3_600_000;
let srv: TestServer;
let c: Client;
let db: Db;
let tz: string;
/** The learners studied from this day on, a fixed one, so the same reviews are fitted whenever the tests run. */
const START = Date.UTC(2026, 0, 5, 8);

/** Memories that grow more slowly after each success than the standard model says. */
const SLOW = DEFAULT_PARAMETERS.map((w, i) => (i === 8 ? 1.0 : w));

const doc = (language: LanguageCode, words: number) => ({
  format: 'vocabbuilder-v1',
  language,
  source: { name: `Memory model test set (${language})`, kind: 'curated', license: 'CC0-1.0' },
  entries: Array.from({ length: words }, (_, i) => ({ lemma: `palabra${String(i).padStart(3, '0')}`, pos: 'noun', senses: [{ gloss: `thing ${i}` }] })),
});

async function load(language: LanguageCode, words: number): Promise<number[]> {
  const up = await c.post(`/api/import/upload?lang=${language}&kind=vocabulary&filename=set.json`, Buffer.from(JSON.stringify(doc(language, words))), { 'Content-Type': 'application/octet-stream' });
  assert.equal(up.status, 200, JSON.stringify(up.body));
  const commit = await c.post(`/api/import/${up.body.id}/commit`, { mapping: {}, options: {} });
  assert.equal(commit.status, 200, JSON.stringify(commit.body));
  return db.all<{ id: number }>('SELECT id FROM vocabulary_entries WHERE language_code = ? ORDER BY id', language).map((r) => r.id);
}

/**
 * A learner whose memory follows FSRS-6 with `truth` studies the words for `days` days with the app as it is: a first
 * session rates both memories of a word, then one of them is reviewed when the app says it is due (now and then a day
 * or two late) and remembered with the probability the true model gives. Every event goes through applyReview, so the
 * cards and the review log are the app's own.
 */
function study(language: LanguageCode, entries: number[], truth: readonly number[], days: number, seed: number): void {
  const rand = seededRandom(seed);
  const mind = new FsrsScheduler({ parameters: truth, enableFuzzing: false });
  const start = START;
  const end = start + days * DAY;
  const now = Date.now();
  db.tx(() => {
    entries.forEach((entryId, n) => {
      let at = start + Math.floor(rand() * days * 0.6) * DAY + Math.floor(rand() * HOUR);
      db.run('INSERT INTO learning_items (entry_id, language_code, status, introduced_at, introduced_day, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', entryId, language, 'active', at, localDay(at, tz), now, now);
      const itemId = db.get<{ id: number }>('SELECT id FROM learning_items WHERE entry_id = ?', entryId)!.id;
      ensureCards(db, itemId, language, now);
      const first = rand();
      let rating: Rating = first < 0.15 ? 1 : first < 0.4 ? 2 : 3;
      const skill = n % 2 ? 'productive' : 'receptive';
      let real: FsrsCardState = { state: 0, step: null, stability: null, difficulty: null, due: null, lastReview: null };
      const review = (which: 'receptive' | 'productive', source: 'aggregate' | 'auto') => {
        const change = applyReview(db, { card: getCard(db, itemId, which)!, rating, reviewedAt: at, timezone: tz, opId: `sim:${randomUUID()}`, ratingSource: source, exerciseKind: null, attemptId: null, sessionId: null, deviceId: null, now });
        assert.ok(change, `review of entry ${entryId} (${which})`);
      };
      // The first session: both memories get their first rating.
      review('receptive', 'aggregate');
      review('productive', 'aggregate');
      real = mind.review(real, rating, at).card;
      for (;;) {
        // When the app says it is due, now and then a day or two late, at the card's own time of day.
        at = getCard(db, itemId, skill)!.due! + (rand() < 0.3 ? Math.ceil(rand() * 2) * DAY : 0);
        if (at >= end) break;
        const remembered = rand() < mind.retrievability(real, at);
        rating = !remembered ? 1 : rand() < 0.15 ? 2 : 3;
        review(skill, 'auto');
        real = mind.review(real, rating, at).card;
      }
    });
  });
}

const cards = (language: LanguageCode) =>
  db.all<{ id: number; state: number; stability: number; difficulty: number; due: number; scheduled_days: number; reps: number; lapses: number }>(
    'SELECT id, state, stability, difficulty, due, scheduled_days, reps, lapses FROM fsrs_cards WHERE language_code = ? AND state != 0 ORDER BY id',
    language,
  );
const model = async (language: LanguageCode) => (await c.get(`/api/languages/${language}/memory-model`)).body;

before(async () => {
  srv = await startTestServer();
  c = new Client(srv.url);
  await c.setup();
  db = srv.app.db;
  tz = getTimezone(db, srv.config.defaultTimezone);
  study('es', await load('es', 400), SLOW, 150, 13);
  study('pt', await load('pt', 400), DEFAULT_PARAMETERS, 150, 23);
  study('pl', await load('pl', 30), DEFAULT_PARAMETERS, 60, 5);
});
after(async () => {
  await srv.cleanup();
});

test('before a fit: the standard model, and how many reviews there are of the number needed', async () => {
  const es = await model('es');
  assert.equal(es.model, 'standard');
  assert.equal(es.needed, FIT_MIN_REVIEWS);
  assert.equal(es.lastFit, null);
  assert.deepEqual(es.parameters, [...DEFAULT_PARAMETERS]);
  // The reviews that test the model: each at least a day after the review before it (the first ratings are not).
  const logs = db.get<{ all: number; later: number }>("SELECT COUNT(*) AS 'all', SUM(elapsed_days >= 1) AS later FROM review_logs WHERE language_code = 'es'")!;
  assert.equal(es.reviews, logs.later);
  assert.ok(es.reviews >= FIT_MIN_REVIEWS && es.reviews < logs.all, `${es.reviews} of ${logs.all}`);
  const pl = await model('pl');
  assert.ok(pl.reviews > 0 && pl.reviews < FIT_MIN_REVIEWS);
  assert.equal((await c.get('/api/languages/xx/memory-model')).status, 404);
});

test('a learner the standard model does not fit gets their own: used at once, every card rescheduled, and undone exactly by going back', async () => {
  const before = cards('es');
  const logBefore = db.all<{ id: number; retrievability_before: number | null; stability_after: number }>("SELECT id, retrievability_before, stability_after FROM review_logs WHERE language_code = 'es' ORDER BY id");
  const tradeoffBefore = (await c.get('/api/stats/retention/es')).body;

  const r = await c.post('/api/languages/es/memory-model/fit', {});
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const fit = r.body;
  assert.equal(fit.outcome, 'fitted');
  assert.equal(fit.model, 'personal');
  // What the fit found, on the latest fifth of the reviews: the standard model expected more to be remembered than
  // was, the fitted one is closer, and its error is lower.
  const f = fit.lastFit;
  assert.equal(f.status, 'better');
  assert.equal(f.reviews, fit.reviews);
  assert.ok(f.judgedOn >= f.reviews * 0.15 && f.judgedOn <= f.reviews * 0.25, `${f.judgedOn} of ${f.reviews}`);
  assert.ok(f.fittedLoss < f.standardLoss * 0.99, `${f.fittedLoss} vs ${f.standardLoss}`);
  assert.ok(f.standardPredicted - f.recalled > 0.03 && Math.abs(f.fittedPredicted - f.recalled) < f.standardPredicted - f.recalled, JSON.stringify(f));
  // The parameters: 21 valid numbers, kept as the language's setting and sent to every device.
  assert.equal(fit.parameters.length, 21);
  fit.parameters.forEach((w: number, i: number) => assert.ok(w >= PARAMETER_LOWER[i] && w <= PARAMETER_UPPER[i], `parameter ${i}: ${w}`));
  assert.notDeepEqual(fit.parameters, [...DEFAULT_PARAMETERS]);
  assert.deepEqual(getLanguageSettings(db, 'es').fsrsParameters, fit.parameters);
  assert.deepEqual(fit.settings.fsrsParameters, fit.parameters);
  const boot = (await c.get('/api/bootstrap')).body;
  assert.deepEqual(boot.languageSettings.es.fsrsParameters, fit.parameters);
  assert.equal(boot.languageSettings.es.fsrsFit.status, 'better');
  assert.equal(boot.languageSettings.pt.fsrsParameters, null);

  // Every card was rescheduled from its history with the new parameters: what a scheduler with them gives.
  const afterFit = cards('es');
  assert.equal(fit.rescheduled, before.length);
  assert.equal(afterFit.length, before.length);
  const sched = new FsrsScheduler({ parameters: fit.parameters, desiredRetention: getLanguageSettings(db, 'es').desiredRetention });
  assert.deepEqual([...schedulerFor(db, 'es').config.parameters], fit.parameters);
  let moved = 0;
  for (const [i, card] of afterFit.entries()) {
    const logs = db.all<{ rating: Rating; reviewed_at: number }>('SELECT rating, reviewed_at FROM review_logs WHERE card_id = ? ORDER BY reviewed_at, id', card.id);
    const { card: expected } = sched.replay(logs.map((l) => ({ rating: l.rating, reviewedAt: l.reviewed_at })), () => () => 0.5);
    assert.ok(Math.abs(card.stability - expected.stability!) < 1e-9 && Math.abs(card.difficulty - expected.difficulty!) < 1e-9, `card ${card.id}`);
    assert.equal(card.reps, logs.length);
    if (Math.abs(card.stability - before[i].stability) > 1e-6) moved++;
  }
  assert.ok(moved > before.length / 2, `${moved} of ${before.length} cards changed`);
  // The log's own figures follow the model in use, so the statistics compare its predictions with the answers.
  const logAfter = db.all<{ id: number; retrievability_before: number | null; stability_after: number }>("SELECT id, retrievability_before, stability_after FROM review_logs WHERE language_code = 'es' ORDER BY id");
  assert.equal(logAfter.length, logBefore.length);
  assert.ok(logAfter.some((l, i) => l.retrievability_before != null && Math.abs(l.retrievability_before - logBefore[i].retrievability_before!) > 1e-6));
  // Memories that grow more slowly mean shorter intervals: more words are due today than before.
  assert.ok(fit.dueAfter >= fit.dueBefore, `${fit.dueBefore} → ${fit.dueAfter}`);
  // The workload forecast says which model it used.
  const tradeoff = (await c.get('/api/stats/retention/es')).body;
  assert.match(tradeoffBefore.note, /standard FSRS-6 parameters/);
  assert.match(tradeoff.note, /your memory model/);
  assert.notDeepEqual(tradeoff.options, tradeoffBefore.options);

  // A review given now is scheduled with the fitted parameters.
  const due = db.get<{ id: number; item_id: number; skill: 'receptive' | 'productive' }>("SELECT id, item_id, skill FROM fsrs_cards WHERE language_code = 'es' AND state = 2 AND due < ? ORDER BY due LIMIT 1", Date.now())!;
  const state = getCard(db, due.item_id, due.skill)!;
  const now = Date.now();
  const change = applyReview(db, { card: state, rating: 3, reviewedAt: now, timezone: tz, opId: `after:${randomUUID()}`, ratingSource: 'auto', exerciseKind: null, attemptId: null, sessionId: null, deviceId: null, now });
  assert.ok(change);
  const expected = sched.review({ state: 2, step: state.step, stability: state.stability, difficulty: state.difficulty, due: state.due, lastReview: state.last_review }, 3, now, () => 0.5);
  assert.ok(Math.abs(getCard(db, due.item_id, due.skill)!.stability! - expected.card.stability!) < 1e-9);
  // (Take that review out again, so the way back can be compared with the start.)
  db.run("DELETE FROM review_logs WHERE op_id LIKE 'after:%'");

  // The model's state says so, and a second fit on the same reviews finds the same.
  const status = await model('es');
  assert.equal(status.model, 'personal');
  assert.deepEqual(status.parameters, fit.parameters);
  const again = (await c.post('/api/languages/es/memory-model/fit', {})).body;
  assert.equal(again.outcome, 'fitted');
  assert.deepEqual(again.parameters, fit.parameters);

  // Back to the standard model: every card is as it was before the fit.
  const reset = await c.post('/api/languages/es/memory-model/reset', {});
  assert.equal(reset.status, 200, JSON.stringify(reset.body));
  assert.equal(reset.body.outcome, 'reset');
  assert.equal(reset.body.model, 'standard');
  assert.equal(reset.body.lastFit, null);
  assert.equal(reset.body.rescheduled, before.length);
  assert.equal(getLanguageSettings(db, 'es').fsrsParameters, null);
  const restored = cards('es');
  for (const [i, card] of restored.entries()) {
    assert.ok(Math.abs(card.stability - before[i].stability) < 1e-9 && Math.abs(card.difficulty - before[i].difficulty) < 1e-9, `card ${card.id}: ${card.stability} vs ${before[i].stability}`);
    assert.equal(card.due, before[i].due, `due date of card ${card.id}`);
    assert.equal(card.scheduled_days, before[i].scheduled_days);
  }
  // Going back twice changes nothing more.
  assert.equal((await c.post('/api/languages/es/memory-model/reset', {})).body.rescheduled, 0);
});

test('a learner the standard model fits keeps it, and the result is on record', async () => {
  const before = cards('pt');
  const r = await c.post('/api/languages/pt/memory-model/fit', {});
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.outcome, 'kept');
  assert.equal(r.body.model, 'standard');
  assert.equal(r.body.rescheduled, 0);
  assert.deepEqual(r.body.parameters, [...DEFAULT_PARAMETERS]);
  assert.equal(r.body.lastFit.status, 'not_better');
  assert.ok(Math.abs(r.body.lastFit.standardPredicted - r.body.lastFit.recalled) < 0.03, JSON.stringify(r.body.lastFit));
  assert.equal(getLanguageSettings(db, 'pt').fsrsParameters, null);
  assert.equal(getLanguageSettings(db, 'pt').fsrsFit!.status, 'not_better');
  assert.deepEqual(cards('pt'), before);

  // With fitted parameters in use (here: put there by hand, and the cards rescheduled with them), the same check
  // finds a fit no better than the standard model and puts the standard model back: every card as it was.
  const { rescheduleLanguage } = await import('../../server/learning/scheduling.ts');
  db.run("INSERT INTO language_settings (language_code, key, value, updated_at) VALUES ('pt', 'fsrsParameters', ?, 1) ON CONFLICT(language_code, key) DO UPDATE SET value = excluded.value", JSON.stringify(SLOW));
  rescheduleLanguage(db, 'pt');
  assert.equal((await model('pt')).model, 'personal');
  assert.notDeepEqual(cards('pt').map((c) => c.stability), before.map((c) => c.stability));
  const back = await c.post('/api/languages/pt/memory-model/fit', {});
  assert.equal(back.status, 200, JSON.stringify(back.body));
  assert.equal(back.body.outcome, 'reverted');
  assert.equal(back.body.model, 'standard');
  assert.equal(back.body.rescheduled, before.length);
  assert.equal(back.body.lastFit.status, 'not_better');
  assert.equal(getLanguageSettings(db, 'pt').fsrsParameters, null);
  const restored = cards('pt');
  for (const [i, card] of restored.entries()) {
    assert.ok(Math.abs(card.stability - before[i].stability) < 1e-9, `card ${card.id}`);
    assert.equal(card.due, before[i].due);
  }
});

test('too few reviews: nothing is fitted or changed', async () => {
  const before = cards('pl');
  const r = await c.post('/api/languages/pl/memory-model/fit', {});
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.outcome, 'too_few');
  assert.equal(r.body.model, 'standard');
  assert.equal(r.body.lastFit, null);
  assert.ok(r.body.reviews < r.body.needed);
  assert.deepEqual(cards('pl'), before);
});

test('the parameters are the server’s to set: the settings API refuses them', async () => {
  const r = await c.put('/api/languages/es/settings', { fsrsParameters: DEFAULT_PARAMETERS.map((w) => w * 2) });
  assert.equal(r.status, 422);
  const fit = await c.put('/api/languages/es/settings', { fsrsFit: null });
  assert.equal(fit.status, 422);
  assert.equal(getLanguageSettings(db, 'es').fsrsParameters, null);
  // Stored parameters that are not 21 numbers in range are ignored: the standard model schedules.
  db.run("INSERT INTO language_settings (language_code, key, value, updated_at) VALUES ('vi', 'fsrsParameters', ?, ?)", JSON.stringify([1, 2, 3]), Date.now());
  assert.deepEqual([...schedulerFor(db, 'vi').config.parameters], [...DEFAULT_PARAMETERS]);
  assert.equal((await model('vi')).model, 'standard');
});
