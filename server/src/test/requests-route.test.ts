import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  },
  buildOpenClawLogContext: vi.fn(),
  handoffToOpenClaw: vi.fn(),
}));

// Default user — tests can override
let mockUser: { id: number; email: string; isAdmin: boolean } | undefined = {
  id: 1,
  email: 'user@example.com',
  isAdmin: false,
};

vi.mock('../middleware/auth', () => ({
  requireLogin: (req: { user?: typeof mockUser }, _res: unknown, next: () => void) => {
    if (!mockUser) {
      const res = _res as express.Response;
      res.status(401).json({ error: 'ログインが必要です' });
      return;
    }
    req.user = mockUser;
    next();
  },
}));

vi.mock('../config/database', () => ({
  db: mocks.db,
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(() => ({})),
  desc: vi.fn(() => ({})),
}));

vi.mock('../services/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../services/openclaw-log-context-service', () => ({
  buildOpenClawLogContext: mocks.buildOpenClawLogContext,
}));

vi.mock('../services/openclaw-service', () => ({
  handoffToOpenClaw: mocks.handoffToOpenClaw,
}));

vi.mock('../db/schema', () => ({
  userRequests: {
    id: 'id',
    pharmacyId: 'pharmacyId',
    requestText: 'requestText',
    openclawStatus: 'openclawStatus',
    openclawThreadId: 'openclawThreadId',
    openclawSummary: 'openclawSummary',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
  },
}));

vi.mock('../utils/request-utils', () => ({
  parsePositiveInt: vi.fn((val: string) => {
    const n = parseInt(val, 10);
    return isNaN(n) || n <= 0 ? null : n;
  }),
}));

import requestsRouter from '../routes/requests';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/requests', requestsRouter);
  return app;
}

// Helper to build a chainable select query mock
function createSelectQuery(result: unknown) {
  const query = {
    from: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
  };
  query.from.mockReturnValue(query);
  query.where.mockReturnValue(query);
  query.orderBy.mockReturnValue(query);
  query.limit.mockResolvedValue(result);
  return query;
}

// Helper to build a chainable insert mock
function createInsertQuery(returnRows: unknown[]) {
  return {
    values: vi.fn(() => ({
      returning: vi.fn().mockResolvedValue(returnRows),
    })),
  };
}

// Helper to build a chainable update mock
function createUpdateQuery() {
  return {
    set: vi.fn(() => ({
      where: vi.fn().mockResolvedValue(undefined),
    })),
  };
}

describe('GET /api/requests/me', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser = { id: 1, email: 'user@example.com', isAdmin: false };
  });

  it('returns 401 when unauthenticated', async () => {
    mockUser = undefined;
    const app = createApp();
    const res = await request(app).get('/api/requests/me');
    expect(res.status).toBe(401);
  });

  it('returns 200 with empty list when user has no requests', async () => {
    mocks.db.select.mockReturnValue(createSelectQuery([]));
    const app = createApp();
    const res = await request(app).get('/api/requests/me');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.pagination).toEqual({ limit: 50 });
  });

  it('returns 200 with request list', async () => {
    const rows = [
      {
        id: 10,
        requestText: '在庫の確認をしたい',
        openclawStatus: 'pending_handoff',
        openclawThreadId: null,
        openclawSummary: null,
        createdAt: '2026-03-01T10:00:00Z',
        updatedAt: '2026-03-01T10:00:00Z',
      },
      {
        id: 11,
        requestText: '提案の自動化を希望',
        openclawStatus: 'accepted',
        openclawThreadId: 'thread-99',
        openclawSummary: 'summary',
        createdAt: '2026-03-02T10:00:00Z',
        updatedAt: '2026-03-02T10:00:00Z',
      },
    ];
    mocks.db.select.mockReturnValue(createSelectQuery(rows));
    const app = createApp();
    const res = await request(app).get('/api/requests/me');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].id).toBe(10);
    expect(res.body.data[1].openclawThreadId).toBe('thread-99');
  });

  it('applies custom limit query param (capped at 100)', async () => {
    mocks.db.select.mockReturnValue(createSelectQuery([]));
    const app = createApp();
    const res = await request(app).get('/api/requests/me?limit=20');
    expect(res.status).toBe(200);
    expect(res.body.pagination.limit).toBe(20);
  });

  it('returns 500 when db throws', async () => {
    mocks.db.select.mockImplementation(() => {
      throw new Error('db error');
    });
    const app = createApp();
    const res = await request(app).get('/api/requests/me');
    expect(res.status).toBe(500);
    expect(res.body.error).toBeDefined();
  });
});

describe('POST /api/requests', () => {
  const defaultHandoff = {
    accepted: true,
    connectorConfigured: true,
    implementationBranch: 'feature/req-10',
    status: 'accepted',
    threadId: 'thread-42',
    summary: 'Request accepted',
    note: 'We will handle this shortly',
  };

  const createdRow = {
    id: 10,
    openclawStatus: 'pending_handoff',
    createdAt: '2026-03-01T10:00:00Z',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockUser = { id: 1, email: 'user@example.com', isAdmin: false };
    mocks.db.insert.mockReturnValue(createInsertQuery([createdRow]));
    mocks.db.update.mockReturnValue(createUpdateQuery());
    mocks.buildOpenClawLogContext.mockResolvedValue([]);
    mocks.handoffToOpenClaw.mockResolvedValue(defaultHandoff);
  });

  it('returns 401 when unauthenticated', async () => {
    mockUser = undefined;
    const app = createApp();
    const res = await request(app).post('/api/requests').send({ message: '要望テキスト' });
    expect(res.status).toBe(401);
  });

  it('returns 400 when message is empty string', async () => {
    const app = createApp();
    const res = await request(app).post('/api/requests').send({ message: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('1〜2000文字');
  });

  it('returns 400 when message is whitespace only', async () => {
    const app = createApp();
    const res = await request(app).post('/api/requests').send({ message: '   ' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when message is missing', async () => {
    const app = createApp();
    const res = await request(app).post('/api/requests').send({});
    expect(res.status).toBe(400);
  });

  it('returns 400 when message exceeds 2000 characters', async () => {
    const longMessage = 'a'.repeat(2001);
    const app = createApp();
    const res = await request(app).post('/api/requests').send({ message: longMessage });
    expect(res.status).toBe(400);
  });

  it('returns 201 with valid message and successful handoff', async () => {
    const app = createApp();
    const res = await request(app).post('/api/requests').send({ message: '薬局間取引を改善したい' });
    expect(res.status).toBe(201);
    expect(res.body.message).toBe('要望を受け付けました');
    expect(res.body.request.id).toBe(10);
    expect(res.body.handoff.accepted).toBe(true);
    expect(res.body.handoff.status).toBe('accepted');
    expect(res.body.request.openclawStatus).toBe('accepted');
  });

  it('updates db with handoff result when handoff is accepted', async () => {
    const app = createApp();
    await request(app).post('/api/requests').send({ message: '要望テキスト' });
    expect(mocks.db.update).toHaveBeenCalledTimes(1);
  });

  it('does not update db when handoff is not accepted', async () => {
    mocks.handoffToOpenClaw.mockResolvedValue({
      accepted: false,
      connectorConfigured: false,
      implementationBranch: null,
      status: 'pending_handoff',
      threadId: null,
      summary: null,
      note: 'Connector not configured',
    });
    const app = createApp();
    const res = await request(app).post('/api/requests').send({ message: '要望テキスト' });
    expect(res.status).toBe(201);
    expect(res.body.handoff.accepted).toBe(false);
    expect(mocks.db.update).not.toHaveBeenCalled();
    // openclawStatus should remain original (pending_handoff)
    expect(res.body.request.openclawStatus).toBe('pending_handoff');
  });

  it('continues without context when buildOpenClawLogContext fails', async () => {
    mocks.buildOpenClawLogContext.mockRejectedValue(new Error('context error'));
    const app = createApp();
    const res = await request(app).post('/api/requests').send({ message: '要望テキスト' });
    // Should still succeed — context failure is non-fatal
    expect(res.status).toBe(201);
    expect(mocks.handoffToOpenClaw).toHaveBeenCalledTimes(1);
  });

  it('returns 500 when db insert fails', async () => {
    mocks.db.insert.mockImplementation(() => {
      throw new Error('insert failed');
    });
    const app = createApp();
    const res = await request(app).post('/api/requests').send({ message: '要望テキスト' });
    expect(res.status).toBe(500);
    expect(res.body.error).toBeDefined();
  });

  it('returns 500 when handoffToOpenClaw throws', async () => {
    mocks.handoffToOpenClaw.mockRejectedValue(new Error('handoff error'));
    const app = createApp();
    const res = await request(app).post('/api/requests').send({ message: '要望テキスト' });
    expect(res.status).toBe(500);
  });

  it('accepts message exactly at 2000 character boundary', async () => {
    const boundaryMessage = 'a'.repeat(2000);
    const app = createApp();
    const res = await request(app).post('/api/requests').send({ message: boundaryMessage });
    expect(res.status).toBe(201);
  });
});
