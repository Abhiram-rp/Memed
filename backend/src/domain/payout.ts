/**
 * Pure payout mathematics for the milestone ladder.
 *
 * All money is an integer number of rupees (D1) and every view count is a
 * non-negative integer. These functions perform no I/O and never mutate their
 * inputs. Every payout number used anywhere in the app is produced here.
 */

/** A single rung of a campaign's milestone ladder. */
export interface Milestone {
  /** View threshold at which this payout becomes the entitled amount. */
  views: number;
  /** Integer rupee amount paid once the threshold is reached. */
  payout: number;
}

/** Throw a `RangeError` for any value that is not a non-negative integer. */
function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer, received ${String(value)}`);
  }
}

/**
 * Payout of the highest milestone whose threshold has been reached
 * (`threshold <= views`), or `0` when no milestone is reached.
 *
 * Milestones are not cumulative (D2): crossing several rungs in a single update
 * pays the highest rung only. The supplied ladder does not need to be sorted and
 * is never mutated.
 */
export function calculateEntitledPayout(views: number, milestones: readonly Milestone[]): number {
  assertNonNegativeInteger(views, 'views');

  // Sort a copy so an unsorted ladder still yields the highest reached rung.
  const ascending = [...milestones].sort((a, b) => a.views - b.views);

  let entitled = 0;
  for (const milestone of ascending) {
    if (milestone.views > views) break;
    entitled = milestone.payout;
  }
  return entitled;
}

/** Inputs to {@link calculatePayoutDelta}. */
export interface DeltaInput {
  /** High-water entitlement for the submission (never decreases, D5). */
  entitledAmount: number;
  /** Amount already paid to the submission. */
  alreadyPaid: number;
  /** `budget - spent` for the campaign, always `>= 0`. */
  remainingBudget: number;
}

/** Result of {@link calculatePayoutDelta}. */
export interface DeltaResult {
  /** Amount payable now: `clamp(entitledAmount - alreadyPaid, 0, remainingBudget)`. */
  delta: number;
  /** True when the submission is owed more than it can be paid (budget ran out). */
  capped: boolean;
}

/**
 * Movement to make on the next view update (D3/D4/D6): the unpaid part of the
 * entitlement, never more than the remaining budget and never negative.
 * `capped` reports that the campaign could not cover the full entitlement.
 */
export function calculatePayoutDelta(input: DeltaInput): DeltaResult {
  const { entitledAmount, alreadyPaid, remainingBudget } = input;

  assertNonNegativeInteger(entitledAmount, 'entitledAmount');
  assertNonNegativeInteger(alreadyPaid, 'alreadyPaid');
  assertNonNegativeInteger(remainingBudget, 'remainingBudget');

  const owed = Math.max(entitledAmount - alreadyPaid, 0);
  const delta = Math.min(owed, remainingBudget);
  const capped = alreadyPaid + delta < entitledAmount;

  return { delta, capped };
}
