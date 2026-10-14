/**
 * Pure client-side validation for the "create campaign" form, mirroring the
 * backend rules in spec decisions D8 (milestone ladder) and D9 (budget).
 *
 * No React, no DOM, no imports beyond types — safe to unit test in isolation.
 *
 * Rules
 * -----
 * - `name`: trimmed, 1-120 characters.
 * - `platform`: required (`instagram` or `youtube`).
 * - `budget`: a positive integer (empty, decimals, zero, negatives and
 *   non-numeric input are all rejected).
 * - 1-20 milestone rows.
 * - Each row's `views` and `payout` is a positive integer.
 * - After sorting rows ascending by `views`: `views` must be strictly
 *   increasing (so no duplicate thresholds) and `payout` must be strictly
 *   increasing (a higher threshold must pay more).
 * - `budget` must be >= the smallest milestone payout.
 *
 * Numbers are parsed with `Number()` + `Number.isInteger()` only after a
 * `/^\d+$/` test, so `"1e3"`, `"12abc"`, `"1.5"`, `"-5"` and `""` are rejected
 * rather than silently coerced.
 *
 * Example cases (verified against this module)
 * --------------------------------------------
 * 1. Valid, single milestone
 *      { name: "Launch", platform: "instagram", budget: "5000",
 *        milestones: [{ views: "10000", payout: "500" }] }
 *      -> valid, input = { name: "Launch", platform: "instagram", budget: 5000,
 *                          milestones: [{ views: 10000, payout: 500 }] }
 *
 * 2. Valid, unsorted ladder is returned sorted ascending by views
 *      { name: "Launch", platform: "youtube", budget: "5000",
 *        milestones: [{ views: "50000", payout: "2000" },
 *                     { views: "10000", payout: "500" }] }
 *      -> valid, input.milestones = [{ views: 10000, payout: 500 },
 *                                    { views: 50000, payout: 2000 }]
 *
 * 3. Blank name
 *      { name: "   ", ... } -> errors.name = "Name is required"
 *
 * 4. Name longer than 120 characters
 *      { name: "x".repeat(121), ... }
 *      -> errors.name = "Name must be at most 120 characters"
 *
 * 5. Platform not chosen
 *      { platform: "", ... } -> errors.platform = "Choose a platform"
 *
 * 6. Budget is not a plain positive integer
 *      { budget: "1e3", ... } (also "", "0", "-5", "1.5", "12abc")
 *      -> errors.budget = "Budget must be a positive integer"
 *
 * 7. Duplicate view thresholds
 *      milestones: [{ views: "10000", payout: "500" },
 *                   { views: "10000", payout: "900" }]
 *      -> errors.rows[1].views = "Milestone views must be strictly increasing"
 *
 * 8. Budget below the smallest payout
 *      { budget: "400", milestones: [{ views: "10000", payout: "500" }] }
 *      -> errors.budget = "Budget must be at least the smallest milestone payout"
 */

import type { CreateCampaignInput } from "@/types/api";

export type MilestoneRow = { views: string; payout: string };

export type CampaignFormValues = {
  name: string;
  platform: "" | "instagram" | "youtube";
  budget: string;
  milestones: MilestoneRow[];
};

export type CampaignFormErrors = {
  name?: string;
  platform?: string;
  budget?: string;
  milestones?: string;
  rows: { views?: string; payout?: string }[];
};

export interface CampaignFormValidation {
  errors: CampaignFormErrors;
  valid: boolean;
  input?: CreateCampaignInput;
}

export const MIN_MILESTONES = 1;
export const MAX_MILESTONES = 20;
export const MAX_NAME_LENGTH = 120;

/** ASCII digits only: rejects "", "1e3", "12abc", "1.5", "-5", "+5". */
const POSITIVE_INTEGER_PATTERN = /^\d+$/;

/** Parses a form string as a positive integer, or returns null. */
function parsePositiveInteger(raw: string): number | null {
  const trimmed = raw.trim();
  if (!POSITIVE_INTEGER_PATTERN.test(trimmed)) {
    return null;
  }
  const value = Number(trimmed);
  if (!Number.isInteger(value) || value <= 0) {
    return null;
  }
  return value;
}

/**
 * Validates the create-campaign form. Always returns a fully-populated
 * `errors` object (with one `rows` entry per submitted row, in the original
 * order) plus `valid`; `input` is present only when `valid` is true.
 */
export function validateCampaignForm(values: CampaignFormValues): CampaignFormValidation {
  const errors: CampaignFormErrors = { rows: values.milestones.map(() => ({})) };
  let hasError = false;

  const name = values.name.trim();
  if (name.length === 0) {
    errors.name = "Name is required";
    hasError = true;
  } else if (name.length > MAX_NAME_LENGTH) {
    errors.name = `Name must be at most ${MAX_NAME_LENGTH} characters`;
    hasError = true;
  }

  const platform = values.platform;
  if (platform !== "instagram" && platform !== "youtube") {
    errors.platform = "Choose a platform";
    hasError = true;
  }

  const budget = parsePositiveInteger(values.budget);
  if (budget === null) {
    errors.budget = "Budget must be a positive integer";
    hasError = true;
  }

  const rowCount = values.milestones.length;
  if (rowCount < MIN_MILESTONES || rowCount > MAX_MILESTONES) {
    errors.milestones = `Milestones must contain between ${MIN_MILESTONES} and ${MAX_MILESTONES} entries`;
    hasError = true;
  }

  const parsed: { views: number; payout: number }[] = [];
  values.milestones.forEach((row, index) => {
    const views = parsePositiveInteger(row.views);
    const payout = parsePositiveInteger(row.payout);
    if (views === null) {
      errors.rows[index].views = "Views must be a positive integer";
      hasError = true;
    }
    if (payout === null) {
      errors.rows[index].payout = "Payout must be a positive integer";
      hasError = true;
    }
    if (views !== null && payout !== null) {
      parsed.push({ views, payout });
    }
  });

  // Ladder checks only make sense once every row parsed cleanly.
  if (hasError) {
    return { errors, valid: false };
  }

  // `parsed` is aligned with `values.milestones`; keep the original index so
  // ladder errors point at the row the user actually typed.
  const ordered = parsed
    .map((row, index) => ({ views: row.views, payout: row.payout, index }))
    .sort((a, b) => a.views - b.views);

  for (let i = 1; i < ordered.length; i += 1) {
    const previous = ordered[i - 1];
    const current = ordered[i];
    if (current.views <= previous.views) {
      errors.rows[current.index].views = "Milestone views must be strictly increasing";
      hasError = true;
    }
    if (current.payout <= previous.payout) {
      errors.rows[current.index].payout = "Milestone payout must be strictly increasing";
      hasError = true;
    }
  }

  let lowestPayout = Number.POSITIVE_INFINITY;
  for (const row of ordered) {
    lowestPayout = Math.min(lowestPayout, row.payout);
  }
  if (budget !== null && budget < lowestPayout) {
    errors.budget = "Budget must be at least the smallest milestone payout";
    hasError = true;
  }

  if (hasError || budget === null || (platform !== "instagram" && platform !== "youtube")) {
    return { errors, valid: false };
  }

  return {
    errors,
    valid: true,
    input: {
      name,
      platform,
      budget,
      milestones: ordered.map((row) => ({ views: row.views, payout: row.payout })),
    },
  };
}
