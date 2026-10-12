import { Router } from 'express';

/**
 * Aggregation point for every `/api` route. Phase 3+ mounts the auth,
 * campaigns, submissions and creators routers here.
 */
export const apiRouter = Router();
