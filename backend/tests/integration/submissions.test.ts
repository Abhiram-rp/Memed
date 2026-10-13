import request from 'supertest';
import { createApp } from '../../src/app';
import { Campaign } from '../../src/models/Campaign';
import { Submission } from '../../src/models/Submission';
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

/**
 * Group 2 — Submit a post (spec Phase 5 task 5). Validates URL/platform rules,
 * duplicate detection via the unique normalizedUrl index, campaign lifecycle
 * (live vs exhausted) and role/param guards, including a parallel duplicate race.
 */
describe('Group 2 - Submit a post (POST /api/submissions)', () => {
  let brandToken: string;
  let creatorToken: string;
  let liveInstagramId: string;
  let liveYoutubeId: string;
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
    const brand = await signup('brand', 'brand@example.com');
    brandToken = brand.token;
    const creator = await signup('creator', 'creator@example.com');
    creatorToken = creator.token;

    const liveIg = await Campaign.create({
      brand: brand.id,
      name: 'Live IG',
      platform: 'instagram',
      budget: 10000,
      spent: 0,
      status: 'live',
      milestones: [{ views: 1000, payout: 100 }],
    });
    liveInstagramId = liveIg.id;

    const liveYt = await Campaign.create({
      brand: brand.id,
      name: 'Live YT',
      platform: 'youtube',
      budget: 20000,
      spent: 0,
      status: 'live',
      milestones: [{ views: 5000, payout: 500 }],
    });
    liveYoutubeId = liveYt.id;

    const exhausted = await Campaign.create({
      brand: brand.id,
      name: 'Exhausted',
      platform: 'instagram',
      budget: 1000,
      spent: 1000,
      status: 'exhausted',
      milestones: [{ views: 1000, payout: 100 }],
    });
    exhaustedId = exhausted.id;
  });

  function submit(postUrl: string, token = creatorToken, campaignId = liveInstagramId) {
    return request(app)
      .post('/api/submissions')
      .set('Authorization', `Bearer ${token}`)
      .send({ campaignId, postUrl });
  }

  it('accepts a valid Instagram link -> 201 with zero views and amounts', async () => {
    const res = await submit('https://instagram.com/p/ABC123');
    expect(res.status).toBe(201);
    expect(res.body.submission).toHaveProperty('id');
    expect(res.body.submission).toHaveProperty('postUrl', 'https://instagram.com/p/ABC123');
    expect(res.body.submission).toHaveProperty('views', 0);
    expect(res.body.submission).toHaveProperty('entitledAmount', 0);
    expect(res.body.submission).toHaveProperty('paidAmount', 0);
  });

  it('rejects a wrong-platform URL -> 400', async () => {
    const res = await submit('https://youtube.com/watch?v=dQw4w9WgXcQ', creatorToken, liveInstagramId);
    expect(res.status).toBe(400);
  });

  it('rejects the same link twice -> 409', async () => {
    await submit('https://instagram.com/p/ABC123');
    const res = await submit('https://instagram.com/p/ABC123');
    expect(res.status).toBe(409);
  });

  it('rejects a duplicate link carrying query params -> 409 (normalization)', async () => {
    await submit('https://instagram.com/p/ABC123');
    const res = await submit('https://instagram.com/p/ABC123?utm_source=test');
    expect(res.status).toBe(409);
  });

  it('rejects youtu.be after the same video via watch?v= -> 409 (normalization)', async () => {
    const first = await submit('https://youtu.be/dQw4w9WgXcQ', creatorToken, liveYoutubeId);
    expect(first.status).toBe(201);
    const res = await submit('https://youtube.com/watch?v=dQw4w9WgXcQ', creatorToken, liveYoutubeId);
    expect(res.status).toBe(409);
  });

  it('returns 404 for an unknown campaign', async () => {
    const res = await submit('https://instagram.com/p/ABC123', creatorToken, '507f191e810c19729de860ea');
    expect(res.status).toBe(404);
  });

  it('returns 400 for a malformed campaignId', async () => {
    const res = await submit('https://instagram.com/p/ABC123', creatorToken, 'bad');
    expect(res.status).toBe(400);
  });

  it('returns 409 for an exhausted campaign', async () => {
    const res = await submit('https://instagram.com/p/ABC123', creatorToken, exhaustedId);
    expect(res.status).toBe(409);
  });

  it('returns 403 when a brand submits', async () => {
    const res = await submit('https://instagram.com/p/ABC123', brandToken, liveInstagramId);
    expect(res.status).toBe(403);
  });

  it('two parallel identical POSTs -> exactly one 201 and one 409', async () => {
    const [a, b] = await Promise.all([
      submit('https://instagram.com/p/RACE001'),
      submit('https://instagram.com/p/RACE001'),
    ]);
    const statuses = [a.status, b.status].sort((x, y) => x - y);
    expect(statuses).toEqual([201, 409]);
    expect(await Submission.countDocuments({ normalizedUrl: 'https://instagram.com/p/RACE001' })).toBe(1);
  });
});
