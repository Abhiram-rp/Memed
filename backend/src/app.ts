import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { corsOrigins } from './config/env';
import { errorHandler } from './middleware/errorHandler';
import { notFound } from './middleware/notFound';
import { healthRouter } from './routes/health';
import { apiRouter } from './routes';
import { campaignsRouter } from './routes/campaigns';
import { submissionsRouter } from './routes/submissions';

/**
 * Build the Express app WITHOUT listening (spec Phase 2 task 5). Tests import
 * this and drive it with supertest; `server.ts` is the only place that listens.
 */
export function createApp(): Express {
  const app = express();

  // Behind a reverse proxy (Render/nginx) so req.ip reflects the client.
  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(cors({ origin: corsOrigins(), credentials: true }));
  app.use(express.json({ limit: '100kb' }));

  app.use('/health', healthRouter);
  app.use('/api', apiRouter);
  app.use('/api/campaigns', campaignsRouter);
  app.use('/api/submissions', submissionsRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
