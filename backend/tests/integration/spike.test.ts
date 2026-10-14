import request from 'supertest';
import { createApp } from '../../src/app';
import { Campaign } from '../../src/models/Campaign';
import { Submission } from '../../src/models/Submission';
import { User } from '../../src/models/User';
import { clearTestDb, setupTestDb, teardownTestDb } from '../helpers/mongo';

const app = createApp();

// Spec §6.3 example ladder; the budget is large so payouts never cap.
const LADDER = [
  { views: 10000, payout: 500 },
  { views: 50000, payout: 2000 },
  { views: 100000, payout: 5000 },
];
const BUDGET = 1_000_000;

/** A +60,000 jump inside the floored 1-minute window. */
const FLAG_REASON_60000 = /^\+60000 views in 1\.0 min \(60000\/min\)$/;

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

async function createCampaign(brandToken: string): Promise<string> {
  const res = await request(app)
    .post('/api/campaigns')
    .set('Authorization', `Bearer ${brandToken}`)
    .send({ name: 'Spike Drop', platform: 'instagram', budget: BUDGET, milestones: LADDER });
  expect(res.status).toBe(201);
  return res.body.campaign.id as string;
}

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
 * Simulate elapsed time WITHOUT sleeping: move the stored timestamp back in the
 * database. The service reads `lastViewsUpdatedAt` inside the transaction, so
 * this is exactly the value spike detection sees.
 */
async function setLastViewsUpdatedAt(submissionId: string, when: Date): Promise<void> {
  await Submission.updateOne({ _id: submissionId }, { $set: { lastViewsUpdatedAt: when } });
}

/** A `Date` `minutes` in the past (real clock, used only to build a timestamp). */
const minutesAgo = (minutes: number): Date => new Date(Date.now() - minutes * 60_000);

/** Assert the spec §4.4 invariants straight from the database. */
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

describe('Spike detection (Phase 9) — integration', () => {
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

  it('1. flags a fast big jump and stores flaggedAt as a Date', async () => {
    const campaignId = await createCampaign(brand.token);
    const submissionId = await submitPost(
      creator.token,
      campaignId,
      'https://instagram.com/p/SPIKE001',
    );

    const res = await patchViews(submissionId, 60000);
    expect(res.status).toBe(200);
    expect(res.body.submission.flagged).toBe(true);
    expect(res.body.submission.flagReason).toMatch(FLAG_REASON_60000);

    const stored = await Submission.findById(submissionId).lean();
    expect(stored?.flagged).toBe(true);
    expect(stored?.flaggedAt).toBeInstanceOf(Date);
    expect(Number.isNaN((stored?.flaggedAt as Date).getTime())).toBe(false);
  });

  it('2. leaves the payout untouched: a flagged and an unflagged submission pay the same', async () => {
    const campaignId = await createCampaign(brand.token);

    // A: fast jump -> flagged.
    const flaggedId = await submitPost(
      creator.token,
      campaignId,
      'https://instagram.com/p/SPIKE002A',
    );
    const flaggedRes = await patchViews(flaggedId, 60000);
    expect(flaggedRes.status).toBe(200);
    expect(flaggedRes.body.submission.flagged).toBe(true);
    expect(flaggedRes.body.payout.delta).toBe(2000);
    expect(flaggedRes.body.payout.paidAmount).toBe(2000);
    expect(flaggedRes.body.payout.entitledAmount).toBe(2000);

    // B: same ladder outcome, but slow enough not to flag (2 hours elapsed ->
    // 60,000 / 120 = 500/min, under the 1,000/min threshold).
    const slowId = await submitPost(creator.token, campaignId, 'https://instagram.com/p/SPIKE002B');
    await setLastViewsUpdatedAt(slowId, minutesAgo(120));
    const slowRes = await patchViews(slowId, 60000);
    expect(slowRes.status).toBe(200);
    expect(slowRes.body.submission.flagged).toBe(false);
    expect(slowRes.body.payout.delta).toBe(2000);
    expect(slowRes.body.payout.paidAmount).toBe(2000);
    expect(slowRes.body.payout.entitledAmount).toBe(2000);

    // Identical final entitlement and paid amount regardless of the flag.
    expect(slowRes.body.payout.paidAmount).toBe(flaggedRes.body.payout.paidAmount);
    expect(slowRes.body.payout.entitledAmount).toBe(flaggedRes.body.payout.entitledAmount);

    await assertInvariants(campaignId);
  });

  it('3. does not flag a small jump', async () => {
    const campaignId = await createCampaign(brand.token);
    const submissionId = await submitPost(
      creator.token,
      campaignId,
      'https://instagram.com/p/SPIKE003',
    );

    const res = await patchViews(submissionId, 5000);
    expect(res.status).toBe(200);
    expect(res.body.submission.flagged).toBe(false);
    expect(res.body.submission.flagReason).toBeNull();
  });

  it('4. does not flag slow growth (10,000 over 20 minutes = 500/min)', async () => {
    const campaignId = await createCampaign(brand.token);
    const submissionId = await submitPost(
      creator.token,
      campaignId,
      'https://instagram.com/p/SPIKE004',
    );
    await setLastViewsUpdatedAt(submissionId, minutesAgo(20));

    const res = await patchViews(submissionId, 10000);
    expect(res.status).toBe(200);
    expect(res.body.submission.flagged).toBe(false);
    expect(res.body.submission.flagReason).toBeNull();
  });

  it('5. flags at the rate boundary (10,000 over ~10 minutes = ~1000/min)', async () => {
    const campaignId = await createCampaign(brand.token);
    const submissionId = await submitPost(
      creator.token,
      campaignId,
      'https://instagram.com/p/SPIKE005',
    );
    // Real-clock jitter only ever INCREASES elapsed time, so aim slightly under
    // 10 minutes (a 30s safety margin) to keep the rate at/above 1,000/min.
    await setLastViewsUpdatedAt(submissionId, new Date(Date.now() - (10 * 60_000 - 30_000)));

    const res = await patchViews(submissionId, 10000);
    expect(res.status).toBe(200);
    expect(res.body.submission.flagged).toBe(true);
    expect(res.body.submission.flagReason).toMatch(/^\+10000 views in \d+\.\d min \(\d+\/min\)$/);
  });

  it('6. keeps the flag sticky across a small increase and a decrease', async () => {
    const campaignId = await createCampaign(brand.token);
    const submissionId = await submitPost(
      creator.token,
      campaignId,
      'https://instagram.com/p/SPIKE006',
    );

    await patchViews(submissionId, 60000);
    const afterFlag = await Submission.findById(submissionId).lean();
    expect(afterFlag?.flagged).toBe(true);
    const reason = afterFlag?.flagReason;
    const flaggedAt = afterFlag?.flaggedAt?.getTime();

    // A small increase, then a decrease: neither may clear or change the flag.
    const increased = await patchViews(submissionId, 61000);
    expect(increased.status).toBe(200);
    const decreased = await patchViews(submissionId, 30000);
    expect(decreased.status).toBe(200);

    const stored = await Submission.findById(submissionId).lean();
    expect(stored?.flagged).toBe(true);
    expect(stored?.flagReason).toBe(reason);
    expect(stored?.flaggedAt?.getTime()).toBe(flaggedAt);
  });

  it('7. never overwrites the original flag reason on a later spike', async () => {
    const campaignId = await createCampaign(brand.token);
    const submissionId = await submitPost(
      creator.token,
      campaignId,
      'https://instagram.com/p/SPIKE007',
    );

    await patchViews(submissionId, 60000);
    const first = await Submission.findById(submissionId).lean();
    expect(first?.flagReason).toMatch(FLAG_REASON_60000);

    // Move the clock back a minute, then make another large jump.
    await setLastViewsUpdatedAt(submissionId, minutesAgo(1));
    const second = await patchViews(submissionId, 120000);
    expect(second.status).toBe(200);
    expect(second.body.submission.flagged).toBe(true);

    const stored = await Submission.findById(submissionId).lean();
    expect(stored?.flagReason).toMatch(FLAG_REASON_60000);
  });

  it('8. a decrease does not change the flag and keeps the high-water paid amount', async () => {
    const campaignId = await createCampaign(brand.token);
    const submissionId = await submitPost(
      creator.token,
      campaignId,
      'https://instagram.com/p/SPIKE008',
    );

    await patchViews(submissionId, 60000);
    const afterFlag = await Submission.findById(submissionId).lean();
    const reason = afterFlag?.flagReason;
    const flaggedAt = afterFlag?.flaggedAt?.getTime();

    const decreased = await patchViews(submissionId, 20000);
    expect(decreased.status).toBe(200);
    expect(decreased.body.payout.delta).toBe(0);
    expect(decreased.body.payout.paidAmount).toBe(2000);
    expect(decreased.body.submission.entitledAmount).toBe(2000);
    expect(decreased.body.submission.paidAmount).toBe(2000);

    const stored = await Submission.findById(submissionId).lean();
    expect(stored?.flagged).toBe(true);
    expect(stored?.flagReason).toBe(reason);
    expect(stored?.flaggedAt?.getTime()).toBe(flaggedAt);
    expect(stored?.paidAmount).toBe(2000);
  });

  it('9. exposes flagged and flagReason to the brand and the creator', async () => {
    const campaignId = await createCampaign(brand.token);
    const submissionId = await submitPost(
      creator.token,
      campaignId,
      'https://instagram.com/p/SPIKE009',
    );
    await patchViews(submissionId, 60000);

    const brandView = await request(app)
      .get(`/api/campaigns/${campaignId}/submissions`)
      .set('Authorization', `Bearer ${brand.token}`);
    expect(brandView.status).toBe(200);
    expect(brandView.body.items).toHaveLength(1);
    expect(brandView.body.items[0].flagged).toBe(true);
    expect(brandView.body.items[0].flagReason).toMatch(FLAG_REASON_60000);

    const creatorView = await request(app)
      .get('/api/submissions/mine')
      .set('Authorization', `Bearer ${creator.token}`);
    expect(creatorView.status).toBe(200);
    expect(creatorView.body.items).toHaveLength(1);
    expect(creatorView.body.items[0].flagged).toBe(true);
    expect(creatorView.body.items[0].flagReason).toMatch(FLAG_REASON_60000);
  });

  it('10. flags once and pays once under 10 identical parallel updates', async () => {
    const campaignId = await createCampaign(brand.token);
    const submissionId = await submitPost(
      creator.token,
      campaignId,
      'https://instagram.com/p/SPIKE010',
    );

    const responses = await Promise.all(
      Array.from({ length: 10 }, () => patchViews(submissionId, 60000)),
    );
    for (const res of responses) {
      expect(res.status).toBe(200);
    }

    // The flag is applied exactly once: a single reason, a single timestamp.
    const stored = await Submission.findById(submissionId).lean();
    expect(stored?.flagged).toBe(true);
    expect(stored?.flagReason).toMatch(FLAG_REASON_60000);
    expect(stored?.flaggedAt).toBeInstanceOf(Date);
    expect(stored?.paidAmount).toBe(2000);
    expect(stored?.entitledAmount).toBe(2000);

    const campaign = await Campaign.findById(campaignId).lean();
    expect(campaign?.spent).toBe(2000);

    await assertInvariants(campaignId);
  });
});
