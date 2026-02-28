import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSelectLimitChain } from './helpers/mock-builders';
import { setupVitestMocks } from './helpers/setup';

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
    previewDeadStockDiff: vi.fn(),
    previewUsedMedicationDiff: vi.fn(),
    applyDeadStockDiff: vi.fn(),
    applyUsedMedicationDiff: vi.fn(),
    runUploadConfirm: vi.fn(),
    enqueueUploadConfirmJob: vi.fn(),
    isUploadConfirmQueueLimitError: vi.fn(),
    processUploadConfirmJobById: vi.fn(),
    getUploadConfirmJobForPharmacy: vi.fn(),
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

vi.mock('../services/upload-diff-service', () => ({
  previewDeadStockDiff: mocks.previewDeadStockDiff,
  previewUsedMedicationDiff: mocks.previewUsedMedicationDiff,
  applyDeadStockDiff: mocks.applyDeadStockDiff,
  applyUsedMedicationDiff: mocks.applyUsedMedicationDiff,
}));

vi.mock('../services/upload-confirm-service', () => ({
  runUploadConfirm: mocks.runUploadConfirm,
}));

vi.mock('../services/upload-confirm-job-service', () => ({
  enqueueUploadConfirmJob: mocks.enqueueUploadConfirmJob,
  isUploadConfirmQueueLimitError: mocks.isUploadConfirmQueueLimitError,
  processUploadConfirmJobById: mocks.processUploadConfirmJobById,
  getUploadConfirmJobForPharmacy: mocks.getUploadConfirmJobForPharmacy,
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
  setupVitestMocks();

  beforeEach(() => {
    delete process.env.UPLOAD_CONFIRM_PROCESS_ON_ENQUEUE;

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
    mocks.previewDeadStockDiff.mockResolvedValue({
      inserted: 1,
      updated: 0,
      deactivated: 0,
      unchanged: 0,
      totalIncoming: 1,
    });
    mocks.previewUsedMedicationDiff.mockResolvedValue({
      inserted: 1,
      updated: 0,
      deactivated: 0,
      unchanged: 0,
      totalIncoming: 1,
    });
    mocks.applyDeadStockDiff.mockResolvedValue({
      inserted: 1,
      updated: 0,
      deactivated: 0,
      unchanged: 0,
      totalIncoming: 1,
    });
    mocks.runUploadConfirm.mockResolvedValue({
      uploadId: 101,
      rowCount: 2,
      diffSummary: null,
    });
    mocks.enqueueUploadConfirmJob.mockResolvedValue(9001);
    mocks.isUploadConfirmQueueLimitError.mockImplementation(
      (error: unknown) => Boolean(
        error
        && typeof error === 'object'
        && 'code' in error
        && (error as { code?: unknown }).code === 'UPLOAD_CONFIRM_QUEUE_LIMIT',
      ),
    );
    mocks.processUploadConfirmJobById.mockResolvedValue(true);
    mocks.getUploadConfirmJobForPharmacy.mockResolvedValue(null);
    mocks.getClientIp.mockReturnValue('127.0.0.1');

    const { selectFrom } = createSelectLimitChain([]);
    mocks.db.select.mockImplementation(() => ({ from: selectFrom }));

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

  it('stores extracted rows on confirm (defaults applyMode=replace)', async () => {
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
      applyMode: 'replace',
    }));
    expect(mocks.runUploadConfirm).toHaveBeenCalledTimes(1);
  });

  it('returns bad request when applyMode is invalid on confirm', async () => {
    const app = createApp();

    const response = await request(app)
      .post('/api/upload/confirm')
      .field('uploadType', 'dead_stock')
      .field('headerRowIndex', '0')
      .field('applyMode', 'invalid')
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

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'applyMode は replace か diff を指定してください' });
    expect(mocks.db.transaction).not.toHaveBeenCalled();
    expect(mocks.parseExcelBuffer).not.toHaveBeenCalled();
  });

  it('returns diff preview summary when applyMode=diff', async () => {
    const app = createApp();

    const response = await request(app)
      .post('/api/upload/diff-preview')
      .field('uploadType', 'dead_stock')
      .field('headerRowIndex', '0')
      .field('applyMode', 'diff')
      .field('deleteMissing', 'true')
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
    expect(response.body).toEqual({
      applyMode: 'diff',
      uploadType: 'dead_stock',
      deleteMissing: true,
      summary: {
        inserted: 1,
        updated: 0,
        deactivated: 0,
        unchanged: 0,
        totalIncoming: 1,
      },
    });
    expect(mocks.previewDeadStockDiff).toHaveBeenCalledTimes(1);
  });

  it('stores diff summary on confirm when applyMode=diff', async () => {
    const app = createApp();
    mocks.runUploadConfirm.mockResolvedValueOnce({
      uploadId: 101,
      rowCount: 1,
      diffSummary: {
        inserted: 1,
        updated: 0,
        deactivated: 0,
        unchanged: 0,
        totalIncoming: 1,
      },
    });

    const response = await request(app)
      .post('/api/upload/confirm')
      .field('uploadType', 'dead_stock')
      .field('headerRowIndex', '0')
      .field('applyMode', 'diff')
      .field('deleteMissing', 'false')
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
      applyMode: 'diff',
      rowCount: 1,
      message: '1件のデータを登録しました',
      diffSummary: {
        inserted: 1,
        updated: 0,
        deactivated: 0,
        unchanged: 0,
        totalIncoming: 1,
      },
    }));
    expect(mocks.runUploadConfirm).toHaveBeenCalledTimes(1);
  });

  it('returns 500 when matching refresh enqueue fails during confirm', async () => {
    const app = createApp();
    mocks.runUploadConfirm.mockRejectedValueOnce(new Error('queue unavailable'));

    const response = await request(app)
      .post('/api/upload/confirm')
      .field('uploadType', 'dead_stock')
      .field('headerRowIndex', '0')
      .field('applyMode', 'replace')
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
    expect(mocks.runUploadConfirm).toHaveBeenCalledTimes(1);
  });

  it('returns 409 when stale upload is skipped during confirm', async () => {
    const app = createApp();
    mocks.runUploadConfirm.mockRejectedValueOnce(
      new Error('[STALE_JOB_SKIPPED] より新しいアップロードが既に反映されています'),
    );

    const response = await request(app)
      .post('/api/upload/confirm')
      .field('uploadType', 'dead_stock')
      .field('headerRowIndex', '0')
      .field('applyMode', 'replace')
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

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error: 'より新しいアップロードが既に反映されています。最新データで再度実行してください。',
      code: 'STALE_JOB_SKIPPED',
    });
    expect(mocks.runUploadConfirm).toHaveBeenCalledTimes(1);
  });

  it('enqueues async confirm job', async () => {
    const app = createApp();

    const response = await request(app)
      .post('/api/upload/confirm-async')
      .field('uploadType', 'dead_stock')
      .field('headerRowIndex', '0')
      .field('applyMode', 'replace')
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

    expect(response.status).toBe(202);
    expect(response.body).toEqual({
      message: 'アップロード処理を受け付けました',
      jobId: 9001,
      status: 'pending',
    });
    expect(mocks.enqueueUploadConfirmJob).toHaveBeenCalledTimes(1);
    expect(mocks.processUploadConfirmJobById).not.toHaveBeenCalled();
  });

  it('triggers immediate async confirm job processing when enabled by env', async () => {
    process.env.UPLOAD_CONFIRM_PROCESS_ON_ENQUEUE = 'true';
    const app = createApp();

    const response = await request(app)
      .post('/api/upload/confirm-async')
      .field('uploadType', 'dead_stock')
      .field('headerRowIndex', '0')
      .field('applyMode', 'replace')
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

    expect(response.status).toBe(202);
    expect(mocks.enqueueUploadConfirmJob).toHaveBeenCalledTimes(1);
    expect(mocks.processUploadConfirmJobById).toHaveBeenCalledWith(9001);
  });

  it('returns 429 when async queue is full', async () => {
    const app = createApp();
    mocks.enqueueUploadConfirmJob.mockRejectedValueOnce(Object.assign(
      new Error('現在アップロード処理が混み合っています'),
      {
        code: 'UPLOAD_CONFIRM_QUEUE_LIMIT',
        limit: 3,
        activeJobs: 3,
      },
    ));

    const response = await request(app)
      .post('/api/upload/confirm-async')
      .field('uploadType', 'dead_stock')
      .field('headerRowIndex', '0')
      .field('applyMode', 'replace')
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

    expect(response.status).toBe(429);
    expect(response.body).toEqual({
      error: '現在アップロード処理が混み合っています',
      code: 'UPLOAD_CONFIRM_QUEUE_LIMIT',
      limit: 3,
      activeJobs: 3,
    });
    expect(mocks.processUploadConfirmJobById).not.toHaveBeenCalled();
  });

  it('returns async job status for owner pharmacy', async () => {
    const app = createApp();
    mocks.getUploadConfirmJobForPharmacy.mockResolvedValueOnce({
      id: 9001,
      status: 'completed',
      attempts: 1,
      lastError: null,
      resultJson: JSON.stringify({ uploadId: 101, rowCount: 2, applyMode: 'replace' }),
      createdAt: '2026-02-28T00:00:00.000Z',
      updatedAt: '2026-02-28T00:01:00.000Z',
      completedAt: '2026-02-28T00:01:00.000Z',
    });

    const response = await request(app).get('/api/upload/jobs/9001');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      id: 9001,
      status: 'completed',
      attempts: 1,
      lastError: null,
      lastErrorCode: null,
      result: { uploadId: 101, rowCount: 2, applyMode: 'replace' },
      createdAt: '2026-02-28T00:00:00.000Z',
      updatedAt: '2026-02-28T00:01:00.000Z',
      completedAt: '2026-02-28T00:01:00.000Z',
    });
  });

  it('sanitizes async failed job error details', async () => {
    const app = createApp();
    mocks.getUploadConfirmJobForPharmacy.mockResolvedValueOnce({
      id: 9002,
      status: 'failed',
      attempts: 1,
      lastError: 'ジョブ内のmapping JSONが不正です: stack detail...',
      resultJson: null,
      createdAt: '2026-02-28T00:00:00.000Z',
      updatedAt: '2026-02-28T00:01:00.000Z',
      completedAt: '2026-02-28T00:01:00.000Z',
    });

    const response = await request(app).get('/api/upload/jobs/9002');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      id: 9002,
      status: 'failed',
      attempts: 1,
      lastError: 'カラム割り当ての設定が不正です。設定を見直して再実行してください。',
      lastErrorCode: 'MAPPING_INVALID',
      result: null,
      createdAt: '2026-02-28T00:00:00.000Z',
      updatedAt: '2026-02-28T00:01:00.000Z',
      completedAt: '2026-02-28T00:01:00.000Z',
    });
  });

  it('maps prefixed stale job error code to public message', async () => {
    const app = createApp();
    mocks.getUploadConfirmJobForPharmacy.mockResolvedValueOnce({
      id: 9003,
      status: 'failed',
      attempts: 1,
      lastError: '[STALE_JOB_SKIPPED] より新しいアップロードが既に反映されているため、このジョブはスキップされました',
      resultJson: null,
      createdAt: '2026-02-28T00:00:00.000Z',
      updatedAt: '2026-02-28T00:01:00.000Z',
      completedAt: '2026-02-28T00:01:00.000Z',
    });

    const response = await request(app).get('/api/upload/jobs/9003');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      id: 9003,
      status: 'failed',
      attempts: 1,
      lastError: 'より新しいアップロードが既に反映されているため、この処理はスキップされました。',
      lastErrorCode: 'STALE_JOB_SKIPPED',
      result: null,
      createdAt: '2026-02-28T00:00:00.000Z',
      updatedAt: '2026-02-28T00:01:00.000Z',
      completedAt: '2026-02-28T00:01:00.000Z',
    });
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
