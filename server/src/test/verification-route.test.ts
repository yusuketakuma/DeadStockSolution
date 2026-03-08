import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../config/database', () => ({
  db: { select: vi.fn() },
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

  it('returns 500 when database query throws', async () => {
    const query = {
      from: vi.fn(),
      where: vi.fn(),
      limit: vi.fn(),
    };
    query.from.mockReturnValue(query);
    query.where.mockReturnValue(query);
    query.limit.mockRejectedValue(new Error('db failed'));
    mocks.db.select.mockReturnValue(query);

    const app = createApp();
    const response = await request(app).get('/api/auth/verification-status?email=test@example.com');

    expect(response.status).toBe(500);
    expect(response.body.error).toBe('審査ステータスの取得に失敗しました');
  });
});
