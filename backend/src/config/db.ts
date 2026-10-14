import mongoose from 'mongoose';
import { env } from './env';
import { logger } from './logger';

const SERVER_SELECTION_TIMEOUT_MS = 10_000;

/**
 * Connect to MongoDB (spec Phase 2 task 1). Uses `serverSelectionTimeoutMS` so
 * an unreachable database fails fast with a clear error instead of hanging.
 * The URI is never logged; only host and database name are.
 */
export async function connectDb(uri: string = env.MONGODB_URI): Promise<typeof mongoose> {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: SERVER_SELECTION_TIMEOUT_MS });
  logger.info(
    `MongoDB connected: ${mongoose.connection.host}/${mongoose.connection.name} (${mongoose.connection.readyState})`,
  );
  return mongoose;
}

/** Disconnect cleanly (used by tests and graceful shutdown). */
export async function disconnectDb(): Promise<void> {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
    logger.info('MongoDB disconnected');
  }
}
