import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
    insert: vi.fn(),
    transaction: vi.fn(),
  },
  invalidateAuthUserCache: vi.fn(),
  isOpenClawWebhookConfigured: vi.fn(),
  verifyOpenClawWebhookSignature: vi.fn(),
  isOpenClawWebhookReplay: vi.fn(),
  consumeOpenClawWebhookReplay: vi.fn(),
  releaseOpenClawWebhookReplay: vi.fn(),
  isOpenClawStatus: vi.fn(),
  canTransitionOpenClawStatus: vi.fn(),
  isImplementationBranchAllowed: vi.fn(),
  getOpenClawImplementationBranch: vi.fn(),
  processVerificationCallback: vi.fn(),
  isVerificationRequestType: vi.fn(),
}));

vi.mock('../middleware/auth', () => ({
  invalidateAuthUserCache: mocks.invalidateAuthUserCache,
}));

vi.mock('../config/database', () => ({ db: mocks.db }));

vi.mock('../services/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../services/openclaw-service', () => ({
  isOpenClawWebhookConfigured: mocks.isOpenClawWebhookConfigured,
  verifyOpenClawWebhookSignature: mocks.verifyOpenClawWebhookSignature,
  isOpenClawWebhookReplay: mocks.isOpenClawWebhookReplay,
  consumeOpenClawWebhookReplay: mocks.consumeOpenClawWebhookReplay,
  releaseOpenClawWebhookReplay: mocks.releaseOpenClawWebhookReplay,
  isOpenClawStatus: mocks.isOpenClawStatus,
  canTransitionOpenClawStatus: mocks.canTransitionOpenClawStatus,
  isImplementationBranchAllowed: mocks.isImplementationBranchAllowed,
  getOpenClawImplementationBranch: mocks.getOpenClawImplementationBranch,
}));

vi.mock('../services/pharmacy-verification-callback-service', () => ({
  processVerificationCallback: mocks.processVerificationCallback,
}));

vi.mock('../services/pharmacy-verification-service', () => ({
  isVerificationRequestType: mocks.isVerificationRequestType,
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(() => ({})),
  and: vi.fn(() => ({})),
  ne: vi.fn(() => ({})),
}));

vi.mock('express-rate-limit', () => ({
  default: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import openclawRouter from '../routes/openclaw';

function createApp() {
  const app = express();
  app.use(express.json());
  // Add rawBody for webhook signature verification
  app.use((req: express.Request & { rawBody?: string }, _res, next) => {
    req.rawBody = JSON.stringify(req.body);
    next();
  });
  app.use('/api/openclaw', openclawRouter);
  return app;
}

describe('openclaw routes — coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /callback', () => {
    it('returns 503 when webhook not configured', async () => {
      const app = createApp();
      mocks.isOpenClawWebhookConfigured.mockReturnValue(false);

      const res = await request(app)
        .post('/api/openclaw/callback')
        .send({ requestId: 1, status: 'implementing' });

      expect(res.status).toBe(503);
      expect(res.body.error).toContain('webhook が未設定');
    });

    it('returns 401 when signature verification fails', async () => {
      const app = createApp();
      mocks.isOpenClawWebhookConfigured.mockReturnValue(true);
      mocks.verifyOpenClawWebhookSignature.mockReturnValue(false);

      const res = await request(app)
        .post('/api/openclaw/callback')
        .set('x-openclaw-signature', 'bad-sig')
        .send({ requestId: 1, status: 'implementing' });

      expect(res.status).toBe(401);
    });

    it('returns 401 when webhook replay detected', async () => {
      const app = createApp();
      mocks.isOpenClawWebhookConfigured.mockReturnValue(true);
      mocks.verifyOpenClawWebhookSignature.mockReturnValue(true);
      mocks.isOpenClawWebhookReplay.mockReturnValue(true);

      const res = await request(app)
        .post('/api/openclaw/callback')
        .set('x-openclaw-signature', 'valid-sig')
        .send({ requestId: 1, status: 'implementing' });

      expect(res.status).toBe(401);
    });

    it('returns 400 for invalid requestId or status', async () => {
      const app = createApp();
      mocks.isOpenClawWebhookConfigured.mockReturnValue(true);
      mocks.verifyOpenClawWebhookSignature.mockReturnValue(true);
      mocks.isOpenClawWebhookReplay.mockReturnValue(false);
      mocks.isOpenClawStatus.mockReturnValue(false);

      const res = await request(app)
        .post('/api/openclaw/callback')
        .send({ requestId: 'bad', status: 'invalid' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('requestId または status が不正');
    });

    it('returns 409 for disallowed implementation branch', async () => {
      const app = createApp();
      mocks.isOpenClawWebhookConfigured.mockReturnValue(true);
      mocks.verifyOpenClawWebhookSignature.mockReturnValue(true);
      mocks.isOpenClawWebhookReplay.mockReturnValue(false);
      mocks.isOpenClawStatus.mockReturnValue(true);
      mocks.isImplementationBranchAllowed.mockReturnValue(false);

      const res = await request(app)
        .post('/api/openclaw/callback')
        .send({ requestId: 1, status: 'implementing', implementationBranch: 'forbidden-branch' });

      expect(res.status).toBe(409);
      expect(res.body.error).toContain('許可されていない実装ブランチ');
    });

    it('returns 404 when request not found', async () => {
      const app = createApp();
      mocks.isOpenClawWebhookConfigured.mockReturnValue(true);
      mocks.verifyOpenClawWebhookSignature.mockReturnValue(true);
      mocks.isOpenClawWebhookReplay.mockReturnValue(false);
      mocks.isOpenClawStatus.mockReturnValue(true);
      mocks.isImplementationBranchAllowed.mockReturnValue(true);
      mocks.db.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      });

      const res = await request(app)
        .post('/api/openclaw/callback')
        .send({ requestId: 999, status: 'implementing' });

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('対象の要望が見つかりません');
    });

    it('returns 409 for invalid state transition', async () => {
      const app = createApp();
      mocks.isOpenClawWebhookConfigured.mockReturnValue(true);
      mocks.verifyOpenClawWebhookSignature.mockReturnValue(true);
      mocks.isOpenClawWebhookReplay.mockReturnValue(false);
      mocks.isOpenClawStatus.mockReturnValue(true);
      mocks.isImplementationBranchAllowed.mockReturnValue(true);
      mocks.canTransitionOpenClawStatus.mockReturnValue(false);
      mocks.db.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{
              id: 1, pharmacyId: 5, openclawStatus: 'completed',
              openclawThreadId: null, openclawSummary: null, requestText: null,
            }]),
          }),
        }),
      });

      const res = await request(app)
        .post('/api/openclaw/callback')
        .send({ requestId: 1, status: 'implementing' });

      expect(res.status).toBe(409);
      expect(res.body.error).toContain('状態遷移が不正');
    });

    it('returns 401 when replay consume fails', async () => {
      const app = createApp();
      mocks.isOpenClawWebhookConfigured.mockReturnValue(true);
      mocks.verifyOpenClawWebhookSignature.mockReturnValue(true);
      mocks.isOpenClawWebhookReplay.mockReturnValue(false);
      mocks.isOpenClawStatus.mockReturnValue(true);
      mocks.isImplementationBranchAllowed.mockReturnValue(true);
      mocks.canTransitionOpenClawStatus.mockReturnValue(true);
      mocks.consumeOpenClawWebhookReplay.mockReturnValue(false);
      mocks.db.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{
              id: 1, pharmacyId: 5, openclawStatus: 'pending_handoff',
              openclawThreadId: null, openclawSummary: null, requestText: null,
            }]),
          }),
        }),
      });

      const res = await request(app)
        .post('/api/openclaw/callback')
        .send({ requestId: 1, status: 'implementing' });

      expect(res.status).toBe(401);
    });

    it('processes implementing status callback successfully', async () => {
      const app = createApp();
      mocks.isOpenClawWebhookConfigured.mockReturnValue(true);
      mocks.verifyOpenClawWebhookSignature.mockReturnValue(true);
      mocks.isOpenClawWebhookReplay.mockReturnValue(false);
      mocks.isOpenClawStatus.mockReturnValue(true);
      mocks.isImplementationBranchAllowed.mockReturnValue(true);
      mocks.canTransitionOpenClawStatus.mockReturnValue(true);
      mocks.consumeOpenClawWebhookReplay.mockReturnValue(true);
      mocks.getOpenClawImplementationBranch.mockReturnValue('main');
      mocks.db.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{
              id: 1, pharmacyId: 5, openclawStatus: 'pending_handoff',
              openclawThreadId: null, openclawSummary: null, requestText: null,
            }]),
          }),
        }),
      });
      mocks.db.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        const txMock = {
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue(undefined),
            }),
          }),
        };
        return fn(txMock);
      });

      const res = await request(app)
        .post('/api/openclaw/callback')
        .send({ requestId: 1, status: 'implementing', threadId: 'thread-1' });

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('コールバックを反映');
      expect(res.body.openclawStatus).toBe('implementing');
    });

    it('processes completed status with notification', async () => {
      const app = createApp();
      mocks.isOpenClawWebhookConfigured.mockReturnValue(true);
      mocks.verifyOpenClawWebhookSignature.mockReturnValue(true);
      mocks.isOpenClawWebhookReplay.mockReturnValue(false);
      mocks.isOpenClawStatus.mockReturnValue(true);
      mocks.isImplementationBranchAllowed.mockReturnValue(true);
      mocks.canTransitionOpenClawStatus.mockReturnValue(true);
      mocks.consumeOpenClawWebhookReplay.mockReturnValue(true);
      mocks.getOpenClawImplementationBranch.mockReturnValue('main');
      mocks.isVerificationRequestType.mockReturnValue(false);
      mocks.db.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{
              id: 1, pharmacyId: 5, openclawStatus: 'implementing',
              openclawThreadId: 'thread-1', openclawSummary: null,
              requestText: null,
            }]),
          }),
        }),
      });
      mocks.db.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        const txMock = {
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue([{ id: 1 }]),
              }),
            }),
          }),
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockResolvedValue(undefined),
          }),
        };
        return fn(txMock);
      });

      const res = await request(app)
        .post('/api/openclaw/callback')
        .send({ requestId: 1, status: 'completed', summary: '対応完了', implementationBranch: 'main' });

      expect(res.status).toBe(200);
      expect(res.body.openclawStatus).toBe('completed');
    });

    it('returns 500 on unexpected error', async () => {
      const app = createApp();
      mocks.isOpenClawWebhookConfigured.mockReturnValue(true);
      mocks.verifyOpenClawWebhookSignature.mockReturnValue(true);
      mocks.isOpenClawWebhookReplay.mockReturnValue(false);
      mocks.isOpenClawStatus.mockReturnValue(true);
      mocks.isImplementationBranchAllowed.mockReturnValue(true);
      mocks.canTransitionOpenClawStatus.mockReturnValue(true);
      mocks.consumeOpenClawWebhookReplay.mockReturnValue(true);
      mocks.db.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{
              id: 1, pharmacyId: 5, openclawStatus: 'pending_handoff',
              openclawThreadId: null, openclawSummary: null, requestText: null,
            }]),
          }),
        }),
      });
      mocks.db.transaction.mockRejectedValue(new Error('Transaction error'));

      const res = await request(app)
        .post('/api/openclaw/callback')
        .send({ requestId: 1, status: 'implementing' });

      expect(res.status).toBe(500);
      expect(mocks.releaseOpenClawWebhookReplay).toHaveBeenCalled();
    });
  });
});
