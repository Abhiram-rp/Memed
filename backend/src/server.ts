import type { Server } from 'node:http';
import { createApp } from './app';
import { connectDb, disconnectDb } from './config/db';
import { env } from './config/env';
import { logger } from './config/logger';

let server: Server | undefined;

async function start(): Promise<void> {
  await connectDb();
  const app = createApp();
  server = app.listen(env.PORT, () => {
    logger.info(`Meme'd API listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
  });
}

function shutdown(signal: string): void {
  logger.info(`${signal} received, shutting down gracefully`);
  if (server !== undefined) {
    server.close((err) => {
      if (err !== undefined) {
        logger.error('Error while closing HTTP server', err);
      }
      void disconnectDb().finally(() => process.exit(err === undefined ? 0 : 1));
    });
  } else {
    void disconnectDb().finally(() => process.exit(0));
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', reason);
});

start().catch((err: unknown) => {
  logger.error('Failed to start server', err);
  process.exit(1);
});
