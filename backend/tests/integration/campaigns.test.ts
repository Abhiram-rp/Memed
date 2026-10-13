import request from 'supertest';
import { createApp } from '../../src/app';
import { User } from '../../src/models/User';
import { clearTestDb, setupTestDb, teardownTestDb } from '../helpers/mongo';

const app = createApp();

const validCampaign = {
  name: 'Alpha Drop',
  platform: 'instagram',
  budget: 100000,
  milestones: [
    { views: 10000, payout: 500 },
    { views: 50000, payout: 2000 },
  ],
};

async function signup(role: 'brand' | 'creator', email: string): Promise<{ token: string; id: string }> {
  const res = await request(app).post('/api/auth/signup').send({
    name: role === 'brand' ? 'Brand User' : 'Creator User',
    email,
    password: 'min8chars',
    role,
  });
  expect(res.status).toBe(201);
  return { token: res.body.token, id: res.body.user.id };
}

async function createCampaign(token: string, body: object) {
  return request(app).post('/api/campaigns').set('Authorization', `Bearer ${token}`).send(body);
}

beforeAll(async () => {
  await setupTestDb();
  // Unique indexes back the duplicate-email 409.
  await User.init();
});

afterEach(clearTestDb);

afterAll(teardownTestDb);

describe('Group 1 - Create', () => {
  it('creates a valid campaign: 201, milestones sorted (sent unsorted), spent 0, remaining = budget, status live', async () => {
    const brand = await signup('brand', 'brand@a.com');
    const res = await createCampaign(brand.token, {
      ...validCampaign,
      milestones: [
        { views: 50000, payout: 2000 },
        { views: 10000, payout: 500 },
      ],
    });

    expect(res.status).toBe(201);
    expect(res.body.campaign).toEqual({
      id: expect.any(String),
      name: 'Alpha Drop',
      platform: 'instagram',
      budget: 100000,
      spent: 0,
      remaining: 100000,
      status: 'live',
      milestones: [
        { views: 10000, payout: 500 },
        { views: 50000, payout: 2000 },
      ],
      brand: { id: brand.id, name: 'Brand User' },
      createdAt: expect.any(String),
    });
  });
});