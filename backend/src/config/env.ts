import 'dotenv/config';
import { z } from 'zod';

/**
 * Schema for every environment variable the backend reads.
 * All external input is validated; the process crashes fast at boot if invalid.
 */
const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
    JWT_EXPIRES_IN: z.string().min(1).default('7d'),
    CORS_ORIGIN: z.string().default('http://localhost:3000'),
    REDIS_URL: z.string().min(1).optional(),
    CAMPAIGN_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(30),
    SPIKE_MIN_DELTA: z.coerce.number().int().nonnegative().default(10000),
    SPIKE_RATE_PER_MIN: z.coerce.number().positive().default(1000),
  })
  .superRefine((value, ctx) => {
    if (value.NODE_ENV === 'production') {
      const origins = value.CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean);
      if (origins.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['CORS_ORIGIN'],
          message: 'CORS_ORIGIN is required in production',
        });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

/** Empty strings in `process.env` are treated as "unset". */
function stripEmpty(raw: NodeJS.ProcessEnv): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value === '' || value === undefined) continue;
    out[key] = value;
  }
  return out;
}

/**
 * Parse and validate an environment record. Exported so tests can build config
 * without touching the real `process.env`.
 */
export function parseEnv(raw: NodeJS.ProcessEnv): Env {
  const result = envSchema.safeParse(stripEmpty(raw));
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n  - ');
    throw new Error(`Invalid environment configuration:\n  - ${details}`);
  }
  return result.data;
}

/** Validated, frozen environment for the running process. */
export const env: Env = Object.freeze(parseEnv(process.env));

/** CORS allowlist as an array (comma-separated env var, already trimmed). */
export function corsOrigins(config: Env = env): string[] {
  return config.CORS_ORIGIN.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
