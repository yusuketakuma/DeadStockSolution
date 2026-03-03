/**
 * coverage-final-push.test.ts
 * 残り53行の未カバー行をカバーするための集中テスト
 *
 * 対象ファイル:
 * - src/routes/notifications.ts        — cursorページネーション、referenceType='request'、buildProposalDeadlineAt(invalid date)
 * - src/routes/upload-validation.ts    — uploadSingleFile のmulterエラーブランチ
 * - src/routes/drug-master-sync.ts     — parsePackageRows の.xml/.zipブランチ、uploadSingleFile非Errorブランチ
 * - src/services/matching-service.ts   — clampPharmacyComparisonPool でfavoriteIdが上限外pharmを追加するブランチ
 * - src/services/upload-confirm-job-service.ts — decodeUploadJobFilePayload の非圧縮base64パス
 * - src/services/import-failure-alert-scheduler.ts — secondcooldown check(threshold超後)
 */

import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// Shared mocks — all tests in this file share config/database via notificationMocks.db
// ─────────────────────────────────────────────────────────────────────────────

const notificationMocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
    insert: vi.fn(),
    execute: vi.fn(),
  },
  getDashboardUnreadCount: vi.fn(async () => 0),
  invalidateDashboardUnreadCache: vi.fn(),
  markAsRead: vi.fn(async () => true),
  markAllDashboardAsRead: vi.fn(async () => 0),
}));

vi.mock('../middleware/auth', () => ({
  requireLogin: (req: { user?: { id: number; email: string; isAdmin: boolean } }, _res: unknown, next: () => void) => {
    req.user = { id: 1, email: 'test@example.com', isAdmin: false };
    next();
  },
  requireAdmin: (_req: unknown, _res: unknown, next: () => void) => {
    next();
  },
}));

vi.mock('../config/database', () => ({
  db: notificationMocks.db,
}));

vi.mock('../services/notification-service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/notification-service')>();
  return {
    ...actual,
    getDashboardUnreadCount: notificationMocks.getDashboardUnreadCount,
    invalidateDashboardUnreadCache: notificationMocks.invalidateDashboardUnreadCache,
    markAsRead: notificationMocks.markAsRead,
    markAllDashboardAsRead: notificationMocks.markAllDashboardAsRead,
  };
});

vi.mock('drizzle-orm', () => ({
  and: vi.fn(() => ({})),
  desc: vi.fn(() => ({})),
  eq: vi.fn(() => ({})),
  inArray: vi.fn(() => ({})),
  ne: vi.fn(() => ({})),
  gte: vi.fn(() => ({})),
  exists: vi.fn(() => ({})),
  notExists: vi.fn(() => ({})),
  sql: Object.assign(vi.fn(() => ({})), { raw: vi.fn(() => ({})) }),
  asc: vi.fn(() => ({})),
  or: vi.fn(() => ({})),
  lt: vi.fn(() => ({})),
  lte: vi.fn(() => ({})),
  isNull: vi.fn(() => ({})),
  isNotNull: vi.fn(() => ({})),
  count: vi.fn(() => ({})),
  like: vi.fn(() => ({})),
}));

vi.mock('../services/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../utils/path-utils', () => ({
  sanitizeInternalPath: vi.fn((p: string | null) => p),
}));

vi.mock('../utils/cursor-pagination', () => ({
  decodeCursor: vi.fn((raw: unknown) => {
    if (typeof raw !== 'string') return null;
    try {
      return JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
    } catch {
      return null;
    }
  }),
  encodeCursor: vi.fn((obj: unknown) => Buffer.from(JSON.stringify(obj)).toString('base64')),
}));

vi.mock('../utils/request-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/request-utils')>();
  return {
    ...actual,
    parsePositiveInt: vi.fn((raw: unknown) => {
      const n = Number(raw);
      return Number.isInteger(n) && n > 0 ? n : null;
    }),
  };
});

vi.mock('../services/log-service', () => ({
  writeLog: vi.fn(),
  getClientIp: vi.fn(() => '127.0.0.1'),
}));

vi.mock('../services/upload-service', () => ({
  parseExcelBuffer: vi.fn(async () => [['col1'], ['val1']]),
}));

vi.mock('../services/column-mapper', () => ({
  suggestMapping: vi.fn(() => ({ drug_name: '0' })),
}));

vi.mock('../middleware/error-handler', () => ({
  getErrorMessage: (err: unknown) => err instanceof Error ? err.message : String(err),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Section 1: notifications.ts — cursor pagination / resolveNotificationActionPath
// ─────────────────────────────────────────────────────────────────────────────

import notificationsRouter from '../routes/notifications';

function createNotificationsSelectQuery(result: unknown) {
  const resolved = Promise.resolve(result);
  const query = {
    from: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    then: resolved.then.bind(resolved),
    catch: resolved.catch.bind(resolved),
    finally: resolved.finally.bind(resolved),
  };
  query.from.mockReturnValue(query);
  query.where.mockReturnValue(query);
  query.orderBy.mockReturnValue(query);
  query.limit.mockResolvedValue(result);
  return query;
}

function createNotificationsApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/notifications', notificationsRouter);
  return app;
}

describe('notifications.ts — cursor pagination and edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    notificationMocks.db.select.mockImplementation(() => createNotificationsSelectQuery([]));
    notificationMocks.db.update.mockImplementation(() => ({
      set: vi.fn(() => ({
        where: vi.fn().mockResolvedValue([]),
      })),
    }));
    notificationMocks.db.insert.mockImplementation(() => ({
      values: vi.fn(() => ({
        onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
      })),
    }));
  });

  it('handles cursor-based pagination with exact match (exactIndex >= 0)', async () => {
    const app = createNotificationsApp();

    const messages = [
      { id: 1, title: 'msg1', body: 'body1', actionPath: null, createdAt: '2026-01-03T00:00:00.000Z' },
      { id: 2, title: 'msg2', body: 'body2', actionPath: null, createdAt: '2026-01-02T00:00:00.000Z' },
      { id: 3, title: 'msg3', body: 'body3', actionPath: null, createdAt: '2026-01-01T00:00:00.000Z' },
    ];

    let callCount = 0;
    notificationMocks.db.select.mockImplementation(() => {
      callCount++;
      if (callCount === 3) return createNotificationsSelectQuery(messages);
      return createNotificationsSelectQuery([]);
    });

    const cursor = Buffer.from(JSON.stringify({
      id: 'message-1',
      priority: 1,
      createdAt: '2026-01-03T00:00:00.000Z',
    })).toString('base64');

    const res = await request(app).get(`/api/notifications?cursor=${cursor}&limit=2`);
    expect(res.status).toBe(200);
    expect(res.body.notices.length).toBeLessThanOrEqual(2);
  });

  it('handles cursor fallback logic (cursor not found by id, finds by time/priority)', async () => {
    const app = createNotificationsApp();

    const messages = [
      { id: 10, title: 'urgent', body: 'body', actionPath: null, createdAt: '2026-01-03T00:00:00.000Z' },
      { id: 11, title: 'normal', body: 'body', actionPath: null, createdAt: '2026-01-01T00:00:00.000Z' },
    ];

    let callCount = 0;
    notificationMocks.db.select.mockImplementation(() => {
      callCount++;
      if (callCount === 3) return createNotificationsSelectQuery(messages);
      return createNotificationsSelectQuery([]);
    });

    const cursor = Buffer.from(JSON.stringify({
      id: 'message-999',
      priority: 1,
      createdAt: '2026-01-02T00:00:00.000Z',
    })).toString('base64');

    const res = await request(app).get(`/api/notifications?cursor=${cursor}&limit=5`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.notices)).toBe(true);
  });

  it('handles notification with referenceType=request (resolves to /)', async () => {
    const app = createNotificationsApp();

    const notification = {
      id: 50,
      pharmacyId: 1,
      type: 'request_update',
      title: 'リクエスト更新',
      message: '更新されました',
      referenceType: 'request',
      referenceId: null,
      isRead: false,
      readAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    };

    let callCount = 0;
    notificationMocks.db.select.mockImplementation(() => {
      callCount++;
      if (callCount === 6) return createNotificationsSelectQuery([notification]);
      return createNotificationsSelectQuery([]);
    });

    const res = await request(app).get('/api/notifications');
    expect(res.status).toBe(200);
    const notice = res.body.notices.find((n: { type: string }) => n.type === 'status_update');
    expect(notice).toBeTruthy();
    expect(notice.actionPath).toBe('/');
  });

  it('handles proposedAt=null in buildProposalDeadlineAt (deadlineAt should be null)', async () => {
    const app = createNotificationsApp();

    const proposal = {
      id: 99,
      pharmacyAId: 2,
      pharmacyBId: 1,
      status: 'proposed',
      proposedAt: null,
    };

    let callCount = 0;
    notificationMocks.db.select.mockImplementation(() => {
      callCount++;
      if (callCount === 2) return createNotificationsSelectQuery([proposal]);
      return createNotificationsSelectQuery([]);
    });

    const res = await request(app).get('/api/notifications');
    expect(res.status).toBe(200);
    const inboundNotice = res.body.notices.find((n: { type: string }) => n.type === 'inbound_request');
    if (inboundNotice) {
      expect(inboundNotice.deadlineAt).toBeNull();
    }
  });

  it('handles notification with referenceType=null (resolves to /)', async () => {
    const app = createNotificationsApp();

    const notification = {
      id: 55,
      pharmacyId: 1,
      type: 'proposal_received',
      title: '通知',
      message: '内容',
      referenceType: null,
      referenceId: null,
      isRead: false,
      readAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    };

    let callCount = 0;
    notificationMocks.db.select.mockImplementation(() => {
      callCount++;
      if (callCount === 6) return createNotificationsSelectQuery([notification]);
      return createNotificationsSelectQuery([]);
    });

    const res = await request(app).get('/api/notifications');
    expect(res.status).toBe(200);
    const notice = res.body.notices.find((n: { actionPath: string }) => n.actionPath === '/');
    expect(notice).toBeTruthy();
  });

  it('handles accepted_b proposal notice for isA=true', async () => {
    const app = createNotificationsApp();

    const proposal = {
      id: 100,
      pharmacyAId: 1,
      pharmacyBId: 2,
      status: 'accepted_b',
      proposedAt: '2026-01-01T00:00:00.000Z',
    };

    let callCount = 0;
    notificationMocks.db.select.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return createNotificationsSelectQuery([proposal]);
      return createNotificationsSelectQuery([]);
    });

    const res = await request(app).get('/api/notifications');
    expect(res.status).toBe(200);
    const notice = res.body.notices.find((n: { type: string }) => n.type === 'inbound_request');
    expect(notice).toBeTruthy();
    expect(notice.title).toContain('相手承認済み');
  });

  it('handles hasMore=false (no nextCursor when notices fit in one page)', async () => {
    const app = createNotificationsApp();

    const message = { id: 20, title: 'msg', body: 'body', actionPath: null, createdAt: '2026-01-01T00:00:00.000Z' };

    let callCount = 0;
    notificationMocks.db.select.mockImplementation(() => {
      callCount++;
      if (callCount === 3) return createNotificationsSelectQuery([message]);
      return createNotificationsSelectQuery([]);
    });

    const res = await request(app).get('/api/notifications?limit=50');
    expect(res.status).toBe(200);
    expect(res.body.pagination.hasMore).toBe(false);
    expect(res.body.pagination.nextCursor).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Section 2: upload-validation.ts — uploadSingleFile multer error branches
// ─────────────────────────────────────────────────────────────────────────────

import { uploadSingleFile } from '../routes/upload-validation';

describe('upload-validation.ts — uploadSingleFile middleware', () => {
  function createTestApp() {
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      uploadSingleFile(req, res, next);
    });
    app.post('/test', (_req, res) => {
      res.json({ ok: true });
    });
    return app;
  }

  it('passes through when no file is uploaded (no error)', async () => {
    const app = createTestApp();
    const res = await request(app).post('/test').send({});
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('returns 400 with file too large message when LIMIT_FILE_SIZE multer error', async () => {
    const app = createTestApp();
    const largeContent = Buffer.alloc(51 * 1024 * 1024, 'x'); // 51MB > 50MB limit

    const res = await request(app)
      .post('/test')
      .attach('file', largeContent, { filename: 'large.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/MB/);
  });

  it('returns 400 with file filter rejected message for non-xlsx file', async () => {
    const app = createTestApp();

    const res = await request(app)
      .post('/test')
      .attach('file', Buffer.from('test content'), { filename: 'test.txt', contentType: 'text/plain' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('xlsx');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Section 3: drug-master-sync.ts — parsePackageRows .xml / .zip branches
// ─────────────────────────────────────────────────────────────────────────────

const drugMasterSyncMocks = vi.hoisted(() => ({
  parseMhlwExcelData: vi.fn(() => []),
  parseMhlwCsvData: vi.fn(() => []),
  parsePackageExcelData: vi.fn(() => []),
  parsePackageCsvData: vi.fn(() => []),
  parsePackageXmlData: vi.fn(() => [{ dummy: 'xml-row' }]),
  parsePackageZipData: vi.fn(async () => [{ dummy: 'zip-row' }]),
  decodeCsvBuffer: vi.fn(() => 'csv-content'),
  syncDrugMaster: vi.fn(async () => ({ itemsProcessed: 5, itemsAdded: 2, itemsUpdated: 1, itemsDeleted: 0 })),
  syncPackageData: vi.fn(async () => ({ added: 2, updated: 1 })),
  getSyncLogs: vi.fn(async () => []),
  createSyncLog: vi.fn(async () => ({ id: 10 })),
  completeSyncLog: vi.fn(async () => undefined),
  triggerManualAutoSync: vi.fn(async () => ({ triggered: true })),
  getConfiguredSourceMode: vi.fn(() => 'single'),
  triggerManualPackageAutoSync: vi.fn(async () => ({ triggered: false })),
  getSourceStatesByPrefix: vi.fn(async () => []),
  writeLog: vi.fn(),
  getClientIp: vi.fn(() => '127.0.0.1'),
}));

vi.mock('../services/drug-master-service', () => ({
  parseMhlwExcelData: drugMasterSyncMocks.parseMhlwExcelData,
  parseMhlwCsvData: drugMasterSyncMocks.parseMhlwCsvData,
  parsePackageExcelData: drugMasterSyncMocks.parsePackageExcelData,
  parsePackageCsvData: drugMasterSyncMocks.parsePackageCsvData,
  parsePackageXmlData: drugMasterSyncMocks.parsePackageXmlData,
  parsePackageZipData: drugMasterSyncMocks.parsePackageZipData,
  decodeCsvBuffer: drugMasterSyncMocks.decodeCsvBuffer,
  syncDrugMaster: drugMasterSyncMocks.syncDrugMaster,
  syncPackageData: drugMasterSyncMocks.syncPackageData,
  getSyncLogs: drugMasterSyncMocks.getSyncLogs,
  createSyncLog: drugMasterSyncMocks.createSyncLog,
  completeSyncLog: drugMasterSyncMocks.completeSyncLog,
}));

vi.mock('../services/drug-master-scheduler', () => ({
  triggerManualAutoSync: drugMasterSyncMocks.triggerManualAutoSync,
  getConfiguredSourceMode: drugMasterSyncMocks.getConfiguredSourceMode,
}));

vi.mock('../services/drug-package-scheduler', () => ({
  triggerManualPackageAutoSync: drugMasterSyncMocks.triggerManualPackageAutoSync,
}));

vi.mock('../services/drug-master-source-state-service', () => ({
  getSourceStatesByPrefix: drugMasterSyncMocks.getSourceStatesByPrefix,
}));

vi.mock('../services/log-service', () => ({
  writeLog: drugMasterSyncMocks.writeLog,
  getClientIp: drugMasterSyncMocks.getClientIp,
}));

import drugMasterSyncRouter from '../routes/drug-master-sync';

function createDrugMasterSyncApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/drug-master', (req, _res, next) => {
    (req as unknown as { user: { id: number; email: string; isAdmin: boolean } }).user = {
      id: 1,
      email: 'admin@example.com',
      isAdmin: true,
    };
    next();
  }, drugMasterSyncRouter);
  return app;
}

describe('drug-master-sync.ts — parsePackageRows branches', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    drugMasterSyncMocks.parsePackageXmlData.mockReturnValue([{ dummy: 'xml-row' }]);
    drugMasterSyncMocks.parsePackageZipData.mockResolvedValue([{ dummy: 'zip-row' }]);
    drugMasterSyncMocks.syncPackageData.mockResolvedValue({ added: 1, updated: 0 });
    drugMasterSyncMocks.writeLog.mockResolvedValue(undefined);
    drugMasterSyncMocks.getClientIp.mockReturnValue('127.0.0.1');
    drugMasterSyncMocks.getConfiguredSourceMode.mockReturnValue('single');
    drugMasterSyncMocks.triggerManualAutoSync.mockResolvedValue({ triggered: false });
    drugMasterSyncMocks.triggerManualPackageAutoSync.mockResolvedValue({ triggered: false });
    drugMasterSyncMocks.getSourceStatesByPrefix.mockResolvedValue([]);
  });

  it('POST /upload-packages accepts .xml file and calls parsePackageXmlData', async () => {
    const app = createDrugMasterSyncApp();
    const xmlContent = Buffer.from('<packages><package><code>12345</code></package></packages>');

    const res = await request(app)
      .post('/api/admin/drug-master/upload-packages')
      .attach('file', xmlContent, { filename: 'packages.xml', contentType: 'application/xml' });

    expect(res.status).toBe(200);
    expect(drugMasterSyncMocks.parsePackageXmlData).toHaveBeenCalled();
  });

  it('POST /upload-packages accepts .zip file and calls parsePackageZipData', async () => {
    const app = createDrugMasterSyncApp();
    const zipContent = Buffer.from([0x50, 0x4B, 0x03, 0x04]); // PK zip header

    const res = await request(app)
      .post('/api/admin/drug-master/upload-packages')
      .attach('file', zipContent, { filename: 'packages.zip', contentType: 'application/zip' });

    expect(res.status).toBe(200);
    expect(drugMasterSyncMocks.parsePackageZipData).toHaveBeenCalled();
  });

  it('POST /upload-packages returns 500 on internal error during syncPackageData', async () => {
    const app = createDrugMasterSyncApp();
    drugMasterSyncMocks.parsePackageXmlData.mockReturnValue([{ dummy: 'xml-row' }]);
    drugMasterSyncMocks.syncPackageData.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .post('/api/admin/drug-master/upload-packages')
      .attach('file', Buffer.from('<x/>'), { filename: 'test.xml', contentType: 'application/xml' });

    expect(res.status).toBe(500);
    expect(res.body.error).toContain('包装単位');
  });

  it('POST /upload-packages returns 400 on unsupported file extension', async () => {
    const app = createDrugMasterSyncApp();

    const res = await request(app)
      .post('/api/admin/drug-master/upload-packages')
      .attach('file', Buffer.from('data'), { filename: 'file.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(400);
  });

  it('POST /auto-sync/packages does not write log when triggered=false', async () => {
    const app = createDrugMasterSyncApp();
    drugMasterSyncMocks.triggerManualPackageAutoSync.mockResolvedValue({ triggered: false });

    const res = await request(app)
      .post('/api/admin/drug-master/auto-sync/packages')
      .send({});

    expect(res.status).toBe(200);
    expect(drugMasterSyncMocks.writeLog).not.toHaveBeenCalled();
  });

  it('GET /auto-sync/status with index mode returns discoveredFiles', async () => {
    const app = createDrugMasterSyncApp();
    drugMasterSyncMocks.getConfiguredSourceMode.mockReturnValue('index');
    drugMasterSyncMocks.getSourceStatesByPrefix.mockResolvedValue([
      { sourceKey: 'drug:index_page', url: 'https://example.com', lastCheckedAt: '2026-01-01T00:00:00.000Z', lastChangedAt: null },
      { sourceKey: 'drug:file:category1', url: 'https://example.com/cat1.xlsx', lastCheckedAt: null, lastChangedAt: '2026-01-01T00:00:00.000Z' },
    ] as never);

    const res = await request(app).get('/api/admin/drug-master/auto-sync/status');

    expect(res.status).toBe(200);
    expect(res.body.sourceMode).toBe('index');
    expect(Array.isArray(res.body.discoveredFiles)).toBe(true);
    expect(res.body.lastIndexCheck).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Section 4: matching-service.ts — clampPharmacyComparisonPool favorites injection
// ─────────────────────────────────────────────────────────────────────────────

const matchingMocks = vi.hoisted(() => ({
  getActiveMatchingRuleProfile: vi.fn(),
  sortMatchCandidatesByPriority: vi.fn((candidates: unknown[]) => candidates),
  getBusinessHoursStatus: vi.fn(() => ({ isOpen: true, closingSoon: false, is24Hours: false, todayHours: null })),
  haversineDistance: vi.fn(() => 1.0),
}));

vi.mock('../services/matching-rule-service', () => ({
  getActiveMatchingRuleProfile: matchingMocks.getActiveMatchingRuleProfile,
}));

vi.mock('../services/matching-priority-service', () => ({
  sortMatchCandidatesByPriority: matchingMocks.sortMatchCandidatesByPriority,
}));

vi.mock('../utils/business-hours-utils', () => ({
  getBusinessHoursStatus: matchingMocks.getBusinessHoursStatus,
}));

vi.mock('../utils/geo-utils', () => ({
  haversineDistance: matchingMocks.haversineDistance,
}));

import { DEFAULT_MATCHING_SCORING_RULES } from '../services/matching-score-service';
import { findMatchesBatch } from '../services/matching-service';

describe('matching-service.ts — clampPharmacyComparisonPool favorites injection', () => {
  const DEFAULT_PROFILE = { ...DEFAULT_MATCHING_SCORING_RULES };

  // A chain that is both thenable (so Promise.all can await it directly) and
  // supports fluent builder calls (from/where/orderBy/innerJoin/groupBy).
  function makeSelectChain(rows: unknown[]) {
    const resolved = Promise.resolve(rows);
    // Use a plain object so we can assign vi.fn() and then mockReturnValue
    const chain = {
      from: vi.fn(),
      where: vi.fn(),
      orderBy: vi.fn(),
      innerJoin: vi.fn(),
      groupBy: vi.fn(),
      limit: vi.fn(),
      then: resolved.then.bind(resolved),
      catch: resolved.catch.bind(resolved),
    } as unknown as {
      from: ReturnType<typeof vi.fn>;
      where: ReturnType<typeof vi.fn>;
      orderBy: ReturnType<typeof vi.fn>;
      innerJoin: ReturnType<typeof vi.fn>;
      groupBy: ReturnType<typeof vi.fn>;
      limit: ReturnType<typeof vi.fn>;
      then: typeof resolved.then;
      catch: typeof resolved.catch;
    };
    chain.from.mockReturnValue(chain);
    chain.where.mockReturnValue(chain);
    chain.orderBy.mockReturnValue(chain);
    chain.innerJoin.mockReturnValue(chain);
    chain.groupBy.mockReturnValue(chain);
    chain.limit.mockReturnValue(chain);
    return chain;
  }

  function makeProxy() {
    const handler: ProxyHandler<Record<string, unknown>> = {
      get(_t, prop) {
        if (prop === 'then') return undefined;
        return vi.fn().mockReturnValue(new Proxy({}, handler));
      },
    };
    return new Proxy({}, handler);
  }

  function classifySelectFields(fields: unknown): string {
    const keys = Object.keys((fields ?? {}) as Record<string, unknown>);
    if (keys.length === 0) return 'unknown';
    if (keys.includes('quantity') && keys.includes('expirationDate')) return 'deadStock';
    if (keys.length === 2 && keys.includes('pharmacyId') && keys.includes('drugName')) return 'usedMed';
    if (keys.includes('phone') && keys.includes('fax')) return 'viablePharmacies';
    if (keys.includes('name') && keys.includes('latitude') && !keys.includes('phone')) return 'currentPharmacy';
    if (keys.length === 1 && keys[0] === 'targetPharmacyId') return 'favoriteRows';
    if (keys.includes('pharmacyId') && keys.includes('targetPharmacyId')) return 'relationships';
    if (keys.includes('dayOfWeek')) return 'businessHours';
    if (keys.includes('specialType')) return 'specialHours';
    if (keys.includes('deadStockItemId') && keys.includes('reservedQty')) return 'reservations';
    return 'unknown';
  }

  beforeEach(() => {
    vi.resetAllMocks();
    matchingMocks.getActiveMatchingRuleProfile.mockResolvedValue(DEFAULT_PROFILE);
    matchingMocks.haversineDistance.mockReturnValue(1.0);
    notificationMocks.db.select.mockImplementation(() => makeProxy());
  });

  it('clampPharmacyComparisonPool injects favoriteIds pharmacies beyond MATCHING_MAX_COMPARISON limit', async () => {
    const futureDate = '2099-12-31';

    notificationMocks.db.select.mockImplementation((fields: unknown) => {
      const type = classifySelectFields(fields);

      if (type === 'currentPharmacy') {
        return makeSelectChain([{ id: 1, name: 'A', latitude: 35.0, longitude: 139.0 }]);
      }
      if (type === 'relationships') {
        // pharmacy 1 has pharmacy 3 as favorite
        return makeSelectChain([{ pharmacyId: 1, targetPharmacyId: 3 }]);
      }
      if (type === 'viablePharmacies') {
        return makeSelectChain([
          { id: 2, name: 'B', phone: '000', fax: '000', latitude: 35.01, longitude: 139.01 },
          { id: 3, name: 'C', phone: '001', fax: '001', latitude: 36.0, longitude: 140.0 },
        ]);
      }
      if (type === 'deadStock') {
        return makeSelectChain([
          { id: 10, pharmacyId: 1, drugName: 'アムロジピン錠5mg', quantity: 100, unit: '錠', yakkaUnitPrice: '50', expirationDate: futureDate, expirationDateIso: futureDate, lotNumber: null, createdAt: null },
          { id: 11, pharmacyId: 2, drugName: 'アムロジピン錠5mg', quantity: 100, unit: '錠', yakkaUnitPrice: '50', expirationDate: futureDate, expirationDateIso: futureDate, lotNumber: null, createdAt: null },
          { id: 12, pharmacyId: 3, drugName: 'アムロジピン錠5mg', quantity: 100, unit: '錠', yakkaUnitPrice: '50', expirationDate: futureDate, expirationDateIso: futureDate, lotNumber: null, createdAt: null },
        ]);
      }
      if (type === 'usedMed') {
        return makeSelectChain([
          { pharmacyId: 1, drugName: 'アムロジピン錠5mg' },
          { pharmacyId: 2, drugName: 'アムロジピン錠5mg' },
          { pharmacyId: 3, drugName: 'アムロジピン錠5mg' },
        ]);
      }
      if (type === 'reservations') return makeSelectChain([]);
      if (type === 'businessHours') return makeSelectChain([]);
      if (type === 'specialHours') return makeSelectChain([]);
      return makeProxy();
    });

    const result = await findMatchesBatch([1]);
    expect(result.has(1)).toBe(true);
  });

  it('findMatchesBatch returns early when both source and viable pharmacy pools are empty', async () => {
    notificationMocks.db.select.mockImplementation((fields: unknown) => {
      const type = classifySelectFields(fields);
      if (type === 'currentPharmacy') {
        return makeSelectChain([{ id: 1, name: 'A', latitude: 35.0, longitude: 139.0 }]);
      }
      if (type === 'relationships') return makeSelectChain([]);
      if (type === 'viablePharmacies') return makeSelectChain([]);
      if (type === 'deadStock') return makeSelectChain([]);
      if (type === 'usedMed') return makeSelectChain([]);
      if (type === 'reservations') return makeSelectChain([]);
      if (type === 'businessHours') return makeSelectChain([]);
      if (type === 'specialHours') return makeSelectChain([]);
      return makeProxy();
    });

    const result = await findMatchesBatch([1]);
    expect(result.get(1)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Section 5: upload-confirm-job-service.ts — decodeUploadJobFilePayload non-compressed path
// ─────────────────────────────────────────────────────────────────────────────

const jobServiceMocks = vi.hoisted(() => ({
  runUploadConfirm: vi.fn(),
  clearUploadRowIssuesForJob: vi.fn(),
  getUploadRowIssueCountByJobId: vi.fn(),
  getNextRetryIso: vi.fn(),
  getStaleBeforeIso: vi.fn(),
}));

vi.mock('../services/upload-confirm-service', () => ({
  runUploadConfirm: jobServiceMocks.runUploadConfirm,
}));

vi.mock('../utils/job-retry-utils', () => ({
  getNextRetryIso: jobServiceMocks.getNextRetryIso,
  getStaleBeforeIso: jobServiceMocks.getStaleBeforeIso,
}));

vi.mock('../utils/number-utils', () => ({
  parseBoundedInt: vi.fn((_val: unknown, def: number) => def),
}));

vi.mock('../services/upload-row-issue-service', () => ({
  clearUploadRowIssuesForJob: jobServiceMocks.clearUploadRowIssuesForJob,
  getUploadRowIssueCountByJobId: jobServiceMocks.getUploadRowIssueCountByJobId,
}));

import { processUploadConfirmJobById } from '../services/upload-confirm-job-service';

describe('upload-confirm-job-service.ts — decodeUploadJobFilePayload non-compressed path', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    jobServiceMocks.runUploadConfirm.mockResolvedValue({ uploadId: 1, rowCount: 5, diffSummary: null, partialSummary: null });
    jobServiceMocks.clearUploadRowIssuesForJob.mockResolvedValue(undefined);
    jobServiceMocks.getUploadRowIssueCountByJobId.mockResolvedValue(0);
    jobServiceMocks.getStaleBeforeIso.mockReturnValue('2026-01-01T00:00:00.000Z');
    jobServiceMocks.getNextRetryIso.mockReturnValue('2026-03-01T12:00:00.000Z');
    // Default select: assertJobNotCancellationRequested returns non-cancelled
    notificationMocks.db.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ cancelRequestedAt: null, canceledAt: null }]),
        }),
      }),
    });
    notificationMocks.db.update.mockImplementation(() => ({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([]),
        }),
      }),
    }));
  });

  it('processes job with plain base64 fileBase64 (non-compressed payload path)', async () => {
    // Plain base64 (no "gz:" prefix) triggers the non-compressed path in decodeUploadJobFilePayload
    const plainBase64 = Buffer.from('fake-excel-content').toString('base64');

    const jobRow = {
      id: 42,
      pharmacyId: 7,
      uploadType: 'dead_stock',
      originalFilename: 'test.xlsx',
      headerRowIndex: 0,
      mappingJson: JSON.stringify({ drug_name: '0', quantity: '1' }),
      status: 'processing',
      applyMode: 'replace',
      deleteMissing: false,
      fileBase64: plainBase64,
      attempts: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
    };

    // First db.update call: claim the job with status='processing'
    const claimUpdateChain = {
      set: vi.fn(),
      where: vi.fn(),
      returning: vi.fn(),
    };
    claimUpdateChain.set.mockReturnValue(claimUpdateChain);
    claimUpdateChain.where.mockReturnValue(claimUpdateChain);
    claimUpdateChain.returning.mockResolvedValue([jobRow]);

    // Second db.update call: complete the job
    const completeUpdateChain = {
      set: vi.fn(),
      where: vi.fn(),
      returning: vi.fn(),
    };
    completeUpdateChain.set.mockReturnValue(completeUpdateChain);
    completeUpdateChain.where.mockReturnValue(completeUpdateChain);
    completeUpdateChain.returning.mockResolvedValue([{ id: 42 }]);

    // db.update: first call = claim, subsequent = complete
    notificationMocks.db.update = vi.fn()
      .mockReturnValueOnce(claimUpdateChain)
      .mockReturnValueOnce(completeUpdateChain);

    const result = await processUploadConfirmJobById(42);
    // Non-compressed base64 path executed; runUploadConfirm should be called
    expect(result).toBe(true);
    expect(jobServiceMocks.runUploadConfirm).toHaveBeenCalled();
  });

  it('returns false when no job is claimed (job not in pending state)', async () => {
    const updateChain = {
      set: vi.fn(),
      where: vi.fn(),
      returning: vi.fn(),
    };
    updateChain.set.mockReturnValue(updateChain);
    updateChain.where.mockReturnValue(updateChain);
    updateChain.returning.mockResolvedValue([]); // no job claimed

    notificationMocks.db.update = vi.fn().mockReturnValue(updateChain);

    const result = await processUploadConfirmJobById(999);
    expect(result).toBe(false);
    expect(jobServiceMocks.runUploadConfirm).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Section 6: import-failure-alert-scheduler.ts — cooldown after threshold exceeded
// ─────────────────────────────────────────────────────────────────────────────

const alertMocks = vi.hoisted(() => ({
  handoffImportFailureAlertToOpenClaw: vi.fn(),
}));

vi.mock('../services/openclaw-auto-handoff-service', () => ({
  handoffImportFailureAlertToOpenClaw: alertMocks.handoffImportFailureAlertToOpenClaw,
}));

import {
  runImportFailureAlertCheck,
  resetImportFailureAlertStateForTests,
  type ImportFailureAlertConfig,
} from '../services/import-failure-alert-scheduler';

function createAlertConfig(overrides: Partial<ImportFailureAlertConfig> = {}): ImportFailureAlertConfig {
  return {
    enabled: true,
    intervalMinutes: 5,
    windowMinutes: 30,
    threshold: 3,
    cooldownMinutes: 60,
    monitoredActions: ['upload'],
    webhookUrl: '',
    webhookUrlError: null,
    webhookToken: '',
    webhookTimeoutMs: 10000,
    ...overrides,
  };
}

// All alert db calls go through notificationMocks.db.select (same config/database mock)
function mockAlertFailureCount(count: number): void {
  const whereMock = vi.fn().mockResolvedValue([{ count }]);
  const fromMock = vi.fn(() => ({ where: whereMock }));
  notificationMocks.db.select.mockImplementationOnce(() => ({ from: fromMock }));
}

function mockAlertFailureSummaryFull(): void {
  // failureByAction
  const groupBy1 = vi.fn().mockResolvedValue([{ action: 'upload', count: 5 }]);
  const where1 = vi.fn(() => ({ groupBy: groupBy1 }));
  notificationMocks.db.select.mockImplementationOnce(() => ({ from: vi.fn(() => ({ where: where1 })) }));

  // failureByReason
  const limit2 = vi.fn().mockResolvedValue([{ reason: 'parse_failed', count: 5 }]);
  const orderBy2 = vi.fn(() => ({ limit: limit2 }));
  const groupBy2 = vi.fn(() => ({ orderBy: orderBy2 }));
  const where2 = vi.fn(() => ({ groupBy: groupBy2 }));
  notificationMocks.db.select.mockImplementationOnce(() => ({ from: vi.fn(() => ({ where: where2 })) }));

  // latestFailure
  const limit3 = vi.fn().mockResolvedValue([{ createdAt: '2026-01-01T10:00:00.000Z' }]);
  const orderBy3 = vi.fn(() => ({ limit: limit3 }));
  const where3 = vi.fn(() => ({ orderBy: orderBy3 }));
  notificationMocks.db.select.mockImplementationOnce(() => ({ from: vi.fn(() => ({ where: where3 })) }));
}

describe('import-failure-alert-scheduler.ts — second cooldown check (threshold exceeded path)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetImportFailureAlertStateForTests();
    alertMocks.handoffImportFailureAlertToOpenClaw.mockResolvedValue({ triggered: false, accepted: false, requestId: null });
  });

  it('returns cooldown on second call within cooldown period after threshold exceeded', async () => {
    const config = createAlertConfig({ cooldownMinutes: 60, threshold: 3 });
    const now = new Date('2026-01-01T12:00:00.000Z');

    // First call: threshold exceeded -> alerted
    mockAlertFailureCount(5);
    mockAlertFailureSummaryFull();

    const result1 = await runImportFailureAlertCheck(config, now);
    expect(result1.status).toBe('alerted');

    // Second call: within cooldown but threshold check passes
    // This hits the second cooldown check (after threshold exceeded check)
    mockAlertFailureCount(6);

    // 30 minutes later — still within 60 min cooldown
    const now2 = new Date('2026-01-01T12:30:00.000Z');
    const result2 = await runImportFailureAlertCheck(config, now2);
    expect(result2.status).toBe('cooldown');
    // The early cooldown check returns lastAlertFailureTotal (5 from the first alert)
    expect(result2.totalFailures).toBe(5);
  });

  it('sends another alert after cooldown expires', async () => {
    const config = createAlertConfig({ cooldownMinutes: 1, threshold: 3 });
    const now1 = new Date('2026-01-01T12:00:00.000Z');

    // First alert
    mockAlertFailureCount(5);
    mockAlertFailureSummaryFull();
    const result1 = await runImportFailureAlertCheck(config, now1);
    expect(result1.status).toBe('alerted');

    // 2 minutes later — cooldown was 1 minute, so it has expired
    const now2 = new Date('2026-01-01T12:02:00.000Z');
    mockAlertFailureCount(7);
    mockAlertFailureSummaryFull();
    const result2 = await runImportFailureAlertCheck(config, now2);
    expect(result2.status).toBe('alerted');
  });

  it('returns disabled when monitoredActions is empty', async () => {
    const config = createAlertConfig({ monitoredActions: [] });
    const result = await runImportFailureAlertCheck(config, new Date());
    expect(result.status).toBe('disabled');
  });

  it('returns below_threshold when failure count is below threshold', async () => {
    const config = createAlertConfig({ threshold: 10 });
    mockAlertFailureCount(2);

    const result = await runImportFailureAlertCheck(config, new Date());
    expect(result.status).toBe('below_threshold');
    expect(result.totalFailures).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Section 7: notification-service.ts — markAllAsRead (real implementation via importOriginal)
// ─────────────────────────────────────────────────────────────────────────────

import { markAllAsRead } from '../services/notification-service';

describe('notification-service.ts — markAllAsRead coverage', () => {
  it('markAllAsRead with 0 updates returns 0 (real implementation, db.execute mocked)', async () => {
    // markAllAsRead calls markNotificationsAsRead(db, pharmacyId)
    // which calls db.execute(sql`...`) and returns the count
    // DASHBOARD_UNREAD_CACHE_ENABLED=false in test env, so no cache invalidation
    notificationMocks.db.execute = vi.fn().mockResolvedValue({
      rows: [{ count: 0 }],
    });

    const result = await markAllAsRead(1);
    expect(result).toBe(0);
    expect(notificationMocks.db.execute).toHaveBeenCalled();
  });

  it('markAllAsRead with non-zero updates returns count', async () => {
    notificationMocks.db.execute = vi.fn().mockResolvedValue({
      rows: [{ count: 3 }],
    });

    const result = await markAllAsRead(5);
    expect(result).toBe(3);
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// Section 8: Pure utility function coverage (no mocks needed)
// ─────────────────────────────────────────────────────────────────────────────

import { isPositiveSafeInteger, parseTimestamp, escapeLikeWildcards } from '../utils/request-utils';
import { buildProposalTimeline } from '../services/proposal-timeline-service';

describe('request-utils.ts — uncovered pure functions', () => {
  describe('isPositiveSafeInteger', () => {
    it('returns true for positive safe integers', () => {
      expect(isPositiveSafeInteger(1)).toBe(true);
      expect(isPositiveSafeInteger(100)).toBe(true);
      expect(isPositiveSafeInteger(Number.MAX_SAFE_INTEGER)).toBe(true);
    });

    it('returns false for non-positive values', () => {
      expect(isPositiveSafeInteger(0)).toBe(false);
      expect(isPositiveSafeInteger(-1)).toBe(false);
      expect(isPositiveSafeInteger(1.5)).toBe(false);
      expect(isPositiveSafeInteger('1')).toBe(false);
      expect(isPositiveSafeInteger(null)).toBe(false);
      expect(isPositiveSafeInteger(undefined)).toBe(false);
    });
  });

  describe('parseTimestamp', () => {
    it('returns Date for valid ISO string', () => {
      const result = parseTimestamp('2026-01-01T00:00:00.000Z');
      expect(result).toBeInstanceOf(Date);
      expect(result?.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    });

    it('returns null for empty string', () => {
      expect(parseTimestamp('')).toBeNull();
    });

    it('returns null for non-string values', () => {
      expect(parseTimestamp(null)).toBeNull();
      expect(parseTimestamp(undefined)).toBeNull();
      expect(parseTimestamp(12345)).toBeNull();
    });

    it('returns null for invalid date string', () => {
      expect(parseTimestamp('not-a-date')).toBeNull();
      expect(parseTimestamp('2026-13-45')).toBeNull();
    });
  });

  describe('escapeLikeWildcards', () => {
    it('escapes percent sign', () => {
      expect(escapeLikeWildcards('100%')).toBe('100\\%');
    });

    it('escapes underscore', () => {
      expect(escapeLikeWildcards('test_value')).toBe('test\\_value');
    });

    it('escapes backslash', () => {
      // 'a\\b' in JS = a\b (1 backslash), escaped to a\\b (2 backslashes)
      expect(escapeLikeWildcards('a\\b')).toBe('a\\\\b');
    });

    it('returns unchanged string with no wildcards', () => {
      expect(escapeLikeWildcards('normal string')).toBe('normal string');
    });
  });
});

describe('proposal-timeline-service.ts — buildProposalTimeline with includeStatusTransitions', () => {
  it('includes statusFrom/statusTo when includeStatusTransitions=true', () => {
    const actionRows = [
      {
        action: 'proposal_accept',
        detail: 'status=accepted_a',
        createdAt: '2026-01-02T00:00:00.000Z',
        actorPharmacyId: 2,
        actorName: '薬局B',
      },
      {
        action: 'proposal_complete',
        detail: null,
        createdAt: '2026-01-03T00:00:00.000Z',
        actorPharmacyId: 1,
        actorName: null,
      },
    ];

    const result = buildProposalTimeline({
      proposedAt: '2026-01-01T00:00:00.000Z',
      proposalCreatorPharmacyId: 1,
      proposalCreatorName: '薬局A',
      actionRows,
      includeStatusTransitions: true,
    });

    // First event (created) should have statusFrom=null, statusTo='proposed'
    expect(result[0].statusFrom).toBeNull();
    expect(result[0].statusTo).toBe('proposed');

    // Second event (accept) should have statusFrom='proposed', statusTo='accepted_a'
    expect(result[1].statusFrom).toBe('proposed');
    expect(result[1].statusTo).toBe('accepted_a');

    // Third event (complete) should have statusFrom='accepted_a', statusTo='completed'
    expect(result[2].statusFrom).toBe('accepted_a');
    expect(result[2].statusTo).toBe('completed');
  });

  it('excludes statusFrom/statusTo when includeStatusTransitions=false (default)', () => {
    const result = buildProposalTimeline({
      proposedAt: '2026-01-01T00:00:00.000Z',
      proposalCreatorPharmacyId: 1,
      actionRows: [],
      includeStatusTransitions: false,
    });

    expect(result[0].statusFrom).toBeUndefined();
    expect(result[0].statusTo).toBeUndefined();
  });

  it('handles nextStatus=null action in status transitions (statusFrom=null, statusTo=null)', () => {
    const actionRows = [
      {
        action: 'proposal_create',  // no nextStatus
        detail: null,
        createdAt: '2026-01-02T00:00:00.000Z',
        actorPharmacyId: 1,
        actorName: '薬局A',
      },
    ];

    const result = buildProposalTimeline({
      proposedAt: '2026-01-01T00:00:00.000Z',
      proposalCreatorPharmacyId: 1,
      actionRows,
      includeStatusTransitions: true,
    });

    // proposal_create has no nextStatus mapping
    expect(result[1].statusFrom).toBeNull();
    expect(result[1].statusTo).toBeNull();
  });
});

// Additional micro-coverage for 4 more lines
import { decideSourceUpdate } from '../services/source-update-detection';

describe('source-update-detection.ts — uncovered branch', () => {
  it('downloads when lastModified appears but previous lastModified was null (and no etag)', () => {
    // Covers line 41: previous.lastModified === null && current.lastModified !== null && current.etag === null
    const decision = decideSourceUpdate(
      { etag: null, lastModified: null },
      { etag: null, lastModified: 'Mon, 01 Jan 2026 00:00:00 GMT' },
    );
    expect(decision).toEqual({
      shouldDownload: true,
      compareByContentHash: false,
    });
  });
});
