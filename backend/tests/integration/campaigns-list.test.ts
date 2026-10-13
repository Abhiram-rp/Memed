import request from 'supertest';
import { createApp } from '../../src/app';
import { Campaign } from '../../src/models/Campaign';
import { User } from '../../src/models/User';
import { clearTestDb, setupTestDb, teardownTestDb } from '../helpers/mongo';

const app = createApp();

async function signup(role: 'brand' | 'creator', email: string): Promise<{ token: string; id: string }> {
  const res = await request(app).post('/api/auth/signup').send({
    name: role === 'brand' ? 'Brand User' : 'Creator User',
    email,
    password: 'min8chars',
    role,
  });
  return { token: res.body.token, id: res.body.user.id };
}

async function login(role: 'brand' | 'creator', email: string): Promise<{ token: string; id: string }> {
  const res = await request(app).post('/api/auth/login').send({
    email,
    password: 'min8chars',
  });
  return { token: res.body.token, id: res.body.user.id };
}

describe('GET /api/campaigns (creator list)', () => {
  let brandToken: string;
  let creatorToken: string;
  let brandId: string;

  beforeAll(async () => {
    await setupTestDb();
    await User.init();
    await Campaign.init();
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  beforeEach(async () => {
    await clearTestDb();
    const brand = await signup('brand', 'brand@example.com');
    brandId = brand.id;
    brandToken = brand.token;
    const creator = await signup('creator', 'creator@example.com');
    creatorToken = creator.token;
  });

  it('returns 401 when no token', async () => {
    const res = await request(app).get('/api/campaigns');
    expect(res.status).toBe(401);
  });

  it('returns 403 when brand token', async () => {
    const res = await request(app)
      .get('/api/campaigns')
      .set('Authorization', `Bearer ${brandToken}`);
    expect(res.status).toBe(403);
  });

  it('returns only live campaigns with pagination metadata', async () => {
    await Campaign.create({
      brand: brandId,
      name: 'Live One',
      platform: 'instagram',
      budget: 10000,
      spent: 0,
      status: 'live',
      milestones: [{ views: 1000, payout: 100 }],
    });
    await Campaign.create({
      brand: brandId,
      name: 'Live Two',
      platform: 'youtube',
      budget: 5000,
      spent: 0,
      status: 'live',
      milestones: [{ views: 1000, payout: 100 }],
    });
    await Campaign.create({
      brand: brandId,
      name: 'Exhausted',
      platform: 'instagram',
      budget: 1000,
      spent: 1000,
      status: 'exhausted',
      milestones: [{ views: 1000, payout: 100 }],
    });

    const res = await request(app)
      .get('/api/campaigns')
      .set('Authorization', `Bearer ${creatorToken}`);
    expect(res.status).toBe(200);
    expect(res.body.page).toBe(1);
    expect(res.body.limit).toBe(20);
    expect(res.body.total).toBe(2);
    expect(res.body.items).toHaveLength(2);
    const names = res.body.items.map((i: any) => i.name).sort();
    expect(names).toEqual(['Live One', 'Live Two']);
    expect(res.body.items[0]).toHaveProperty('remaining');
    expect(res.body.items[0].brand).toHaveProperty('name');
  });

  it('respects page and limit', async () => {
    for (let i = 0; i < 3; i++) {
      await Campaign.create({
        brand: brandId,
        name: `Live ${i}`,
        platform: 'instagram',
        budget: 10000,
        spent: 0,
        status: 'live',
        milestones: [{ views: 1000, payout: 100 }],
      });
    }

    const res = await request(app)
      .get('/api/campaigns?page=2&limit=1')
      .set('Authorization', `Bearer ${creatorToken}`);
    expect(res.status).toBe(200);
    expect(res.body.page).toBe(2);
    expect(res.body.limit).toBe(1);
    expect(res.body.total).toBe(3);
    expect(res.body.items).toHaveLength(1);
  });
});
