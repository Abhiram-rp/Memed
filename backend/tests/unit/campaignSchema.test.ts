import { MAX_MILESTONES } from '../../src/domain/milestones';
import { createCampaignSchema } from '../../src/validators/campaign';
import { objectIdParamSchema } from '../../src/validators/common';

const LADDER = [
  { views: 10_000, payout: 500 },
  { views: 50_000, payout: 2_000 },
  { views: 100_000, payout: 5_000 },
];

/** A body that passes every structural check; override per test. */
function body(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'Summer Drop',
    platform: 'instagram',
    budget: 100_000,
    milestones: LADDER.map((milestone) => ({ ...milestone })),
    ...overrides,
  };
}

/** Issue paths produced by a failed parse (empty when it succeeds). */
function issuePaths(input: unknown): string[] {
  const result = createCampaignSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
}

function accepts(input: unknown): boolean {
  return createCampaignSchema.safeParse(input).success;
}

describe('createCampaignSchema — accepts', () => {
  it('accepts a valid ladder', () => {
    expect(accepts(body())).toBe(true);
  });

  it('accepts an unsorted ladder without reordering it (sorting is the service job)', () => {
    const unsorted = [
      { views: 50_000, payout: 2_000 },
      { views: 10_000, payout: 500 },
    ];

    const result = createCampaignSchema.safeParse(body({ milestones: unsorted }));

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.milestones).toEqual(unsorted);
    }
  });

  it('accepts exactly one milestone', () => {
    expect(accepts(body({ budget: 500, milestones: [{ views: 1, payout: 500 }] }))).toBe(true);
  });

  it(`accepts exactly ${MAX_MILESTONES} milestones`, () => {
    const max = Array.from({ length: MAX_MILESTONES }, (_, index) => ({
      views: (index + 1) * 1_000,
      payout: (index + 1) * 100,
    }));

    expect(accepts(body({ budget: 1_000_000, milestones: max }))).toBe(true);
  });

  it('accepts a budget equal to the smallest payout (D9 boundary)', () => {
    expect(accepts(body({ budget: 500 }))).toBe(true);
  });

  it('accepts a name of exactly 120 characters and trims surrounding spaces', () => {
    const name = `  ${'a'.repeat(120)}  `;
    const result = createCampaignSchema.safeParse(body({ name }));

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('a'.repeat(120));
    }
  });
});

describe('createCampaignSchema — rejects milestone ladders', () => {
  it('rejects duplicate view thresholds with the offending path', () => {
    expect(
      issuePaths(
        body({
          milestones: [
            { views: 10_000, payout: 500 },
            { views: 10_000, payout: 900 },
          ],
        }),
      ),
    ).toContain('milestones.1.views');
  });

  it('rejects payouts that are not strictly increasing after sorting', () => {
    // Sorted ascending by views this becomes 10K→900, 50K→500: the higher
    // threshold pays less, so the second sorted row is the offending one.
    expect(
      issuePaths(
        body({
          milestones: [
            { views: 50_000, payout: 500 },
            { views: 10_000, payout: 900 },
          ],
        }),
      ),
    ).toContain('milestones.1.payout');
  });

  it('rejects a budget lower than the smallest payout (D9)', () => {
    expect(issuePaths(body({ budget: 100 }))).toContain('budget');
  });

  it('rejects an empty milestones array', () => {
    expect(issuePaths(body({ milestones: [] }))).toContain('milestones');
  });

  it(`rejects more than ${MAX_MILESTONES} milestones`, () => {
    const tooMany = Array.from({ length: MAX_MILESTONES + 1 }, (_, index) => ({
      views: (index + 1) * 1_000,
      payout: (index + 1) * 100,
    }));

    expect(issuePaths(body({ budget: 1_000_000, milestones: tooMany }))).toContain('milestones');
  });
});

describe('createCampaignSchema — rejects wrong types and values', () => {
  it('rejects a non-positive milestone views (0, -1)', () => {
    expect(issuePaths(body({ milestones: [{ views: 0, payout: 500 }] }))).toContain(
      'milestones.0.views',
    );
    expect(issuePaths(body({ milestones: [{ views: -1, payout: 500 }] }))).toContain(
      'milestones.0.views',
    );
  });

  it('rejects a non-positive milestone payout (0, -1)', () => {
    expect(issuePaths(body({ milestones: [{ views: 1_000, payout: 0 }] }))).toContain(
      'milestones.0.payout',
    );
  });

  it('rejects float views and payouts', () => {
    expect(issuePaths(body({ milestones: [{ views: 1_000.5, payout: 500 }] }))).toContain(
      'milestones.0.views',
    );
    expect(issuePaths(body({ milestones: [{ views: 1_000, payout: 500.5 }] }))).toContain(
      'milestones.0.payout',
    );
  });

  it('rejects a float or non-positive budget', () => {
    expect(issuePaths(body({ budget: 100_000.5 }))).toContain('budget');
    expect(issuePaths(body({ budget: 0 }))).toContain('budget');
    expect(issuePaths(body({ budget: -1 }))).toContain('budget');
  });

  it('rejects string numbers (no coercion)', () => {
    expect(issuePaths(body({ budget: '100000' }))).toContain('budget');
    expect(issuePaths(body({ milestones: [{ views: '10000', payout: 500 }] }))).toContain(
      'milestones.0.views',
    );
    expect(issuePaths(body({ milestones: [{ views: 10_000, payout: '500' }] }))).toContain(
      'milestones.0.payout',
    );
  });

  it('rejects a missing or empty name', () => {
    expect(issuePaths(body({ name: '' }))).toContain('name');
    expect(issuePaths(body({ name: 'a'.repeat(121) }))).toContain('name');
    expect(issuePaths(body({ name: undefined }))).toContain('name');
  });

  it('rejects an unknown platform', () => {
    expect(issuePaths(body({ platform: 'tiktok' }))).toContain('platform');
    expect(issuePaths(body({ platform: undefined }))).toContain('platform');
  });

  it('rejects a non-object body', () => {
    expect(accepts(null)).toBe(false);
    expect(accepts('not a body')).toBe(false);
  });
});

describe('objectIdParamSchema', () => {
  const VALID_ID = '507f1f77bcf86cd799439011';

  it('accepts a 24-hex ObjectId string', () => {
    expect(objectIdParamSchema.safeParse({ id: VALID_ID }).success).toBe(true);
  });

  it('rejects a short, non-hex or missing id', () => {
    expect(objectIdParamSchema.safeParse({ id: 'abc' }).success).toBe(false);
    expect(objectIdParamSchema.safeParse({ id: 'zzzzzzzzzzzzzzzzzzzzzzzz' }).success).toBe(false);
    expect(objectIdParamSchema.safeParse({}).success).toBe(false);
  });
});
