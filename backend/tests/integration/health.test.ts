import request from 'supertest';
import { createApp } from '../../src/app';

describe('GET /health', () => {
  const app = createApp();

  it('returns 200 with status ok and a db state string', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', db: expect.any(String) });
  });

  it('returns the API error envelope for unknown routes', async () => {
    const res = await request(app).get('/definitely-not-a-route');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
