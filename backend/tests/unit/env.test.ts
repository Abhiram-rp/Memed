import { parseEnv } from '../../src/config/env';

const base = {
  MONGODB_URI: 'mongodb://localhost:27017/memed?replicaSet=rs0',
  JWT_SECRET: 'a'.repeat(40),
};

describe('parseEnv', () => {
  it('applies defaults for a minimal valid environment', () => {
    const env = parseEnv(base);
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(4000);
    expect(env.JWT_EXPIRES_IN).toBe('7d');
    expect(env.CORS_ORIGIN).toBe('http://localhost:3000');
    expect(env.CAMPAIGN_CACHE_TTL_SECONDS).toBe(30);
    expect(env.SPIKE_MIN_DELTA).toBe(10000);
    expect(env.SPIKE_RATE_PER_MIN).toBe(1000);
    expect(env.REDIS_URL).toBeUndefined();
  });

  it('coerces numeric strings to numbers', () => {
    const env = parseEnv({ ...base, PORT: '5000', SPIKE_MIN_DELTA: '250' });
    expect(env.PORT).toBe(5000);
    expect(env.SPIKE_MIN_DELTA).toBe(250);
  });

  it('treats an empty string as unset', () => {
    const env = parseEnv({ ...base, REDIS_URL: '' });
    expect(env.REDIS_URL).toBeUndefined();
  });

  it('rejects a JWT_SECRET shorter than 32 characters', () => {
    expect(() => parseEnv({ ...base, JWT_SECRET: 'short' })).toThrow(/JWT_SECRET/);
  });

  it('rejects a missing MONGODB_URI', () => {
    expect(() => parseEnv({ JWT_SECRET: 'a'.repeat(40) })).toThrow(/MONGODB_URI/);
  });

  it('requires CORS_ORIGIN in production', () => {
    expect(() => parseEnv({ ...base, NODE_ENV: 'production', CORS_ORIGIN: '' })).toThrow(
      /CORS_ORIGIN/,
    );
  });

  it('accepts an explicit CORS_ORIGIN in production', () => {
    const env = parseEnv({ ...base, NODE_ENV: 'production', CORS_ORIGIN: 'https://memed.app' });
    expect(env.CORS_ORIGIN).toBe('https://memed.app');
  });
});
