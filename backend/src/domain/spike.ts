/**
 * Spike detection (bonus, D15).
 *
 * A spike is only ever *flagged*; it never blocks, reduces or delays a payout.
 * The rule is specified in the build spec Phase 9:
 *
 *   increase       = newViews - previousViews            (only when > 0)
 *   elapsedMinutes = max((now - previousUpdatedAt) / 60000, 1)
 *   ratePerMin     = increase / elapsedMinutes
 *   flagged        = increase >= minDelta AND ratePerMin >= ratePerMinThreshold
 *
 * This module is PURE: no I/O, no `Date.now()`, no environment access. The
 * caller passes `now` and the thresholds, so the rule is deterministic and
 * trivially unit-testable.
 */

/** Observables from one view update. */
export interface SpikeInput {
  /** View count before this update. */
  previousViews: number;
  /** View count reported by this update. */
  newViews: number;
  /** When `previousViews` was recorded (creation time for the first update). */
  previousUpdatedAt: Date;
  /** Current time. */
  now: Date;
}

/** Flag thresholds (configured from env: `SPIKE_MIN_DELTA`, `SPIKE_RATE_PER_MIN`). */
export interface SpikeThresholds {
  /** Minimum absolute view gain required to consider a spike. */
  minDelta: number;
  /** Minimum views-per-minute required to consider a spike. */
  ratePerMin: number;
}

/** Outcome of spike detection. */
export interface SpikeResult {
  flagged: boolean;
  reason?: string;
}

export const DEFAULT_SPIKE_THRESHOLDS: SpikeThresholds = { minDelta: 10000, ratePerMin: 1000 };

/** Milliseconds in one minute. */
const MS_PER_MINUTE = 60_000;

/** Throw `RangeError` unless `value` is a non-negative integer. */
function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer`);
  }
}

/** Throw `TypeError` unless `value` is a valid `Date`. */
function assertValidDate(value: Date, name: string): void {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new TypeError(`${name} must be a valid Date`);
  }
}

/** Throw `RangeError` unless `value` is a finite, positive number. */
function assertPositiveNumber(value: number, name: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive number`);
  }
}

/**
 * Detect anomalously fast view growth (spec Phase 9, D15).
 *
 * Pure and deterministic: the caller supplies `now` and the thresholds. A
 * decrease or an unchanged count never flags. The elapsed window is floored at
 * one minute, which also covers clock skew (`now` earlier than
 * `previousUpdatedAt`) and zero elapsed time.
 *
 * @throws {RangeError} when a view count is not a non-negative integer, or a
 *   threshold is not a positive number.
 * @throws {TypeError} when `previousUpdatedAt` or `now` is not a valid `Date`.
 */
export function detectSpike(
  input: SpikeInput,
  thresholds: SpikeThresholds = DEFAULT_SPIKE_THRESHOLDS,
): SpikeResult {
  assertNonNegativeInteger(input.previousViews, 'previousViews');
  assertNonNegativeInteger(input.newViews, 'newViews');
  assertValidDate(input.previousUpdatedAt, 'previousUpdatedAt');
  assertValidDate(input.now, 'now');
  assertPositiveNumber(thresholds.minDelta, 'thresholds.minDelta');
  assertPositiveNumber(thresholds.ratePerMin, 'thresholds.ratePerMin');

  const increase = input.newViews - input.previousViews;
  if (increase <= 0) {
    return { flagged: false };
  }

  const elapsedMinutes = Math.max(
    (input.now.getTime() - input.previousUpdatedAt.getTime()) / MS_PER_MINUTE,
    1,
  );
  const ratePerMin = increase / elapsedMinutes;

  if (increase < thresholds.minDelta || ratePerMin < thresholds.ratePerMin) {
    return { flagged: false };
  }

  return {
    flagged: true,
    reason: `+${increase} views in ${elapsedMinutes.toFixed(1)} min (${Math.round(ratePerMin)}/min)`,
  };
}
