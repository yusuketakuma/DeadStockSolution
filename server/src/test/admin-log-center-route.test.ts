import express, { type Response } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── モック設定 ──────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  queryLogs: vi.fn(),
  getLogSummary: vi.fn(),
  getLogInsights: vi.fn(),
  getLogEntryById: vi.fn(),
  getLogInsightForEntry: vi.fn(),
  getLogIssueHistory: vi.fn(),
  updateLogIssueState: vi.fn(),
  escalateLogAlertToOpenClaw: vi.fn(),
  loggerError: vi.fn(),
}));

// Default user injected by requireLogin mock
let currentUser = { id: 1, email: 'admin@example.com', isAdmin: true };
vi.mock('../services/log-center-service', () => ({
  queryLogs: mocks.queryLogs,
  getLogSummary: mocks.getLogSummary,
  getLogInsights: mocks.getLogInsights,
  getLogEntryById: mocks.getLogEntryById,
  getLogInsightForEntry: mocks.getLogInsightForEntry,
  LOG_ISSUE_WORKFLOW_STATUSES: ['new', 'investigating', 'resolved', 'false_positive'],
  LOG_SOURCES: ['activity_logs', 'system_events', 'drug_master_sync_logs'],
  LOG_LEVELS: ['critical', 'error', 'warning', 'info'],
  isLogLevel: (v: string) => ['critical', 'error', 'warning', 'info'].includes(v),
}));
vi.mock('../services/log-center-issue-service', () => ({
  getLogIssueHistory: mocks.getLogIssueHistory,
  updateLogIssueState: mocks.updateLogIssueState,
}));
vi.mock('../services/openclaw/log-push-service', () => ({
  escalateLogAlertToOpenClaw: mocks.escalateLogAlertToOpenClaw,
}));
vi.mock('../services/logger', () => ({
  logger: {
    error: mocks.loggerError,
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));
vi.mock('../services/observability-service', () => ({
  recordRequestMetric: vi.fn(),
}));
vi.mock('../utils/request-utils', () => ({
  parsePositiveInt: (raw: unknown) => {
    if (typeof raw !== 'string') return undefined;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  },
  normalizeSearchTerm: (raw: unknown) => (typeof raw === 'string' ? raw.trim() || undefined : undefined),
  parseTimestamp: (raw: unknown) => {
    if (typeof raw !== 'string') return null;
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? null : date;
  },
}));
vi.mock('../routes/admin-utils', () => ({
  handleAdminError: (_err: unknown, _logMessage: string, userMessage: string, res: Response) => {
    res.status(500).json({ error: userMessage });
  },
  sendPaginated: (res: Response, data: unknown[], page: number, limit: number, total: number) => {
    res.json({
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  },
  parseListPagination: (req: { query: Record<string, unknown> }, defaultLimit = 50) => {
    const pageRaw = typeof req.query.page === 'string' ? Number.parseInt(req.query.page, 10) : NaN;
    const limitRaw = typeof req.query.limit === 'string' ? Number.parseInt(req.query.limit, 10) : NaN;
    return {
      page: Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1,
      limit: Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : defaultLimit,
    };
  },
}));
vi.mock('../middleware/auth', () => ({
  requireLogin: (req: { user?: unknown }, _res: unknown, next: () => void) => {
    req.user = currentUser;
    next();
  },
  requireAdmin: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

let adminLogCenterRouter: (typeof import('../routes/admin-log-center'))['default'];

// ── テスト用アプリ ────────────────────────────────────────

function createApp(userOverride?: Partial<{ id: number; email: string; isAdmin: boolean }>) {
  if (userOverride) {
    currentUser = { id: 1, email: 'admin@example.com', isAdmin: true, ...userOverride };
  } else {
    currentUser = { id: 1, email: 'admin@example.com', isAdmin: true };
  }
  const app = express();
  app.use(express.json());
  app.use('/api/admin/log-center', adminLogCenterRouter);
  return app;
}

beforeEach(async () => {
  vi.useRealTimers();
  currentUser = { id: 1, email: 'admin@example.com', isAdmin: true };
  vi.resetAllMocks();
  vi.resetModules();
  ({ default: adminLogCenterRouter } = await import('../routes/admin-log-center'));
});

// ── サンプルデータ ──────────────────────────────────────

const sampleEntry = {
  id: 101,
  source: 'system_events' as const,
  level: 'error' as const,
  category: 'http',
  errorCode: 'SYSTEM_INTERNAL_ERROR',
  message: 'POST /api/account -> 500',
  detail: { path: '/api/account', status: 500 },
  pharmacyId: null,
  timestamp: '2026-03-01T10:00:00.000Z',
  whatHappened: 'POST /api/account が 500 を返しました',
  codeLocation: 'server/src/routes/account.ts:42',
  improvementSuggestion: '例外スタックを確認してください',
  tenant: {
    pharmacyId: 5,
    pharmacyName: 'テスト薬局',
    pharmacyEmail: 'tenant@example.com',
    tenantLabel: 'テスト薬局',
  },
  errorCodeMeta: null,
  operatorState: { status: 'new', note: null, updatedAt: null, updatedBy: null },
};

const samplePaginatedResult = {
  entries: [sampleEntry],
  page: 1,
  limit: 50,
  total: 1,
};

// ── GET / ────────────────────────────────────────────────

describe('GET /api/admin/log-center', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.queryLogs.mockResolvedValue(samplePaginatedResult);
  });

  it('クエリパラメータなしで 200 を返す', async () => {
    const app = await createApp();
    const res = await request(app).get('/api/admin/log-center');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('pagination');
    expect(res.body.data).toHaveLength(1);
    expect(mocks.queryLogs).toHaveBeenCalledOnce();
  });

  it('有効な source パラメータでフィルタする', async () => {
    const app = await createApp();
    const res = await request(app).get('/api/admin/log-center?source=system_events');
    expect(res.status).toBe(200);
    expect(mocks.queryLogs).toHaveBeenCalledWith(
      expect.objectContaining({ sources: ['system_events'] }),
    );
  });

  it('有効な level パラメータでフィルタする', async () => {
    const app = await createApp();
    const res = await request(app).get('/api/admin/log-center?level=error');
    expect(res.status).toBe(200);
    expect(mocks.queryLogs).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'error' }),
    );
  });

  it('不正な level パラメータで 400 を返す', async () => {
    const app = await createApp();
    const res = await request(app).get('/api/admin/log-center?level=invalid_level');
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('level');
    expect(mocks.queryLogs).not.toHaveBeenCalled();
  });

  it('有効な日付範囲パラメータでフィルタする', async () => {
    const app = await createApp();
    const from = '2026-01-01T00:00:00Z';
    const to = '2026-01-31T23:59:59Z';
    const res = await request(app)
      .get(`/api/admin/log-center?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    expect(res.status).toBe(200);
    expect(mocks.queryLogs).toHaveBeenCalledWith(
      expect.objectContaining({ from: expect.any(String), to: expect.any(String) }),
    );
  });

  it('不正な from パラメータで 400 を返す', async () => {
    const app = await createApp();
    const res = await request(app).get('/api/admin/log-center?from=not-a-date');
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('from');
  });

  it('不正な to パラメータで 400 を返す', async () => {
    const app = await createApp();
    const res = await request(app).get('/api/admin/log-center?to=not-a-date');
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('to');
  });

  it('from が to より後の場合に 400 を返す', async () => {
    const app = await createApp();
    const res = await request(app)
      .get('/api/admin/log-center?from=2026-03-10T00:00:00Z&to=2026-03-01T00:00:00Z');
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('from');
  });

  it('90日を超える期間指定で 400 を返す', async () => {
    const app = await createApp();
    const res = await request(app)
      .get('/api/admin/log-center?from=2025-01-01T00:00:00Z&to=2025-12-31T00:00:00Z');
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('90日');
  });

  it('ページネーションパラメータを受け取る', async () => {
    const app = await createApp();
    mocks.queryLogs.mockResolvedValue({ ...samplePaginatedResult, page: 2, limit: 10 });
    const res = await request(app).get('/api/admin/log-center?page=2&limit=10');
    expect(res.status).toBe(200);
    expect(mocks.queryLogs).toHaveBeenCalledWith(
      expect.objectContaining({ page: 2, limit: 10 }),
    );
  });

  it('サービスエラー時に 500 を返す', async () => {
    const app = await createApp();
    mocks.queryLogs.mockRejectedValue(new Error('DB error'));
    const res = await request(app).get('/api/admin/log-center');
    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty('error');
  });
});

// ── GET /summary ────────────────────────────────────────

describe('GET /api/admin/log-center/summary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('サマリー統計を 200 で返す', async () => {
    const app = await createApp();
    const summary = {
      total: 100,
      errors: 20,
      warnings: 15,
      today: 5,
      bySeverity: { error: 20, warning: 15, info: 65 },
      bySource: { system_events: 60, activity_logs: 40 },
    };
    mocks.getLogSummary.mockResolvedValue(summary);

    const res = await request(app).get('/api/admin/log-center/summary');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(summary);
    expect(mocks.getLogSummary).toHaveBeenCalledOnce();
  });

  it('サービスエラー時に 500 を返す', async () => {
    const app = await createApp();
    mocks.getLogSummary.mockRejectedValue(new Error('DB error'));
    const res = await request(app).get('/api/admin/log-center/summary');
    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty('error');
  });
});

// ── GET /insights ────────────────────────────────────────

describe('GET /api/admin/log-center/insights', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const sampleInsights = {
    repeatedErrorCount: 5,
    impactedTenantCount: 3,
    topIssues: [
      {
        fingerprint: 'abc123',
        level: 'error',
        title: 'POST /api/account -> 500',
        codeLocation: 'server/src/routes/account.ts',
        errorCode: 'SYSTEM_INTERNAL_ERROR',
        count: 10,
        impactedTenantCount: 3,
        latestOccurredAt: '2026-03-01T10:00:00.000Z',
        sampleLogId: 42,
        source: 'system_events',
      },
    ],
  };

  it('インサイト集計を 200 で返す', async () => {
    const app = await createApp();
    mocks.getLogInsights.mockResolvedValue(sampleInsights);
    const res = await request(app).get('/api/admin/log-center/insights');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(sampleInsights);
    expect(mocks.getLogInsights).toHaveBeenCalledOnce();
    expect(mocks.getLogInsights).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, limit: 200 }),
    );
  });

  it('topLimit パラメータを渡す', async () => {
    const app = await createApp();
    mocks.getLogInsights.mockResolvedValue(sampleInsights);
    const res = await request(app).get('/api/admin/log-center/insights?topLimit=10');
    expect(res.status).toBe(200);
    expect(mocks.getLogInsights).toHaveBeenCalledWith(
      expect.objectContaining({ topLimit: 10 }),
    );
  });

  it('topLimit の上限は 50 に制限される', async () => {
    const app = await createApp();
    mocks.getLogInsights.mockResolvedValue(sampleInsights);
    const res = await request(app).get('/api/admin/log-center/insights?topLimit=999');
    expect(res.status).toBe(200);
    expect(mocks.getLogInsights).toHaveBeenCalledWith(
      expect.objectContaining({ topLimit: 50 }),
    );
  });

  it('不正な level パラメータで 400 を返す', async () => {
    const app = await createApp();
    const res = await request(app).get('/api/admin/log-center/insights?level=bad');
    expect(res.status).toBe(400);
    expect(mocks.getLogInsights).not.toHaveBeenCalled();
  });

  it('サービスエラー時に 500 を返す', async () => {
    const app = await createApp();
    mocks.getLogInsights.mockRejectedValue(new Error('DB error'));
    const res = await request(app).get('/api/admin/log-center/insights');
    expect(res.status).toBe(500);
  });
});

// ── GET /export ──────────────────────────────────────────

describe('GET /api/admin/log-center/export', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.queryLogs.mockResolvedValue(samplePaginatedResult);
  });

  it('JSON エクスポートで正しいヘッダーとボディを返す', async () => {
    const app = await createApp();
    const res = await request(app).get('/api/admin/log-center/export');
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/attachment.*\.json/);
    expect(res.body).toHaveProperty('exportedAt');
    expect(res.body).toHaveProperty('count');
    expect(res.body).toHaveProperty('total');
    expect(res.body).toHaveProperty('entries');
  });

  it('JSON エクスポートで複数ページの結果を取り切る', async () => {
    const app = await createApp();
    mocks.queryLogs
      .mockResolvedValueOnce({
        entries: [sampleEntry],
        page: 1,
        limit: 500,
        total: 501,
      })
      .mockResolvedValueOnce({
        entries: [{ ...sampleEntry, id: 102, logId: 102 }],
        page: 2,
        limit: 500,
        total: 501,
      });

    const res = await request(app).get('/api/admin/log-center/export');

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
    expect(res.body.total).toBe(2);
    expect(res.body.entries).toHaveLength(2);
    expect(mocks.queryLogs).toHaveBeenNthCalledWith(1, expect.objectContaining({
      page: 1,
      limit: 500,
    }));
    expect(mocks.queryLogs).toHaveBeenNthCalledWith(2, expect.objectContaining({
      page: 2,
      limit: 500,
    }));
  });

  it('CSV エクスポートで正しい Content-Type と Content-Disposition を返す', async () => {
    const app = await createApp();
    const res = await request(app).get('/api/admin/log-center/export?format=csv');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toMatch(/attachment.*\.csv/);
  });

  it('CSV エクスポートでヘッダー行を含む', async () => {
    const app = await createApp();
    const res = await request(app).get('/api/admin/log-center/export?format=csv');
    expect(res.status).toBe(200);
    expect(res.text).toContain('"id"');
    expect(res.text).toContain('"source"');
    expect(res.text).toContain('"level"');
    expect(res.text).toContain('"message"');
  });

  it('CSV エクスポートでエントリのデータを含む', async () => {
    const app = await createApp();
    const res = await request(app).get('/api/admin/log-center/export?format=csv');
    expect(res.status).toBe(200);
    expect(res.text).toContain('"system_events"');
    expect(res.text).toContain('"error"');
  });

  it('不正な日付パラメータで 400 を返す', async () => {
    const app = await createApp();
    const res = await request(app).get('/api/admin/log-center/export?from=bad-date');
    expect(res.status).toBe(400);
    expect(mocks.queryLogs).not.toHaveBeenCalled();
  });

  it('サービスエラー時に 500 を返す', async () => {
    const app = await createApp();
    mocks.queryLogs.mockRejectedValue(new Error('DB error'));
    const res = await request(app).get('/api/admin/log-center/export');
    expect(res.status).toBe(500);
  });
});

// ── POST /openclaw ────────────────────────────────────────

describe('POST /api/admin/log-center/openclaw', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getLogEntryById.mockResolvedValue(sampleEntry);
    mocks.getLogInsightForEntry.mockResolvedValue({ count: 5, impactedTenantCount: 3 });
    mocks.escalateLogAlertToOpenClaw.mockResolvedValue(undefined);
  });

  it('有効なリクエストでエスカレーション成功 (200)', async () => {
    const app = await createApp();
    const res = await request(app)
      .post('/api/admin/log-center/openclaw')
      .send({ source: 'system_events', logId: 101 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({
      ok: true,
      escalated: true,
      source: 'system_events',
      logId: 101,
    }));
    expect(mocks.escalateLogAlertToOpenClaw).toHaveBeenCalledOnce();
  });

  it('note パラメータをエスカレーションに渡す', async () => {
    const app = await createApp();
    const res = await request(app)
      .post('/api/admin/log-center/openclaw')
      .send({ source: 'system_events', logId: 101, note: 'テスト注記' });
    expect(res.status).toBe(200);
    expect(mocks.escalateLogAlertToOpenClaw).toHaveBeenCalledWith(
      expect.any(Object),
      'テスト注記',
    );
  });

  it('空の note は undefined として渡す', async () => {
    const app = await createApp();
    const res = await request(app)
      .post('/api/admin/log-center/openclaw')
      .send({ source: 'system_events', logId: 101, note: '   ' });
    expect(res.status).toBe(200);
    expect(mocks.escalateLogAlertToOpenClaw).toHaveBeenCalledWith(
      expect.any(Object),
      undefined,
    );
  });

  it('source がない場合に 400 を返す', async () => {
    const app = await createApp();
    const res = await request(app)
      .post('/api/admin/log-center/openclaw')
      .send({ logId: 101 });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('source');
  });

  it('logId がない場合に 400 を返す', async () => {
    const app = await createApp();
    const res = await request(app)
      .post('/api/admin/log-center/openclaw')
      .send({ source: 'system_events' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('logId');
  });

  it('不正な source で 400 を返す', async () => {
    const app = await createApp();
    const res = await request(app)
      .post('/api/admin/log-center/openclaw')
      .send({ source: 'invalid_source', logId: 101 });
    expect(res.status).toBe(400);
  });

  it('存在しない logId で 404 を返す', async () => {
    const app = await createApp();
    mocks.getLogEntryById.mockResolvedValue(null);
    const res = await request(app)
      .post('/api/admin/log-center/openclaw')
      .send({ source: 'system_events', logId: 999999 });
    expect(res.status).toBe(404);
    expect(res.body.error).toContain('見つかりません');
  });

  it('critical レベルのエントリは severity=critical でエスカレーション', async () => {
    const app = await createApp();
    mocks.getLogEntryById.mockResolvedValue({ ...sampleEntry, level: 'critical' });
    const res = await request(app)
      .post('/api/admin/log-center/openclaw')
      .send({ source: 'system_events', logId: 101 });
    expect(res.status).toBe(200);
    expect(mocks.escalateLogAlertToOpenClaw).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'critical' }),
      undefined,
    );
  });

  it('warning レベルのエントリは severity=warning でエスカレーション', async () => {
    const app = await createApp();
    mocks.getLogEntryById.mockResolvedValue({ ...sampleEntry, level: 'warning' });
    const res = await request(app)
      .post('/api/admin/log-center/openclaw')
      .send({ source: 'system_events', logId: 101 });
    expect(res.status).toBe(200);
    expect(mocks.escalateLogAlertToOpenClaw).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'warning' }),
      undefined,
    );
  });

  it('insight が null の場合も正常に動作する', async () => {
    const app = await createApp();
    mocks.getLogInsightForEntry.mockResolvedValue(null);
    const res = await request(app)
      .post('/api/admin/log-center/openclaw')
      .send({ source: 'system_events', logId: 101 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({
      ok: true,
      escalated: true,
      recurrenceCount: 1,
    }));
  });

  it('サービスエラー時に 500 を返す', async () => {
    const app = await createApp();
    mocks.escalateLogAlertToOpenClaw.mockRejectedValue(new Error('OpenClaw error'));
    const res = await request(app)
      .post('/api/admin/log-center/openclaw')
      .send({ source: 'system_events', logId: 101 });
    expect(res.status).toBe(500);
  });
});

// ── PATCH /status ────────────────────────────────────────

describe('PATCH /api/admin/log-center/status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getLogEntryById.mockResolvedValue(sampleEntry);
    mocks.updateLogIssueState.mockResolvedValue({
      status: 'investigating',
      note: 'テスト注記',
      updatedAt: '2026-03-01T10:00:00.000Z',
      updatedBy: { pharmacyId: 1, pharmacyName: null, pharmacyEmail: 'admin@example.com' },
    });
    mocks.getLogIssueHistory.mockResolvedValue([]);
  });

  it('有効なステータス更新で 200 を返す', async () => {
    const app = await createApp();
    const res = await request(app)
      .patch('/api/admin/log-center/status')
      .send({ source: 'system_events', logId: 101, status: 'investigating' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({
      ok: true,
      source: 'system_events',
      logId: 101,
    }));
    expect(res.body).toHaveProperty('currentState');
    expect(res.body).toHaveProperty('history');
  });

  it('note 付きのステータス更新', async () => {
    const app = await createApp();
    const res = await request(app)
      .patch('/api/admin/log-center/status')
      .send({ source: 'system_events', logId: 101, status: 'resolved', note: '修正完了' });
    expect(res.status).toBe(200);
    expect(mocks.updateLogIssueState).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'resolved', note: '修正完了' }),
    );
  });

  it('不正な status enum で 400 を返す', async () => {
    const app = await createApp();
    const res = await request(app)
      .patch('/api/admin/log-center/status')
      .send({ source: 'system_events', logId: 101, status: 'invalid_status' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('status');
    expect(mocks.updateLogIssueState).not.toHaveBeenCalled();
  });

  it('source がない場合に 400 を返す', async () => {
    const app = await createApp();
    const res = await request(app)
      .patch('/api/admin/log-center/status')
      .send({ logId: 101, status: 'investigating' });
    expect(res.status).toBe(400);
  });

  it('logId がない場合に 400 を返す', async () => {
    const app = await createApp();
    const res = await request(app)
      .patch('/api/admin/log-center/status')
      .send({ source: 'system_events', status: 'investigating' });
    expect(res.status).toBe(400);
  });

  it('存在しない logId で 404 を返す', async () => {
    const app = await createApp();
    mocks.getLogEntryById.mockResolvedValue(null);
    const res = await request(app)
      .patch('/api/admin/log-center/status')
      .send({ source: 'system_events', logId: 999999, status: 'investigating' });
    expect(res.status).toBe(404);
  });

  it('全ての有効なステータス値を受け付ける', async () => {
    const app = await createApp();
    for (const status of ['new', 'investigating', 'resolved', 'false_positive']) {
      mocks.updateLogIssueState.mockResolvedValue({ status, note: null, updatedAt: null, updatedBy: null });
      const res = await request(app)
        .patch('/api/admin/log-center/status')
        .send({ source: 'system_events', logId: 101, status });
      expect(res.status).toBe(200);
    }
  });

  it('actor の pharmacyId と email を updateLogIssueState に渡す', async () => {
    const app = await createApp({ id: 42, email: 'actor@example.com' });
    const res = await request(app)
      .patch('/api/admin/log-center/status')
      .send({ source: 'system_events', logId: 101, status: 'investigating' });
    expect(res.status).toBe(200);
    expect(mocks.updateLogIssueState).toHaveBeenCalledWith(
      expect.objectContaining({
        actorPharmacyId: 42,
        actorEmail: 'actor@example.com',
      }),
    );
  });

  it('サービスエラー時に 500 を返す', async () => {
    const app = await createApp();
    mocks.updateLogIssueState.mockRejectedValue(new Error('DB error'));
    const res = await request(app)
      .patch('/api/admin/log-center/status')
      .send({ source: 'system_events', logId: 101, status: 'investigating' });
    expect(res.status).toBe(500);
  });
});

// ── GET /status-history ───────────────────────────────────

describe('GET /api/admin/log-center/status-history', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const sampleHistory = [
    {
      id: 1,
      kind: 'status_update',
      source: 'system_events',
      logId: 101,
      status: 'investigating',
      note: 'テスト',
      reasonCodes: [],
      createdAt: '2026-03-01T10:00:00.000Z',
      actor: { pharmacyId: 1, pharmacyName: null, pharmacyEmail: 'admin@example.com' },
    },
  ];

  it('有効な source と logId でヒストリーを返す (200)', async () => {
    const app = await createApp();
    mocks.getLogIssueHistory.mockResolvedValue(sampleHistory);
    const res = await request(app)
      .get('/api/admin/log-center/status-history?source=system_events&logId=101');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({
      source: 'system_events',
      logId: 101,
      history: sampleHistory,
    }));
    expect(mocks.getLogIssueHistory).toHaveBeenCalledWith('system_events', 101);
  });

  it('source がない場合に 400 を返す', async () => {
    const app = await createApp();
    const res = await request(app)
      .get('/api/admin/log-center/status-history?logId=101');
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('source');
  });

  it('logId がない場合に 400 を返す', async () => {
    const app = await createApp();
    const res = await request(app)
      .get('/api/admin/log-center/status-history?source=system_events');
    expect(res.status).toBe(400);
  });

  it('不正な source で 400 を返す', async () => {
    const app = await createApp();
    const res = await request(app)
      .get('/api/admin/log-center/status-history?source=invalid_source&logId=101');
    expect(res.status).toBe(400);
  });

  it('空のヒストリーも正常に返す', async () => {
    const app = await createApp();
    mocks.getLogIssueHistory.mockResolvedValue([]);
    const res = await request(app)
      .get('/api/admin/log-center/status-history?source=system_events&logId=101');
    expect(res.status).toBe(200);
    expect(res.body.history).toEqual([]);
  });

  it('サービスエラー時に 500 を返す', async () => {
    const app = await createApp();
    mocks.getLogIssueHistory.mockRejectedValue(new Error('DB error'));
    const res = await request(app)
      .get('/api/admin/log-center/status-history?source=system_events&logId=101');
    expect(res.status).toBe(500);
  });
});
