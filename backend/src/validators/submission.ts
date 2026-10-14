import { z } from 'zod';
import { objectIdParamSchema, objectIdSchema } from './common';

export const createSubmissionSchema = z.object({
  campaignId: objectIdSchema,
  postUrl: z.string().trim().min(1, 'postUrl is required').max(2048, 'postUrl is too long'),
});

export type CreateSubmissionInput = z.infer<typeof createSubmissionSchema>;

/** Largest absolute view count a platform update may report (spec §5.4). */
export const MAX_VIEWS = 2_000_000_000;

/**
 * Params schema for `PATCH /api/submissions/:id/views` (spec Phase 6 task 1).
 * Reuses the shared single-`:id` ObjectId param schema.
 */
export const viewsParamsSchema = objectIdParamSchema;

export type ViewsParams = z.infer<typeof viewsParamsSchema>;

/**
 * Body schema for `PATCH /api/submissions/:id/views` (spec §5.4).
 *
 * `views` is the **absolute** current count: a JSON number, an integer within
 * `0..MAX_VIEWS`. There is no coercion, so numeric strings, floats, `null` and
 * missing fields are rejected; `.strict()` refuses any unknown key.
 */
export const updateViewsBodySchema = z
  .object({
    views: z
      .number()
      .int('views must be an integer')
      .min(0, 'views must be at least 0')
      .max(MAX_VIEWS, `views must be at most ${MAX_VIEWS}`),
  })
  .strict();

export type UpdateViewsBody = z.infer<typeof updateViewsBodySchema>;
