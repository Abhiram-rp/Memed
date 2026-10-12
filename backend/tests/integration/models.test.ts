import mongoose from 'mongoose';
import { Campaign } from '../../src/models/Campaign';
import { Submission } from '../../src/models/Submission';
import { User } from '../../src/models/User';
import { clearTestDb, setupTestDb, teardownTestDb } from '../helpers/mongo';

beforeAll(async () => {
  await setupTestDb();
  // Build indexes (unique email, unique normalizedUrl, compound status index).
  await Promise.all([User.init(), Campaign.init(), Submission.init()]);
});

afterEach(clearTestDb);

afterAll(teardownTestDb);

describe('User model', () => {
  it('enforces the unique email index (case-insensitively)', async () => {
    await User.create({
      name: 'A',
      email: 'a@b.com',
      passwordHash: 'x'.repeat(60),
      role: 'creator',
    });
    await expect(
      User.create({ name: 'B', email: 'A@B.COM', passwordHash: 'y'.repeat(60), role: 'brand' }),
    ).rejects.toMatchObject({ code: 11000 });
  });

  it('lowercases and trims the email on save', async () => {
    const user = await User.create({
      name: 'A',
      email: '  A@B.COM ',
      passwordHash: 'x'.repeat(60),
      role: 'creator',
    });
    expect(user.email).toBe('a@b.com');
  });

  it('rejects an unknown role', async () => {
    await expect(
      User.create({ name: 'A', email: 'a@b.com', passwordHash: 'x'.repeat(60), role: 'admin' }),
    ).rejects.toThrow();
  });

  it('serializes with id and never exposes passwordHash/_id/__v', async () => {
    const user = await User.create({
      name: 'A',
      email: 'a@b.com',
      passwordHash: 'secret-hash',
      role: 'creator',
    });
    const json = user.toJSON() as Record<string, unknown>;
    expect(json.id).toBe(user.id);
    expect(json._id).toBeUndefined();
    expect(json.__v).toBeUndefined();
    expect(json.passwordHash).toBeUndefined();
  });
});

describe('Campaign model', () => {
  const brandId = new mongoose.Types.ObjectId();

  it('rejects a non-integer budget', async () => {
    await expect(
      Campaign.create({
        brand: brandId,
        name: 'C',
        platform: 'instagram',
        budget: 100.5,
        milestones: [{ views: 10000, payout: 500 }],
      }),
    ).rejects.toThrow();
  });

  it('rejects spent exceeding budget', async () => {
    await expect(
      Campaign.create({
        brand: brandId,
        name: 'C',
        platform: 'instagram',
        budget: 100,
        spent: 101,
        milestones: [{ views: 10000, payout: 500 }],
      }),
    ).rejects.toThrow();
  });

  it('defaults spent to 0 and status to live, and exposes remaining', async () => {
    const campaign = await Campaign.create({
      brand: brandId,
      name: 'C',
      platform: 'youtube',
      budget: 1000,
      milestones: [{ views: 10000, payout: 500 }],
    });
    expect(campaign.spent).toBe(0);
    expect(campaign.status).toBe('live');
    expect(campaign.get('remaining')).toBe(1000);
  });

  it('creates the {status, createdAt} compound index', async () => {
    const indexes = await Campaign.collection.indexes();
    const compound = indexes.find((i) => i.key.status === 1 && i.key.createdAt === -1);
    expect(compound).toBeDefined();
  });
});

describe('Submission model', () => {
  it('enforces the globally unique normalizedUrl index (D11)', async () => {
    const base = {
      campaign: new mongoose.Types.ObjectId(),
      creator: new mongoose.Types.ObjectId(),
      postUrl: 'https://instagram.com/p/ABC123',
    };
    await Submission.create({ ...base, normalizedUrl: 'https://instagram.com/p/ABC123' });
    await expect(
      Submission.create({ ...base, normalizedUrl: 'https://instagram.com/p/ABC123' }),
    ).rejects.toMatchObject({ code: 11000 });
  });

  it('defaults views and amounts to 0 and exposes capped', async () => {
    const submission = await Submission.create({
      campaign: new mongoose.Types.ObjectId(),
      creator: new mongoose.Types.ObjectId(),
      postUrl: 'https://instagram.com/p/ABC123',
      normalizedUrl: 'https://instagram.com/p/ABC123',
    });
    expect(submission.views).toBe(0);
    expect(submission.entitledAmount).toBe(0);
    expect(submission.paidAmount).toBe(0);
    expect(submission.get('capped')).toBe(false);
  });
});
