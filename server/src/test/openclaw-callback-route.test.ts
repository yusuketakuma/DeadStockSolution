import crypto from 'crypto';
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
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
  processVerificationCallback: vi.fn(),
  invalidateAuthUserCache: vi.fn(),
}));

vi.mock('../config/database', () => ({
  db: mocks.db,
}));

vi.mock('../services/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: mocks.loggerWarn,
    error: mocks.loggerError,
  },
}));

vi.mock('../services/pharmacy-verification-callback-service', () => ({
  processVerificationCallback: mocks.processVerificationCallback,
}));

vi.mock('../middleware/auth', () => ({
  invalidateAuthUserCache: mocks.invalidateAuthUserCache,
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(() => ({})),
  and: vi.fn(() => ({})),
  ne: vi.fn(() => ({})),
}));

import openclawRouter from '../routes/openclaw';
import { resetOpenClawWebhookReplayCacheForTests } from '../services/openclaw-service';

function createApp() {
  const app = express();
  app.use(express.json({
    verify: (req, _res, buf) => {
      (req as { rawBody?: string }).rawBody = buf.toString('utf8');
    },
  }));
  app.use('/api/openclaw', openclawRouter);
  return app;
}

function createSelectLimitQuery(result: unknown) {
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

function createUpdateQuery(returningResult: unknown[] = [{ id: 1 }]) {
  const query = {
    set: vi.fn(),
    where: vi.fn(),
    returning: vi.fn(),
  };
  query.set.mockReturnValue(query);
  query.where.mockReturnValue(query);
  query.returning.mockResolvedValue(returningResult);
  return query;
}

function createInsertQuery() {
  return {
    values: vi.fn().mockResolvedValue(undefined),
  };
}

function createFailingUpdateQuery(error: Error) {
  const query = {
    set: vi.fn(),
    where: vi.fn(),
  };
  query.set.mockReturnValue(query);
  query.where.mockRejectedValue(error);
  return query;
}

function createSignature(secret: string, timestamp: number, rawBody: string): string {
  const digest = crypto.createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');
  return `sha256=${digest}`;
}

describe('openclaw callback route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetOpenClawWebhookReplayCacheForTests();
    process.env.OPENCLAW_WEBHOOK_SECRET = 'webhook-secret';
    process.env.OPENCLAW_WEBHOOK_MAX_SKEW_SECONDS = '300';
    mocks.db.insert.mockImplementation(() => createInsertQuery());
    mocks.db.transaction.mockImplementation(async (callback: (tx: typeof mocks.db) => unknown) => callback(mocks.db));
  });

  it('accepts callback with valid HMAC signature', async () => {
    const app = createApp();
    const currentRow = [{
      id: 12,
      openclawStatus: 'pending_handoff',
      openclawThreadId: null,
      openclawSummary: null,
    }];
    const updateQuery = createUpdateQuery();

    mocks.db.select.mockImplementationOnce(() => createSelectLimitQuery(currentRow));
    mocks.db.update.mockImplementationOnce(() => updateQuery);

    const payload = {
      requestId: 12,
      status: 'in_dialogue',
      threadId: 'thread-1',
      summary: 'started',
    };
    const rawBody = JSON.stringify(payload);
    const nowMs = Date.parse('2026-02-25T12:00:00.000Z');
    const timestamp = Math.floor(nowMs / 1000);
    vi.useFakeTimers();
    vi.setSystemTime(nowMs);

    const res = await request(app)
      .post('/api/openclaw/callback')
      .set('x-openclaw-timestamp', String(timestamp))
      .set('x-openclaw-signature', createSignature('webhook-secret', timestamp, rawBody))
      .send(payload);

    vi.useRealTimers();

    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({
      requestId: 12,
      openclawStatus: 'in_dialogue',
    }));
    expect(mocks.db.update).toHaveBeenCalledTimes(1);
  });

  it('rejects callback when signature is invalid', async () => {
    const app = createApp();
    const payload = { requestId: 12, status: 'in_dialogue' };
    const nowMs = Date.parse('2026-02-25T12:00:00.000Z');
    const timestamp = Math.floor(nowMs / 1000);
    vi.useFakeTimers();
    vi.setSystemTime(nowMs);

    const res = await request(app)
      .post('/api/openclaw/callback')
      .set('x-openclaw-timestamp', String(timestamp))
      .set('x-openclaw-signature', 'sha256=invalidsignature')
      .send(payload);

    vi.useRealTimers();

    expect(res.status).toBe(401);
    expect(mocks.db.select).not.toHaveBeenCalled();
  });

  it('rejects callback when signature headers are missing', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/openclaw/callback')
      .send({ requestId: 12, status: 'in_dialogue' });

    expect(res.status).toBe(401);
    expect(mocks.db.select).not.toHaveBeenCalled();
  });

  it('rejects replayed callback with same signature and timestamp', async () => {
    const app = createApp();
    const currentRow = [{
      id: 12,
      openclawStatus: 'pending_handoff',
      openclawThreadId: null,
      openclawSummary: null,
    }];
    const updateQuery = createUpdateQuery();
    mocks.db.select.mockImplementation(() => createSelectLimitQuery(currentRow));
    mocks.db.update.mockImplementation(() => updateQuery);

    const payload = {
      requestId: 12,
      status: 'in_dialogue',
    };
    const rawBody = JSON.stringify(payload);
    const nowMs = Date.parse('2026-02-25T12:00:00.000Z');
    const timestamp = Math.floor(nowMs / 1000);
    const signature = createSignature('webhook-secret', timestamp, rawBody);
    vi.useFakeTimers();
    vi.setSystemTime(nowMs);

    const first = await request(app)
      .post('/api/openclaw/callback')
      .set('x-openclaw-timestamp', String(timestamp))
      .set('x-openclaw-signature', signature)
      .send(payload);
    const second = await request(app)
      .post('/api/openclaw/callback')
      .set('x-openclaw-timestamp', String(timestamp))
      .set('x-openclaw-signature', signature)
      .send(payload);

    vi.useRealTimers();

    expect(first.status).toBe(200);
    expect(second.status).toBe(401);
    expect(mocks.db.select).toHaveBeenCalledTimes(1);
  });

  it('allows retry when persistence fails before callback is applied', async () => {
    const app = createApp();
    const currentRow = [{
      id: 12,
      openclawStatus: 'pending_handoff',
      openclawThreadId: null,
      openclawSummary: null,
    }];
    const firstUpdateQuery = createFailingUpdateQuery(new Error('temporary database error'));
    const secondUpdateQuery = createUpdateQuery();
    mocks.db.select.mockImplementation(() => createSelectLimitQuery(currentRow));
    mocks.db.update
      .mockImplementationOnce(() => firstUpdateQuery)
      .mockImplementationOnce(() => secondUpdateQuery);

    const payload = {
      requestId: 12,
      status: 'in_dialogue',
      threadId: 'thread-1',
      summary: 'started',
    };
    const rawBody = JSON.stringify(payload);
    const nowMs = Date.parse('2026-02-25T12:00:00.000Z');
    const timestamp = Math.floor(nowMs / 1000);
    const signature = createSignature('webhook-secret', timestamp, rawBody);
    vi.useFakeTimers();
    vi.setSystemTime(nowMs);

    const first = await request(app)
      .post('/api/openclaw/callback')
      .set('x-openclaw-timestamp', String(timestamp))
      .set('x-openclaw-signature', signature)
      .send(payload);
    const second = await request(app)
      .post('/api/openclaw/callback')
      .set('x-openclaw-timestamp', String(timestamp))
      .set('x-openclaw-signature', signature)
      .send(payload);

    vi.useRealTimers();

    expect(first.status).toBe(500);
    expect(second.status).toBe(200);
    expect(mocks.db.update).toHaveBeenCalledTimes(2);
  });

  it('creates request update notification when callback marks request completed', async () => {
    const app = createApp();
    const currentRow = [{
      id: 21,
      pharmacyId: 8,
      requestText: '在庫CSV出力',
      openclawStatus: 'implementing',
      openclawThreadId: 'thread-21',
      openclawSummary: null,
    }];
    const updateQuery = createUpdateQuery();
    const insertQuery = createInsertQuery();

    mocks.db.select.mockImplementationOnce(() => createSelectLimitQuery(currentRow));
    mocks.db.update.mockImplementationOnce(() => updateQuery);
    mocks.db.insert.mockImplementationOnce(() => insertQuery);

    const payload = {
      requestId: 21,
      status: 'completed',
      summary: '管理画面にエクスポート機能を追加しました',
      threadId: 'thread-21',
      implementationBranch: 'review',
    };
    const rawBody = JSON.stringify(payload);
    const nowMs = Date.parse('2026-02-25T12:00:00.000Z');
    const timestamp = Math.floor(nowMs / 1000);
    vi.useFakeTimers();
    vi.setSystemTime(nowMs);

    const res = await request(app)
      .post('/api/openclaw/callback')
      .set('x-openclaw-timestamp', String(timestamp))
      .set('x-openclaw-signature', createSignature('webhook-secret', timestamp, rawBody))
      .send(payload);

    vi.useRealTimers();

    expect(res.status).toBe(200);
    expect(mocks.db.insert).toHaveBeenCalledTimes(1);
    expect(insertQuery.values).toHaveBeenCalledWith(expect.objectContaining({
      pharmacyId: 8,
      type: 'request_update',
      referenceType: 'request',
      referenceId: 21,
    }));
  });

  it('does not create duplicate request update notification when already completed', async () => {
    const app = createApp();
    const currentRow = [{
      id: 22,
      pharmacyId: 8,
      requestText: '在庫CSV出力',
      openclawStatus: 'completed',
      openclawThreadId: 'thread-22',
      openclawSummary: 'already done',
    }];
    const noTransitionUpdateQuery = createUpdateQuery([]);
    const completedUpdateQuery = createUpdateQuery();

    mocks.db.select.mockImplementationOnce(() => createSelectLimitQuery(currentRow));
    mocks.db.update
      .mockImplementationOnce(() => noTransitionUpdateQuery)
      .mockImplementationOnce(() => completedUpdateQuery);

    const payload = {
      requestId: 22,
      status: 'completed',
      summary: '再通知しない',
      threadId: 'thread-22',
      implementationBranch: 'review',
    };
    const rawBody = JSON.stringify(payload);
    const nowMs = Date.parse('2026-02-25T12:00:00.000Z');
    const timestamp = Math.floor(nowMs / 1000);
    vi.useFakeTimers();
    vi.setSystemTime(nowMs);

    const res = await request(app)
      .post('/api/openclaw/callback')
      .set('x-openclaw-timestamp', String(timestamp))
      .set('x-openclaw-signature', createSignature('webhook-secret', timestamp, rawBody))
      .send(payload);

    vi.useRealTimers();

    expect(res.status).toBe(200);
    expect(mocks.db.insert).not.toHaveBeenCalled();
    expect(mocks.db.update).toHaveBeenCalledTimes(2);
  });

  it('processes pharmacy_reverification callback on completed status', async () => {
    const app = createApp();
    const currentRow = [{
      id: 31,
      pharmacyId: 9,
      requestText: JSON.stringify({ type: 'pharmacy_reverification' }),
      openclawStatus: 'implementing',
      openclawThreadId: 'thread-31',
      openclawSummary: null,
    }];
    const updateQuery = createUpdateQuery();
    const insertQuery = createInsertQuery();

    mocks.db.select.mockImplementationOnce(() => createSelectLimitQuery(currentRow));
    mocks.db.update.mockImplementationOnce(() => updateQuery);
    mocks.db.insert.mockImplementationOnce(() => insertQuery);
    mocks.processVerificationCallback.mockResolvedValue({
      verificationStatus: 'verified',
      pharmacyId: 9,
      applied: true,
    });

    const payload = {
      requestId: 31,
      status: 'completed',
      summary: JSON.stringify({ approved: true, reason: 'ok' }),
      threadId: 'thread-31',
      implementationBranch: 'review',
    };
    const rawBody = JSON.stringify(payload);
    const nowMs = Date.parse('2026-02-25T12:00:00.000Z');
    const timestamp = Math.floor(nowMs / 1000);
    vi.useFakeTimers();
    vi.setSystemTime(nowMs);

    const res = await request(app)
      .post('/api/openclaw/callback')
      .set('x-openclaw-timestamp', String(timestamp))
      .set('x-openclaw-signature', createSignature('webhook-secret', timestamp, rawBody))
      .send(payload);

    vi.useRealTimers();

    expect(res.status).toBe(200);
    expect(mocks.processVerificationCallback).toHaveBeenCalledWith({
      pharmacyId: 9,
      requestId: 31,
      approved: true,
      reason: 'ok',
    });
    expect(mocks.invalidateAuthUserCache).toHaveBeenCalledWith(9);
  });

  it('skips verification callback parsing for plain-text request payloads', async () => {
    const app = createApp();
    const currentRow = [{
      id: 41,
      pharmacyId: 4,
      requestText: '在庫CSV出力',
      openclawStatus: 'implementing',
      openclawThreadId: 'thread-41',
      openclawSummary: null,
    }];
    const updateQuery = createUpdateQuery();
    const insertQuery = createInsertQuery();

    mocks.db.select.mockImplementationOnce(() => createSelectLimitQuery(currentRow));
    mocks.db.update.mockImplementationOnce(() => updateQuery);
    mocks.db.insert.mockImplementationOnce(() => insertQuery);

    const payload = {
      requestId: 41,
      status: 'completed',
      summary: '通常の完了通知',
      threadId: 'thread-41',
      implementationBranch: 'review',
    };
    const rawBody = JSON.stringify(payload);
    const nowMs = Date.parse('2026-02-25T12:00:00.000Z');
    const timestamp = Math.floor(nowMs / 1000);
    vi.useFakeTimers();
    vi.setSystemTime(nowMs);

    const res = await request(app)
      .post('/api/openclaw/callback')
      .set('x-openclaw-timestamp', String(timestamp))
      .set('x-openclaw-signature', createSignature('webhook-secret', timestamp, rawBody))
      .send(payload);

    vi.useRealTimers();

    expect(res.status).toBe(200);
    expect(mocks.processVerificationCallback).not.toHaveBeenCalled();
    expect(mocks.invalidateAuthUserCache).not.toHaveBeenCalled();
    expect(mocks.loggerError).not.toHaveBeenCalled();
  });

  it('skips verification callback when summary payload is invalid', async () => {
    const app = createApp();
    const currentRow = [{
      id: 51,
      pharmacyId: 5,
      requestText: JSON.stringify({ type: 'pharmacy_reverification' }),
      openclawStatus: 'implementing',
      openclawThreadId: 'thread-51',
      openclawSummary: null,
    }];
    const updateQuery = createUpdateQuery();
    const insertQuery = createInsertQuery();

    mocks.db.select.mockImplementationOnce(() => createSelectLimitQuery(currentRow));
    mocks.db.update.mockImplementationOnce(() => updateQuery);
    mocks.db.insert.mockImplementationOnce(() => insertQuery);

    const payload = {
      requestId: 51,
      status: 'completed',
      summary: JSON.stringify({ reason: 'approved flag is missing' }),
      threadId: 'thread-51',
      implementationBranch: 'review',
    };
    const rawBody = JSON.stringify(payload);
    const nowMs = Date.parse('2026-02-25T12:00:00.000Z');
    const timestamp = Math.floor(nowMs / 1000);
    vi.useFakeTimers();
    vi.setSystemTime(nowMs);

    const res = await request(app)
      .post('/api/openclaw/callback')
      .set('x-openclaw-timestamp', String(timestamp))
      .set('x-openclaw-signature', createSignature('webhook-secret', timestamp, rawBody))
      .send(payload);

    vi.useRealTimers();

    expect(res.status).toBe(200);
    expect(mocks.processVerificationCallback).not.toHaveBeenCalled();
    expect(mocks.invalidateAuthUserCache).not.toHaveBeenCalled();
    expect(mocks.loggerWarn).toHaveBeenCalledWith(
      'Skipped pharmacy verification callback due to invalid summary payload',
      expect.objectContaining({
        requestId: 51,
        pharmacyId: 5,
        summaryProvided: true,
      }),
    );
  });
});
