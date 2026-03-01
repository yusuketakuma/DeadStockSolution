import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
  },
  handoffToOpenClaw: vi.fn(),
  isOpenClawConnectorConfigured: vi.fn(),
  isOpenClawWebhookConfigured: vi.fn(),
  getOpenClawImplementationBranch: vi.fn(),
  buildOpenClawLogContext: vi.fn(),
  getObservabilitySnapshot: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
  writeLog: vi.fn(),
  getClientIp: vi.fn(),
}));

vi.mock('../middleware/auth', () => ({
  requireLogin: (req: { user?: { id: number; email: string; isAdmin: boolean } }, _res: unknown, next: () => void) => {
    req.user = { id: 1, email: 'admin@example.com', isAdmin: true };
    next();
  },
  requireAdmin: (_req: unknown, _res: unknown, next: () => void) => {
    next();
  },
}));

vi.mock('../config/database', () => ({
  db: mocks.db,
}));

vi.mock('../services/openclaw-service', () => ({
  handoffToOpenClaw: mocks.handoffToOpenClaw,
  isOpenClawConnectorConfigured: mocks.isOpenClawConnectorConfigured,
  isOpenClawWebhookConfigured: mocks.isOpenClawWebhookConfigured,
  getOpenClawImplementationBranch: mocks.getOpenClawImplementationBranch,
}));

vi.mock('../services/openclaw-log-context-service', () => ({
  buildOpenClawLogContext: mocks.buildOpenClawLogContext,
}));

vi.mock('../services/observability-service', () => ({
  getObservabilitySnapshot: mocks.getObservabilitySnapshot,
}));

vi.mock('../services/log-service', () => ({
  writeLog: mocks.writeLog,
  getClientIp: mocks.getClientIp,
}));

vi.mock('../services/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: mocks.loggerWarn,
    error: mocks.loggerError,
  },
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn(() => ({})),
  eq: vi.fn(() => ({})),
  inArray: vi.fn(() => ({})),
  desc: vi.fn(() => ({})),
  sql: vi.fn(() => ({})),
  like: vi.fn(() => ({})),
}));

import adminRouter from '../routes/admin';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminRouter);
  return app;
}

function createLogRowsQuery(rows: unknown[]) {
  const query = {
    from: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    offset: vi.fn(),
  };
  query.from.mockReturnValue(query);
  query.where.mockReturnValue(query);
  query.orderBy.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  query.offset.mockResolvedValue(rows);
  return query;
}

function createWhereQuery(result: unknown) {
  const query = {
    from: vi.fn(),
    where: vi.fn(),
  };
  query.from.mockReturnValue(query);
  query.where.mockResolvedValue(result);
  return query;
}

function createGroupByQuery(result: unknown) {
  const query = {
    from: vi.fn(),
    where: vi.fn(),
    groupBy: vi.fn(),
  };
  query.from.mockReturnValue(query);
  query.where.mockReturnValue(query);
  query.groupBy.mockResolvedValue(result);
  return query;
}

function createFailureReasonQuery(result: unknown) {
  const query = {
    from: vi.fn(),
    where: vi.fn(),
    groupBy: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
  };
  query.from.mockReturnValue(query);
  query.where.mockReturnValue(query);
  query.groupBy.mockReturnValue(query);
  query.orderBy.mockReturnValue(query);
  query.limit.mockResolvedValue(result);
  return query;
}

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

function createUpdateQuery() {
  const query = {
    set: vi.fn(),
    where: vi.fn(),
  };
  query.set.mockReturnValue(query);
  query.where.mockResolvedValue(undefined);
  return query;
}

describe('admin routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isOpenClawConnectorConfigured.mockReturnValue(true);
    mocks.isOpenClawWebhookConfigured.mockReturnValue(true);
    mocks.getOpenClawImplementationBranch.mockReturnValue('feature/openclaw');
    mocks.getClientIp.mockReturnValue('127.0.0.1');
  });

  it('returns paginated logs with failure summary', async () => {
    const app = createApp();
    const logs = [
      {
        id: 101,
        pharmacyId: 10,
        action: 'upload',
        detail: '失敗|phase=preview|reason=parse_failed',
        ipAddress: '127.0.0.1',
        createdAt: '2026-02-25T12:00:00.000Z',
      },
      {
        id: 100,
        pharmacyId: null,
        action: 'upload',
        detail: '失敗|phase=confirm|reason=invalid_mapping',
        ipAddress: '127.0.0.1',
        createdAt: '2026-02-25T11:00:00.000Z',
      },
    ];

    mocks.db.select
      .mockImplementationOnce(() => createLogRowsQuery(logs))
      .mockImplementationOnce(() => createWhereQuery([{ id: 10, name: '青葉薬局' }]))
      .mockImplementationOnce(() => createWhereQuery([{ count: 2 }]))
      .mockImplementationOnce(() => createWhereQuery([{ count: 2 }]))
      .mockImplementationOnce(() => createGroupByQuery([{ action: 'upload', count: 2 }]))
      .mockImplementationOnce(() => createFailureReasonQuery([{ reason: 'parse_failed', count: 1 }]));

    const response = await request(app)
      .get('/api/admin/logs')
      .query({ action: 'upload', result: 'failure', keyword: 'parse' });

    expect(response.status).toBe(200);
    expect(response.body.pagination).toEqual(expect.objectContaining({
      page: 1,
      limit: 50,
      total: 2,
      totalPages: 1,
    }));
    expect(response.body.data).toEqual([
      expect.objectContaining({
        id: 101,
        pharmacyName: '青葉薬局',
      }),
      expect.objectContaining({
        id: 100,
        pharmacyName: null,
      }),
    ]);
    expect(response.body.summary).toEqual({
      failureTotal: 2,
      failureByAction: { upload: 2 },
      failureByReason: [{ reason: 'parse_failed', count: 1 }],
    });
    expect(response.body.filters).toEqual({
      action: 'upload',
      result: 'failure',
      keyword: 'parse',
    });
  });

  it('returns paginated system events with summary', async () => {
    const app = createApp();
    const events = [
      {
        id: 201,
        source: 'runtime_error',
        level: 'error',
        eventType: 'http_unhandled_error',
        message: 'GET /api/upload -> 500',
        detailJson: '{"status":500}',
        occurredAt: '2026-02-28T10:00:00.000Z',
        createdAt: '2026-02-28T10:00:00.000Z',
      },
    ];

    mocks.db.select
      .mockImplementationOnce(() => createLogRowsQuery(events))
      .mockImplementationOnce(() => createWhereQuery([{ count: 1 }]))
      .mockImplementationOnce(() => createGroupByQuery([{ source: 'runtime_error', count: 1 }]))
      .mockImplementationOnce(() => createGroupByQuery([{ level: 'error', count: 1 }]));

    const response = await request(app).get('/api/admin/system-events');

    expect(response.status).toBe(200);
    expect(response.body.pagination).toEqual(expect.objectContaining({
      page: 1,
      limit: 50,
      total: 1,
      totalPages: 1,
    }));
    expect(response.body.data).toHaveLength(1);
    expect(response.body.summary).toEqual({
      bySource: { runtime_error: 1 },
      byLevel: { error: 1 },
    });
    expect(response.body.filters).toEqual({
      source: null,
      level: null,
      keyword: null,
    });
  });

  it('re-handoffs request to OpenClaw and updates request when accepted', async () => {
    const app = createApp();
    const requestRow = [{
      id: 12,
      pharmacyId: 10,
      requestText: '在庫一覧のCSV出力を改善してほしい',
      openclawStatus: 'pending_handoff',
    }];
    const updateQuery = createUpdateQuery();

    mocks.db.select.mockImplementationOnce(() => createLimitQuery(requestRow));
    mocks.db.update.mockReturnValue(updateQuery);
    mocks.buildOpenClawLogContext.mockResolvedValue([{ action: 'upload' }]);
    mocks.handoffToOpenClaw.mockResolvedValue({
      accepted: true,
      connectorConfigured: true,
      implementationBranch: 'feature/openclaw',
      status: 'in_dialogue',
      note: 'handoff queued',
      threadId: 'thread-12',
      summary: 'openclaw started',
    });

    const response = await request(app)
      .post('/api/admin/requests/12/handoff');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      message: 'OpenClawへ再連携しました',
      handoff: expect.objectContaining({
        accepted: true,
        status: 'in_dialogue',
      }),
    }));
    expect(mocks.handoffToOpenClaw).toHaveBeenCalledWith(expect.objectContaining({
      requestId: 12,
      pharmacyId: 10,
      context: { operationLogs: [{ action: 'upload' }] },
    }));
    expect(mocks.db.update).toHaveBeenCalledTimes(1);
    expect(updateQuery.set).toHaveBeenCalledWith(expect.objectContaining({
      openclawStatus: 'in_dialogue',
      openclawThreadId: 'thread-12',
      openclawSummary: 'openclaw started',
      updatedAt: expect.any(String),
    }));
  });

  it('returns accepted pending response when context collection fails', async () => {
    const app = createApp();
    const requestRow = [{
      id: 13,
      pharmacyId: 20,
      requestText: 'ランキング画面を追加してほしい',
      openclawStatus: 'pending_handoff',
    }];

    mocks.db.select.mockImplementationOnce(() => createLimitQuery(requestRow));
    mocks.buildOpenClawLogContext.mockRejectedValueOnce(new Error('context unavailable'));
    mocks.handoffToOpenClaw.mockResolvedValue({
      accepted: false,
      connectorConfigured: false,
      implementationBranch: 'feature/openclaw',
      status: 'pending_handoff',
      note: 'connector not configured',
    });

    const response = await request(app)
      .post('/api/admin/requests/13/handoff');

    expect(response.status).toBe(202);
    expect(response.body).toEqual(expect.objectContaining({
      message: 'OpenClaw連携は保留中です',
      handoff: expect.objectContaining({
        accepted: false,
        status: 'pending_handoff',
      }),
    }));
    expect(mocks.handoffToOpenClaw).toHaveBeenCalledWith(expect.objectContaining({
      requestId: 13,
      pharmacyId: 20,
      context: undefined,
    }));
    expect(mocks.db.update).not.toHaveBeenCalled();
    expect(mocks.loggerWarn).toHaveBeenCalledWith(
      'OpenClaw context collection failed on admin handoff',
      expect.objectContaining({
        requestId: 13,
        pharmacyId: 20,
        error: 'context unavailable',
      }),
    );
  });

  it('returns bad request for non-numeric request id', async () => {
    const app = createApp();

    const response = await request(app)
      .post('/api/admin/requests/invalid-id/handoff');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: '不正なIDです' });
    expect(mocks.db.select).not.toHaveBeenCalled();
    expect(mocks.handoffToOpenClaw).not.toHaveBeenCalled();
  });

  it('returns not found when request record does not exist', async () => {
    const app = createApp();

    mocks.db.select.mockImplementationOnce(() => createLimitQuery([]));

    const response = await request(app)
      .post('/api/admin/requests/999/handoff');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: '要望が見つかりません' });
    expect(mocks.handoffToOpenClaw).not.toHaveBeenCalled();
  });

  it('returns bad request when request is already completed', async () => {
    const app = createApp();
    mocks.db.select.mockImplementationOnce(() => createLimitQuery([{
      id: 44,
      pharmacyId: 10,
      requestText: '既存要望',
      openclawStatus: 'completed',
    }]));

    const response = await request(app)
      .post('/api/admin/requests/44/handoff');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: '完了済み要望は再連携できません' });
    expect(mocks.handoffToOpenClaw).not.toHaveBeenCalled();
    expect(mocks.db.update).not.toHaveBeenCalled();
  });

  it('returns bad request when request status is not pending_handoff', async () => {
    const app = createApp();
    mocks.db.select.mockImplementationOnce(() => createLimitQuery([{
      id: 45,
      pharmacyId: 10,
      requestText: '既存要望',
      openclawStatus: 'implementing',
    }]));

    const response = await request(app)
      .post('/api/admin/requests/45/handoff');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: '連携待ちの要望のみ再連携できます' });
    expect(mocks.handoffToOpenClaw).not.toHaveBeenCalled();
    expect(mocks.db.update).not.toHaveBeenCalled();
  });
});
