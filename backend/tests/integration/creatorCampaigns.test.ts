import request from 'supertest';
import { createApp } from '../../src/app';
import { Campaign } from '../../src/models/Campaign';
import { User } from '../../src/models/User';
import { clearTestDb, setupTestDb, teardownTestDb } from '../helpers/mongo';

const app = createApp();

async function signup(
  role: 'brand' | 'creator',
  email: string,
): Promise<{ token: string; id: string }> {
  const res = await request(app).post('/api/auth/signup').send({
    name: role === 'brand' ? 'Brand User' : 'Creator User',
    email,
    password: 'min8chars',
    role,
  });
  return { token: res.body.token, id: res.body.user.id };
}

type CampaignOverrides = Partial<{
  name: string;
  platform: 'instagram' | 'youtube';
  budget: number;
  spent: number;
  status: 'live' | 'exhausted';
  milestones: { views: number; payout: number }[];
}>;

function campaignDoc(brandId: string, overrides: CampaignOverrides = {}) {
  return {
    brand: brandId,
    name: 'Campaign',
    platform: 'instagram' as const,
    budget: 10000,
    spent: 0,
    status: 'live' as const,
    milestones: [{ views: 1000, payout: 100 }],
    ...overrides,
  };
}

/**
 * Group 1 — Browse live campaigns (spec Phase 5 task 5). Only `live` campaigns
 * are listed, paginated newest-first; creators can read a live campaign by id
 * but get 404 for an exhausted one; the endpoint is creator-only.
 */
describe('Group 1 - Browse campaigns (GET /api/campaigns)', () => {
  let brandToken: string;
  let brandId: string;
  let creatorToken: string;

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
    brandToken = brand.token;
    brandId = brand.id;
    const creator = await signup('creator', 'creator@example.com');
    creatorToken = creator.token;
  });

  it('returns 401 without a token', async () => {
    const res = await request(app).get('/api/campaigns');
    expect(res.status).toBe(401);
  });

  it('returns 403 for a brand token', async () => {
    const res = await request(app)
      .get('/api/campaigns')
      .set('Authorization', `Bearer ${brandToken}`);
    expect(res.status).toBe(403);
  });

  it('lists only live campaigns (an exhausted one inserted directly is hidden)', async () => {
    await Campaign.create(campaignDoc(brandId, { name: 'Live One' }));
    await Campaign.create(campaignDoc(brandId, { name: 'Live Two', platform: 'youtube' }));
    await Campaign.create(
      campaignDoc(brandId, { name: 'Exhausted', status: 'exhausted', budget: 1000, spent: 1000 }),
    );

    const res = await request(app)
      .get('/api/campaigns')
      .set('Authorization', `Bearer ${creatorToken}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.items).toHaveLength(2);
    const names = res.body.items.map((item: any) => item.name).sort();
    expect(names).toEqual(['Live One', 'Live Two']);
    expect(res.body.items[0]).toHaveProperty('remaining');
    expect(res.body.items[0].brand).toHaveProperty('name');
  });

  it('returns page, limit and total across more than one page of data', async () => {
    const docs = Array.from({ length: 25 }, (_, i) =>
      campaignDoc(brandId, { name: `Live ${String(i).padStart(2, '0')}` }),
    );
    await Campaign.insertMany(docs);

    const first = await request(app)
      .get('/api/campaigns')
      .set('Authorization', `Bearer ${creatorToken}`);
    expect(first.body.page).toBe(1);
    expect(first.body.limit).toBe(20);
    expect(first.body.total).toBe(25);
    expect(first.body.items).toHaveLength(20);

    const second = await request(app)
      .get('/api/campaigns?page=2&limit=10')
      .set('Authorization', `Bearer ${creatorToken}`);
    expect(second.body.page).toBe(2);
    expect(second.body.limit).toBe(10);
    expect(second.body.total).toBe(25);
    expect(second.body.items).toHaveLength(10);

    const third = await request(app)
      .get('/api/campaigns?page=3&limit=10')
      .set('Authorization', `Bearer ${creatorToken}`);
    expect(third.body.total).toBe(25);
    expect(third.body.items).toHaveLength(5);
  });

  it('lets a creator read a live campaign by id', async () => {
    const live = await Campaign.create(campaignDoc(brandId, { name: 'Live Read' }));

    const res = await request(app)
      .get(`/api/campaigns/${live.id}`)
      .set('Authorization', `Bearer ${creatorToken}`);
    expect(res.status).toBe(200);
    expect(res.body.campaign).toHaveProperty('id', live.id);
    expect(res.body.campaign).toHaveProperty('name', 'Live Read');
  });

  it('returns 404 when a creator reads an exhausted campaign by id', async () => {
    const exhausted = await Campaign.create(
      campaignDoc(brandId, { status: 'exhausted', budget: 1000, spent: 1000 }),
    );

    const res = await request(app)
      .get(`/api/campaigns/${exhausted.id}`)
      .set('Authorization', `Bearer ${creatorToken}`);
    expect(res.status).toBe(404);
  });
});
