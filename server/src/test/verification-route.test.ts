import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: { select: vi.fn() },
}));

function mockVerificationRouteDependencies() {
  vi.doMock('../config/database', () => ({
    db: mocks.db,
  }));

  vi.doMock('../services/logger', () => ({
    logger: {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    },
  }));

  vi.doMock('drizzle-orm', () => ({
    eq: vi.fn(() => ({})),
    sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
      sql: strings.join('?'),
      params: values,
    })),
  }));

  vi.doMock('../middleware/error-handler', async () => await vi.importActual('../middleware/error-handler'));
}

let verificationRouter: express.Router;

async function createApp() {
  const app = express();
  app.use('/api/auth', verificationRouter);
  return app;
}

beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  mockVerificationRouteDependencies();
  ({ default: verificationRouter } = await import('../routes/verification'));
});

describe('GET /api/auth/verification-status', () => {
  it('returns uniform pending_verification for any email (anti-enumeration)', async () => {
    const app = await createApp();
    const response = await request(app).get('/api/auth/verification-status?email=any@example.com');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      verificationStatus: 'pending_verification',
      rejectionReason: null,
    });
  });

  it('returns same response regardless of email value', async () => {
    const app = await createApp();

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
    const app = await createApp();
    await request(app).get('/api/auth/verification-status?email=test@example.com');

    expect(db.select).not.toHaveBeenCalled();
  });

  it('returns 400 when email is missing', async () => {
    const app = await createApp();
    const response = await request(app).get('/api/auth/verification-status');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'メールアドレスを指定してください',
    });
  });

  it('returns the same anti-enumeration response even if a database mock is present', async () => {
    const app = await createApp();
    const response = await request(app).get('/api/auth/verification-status?email=test@example.com');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      verificationStatus: 'pending_verification',
      rejectionReason: null,
    });
    expect(mocks.db.select).not.toHaveBeenCalled();
  });
});
