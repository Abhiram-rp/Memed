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

async function submitPost(token: string, campaignId: string, postUrl: string): Promise<string> {
  const res = await request(app)
    .post('/api/submissions')
    .set('Authorization', `Bearer ${token}`)
    .send({ campaignId, postUrl });
  expect(res.status).toBe(201);
  return res.body.submission.id as string;
}

/** Simulates the Phase 6 payout engine setting a submission's paid amount. */
async function setPaidAmount(submissionId: string, paidAmount: number): Promise<void> {
  await Submission.updateOne({ _id: submissionId }, { $set: { paidAmount } });
}

/**
 * Group 4 — Creator earnings (spec Phase 5 task 5). A creator with no posts gets
 * all zeros; paid amounts are summed across campaigns and broken down per
 * campaign; and each creator's earnings exclude everyone else's submissions.
 */
describe('Group 4 - Creator earnings (GET /api/creators/me/earnings)', () => {
  let creator1Token: string;
  let creator2Token: string;
  let creator3Token: string;
  let campaignAId: string;
  let campaignBId: string;

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
    const c1 = await signup('creator', 'creator1@example.com');
    creator1Token = c1.token;
    const c2 = await signup('creator', 'creator2@example.com');
    creator2Token = c2.token;
    const c3 = await signup('creator', 'creator3@example.com');
    creator3Token = c3.token;

    const a = await Campaign.create({
      brand: brand.id,
      name: 'Campaign A',
      platform: 'instagram',
      budget: 10000,
      spent: 0,
      status: 'live',
      milestones: [{ views: 1000, payout: 100 }],
    });
    campaignAId = a.id;

    const b = await Campaign.create({
      brand: brand.id,
      name: 'Campaign B',
      platform: 'youtube',
      budget: 20000,
      spent: 0,
      status: 'live',
      milestones: [{ views: 5000, payout: 500 }],
    });
    campaignBId = b.id;
  });

  it('returns all zeros for a creator with no submissions', async () => {
    const res = await request(app)
      .get('/api/creators/me/earnings')
      .set('Authorization', `Bearer ${creator3Token}`);
    expect(res.status).toBe(200);
    expect(res.body.earnings).toEqual({ totalEarnings: 0, submissionCount: 0, byCampaign: [] });
  });

  it('sums paidAmount across campaigns and breaks it down by campaign', async () => {
    const subA = await submitPost(creator1Token, campaignAId, 'https://instagram.com/p/AAA111');
    const subB = await submitPost(creator1Token, campaignBId, 'https://youtu.be/BBB222xxx');
    await setPaidAmount(subA, 500);
    await setPaidAmount(subB, 1200);

    const res = await request(app)
      .get('/api/creators/me/earnings')
      .set('Authorization', `Bearer ${creator1Token}`);
    expect(res.status).toBe(200);
    expect(res.body.earnings).toMatchObject({ totalEarnings: 1700, submissionCount: 2 });

    const byName = Object.fromEntries(
      res.body.earnings.byCampaign.map((row: any) => [row.campaignName, row]),
    );
    expect(byName['Campaign A']).toEqual({
      campaignId: campaignAId,
      campaignName: 'Campaign A',
      paidAmount: 500,
      submissionCount: 1,
    });
    expect(byName['Campaign B']).toEqual({
      campaignId: campaignBId,
      campaignName: 'Campaign B',
      paidAmount: 1200,
      submissionCount: 1,
    });
  });

  it("does not include another creator's earnings", async () => {
    const subMine = await submitPost(creator1Token, campaignAId, 'https://instagram.com/p/MINE001');
    const subTheirs = await submitPost(creator2Token, campaignAId, 'https://instagram.com/p/THEIR01');
    await setPaidAmount(subMine, 500);
    await setPaidAmount(subTheirs, 9999);

    const mine = await request(app)
      .get('/api/creators/me/earnings')
      .set('Authorization', `Bearer ${creator1Token}`);
    expect(mine.body.earnings).toMatchObject({ totalEarnings: 500, submissionCount: 1 });
    expect(mine.body.earnings.byCampaign).toHaveLength(1);

    const theirs = await request(app)
      .get('/api/creators/me/earnings')
      .set('Authorization', `Bearer ${creator2Token}`);
    expect(theirs.body.earnings).toMatchObject({ totalEarnings: 9999, submissionCount: 1 });
  });
});
