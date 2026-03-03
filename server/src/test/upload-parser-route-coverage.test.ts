import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
  },
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
  enqueueUploadConfirmJob: vi.fn(),
  isUploadConfirmQueueLimitError: vi.fn(),
  isUploadConfirmIdempotencyConflictError: vi.fn(),
  getUploadConfirmJobForPharmacy: vi.fn(),
  cancelUploadConfirmJobForPharmacy: vi.fn(),
  getUploadRowIssuesForJob: vi.fn(),
  getUploadRowIssueSummary: vi.fn(),
  buildUploadRowIssueCsv: vi.fn(),
  loggerError: vi.fn(),
  loggerWarn: vi.fn(),
  writeLog: vi.fn(),
  getClientIp: vi.fn(),
}));

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
}));

vi.mock('../services/upload-confirm-service', () => ({
  runUploadConfirm: vi.fn(),
}));

vi.mock('../services/upload-confirm-job-service', () => ({
  enqueueUploadConfirmJob: mocks.enqueueUploadConfirmJob,
  isUploadConfirmQueueLimitError: mocks.isUploadConfirmQueueLimitError,
  isUploadConfirmIdempotencyConflictError: mocks.isUploadConfirmIdempotencyConflictError,
  getUploadConfirmJobForPharmacy: mocks.getUploadConfirmJobForPharmacy,
  cancelUploadConfirmJobForPharmacy: mocks.cancelUploadConfirmJobForPharmacy,
}));

vi.mock('../services/upload-row-issue-service', () => ({
  getUploadRowIssuesForJob: mocks.getUploadRowIssuesForJob,
  getUploadRowIssueSummary: mocks.getUploadRowIssueSummary,
  buildUploadRowIssueCsv: mocks.buildUploadRowIssueCsv,
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
import { createAuthenticatedApp } from './helpers/mock-builders';

function createApp() {
  return createAuthenticatedApp('/api/upload', uploadRouter);
}

const VALID_MAPPING = JSON.stringify({
  drug_code: '0',
  drug_name: '1',
  quantity: '2',
  unit: null,
  yakka_unit_price: null,
  expiration_date: null,
  lot_number: null,
});

describe('upload-parser route coverage: preview edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.parseExcelBuffer.mockResolvedValue([
      ['YJコード', '薬剤名', '数量'],
      ['1111111F1111', '薬A', 10],
    ]);
    mocks.getPreviewRows.mockReturnValue([['1111111F1111', '薬A', '10']]);
    mocks.detectHeaderRow.mockReturnValue(0);
    mocks.detectUploadType.mockReturnValue({
      detectedType: 'dead_stock',
      confidence: 'high',
      scores: { dead_stock: 20, used_medication: 5 },
    });
    mocks.computeHeaderHash.mockReturnValue('hash-1');
    mocks.suggestMapping.mockReturnValue({
      drug_code: '0', drug_name: '1', quantity: '2',
      unit: null, yakka_unit_price: null, expiration_date: null, lot_number: null,
    });
    mocks.extractDeadStockRows.mockReturnValue([]);
    mocks.extractUsedMedicationRows.mockReturnValue([]);
    mocks.enrichWithDrugMaster.mockImplementation(async (rows: unknown[]) => rows);
    mocks.previewDeadStockDiff.mockResolvedValue({ inserted: 0, updated: 0, deactivated: 0, unchanged: 0, totalIncoming: 0 });
    mocks.previewUsedMedicationDiff.mockResolvedValue({ inserted: 0, updated: 0, deactivated: 0, unchanged: 0, totalIncoming: 0 });
    mocks.getClientIp.mockReturnValue('127.0.0.1');
    mocks.isUploadConfirmQueueLimitError.mockReturnValue(false);
    mocks.isUploadConfirmIdempotencyConflictError.mockReturnValue(false);

    mocks.db.select.mockImplementation(() => ({
      from: () => ({
        where: () => ({
          orderBy: async () => [],
          limit: async () => [],
          groupBy: async () => [],
        }),
      }),
    }));
  });

  it('returns 400 when preview file has no data rows', async () => {
    const app = createApp();
    mocks.parseExcelBuffer.mockResolvedValueOnce([]);

    const response = await request(app)
      .post('/api/upload/preview')
      .field('uploadType', 'dead_stock')
      .attach('file', Buffer.from('empty-xlsx'), {
        filename: 'empty.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'ファイルにデータがありません' });
  });

  it('returns 500 when preview throws unexpected error', async () => {
    const app = createApp();
    mocks.parseExcelBuffer.mockRejectedValueOnce(new Error('unexpected'));
    // The parseExcelRowsOrReject will catch and return 400 for parse errors.
    // To trigger the outer 500, we need the error to occur AFTER parsing.
    // Let's reset and make parsing succeed but detectHeaderRow throw.
    mocks.parseExcelBuffer.mockReset();
    mocks.parseExcelBuffer.mockResolvedValueOnce([['H1', 'H2'], ['D1', 'D2']]);
    mocks.detectHeaderRow.mockImplementationOnce(() => { throw new Error('unexpected crash'); });

    const response = await request(app)
      .post('/api/upload/preview')
      .field('uploadType', 'dead_stock')
      .attach('file', Buffer.from('dummy'), {
        filename: 'crash.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'ファイルの解析に失敗しました' });
  });

  it('returns 400 when auto mapping fails for resolved upload type', async () => {
    const app = createApp();
    // Make suggestMapping return a mapping without drug_name so parseMapping will throw
    mocks.suggestMapping.mockReturnValue({
      drug_code: null, drug_name: null, quantity: null,
      unit: null, yakka_unit_price: null, expiration_date: null, lot_number: null,
    });

    const response = await request(app)
      .post('/api/upload/preview')
      .attach('file', Buffer.from('dummy'), {
        filename: 'no-mapping.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: '医薬品列の自動判定に失敗しました。ファイルの見出しを確認してください。' });
  });
});

describe('upload-parser route coverage: diff-preview edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.parseExcelBuffer.mockResolvedValue([
      ['YJコード', '薬剤名', '月間使用量', '単位', '薬価'],
      ['1111111F1111', '薬A', 100, '錠', 10.2],
    ]);
    mocks.detectHeaderRow.mockReturnValue(0);
    mocks.computeHeaderHash.mockReturnValue('hash-2');
    mocks.suggestMapping.mockReturnValue({
      drug_code: '0', drug_name: '1', monthly_usage: '2',
      unit: '3', yakka_unit_price: '4',
    });
    mocks.extractUsedMedicationRows.mockReturnValue([{ drugName: '薬A', monthlyUsage: 100 }]);
    mocks.enrichWithDrugMaster.mockImplementation(async (rows: unknown[]) => rows);
    mocks.previewUsedMedicationDiff.mockResolvedValue({ inserted: 1, updated: 0, deactivated: 0, unchanged: 0, totalIncoming: 1 });
    mocks.getClientIp.mockReturnValue('127.0.0.1');

    mocks.db.select.mockImplementation(() => ({
      from: () => ({
        where: () => ({
          orderBy: async () => [],
          limit: async () => [],
        }),
      }),
    }));
  });

  it('returns 400 when diff-preview applyMode is not diff', async () => {
    const app = createApp();

    const response = await request(app)
      .post('/api/upload/diff-preview')
      .field('uploadType', 'used_medication')
      .field('headerRowIndex', '0')
      .field('applyMode', 'replace')
      .field('mapping', JSON.stringify({
        drug_code: '0', drug_name: '1', monthly_usage: '2',
        unit: '3', yakka_unit_price: '4',
      }))
      .attach('file', Buffer.from('dummy'), {
        filename: 'test.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: '差分プレビューは applyMode=diff のときのみ利用できます' });
  });

  it('returns 400 when diff-preview applyMode is invalid', async () => {
    const app = createApp();

    const response = await request(app)
      .post('/api/upload/diff-preview')
      .field('uploadType', 'used_medication')
      .field('headerRowIndex', '0')
      .field('applyMode', 'bogus')
      .field('mapping', JSON.stringify({
        drug_code: '0', drug_name: '1', monthly_usage: '2',
        unit: '3', yakka_unit_price: '4',
      }))
      .attach('file', Buffer.from('dummy'), {
        filename: 'test.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'applyMode は replace / diff / partial を指定してください' });
  });

  it('returns 400 when diff-preview headerRowIndex is out of range', async () => {
    const app = createApp();

    const response = await request(app)
      .post('/api/upload/diff-preview')
      .field('uploadType', 'dead_stock')
      .field('headerRowIndex', '999')
      .field('applyMode', 'diff')
      .field('mapping', VALID_MAPPING)
      .attach('file', Buffer.from('dummy'), {
        filename: 'test.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'ヘッダー行指定が不正です' });
  });

  it('returns 500 when diff-preview service throws unexpected error', async () => {
    const app = createApp();
    mocks.extractDeadStockRows.mockReturnValue([]);
    mocks.enrichWithDrugMaster.mockRejectedValueOnce(new Error('DB connection lost'));

    const response = await request(app)
      .post('/api/upload/diff-preview')
      .field('uploadType', 'dead_stock')
      .field('headerRowIndex', '0')
      .field('applyMode', 'diff')
      .field('mapping', VALID_MAPPING)
      .attach('file', Buffer.from('dummy'), {
        filename: 'test.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: '差分プレビューの生成に失敗しました' });
  });

  it('returns used_medication diff preview successfully', async () => {
    const app = createApp();

    const response = await request(app)
      .post('/api/upload/diff-preview')
      .field('uploadType', 'used_medication')
      .field('headerRowIndex', '0')
      .field('applyMode', 'diff')
      .field('deleteMissing', 'false')
      .field('mapping', JSON.stringify({
        drug_code: '0', drug_name: '1', monthly_usage: '2',
        unit: '3', yakka_unit_price: '4',
      }))
      .attach('file', Buffer.from('dummy'), {
        filename: 'used.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      applyMode: 'diff',
      uploadType: 'used_medication',
      deleteMissing: false,
    }));
    expect(mocks.previewUsedMedicationDiff).toHaveBeenCalledTimes(1);
  });
});

describe('upload-parser route coverage: jobs/:jobId/cancel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getClientIp.mockReturnValue('127.0.0.1');
  });

  it('returns 400 for invalid jobId on cancel', async () => {
    const app = createApp();

    const response = await request(app).post('/api/upload/jobs/abc/cancel');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'jobIdが不正です' });
  });

  it('returns 404 when job not found on cancel', async () => {
    const app = createApp();
    mocks.cancelUploadConfirmJobForPharmacy.mockResolvedValueOnce(null);

    const response = await request(app).post('/api/upload/jobs/999/cancel');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'ジョブが見つかりません' });
  });

  it('returns 409 when job cancel is not cancelable', async () => {
    const app = createApp();
    mocks.cancelUploadConfirmJobForPharmacy.mockResolvedValueOnce({
      canceledAt: null,
      cancelRequestedAt: null,
      cancelable: false,
      status: 'completed',
    });

    const response = await request(app).post('/api/upload/jobs/100/cancel');

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: 'このジョブはキャンセルできません' });
  });

  it('returns 409 when cancel request has race condition on cancelable job', async () => {
    const app = createApp();
    mocks.cancelUploadConfirmJobForPharmacy.mockResolvedValueOnce({
      canceledAt: null,
      cancelRequestedAt: null,
      cancelable: true,
      status: 'processing',
    });

    const response = await request(app).post('/api/upload/jobs/100/cancel');

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: 'キャンセル要求の反映で競合しました。再度お試しください' });
  });

  it('returns success when cancel request is accepted (deferred)', async () => {
    const app = createApp();
    mocks.cancelUploadConfirmJobForPharmacy.mockResolvedValueOnce({
      canceledAt: null,
      cancelRequestedAt: '2026-03-01T00:00:00.000Z',
      cancelable: true,
      status: 'processing',
    });

    const response = await request(app).post('/api/upload/jobs/100/cancel');

    expect(response.status).toBe(200);
    expect(response.body.message).toBe('ジョブのキャンセルを受け付けました');
    expect(response.body.cancelRequestedAt).toBe('2026-03-01T00:00:00.000Z');
  });

  it('returns success when job is immediately canceled', async () => {
    const app = createApp();
    mocks.cancelUploadConfirmJobForPharmacy.mockResolvedValueOnce({
      canceledAt: '2026-03-01T00:00:00.000Z',
      cancelRequestedAt: '2026-03-01T00:00:00.000Z',
      cancelable: false,
      status: 'canceled',
    });

    const response = await request(app).post('/api/upload/jobs/100/cancel');

    expect(response.status).toBe(200);
    expect(response.body.message).toBe('ジョブをキャンセルしました');
    expect(response.body.status).toBe('canceled');
  });

  it('returns 500 when cancel throws unexpected error', async () => {
    const app = createApp();
    mocks.cancelUploadConfirmJobForPharmacy.mockRejectedValueOnce(new Error('DB down'));

    const response = await request(app).post('/api/upload/jobs/100/cancel');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'ジョブのキャンセルに失敗しました' });
  });
});

describe('upload-parser route coverage: jobs/:jobId/error-report', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getClientIp.mockReturnValue('127.0.0.1');
  });

  it('returns 400 for invalid jobId on error-report', async () => {
    const app = createApp();

    const response = await request(app).get('/api/upload/jobs/abc/error-report');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'jobIdが不正です' });
  });

  it('returns 404 when job not found on error-report', async () => {
    const app = createApp();
    mocks.getUploadConfirmJobForPharmacy.mockResolvedValueOnce(null);

    const response = await request(app).get('/api/upload/jobs/999/error-report');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'ジョブが見つかりません' });
  });

  it('returns 404 when no issues exist for the job', async () => {
    const app = createApp();
    mocks.getUploadConfirmJobForPharmacy.mockResolvedValueOnce({
      id: 100, pharmacyId: 1, status: 'completed', issueCount: 0,
    });
    mocks.getUploadRowIssuesForJob.mockResolvedValueOnce([]);

    const response = await request(app).get('/api/upload/jobs/100/error-report');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'エラーレポートがありません' });
  });

  it('returns JSON error report when format=json', async () => {
    const app = createApp();
    const issues = [
      { rowNumber: 2, issueCode: 'MISSING_DRUG_NAME', message: '薬剤名が空です' },
    ];
    const summary = { total: 1, byCodes: { MISSING_DRUG_NAME: 1 } };
    mocks.getUploadConfirmJobForPharmacy.mockResolvedValueOnce({
      id: 100, pharmacyId: 1, status: 'completed', issueCount: 1,
    });
    mocks.getUploadRowIssuesForJob.mockResolvedValueOnce(issues);
    mocks.getUploadRowIssueSummary.mockResolvedValueOnce(summary);

    const response = await request(app).get('/api/upload/jobs/100/error-report?format=json');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: issues, summary });
  });

  it('returns CSV error report by default', async () => {
    const app = createApp();
    const issues = [
      { rowNumber: 2, issueCode: 'MISSING_DRUG_NAME' },
    ];
    mocks.getUploadConfirmJobForPharmacy.mockResolvedValueOnce({
      id: 100, pharmacyId: 1, status: 'completed', issueCount: 1,
    });
    mocks.getUploadRowIssuesForJob.mockResolvedValueOnce(issues);
    mocks.buildUploadRowIssueCsv.mockReturnValueOnce('rowNumber,issueCode\n2,MISSING_DRUG_NAME');

    const response = await request(app).get('/api/upload/jobs/100/error-report');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.headers['content-disposition']).toContain('upload-job-100-error-report.csv');
    expect(response.text).toContain('MISSING_DRUG_NAME');
  });

  it('returns 500 when error-report throws unexpected error', async () => {
    const app = createApp();
    mocks.getUploadConfirmJobForPharmacy.mockRejectedValueOnce(new Error('DB error'));

    const response = await request(app).get('/api/upload/jobs/100/error-report');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'エラーレポートの取得に失敗しました' });
  });
});

describe('upload-parser route coverage: jobs/:jobId status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getClientIp.mockReturnValue('127.0.0.1');
  });

  it('returns 400 for invalid jobId on status', async () => {
    const app = createApp();

    const response = await request(app).get('/api/upload/jobs/0');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'jobIdが不正です' });
  });

  it('returns 404 when job not found on status', async () => {
    const app = createApp();
    mocks.getUploadConfirmJobForPharmacy.mockResolvedValueOnce(null);

    const response = await request(app).get('/api/upload/jobs/999');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'ジョブが見つかりません' });
  });

  it('maps cancel-requested job to canceled status', async () => {
    const app = createApp();
    mocks.getUploadConfirmJobForPharmacy.mockResolvedValueOnce({
      id: 200, pharmacyId: 1, status: 'processing', attempts: 1,
      lastError: null, resultJson: null,
      deduplicated: false, cancelable: false,
      canceledAt: null, cancelRequestedAt: '2026-03-01T00:00:00.000Z',
      createdAt: '2026-03-01T00:00:00.000Z',
      updatedAt: '2026-03-01T00:00:00.000Z',
      completedAt: null, issueCount: 0,
    });

    const response = await request(app).get('/api/upload/jobs/200');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('canceled');
  });

  it('maps FILE_LIMIT_EXCEEDED error code correctly', async () => {
    const app = createApp();
    mocks.getUploadConfirmJobForPharmacy.mockResolvedValueOnce({
      id: 201, pharmacyId: 1, status: 'failed', attempts: 1,
      lastError: 'ファイル行数が上限(50000)を超えています',
      resultJson: null,
      deduplicated: false, cancelable: false,
      canceledAt: null, cancelRequestedAt: null,
      createdAt: '2026-03-01T00:00:00.000Z',
      updatedAt: '2026-03-01T00:00:00.000Z',
      completedAt: null, issueCount: 0,
    });

    const response = await request(app).get('/api/upload/jobs/201');

    expect(response.status).toBe(200);
    expect(response.body.lastErrorCode).toBe('FILE_LIMIT_EXCEEDED');
    expect(response.body.lastError).toBe('アップロードファイルを解析できませんでした。ファイル形式と内容を確認してください。');
  });

  it('maps ヘッダー行指定が不正 error correctly', async () => {
    const app = createApp();
    mocks.getUploadConfirmJobForPharmacy.mockResolvedValueOnce({
      id: 202, pharmacyId: 1, status: 'failed', attempts: 1,
      lastError: 'ヘッダー行指定が不正: index=100 は範囲外',
      resultJson: null,
      deduplicated: false, cancelable: false,
      canceledAt: null, cancelRequestedAt: null,
      createdAt: '2026-03-01T00:00:00.000Z',
      updatedAt: '2026-03-01T00:00:00.000Z',
      completedAt: null, issueCount: 0,
    });

    const response = await request(app).get('/api/upload/jobs/202');

    expect(response.status).toBe(200);
    expect(response.body.lastErrorCode).toBe('HEADER_ROW_INVALID');
  });

  it('maps FILE_PARSE_FAILED error code for ファイルの解析', async () => {
    const app = createApp();
    mocks.getUploadConfirmJobForPharmacy.mockResolvedValueOnce({
      id: 203, pharmacyId: 1, status: 'failed', attempts: 1,
      lastError: 'ファイルの解析に失敗しました',
      resultJson: null,
      deduplicated: false, cancelable: false,
      canceledAt: null, cancelRequestedAt: null,
      createdAt: '2026-03-01T00:00:00.000Z',
      updatedAt: '2026-03-01T00:00:00.000Z',
      completedAt: null, issueCount: 0,
    });

    const response = await request(app).get('/api/upload/jobs/203');

    expect(response.status).toBe(200);
    expect(response.body.lastErrorCode).toBe('FILE_PARSE_FAILED');
  });

  it('maps JOB_CANCELED error code for キャンセル', async () => {
    const app = createApp();
    mocks.getUploadConfirmJobForPharmacy.mockResolvedValueOnce({
      id: 204, pharmacyId: 1, status: 'failed', attempts: 1,
      lastError: 'ジョブはキャンセルされました',
      resultJson: null,
      deduplicated: false, cancelable: false,
      canceledAt: null, cancelRequestedAt: null,
      createdAt: '2026-03-01T00:00:00.000Z',
      updatedAt: '2026-03-01T00:00:00.000Z',
      completedAt: null, issueCount: 0,
    });

    const response = await request(app).get('/api/upload/jobs/204');

    expect(response.status).toBe(200);
    expect(response.body.lastErrorCode).toBe('JOB_CANCELED');
    expect(response.body.lastError).toBe('このジョブは管理者によりキャンセルされました。');
  });

  it('falls back to UPLOAD_CONFIRM_FAILED for unknown errors', async () => {
    const app = createApp();
    mocks.getUploadConfirmJobForPharmacy.mockResolvedValueOnce({
      id: 205, pharmacyId: 1, status: 'failed', attempts: 1,
      lastError: 'some obscure internal error message',
      resultJson: null,
      deduplicated: false, cancelable: false,
      canceledAt: null, cancelRequestedAt: null,
      createdAt: '2026-03-01T00:00:00.000Z',
      updatedAt: '2026-03-01T00:00:00.000Z',
      completedAt: null, issueCount: 0,
    });

    const response = await request(app).get('/api/upload/jobs/205');

    expect(response.status).toBe(200);
    expect(response.body.lastErrorCode).toBe('UPLOAD_CONFIRM_FAILED');
    expect(response.body.lastError).toBe('アップロード処理に失敗しました。時間をおいて再実行してください。');
  });

  it('returns 500 when job status check throws unexpected error', async () => {
    const app = createApp();
    mocks.getUploadConfirmJobForPharmacy.mockRejectedValueOnce(new Error('connection error'));

    const response = await request(app).get('/api/upload/jobs/100');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'ジョブ状態の取得に失敗しました' });
  });

  it('handles malformed resultJson gracefully', async () => {
    const app = createApp();
    mocks.getUploadConfirmJobForPharmacy.mockResolvedValueOnce({
      id: 206, pharmacyId: 1, status: 'completed', attempts: 1,
      lastError: null, resultJson: '{bad-json}',
      deduplicated: false, cancelable: false,
      canceledAt: null, cancelRequestedAt: null,
      createdAt: '2026-03-01T00:00:00.000Z',
      updatedAt: '2026-03-01T00:00:00.000Z',
      completedAt: '2026-03-01T00:00:00.000Z',
      issueCount: 0,
    });

    const response = await request(app).get('/api/upload/jobs/206');

    expect(response.status).toBe(200);
    expect(response.body.result).toBe(null);
    expect(response.body.partialSummary).toBe(null);
    expect(response.body.errorReportAvailable).toBe(false);
  });

  it('detects errorReportAvailable from errorReportAvailable flag in result', async () => {
    const app = createApp();
    mocks.getUploadConfirmJobForPharmacy.mockResolvedValueOnce({
      id: 207, pharmacyId: 1, status: 'completed', attempts: 1,
      lastError: null,
      resultJson: JSON.stringify({ errorReportAvailable: true }),
      deduplicated: false, cancelable: false,
      canceledAt: null, cancelRequestedAt: null,
      createdAt: '2026-03-01T00:00:00.000Z',
      updatedAt: '2026-03-01T00:00:00.000Z',
      completedAt: '2026-03-01T00:00:00.000Z',
      issueCount: 0,
    });

    const response = await request(app).get('/api/upload/jobs/207');

    expect(response.status).toBe(200);
    expect(response.body.errorReportAvailable).toBe(true);
  });
});

describe('upload-parser route coverage: confirm headerRowIndex out of range', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.parseExcelBuffer.mockResolvedValue([
      ['YJコード', '薬剤名', '数量'],
      ['1111111F1111', '薬A', 10],
    ]);
    mocks.getClientIp.mockReturnValue('127.0.0.1');
    mocks.isUploadConfirmQueueLimitError.mockReturnValue(false);
    mocks.isUploadConfirmIdempotencyConflictError.mockReturnValue(false);

    mocks.db.select.mockImplementation(() => ({
      from: () => ({
        where: () => ({
          orderBy: async () => [],
          limit: async () => [],
          groupBy: async () => [],
        }),
      }),
    }));
  });

  it('returns 400 when confirm-async headerRowIndex exceeds row count', async () => {
    const app = createApp();

    const response = await request(app)
      .post('/api/upload/confirm-async')
      .field('uploadType', 'dead_stock')
      .field('headerRowIndex', '999')
      .field('applyMode', 'replace')
      .field('mapping', VALID_MAPPING)
      .attach('file', Buffer.from('dummy'), {
        filename: 'test.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'ヘッダー行指定が不正です' });
  });
});
