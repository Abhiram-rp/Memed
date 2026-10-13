import { z } from 'zod';
import { objectIdSchema } from './common';

export const createSubmissionSchema = z.object({
  campaignId: objectIdSchema,
  postUrl: z.string().trim().min(1, 'postUrl is required').max(2048, 'postUrl is too long'),
});

export type CreateSubmissionInput = z.infer<typeof createSubmissionSchema>;
