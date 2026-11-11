// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// The personal memory model (2.0.0): the optimizer's memory steps against the scheduler's, and fits on synthetic
// learners whose true parameters are known: one whose memories grow more slowly than the standard model says (the
// fit must be better on reviews it has not seen, and move toward the truth), one who follows the standard model (the
// fit must not be taken), and one with too few reviews.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PARAMETERS, FsrsScheduler, seededRandom, type FsrsCardState, type Rating } from '../../shared/fsrs.ts';
import {
  countTestReviews,
  FIT_MIN_GAIN,
  FIT_MIN_REVIEWS,
  FIT_MIN_Z,
  fitParameters,
  PARAMETER_LOWER,
  PARAMETER_UPPER,
  predictions,
  scoreParameters,
  type CardHistory,
} from '../../shared/fsrs-optimizer.ts';

const DAY = 86_400_000;
const START = Date.parse('2026-01-05T08:00:00Z');

/**
 * A learner whose memory follows FSRS-6 with `truth`, studying with the app's scheduler on the standard parameters:
 * each card gets a first rating, then is reviewed when due (sometimes a day or two late), remembered with the
 * probability the true model gives.
 */
function learner(truth: readonly number[], cards: number, days: number, seed: number): CardHistory[] {
  const rand = seededRandom(seed);
  const app = new FsrsScheduler({ enableFuzzing: false });
  const mind = new FsrsScheduler({ parameters: truth, enableFuzzing: false });
  const out: CardHistory[] = [];
  const blank = (): FsrsCardState => ({ state: 0, step: null, stability: null, difficulty: null, due: null, lastReview: null });
  for (let c = 0; c < cards; c++) {
    let shown = blank();
    let real = blank();
    let at = START + Math.floor(rand() * days * 0.6) * DAY + Math.floor(rand() * 3_600_000);
    const first = rand();
    let rating: Rating = first < 0.15 ? 1 : first < 0.4 ? 2 : 3;
    const history: Array<{ rating: Rating; reviewedAt: number }> = [];
    while (at < START + days * DAY) {
      history.push({ rating, reviewedAt: at });
      shown = app.review(shown, rating, at).card;
      real = mind.review(real, rating, at).card;
      // The next review: when the app says it is due, now and then late.
      at = shown.due! + (rand() < 0.3 ? Math.ceil(rand() * 2) * DAY : 0) + Math.floor(rand() * 3_600_000);
      const remembered = rand() < mind.retrievability(real, at);
      rating = !remembered ? 1 : rand() < 0.15 ? 2 : 3;
    }
    out.push(history);
  }
  return out;
}

test('the optimizer predicts what the scheduler predicts, same-day reviews included', () => {
  const rand = seededRandom(7);
  for (const parameters of [DEFAULT_PARAMETERS, DEFAULT_PARAMETERS.map((w, i) => (i < 4 ? w * 0.5 : i === 8 ? 1.2 : i === 20 ? 0.3 : w))]) {
    const sched = new FsrsScheduler({ parameters, enableFuzzing: false });
    const histories: CardHistory[] = [];
    for (let c = 0; c < 40; c++) {
      let at = START + c * 3_600_000;
      const h: Array<{ rating: Rating; reviewedAt: number }> = [];
      for (let i = 0; i < 12; i++) {
        h.push({ rating: (1 + Math.floor(rand() * 4)) as Rating, reviewedAt: at });
        // Some reviews on the same day, some hours short of a whole day, some weeks later.
        at += rand() < 0.2 ? Math.floor(rand() * 20 * 3_600_000) : Math.floor((0.9 + rand() * 30) * DAY);
      }
      histories.push(h);
    }
    const mine = predictions(parameters, histories);
    histories.forEach((h, c) => {
      const { outcomes } = sched.replay(h);
      const expected = outcomes.map((o, index) => ({ index, o })).filter(({ o }) => o.elapsedDays != null && o.elapsedDays >= 1);
      assert.equal(mine[c].length, expected.length);
      expected.forEach(({ index, o }, k) => {
        assert.equal(mine[c][k].index, index);
        assert.ok(Math.abs(mine[c][k].retrievability - o.retrievability!) < 1e-12, `card ${c}, review ${index}: ${mine[c][k].retrievability} vs ${o.retrievability}`);
      });
    });
    assert.equal(countTestReviews(histories), mine.reduce((n, p) => n + p.length, 0));
  }
});

test('a learner whose memories grow more slowly than the standard model says gets a model that predicts unseen reviews better', async () => {
  // Each success lengthens a memory less than for the average learner, so the standard intervals come too late.
  const truth = DEFAULT_PARAMETERS.map((w, i) => (i === 8 ? 1.0 : w));
  const histories = learner(truth, 500, 150, 13);
  assert.ok(countTestReviews(histories) >= FIT_MIN_REVIEWS, `only ${countTestReviews(histories)} reviews`);
  let paused = 0;
  const fit = await fitParameters(histories, { pause: async () => void paused++ });
  assert.equal(fit.status, 'better');
  assert.ok(paused >= 60, 'the fit pauses between its steps');
  const { parameters, standard, fitted } = fit;
  assert.ok(parameters && standard && fitted);
  // Judged on the latest fifth of the reviews, which the fit did not see.
  assert.ok(standard.reviews >= fit.reviews * 0.15 && standard.reviews <= fit.reviews * 0.25, `${standard.reviews} of ${fit.reviews}`);
  assert.equal(fitted.reviews, standard.reviews);
  assert.ok(fitted.logLoss < standard.logLoss * (1 - FIT_MIN_GAIN), `${fitted.logLoss} vs ${standard.logLoss}`);
  assert.ok(fit.z != null && fit.z >= FIT_MIN_Z, `z = ${fit.z}`);
  // The standard model expects more to be remembered than was; the fitted one is closer.
  assert.ok(standard.predicted - standard.recalled > 0.03, `standard: ${standard.predicted} predicted, ${standard.recalled} remembered`);
  assert.ok(Math.abs(fitted.predicted - fitted.recalled) < Math.abs(standard.predicted - standard.recalled) / 2, `fitted: ${fitted.predicted} predicted, ${fitted.recalled} remembered`);
  // Valid parameters, moved toward the truth where the reviews speak: memories grow more slowly.
  assert.equal(parameters.length, 21);
  parameters.forEach((w, i) => assert.ok(w >= PARAMETER_LOWER[i] && w <= PARAMETER_UPPER[i], `parameter ${i}: ${w}`));
  assert.ok(parameters[0] <= parameters[1] && parameters[1] <= parameters[2] && parameters[2] <= parameters[3]);
  assert.ok(parameters[8] < DEFAULT_PARAMETERS[8] - 0.1, `growth of stability: ${parameters[8]}`);
  // On all the reviews the returned parameters are far closer to the learner than the standard ones.
  const all = { standard: scoreParameters(DEFAULT_PARAMETERS, histories), fitted: scoreParameters(parameters, histories), truth: scoreParameters(truth, histories) };
  assert.ok(all.fitted.logLoss < all.standard.logLoss);
  assert.ok(all.fitted.logLoss - all.truth.logLoss < (all.standard.logLoss - all.truth.logLoss) / 2, JSON.stringify(all));
  // The same reviews give the same parameters.
  assert.deepEqual((await fitParameters(histories)).parameters, parameters);
});

test('a learner the standard model already fits keeps it', async () => {
  const histories = learner(DEFAULT_PARAMETERS, 500, 150, 23);
  assert.ok(countTestReviews(histories) >= FIT_MIN_REVIEWS);
  const fit = await fitParameters(histories);
  assert.equal(fit.status, 'not_better');
  assert.equal(fit.parameters, null);
  assert.ok(fit.standard && fit.fitted);
  // The standard model is already close: what it expects is what happened.
  assert.ok(Math.abs(fit.standard.predicted - fit.standard.recalled) < 0.03, `${fit.standard.predicted} predicted, ${fit.standard.recalled} remembered`);
});

test('too few reviews: no fit is tried', async () => {
  const histories = learner(DEFAULT_PARAMETERS, 40, 60, 5);
  const n = countTestReviews(histories);
  assert.ok(n > 0 && n < FIT_MIN_REVIEWS);
  assert.deepEqual(await fitParameters(histories), { status: 'too_few', reviews: n, needed: FIT_MIN_REVIEWS, parameters: null, standard: null, fitted: null, z: null });
  // A lower minimum (for tests) lets the same reviews through.
  assert.notEqual((await fitParameters(histories, { minReviews: 50 })).status, 'too_few');
});
