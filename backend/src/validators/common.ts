import { z } from 'zod';

/** A 24-character hexadecimal Mongo ObjectId, as a string. */
const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/;

export const objectIdSchema = z
  .string()
  .trim()
  .regex(OBJECT_ID_PATTERN, 'Invalid ObjectId');

/** Route-param schema for endpoints addressed by a single `:id`. */
export const objectIdParamSchema = z.object({ id: objectIdSchema });

export type ObjectIdParam = z.infer<typeof objectIdParamSchema>;

/** Pagination query parameters for list endpoints. */
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;
