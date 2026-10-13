import { updateViewsBodySchema, viewsParamsSchema } from '../../src/validators/submission';

const VALID_ID = '507f191e810c19729de860ea';

describe('updateViewsBodySchema', () => {
  it('accepts views = 0', () => {
    expect(updateViewsBodySchema.parse({ views: 0 })).toEqual({ views: 0 });
  });

  it('accepts the maximum views = 2_000_000_000', () => {
    expect(updateViewsBodySchema.parse({ views: 2_000_000_000 })).toEqual({ views: 2_000_000_000 });
  });

  it('rejects views one above the maximum (2_000_000_001)', () => {
    expect(() => updateViewsBodySchema.parse({ views: 2_000_000_001 })).toThrow();
  });

  it('rejects a negative view count', () => {
    expect(() => updateViewsBodySchema.parse({ views: -1 })).toThrow();
  });

  it('rejects a float', () => {
    expect(() => updateViewsBodySchema.parse({ views: 1.5 })).toThrow();
  });

  it('rejects a numeric string (no coercion)', () => {
    expect(() => updateViewsBodySchema.parse({ views: '500' })).toThrow();
  });

  it('rejects null', () => {
    expect(() => updateViewsBodySchema.parse({ views: null })).toThrow();
  });

  it('rejects NaN', () => {
    expect(() => updateViewsBodySchema.parse({ views: NaN })).toThrow();
  });

  it('rejects a missing views field', () => {
    expect(() => updateViewsBodySchema.parse({})).toThrow();
  });

  it('rejects an unknown extra key alongside views', () => {
    expect(() => updateViewsBodySchema.parse({ views: 10, extra: true })).toThrow();
  });
});

describe('viewsParamsSchema', () => {
  it('accepts a valid ObjectId', () => {
    expect(viewsParamsSchema.parse({ id: VALID_ID })).toEqual({ id: VALID_ID });
  });

  it('rejects a bad id', () => {
    expect(() => viewsParamsSchema.parse({ id: 'bad' })).toThrow();
  });
});
