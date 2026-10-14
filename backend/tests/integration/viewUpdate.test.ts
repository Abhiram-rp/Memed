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

/**
 * Group 2 — idempotency (D6), monotonic payouts / no clawback (D5), input
 * validation, the public endpoint (D13) and an already-exhausted campaign.
 */
describe('Group 2 - Idempotency, monotonic payouts and validation', () => {
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

  it('repeating the same PATCH pays nothing the second time (D6)', async () => {
    const campaignId = await createCampaign(brand.token);
    const submissionId = await submitPost(creator.token, campaignId, 'https://instagram.com/p/REPEAT1');

    const first = await patchViews(submissionId, 50000);
    expect(first.status).toBe(200);
    expect(first.body.payout.delta).toBe(2000);
    expect(first.body.payout.paidAmount).toBe(2000);
    expect(first.body.campaign.spent).toBe(2000);

    const second = await patchViews(submissionId, 50000);
    expect(second.status).toBe(200);
    expect(second.body.payout.delta).toBe(0);
    expect(second.body.payout.paidAmount).toBe(2000);
    expect(second.body.campaign.spent).toBe(2000);

    await assertInvariants(campaignId);
  });

  it('stores a decreased view count but never claws money back (D5)', async () => {
    const campaignId = await createCampaign(brand.token);
    const submissionId = await submitPost(creator.token, campaignId, 'https://instagram.com/p/DECREASE1');

    await patchViews(submissionId, 50000); // paid 2000

    const decreased = await patchViews(submissionId, 20000);
    expect(decreased.status).toBe(200);
    expect(decreased.body.submission.views).toBe(20000);
    expect(decreased.body.submission.entitledAmount).toBe(2000);
    expect(decreased.body.submission.paidAmount).toBe(2000);
    expect(decreased.body.payout.delta).toBe(0);
    expect(decreased.body.campaign.spent).toBe(2000);

    // The decrease is persisted, not just echoed.
    const stored = await Submission.findById(submissionId).lean();
    expect(stored?.views).toBe(20000);
    expect(stored?.entitledAmount).toBe(2000);
    expect(stored?.paidAmount).toBe(2000);

    // Climbing again pays only the difference to the top milestone.
    const climbed = await patchViews(submissionId, 100000);
    expect(climbed.status).toBe(200);
    expect(climbed.body.payout.delta).toBe(3000);
    expect(climbed.body.payout.paidAmount).toBe(5000);
    expect(climbed.body.campaign.spent).toBe(5000);

    await assertInvariants(campaignId);
  });

  it('returns 404 NOT_FOUND for an unknown but valid submission id', async () => {
    const res = await patchViews('0123456789abcdef01234567', 10000);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 400 for a malformed submission id', async () => {
    const res = await patchViews('not-an-id', 10000);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects invalid view bodies with 400', async () => {
    const campaignId = await createCampaign(brand.token);
    const submissionId = await submitPost(creator.token, campaignId, 'https://instagram.com/p/BADBODY1');

    const invalidBodies: Array<{ label: string; body: Record<string, unknown> }> = [
      { label: 'string "500"', body: { views: '500' } },
      { label: 'float 1.5', body: { views: 1.5 } },
      { label: 'negative -1', body: { views: -1 } },
      { label: 'null', body: { views: null } },
      { label: 'missing', body: {} },
      { label: 'above max 2000000001', body: { views: 2000000001 } },
    ];

    for (const { label, body } of invalidBodies) {
      const res = await request(app).patch(`/api/submissions/${submissionId}/views`).send(body);
      expect({ label, status: res.status }).toEqual({ label, status: 400 });
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }

    // Nothing was written by any rejected request.
    const stored = await Submission.findById(submissionId).lean();
    expect(stored?.views).toBe(0);
    expect(stored?.paidAmount).toBe(0);
    await assertInvariants(campaignId);
  });

  it('requires no Authorization header (D13)', async () => {
    const campaignId = await createCampaign(brand.token);
    const submissionId = await submitPost(creator.token, campaignId, 'https://instagram.com/p/PUBLIC01');

    // patchViews deliberately sends no Authorization header.
    const res = await patchViews(submissionId, 10000);
    expect(res.status).toBe(200);
    expect(res.body.payout.paidAmount).toBe(500);
    expect(res.body.campaign.spent).toBe(500);
  });

  it('still accepts an update on an already-exhausted campaign (delta 0, views stored)', async () => {
    const campaignId = await createCampaign(brand.token, {
      budget: 500,
      milestones: [{ views: 10000, payout: 500 }],
    });
    const submissionId = await submitPost(creator.token, campaignId, 'https://instagram.com/p/EXHAUST1');

    const exhaust = await patchViews(submissionId, 10000);
    expect(exhaust.status).toBe(200);
    expect(exhaust.body.campaign.spent).toBe(500);
    expect(exhaust.body.campaign.status).toBe('exhausted');

    const after = await patchViews(submissionId, 20000);
    expect(after.status).toBe(200);
    expect(after.body.submission.views).toBe(20000);
    expect(after.body.payout.delta).toBe(0);
    expect(after.body.payout.paidAmount).toBe(500);
    expect(after.body.campaign.spent).toBe(500);
    expect(after.body.campaign.status).toBe('exhausted');

    await assertInvariants(campaignId);
  });
});

/**
 * Group 3 — the budget cap (D4), a single budget shared across submissions, and
 * concurrency: parallel updates must never overpay and identical parallel
 * updates must pay exactly once (D6).
 */
describe('Group 3 - Budget cap, shared budget and concurrency', () => {
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

  it('caps a payout at the remaining budget and marks it capped (D4)', async () => {
    const campaignId = await createCampaign(brand.token, { budget: 1000 });
    const submissionId = await submitPost(creator.token, campaignId, 'https://instagram.com/p/CAP001');

    // Entitled 2000 at 50K views, but only 1000 of budget remains.
    const res = await patchViews(submissionId, 50000);
    expect(res.status).toBe(200);
    expect(res.body.payout.entitledAmount).toBe(2000);
    expect(res.body.payout.delta).toBe(1000);
    expect(res.body.payout.paidAmount).toBe(1000);
    expect(res.body.payout.capped).toBe(true);
    expect(res.body.submission.capped).toBe(true);
    expect(res.body.campaign.spent).toBe(1000);
    expect(res.body.campaign.remaining).toBe(0);
    expect(res.body.campaign.status).toBe('exhausted');

    await assertInvariants(campaignId);
  });

  it('drains one shared budget across several submissions', async () => {
    const campaignId = await createCampaign(brand.token, { budget: 2500 });
    const first = await submitPost(creator.token, campaignId, 'https://instagram.com/p/DRAIN001');
    const second = await submitPost(creator.token, campaignId, 'https://instagram.com/p/DRAIN002');
    const third = await submitPost(creator.token, campaignId, 'https://instagram.com/p/DRAIN003');

    const firstRes = await patchViews(first, 10000); // 500
    expect(firstRes.body.payout.delta).toBe(500);
    expect(firstRes.body.campaign.spent).toBe(500);

    // 2000 owed, exactly 2000 left: paid in full and NOT capped.
    const secondRes = await patchViews(second, 50000);
    expect(secondRes.body.payout.delta).toBe(2000);
    expect(secondRes.body.payout.capped).toBe(false);
    expect(secondRes.body.campaign.spent).toBe(2500);
    expect(secondRes.body.campaign.status).toBe('exhausted');

    // Entitled 5000, but the budget is empty: nothing more is paid.
    const thirdRes = await patchViews(third, 100000);
    expect(thirdRes.status).toBe(200);
    expect(thirdRes.body.payout.delta).toBe(0);
    expect(thirdRes.body.payout.paidAmount).toBe(0);
    expect(thirdRes.body.payout.capped).toBe(true);
    expect(thirdRes.body.campaign.spent).toBe(2500);

    await assertInvariants(campaignId);
  });

  it('never overpays under 20 parallel updates on a tight budget', async () => {
    const campaignId = await createCampaign(brand.token, { budget: 2500 });

    const submissionIds: string[] = [];
    for (let index = 0; index < 20; index += 1) {
      const postUrl = `https://instagram.com/p/RACE${String(index).padStart(3, '0')}`;
      submissionIds.push(await submitPost(creator.token, campaignId, postUrl));
    }

    // Every submission is entitled to 2000 (50K views); the budget is only 2500.
    const responses = await Promise.all(submissionIds.map((id) => patchViews(id, 50000)));

    for (const res of responses) {
      expect(res.status).toBe(200);
    }
    const totalDelta = responses.reduce((sum, res) => sum + res.body.payout.delta, 0);
    expect(totalDelta).toBe(2500);

    const campaign = await Campaign.findById(campaignId).lean();
    expect(campaign?.spent).toBe(2500);
    expect(campaign?.status).toBe('exhausted');
    await assertInvariants(campaignId);
  });

  it('pays exactly once for 10 identical parallel updates (D6)', async () => {
    const campaignId = await createCampaign(brand.token);
    const submissionId = await submitPost(creator.token, campaignId, 'https://instagram.com/p/ONCE001');

    const responses = await Promise.all(
      Array.from({ length: 10 }, () => patchViews(submissionId, 50000)),
    );

    for (const res of responses) {
      expect(res.status).toBe(200);
    }
    const deltas = responses.map((res) => res.body.payout.delta);
    expect(deltas.filter((delta) => delta === 2000)).toHaveLength(1);
    expect(deltas.reduce((sum, delta) => sum + delta, 0)).toBe(2000);

    const campaign = await Campaign.findById(campaignId).lean();
    expect(campaign?.spent).toBe(2000);
    await assertInvariants(campaignId);
  });
});

/**
 * Group 4 — the transaction logic must prevent overspending and double-paying
 * under real concurrency. Each test fires parallel PATCHes and then checks the
 * money invariants (§4.4) straight from the database.
 */
describe('Group 4 - Concurrency races never overspend or double-pay', () => {
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

  it('overspend race: 20 parallel updates never pay more than the budget', async () => {
    const campaignId = await createCampaign(brand.token, {
      budget: 1200,
      milestones: [
        { views: 1000, payout: 500 },
        { views: 5000, payout: 2000 },
      ],
    });

    const submissionIds: string[] = [];
    for (let index = 0; index < 20; index += 1) {
      const postUrl = `https://instagram.com/p/OVER${String(index).padStart(3, '0')}`;
      submissionIds.push(await submitPost(creator.token, campaignId, postUrl));
    }

    // Every submission is entitled to 2000 (5000 views); the budget is only 1200.
    const responses = await Promise.all(submissionIds.map((id) => patchViews(id, 5000)));

    for (const res of responses) {
      expect(res.status).toBe(200);
    }

    const campaign = await Campaign.findById(campaignId).lean();
    expect(campaign?.spent).toBe(1200);
    expect(campaign?.status).toBe('exhausted');

    const submissions = await Submission.find({ campaign: campaignId }).lean();
    const totalPaid = submissions.reduce((sum, submission) => sum + submission.paidAmount, 0);
    expect(totalPaid).toBe(1200);
    for (const submission of submissions) {
      expect(submission.paidAmount).toBeLessThanOrEqual(2000);
    }

    await assertInvariants(campaignId);
  });

  it('double-pay race: 10 identical parallel updates pay exactly once', async () => {
    const campaignId = await createCampaign(brand.token, {
      budget: 100000,
      milestones: [{ views: 1000, payout: 500 }],
    });
    const submissionId = await submitPost(creator.token, campaignId, 'https://instagram.com/p/DOUBLE01');

    const responses = await Promise.all(
      Array.from({ length: 10 }, () => patchViews(submissionId, 1000)),
    );

    for (const res of responses) {
      expect(res.status).toBe(200);
    }
    const deltas = responses.map((res) => res.body.payout.delta);
    expect(deltas.filter((delta) => delta === 500)).toHaveLength(1);
    expect(deltas.filter((delta) => delta === 0)).toHaveLength(9);

    const submission = await Submission.findById(submissionId).lean();
    expect(submission?.paidAmount).toBe(500);

    const campaign = await Campaign.findById(campaignId).lean();
    expect(campaign?.spent).toBe(500);

    await assertInvariants(campaignId);
  });

  it('mixed race on one submission settles on the highest entitlement', async () => {
    const campaignId = await createCampaign(brand.token, {
      budget: 100000,
      milestones: [
        { views: 1000, payout: 500 },
        { views: 5000, payout: 2000 },
      ],
    });
    const submissionId = await submitPost(creator.token, campaignId, 'https://instagram.com/p/MIXED001');

    const views = [1000, 5000, 1000, 5000, 1000];
    const responses = await Promise.all(views.map((value) => patchViews(submissionId, value)));

    for (const res of responses) {
      expect(res.status).toBe(200);
      expect(res.body.payout.delta).toBeGreaterThanOrEqual(0);
    }

    const submission = await Submission.findById(submissionId).lean();
    expect(submission?.entitledAmount).toBe(2000);
    expect(submission?.paidAmount).toBe(2000);

    const campaign = await Campaign.findById(campaignId).lean();
    expect(campaign?.spent).toBe(2000);

    await assertInvariants(campaignId);
  });
});
