import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
  },
  loggerError: vi.fn(),
}));

vi.mock('../config/database', () => ({
  db: mocks.db,
}));

vi.mock('../services/logger', () => ({
  logger: {
    error: mocks.loggerError,
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

function createLimitQuery(result: unknown) {
  const query = {
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
  };
  query.from.mockReturnValue(query);
  query.where.mockReturnValue(query);
  query.limit.mockResolvedValue(result);
  return query;
}

function createApp() {
  const app = express();
  app.use('/api/auth', verificationRouter);
  return app;
}

describe('GET /api/auth/verification-status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns pending status for pending_verification pharmacy', async () => {
    const query = createLimitQuery([
      { verificationStatus: 'pending_verification', rejectionReason: null },
    ]);
    mocks.db.select.mockReturnValue(query);

    const app = createApp();
    const response = await request(app).get('/api/auth/verification-status?email=test@example.com');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      verificationStatus: 'pending_verification',
      rejectionReason: null,
    });
  });

  it('returns verified status for verified pharmacy', async () => {
    const query = createLimitQuery([
      { verificationStatus: 'verified', rejectionReason: null },
    ]);
    mocks.db.select.mockReturnValue(query);

    const app = createApp();
    const response = await request(app).get('/api/auth/verification-status?email=verified@example.com');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      verificationStatus: 'verified',
      rejectionReason: null,
    });
  });

  it('returns 404 for unknown email', async () => {
    const query = createLimitQuery([]);
    mocks.db.select.mockReturnValue(query);

    const app = createApp();
    const response = await request(app).get('/api/auth/verification-status?email=unknown@example.com');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: 'アカウントが見つかりません',
    });
  });

  it('returns 400 when email is missing', async () => {
    const app = createApp();
    const response = await request(app).get('/api/auth/verification-status');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'メールアドレスを指定してください',
    });
  });
});
