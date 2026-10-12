import express from 'express';
import mongoose from 'mongoose';
import request from 'supertest';
import { z } from 'zod';
import { ConflictError, NotFoundError, ValidationError } from '../../src/errors';
import { asyncHandler } from '../../src/middleware/asyncHandler';
import { errorHandler } from '../../src/middleware/errorHandler';
import { notFound } from '../../src/middleware/notFound';
import { validate } from '../../src/middleware/validate';

function makeApp(): express.Express {
  const app = express();
  app.use(express.json());

  app.get('/conflict', () => {
    throw new ConflictError('Duplicate email');
  });
  app.get('/not-found', () => {
    throw new NotFoundError('Nope');
  });
  app.get('/validation', () => {
    throw new ValidationError('Bad', [{ path: 'x', message: 'y' }]);
  });
  app.get(
    '/async',
    asyncHandler(async () => {
      throw new ConflictError('async conflict');
    }),
  );
  app.get('/duplicate-key', () => {
    throw Object.assign(new Error('dup'), { code: 11000, keyValue: { email: 'a@b.com' } });
  });
  app.get('/cast', () => {
    throw new mongoose.Error.CastError('ObjectId', 'not-an-id', '_id');
  });
  app.get('/boom', () => {
    throw new Error('secret internals');
  });
  app.post(
    '/validated',
    validate(z.object({ name: z.string().trim().min(1) }), 'body'),
    (req, res) => {
      res.json({ ok: true, name: (req.body as { name: string }).name });
    },
  );

  app.use(notFound);
  app.use(errorHandler);
  return app;
}

describe('errorHandler', () => {
  const app = makeApp();

  it('maps AppError subclasses to their status and code', async () => {
    const res = await request(app).get('/conflict');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
    expect(res.body.error.message).toBe('Duplicate email');
  });

  it('includes details when present', async () => {
    const res = await request(app).get('/validation');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toEqual([{ path: 'x', message: 'y' }]);
  });

  it('catches async handler rejections', async () => {
    const res = await request(app).get('/async');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('maps Mongo duplicate key errors to 409 CONFLICT', async () => {
    const res = await request(app).get('/duplicate-key');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
    expect(res.body.error.message).toContain('email');
  });

  it('maps CastError to 400 VALIDATION_ERROR', async () => {
    const res = await request(app).get('/cast');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('never leaks internals for unknown errors', async () => {
    const res = await request(app).get('/boom');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(res.body.error.message).toBe('Internal server error');
    expect(JSON.stringify(res.body)).not.toContain('secret internals');
  });

  it('validates the body and replaces it with the parsed value', async () => {
    const bad = await request(app).post('/validated').send({ name: '   ' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');

    const good = await request(app).post('/validated').send({ name: '  Alice  ' });
    expect(good.status).toBe(200);
    expect(good.body.name).toBe('Alice');
  });

  it('returns 404 NOT_FOUND for unknown routes', async () => {
    const res = await request(app).get('/missing');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
