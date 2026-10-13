import request from 'supertest';
import { createApp } from '../../src/app';
import { Campaign } from '../../src/models/Campaign';
import { Submission } from '../../src/models/Submission';
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

describe('GET /api/submissions/mine', () => {
  let brandId: string;
  let creator1Token: string;
  let creator1Id: string;
  let creator2Token: string;
  let creator2Id: string;
  let campaignId: string;

  beforeAll(async () => {
    await setupTestDb();
    await User.init();
    await Campaign.init();
    await Submission.init();
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  beforeEach(async () => {
    await clearTestDb();
    const b = await signup('brand', 'brand@example.com');
    brandId = b.id;
    const c1 = await signup('creator', 'creator1@example.com');
    creator1Token = c1.token;
    creator1Id = c1.id;
    const c2 = await signup('creator', 'creator2@example.com');
    creator2Token = c2.token;
    creator2Id = c2.id;

    const camp = await Campaign.create({
      brand: brandId,
      name: 'Test Campaign',
      platform: 'instagram',
      budget: 10000,
      spent: 0,
      status: 'live',
      milestones: [{ views: 1000, payout: 100 }],
    });
    campaignId = camp.id;
  });

  it('each creator sees only their own submissions with campaign name/platform', async () => {
    await request(app)
      .post('/api/submissions')
      .set('Authorization', `Bearer ${creator1Token}`)
      .send({
        campaignId,
        postUrl: 'https://instagram.com/p/ABC123',
      });
    await request(app)
      .post('/api/submissions')
      .set('Authorization', `Bearer ${creator2Token}`)
      .send({
        campaignId,
        postUrl: 'https://instagram.com/p/DEF456',
      });

    const res1 = await request(app)
      .get('/api/submissions/mine')
      .set('Authorization', `Bearer ${creator1Token}`);
    expect(res1.status).toBe(200);
    expect(res1.body.items).toHaveLength(1);
    expect(res1.body.items[0].campaign).toHaveProperty('name', 'Test Campaign');
    expect(res1.body.items[0].campaign).toHaveProperty('platform', 'instagram');

    const res2 = await request(app)
      .get('/api/submissions/mine')
      .set('Authorization', `Bearer ${creator2Token}`);
    expect(res2.status).toBe(200);
    expect(res2.body.items).toHaveLength(1);
  });
});
