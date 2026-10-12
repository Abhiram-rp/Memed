import { Router } from 'express';
import mongoose from 'mongoose';

const DB_STATES: Record<number, string> = {
  0: 'disconnected',
  1: 'connected',
  2: 'connecting',
  3: 'disconnecting',
  99: 'uninitialized',
};

export const healthRouter = Router();

/**
 * Liveness probe (spec §5.2). Always 200 while the process is up; reports the
 * current MongoDB connection state so operators can see DB health at a glance.
 */
healthRouter.get('/', (_req, res) => {
  const state = DB_STATES[mongoose.connection.readyState] ?? 'unknown';
  res.json({ status: 'ok', db: state });
});
