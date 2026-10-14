import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { createApp } from '../../src/app';
import { errorHandler } from '../../src/middleware/errorHandler';
import { authenticate } from '../../src/middleware/authenticate';
import { requireRole } from '../../src/middleware/requireRole';
import { User } from '../../src/models/User';
import { clearTestDb, setupTestDb, teardownTestDb } from '../helpers/mongo';

const app = createApp();

// Minimal app to exercise the role guard (no brand/creator routes exist yet).
const guardApp = express();
guardApp.get('/guard', authenticate, requireRole('brand'), (_req, res) => {
  res.json({ ok: true });
});
guardApp.use(errorHandler);

const validSignup = {
  name: 'Laugh Factory',
  email: 'a@b.com',
  password: 'min8chars',
  role: 'creator',
};

beforeAll(async () => {
  await setupTestDb();
  // Unique email index backs the duplicate-email 409.
  await User.init();
});

afterEach(clearTestDb);

afterAll(teardownTestDb);

describe('POST /api/auth/signup', () => {
  it('creates a user and returns 201 with token + public user shape', async () => {
    const res = await request(app).post('/api/auth/signup').send(validSignup);
    expect(res.status).toBe(201);
    expect(res.body.token).toEqual(expect.any(String));
    expect(res.body.user).toEqual({
      id: expect.any(String),
      name: 'Laugh Factory',
      email: 'a@b.com',
      role: 'creator',
    });
    // Exit criterion: the password hash never appears in any response.
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
    expect(JSON.stringify(res.body)).not.toContain('_id');
    expect(JSON.stringify(res.body)).not.toContain('__v');
  });

  it('lowercases the email and trims the name', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ ...validSignup, name: '  Laugh Factory  ', email: '  A@B.COM ' });
    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe('a@b.com');
    expect(res.body.user.name).toBe('Laugh Factory');
  });

  it('rejects a duplicate email with 409 CONFLICT', async () => {
    await request(app).post('/api/auth/signup').send(validSignup);
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ ...validSignup, name: 'Other Brand', role: 'brand' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('rejects a weak password with 400 and a details entry', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ ...validSignup, password: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'password' })]),
    );
  });

  it('rejects a password longer than the bcrypt 72-byte limit', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ ...validSignup, password: 'x'.repeat(73) });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects an invalid email', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ ...validSignup, email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects an unknown role', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ ...validSignup, role: 'admin' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a name longer than 80 characters', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ ...validSignup, name: 'x'.repeat(81) });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /api/auth/login', () => {
  it('returns 200 with token + user for valid credentials', async () => {
    await request(app).post('/api/auth/signup').send(validSignup);
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'a@b.com', password: 'min8chars' });
    expect(res.status).toBe(200);
    expect(res.body.token).toEqual(expect.any(String));
    expect(res.body.user).toEqual({
      id: expect.any(String),
      name: 'Laugh Factory',
      email: 'a@b.com',
      role: 'creator',
    });
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
  });

  it('returns 401 for a wrong password', async () => {
    await request(app).post('/api/auth/signup').send(validSignup);
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'a@b.com', password: 'wrongpass' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
    expect(res.body.error.message).toBe('Invalid email or password');
  });

  it('returns the identical 401 for an unknown email (no user enumeration)', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@nowhere.com', password: 'whatever1' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
    expect(res.body.error.message).toBe('Invalid email or password');
  });
});

describe('GET /api/auth/me', () => {
  it('returns the full user profile with a valid token', async () => {
    const signup = await request(app).post('/api/auth/signup').send(validSignup);
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${signup.body.token}`);
    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({
      id: expect.any(String),
      name: 'Laugh Factory',
      email: 'a@b.com',
      role: 'creator',
    });
  });

  it('returns 401 without a token', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('returns 401 for a malformed token', async () => {
    const res = await request(app).get('/api/auth/me').set('Authorization', 'Bearer not-a-jwt');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('returns 401 for a token signed with a different secret', async () => {
    const signup = await request(app).post('/api/auth/signup').send(validSignup);
    const forged = jwt.sign(
      { sub: signup.body.user.id, role: 'creator' },
      'a-different-secret-that-is-also-32-chars-long',
    );
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${forged}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });
});

describe('requireRole guard', () => {
  it('allows a brand through a brand-only route', async () => {
    const signup = await request(app)
      .post('/api/auth/signup')
      .send({ ...validSignup, role: 'brand' });
    const res = await request(guardApp)
      .get('/guard')
      .set('Authorization', `Bearer ${signup.body.token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('blocks a creator with 403 FORBIDDEN', async () => {
    const signup = await request(app).post('/api/auth/signup').send(validSignup);
    const res = await request(guardApp)
      .get('/guard')
      .set('Authorization', `Bearer ${signup.body.token}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('returns 401 when no user is attached', async () => {
    const res = await request(guardApp).get('/guard');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });
});
