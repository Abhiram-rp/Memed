import request from 'supertest';
import { createApp } from '../../src/app';
import { Submission } from '../../src/models/Submission';
import { User } from '../../src/models/User';
import { clearTestDb, setupTestDb, teardownTestDb } from '../helpers/mongo';

const app = createApp();

const validCampaign = {
  name: 'Alpha Drop',
  platform: 'instagram',
  budget: 100000,
  milestones: [
    { views: 10000, payout: 500 },
    { views: 50000, payout: 2000 },
  ],
};

async function signup(role: 'brand' | 'creator', email: string): Promise<{ token: string; id: string }> {
  const res = await request(app).post('/api/auth/signup').send({
    name: role === 'brand' ? 'Brand User' : 'Creator User',
    email,
    password: 'min8chars',
    role,
  });
  expect(res.status).toBe(201);
  return { token: res.body.token, id: res.body.user.id };
}

async function createCampaign(token: string, body: object) {
  return request(app).post('/api/campaigns').set('Authorization', `Bearer ${token}`).send(body);
}

/** Insert a submission directly (the submit flow is Phase 5). */
async function insertSubmission(
  campaignId: string,
  creatorId: string,
  overrides: Partial<{
    postUrl: string;
    views: number;
    entitledAmount: number;
    paidAmount: number;
    flagged: boolean;
    flagReason: string | null;
    createdAt: Date;
  }> = {},
) {
  const postUrl =
    overrides.postUrl ?? `https://www.instagram.com/p/${Math.random().toString(36).slice(2)}/`;
  return Submission.create({
    campaign: campaignId,
    creator: creatorId,
    postUrl,
    normalizedUrl: postUrl,
    views: overrides.views ?? 0,
    entitledAmount: overrides.entitledAmount ?? 0,
    paidAmount: overrides.paidAmount ?? 0,
    lastViewsUpdatedAt: new Date(),
    flagged: overrides.flagged ?? false,
    flagReason: overrides.flagReason ?? null,
    createdAt: overrides.createdAt,
  });
}

beforeAll(async () => {
  await setupTestDb();
  // Unique indexes back the duplicate-email 409 and the unique normalizedUrl.
  await User.init();
  await Submission.init();
});

afterEach(clearTestDb);

afterAll(teardownTestDb);

describe('Group 1 - Create', () => {
  it('creates a valid campaign: 201, milestones sorted (sent unsorted), spent 0, remaining = budget, status live', async () => {
    const brand = await signup('brand', 'brand@a.com');
    const res = await createCampaign(brand.token, {
      ...validCampaign,
      milestones: [
        { views: 50000, payout: 2000 },
        { views: 10000, payout: 500 },
      ],
    });

    expect(res.status).toBe(201);
    expect(res.body.campaign).toEqual({
      id: expect.any(String),
      name: 'Alpha Drop',
      platform: 'instagram',
      budget: 100000,
      spent: 0,
      remaining: 100000,
      status: 'live',
      milestones: [
        { views: 10000, payout: 500 },
        { views: 50000, payout: 2000 },
      ],
      brand: { id: brand.id, name: 'Brand User' },
      createdAt: expect.any(String),
    });
  });
});

describe('Group 2 - Validation', () => {
  it('rejects duplicate view thresholds with 400 at milestones.1.views', async () => {
    const brand = await signup('brand', 'brand@b.com');
    const res = await createCampaign(brand.token, {
      ...validCampaign,
      milestones: [
        { views: 10000, payout: 500 },
        { views: 10000, payout: 2000 },
      ],
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'milestones.1.views', message: 'milestone views must be strictly increasing' }),
      ]),
    );
  });

  it('rejects non-increasing payouts with 400 at milestones.1.payout', async () => {
    const brand = await signup('brand', 'brand@c.com');
    const res = await createCampaign(brand.token, {
      ...validCampaign,
      milestones: [
        { views: 10000, payout: 2000 },
        { views: 50000, payout: 500 },
      ],
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'milestones.1.payout', message: 'milestone payout must be strictly increasing' }),
      ]),
    );
  });

  it('rejects a budget below the smallest payout with 400 at budget', async () => {
    const brand = await signup('brand', 'brand@d.com');
    const res = await createCampaign(brand.token, {
      ...validCampaign,
      budget: 100,
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'budget', message: 'budget must be at least the smallest milestone payout' }),
      ]),
    );
  });

  it('rejects an empty ladder with 400 at milestones', async () => {
    const brand = await signup('brand', 'brand@e.com');
    const res = await createCampaign(brand.token, {
      ...validCampaign,
      milestones: [],
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'milestones' })]),
    );
  });

  it('rejects more than 20 milestones with 400 at milestones', async () => {
    const brand = await signup('brand', 'brand@f.com');
    const res = await createCampaign(brand.token, {
      ...validCampaign,
      milestones: Array.from({ length: 21 }, (_, i) => ({
        views: (i + 1) * 1000,
        payout: (i + 1) * 100,
      })),
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'milestones' })]),
    );
  });

  it('rejects a float budget with 400 at budget', async () => {
    const brand = await signup('brand', 'brand@g.com');
    const res = await createCampaign(brand.token, {
      ...validCampaign,
      budget: 100.5,
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'budget' })]),
    );
  });
});

describe('Group 3 - Auth and roles', () => {
  it('blocks a creator with 403 FORBIDDEN', async () => {
    const creator = await signup('creator', 'creator@a.com');
    const res = await createCampaign(creator.token, validCampaign);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('returns 401 without a token', async () => {
    const res = await request(app).post('/api/campaigns').send(validCampaign);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('shows each brand only its own campaigns in /mine when two brands exist', async () => {
    const brandA = await signup('brand', 'brand@h.com');
    const brandB = await signup('brand', 'brand@i.com');

    const a1 = await createCampaign(brandA.token, { ...validCampaign, name: 'Alpha One' });
    const a2 = await createCampaign(brandA.token, { ...validCampaign, name: 'Alpha Two' });
    await createCampaign(brandB.token, { ...validCampaign, name: 'Beta One' });

    const resA = await request(app)
      .get('/api/campaigns/mine')
      .set('Authorization', `Bearer ${brandA.token}`);
    expect(resA.status).toBe(200);
    expect(resA.body.items).toHaveLength(2);
    expect(resA.body.items.map((c: { id: string }) => c.id)).toEqual(
      expect.arrayContaining([a1.body.campaign.id, a2.body.campaign.id]),
    );
    expect(resA.body.items.map((c: { name: string }) => c.name)).not.toContain('Beta One');

    const resB = await request(app)
      .get('/api/campaigns/mine')
      .set('Authorization', `Bearer ${brandB.token}`);
    expect(resB.status).toBe(200);
    expect(resB.body.items).toHaveLength(1);
    expect(resB.body.items[0].name).toBe('Beta One');
  });
});

describe('Group 4 - Ownership', () => {
  it('returns 404 for another brand on GET /:id (ownership never revealed)', async () => {
    const brandA = await signup('brand', 'brand@j.com');
    const brandB = await signup('brand', 'brand@k.com');
    const created = await createCampaign(brandA.token, validCampaign);

    const res = await request(app)
      .get(`/api/campaigns/${created.body.campaign.id}`)
      .set('Authorization', `Bearer ${brandB.token}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.message).toBe('Campaign not found');
  });

  it('returns 404 for another brand on GET /:id/submissions', async () => {
    const brandA = await signup('brand', 'brand@l.com');
    const brandB = await signup('brand', 'brand@m.com');
    const created = await createCampaign(brandA.token, validCampaign);

    const res = await request(app)
      .get(`/api/campaigns/${created.body.campaign.id}/submissions`)
      .set('Authorization', `Bearer ${brandB.token}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 400 for a malformed id', async () => {
    const brand = await signup('brand', 'brand@n.com');
    const res = await request(app)
      .get('/api/campaigns/not-an-object-id')
      .set('Authorization', `Bearer ${brand.token}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'id', message: 'Invalid ObjectId' })]),
    );
  });

  it('shows the owner a manually inserted submission with the right DTO shape', async () => {
    const brand = await signup('brand', 'brand@o.com');
    const creator = await signup('creator', 'creator@b.com');
    const created = await createCampaign(brand.token, validCampaign);
    const campaignId = created.body.campaign.id;

    await insertSubmission(campaignId, creator.id, {
      postUrl: 'https://www.instagram.com/p/abc123/',
      views: 100,
      entitledAmount: 500,
      paidAmount: 200, // capped: paid < entitled
    });

    const res = await request(app)
      .get(`/api/campaigns/${campaignId}/submissions`)
      .set('Authorization', `Bearer ${brand.token}`);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toEqual({
      id: expect.any(String),
      campaignId,
      campaign: { id: campaignId, name: 'Alpha Drop', platform: 'instagram' },
      postUrl: 'https://www.instagram.com/p/abc123/',
      views: 100,
      entitledAmount: 500,
      paidAmount: 200,
      capped: true,
      flagged: false,
      flagReason: null,
      creator: { id: creator.id, name: 'Creator User' },
      createdAt: expect.any(String),
    });
  });
});