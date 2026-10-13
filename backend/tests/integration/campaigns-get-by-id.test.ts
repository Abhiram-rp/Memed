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

describe('GET /api/campaigns/:id (roles)', () => {
  let brand1Token: string;
  let brand1Id: string;
  let brand2Token: string;
  let creatorToken: string;
  let liveCampaignId: string;
  let exhaustedCampaignId: string;

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
    const b1 = await signup('brand', 'brand1@example.com');
    brand1Token = b1.token;
    brand1Id = b1.id;
    const b2 = await signup('brand', 'brand2@example.com');
    brand2Token = b2.token;
    const c = await signup('creator', 'creator@example.com');
    creatorToken = c.token;

    const live = await Campaign.create({
      brand: brand1Id,
      name: 'Live',
      platform: 'instagram',
      budget: 10000,
      spent: 0,
      status: 'live',
      milestones: [{ views: 1000, payout: 100 }],
    });
    liveCampaignId = live.id;

    const exhausted = await Campaign.create({
      brand: brand1Id,
      name: 'Exhausted',
      platform: 'instagram',
      budget: 1000,
      spent: 1000,
      status: 'exhausted',
      milestones: [{ views: 1000, payout: 100 }],
    });
    exhaustedCampaignId = exhausted.id;
  });

  it('creator on live campaign -> 200', async () => {
    const res = await request(app)
      .get(`/api/campaigns/${liveCampaignId}`)
      .set('Authorization', `Bearer ${creatorToken}`);
    expect(res.status).toBe(200);
    expect(res.body.campaign).toHaveProperty('id', liveCampaignId);
    expect(res.body.campaign.brand).toHaveProperty('name');
    expect(res.body.campaign).toHaveProperty('remaining');
  });

  it('creator on exhausted campaign -> 404', async () => {
    const res = await request(app)
      .get(`/api/campaigns/${exhaustedCampaignId}`)
      .set('Authorization', `Bearer ${creatorToken}`);
    expect(res.status).toBe(404);
  });

  it('brand owner still -> 200', async () => {
    const res = await request(app)
      .get(`/api/campaigns/${liveCampaignId}`)
      .set('Authorization', `Bearer ${brand1Token}`);
    expect(res.status).toBe(200);
  });

  it('another brand -> 404', async () => {
    const res = await request(app)
      .get(`/api/campaigns/${liveCampaignId}`)
      .set('Authorization', `Bearer ${brand2Token}`);
    expect(res.status).toBe(404);
  });

  it('bad id -> 400', async () => {
    const res = await request(app)
      .get('/api/campaigns/not-an-id')
      .set('Authorization', `Bearer ${creatorToken}`);
    expect(res.status).toBe(400);
  });
});
