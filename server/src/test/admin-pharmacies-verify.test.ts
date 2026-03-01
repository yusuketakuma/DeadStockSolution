import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    transaction: vi.fn(),
  },
  processVerificationCallback: vi.fn(),
  invalidateAuthUserCache: vi.fn(),
  geocodeAddress: vi.fn(),
  writeLog: vi.fn(),
  getClientIp: vi.fn(),
  fetchBusinessHourSettings: vi.fn(),
  validateBusinessHours: vi.fn(),
  validateSpecialBusinessHours: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock('../middleware/auth', () => ({
  requireLogin: (req: { user?: { id: number; email: string; isAdmin: boolean } }, _res: unknown, next: () => void) => {
    req.user = { id: 1, email: 'admin@example.com', isAdmin: true };
    next();
  },
  requireAdmin: (_req: unknown, _res: unknown, next: () => void) => {
    next();
  },
  invalidateAuthUserCache: mocks.invalidateAuthUserCache,
}));

vi.mock('../config/database', () => ({
  db: mocks.db,
}));

vi.mock('../services/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: mocks.loggerError,
  },
}));

vi.mock('../services/pharmacy-verification-callback-service', () => ({
  processVerificationCallback: mocks.processVerificationCallback,
}));

vi.mock('../services/log-service', () => ({
  writeLog: mocks.writeLog,
  getClientIp: mocks.getClientIp,
}));

vi.mock('../services/geocode-service', () => ({
  geocodeAddress: mocks.geocodeAddress,
}));

vi.mock('../routes/business-hours', () => ({
  fetchBusinessHourSettings: mocks.fetchBusinessHourSettings,
  validateBusinessHours: mocks.validateBusinessHours,
  validateSpecialBusinessHours: mocks.validateSpecialBusinessHours,
}));

vi.mock('../utils/validators', () => ({
  emailSchema: {
    safeParse: vi.fn((val: string) => {
      if (val.includes('@')) return { success: true, data: val };
      return { success: false, error: { issues: [{ message: 'メールアドレスが不正です' }] } };
    }),
  },
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn(() => ({})),
  eq: vi.fn(() => ({})),
  sql: vi.fn(() => ({})),
}));

vi.mock('express-rate-limit', () => ({
  default: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import adminRouter from '../routes/admin';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminRouter);
  return app;
}

describe('POST /api/admin/pharmacies/:id/verify', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getClientIp.mockReturnValue('127.0.0.1');
  });

  it('approves pending pharmacy', async () => {
    const app = createApp();
    mocks.processVerificationCallback.mockResolvedValue({
      verificationStatus: 'verified',
      pharmacyId: 5,
    });

    const response = await request(app)
      .post('/api/admin/pharmacies/5/verify')
      .send({ approved: true });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      verificationStatus: 'verified',
      pharmacyId: 5,
    });
    expect(mocks.processVerificationCallback).toHaveBeenCalledWith({
      pharmacyId: 5,
      requestId: 0,
      approved: true,
      reason: '管理者による手動承認',
    });
    expect(mocks.invalidateAuthUserCache).toHaveBeenCalledWith(5);
    expect(mocks.writeLog).toHaveBeenCalledWith('admin_verify_pharmacy', expect.objectContaining({
      detail: expect.stringContaining('承認'),
    }));
  });

  it('rejects pending pharmacy with reason', async () => {
    const app = createApp();
    mocks.processVerificationCallback.mockResolvedValue({
      verificationStatus: 'rejected',
      pharmacyId: 5,
    });

    const response = await request(app)
      .post('/api/admin/pharmacies/5/verify')
      .send({ approved: false, reason: '情報不一致' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      verificationStatus: 'rejected',
      pharmacyId: 5,
    });
    expect(mocks.processVerificationCallback).toHaveBeenCalledWith({
      pharmacyId: 5,
      requestId: 0,
      approved: false,
      reason: '情報不一致',
    });
    expect(mocks.invalidateAuthUserCache).toHaveBeenCalledWith(5);
    expect(mocks.writeLog).toHaveBeenCalledWith('admin_verify_pharmacy', expect.objectContaining({
      detail: expect.stringContaining('却下'),
    }));
  });

  it('returns 400 when approved is not boolean', async () => {
    const app = createApp();

    const response = await request(app)
      .post('/api/admin/pharmacies/5/verify')
      .send({ approved: 'yes' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'approved (boolean) を指定してください' });
    expect(mocks.processVerificationCallback).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid id', async () => {
    const app = createApp();

    const response = await request(app)
      .post('/api/admin/pharmacies/abc/verify')
      .send({ approved: true });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: '不正なIDです' });
    expect(mocks.processVerificationCallback).not.toHaveBeenCalled();
  });
});
