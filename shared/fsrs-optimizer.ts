// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
/**
 * Fitting the FSRS-6 parameters to one learner's reviews (2.0.0).
 *
 * The scheduler (shared/fsrs.ts) predicts, before every review, how likely the learner is to remember the word. With
 * the standard parameters that prediction is right for an average learner. This module finds the parameters under
 * which the predictions fit this learner's own answers best, and says honestly whether they are better:
 *
 *  1. Every review that came at least a day after the one before it is a test of the model: the model gave a
 *     probability, the learner remembered (Hard, Good, Easy) or did not (Again). The error is the log loss.
 *  2. The reviews are split by time. The parameters are fitted on the earlier four fifths, and judged on the latest
 *     fifth, which they have not seen. Only when they predict those better than the standard parameters, by at least
 *     FIT_MIN_GAIN and by more than chance explains (review by review, FIT_MIN_Z standard errors), are parameters
 *     fitted on all the reviews returned for use.
 *  3. The fit follows the FSRS optimizer's method: the four initial stabilities first, each from the second reviews of
 *     the words first rated that way; then all 21 parameters together by gradient descent (Adam) on the log loss, in
 *     batches of cards, with a pull toward the starting values so that few reviews move the model little.
 *
 * The memory steps below repeat FsrsScheduler's (same-day reviews included) without its dates, states and intervals;
 * tests/unit/fsrs-optimizer.test.ts checks that both give the same predictions. Everything is deterministic: the same
 * reviews give the same parameters.
 */
import { DEFAULT_PARAMETERS, STABILITY_MIN, seededRandom, wholeDays, type Rating } from './fsrs.ts';

/** Reviews that test the model (at least a day after the one before) needed before a fit is tried. */
export const FIT_MIN_REVIEWS = 1000;
/** The share of the log loss on the latest reviews a fit must save to be used (0.01: one percent). */
export const FIT_MIN_GAIN = 0.01;
/**
 * And how sure that saving must be: the mean saving per review, over its standard error (1.5: chance alone gives such
 * a saving about once in fifteen tries). A few hundred reviews cannot show a small gain; more reviews can.
 */
export const FIT_MIN_Z = 1.5;
/** The share of the reviews, the latest ones, kept aside to judge the fit. */
export const FIT_HOLDOUT = 0.2;

const INITIAL_STABILITY_MAX = 100;
/** The range of each parameter (those of py-fsrs 6.3.0). */
export const PARAMETER_LOWER: readonly number[] = Object.freeze([
  STABILITY_MIN, STABILITY_MIN, STABILITY_MIN, STABILITY_MIN, 1, 0.001, 0.001, 0.001, 0, 0, 0.001, 0.001, 0.001, 0.001, 0, 0, 1, 0, 0, 0, 0.1,
]);
export const PARAMETER_UPPER: readonly number[] = Object.freeze([
  INITIAL_STABILITY_MAX, INITIAL_STABILITY_MAX, INITIAL_STABILITY_MAX, INITIAL_STABILITY_MAX, 10, 4, 4, 0.75, 4.5, 0.8, 3.5, 5, 0.25, 0.9, 4, 1, 6, 2, 2, 0.8, 0.8,
]);
/**
 * How far each parameter may reasonably move: the fit pays (change / spread)² for moving one away from where it
 * started, so a parameter the reviews say little about stays where it was. The figures are the FSRS optimizer's
 * standard deviations of the parameters across learners (open-spaced-repetition/fsrs-optimizer, fsrs-rs).
 */
const SPREAD: readonly number[] = [6.43, 9.66, 17.58, 27.85, 0.57, 0.28, 0.6, 0.12, 0.39, 0.18, 0.33, 0.3, 0.09, 0.16, 0.57, 0.25, 1.03, 0.31, 0.32, 0.14, 0.27];

const BATCH = 512;
const EPOCHS = 5;
const MIN_STEPS = 60;
const LEARNING_RATE = 0.04;
const EPS = 1e-9;

/** One card's reviews in the order they were given. */
export type CardHistory = ReadonlyArray<{ rating: Rating; reviewedAt: number }>;

interface Card {
  ratings: Uint8Array;
  /** Whole days since the review before (−1 for the first). */
  days: Int32Array;
  at: Float64Array;
}

function prepare(histories: readonly CardHistory[]): Card[] {
  const cards: Card[] = [];
  for (const h of histories) {
    if (!h.length) continue;
    const sorted = [...h].sort((a, b) => a.reviewedAt - b.reviewedAt);
    const ratings = new Uint8Array(sorted.length);
    const days = new Int32Array(sorted.length);
    const at = new Float64Array(sorted.length);
    sorted.forEach((r, i) => {
      ratings[i] = r.rating;
      at[i] = r.reviewedAt;
      days[i] = i === 0 ? -1 : Math.max(0, wholeDays(r.reviewedAt - sorted[i - 1].reviewedAt));
    });
    cards.push({ ratings, days, at });
  }
  return cards;
}

/** The sum of the log loss, of the predictions and of the right answers over the test reviews dated in (after, upTo]. */
interface Tally {
  n: number;
  loss: number;
  predicted: number;
  recalled: number;
}

function clampD(d: number): number {
  return Math.min(Math.max(d, 1), 10);
}

/**
 * Run the model over cards and tally its predictions against the answers. `each` gets every prediction (for tests).
 * The steps are FsrsScheduler's: initial stability and difficulty, the same-day stability, the stability after a
 * success or a lapse, and the difficulty with its mean reversion.
 */
function run(w: readonly number[], cards: readonly Card[], after: number, upTo: number, each?: (card: number, index: number, r: number) => void): Tally {
  const decay = -w[20];
  const factor = 0.9 ** (1 / decay) - 1;
  const easyD = w[4] - Math.exp(w[5] * 3) + 1;
  const lapseCap = Math.exp(w[17] * w[18]);
  const t: Tally = { n: 0, loss: 0, predicted: 0, recalled: 0 };
  for (let c = 0; c < cards.length; c++) {
    const { ratings, days, at } = cards[c];
    let s = Math.max(w[ratings[0] - 1], STABILITY_MIN);
    let d = clampD(w[4] - Math.exp(w[5] * (ratings[0] - 1)) + 1);
    for (let i = 1; i < ratings.length; i++) {
      const g = ratings[i];
      const dt = days[i];
      if (dt < 1) {
        let inc = Math.exp(w[17] * (g - 3 + w[18])) * s ** -w[19];
        if (g >= 3) inc = Math.max(inc, 1);
        s = Math.max(s * inc, STABILITY_MIN);
      } else {
        const r = (1 + (factor * dt) / s) ** decay;
        each?.(c, i, r);
        if (at[i] > after && at[i] <= upTo) {
          const p = Math.min(Math.max(r, EPS), 1 - EPS);
          t.n++;
          t.predicted += r;
          if (g > 1) {
            t.recalled++;
            t.loss -= Math.log(p);
          } else t.loss -= Math.log(1 - p);
        }
        if (g === 1) {
          const longTerm = w[11] * d ** -w[12] * ((s + 1) ** w[13] - 1) * Math.exp((1 - r) * w[14]);
          s = Math.max(Math.min(longTerm, s / lapseCap), STABILITY_MIN);
        } else {
          const grow = Math.exp(w[8]) * (11 - d) * s ** -w[9] * (Math.exp((1 - r) * w[10]) - 1) * (g === 2 ? w[15] : 1) * (g === 4 ? w[16] : 1);
          s = Math.max(s * (1 + grow), STABILITY_MIN);
        }
      }
      d = clampD(w[7] * easyD + (1 - w[7]) * (d + ((10 - d) * -(w[6] * (g - 3))) / 9));
    }
  }
  return t;
}

export interface ModelScore {
  /** Reviews the figures are about. */
  reviews: number;
  /** Mean log loss: lower is better; 0.693 is a coin toss. */
  logLoss: number;
  /** The share the model expected to be remembered, and the share that was. */
  predicted: number;
  recalled: number;
}

function score(t: Tally): ModelScore {
  const n = Math.max(1, t.n);
  return { reviews: t.n, logLoss: t.loss / n, predicted: t.predicted / n, recalled: t.recalled / n };
}

/** How well parameters predict the reviews dated in (after, upTo] (all of them by default). */
export function scoreParameters(parameters: readonly number[], histories: readonly CardHistory[], after = -Infinity, upTo = Infinity): ModelScore {
  return score(run(parameters, prepare(histories), after, upTo));
}

/** The model's prediction before each review that tests it, per card (index of the review, probability of recall). */
export function predictions(parameters: readonly number[], histories: readonly CardHistory[]): Array<Array<{ index: number; retrievability: number }>> {
  const cards = prepare(histories);
  const out: Array<Array<{ index: number; retrievability: number }>> = cards.map(() => []);
  run(parameters, cards, -Infinity, Infinity, (c, i, r) => out[c].push({ index: i, retrievability: r }));
  return out;
}

/** The reviews that test the model: each one at least a whole day after the review before it. */
export function countTestReviews(histories: readonly CardHistory[]): number {
  let n = 0;
  for (const c of prepare(histories)) for (let i = 1; i < c.days.length; i++) if (c.days[i] >= 1) n++;
  return n;
}

// ------------------------------------------------------------------ the fit

/** The four initial stabilities are fitted as logarithms (they span 0.001 to 100); the rest as they are. */
const toTheta = (w: readonly number[]) => w.map((v, i) => (i < 4 ? Math.log(v) : v));
const toW = (theta: readonly number[]) => theta.map((v, i) => (i < 4 ? Math.exp(v) : v));
const clampW = (w: number[]) => w.map((v, i) => Math.min(Math.max(v, PARAMETER_LOWER[i]), PARAMETER_UPPER[i]));

/**
 * The initial stability after each first rating, from the second reviews of the words first rated that way: the
 * stability whose forgetting curve fits how many of them were remembered after how many days, with a light pull
 * toward the standard value. A rating without such reviews takes the standard value scaled like the ratings that
 * have them, and the four are kept in order (Again ≤ Hard ≤ Good ≤ Easy).
 */
function initialStabilities(cards: readonly Card[], upTo: number): number[] {
  const decay = -DEFAULT_PARAMETERS[20];
  const factor = 0.9 ** (1 / decay) - 1;
  // Per first rating: second reviews by whole days, [count, remembered].
  const groups: Array<Map<number, [number, number]>> = [new Map(), new Map(), new Map(), new Map()];
  for (const c of cards) {
    if (c.ratings.length < 2 || c.days[1] < 1 || c.at[1] > upTo) continue;
    const g = groups[c.ratings[0] - 1];
    const cell = g.get(c.days[1]) ?? [0, 0];
    cell[0]++;
    if (c.ratings[1] > 1) cell[1]++;
    g.set(c.days[1], cell);
  }
  const fitted: Array<number | null> = groups.map((g, i) => {
    let total = 0;
    for (const [n] of g.values()) total += n;
    if (total < 10) return null;
    const loss = (s: number) => {
      let l = Math.abs(s - DEFAULT_PARAMETERS[i]) / 16;
      for (const [dt, [n, ok]] of g) {
        const p = Math.min(Math.max((1 + (factor * dt) / s) ** decay, EPS), 1 - EPS);
        l -= ok * Math.log(p) + (n - ok) * Math.log(1 - p);
      }
      return l;
    };
    // The loss has one minimum in the stability: a ternary search on its logarithm finds it.
    let lo = Math.log(STABILITY_MIN);
    let hi = Math.log(INITIAL_STABILITY_MAX);
    for (let k = 0; k < 200 && hi - lo > 1e-7; k++) {
      const a = lo + (hi - lo) / 3;
      const b = hi - (hi - lo) / 3;
      if (loss(Math.exp(a)) < loss(Math.exp(b))) hi = b;
      else lo = a;
    }
    return Math.exp((lo + hi) / 2);
  });
  const known = fitted.map((s, i) => (s == null ? null : Math.log(s / DEFAULT_PARAMETERS[i]))).filter((x): x is number => x != null);
  const scale = known.length ? Math.exp(known.reduce((a, b) => a + b, 0) / known.length) : 1;
  const out = fitted.map((s, i) => s ?? DEFAULT_PARAMETERS[i] * scale);
  for (let i = 1; i < 4; i++) out[i] = Math.max(out[i], out[i - 1]);
  return out.map((s) => Math.min(Math.max(s, STABILITY_MIN), INITIAL_STABILITY_MAX));
}

/** Fit all the parameters on the reviews up to `upTo`. `pause` is awaited between steps, to let other work through. */
async function train(cards: readonly Card[], upTo: number, pause?: () => Promise<void>): Promise<number[]> {
  const start = clampW([...initialStabilities(cards, upTo), ...DEFAULT_PARAMETERS.slice(4)]);
  // The cards with something to learn from, each with the number of test reviews it brings.
  const useful: Array<{ card: Card; n: number }> = [];
  let total = 0;
  for (const card of cards) {
    let n = 0;
    for (let i = 1; i < card.days.length; i++) if (card.days[i] >= 1 && card.at[i] <= upTo) n++;
    if (n) {
      useful.push({ card, n });
      total += n;
    }
  }
  if (!total) return start;
  const theta0 = toTheta(start);
  const lower = toTheta(PARAMETER_LOWER);
  const upper = toTheta(PARAMETER_UPPER);
  // The pull toward the start is measured on the parameters themselves, also for the four fitted as logarithms.
  const objective = (theta: readonly number[], batch: readonly Card[], share: number) => {
    const w = toW(theta);
    let penalty = 0;
    for (let i = 0; i < w.length; i++) penalty += ((w[i] - start[i]) / SPREAD[i]) ** 2;
    return run(w, batch, -Infinity, upTo).loss + penalty * share;
  };
  const stepsPerEpoch = Math.ceil(total / BATCH);
  const steps = Math.max(MIN_STEPS, EPOCHS * stepsPerEpoch);
  const rand = seededRandom(20261110);
  let order: number[] = [];
  let next = 0;
  const theta = [...theta0];
  const m = theta.map(() => 0);
  const v = theta.map(() => 0);
  for (let step = 1; step <= steps; step++) {
    // A batch: cards in a shuffled order until they bring BATCH test reviews.
    const batch: Card[] = [];
    let n = 0;
    while (n < BATCH && batch.length < useful.length) {
      if (next >= order.length) {
        order = useful.map((_, i) => i);
        for (let i = order.length - 1; i > 0; i--) {
          const j = Math.floor(rand() * (i + 1));
          [order[i], order[j]] = [order[j], order[i]];
        }
        next = 0;
      }
      const u = useful[order[next++]];
      batch.push(u.card);
      n += u.n;
    }
    const share = n / total;
    // The gradient by central differences: 42 runs over the batch.
    const grad = theta.map((x, i) => {
      const h = 1e-4 * Math.max(1, Math.abs(x));
      const up = [...theta];
      const down = [...theta];
      up[i] = x + h;
      down[i] = x - h;
      return (objective(up, batch, share) - objective(down, batch, share)) / (2 * h);
    });
    // Adam, its rate falling to zero along a cosine.
    const rate = LEARNING_RATE * 0.5 * (1 + Math.cos((Math.PI * (step - 1)) / steps));
    for (let i = 0; i < theta.length; i++) {
      const g = Number.isFinite(grad[i]) ? grad[i] : 0;
      m[i] = 0.9 * m[i] + 0.1 * g;
      v[i] = 0.999 * v[i] + 0.001 * g * g;
      const mh = m[i] / (1 - 0.9 ** step);
      const vh = v[i] / (1 - 0.999 ** step);
      theta[i] = Math.min(Math.max(theta[i] - (rate * mh) / (Math.sqrt(vh) + 1e-8), lower[i]), upper[i]);
    }
    if (pause) await pause();
  }
  const w = clampW(toW(theta));
  for (let i = 1; i < 4; i++) w[i] = Math.max(w[i], w[i - 1]);
  return w.map((x) => Number(x.toFixed(4)));
}

/** The log loss of each test review dated after `after`, in a fixed order (for comparing two models review by review). */
function losses(w: readonly number[], cards: readonly Card[], after: number): number[] {
  const out: number[] = [];
  run(w, cards, -Infinity, Infinity, (c, i, r) => {
    if (cards[c].at[i] <= after) return;
    const p = Math.min(Math.max(r, EPS), 1 - EPS);
    out.push(-Math.log(cards[c].ratings[i] > 1 ? p : 1 - p));
  });
  return out;
}

/** The mean saving per review of `b` over `a`, in standard errors of that mean (0 when there is nothing to compare). */
function savingZ(a: readonly number[], b: readonly number[]): number {
  const n = a.length;
  if (n < 2) return 0;
  let sum = 0;
  let squares = 0;
  for (let i = 0; i < n; i++) {
    const d = a[i] - b[i];
    sum += d;
    squares += d * d;
  }
  const mean = sum / n;
  const variance = (squares - n * mean * mean) / (n - 1);
  return variance > 0 ? mean / Math.sqrt(variance / n) : mean > 0 ? Infinity : 0;
}

export interface FitResult {
  /**
   * too_few: not enough reviews to try. better: the fitted parameters predict the latest reviews better than the
   * standard ones, and `parameters` holds them (fitted on all the reviews). not_better: they do not; keep what is in use.
   */
  status: 'too_few' | 'better' | 'not_better';
  /** Reviews that test the model, and how many are needed. */
  reviews: number;
  needed: number;
  parameters: number[] | null;
  /** On the latest reviews, kept aside: the standard parameters and the fitted ones. */
  standard: ModelScore | null;
  fitted: ModelScore | null;
  /** The fitted parameters' saving per review on those, in standard errors (FIT_MIN_Z are needed). */
  z: number | null;
}

/**
 * Fit the model to a learner's reviews and say whether to use it. `pause`, when given, is awaited between the steps
 * of the fit (a server lets other requests through there).
 */
export async function fitParameters(histories: readonly CardHistory[], opts: { minReviews?: number; pause?: () => Promise<void> } = {}): Promise<FitResult> {
  const needed = opts.minReviews ?? FIT_MIN_REVIEWS;
  const cards = prepare(histories);
  const times: number[] = [];
  for (const c of cards) for (let i = 1; i < c.days.length; i++) if (c.days[i] >= 1) times.push(c.at[i]);
  const none = { parameters: null, standard: null, fitted: null, z: null };
  if (times.length < needed) return { status: 'too_few', reviews: times.length, needed, ...none };
  times.sort((a, b) => a - b);
  // The latest fifth is kept aside. (Reviews at the very moment of the split stay with the earlier ones.)
  const split = times[Math.max(0, Math.floor(times.length * (1 - FIT_HOLDOUT)) - 1)];
  const candidate = await train(cards, split, opts.pause);
  const standard = score(run(DEFAULT_PARAMETERS, cards, split, Infinity));
  const fitted = score(run(candidate, cards, split, Infinity));
  const z = Number(savingZ(losses(DEFAULT_PARAMETERS, cards, split), losses(candidate, cards, split)).toFixed(2));
  const better = standard.reviews > 0 && fitted.logLoss < standard.logLoss * (1 - FIT_MIN_GAIN) && z >= FIT_MIN_Z;
  if (!better) return { status: 'not_better', reviews: times.length, needed, parameters: null, standard, fitted, z };
  const parameters = await train(cards, Infinity, opts.pause);
  return { status: 'better', reviews: times.length, needed, parameters, standard, fitted, z };
}
