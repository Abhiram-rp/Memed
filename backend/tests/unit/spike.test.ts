import {
  DEFAULT_SPIKE_THRESHOLDS,
  detectSpike,
  type SpikeInput,
  type SpikeThresholds,
} from '../../src/domain/spike';

/** Fixed clock: every test is deterministic and never reads the real time. */
const NOW = new Date('2026-01-01T12:00:00.000Z');

/** A `Date` `minutes` before NOW (negative values are in the future). */
const minutesBefore = (minutes: number): Date => new Date(NOW.getTime() - minutes * 60_000);

/** A `Date` `seconds` before NOW. */
const secondsBefore = (seconds: number): Date => new Date(NOW.getTime() - seconds * 1_000);

/** Build a spike input with defaults; override per test. */
const input = (overrides: Partial<SpikeInput> = {}): SpikeInput => ({
  previousViews: 0,
  newViews: 0,
  previousUpdatedAt: NOW,
  now: NOW,
  ...overrides,
});

describe('detectSpike — flagging rule', () => {
  it('flags a first update gaining 10,000 views in 5 seconds (elapsed floored to 1 min)', () => {
    const result = detectSpike(
      input({ previousViews: 0, newViews: 10_000, previousUpdatedAt: secondsBefore(5), now: NOW }),
    );
    expect(result.flagged).toBe(true);
    expect(result.reason).toBe('+10000 views in 1.0 min (10000/min)');
  });

  it('does not flag 9,999 views gained within a minute (below minDelta)', () => {
    const result = detectSpike(
      input({ previousViews: 0, newViews: 9_999, previousUpdatedAt: minutesBefore(1), now: NOW }),
    );
    expect(result.flagged).toBe(false);
  });

  it('flags exactly 10,000 gained within a minute (inclusive minDelta boundary)', () => {
    const result = detectSpike(
      input({ previousViews: 0, newViews: 10_000, previousUpdatedAt: minutesBefore(1), now: NOW }),
    );
    expect(result.flagged).toBe(true);
  });

  it('flags 10,000 gained over exactly 10 minutes (inclusive rate boundary)', () => {
    const result = detectSpike(
      input({ previousViews: 0, newViews: 10_000, previousUpdatedAt: minutesBefore(10), now: NOW }),
    );
    expect(result.flagged).toBe(true);
  });

  it('does not flag 10,000 gained over 11 minutes (rate ~909/min)', () => {
    const result = detectSpike(
      input({ previousViews: 0, newViews: 10_000, previousUpdatedAt: minutesBefore(11), now: NOW }),
    );
    expect(result.flagged).toBe(false);
  });

  it('flags 100,000 gained over 60 minutes (rate ~1667/min)', () => {
    const result = detectSpike(
      input({ previousViews: 0, newViews: 100_000, previousUpdatedAt: minutesBefore(60), now: NOW }),
    );
    expect(result.flagged).toBe(true);
  });

  it('does not flag 20,000 gained over 30 minutes (rate ~667/min)', () => {
    const result = detectSpike(
      input({ previousViews: 0, newViews: 20_000, previousUpdatedAt: minutesBefore(30), now: NOW }),
    );
    expect(result.flagged).toBe(false);
  });

  it('does not flag when views decrease', () => {
    const result = detectSpike(
      input({
        previousViews: 60_000,
        newViews: 20_000,
        previousUpdatedAt: minutesBefore(1),
        now: NOW,
      }),
    );
    expect(result.flagged).toBe(false);
  });

  it('does not flag when views are unchanged', () => {
    const result = detectSpike(
      input({
        previousViews: 60_000,
        newViews: 60_000,
        previousUpdatedAt: minutesBefore(1),
        now: NOW,
      }),
    );
    expect(result.flagged).toBe(false);
  });

  it('treats clock skew (now earlier than previousUpdatedAt) as one minute and flags', () => {
    const result = detectSpike(
      input({ previousViews: 0, newViews: 50_000, previousUpdatedAt: minutesBefore(-5), now: NOW }),
    );
    expect(result.flagged).toBe(true);
    expect(result.reason).toBe('+50000 views in 1.0 min (50000/min)');
  });

  it('honours custom thresholds and differs from the defaults for the same input', () => {
    const custom: SpikeThresholds = { minDelta: 500, ratePerMin: 50 };
    const value = input({
      previousViews: 0,
      newViews: 600,
      previousUpdatedAt: minutesBefore(5),
      now: NOW,
    });

    expect(detectSpike(value, custom).flagged).toBe(true);
    expect(detectSpike(value, DEFAULT_SPIKE_THRESHOLDS).flagged).toBe(false);
  });
});

describe('detectSpike — reason formatting', () => {
  it('matches the exact format for a whole-minute case', () => {
    const result = detectSpike(
      input({ previousViews: 0, newViews: 60_000, previousUpdatedAt: minutesBefore(1), now: NOW }),
    );
    expect(result.flagged).toBe(true);
    expect(result.reason).toBe('+60000 views in 1.0 min (60000/min)');
  });

  it('renders a fractional minute count (2.5 min)', () => {
    const result = detectSpike(
      input({ previousViews: 0, newViews: 30_000, previousUpdatedAt: minutesBefore(2.5), now: NOW }),
    );
    expect(result.flagged).toBe(true);
    expect(result.reason).toBe('+30000 views in 2.5 min (12000/min)');
  });

  it('omits the reason when not flagged', () => {
    const result = detectSpike(
      input({ previousViews: 0, newViews: 9_999, previousUpdatedAt: minutesBefore(1), now: NOW }),
    );
    expect(result.flagged).toBe(false);
    expect(result.reason).toBeUndefined();
  });
});

describe('detectSpike — input validation', () => {
  it.each([-1, -10_000, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'throws RangeError for a non-negative-integer previousViews (%p)',
    (previousViews) => {
      expect(() => detectSpike(input({ previousViews }))).toThrow(RangeError);
    },
  );

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'throws RangeError for a non-negative-integer newViews (%p)',
    (newViews) => {
      expect(() => detectSpike(input({ newViews }))).toThrow(RangeError);
    },
  );

  it('throws TypeError for an invalid previousUpdatedAt Date', () => {
    expect(() => detectSpike(input({ previousUpdatedAt: new Date('not-a-date') }))).toThrow(
      TypeError,
    );
  });

  it('throws TypeError for an invalid now Date', () => {
    expect(() => detectSpike(input({ now: new Date('not-a-date') }))).toThrow(TypeError);
  });

  it('throws TypeError when previousUpdatedAt is not a Date', () => {
    expect(() =>
      detectSpike(input({ previousUpdatedAt: '2026-01-01' as unknown as Date })),
    ).toThrow(TypeError);
  });

  it('throws TypeError when now is not a Date', () => {
    expect(() => detectSpike(input({ now: 0 as unknown as Date }))).toThrow(TypeError);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'throws RangeError for a non-positive minDelta (%p)',
    (minDelta) => {
      expect(() => detectSpike(input(), { minDelta, ratePerMin: 1_000 })).toThrow(RangeError);
    },
  );

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'throws RangeError for a non-positive ratePerMin (%p)',
    (ratePerMin) => {
      expect(() => detectSpike(input(), { minDelta: 10_000, ratePerMin })).toThrow(RangeError);
    },
  );

  it('throws RangeError when a threshold is not a number', () => {
    expect(() =>
      detectSpike(input(), { minDelta: '10000' as unknown as number, ratePerMin: 1_000 }),
    ).toThrow(RangeError);
  });
});

describe('detectSpike — purity', () => {
  it('does not mutate the input object, the thresholds or the dates', () => {
    const previousUpdatedAt = minutesBefore(1);
    const now = NOW;
    const value: SpikeInput = Object.freeze({
      previousViews: 0,
      newViews: 60_000,
      previousUpdatedAt,
      now,
    });
    const thresholds: SpikeThresholds = Object.freeze({ minDelta: 10_000, ratePerMin: 1_000 });
    const previousUpdatedAtTime = previousUpdatedAt.getTime();
    const nowTime = now.getTime();

    const result = detectSpike(value, thresholds);

    expect(result.flagged).toBe(true);
    expect(value).toEqual({
      previousViews: 0,
      newViews: 60_000,
      previousUpdatedAt,
      now,
    });
    expect(previousUpdatedAt.getTime()).toBe(previousUpdatedAtTime);
    expect(now.getTime()).toBe(nowTime);
    expect(thresholds).toEqual({ minDelta: 10_000, ratePerMin: 1_000 });
  });
});
