import request from 'supertest';
import { createApp } from '../../src/app';
import { Campaign } from '../../src/models/Campaign';
import { Submission } from '../../src/models/Submission';
import { User } from '../../src/models/User';
import { clearTestDb, setupTestDb, teardownTestDb } from '../helpers/mongo';

const app = createApp();

// The spec §6.3 example ladder: 10K -> 500, 50K -> 2,000, 100K -> 5,000.
const LADDER = [
  { views: 10000, payout: 500 },
  { views: 50000, payout: 2000 },
  { views: 100000, payout: 5000 },
];

interface Account {
  token: string;
  id: string;
}

async function signup(role: 'brand' | 'creator', email: string): Promise<Account> {
  const res = await request(app).post('/api/auth/signup').send({
    name: role === 'brand' ? 'Brand User' : 'Creator User',
    email,
    password: 'min8chars',
    role,
  });
  expect(res.status).toBe(201);
  return { token: res.body.token, id: res.body.user.id };
}

/** Create a campaign through the real API; defaults to the §6.3 example. */
async function createCampaign(
  brandToken: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const res = await request(app)
    .post('/api/campaigns')
    .set('Authorization', `Bearer ${brandToken}`)
    .send({
      name: 'Summer Drop',
      platform: 'instagram',
      budget: 100000,
      milestones: LADDER,
      ...overrides,
    });
  expect(res.status).toBe(201);
  return res.body.campaign.id as string;
}

/** Submit a post through the real API and return the submission id. */
async function submitPost(
  creatorToken: string,
  campaignId: string,
  postUrl: string,
): Promise<string> {
  const res = await request(app)
    .post('/api/submissions')
    .set('Authorization', `Bearer ${creatorToken}`)
    .send({ campaignId, postUrl });
  expect(res.status).toBe(201);
  return res.body.submission.id as string;
}

/** PATCH the absolute view count (no auth by decision D13). */
function patchViews(submissionId: string, views: number) {
  return request(app).patch(`/api/submissions/${submissionId}/views`).send({ views });
}

/**
 * Assert the spec §4.4 invariants straight from the database after a call:
 *   1. 0 <= campaign.spent <= campaign.budget
 *   2. campaign.spent === Σ submission.paidAmount for that campaign
 *   3. submission.paidAmount <= submission.entitledAmount
 *   5. campaign.status === 'exhausted' iff campaign.spent === campaign.budget
 */
async function assertInvariants(campaignId: string): Promise<void> {
  const campaign = await Campaign.findById(campaignId).lean();
  if (!campaign) {
    throw new Error(`assertInvariants: campaign ${campaignId} not found`);
  }
  const submissions = await Submission.find({ campaign: campaignId }).lean();

  const sumPaid = submissions.reduce((total, submission) => total + submission.paidAmount, 0);

  expect(campaign.spent).toBeGreaterThanOrEqual(0);
  expect(campaign.spent).toBeLessThanOrEqual(campaign.budget);
  expect(campaign.spent).toBe(sumPaid);
  for (const submission of submissions) {
    expect(submission.paidAmount).toBeLessThanOrEqual(submission.entitledAmount);
  }
  expect(campaign.status === 'exhausted').toBe(campaign.spent === campaign.budget);
}

/**
 * Group 1 — the payout engine walks the milestone ladder (spec Phase 6 task 5,
 * §6.3). Payout is the highest reached milestone only (D2), paid in deltas (D3),
 * and the §4.4 invariants hold after every single call.
 */
describe('Group 1 - View update walks the milestone ladder (PATCH /api/submissions/:id/views)', () => {
  jest.setTimeout(60000);

  let brand: Account;
  let creator: Account;

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
    brand = await signup('brand', 'brand@example.com');
    creator = await signup('creator', 'creator@example.com');
  });

  it('walks 0 -> 10M paying the highest reached milestone only', async () => {
    const campaignId = await createCampaign(brand.token);
    const submissionId = await submitPost(creator.token, campaignId, 'https://instagram.com/p/WALK001');

    const steps = [
      { views: 0, paid: 0, delta: 0, entitled: 0, spent: 0 },
      { views: 9999, paid: 0, delta: 0, entitled: 0, spent: 0 },
      { views: 10000, paid: 500, delta: 500, entitled: 500, spent: 500 },
      { views: 49999, paid: 500, delta: 0, entitled: 500, spent: 500 },
      { views: 50000, paid: 2000, delta: 1500, entitled: 2000, spent: 2000 },
      { views: 99999, paid: 2000, delta: 0, entitled: 2000, spent: 2000 },
      { views: 100000, paid: 5000, delta: 3000, entitled: 5000, spent: 5000 },
      { views: 10000000, paid: 5000, delta: 0, entitled: 5000, spent: 5000 },
    ];

    for (const step of steps) {
      const res = await patchViews(submissionId, step.views);
      expect(res.status).toBe(200);
      expect(res.body.payout.paidAmount).toBe(step.paid);
      expect(res.body.payout.delta).toBe(step.delta);
      expect(res.body.payout.entitledAmount).toBe(step.entitled);
      expect(res.body.campaign.spent).toBe(step.spent);
      // The submission block mirrors the same amounts.
      expect(res.body.submission.paidAmount).toBe(step.paid);
      expect(res.body.submission.entitledAmount).toBe(step.entitled);
      await assertInvariants(campaignId);
    }
  });

  it('skips two milestones in one update: 0 -> 60000 pays 2000, not 2500', async () => {
    const campaignId = await createCampaign(brand.token);
    const submissionId = await submitPost(creator.token, campaignId, 'https://instagram.com/p/SKIP001');

    const res = await patchViews(submissionId, 60000);
    expect(res.status).toBe(200);
    expect(res.body.payout.delta).toBe(2000);
    expect(res.body.payout.paidAmount).toBe(2000);
    expect(res.body.payout.entitledAmount).toBe(2000);
    expect(res.body.campaign.spent).toBe(2000);

    await assertInvariants(campaignId);
  });
});
