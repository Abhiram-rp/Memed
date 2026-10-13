import { z } from 'zod';
import { MAX_MILESTONES, MIN_MILESTONES, validateMilestones } from '../domain/milestones';

/**
 * One milestone row. `views`/`payout` must be positive integers: `z.number()`
 * rejects strings, and `.int()` rejects floats (spec D8).
 */
const milestoneSchema = z.object({
  views: z.number().int().positive('views must be a positive integer'),
  payout: z.number().int().positive('payout must be a positive integer'),
});

/**
 * Body schema for `POST /api/campaigns` (spec Phase 4 task 1).
 *
 * Structural checks live in the zod fields; the cross-field milestone rules
 * (D8 strictly increasing ladder, D9 budget ≥ smallest payout) run through
 * {@link validateMilestones} in `superRefine`, and every problem it reports is
 * re-emitted as a zod issue at its own path (e.g. `milestones.1.views`).
 *
 * The ladder is NOT sorted here — the service sorts before storing (D8), so an
 * unsorted but otherwise valid ladder passes untouched.
 */
export const createCampaignSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Name is required')
      .max(120, 'Name must be at most 120 characters'),
    platform: z.enum(['instagram', 'youtube']),
    budget: z.number().int().positive('budget must be a positive integer'),
    milestones: z
      .array(milestoneSchema)
      .min(MIN_MILESTONES, `At least ${MIN_MILESTONES} milestone is required`)
      .max(MAX_MILESTONES, `At most ${MAX_MILESTONES} milestones are allowed`),
  })
  .superRefine((data, ctx) => {
    // Guard the runtime shape: refinements may still see partially-parsed input.
    if (data === null || typeof data !== 'object') {
      return;
    }
    if (!Array.isArray(data.milestones) || typeof data.budget !== 'number') {
      return;
    }
    const result = validateMilestones(data.milestones, data.budget);
    if (result.ok) {
      return;
    }
    for (const error of result.errors) {
      ctx.addIssue({
        code: 'custom',
        path: error.path.split('.'),
        message: error.message,
      });
    }
  });

export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;
