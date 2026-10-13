import request from 'supertest';
import { createApp } from '../../src/app';
import { Campaign } from '../../src/models/Campaign';
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
  const postUrl = overrides.postUrl ?? `https://www.instagram.com/p/${Math.random().toString(36).slice(2)}/`;
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

describe('POST /api/campaigns', () => {
  it('creates a campaign and returns 201 with the public shape', async () => {
    const brand = await signup('brand', 'brand@a.com');
    const res = await createCampaign(brand.token, validCampaign);

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
    // Exit criterion: internals never leak.
    expect(JSON.stringify(res.body)).not.toContain('_id');
    expect(JSON.stringify(res.body)).not.toContain('__v');
  });

  it('accepts an unsorted ladder and stores it sorted ascending', async () => {
    const brand = await signup('brand', 'brand@b.com');
    const res = await createCampaign(brand.token, {
      ...validCampaign,
      milestones: [
        { views: 50000, payout: 2000 },
        { views: 10000, payout: 500 },
      ],
    });

    expect(res.status).toBe(201);
    expect(res.body.campaign.milestones).toEqual([
      { views: 10000, payout: 500 },
      { views: 50000, payout: 2000 },
    ]);
  });

  it('rejects a duplicate threshold with 400 at milestones.1.views', async () => {
    const brand = await signup('brand', 'brand@c.com');
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

  it('rejects a non-increasing payout with 400 at milestones.1.payout', async () => {
    const brand = await signup('brand', 'brand@d.com');
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
    const brand = await signup('brand', 'brand@e.com');
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
});

describe('GET /api/campaigns/mine', () => {
  it('returns only the brand\'s own campaigns with submissionCount 0', async () => {
    const brandA = await signup('brand', 'brand@f.com');
    const brandB = await signup('brand', 'brand@g.com');

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
    for (const campaign of resA.body.items) {
      expect(campaign.submissionCount).toBe(0);
    }

    const resB = await request(app)
      .get('/api/campaigns/mine')
      .set('Authorization', `Bearer ${brandB.token}`);
    expect(resB.status).toBe(200);
    expect(resB.body.items).toHaveLength(1);
    expect(resB.body.items[0].name).toBe('Beta One');
  });

  it('orders newest first', async () => {
    const brand = await signup('brand', 'brand@h.com');
    await Campaign.create([
      {
        brand: brand.id,
        name: 'Old Campaign',
        platform: 'instagram',
        budget: 1000,
        spent: 0,
        status: 'live',
        milestones: [{ views: 100, payout: 50 }],
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      },
      {
        brand: brand.id,
        name: 'New Campaign',
        platform: 'youtube',
        budget: 1000,
        spent: 0,
        status: 'live',
        milestones: [{ views: 100, payout: 50 }],
        createdAt: new Date('2026-01-02T00:00:00.000Z'),
      },
    ]);

    const res = await request(app)
      .get('/api/campaigns/mine')
      .set('Authorization', `Bearer ${brand.token}`);
    expect(res.status).toBe(200);
    expect(res.body.items.map((c: { name: string }) => c.name)).toEqual([
      'New Campaign',
      'Old Campaign',
    ]);
  });

  it('reports submissionCount from the aggregation', async () => {
    const brand = await signup('brand', 'brand@i.com');
    const creator = await signup('creator', 'creator@b.com');
    const created = await createCampaign(brand.token, validCampaign);
    const campaignId = created.body.campaign.id;

    await insertSubmission(campaignId, creator.id);
    await insertSubmission(campaignId, creator.id);

    const res = await request(app)
      .get('/api/campaigns/mine')
      .set('Authorization', `Bearer ${brand.token}`);
    expect(res.status).toBe(200);
    expect(res.body.items[0].submissionCount).toBe(2);
  });

  it('blocks a creator with 403 FORBIDDEN', async () => {
    const creator = await signup('creator', 'creator@c.com');
    const res = await request(app)
      .get('/api/campaigns/mine')
      .set('Authorization', `Bearer ${creator.token}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('returns 401 without a token', async () => {
    const res = await request(app).get('/api/campaigns/mine');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });
});

describe('GET /api/campaigns/:id', () => {
  it('returns the campaign to its owner', async () => {
    const brand = await signup('brand', 'brand@j.com');
    const created = await createCampaign(brand.token, validCampaign);
    const campaignId = created.body.campaign.id;

    const res = await request(app)
      .get(`/api/campaigns/${campaignId}`)
      .set('Authorization', `Bearer ${brand.token}`);
    expect(res.status).toBe(200);
    expect(res.body.campaign).toEqual({
      id: campaignId,
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
      createdAt: expect.any(String),
    });
  });

  it('returns 404 for another brand (ownership never revealed)', async () => {
    const brandA = await signup('brand', 'brand@k.com');
    const brandB = await signup('brand', 'brand@l.com');
    const created = await createCampaign(brandA.token, validCampaign);

    const res = await request(app)
      .get(`/api/campaigns/${created.body.campaign.id}`)
      .set('Authorization', `Bearer ${brandB.token}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.message).toBe('Campaign not found');
  });

  it('returns 404 for an unknown but valid ObjectId', async () => {
    const brand = await signup('brand', 'brand@m.com');
    const res = await request(app)
      .get('/api/campaigns/000000000000000000000000')
      .set('Authorization', `Bearer ${brand.token}`);
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

  it('blocks a creator with 403 FORBIDDEN', async () => {
    const brand = await signup('brand', 'brand@o.com');
    const creator = await signup('creator', 'creator@d.com');
    const created = await createCampaign(brand.token, validCampaign);

    const res = await request(app)
      .get(`/api/campaigns/${created.body.campaign.id}`)
      .set('Authorization', `Bearer ${creator.token}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('returns 401 without a token', async () => {
    const brand = await signup('brand', 'brand@p.com');
    const created = await createCampaign(brand.token, validCampaign);

    const res = await request(app).get(`/api/campaigns/${created.body.campaign.id}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });
});

describe('GET /api/campaigns/:id/submissions', () => {
  it('returns { items: [] } when the campaign has no submissions', async () => {
    const brand = await signup('brand', 'brand@q.com');
    const created = await createCampaign(brand.token, validCampaign);

    const res = await request(app)
      .get(`/api/campaigns/${created.body.campaign.id}/submissions`)
      .set('Authorization', `Bearer ${brand.token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [] });
  });

  it('returns submissions newest first with creator and derived capped', async () => {
    const brand = await signup('brand', 'brand@r.com');
    const creator = await signup('creator', 'creator@e.com');
    const created = await createCampaign(brand.token, validCampaign);
    const campaignId = created.body.campaign.id;

    await insertSubmission(campaignId, creator.id, {
      postUrl: 'https://www.instagram.com/p/older/',
      views: 100,
      entitledAmount: 500,
      paidAmount: 200, // capped: paid < entitled
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    await insertSubmission(campaignId, creator.id, {
      postUrl: 'https://www.instagram.com/p/newer/',
      views: 50,
      entitledAmount: 500,
      paidAmount: 500, // not capped: paid === entitled
      createdAt: new Date('2026-01-02T00:00:00.000Z'),
    });

    const res = await request(app)
      .get(`/api/campaigns/${campaignId}/submissions`)
      .set('Authorization', `Bearer ${brand.token}`);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);

    expect(res.body.items[0]).toEqual({
      id: expect.any(String),
      campaignId,
      campaign: { id: campaignId, name: 'Alpha Drop', platform: 'instagram' },
      postUrl: 'https://www.instagram.com/p/newer/',
      views: 50,
      entitledAmount: 500,
      paidAmount: 500,
      capped: false,
      flagged: false,
      flagReason: null,
      creator: { id: creator.id, name: 'Creator User' },
      createdAt: expect.any(String),
    });

    expect(res.body.items[1]).toEqual({
      id: expect.any(String),
      campaignId,
      campaign: { id: campaignId, name: 'Alpha Drop', platform: 'instagram' },
      postUrl: 'https://www.instagram.com/p/older/',
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

  it('returns 404 for another brand', async () => {
    const brandA = await signup('brand', 'brand@s.com');
    const brandB = await signup('brand', 'brand@t.com');
    const created = await createCampaign(brandA.token, validCampaign);

    const res = await request(app)
      .get(`/api/campaigns/${created.body.campaign.id}/submissions`)
      .set('Authorization', `Bearer ${brandB.token}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 400 for a malformed id', async () => {
    const brand = await signup('brand', 'brand@u.com');
    const res = await request(app)
      .get('/api/campaigns/not-an-object-id/submissions')
      .set('Authorization', `Bearer ${brand.token}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('blocks a creator with 403 FORBIDDEN', async () => {
    const brand = await signup('brand', 'brand@v.com');
    const creator = await signup('creator', 'creator@f.com');
    const created = await createCampaign(brand.token, validCampaign);

    const res = await request(app)
      .get(`/api/campaigns/${created.body.campaign.id}/submissions`)
      .set('Authorization', `Bearer ${creator.token}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });
});