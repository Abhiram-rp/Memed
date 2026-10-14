import { Types } from 'mongoose';
import { Campaign, type CampaignPlatform, type CampaignStatus } from '../../src/models/Campaign';
import { toCampaignDTO, type CampaignLike } from '../../src/services/campaignDto';

const MILESTONES = [
  { views: 10_000, payout: 500 },
  { views: 50_000, payout: 2_000 },
];

/** A plain/lean campaign object with an unpopulated `brand` reference. */
function leanCampaign(overrides: Partial<CampaignLike> = {}): CampaignLike {
  return {
    _id: new Types.ObjectId(),
    name: 'Summer Drop',
    platform: 'instagram' as CampaignPlatform,
    budget: 100_000,
    spent: 2_000,
    status: 'live' as CampaignStatus,
    milestones: MILESTONES,
    brand: new Types.ObjectId(),
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('toCampaignDTO', () => {
  it('computes remaining as budget - spent', () => {
    const dto = toCampaignDTO(leanCampaign({ budget: 100_000, spent: 2_000 }));

    expect(dto.budget).toBe(100_000);
    expect(dto.spent).toBe(2_000);
    expect(dto.remaining).toBe(98_000);
  });

  it('derives remaining even when the input carries a stale remaining field', () => {
    const input = { ...leanCampaign(), remaining: 123 } as CampaignLike & { remaining: number };

    // `remaining` is never trusted from input — it is always recomputed here.
    expect(toCampaignDTO(input).remaining).toBe(98_000);
  });

  it('never leaks _id, __v or other internal fields', () => {
    const dto = toCampaignDTO(leanCampaign({ __v: 7 }));

    expect(dto).not.toHaveProperty('_id');
    expect(dto).not.toHaveProperty('__v');
    expect(dto).not.toHaveProperty('brand', expect.anything());
    expect(Object.keys(dto).sort()).toEqual([
      'budget',
      'createdAt',
      'id',
      'milestones',
      'name',
      'platform',
      'remaining',
      'spent',
      'status',
    ]);
  });

  it('returns id as a string and milestones without subdocument internals', () => {
    const id = new Types.ObjectId();
    const dto = toCampaignDTO(leanCampaign({ _id: id }));

    expect(dto.id).toBe(id.toString());
    expect(dto.milestones).toEqual([
      { views: 10_000, payout: 500 },
      { views: 50_000, payout: 2_000 },
    ]);
    for (const milestone of dto.milestones) {
      expect(Object.keys(milestone).sort()).toEqual(['payout', 'views']);
    }
  });

  it('omits brand when it is an unpopulated ObjectId reference', () => {
    const dto = toCampaignDTO(leanCampaign({ brand: new Types.ObjectId() }));

    expect(dto.brand).toBeUndefined();
    expect(dto).not.toHaveProperty('brand');
  });

  it('includes brand { id, name } only when populated (lean object)', () => {
    const brandId = new Types.ObjectId();
    const dto = toCampaignDTO(
      leanCampaign({ brand: { _id: brandId, name: 'Laugh Factory', email: 'a@b.com' } }),
    );

    expect(dto.brand).toEqual({ id: brandId.toString(), name: 'Laugh Factory' });
    expect(dto.brand).not.toHaveProperty('email');
  });

  it('omits submissionCount when no options are given', () => {
    const dto = toCampaignDTO(leanCampaign());

    expect(dto).not.toHaveProperty('submissionCount');
  });

  it('includes submissionCount only when provided, including zero', () => {
    expect(toCampaignDTO(leanCampaign(), { submissionCount: 4 }).submissionCount).toBe(4);
    expect(toCampaignDTO(leanCampaign(), { submissionCount: 0 }).submissionCount).toBe(0);
  });

  it('works with a hydrated Mongoose document (brand unpopulated)', () => {
    const id = new Types.ObjectId();
    const doc = new Campaign({
      _id: id,
      brand: new Types.ObjectId(),
      name: 'Winter Push',
      platform: 'youtube',
      budget: 5_000,
      spent: 0,
      milestones: [{ views: 1_000, payout: 500 }],
    });

    const dto = toCampaignDTO(doc, { submissionCount: 2 });

    expect(dto.id).toBe(id.toString());
    expect(dto.name).toBe('Winter Push');
    expect(dto.platform).toBe('youtube');
    expect(dto.remaining).toBe(5_000);
    expect(dto.submissionCount).toBe(2);
    expect(dto).not.toHaveProperty('_id');
    expect(dto).not.toHaveProperty('__v');
    expect(dto.brand).toBeUndefined();
  });

  it('works with a hydrated Mongoose document with a populated brand', () => {
    const brandId = new Types.ObjectId();
    const doc = new Campaign({
      brand: brandId,
      name: 'Spring Blitz',
      platform: 'instagram',
      budget: 10_000,
      spent: 500,
      milestones: [{ views: 1_000, payout: 500 }],
    });
    // Simulate `populate('brand')` without a live connection: shadow the path so
    // reads return the populated user sub-object instead of an ObjectId.
    Object.defineProperty(doc, 'brand', {
      value: { _id: brandId, name: 'Meme Co' },
      configurable: true,
      enumerable: true,
    });

    const dto = toCampaignDTO(doc);

    expect(dto.brand).toEqual({ id: brandId.toString(), name: 'Meme Co' });
    expect(dto.brand).not.toHaveProperty('email');
    expect(dto.remaining).toBe(9_500);
  });

  it('throws when the campaign has no id', () => {
    const input = { ...leanCampaign() };
    delete input._id;

    expect(() => toCampaignDTO(input)).toThrow('missing an id');
  });
});
