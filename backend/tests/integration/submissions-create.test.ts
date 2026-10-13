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

describe('POST /api/submissions', () => {
  let brandToken: string;
  let brandId: string;
  let creatorToken: string;
  let creatorId: string;
  let liveInstagramId: string;
  let exhaustedId: string;

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
    brandToken = b.token;
    brandId = b.id;
    const c = await signup('creator', 'creator@example.com');
    creatorToken = c.token;
    creatorId = c.id;

    const live = await Campaign.create({
      brand: brandId,
      name: 'Live IG',
      platform: 'instagram',
      budget: 10000,
      spent: 0,
      status: 'live',
      milestones: [{ views: 1000, payout: 100 }],
    });
    liveInstagramId = live.id;

    const exhausted = await Campaign.create({
      brand: brandId,
      name: 'Exhausted',
      platform: 'instagram',
      budget: 1000,
      spent: 1000,
      status: 'exhausted',
      milestones: [{ views: 1000, payout: 100 }],
    });
    exhaustedId = exhausted.id;
  });

  it('valid Instagram link -> 201', async () => {
    const res = await request(app)
      .post('/api/submissions')
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({
        campaignId: liveInstagramId,
        postUrl: 'https://instagram.com/p/ABC123',
      });
    expect(res.status).toBe(201);
    expect(res.body.submission).toHaveProperty('id');
    expect(res.body.submission).toHaveProperty('views', 0);
    expect(res.body.submission).toHaveProperty('entitledAmount', 0);
    expect(res.body.submission).toHaveProperty('paidAmount', 0);
  });

  it('YouTube link on Instagram campaign -> 400', async () => {
    const res = await request(app)
      .post('/api/submissions')
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({
        campaignId: liveInstagramId,
        postUrl: 'https://youtube.com/watch?v=dQw4w9WgXcQ',
      });
    expect(res.status).toBe(400);
  });

  it('same link twice -> 409', async () => {
    await request(app)
      .post('/api/submissions')
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({
        campaignId: liveInstagramId,
        postUrl: 'https://instagram.com/p/ABC123',
      });
    const res = await request(app)
      .post('/api/submissions')
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({
        campaignId: liveInstagramId,
        postUrl: 'https://instagram.com/p/ABC123',
      });
    expect(res.status).toBe(409);
  });

  it('same link with ?utm=x appended -> 409 (normalization)', async () => {
    await request(app)
      .post('/api/submissions')
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({
        campaignId: liveInstagramId,
        postUrl: 'https://instagram.com/p/ABC123',
      });
    const res = await request(app)
      .post('/api/submissions')
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({
        campaignId: liveInstagramId,
        postUrl: 'https://instagram.com/p/ABC123?utm_source=test',
      });
    expect(res.status).toBe(409);
  });

  it('unknown campaignId -> 404', async () => {
    const res = await request(app)
      .post('/api/submissions')
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({
        campaignId: '507f191e810c19729de860ea',
        postUrl: 'https://instagram.com/p/ABC123',
      });
    expect(res.status).toBe(404);
  });

  it('malformed campaignId -> 400', async () => {
    const res = await request(app)
      .post('/api/submissions')
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({
        campaignId: 'bad',
        postUrl: 'https://instagram.com/p/ABC123',
      });
    expect(res.status).toBe(400);
  });

  it('brand token -> 403', async () => {
    const res = await request(app)
      .post('/api/submissions')
      .set('Authorization', `Bearer ${brandToken}`)
      .send({
        campaignId: liveInstagramId,
        postUrl: 'https://instagram.com/p/ABC123',
      });
    expect(res.status).toBe(403);
  });

  it('submit to exhausted campaign -> 409', async () => {
    const res = await request(app)
      .post('/api/submissions')
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({
        campaignId: exhaustedId,
        postUrl: 'https://instagram.com/p/ABC123',
      });
    expect(res.status).toBe(409);
  });
});
