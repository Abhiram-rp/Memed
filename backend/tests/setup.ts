/**
 * Jest global setup (runs before any test module is imported).
 *
 * `src/config/env.ts` validates `process.env` at import time and throws when
 * required values are missing. Tests import modules that transitively import
 * it, so we seed a valid baseline here. Individual tests can still call
 * `parseEnv(...)` with their own records.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
process.env.MONGODB_URI =
  process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/memed-test?replicaSet=rs0';
process.env.JWT_SECRET =
  process.env.JWT_SECRET ?? 'test-secret-that-is-at-least-32-characters-long';
