import type { RequestHandler } from 'express';
import type { ZodError, ZodType } from 'zod';
import { ValidationError, type ErrorDetail } from '../errors';

export type ValidateSource = 'body' | 'params' | 'query';

/** Turn a zod error into the API `details` array shape (spec §5.1). */
export function zodDetails(error: ZodError): ErrorDetail[] {
  return error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
}

/**
 * Validates one request part against a zod schema and replaces it with the
 * parsed value (so coercion/trimming/defaults reach the handler). Invalid input
 * becomes a `ValidationError` (400) handled centrally.
 */
export function validate<T>(schema: ZodType<T>, source: ValidateSource = 'body'): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      next(new ValidationError('Request validation failed', zodDetails(result.error)));
      return;
    }
    (req as unknown as Record<ValidateSource, unknown>)[source] = result.data;
    next();
  };
}
