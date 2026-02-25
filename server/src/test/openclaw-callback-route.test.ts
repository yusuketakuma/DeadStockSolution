import crypto from 'crypto';
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
  },
  loggerError: vi.fn(),
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

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(() => ({})),
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

function createUpdateQuery() {
  const query = {
    set: vi.fn(),
    where: vi.fn(),
  };
  query.set.mockReturnValue(query);
  query.where.mockResolvedValue(undefined);
  return query;
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
});
