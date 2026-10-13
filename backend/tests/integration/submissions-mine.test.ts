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

/**
 * Group 3 — My submissions (spec Phase 5 task 5). Two creators submitting to the
 * same campaign each see only their own posts, with the campaign name and
 * platform populated on every item.
 */
describe('Group 3 - My submissions (GET /api/submissions/mine)', () => {
  let brandId: string;
  let creator1Token: string;
  let creator2Token: string;
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
    const c2 = await signup('creator', 'creator2@example.com');
    creator2Token = c2.token;

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

  it('shows each creator only their own submissions, with campaign name and platform', async () => {
    const one = await request(app)
      .post('/api/submissions')
      .set('Authorization', `Bearer ${creator1Token}`)
      .send({ campaignId, postUrl: 'https://instagram.com/p/ABC123' });
    const two = await request(app)
      .post('/api/submissions')
      .set('Authorization', `Bearer ${creator2Token}`)
      .send({ campaignId, postUrl: 'https://instagram.com/p/DEF456' });
    expect(one.status).toBe(201);
    expect(two.status).toBe(201);

    const res1 = await request(app)
      .get('/api/submissions/mine')
      .set('Authorization', `Bearer ${creator1Token}`);
    expect(res1.status).toBe(200);
    expect(res1.body.items).toHaveLength(1);
    expect(res1.body.items[0]).toMatchObject({
      id: one.body.submission.id,
      campaignId,
      postUrl: 'https://instagram.com/p/ABC123',
      campaign: { id: campaignId, name: 'Test Campaign', platform: 'instagram' },
    });
    expect(res1.body.items[0]).not.toHaveProperty('_id');
    expect(res1.body.items[0]).not.toHaveProperty('__v');

    const res2 = await request(app)
      .get('/api/submissions/mine')
      .set('Authorization', `Bearer ${creator2Token}`);
    expect(res2.status).toBe(200);
    expect(res2.body.items).toHaveLength(1);
    expect(res2.body.items[0]).toMatchObject({
      id: two.body.submission.id,
      campaignId,
      postUrl: 'https://instagram.com/p/DEF456',
      campaign: { id: campaignId, name: 'Test Campaign', platform: 'instagram' },
    });
    // Neither creator sees the other's post.
    expect(res1.body.items[0].postUrl).not.toBe('https://instagram.com/p/DEF456');
    expect(res2.body.items[0].postUrl).not.toBe('https://instagram.com/p/ABC123');
  });
});
