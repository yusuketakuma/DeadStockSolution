import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
    detectUploadType: vi.fn(),
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
    isUploadConfirmIdempotencyConflictError: vi.fn(),
    getUploadConfirmJobForPharmacy: vi.fn(),
    cancelUploadConfirmJobForPharmacy: vi.fn(),
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
  detectUploadType: mocks.detectUploadType,
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
  isUploadConfirmIdempotencyConflictError: mocks.isUploadConfirmIdempotencyConflictError,
  getUploadConfirmJobForPharmacy: mocks.getUploadConfirmJobForPharmacy,
  cancelUploadConfirmJobForPharmacy: mocks.cancelUploadConfirmJobForPharmacy,
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
    delete process.env.UPLOAD_CONFIRM_FALLBACK_SYNC_ON_ENQUEUE_ERROR;

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
    mocks.detectUploadType.mockReturnValue({
      detectedType: 'dead_stock',
      confidence: 'high',
      scores: {
        dead_stock: 22,
        used_medication: 9,
      },
    });
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
      partialSummary: null,
    });
    mocks.enqueueUploadConfirmJob.mockResolvedValue({
      jobId: 9001,
      status: 'pending',
      deduplicated: false,
      cancelable: true,
      canceledAt: null,
    });
    mocks.isUploadConfirmQueueLimitError.mockImplementation(
      (error: unknown) => Boolean(
        error
        && typeof error === 'object'
        && 'code' in error
        && (error as { code?: unknown }).code === 'UPLOAD_CONFIRM_QUEUE_LIMIT',
      ),
    );
    mocks.isUploadConfirmIdempotencyConflictError.mockImplementation(
      (error: unknown) => Boolean(
        error
        && typeof error === 'object'
        && 'code' in error
        && (error as { code?: unknown }).code === 'UPLOAD_CONFIRM_IDEMPOTENCY_CONFLICT',
      ),
    );
    mocks.getUploadConfirmJobForPharmacy.mockResolvedValue(null);
    mocks.getClientIp.mockReturnValue('127.0.0.1');

    mocks.db.select.mockImplementation(() => ({
      from: () => ({
        where: () => ({
          limit: async () => [],
          orderBy: async () => [],
          groupBy: async () => [],
        }),
      }),
    }));

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
      detectedUploadType: 'dead_stock',
      resolvedUploadType: 'dead_stock',
      rememberedUploadType: null,
      uploadTypeConfidence: 'high',
      uploadTypeScores: {
        dead_stock: 22,
        used_medication: 9,
      },
    }));
    expect(mocks.parseExcelBuffer).toHaveBeenCalledTimes(1);
  });

  it('does not override high-confidence detected type with conflicting remembered type', async () => {
    const app = createApp();
    mocks.db.select.mockImplementationOnce(() => ({
      from: () => ({
        where: () => ({
          orderBy: async () => ([
            {
              uploadType: 'used_medication',
              mapping: JSON.stringify({
                drug_code: '0',
                drug_name: '1',
                monthly_usage: '2',
                unit: '3',
                yakka_unit_price: null,
              }),
              createdAt: '2026-02-28T09:00:00.000Z',
            },
          ]),
        }),
      }),
    }));

    const response = await request(app)
      .post('/api/upload/preview')
      .attach('file', Buffer.from('dummy-xlsx-content'), {
        filename: 'used-medication.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      detectedUploadType: 'dead_stock',
      resolvedUploadType: 'dead_stock',
      rememberedUploadType: 'used_medication',
      hasSavedMapping: false,
    }));
  });

  it('marks hasSavedMapping=false when saved mapping exists but is broken', async () => {
    const app = createApp();
    mocks.db.select.mockImplementationOnce(() => ({
      from: () => ({
        where: () => ({
          orderBy: async () => ([
            {
              uploadType: 'dead_stock',
              mapping: '{broken-json',
              createdAt: '2026-02-28T09:00:00.000Z',
            },
          ]),
        }),
      }),
    }));

    const response = await request(app)
      .post('/api/upload/preview')
      .field('uploadType', 'dead_stock')
      .attach('file', Buffer.from('dummy-xlsx-content'), {
        filename: 'dead-stock.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      resolvedUploadType: 'dead_stock',
      hasSavedMapping: false,
    }));
  });

  it('enqueues async confirm job (defaults applyMode=replace)', async () => {
    const app = createApp();

    const response = await request(app)
      .post('/api/upload/confirm-async')
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

    expect(response.status).toBe(202);
    expect(response.body).toEqual({
      message: 'アップロード処理を受け付けました',
      jobId: 9001,
      status: 'pending',
      deduplicated: false,
      cancelable: true,
      canceledAt: null,
      partialSummary: null,
      errorReportAvailable: false,
    });
    expect(mocks.enqueueUploadConfirmJob).toHaveBeenCalledTimes(1);
    expect(mocks.enqueueUploadConfirmJob).toHaveBeenCalledWith(expect.objectContaining({
      applyMode: 'replace',
      requestedAtIso: expect.any(String),
    }));
  });

  it('keeps POST /api/upload/confirm as compatibility alias to async queue', async () => {
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

    expect(response.status).toBe(202);
    expect(response.headers.deprecation).toBe('true');
    expect(response.headers.link).toContain('/api/upload/confirm-async');
    expect(response.body).toEqual(expect.objectContaining({
      message: 'アップロード処理を受け付けました',
      deprecatedEndpoint: true,
      deprecationNotice: expect.any(String),
    }));
    expect(mocks.enqueueUploadConfirmJob).toHaveBeenCalledTimes(1);
  });

  it('returns bad request when mapping column is out of header range on confirm-async', async () => {
    const app = createApp();

    const response = await request(app)
      .post('/api/upload/confirm-async')
      .field('uploadType', 'dead_stock')
      .field('headerRowIndex', '0')
      .field('applyMode', 'replace')
      .field('mapping', JSON.stringify({
        drug_code: '0',
        drug_name: '9',
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
    expect(response.body).toEqual({ error: '薬剤名カラムの割り当てが見出し範囲外です' });
    expect(mocks.enqueueUploadConfirmJob).not.toHaveBeenCalled();
  });

  it('returns bad request when applyMode is invalid on confirm-async', async () => {
    const app = createApp();

    const response = await request(app)
      .post('/api/upload/confirm-async')
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
    expect(response.body).toEqual({ error: 'applyMode は replace / diff / partial を指定してください' });
    expect(mocks.parseExcelBuffer).not.toHaveBeenCalled();
    expect(mocks.enqueueUploadConfirmJob).not.toHaveBeenCalled();
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

  it('enqueues async confirm job when applyMode=diff', async () => {
    const app = createApp();

    const response = await request(app)
      .post('/api/upload/confirm-async')
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

    expect(response.status).toBe(202);
    expect(mocks.enqueueUploadConfirmJob).toHaveBeenCalledTimes(1);
    expect(mocks.enqueueUploadConfirmJob).toHaveBeenCalledWith(expect.objectContaining({
      applyMode: 'diff',
      deleteMissing: false,
    }));
  });

  it('returns 500 when enqueue fails during confirm-async', async () => {
    const app = createApp();
    mocks.enqueueUploadConfirmJob.mockRejectedValueOnce(new Error('queue unavailable'));

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

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: '非同期アップロード処理の受付に失敗しました' });
    expect(mocks.enqueueUploadConfirmJob).toHaveBeenCalledTimes(1);
  });

  it('falls back to sync confirm when enqueue fails and fallback flag is enabled', async () => {
    process.env.UPLOAD_CONFIRM_FALLBACK_SYNC_ON_ENQUEUE_ERROR = 'true';
    const app = createApp();
    mocks.enqueueUploadConfirmJob.mockRejectedValueOnce(new Error('queue unavailable'));
    mocks.runUploadConfirm.mockResolvedValueOnce({
      uploadId: 777,
      rowCount: 2,
      diffSummary: null,
      partialSummary: null,
    });

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

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      message: 'キュー登録に失敗したため同期処理で適用しました',
      status: 'completed_sync_fallback',
      deduplicated: false,
      cancelable: false,
      canceledAt: null,
      jobId: null,
      uploadId: 777,
      rowCount: 2,
      partialSummary: null,
      errorReportAvailable: false,
    });
    expect(mocks.runUploadConfirm).toHaveBeenCalledTimes(1);
  });

  it('enqueues async confirm job without mapping by auto-resolving fixed columns', async () => {
    const app = createApp();

    const response = await request(app)
      .post('/api/upload/confirm-async')
      .field('uploadType', 'dead_stock')
      .field('headerRowIndex', '0')
      .field('applyMode', 'replace')
      .attach('file', Buffer.from('dummy-xlsx-content'), {
        filename: 'dead-stock.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });

    expect(response.status).toBe(202);
    expect(mocks.parseExcelBuffer).toHaveBeenCalledTimes(1);
    expect(mocks.enqueueUploadConfirmJob).toHaveBeenCalledWith(expect.objectContaining({
      uploadType: 'dead_stock',
      headerRowIndex: 0,
      requestedAtIso: expect.any(String),
      mapping: expect.objectContaining({
        drug_name: '1',
        quantity: '2',
      }),
    }));
  });

  it('returns bad request when idempotency key format is invalid on confirm-async', async () => {
    const app = createApp();

    const response = await request(app)
      .post('/api/upload/confirm-async')
      .field('uploadType', 'dead_stock')
      .field('headerRowIndex', '0')
      .field('applyMode', 'replace')
      .field('idempotencyKey', 'bad key')
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
    expect(response.body).toEqual({
      error: 'idempotencyKey は 8-120文字の英数字記号（: _ - .）で指定してください',
    });
    expect(mocks.enqueueUploadConfirmJob).not.toHaveBeenCalled();
  });

  it('does not trigger immediate async confirm job processing even when env is enabled', async () => {
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
    expect(mocks.parseExcelBuffer).toHaveBeenCalledTimes(1);
  });

  it('returns 409 when idempotency key conflicts with different payload', async () => {
    const app = createApp();
    mocks.enqueueUploadConfirmJob.mockRejectedValueOnce(Object.assign(
      new Error('同じ idempotencyKey で異なるアップロード要求が送信されました'),
      {
        code: 'UPLOAD_CONFIRM_IDEMPOTENCY_CONFLICT',
      },
    ));

    const response = await request(app)
      .post('/api/upload/confirm-async')
      .field('uploadType', 'dead_stock')
      .field('headerRowIndex', '0')
      .field('applyMode', 'replace')
      .field('idempotencyKey', 'upload-job-key-0001')
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
      error: '同じ idempotencyKey で異なるアップロード要求が送信されました',
      code: 'UPLOAD_CONFIRM_IDEMPOTENCY_CONFLICT',
    });
  });

  it('returns async job status for owner pharmacy', async () => {
    const app = createApp();
    mocks.getUploadConfirmJobForPharmacy.mockResolvedValueOnce({
      id: 9001,
      pharmacyId: 1,
      uploadType: 'dead_stock',
      originalFilename: 'dead-stock.xlsx',
      idempotencyKey: null,
      fileHash: 'abc',
      status: 'completed',
      applyMode: 'replace',
      deleteMissing: false,
      attempts: 1,
      lastError: null,
      resultJson: JSON.stringify({ uploadId: 101, rowCount: 2, applyMode: 'replace' }),
      deduplicated: false,
      cancelRequestedAt: null,
      canceledAt: null,
      canceledBy: null,
      createdAt: '2026-02-28T00:00:00.000Z',
      updatedAt: '2026-02-28T00:01:00.000Z',
      completedAt: '2026-02-28T00:01:00.000Z',
      issueCount: 0,
      cancelable: false,
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
      deduplicated: false,
      cancelable: false,
      canceledAt: null,
      partialSummary: null,
      errorReportAvailable: false,
      createdAt: '2026-02-28T00:00:00.000Z',
      updatedAt: '2026-02-28T00:01:00.000Z',
      completedAt: '2026-02-28T00:01:00.000Z',
    });
  });

  it('sanitizes async failed job error details', async () => {
    const app = createApp();
    mocks.getUploadConfirmJobForPharmacy.mockResolvedValueOnce({
      id: 9002,
      pharmacyId: 1,
      uploadType: 'dead_stock',
      originalFilename: 'dead-stock.xlsx',
      idempotencyKey: null,
      fileHash: 'abc',
      status: 'failed',
      applyMode: 'replace',
      deleteMissing: false,
      attempts: 1,
      lastError: 'ジョブ内のmapping JSONが不正です: stack detail...',
      resultJson: null,
      deduplicated: false,
      cancelRequestedAt: null,
      canceledAt: null,
      canceledBy: null,
      createdAt: '2026-02-28T00:00:00.000Z',
      updatedAt: '2026-02-28T00:01:00.000Z',
      completedAt: '2026-02-28T00:01:00.000Z',
      issueCount: 0,
      cancelable: false,
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
      deduplicated: false,
      cancelable: false,
      canceledAt: null,
      partialSummary: null,
      errorReportAvailable: false,
      createdAt: '2026-02-28T00:00:00.000Z',
      updatedAt: '2026-02-28T00:01:00.000Z',
      completedAt: '2026-02-28T00:01:00.000Z',
    });
  });

  it('maps prefixed stale job error code to public message', async () => {
    const app = createApp();
    mocks.getUploadConfirmJobForPharmacy.mockResolvedValueOnce({
      id: 9003,
      pharmacyId: 1,
      uploadType: 'dead_stock',
      originalFilename: 'dead-stock.xlsx',
      idempotencyKey: null,
      fileHash: 'abc',
      status: 'failed',
      applyMode: 'replace',
      deleteMissing: false,
      attempts: 1,
      lastError: '[STALE_JOB_SKIPPED] より新しいアップロードが既に反映されているため、このジョブはスキップされました',
      resultJson: null,
      deduplicated: false,
      cancelRequestedAt: null,
      canceledAt: null,
      canceledBy: null,
      createdAt: '2026-02-28T00:00:00.000Z',
      updatedAt: '2026-02-28T00:01:00.000Z',
      completedAt: '2026-02-28T00:01:00.000Z',
      issueCount: 0,
      cancelable: false,
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
      deduplicated: false,
      cancelable: false,
      canceledAt: null,
      partialSummary: null,
      errorReportAvailable: false,
      createdAt: '2026-02-28T00:00:00.000Z',
      updatedAt: '2026-02-28T00:01:00.000Z',
      completedAt: '2026-02-28T00:01:00.000Z',
    });
  });

  it('returns partial summary and error report availability for partial jobs', async () => {
    const app = createApp();
    mocks.getUploadConfirmJobForPharmacy.mockResolvedValueOnce({
      id: 9101,
      pharmacyId: 1,
      uploadType: 'dead_stock',
      originalFilename: 'partial.xlsx',
      idempotencyKey: 'upload-job-key-9999',
      fileHash: 'hash-9101',
      status: 'completed',
      applyMode: 'partial',
      deleteMissing: false,
      attempts: 1,
      lastError: null,
      resultJson: JSON.stringify({
        uploadId: 222,
        rowCount: 4,
        applyMode: 'partial',
        partialSummary: {
          inspectedRows: 7,
          acceptedRows: 4,
          rejectedRows: 3,
          issueCounts: {
            MISSING_DRUG_NAME: 2,
            INVALID_QUANTITY: 1,
          },
        },
      }),
      deduplicated: true,
      cancelRequestedAt: null,
      canceledAt: null,
      canceledBy: null,
      createdAt: '2026-02-28T00:00:00.000Z',
      updatedAt: '2026-02-28T00:01:00.000Z',
      completedAt: '2026-02-28T00:01:00.000Z',
      issueCount: 3,
      cancelable: false,
    });

    const response = await request(app).get('/api/upload/jobs/9101');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      id: 9101,
      deduplicated: true,
      cancelable: false,
      canceledAt: null,
      partialSummary: {
        inspectedRows: 7,
        acceptedRows: 4,
        rejectedRows: 3,
        issueCounts: {
          MISSING_DRUG_NAME: 2,
          INVALID_QUANTITY: 1,
        },
      },
      errorReportAvailable: true,
    }));
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

  it('auto-detects upload type when preview upload type is omitted', async () => {
    const app = createApp();

    const response = await request(app)
      .post('/api/upload/preview')
      .attach('file', Buffer.from('dummy-xlsx-content'), {
        filename: 'dead-stock.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      detectedUploadType: 'dead_stock',
      resolvedUploadType: 'dead_stock',
    }));
  });

  it('returns bad request when preview upload type is explicitly invalid', async () => {
    const app = createApp();

    const response = await request(app)
      .post('/api/upload/preview')
      .field('uploadType', 'invalid_type')
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
