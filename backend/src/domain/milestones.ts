import type { Milestone } from './payout';

/** A milestone as supplied by a client, before validation. */
export interface MilestoneInput {
  views: number;
  payout: number;
}

/** A validation problem in `{ path, message }` form (consumed by the zod layer). */
export interface MilestoneValidationError {
  path: string;
  message: string;
}

/** Validation outcome: the normalized ladder on success, every problem on failure. */
export type MilestoneValidationResult =
  { ok: true; milestones: Milestone[] } | { ok: false; errors: MilestoneValidationError[] };

export const MIN_MILESTONES = 1;
export const MAX_MILESTONES = 20;

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

/**
 * Return a new ladder sorted ascending by `views` (D8). Does not validate;
 * call {@link validateMilestones} first. Neither the input array nor its
 * objects are mutated.
 */
export function normalizeMilestones(input: readonly MilestoneInput[]): Milestone[] {
  return input
    .map((milestone) => ({ views: milestone.views, payout: milestone.payout }))
    .sort((a, b) => a.views - b.views);
}

/**
 * Validate a milestone ladder and its campaign budget per D8 + D9.
 *
 * Rules: 1–20 milestones; `views` and `payout` are positive integers; after
 * sorting ascending by `views`, both `views` and `payout` strictly increase; the
 * budget is a positive integer at least the smallest milestone payout.
 *
 * On success the sorted, normalized ladder is returned so callers can store it
 * without a second pass. On failure every problem is returned with a JSON-path
 * style `path` (e.g. `milestones.1.views`, `budget`).
 */
export function validateMilestones(
  input: readonly MilestoneInput[],
  budget: number,
): MilestoneValidationResult {
  const errors: MilestoneValidationError[] = [];

  if (!isPositiveInteger(budget)) {
    errors.push({ path: 'budget', message: 'budget must be a positive integer' });
  }

  if (input.length < MIN_MILESTONES || input.length > MAX_MILESTONES) {
    errors.push({
      path: 'milestones',
      message: `milestones must contain between ${MIN_MILESTONES} and ${MAX_MILESTONES} entries`,
    });
  }

  input.forEach((milestone, index) => {
    if (!isPositiveInteger(milestone.views)) {
      errors.push({
        path: `milestones.${index}.views`,
        message: 'views must be a positive integer',
      });
    }
    if (!isPositiveInteger(milestone.payout)) {
      errors.push({
        path: `milestones.${index}.payout`,
        message: 'payout must be a positive integer',
      });
    }
  });

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const milestones = normalizeMilestones(input);

  let previous: Milestone | undefined;
  milestones.forEach((current, index) => {
    if (previous !== undefined) {
      if (current.views <= previous.views) {
        errors.push({
          path: `milestones.${index}.views`,
          message: 'milestone views must be strictly increasing',
        });
      }
      if (current.payout <= previous.payout) {
        errors.push({
          path: `milestones.${index}.payout`,
          message: 'milestone payout must be strictly increasing',
        });
      }
    }
    previous = current;
  });

  let lowestPayout = Number.POSITIVE_INFINITY;
  for (const milestone of milestones) {
    lowestPayout = Math.min(lowestPayout, milestone.payout);
  }
  if (budget < lowestPayout) {
    errors.push({
      path: 'budget',
      message: 'budget must be at least the smallest milestone payout',
    });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, milestones };
}
