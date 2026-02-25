import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const db = {
    select: vi.fn(),
    transaction: vi.fn(),
  };

  return {
    db,
    parseExcelBuffer: vi.fn(),
    getPreviewRows: vi.fn(),
    detectHeaderRow: vi.fn(),
    suggestMapping: vi.fn(),
    computeHeaderHash: vi.fn(),
    extractDeadStockRows: vi.fn(),
    extractUsedMedicationRows: vi.fn(),
    enrichWithDrugMaster: vi.fn(),
    triggerMatchingRefreshOnUpload: vi.fn(),
    loggerWarn: vi.fn(),
    loggerError: vi.fn(),
    writeLog: vi.fn(),
    getClientIp: vi.fn(),
  };
});

vi.mock('../middleware/auth', () => ({
  requireLogin: (req: { user?: { id: number; email: string; isAdmin: boolean } }, _res: unknown, next: () => void) => {
    req.user = { id: 1, email: 'test@example.com', isAdmin: false };
    next();
  },
}));

vi.mock('../config/database', () => ({
  db: mocks.db,
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(() => ({})),
  and: vi.fn(() => ({})),
  desc: vi.fn(() => ({})),
  inArray: vi.fn(() => ({})),
  sql: vi.fn(() => ({})),
}));

vi.mock('../services/upload-service', () => ({
  parseExcelBuffer: mocks.parseExcelBuffer,
  getPreviewRows: mocks.getPreviewRows,
}));

vi.mock('../services/column-mapper', () => ({
  detectHeaderRow: mocks.detectHeaderRow,
  suggestMapping: mocks.suggestMapping,
  computeHeaderHash: mocks.computeHeaderHash,
}));

vi.mock('../services/data-extractor', () => ({
  extractDeadStockRows: mocks.extractDeadStockRows,
  extractUsedMedicationRows: mocks.extractUsedMedicationRows,
}));

vi.mock('../services/drug-master-enrichment', () => ({
  enrichWithDrugMaster: mocks.enrichWithDrugMaster,
}));

vi.mock('../services/matching-refresh-service', () => ({
  triggerMatchingRefreshOnUpload: mocks.triggerMatchingRefreshOnUpload,
}));

vi.mock('../services/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: mocks.loggerWarn,
    error: mocks.loggerError,
  },
}));

vi.mock('../services/log-service', () => ({
  writeLog: mocks.writeLog,
  getClientIp: mocks.getClientIp,
}));

import uploadRouter from '../routes/upload';

function createTxMock(uploadId: number) {
  return {
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn().mockResolvedValue([{ id: uploadId }]),
        onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn().mockResolvedValue(undefined),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn().mockResolvedValue(undefined),
      })),
    })),
  };
}

function createApp() {
  const app = express();
  app.use('/api/upload', uploadRouter);
  return app;
}

describe('upload routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.parseExcelBuffer.mockResolvedValue([
      ['YJコード', '薬剤名', '数量'],
      ['1111111F1111', '薬A', 10],
      ['2222222F2222', '薬B', 5],
    ]);
    mocks.getPreviewRows.mockReturnValue([
      ['1111111F1111', '薬A', '10'],
      ['2222222F2222', '薬B', '5'],
    ]);
    mocks.detectHeaderRow.mockReturnValue(0);
    mocks.computeHeaderHash.mockReturnValue('header-hash');
    mocks.suggestMapping.mockReturnValue({
      drug_code: '0',
      drug_name: '1',
      quantity: '2',
      unit: null,
      yakka_unit_price: null,
      expiration_date: null,
      lot_number: null,
    });
    mocks.extractDeadStockRows.mockReturnValue([
      {
        drugCode: '1111111F1111',
        drugName: '薬A',
        quantity: 10,
        unit: '錠',
        yakkaUnitPrice: 10.2,
        yakkaTotal: 102,
        expirationDate: null,
        lotNumber: null,
      },
      {
        drugCode: '2222222F2222',
        drugName: '薬B',
        quantity: 5,
        unit: '錠',
        yakkaUnitPrice: 20,
        yakkaTotal: 100,
        expirationDate: null,
        lotNumber: null,
      },
    ]);
    mocks.enrichWithDrugMaster.mockImplementation(async (rows: unknown[]) => rows);
    mocks.triggerMatchingRefreshOnUpload.mockResolvedValue(undefined);
    mocks.getClientIp.mockReturnValue('127.0.0.1');

    const selectLimitMock = vi.fn().mockResolvedValue([]);
    const selectWhereMock = vi.fn(() => ({ limit: selectLimitMock }));
    const selectFromMock = vi.fn(() => ({ where: selectWhereMock }));
    mocks.db.select.mockImplementation(() => ({ from: selectFromMock }));

    const txMock = createTxMock(101);
    mocks.db.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback(txMock));
  });

  it('returns preview response for dead stock upload', async () => {
    const app = createApp();

    const response = await request(app)
      .post('/api/upload/preview')
      .field('uploadType', 'dead_stock')
      .attach('file', Buffer.from('dummy-xlsx-content'), {
        filename: 'dead-stock.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      headers: ['YJコード', '薬剤名', '数量'],
      headerRowIndex: 0,
      hasSavedMapping: false,
    }));
    expect(mocks.parseExcelBuffer).toHaveBeenCalledTimes(1);
  });

  it('stores extracted rows on confirm', async () => {
    const app = createApp();

    const response = await request(app)
      .post('/api/upload/confirm')
      .field('uploadType', 'dead_stock')
      .field('headerRowIndex', '0')
      .field('mapping', JSON.stringify({
        drug_code: '0',
        drug_name: '1',
        quantity: '2',
        unit: null,
        yakka_unit_price: null,
        expiration_date: null,
        lot_number: null,
      }))
      .attach('file', Buffer.from('dummy-xlsx-content'), {
        filename: 'dead-stock.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      uploadId: 101,
      rowCount: 2,
    }));
    expect(mocks.db.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.extractDeadStockRows).toHaveBeenCalledTimes(1);
  });

  it('returns 500 when matching refresh enqueue fails during confirm', async () => {
    const app = createApp();
    mocks.triggerMatchingRefreshOnUpload.mockRejectedValueOnce(new Error('queue unavailable'));

    const response = await request(app)
      .post('/api/upload/confirm')
      .field('uploadType', 'dead_stock')
      .field('headerRowIndex', '0')
      .field('mapping', JSON.stringify({
        drug_code: '0',
        drug_name: '1',
        quantity: '2',
        unit: null,
        yakka_unit_price: null,
        expiration_date: null,
        lot_number: null,
      }))
      .attach('file', Buffer.from('dummy-xlsx-content'), {
        filename: 'dead-stock.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'データ登録またはマッチング更新に失敗しました' });
    expect(mocks.db.transaction).toHaveBeenCalledTimes(1);
  });

  it('returns upload status from a grouped upload query', async () => {
    const app = createApp();
    const nowIso = new Date().toISOString();
    const selectGroupByMock = vi.fn().mockResolvedValue([
      { uploadType: 'dead_stock', createdAt: '2025-12-01T00:00:00.000Z' },
      { uploadType: 'used_medication', createdAt: nowIso },
    ]);
    const selectWhereMock = vi.fn(() => ({ groupBy: selectGroupByMock }));
    const selectFromMock = vi.fn(() => ({ where: selectWhereMock }));
    mocks.db.select.mockImplementationOnce(() => ({ from: selectFromMock }));

    const response = await request(app).get('/api/upload/status');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      deadStockUploaded: true,
      usedMedicationUploaded: true,
      lastDeadStockUpload: '2025-12-01T00:00:00.000Z',
      lastUsedMedicationUpload: nowIso,
    });
    expect(selectGroupByMock).toHaveBeenCalledTimes(1);
  });

  it('returns bad request when upload type is missing on preview', async () => {
    const app = createApp();

    const response = await request(app)
      .post('/api/upload/preview')
      .attach('file', Buffer.from('dummy-xlsx-content'), {
        filename: 'dead-stock.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'アップロードタイプを指定してください' });
  });

  it('records failure log when preview parsing fails', async () => {
    const app = createApp();
    mocks.parseExcelBuffer.mockRejectedValueOnce(new Error('broken xlsx'));

    const response = await request(app)
      .post('/api/upload/preview')
      .field('uploadType', 'dead_stock')
      .attach('file', Buffer.from('dummy-xlsx-content'), {
        filename: 'broken.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'ファイルの解析に失敗しました。xlsx形式を確認してください' });
    expect(mocks.loggerWarn).not.toHaveBeenCalled();
    expect(mocks.writeLog).toHaveBeenCalledWith(
      'upload',
      expect.objectContaining({
        pharmacyId: 1,
        detail: expect.stringContaining('reason=parse_failed'),
      }),
    );
  });
});
