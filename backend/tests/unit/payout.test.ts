import {
  calculateEntitledPayout,
  calculatePayoutDelta,
  type DeltaInput,
  type Milestone,
} from '../../src/domain/payout';

const LADDER: Milestone[] = [
  { views: 10_000, payout: 500 },
  { views: 50_000, payout: 2_000 },
  { views: 100_000, payout: 5_000 },
];

describe('calculateEntitledPayout', () => {
  it.each([
    [0, 0],
    [9_999, 0],
    [10_000, 500],
    [49_999, 500],
    [50_000, 2_000],
    [99_999, 2_000],
    [100_000, 5_000],
    [10_000_000, 5_000],
  ])('maps %i views to a payout of %i (highest reached milestone only)', (views, expected) => {
    expect(calculateEntitledPayout(views, LADDER)).toBe(expected);
  });

  it('works with a single-milestone ladder', () => {
    const single: Milestone[] = [{ views: 100, payout: 50 }];
    expect(calculateEntitledPayout(99, single)).toBe(0);
    expect(calculateEntitledPayout(100, single)).toBe(50);
  });

  it('yields the same result for an unsorted ladder as for a sorted one', () => {
    const shuffled: Milestone[] = [{ views: 100_000, payout: 5_000 }, LADDER[0]!, LADDER[1]!];
    for (const views of [0, 9_999, 10_000, 50_000, 100_000, 10_000_000]) {
      expect(calculateEntitledPayout(views, shuffled)).toBe(calculateEntitledPayout(views, LADDER));
    }
  });

  it('does not mutate the supplied ladder', () => {
    const input: Milestone[] = [
      { views: 50_000, payout: 2_000 },
      { views: 10_000, payout: 500 },
    ];
    const snapshot = structuredClone(input);

    calculateEntitledPayout(100_000, input);

    expect(input).toEqual(snapshot);
  });

  it('returns 0 for an empty ladder', () => {
    expect(calculateEntitledPayout(1_000_000, [])).toBe(0);
  });

  it.each([-1, -10_000, 0.5, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'throws RangeError for non-negative-integer views (%p)',
    (views) => {
      expect(() => calculateEntitledPayout(views, LADDER)).toThrow(RangeError);
    },
  );
});

describe('calculatePayoutDelta', () => {
  it('pays the unpaid difference when there is plenty of budget', () => {
    const input: DeltaInput = { entitledAmount: 2_000, alreadyPaid: 500, remainingBudget: 100_000 };
    expect(calculatePayoutDelta(input)).toEqual({ delta: 1_500, capped: false });
  });

  it('pays nothing when the submission is already fully paid', () => {
    const input: DeltaInput = {
      entitledAmount: 2_000,
      alreadyPaid: 2_000,
      remainingBudget: 100_000,
    };
    expect(calculatePayoutDelta(input)).toEqual({ delta: 0, capped: false });
  });

  it('caps the delta at the remaining budget and marks it capped', () => {
    const input: DeltaInput = { entitledAmount: 2_000, alreadyPaid: 0, remainingBudget: 500 };
    expect(calculatePayoutDelta(input)).toEqual({ delta: 500, capped: true });
  });

  it('pays nothing and stays capped when the budget is empty', () => {
    const input: DeltaInput = { entitledAmount: 5_000, alreadyPaid: 300, remainingBudget: 0 };
    expect(calculatePayoutDelta(input)).toEqual({ delta: 0, capped: true });
  });

  it('is not capped when the remaining budget exactly equals the amount owed', () => {
    const input: DeltaInput = { entitledAmount: 2_000, alreadyPaid: 500, remainingBudget: 1_500 };
    expect(calculatePayoutDelta(input)).toEqual({ delta: 1_500, capped: false });
  });

  it('never produces a negative delta when alreadyPaid exceeds entitledAmount', () => {
    const input: DeltaInput = { entitledAmount: 500, alreadyPaid: 1_000, remainingBudget: 10_000 };
    const result = calculatePayoutDelta(input);
    expect(result.delta).toBe(0);
    expect(result.delta).toBeGreaterThanOrEqual(0);
  });

  it.each([
    ['entitledAmount', -1],
    ['entitledAmount', 1.5],
    ['entitledAmount', Number.NaN],
    ['alreadyPaid', -1],
    ['alreadyPaid', 0.5],
    ['alreadyPaid', Number.NaN],
    ['remainingBudget', -1],
    ['remainingBudget', 2.5],
    ['remainingBudget', Number.NaN],
  ] as const)('throws RangeError for a negative/non-integer %s (%p)', (field, value) => {
    const input: DeltaInput = { entitledAmount: 1_000, alreadyPaid: 0, remainingBudget: 1_000 };
    expect(() => calculatePayoutDelta({ ...input, [field]: value })).toThrow(RangeError);
  });

  it('never lets total payouts exceed the budget across many simulated updates', () => {
    // Seeded PRNG (mulberry32) keeps the property test deterministic.
    let seed = 0x9e3779b9;
    const random = (): number => {
      seed = (seed + 0x6d2b79f5) >>> 0;
      let t = seed;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
    };

    const budget = 20_000;
    let remaining = budget;
    let totalPaid = 0;
    const submissions = Array.from({ length: 5 }, () => ({ entitled: 0, paid: 0 }));

    for (let step = 0; step < 800; step += 1) {
      const submission = submissions[Math.floor(random() * submissions.length)]!;
      const views = Math.floor(random() * 150_000);

      const entitled = Math.max(submission.entitled, calculateEntitledPayout(views, LADDER));
      const { delta, capped } = calculatePayoutDelta({
        entitledAmount: entitled,
        alreadyPaid: submission.paid,
        remainingBudget: remaining,
      });

      expect(delta).toBeGreaterThanOrEqual(0);
      submission.paid += delta;
      submission.entitled = entitled;
      totalPaid += delta;
      remaining -= delta;

      expect(submission.paid).toBeLessThanOrEqual(submission.entitled);
      expect(totalPaid).toBeLessThanOrEqual(budget);
      expect(remaining).toBeGreaterThanOrEqual(0);
      if (capped) {
        expect(submission.paid).toBeLessThan(submission.entitled);
      }
    }

    expect(totalPaid).toBeLessThanOrEqual(budget);
  });
});
