import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  parseMhlwExcelData: vi.fn(),
  parseMhlwCsvData: vi.fn(),
  parsePackageExcelData: vi.fn(),
  parsePackageCsvData: vi.fn(),
  parsePackageXmlData: vi.fn(),
  parsePackageZipData: vi.fn(),
  decodeCsvBuffer: vi.fn(),
  syncDrugMaster: vi.fn(),
  syncPackageData: vi.fn(),
  searchDrugMaster: vi.fn(),
  lookupByCode: vi.fn(),
  getDrugMasterStats: vi.fn(),
  getDrugDetail: vi.fn(),
  getSyncLogs: vi.fn(),
  createSyncLog: vi.fn(),
  completeSyncLog: vi.fn(),
  updateDrugMasterItem: vi.fn(),
  triggerManualAutoSync: vi.fn(),
  triggerManualPackageAutoSync: vi.fn(),
  parseExcelBuffer: vi.fn(),
  writeLog: vi.fn(),
  getClientIp: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
  db: {
    select: vi.fn(),
  },
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

vi.mock('../services/drug-master-service', () => ({
  parseMhlwExcelData: mocks.parseMhlwExcelData,
  parseMhlwCsvData: mocks.parseMhlwCsvData,
  parsePackageExcelData: mocks.parsePackageExcelData,
  parsePackageCsvData: mocks.parsePackageCsvData,
  parsePackageXmlData: mocks.parsePackageXmlData,
  parsePackageZipData: mocks.parsePackageZipData,
  decodeCsvBuffer: mocks.decodeCsvBuffer,
  syncDrugMaster: mocks.syncDrugMaster,
  syncPackageData: mocks.syncPackageData,
  searchDrugMaster: mocks.searchDrugMaster,
  lookupByCode: mocks.lookupByCode,
  getDrugMasterStats: mocks.getDrugMasterStats,
  getDrugDetail: mocks.getDrugDetail,
  getSyncLogs: mocks.getSyncLogs,
  createSyncLog: mocks.createSyncLog,
  completeSyncLog: mocks.completeSyncLog,
  updateDrugMasterItem: mocks.updateDrugMasterItem,
}));

vi.mock('../services/drug-master-scheduler', () => ({
  triggerManualAutoSync: mocks.triggerManualAutoSync,
}));

vi.mock('../services/drug-package-scheduler', () => ({
  triggerManualPackageAutoSync: mocks.triggerManualPackageAutoSync,
}));

vi.mock('../services/upload-service', () => ({
  parseExcelBuffer: mocks.parseExcelBuffer,
}));

vi.mock('../services/log-service', () => ({
  writeLog: mocks.writeLog,
  getClientIp: mocks.getClientIp,
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

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(() => ({})),
  and: vi.fn(() => ({})),
  like: vi.fn(() => ({})),
  or: vi.fn(() => ({})),
  isNotNull: vi.fn(() => ({})),
  sql: vi.fn(() => ({})),
}));

import drugMasterRouter from '../routes/drug-master';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/drug-master', drugMasterRouter);
  return app;
}

describe('drug master routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.createSyncLog.mockResolvedValue({ id: 88 });
    mocks.parseExcelBuffer.mockResolvedValue([['YJコード', '医薬品名'], ['1111111F1111', '薬A']]);
    mocks.parseMhlwExcelData.mockReturnValue([{ yjCode: '1111111F1111', drugName: '薬A' }]);
    mocks.syncDrugMaster.mockResolvedValue({
      itemsProcessed: 1,
      itemsAdded: 1,
      itemsUpdated: 0,
      itemsDeleted: 0,
    });
    mocks.completeSyncLog.mockResolvedValue(undefined);
    mocks.writeLog.mockResolvedValue(undefined);
    mocks.getClientIp.mockReturnValue('127.0.0.1');
  });

  it('syncs drug master from xlsx file', async () => {
    const app = createApp();

    const response = await request(app)
      .post('/api/admin/drug-master/sync')
      .field('revisionDate', '2026-02-24')
      .attach('file', Buffer.from('dummy-xlsx-content'), {
        filename: 'mhlw.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      message: '同期が完了しました',
      syncLogId: 88,
    }));
    expect(mocks.syncDrugMaster).toHaveBeenCalledTimes(1);
    expect(mocks.completeSyncLog).toHaveBeenCalledWith(
      88,
      'success',
      expect.objectContaining({
        itemsProcessed: 1,
        itemsAdded: 1,
      }),
    );
  });

  it('returns bad request when revisionDate is invalid', async () => {
    const app = createApp();

    const response = await request(app)
      .post('/api/admin/drug-master/sync')
      .field('revisionDate', '2026/02/24')
      .attach('file', Buffer.from('dummy-xlsx-content'), {
        filename: 'mhlw.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: '改定日は YYYY-MM-DD 形式で指定してください' });
    expect(mocks.createSyncLog).not.toHaveBeenCalled();
    expect(mocks.writeLog).toHaveBeenCalledWith(
      'drug_master_sync',
      expect.objectContaining({
        pharmacyId: 1,
        detail: expect.stringContaining('reason=invalid_revision_date'),
      }),
    );
  });

  it('closes sync log as failed when parser throws without duplicate app warn log', async () => {
    const app = createApp();
    mocks.parseMhlwExcelData.mockImplementation(() => {
      throw new Error('invalid excel');
    });

    const response = await request(app)
      .post('/api/admin/drug-master/sync')
      .field('revisionDate', '2026-02-24')
      .attach('file', Buffer.from('dummy-xlsx-content'), {
        filename: 'mhlw.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'invalid excel' });
    expect(mocks.completeSyncLog).toHaveBeenCalledWith(
      88,
      'failed',
      {
        itemsProcessed: 0,
        itemsAdded: 0,
        itemsUpdated: 0,
        itemsDeleted: 0,
      },
      'invalid excel',
    );
    expect(mocks.loggerWarn).not.toHaveBeenCalled();
    expect(mocks.writeLog).toHaveBeenCalledWith(
      'drug_master_sync',
      expect.objectContaining({
        pharmacyId: 1,
        detail: expect.stringContaining('reason=parse_failed'),
      }),
    );
  });

  it('logs error context and returns 500 when sync process fails', async () => {
    const app = createApp();
    mocks.syncDrugMaster.mockRejectedValueOnce(new Error('sync failed'));

    const response = await request(app)
      .post('/api/admin/drug-master/sync')
      .field('revisionDate', '2026-02-24')
      .attach('file', Buffer.from('dummy-xlsx-content'), {
        filename: 'mhlw.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: '同期処理中にエラーが発生しました' });
    expect(mocks.completeSyncLog).toHaveBeenCalledWith(
      88,
      'failed',
      {
        itemsProcessed: 0,
        itemsAdded: 0,
        itemsUpdated: 0,
        itemsDeleted: 0,
      },
      'sync failed',
    );
    expect(mocks.loggerError).toHaveBeenCalledWith('Drug master sync failed', expect.any(Function));
    const lazyPayload = mocks.loggerError.mock.calls[0]?.[1] as (() => Record<string, unknown>) | undefined;
    expect(lazyPayload).toBeTypeOf('function');
    expect(lazyPayload?.()).toEqual(expect.objectContaining({
      fileName: 'mhlw.xlsx',
      extension: '.xlsx',
      syncLogId: 88,
      error: 'sync failed',
    }));
    expect(mocks.writeLog).toHaveBeenCalledWith(
      'drug_master_sync',
      expect.objectContaining({
        pharmacyId: 1,
        detail: expect.stringContaining('reason=sync_failed'),
      }),
    );
  });
});
