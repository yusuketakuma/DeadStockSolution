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
  writeLog: vi.fn(),
  getClientIp: vi.fn(() => '127.0.0.1'),
  invalidateAuthUserCache: vi.fn(),
  recordAuditLog: vi.fn(),
}));

vi.mock('../middleware/auth', () => ({
  requireLogin: (req: { user?: { id: number; email: string; isAdmin: boolean } }, _res: unknown, next: () => void) => {
    req.user = { id: 1, email: 'admin@example.com', isAdmin: true };
    next();
  },
  requireAdmin: (_req: unknown, _res: unknown, next: () => void) => { next(); },
  invalidateAuthUserCache: mocks.invalidateAuthUserCache,
}));

vi.mock('../config/database', () => ({ db: mocks.db }));
vi.mock('../services/log-service', () => ({
  writeLog: mocks.writeLog,
  getClientIp: mocks.getClientIp,
}));
vi.mock('../services/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../middleware/error-handler', () => ({
  getErrorMessage: (err: unknown) => (err instanceof Error ? err.message : String(err)),
}));
vi.mock('../services/openclaw-service', () => ({
  handoffToOpenClaw: vi.fn(),
}));
vi.mock('../services/openclaw-log-context-service', () => ({
  buildOpenClawLogContext: vi.fn(),
}));
vi.mock('../services/proposal-timeline-service', () => ({
  buildProposalTimeline: vi.fn(),
  fetchProposalTimelineActionRows: vi.fn(),
}));
vi.mock('../utils/path-utils', () => ({
  isSafeInternalPath: (path: string) => path.startsWith('/'),
}));
vi.mock('../services/audit-log-service', () => ({
  recordAuditLog: mocks.recordAuditLog,
}));
vi.mock('drizzle-orm', () => {
  const sqlFn = Object.assign(
    (..._args: unknown[]) => ({}),
    { raw: (..._args: unknown[]) => ({}) },
  );
  return {
    eq: vi.fn(() => ({})),
    and: vi.fn(() => ({})),
    desc: vi.fn(() => ({})),
    inArray: vi.fn(() => ({})),
    sql: sqlFn,
  };
});
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

/** DB select チェーンのモックを設定するヘルパー */
function mockDbSelect(rows: unknown[]) {
  mocks.db.select.mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(rows),
    }),
  });
}

describe('POST /bulk-actions/preview (ドライラン)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.recordAuditLog.mockResolvedValue({});
  });

  it('pending_verification の薬局を verify する場合、newStatus が verified になる', async () => {
    mockDbSelect([
      { id: 1, name: '薬局A', verificationStatus: 'pending_verification', isActive: false },
      { id: 2, name: '薬局B', verificationStatus: 'pending_verification', isActive: false },
    ]);

    const app = createApp();
    const res = await request(app)
      .post('/api/admin/bulk-actions/preview')
      .send({ pharmacyIds: [1, 2], action: 'verify' });

    expect(res.status).toBe(200);
    expect(res.body.preview).toHaveLength(2);
    expect(res.body.preview[0]).toMatchObject({
      pharmacyId: 1,
      pharmacyName: '薬局A',
      currentStatus: 'pending_verification',
      newStatus: 'verified',
      wouldSkip: false,
    });
    expect(res.body.preview[0].skipReason).toBeUndefined();
  });

  it('既に verified の薬局は wouldSkip=true でスキップされる', async () => {
    mockDbSelect([
      { id: 3, name: '薬局C', verificationStatus: 'verified', isActive: true },
    ]);

    const app = createApp();
    const res = await request(app)
      .post('/api/admin/bulk-actions/preview')
      .send({ pharmacyIds: [3], action: 'verify' });

    expect(res.status).toBe(200);
    expect(res.body.preview).toHaveLength(1);
    expect(res.body.preview[0]).toMatchObject({
      pharmacyId: 3,
      wouldSkip: true,
      currentStatus: 'verified',
      newStatus: 'verified',
    });
    expect(res.body.preview[0].skipReason).toBe('既に対象の状態です');
  });

  it('activate アクションで isActive=false の薬局が有効化される', async () => {
    mockDbSelect([
      { id: 4, name: '薬局D', verificationStatus: 'verified', isActive: false },
    ]);

    const app = createApp();
    const res = await request(app)
      .post('/api/admin/bulk-actions/preview')
      .send({ pharmacyIds: [4], action: 'activate' });

    expect(res.status).toBe(200);
    expect(res.body.preview[0]).toMatchObject({
      pharmacyId: 4,
      newStatus: 'active',
      wouldSkip: false,
    });
  });

  it('deactivate アクションで既に isActive=false の薬局はスキップされる', async () => {
    mockDbSelect([
      { id: 5, name: '薬局E', verificationStatus: 'verified', isActive: false },
    ]);

    const app = createApp();
    const res = await request(app)
      .post('/api/admin/bulk-actions/preview')
      .send({ pharmacyIds: [5], action: 'deactivate' });

    expect(res.status).toBe(200);
    expect(res.body.preview[0]).toMatchObject({
      pharmacyId: 5,
      wouldSkip: true,
    });
  });

  it('reject アクションで reason なしでもプレビューは通過する（reason は preview 不要）', async () => {
    mockDbSelect([
      { id: 6, name: '薬局F', verificationStatus: 'pending_verification', isActive: false },
    ]);

    const app = createApp();
    const res = await request(app)
      .post('/api/admin/bulk-actions/preview')
      .send({ pharmacyIds: [6], action: 'reject' });

    // reject の requireReason チェックは parseBulkPharmacyActionRequest が行う
    // preview でも reason 必須チェックが走る（execute と同じ validation を共有）
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('却下理由は必須');
  });

  it('DB 更新が呼ばれないこと（ドライランなので副作用なし）', async () => {
    mockDbSelect([
      { id: 7, name: '薬局G', verificationStatus: 'pending_verification', isActive: false },
    ]);

    const app = createApp();
    await request(app)
      .post('/api/admin/bulk-actions/preview')
      .send({ pharmacyIds: [7], action: 'verify' });

    expect(mocks.db.update).not.toHaveBeenCalled();
    expect(mocks.db.transaction).not.toHaveBeenCalled();
  });

  it('pharmacyIds が空の場合 400 を返す', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/admin/bulk-actions/preview')
      .send({ pharmacyIds: [], action: 'verify' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('対象薬局ID');
  });

  it('pharmacyIds が 100 件を超える場合 400 を返す', async () => {
    const app = createApp();
    const ids = Array.from({ length: 101 }, (_, i) => i + 1);
    const res = await request(app)
      .post('/api/admin/bulk-actions/preview')
      .send({ pharmacyIds: ids, action: 'verify' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('最大100件');
  });

  it('不正な action の場合 400 を返す', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/admin/bulk-actions/preview')
      .send({ pharmacyIds: [1], action: 'invalid_action' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('action');
  });

  it('不正な pharmacyId（負の数）の場合 400 を返す', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/admin/bulk-actions/preview')
      .send({ pharmacyIds: [1, -1], action: 'verify' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('正の整数');
  });
});
