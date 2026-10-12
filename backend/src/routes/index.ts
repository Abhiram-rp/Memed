import { Router } from 'express';
import { authRouter } from './auth';

/**
 * Aggregation point for every `/api` route. Phase 4+ mounts the campaigns,
 * submissions and creators routers here.
 */
export const apiRouter = Router();

apiRouter.use('/auth', authRouter);
