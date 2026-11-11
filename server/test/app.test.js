import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

let app;

beforeAll(async () => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-that-is-long-enough';
  process.env.NODE_ENV = 'test';
  // Use an isolated local SQLite file for tests.
  process.env.TURSO_DATABASE_URL = 'file:./data/test-attendance.sqlite';
  const mod = await import('../src/app.js');
  app = mod.default;
});

describe('API basics', () => {
  it('returns health ok', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.db).toBe('up');
  });

  it('returns readiness status', async () => {
    const res = await request(app).get('/api/ready');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.db).toBe('up');
  });

  it('requires auth for protected routes', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('rejects invalid login payloads', async () => {
    const res = await request(app).post('/api/auth/login').send({});
    expect(res.status).toBe(400);
  });

  it('validates attendance scan payloads', async () => {
    // Unauthenticated scan endpoint returns 401 before/after validation depending on middleware;
    // protected routes should still reject missing auth.
    const res = await request(app).post('/api/attendance/scan').send({});
    expect([400, 401]).toContain(res.status);
  });

  it('validates correction lookup payloads', async () => {
    const res = await request(app).post('/api/corrections/lookup').send({});
    expect(res.status).toBe(400);
  });

  it('validates event bulk payloads', async () => {
    const res = await request(app).post('/api/events/bulk').send({});
    expect([400, 401]).toContain(res.status);
  });
});
