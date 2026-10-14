import {
  MAX_MILESTONES,
  MIN_MILESTONES,
  normalizeMilestones,
  validateMilestones,
  type MilestoneInput,
  type MilestoneValidationResult,
} from '../../src/domain/milestones';

const LADDER: MilestoneInput[] = [
  { views: 10_000, payout: 500 },
  { views: 50_000, payout: 2_000 },
  { views: 100_000, payout: 5_000 },
];

function errorPaths(result: MilestoneValidationResult): string[] {
  return result.ok ? [] : result.errors.map((error) => error.path);
}

describe('normalizeMilestones', () => {
  it('returns a new ladder sorted ascending by views', () => {
    const input: MilestoneInput[] = [
      { views: 3_000, payout: 300 },
      { views: 1_000, payout: 100 },
      { views: 2_000, payout: 200 },
    ];

    expect(normalizeMilestones(input)).toEqual([
      { views: 1_000, payout: 100 },
      { views: 2_000, payout: 200 },
      { views: 3_000, payout: 300 },
    ]);
  });

  it('does not mutate the input array or its objects', () => {
    const input: MilestoneInput[] = [
      { views: 3_000, payout: 300 },
      { views: 1_000, payout: 100 },
    ];
    const snapshot = structuredClone(input);

    const sorted = normalizeMilestones(input);

    expect(input).toEqual(snapshot);
    expect(sorted).not.toBe(input);
    expect(sorted[0]).not.toBe(input[1]);
  });
});

describe('validateMilestones', () => {
  it('accepts a valid ladder and returns it normalized', () => {
    expect(validateMilestones(LADDER, 100_000)).toEqual({ ok: true, milestones: LADDER });
  });

  it('accepts an unsorted ladder and sorts it ascending', () => {
    const unsorted: MilestoneInput[] = [LADDER[2]!, LADDER[0]!, LADDER[1]!];

    expect(validateMilestones(unsorted, 100_000)).toEqual({ ok: true, milestones: LADDER });
  });

  it('accepts a single-milestone ladder', () => {
    const single: MilestoneInput[] = [{ views: 10_000, payout: 500 }];
    expect(validateMilestones(single, 500)).toEqual({ ok: true, milestones: single });
  });

  it('rejects an empty ladder', () => {
    expect(errorPaths(validateMilestones([], 1_000))).toContain('milestones');
  });

  it(`rejects more than ${MAX_MILESTONES} milestones`, () => {
    const tooMany: MilestoneInput[] = Array.from({ length: MAX_MILESTONES + 1 }, (_, index) => ({
      views: (index + 1) * 1_000,
      payout: (index + 1) * 100,
    }));

    expect(errorPaths(validateMilestones(tooMany, 1_000_000))).toContain('milestones');
  });

  it('accepts exactly the maximum number of milestones', () => {
    const max: MilestoneInput[] = Array.from({ length: MAX_MILESTONES }, (_, index) => ({
      views: (index + 1) * 1_000,
      payout: (index + 1) * 100,
    }));

    const result = validateMilestones(max, 1_000_000);
    expect(result.ok).toBe(true);
    expect(result.ok && result.milestones).toHaveLength(MAX_MILESTONES);
  });

  it('rejects duplicate view thresholds', () => {
    const result = validateMilestones(
      [
        { views: 10_000, payout: 500 },
        { views: 10_000, payout: 900 },
      ],
      100_000,
    );
    expect(errorPaths(result)).toContain('milestones.1.views');
  });

  it('rejects a payout that does not strictly increase', () => {
    const result = validateMilestones(
      [
        { views: 10_000, payout: 900 },
        { views: 50_000, payout: 500 },
      ],
      100_000,
    );
    expect(errorPaths(result)).toContain('milestones.1.payout');
  });

  it.each([0, -1, 1.5, Number.NaN])('rejects a non-positive or non-integer views (%p)', (views) => {
    const result = validateMilestones([{ views, payout: 500 }], 100_000);
    expect(errorPaths(result)).toContain('milestones.0.views');
  });

  it.each([0, -1, 1.5, Number.NaN])(
    'rejects a non-positive or non-integer payout (%p)',
    (payout) => {
      const result = validateMilestones([{ views: 10_000, payout }], 100_000);
      expect(errorPaths(result)).toContain('milestones.0.payout');
    },
  );

  it.each([0, -1, 1.5, Number.NaN])(
    'rejects a non-positive or non-integer budget (%p)',
    (budget) => {
      const result = validateMilestones(LADDER, budget);
      expect(errorPaths(result)).toContain('budget');
    },
  );

  it('rejects a budget smaller than the smallest milestone payout', () => {
    const result = validateMilestones([{ views: 10_000, payout: 500 }], 100);
    expect(errorPaths(result)).toContain('budget');
  });

  it('reports every problem at once', () => {
    const result = validateMilestones([{ views: 0, payout: 0 }], 0);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThanOrEqual(3);
    }
  });

  it(`documents the minimum ladder size (${MIN_MILESTONES})`, () => {
    expect(MIN_MILESTONES).toBe(1);
  });
});
