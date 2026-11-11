// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// The scheduling logic below is a port of py-fsrs 6.3.0 (https://github.com/open-spaced-repetition/py-fsrs),
// Copyright (c) 2022 Open Spaced Repetition, used under the MIT License (full text in THIRD_PARTY_NOTICES.md).
/**
 * FSRS-6 scheduler.
 *
 * A faithful TypeScript port of the scheduling logic of open-spaced-repetition/py-fsrs
 * v6.3.0 (the FSRS-6 model, 21 parameters), which is also the FSRS-6 model shipped by
 * ts-fsrs 5.x and still supported by ts-fsrs 6.x. It is validated in
 * tests/unit/fsrs.test.ts against the py-fsrs 6.3.0 reference fixture (review trace,
 * rescheduling from unsorted logs, interval rounding).
 *
 * Why a port and not the ts-fsrs package: package installation was unavailable in the
 * environment this app was built in. The card/log data model stores complete review
 * history, so cards can be re-scheduled with ts-fsrs (or a newer model such as FSRS-7)
 * later by replaying review logs — see docs/LEARNING_ENGINE.md.
 *
 * Time values are epoch milliseconds (UTC). Day arithmetic matches Python's
 * timedelta.days (floor of elapsed seconds / 86400).
 */

export const FSRS_MODEL = 'FSRS-6';

export const DEFAULT_PARAMETERS: readonly number[] = Object.freeze([
  0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796, 1.4835, 0.0614, 0.2629, 1.6483,
  0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542,
]);

export const STABILITY_MIN = 0.001;
const MIN_DIFFICULTY = 1;
const MAX_DIFFICULTY = 10;
const DAY_MS = 86_400_000;

export const Rating = { Again: 1, Hard: 2, Good: 3, Easy: 4 } as const;
export type Rating = 1 | 2 | 3 | 4;

/** Card state. 0 = never reviewed (stored as "new"; scheduled like py-fsrs Learning step 0). */
export const CardState = { New: 0, Learning: 1, Review: 2, Relearning: 3 } as const;
export type CardState = 0 | 1 | 2 | 3;

export interface FsrsCardState {
  state: CardState;
  step: number | null;
  stability: number | null;
  difficulty: number | null;
  due: number | null;
  lastReview: number | null;
}

export interface SchedulerConfig {
  parameters: readonly number[];
  desiredRetention: number;
  /** Learning steps in seconds (py-fsrs default: [60, 600]). */
  learningSteps: readonly number[];
  /** Relearning steps in seconds (py-fsrs default: [600]). */
  relearningSteps: readonly number[];
  maximumInterval: number;
  enableFuzzing: boolean;
}

export const PY_FSRS_DEFAULT_CONFIG: SchedulerConfig = {
  parameters: DEFAULT_PARAMETERS,
  desiredRetention: 0.9,
  learningSteps: [60, 600],
  relearningSteps: [600],
  maximumInterval: 36500,
  enableFuzzing: true,
};

/**
 * VocabBuilder's configuration. In-session repetition is handled by the session engine
 * as *practice*, and FSRS receives at most one scheduling event per card per day, so no
 * sub-day learning steps are used (see docs/LEARNING_ENGINE.md, "Scheduling policy").
 */
export const APP_DEFAULT_CONFIG: SchedulerConfig = {
  parameters: DEFAULT_PARAMETERS,
  desiredRetention: 0.9,
  learningSteps: [],
  relearningSteps: [],
  maximumInterval: 36500,
  enableFuzzing: true,
};

export interface ReviewOutcome {
  card: FsrsCardState;
  /** Whole days since the previous review (null for the first review). */
  elapsedDays: number | null;
  /** Retrievability immediately before the review (null for the first review). */
  retrievability: number | null;
  /** Interval in whole days when the card is in Review state, otherwise 0. */
  scheduledDays: number;
  /** Interval in milliseconds until the next due time. */
  intervalMs: number;
}

const FUZZ_RANGES = [
  { start: 2.5, end: 7.0, factor: 0.15 },
  { start: 7.0, end: 20.0, factor: 0.1 },
  { start: 20.0, end: Number.POSITIVE_INFINITY, factor: 0.05 },
];

/** Python 3 round(): round half to even. */
export function pyRound(x: number): number {
  const floor = Math.floor(x);
  const diff = x - floor;
  if (diff === 0.5) return floor % 2 === 0 ? floor : floor + 1;
  return Math.round(x);
}

/** Python timedelta(...).days for a millisecond difference (floors toward -infinity). */
export function wholeDays(ms: number): number {
  return Math.floor(ms / DAY_MS);
}

/** Small deterministic PRNG (mulberry32) so rescheduling/replays are reproducible. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function fuzzSeed(cardId: number, reviewedAt: number): number {
  let h = 2166136261 ^ cardId;
  const s = String(reviewedAt);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function validateParameters(p: readonly number[]): void {
  if (p.length !== 21) throw new Error(`FSRS-6 requires 21 parameters, got ${p.length}`);
  for (const v of p) if (!Number.isFinite(v)) throw new Error('FSRS parameters must be finite numbers');
}

export class FsrsScheduler {
  readonly config: SchedulerConfig;
  private readonly w: readonly number[];
  private readonly decay: number;
  private readonly factor: number;

  constructor(config: Partial<SchedulerConfig> = {}) {
    this.config = { ...APP_DEFAULT_CONFIG, ...config };
    validateParameters(this.config.parameters);
    if (!(this.config.desiredRetention > 0 && this.config.desiredRetention < 1)) {
      throw new Error('desiredRetention must be between 0 and 1');
    }
    this.w = this.config.parameters;
    this.decay = -this.w[20];
    this.factor = 0.9 ** (1 / this.decay) - 1;
  }

  /** Probability of recall at `now` (0 if never reviewed). */
  retrievability(card: FsrsCardState, now: number): number {
    if (card.lastReview == null || card.stability == null) return 0;
    const elapsed = Math.max(0, wholeDays(now - card.lastReview));
    return (1 + (this.factor * elapsed) / card.stability) ** this.decay;
  }

  /** Continuous-time retrievability (for statistics; scheduling uses whole days like py-fsrs). */
  retrievabilityAt(stability: number, elapsedDays: number): number {
    return (1 + (this.factor * Math.max(0, elapsedDays)) / stability) ** this.decay;
  }

  /** Interval (whole days) that reaches desired retention for a stability. */
  nextInterval(stability: number, desiredRetention = this.config.desiredRetention): number {
    let ivl = (stability / this.factor) * (desiredRetention ** (1 / this.decay) - 1);
    ivl = pyRound(ivl);
    ivl = Math.max(ivl, 1);
    return Math.min(ivl, this.config.maximumInterval);
  }

  private clampStability(s: number): number {
    return Math.max(s, STABILITY_MIN);
  }

  private clampDifficulty(d: number): number {
    return Math.min(Math.max(d, MIN_DIFFICULTY), MAX_DIFFICULTY);
  }

  initialStability(rating: Rating): number {
    return this.clampStability(this.w[rating - 1]);
  }

  initialDifficulty(rating: Rating, clamp = true): number {
    const d = this.w[4] - Math.E ** (this.w[5] * (rating - 1)) + 1;
    return clamp ? this.clampDifficulty(d) : d;
  }

  shortTermStability(stability: number, rating: Rating): number {
    let inc = Math.E ** (this.w[17] * (rating - 3 + this.w[18])) * stability ** -this.w[19];
    if (rating === Rating.Good || rating === Rating.Easy) inc = Math.max(inc, 1.0);
    return this.clampStability(stability * inc);
  }

  nextDifficulty(difficulty: number, rating: Rating): number {
    const arg1 = this.initialDifficulty(Rating.Easy, false);
    const delta = -(this.w[6] * (rating - 3));
    const arg2 = difficulty + ((10.0 - difficulty) * delta) / 9.0;
    const next = this.w[7] * arg1 + (1 - this.w[7]) * arg2;
    return this.clampDifficulty(next);
  }

  nextStability(difficulty: number, stability: number, retrievability: number, rating: Rating): number {
    let next: number;
    if (rating === Rating.Again) {
      const longTerm =
        this.w[11] *
        difficulty ** -this.w[12] *
        ((stability + 1) ** this.w[13] - 1) *
        Math.E ** ((1 - retrievability) * this.w[14]);
      const shortTerm = stability / Math.E ** (this.w[17] * this.w[18]);
      next = Math.min(longTerm, shortTerm);
    } else {
      const hardPenalty = rating === Rating.Hard ? this.w[15] : 1;
      const easyBonus = rating === Rating.Easy ? this.w[16] : 1;
      next =
        stability *
        (1 +
          Math.E ** this.w[8] *
            (11 - difficulty) *
            stability ** -this.w[9] *
            (Math.E ** ((1 - retrievability) * this.w[10]) - 1) *
            hardPenalty *
            easyBonus);
    }
    return this.clampStability(next);
  }

  private fuzzedIntervalDays(intervalDays: number, rand: () => number): number {
    if (intervalDays < 2.5) return intervalDays;
    let delta = 1.0;
    for (const r of FUZZ_RANGES) delta += r.factor * Math.max(Math.min(intervalDays, r.end) - r.start, 0.0);
    let minIvl = pyRound(intervalDays - delta);
    let maxIvl = pyRound(intervalDays + delta);
    minIvl = Math.max(2, minIvl);
    maxIvl = Math.min(maxIvl, this.config.maximumInterval);
    minIvl = Math.min(minIvl, maxIvl);
    const fuzzed = rand() * (maxIvl - minIvl + 1) + minIvl;
    return Math.min(pyRound(fuzzed), this.config.maximumInterval);
  }

  /**
   * Apply one review. `rand` supplies fuzz randomness (pass a seeded generator for
   * reproducibility); it is only used when fuzzing is enabled and the card ends in Review.
   */
  review(input: FsrsCardState, rating: Rating, now: number, rand: () => number = Math.random): ReviewOutcome {
    if (![1, 2, 3, 4].includes(rating)) throw new Error(`invalid rating ${rating}`);
    const card: FsrsCardState = { ...input };
    if (card.state === CardState.New) {
      card.state = CardState.Learning;
      card.step = 0;
      card.stability = null;
      card.difficulty = null;
    }
    const daysSince = card.lastReview != null ? wholeDays(now - card.lastReview) : null;
    const retrievability = card.lastReview != null ? this.retrievability(card, now) : null;
    const steps = this.config.learningSteps;
    const relearn = this.config.relearningSteps;
    let intervalMs = 0;
    let reviewDays: number | null = null; // whole-day interval when transitioning to/remaining in Review

    const updateMemory = () => {
      if (card.stability == null || card.difficulty == null) {
        card.stability = this.initialStability(rating);
        card.difficulty = this.initialDifficulty(rating);
      } else if (daysSince != null && daysSince < 1) {
        card.stability = this.shortTermStability(card.stability, rating);
        card.difficulty = this.nextDifficulty(card.difficulty, rating);
      } else {
        card.stability = this.nextStability(card.difficulty, card.stability, this.retrievability(card, now), rating);
        card.difficulty = this.nextDifficulty(card.difficulty, rating);
      }
    };

    const stepPhase = (stepList: readonly number[]) => {
      // Shared logic for Learning and Relearning states (py-fsrs v6.3.0).
      const step = card.step ?? 0;
      if (stepList.length === 0 || (step >= stepList.length && rating !== Rating.Again)) {
        card.state = CardState.Review;
        card.step = null;
        reviewDays = this.nextInterval(card.stability!);
        return;
      }
      switch (rating) {
        case Rating.Again:
          card.step = 0;
          intervalMs = stepList[0] * 1000;
          break;
        case Rating.Hard:
          if (step === 0 && stepList.length === 1) intervalMs = stepList[0] * 1.5 * 1000;
          else if (step === 0 && stepList.length >= 2) intervalMs = ((stepList[0] + stepList[1]) / 2.0) * 1000;
          else intervalMs = stepList[step] * 1000;
          break;
        case Rating.Good:
          if (step + 1 === stepList.length) {
            card.state = CardState.Review;
            card.step = null;
            reviewDays = this.nextInterval(card.stability!);
          } else {
            card.step = step + 1;
            intervalMs = stepList[card.step] * 1000;
          }
          break;
        case Rating.Easy:
          card.state = CardState.Review;
          card.step = null;
          reviewDays = this.nextInterval(card.stability!);
          break;
      }
    };

    if (card.state === CardState.Learning) {
      updateMemory();
      stepPhase(steps);
    } else if (card.state === CardState.Review) {
      if (daysSince != null && daysSince < 1) card.stability = this.shortTermStability(card.stability!, rating);
      else card.stability = this.nextStability(card.difficulty!, card.stability!, retrievability!, rating);
      card.difficulty = this.nextDifficulty(card.difficulty!, rating);
      if (rating === Rating.Again && relearn.length > 0) {
        card.state = CardState.Relearning;
        card.step = 0;
        intervalMs = relearn[0] * 1000;
      } else {
        reviewDays = this.nextInterval(card.stability);
      }
    } else if (card.state === CardState.Relearning) {
      updateMemory();
      stepPhase(relearn);
    } else {
      throw new Error(`unknown card state ${String(card.state)}`);
    }

    let scheduledDays = 0;
    if (reviewDays != null) {
      if (this.config.enableFuzzing && card.state === CardState.Review) reviewDays = this.fuzzedIntervalDays(reviewDays, rand);
      scheduledDays = reviewDays;
      intervalMs = reviewDays * DAY_MS;
    }
    card.due = now + intervalMs;
    card.lastReview = now;
    return { card, elapsedDays: daysSince, retrievability, scheduledDays, intervalMs };
  }

  /**
   * Rebuild a card's state from its complete review history (logs may be unsorted).
   * Used for late/offline events and for future model or parameter changes.
   */
  replay(
    reviews: ReadonlyArray<{ rating: Rating; reviewedAt: number }>,
    randFor: (index: number, reviewedAt: number) => () => number = () => Math.random,
  ): { card: FsrsCardState; outcomes: ReviewOutcome[] } {
    const sorted = [...reviews].sort((a, b) => a.reviewedAt - b.reviewedAt);
    let card: FsrsCardState = { state: CardState.New, step: null, stability: null, difficulty: null, due: null, lastReview: null };
    const outcomes: ReviewOutcome[] = [];
    sorted.forEach((r, i) => {
      const out = this.review(card, r.rating, r.reviewedAt, randFor(i, r.reviewedAt));
      outcomes.push(out);
      card = out.card;
    });
    return { card, outcomes };
  }
}

/** Expected review workload for a desired-retention target (simple Monte-Carlo simulation). */
export function simulateWorkload(opts: {
  desiredRetention: number;
  days?: number;
  cards?: number;
  parameters?: readonly number[];
  seed?: number;
  /** Probability distribution of Hard/Good/Easy on successful recalls. */
  successRatings?: { hard: number; good: number; easy: number };
}): { reviewsPerDay: number; averageRetention: number; reviewsPerCard: number } {
  const days = opts.days ?? 365;
  const cards = opts.cards ?? 200;
  const dist = opts.successRatings ?? { hard: 0.15, good: 0.8, easy: 0.05 };
  const rand = seededRandom(opts.seed ?? 42);
  const sched = new FsrsScheduler({ desiredRetention: opts.desiredRetention, enableFuzzing: false, parameters: opts.parameters ?? DEFAULT_PARAMETERS });
  let reviews = 0;
  let retentionSum = 0;
  let retentionSamples = 0;
  const horizon = days * DAY_MS;
  for (let c = 0; c < cards; c++) {
    // New cards are spread over the first 30% of the period.
    let t = Math.floor(rand() * days * 0.3) * DAY_MS;
    let card: FsrsCardState = { state: 0, step: null, stability: null, difficulty: null, due: null, lastReview: null };
    let first = true;
    while (t < horizon) {
      let rating: Rating;
      if (first) {
        rating = 3;
        first = false;
      } else {
        const r = sched.retrievability(card, t);
        retentionSum += r;
        retentionSamples++;
        if (rand() > r) rating = 1;
        else {
          const x = rand();
          rating = x < dist.hard ? 2 : x < dist.hard + dist.good ? 3 : 4;
        }
        reviews++;
      }
      card = sched.review(card, rating, t).card;
      t = card.due!;
    }
  }
  return {
    reviewsPerDay: reviews / days,
    averageRetention: retentionSamples ? retentionSum / retentionSamples : opts.desiredRetention,
    reviewsPerCard: reviews / cards,
  };
}
