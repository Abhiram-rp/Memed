import { paginationQuerySchema } from '../../src/validators/common';

describe('paginationQuerySchema', () => {
  it('returns defaults when empty', () => {
    const result = paginationQuerySchema.parse({});
    expect(result.page).toBe(1);
    expect(result.limit).toBe(20);
  });

  it('parses page and limit as numbers', () => {
    const result = paginationQuerySchema.parse({ page: '3', limit: '50' });
    expect(result.page).toBe(3);
    expect(result.limit).toBe(50);
  });

  it('rejects limit > 100', () => {
    expect(() => paginationQuerySchema.parse({ limit: '500' })).toThrow();
  });

  it('rejects limit < 1', () => {
    expect(() => paginationQuerySchema.parse({ limit: '0' })).toThrow();
  });

  it('rejects page < 1', () => {
    expect(() => paginationQuerySchema.parse({ page: '0' })).toThrow();
  });

  it('rejects non-integer page', () => {
    expect(() => paginationQuerySchema.parse({ page: 'abc' })).toThrow();
  });

  it('rejects decimal page', () => {
    expect(() => paginationQuerySchema.parse({ page: '1.5' })).toThrow();
  });
});
