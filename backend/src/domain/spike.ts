/**
 * Spike detection (bonus, D15).
 *
 * A spike is only ever *flagged*; it never blocks, reduces or delays a payout.
 * The rule is specified in the build spec Phase 9 and implemented there; this
 * module currently exposes the stable type + signature so the transactional
 * view-update service (Phase 6) can call it before the rule lands.
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

/**
 * Detect anomalously fast view growth. Stub: always returns "not flagged" until
 * Phase 9, when the rule `increase >= minDelta AND ratePerMin >= threshold` is
 * implemented here.
 */
export function detectSpike(
  _input: SpikeInput,
  _thresholds: SpikeThresholds = DEFAULT_SPIKE_THRESHOLDS,
): SpikeResult {
  return { flagged: false };
}
