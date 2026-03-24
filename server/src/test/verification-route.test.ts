import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: { select: vi.fn() },
}));

vi.mock('../config/database', () => ({
  db: mocks.db,
}));

vi.mock('../services/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(() => ({})),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    sql: strings.join('?'),
    params: values,
  })),
}));

import verificationRouter from '../routes/verification';

function createApp() {
  const app = express();
  app.use('/api/auth', verificationRouter);
  return app;
}

describe('GET /api/auth/verification-status', () => {
  it('returns uniform pending_verification for any email (anti-enumeration)', async () => {
    const app = createApp();
    const response = await request(app).get('/api/auth/verification-status?email=any@example.com');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      verificationStatus: 'pending_verification',
      rejectionReason: null,
    });
  });

  it('returns same response regardless of email value', async () => {
    const app = createApp();

    const emails = ['unknown@example.com', 'verified@pharmacy.jp', 'rejected@pharmacy.jp'];
    for (const email of emails) {
      const response = await request(app).get(`/api/auth/verification-status?email=${email}`);
      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        verificationStatus: 'pending_verification',
        rejectionReason: null,
      });
    }
  });

  it('does not query the database', async () => {
    const { db } = await import('../config/database');
    const app = createApp();
    await request(app).get('/api/auth/verification-status?email=test@example.com');

    expect(db.select).not.toHaveBeenCalled();
  });

  it('returns 400 when email is missing', async () => {
    const app = createApp();
    const response = await request(app).get('/api/auth/verification-status');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'メールアドレスを指定してください',
    });
  });

  it('returns the same anti-enumeration response even if a database mock is present', async () => {
    const app = createApp();
    const response = await request(app).get('/api/auth/verification-status?email=test@example.com');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      verificationStatus: 'pending_verification',
      rejectionReason: null,
    });
    expect(mocks.db.select).not.toHaveBeenCalled();
  });
});
