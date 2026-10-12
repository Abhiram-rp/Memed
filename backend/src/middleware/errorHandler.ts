import type { ErrorRequestHandler } from 'express';
import mongoose from 'mongoose';
import { ZodError } from 'zod';
import { logger } from '../config/logger';
import { AppError, type ErrorCode, type ErrorDetail } from '../errors';

interface ErrorEnvelope {
  error: {
    code: ErrorCode;
    message: string;
    details?: ErrorDetail[];
  };
}

interface ErrorResponse {
  statusCode: number;
  body: ErrorEnvelope;
}

function isDuplicateKeyError(
  err: unknown,
): err is Error & { code: number; keyValue?: Record<string, unknown> } {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 11000;
}

function isJwtError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === 'JsonWebTokenError' ||
      err.name === 'TokenExpiredError' ||
      err.name === 'NotBeforeError')
  );
}

function toErrorResponse(err: unknown): ErrorResponse {
  if (err instanceof AppError) {
    return {
      statusCode: err.statusCode,
      body: {
        error: {
          code: err.code,
          message: err.message,
          ...(err.details !== undefined ? { details: err.details } : {}),
        },
      },
    };
  }

  if (err instanceof ZodError) {
    return {
      statusCode: 400,
      body: {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          details: err.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
      },
    };
  }

  if (err instanceof mongoose.Error.ValidationError) {
    return {
      statusCode: 400,
      body: {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details: Object.values(err.errors).map((e) => ({ path: e.path, message: e.message })),
        },
      },
    };
  }

  if (err instanceof mongoose.Error.CastError) {
    return {
      statusCode: 400,
      body: {
        error: {
          code: 'VALIDATION_ERROR',
          message: `Invalid value for "${err.path}"`,
        },
      },
    };
  }

  if (isDuplicateKeyError(err)) {
    const fields = Object.keys(err.keyValue ?? {});
    const message =
      fields.length > 0
        ? `Duplicate value for ${fields.join(', ')}`
        : 'A resource with the same unique value already exists';
    return { statusCode: 409, body: { error: { code: 'CONFLICT', message } } };
  }

  if (isJwtError(err)) {
    return {
      statusCode: 401,
      body: { error: { code: 'UNAUTHENTICATED', message: 'Invalid or expired token' } },
    };
  }

  // Anything else: never leak internals to the client.
  return {
    statusCode: 500,
    body: { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
  };
}

/**
 * Single error handler (spec §5.1, §9). Maps AppError, zod, Mongoose
 * validation/cast errors, duplicate keys and JWT errors; everything else is a
 * generic 500. Unexpected errors are logged server-side only.
 */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const { statusCode, body } = toErrorResponse(err);
  if (statusCode >= 500) {
    logger.error(`Unhandled error: ${err instanceof Error ? err.message : String(err)}`, err);
  }
  res.status(statusCode).json(body);
};
