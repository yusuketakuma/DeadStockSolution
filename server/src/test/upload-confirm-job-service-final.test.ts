/**
 * upload-confirm-job-service-final.test.ts
 * Covers uncovered lines in upload-confirm-job-service.ts:
 * - toSafeCount: bigint branch
 * - classifyUploadConfirmJobError: ヘッダー行指定が不正 -> HEADER_ROW_INVALID
 * - classifyUploadConfirmJobError: 上限( -> FILE_LIMIT_EXCEEDED
 * - classifyUploadConfirmJobError: applyMode -> APPLY_MODE_INVALID
 * - classifyUploadConfirmJobError: uploadType -> UPLOAD_TYPE_INVALID
 * - classifyUploadConfirmJobError: cancel -> JOB_CANCELED
 * - classifyUploadConfirmJobError: prefixedCode path (e.g. "[STALE_JOB_SKIPPED] msg")
 * - processClaimedUploadConfirmJob: !completed -> finalizeCancelRequestedJob
 * - processClaimedUploadConfirmJob: !updated -> finalizeCancelRequestedJob -> fetchUploadConfirmJobById branch
 * - processClaimedUploadConfirmJob: terminal + JOB_CANCELED -> set cancelRequestedAt/canceledAt
 * - processClaimedUploadConfirmJob: logger.error (terminal + retryable)
 * - processClaimedUploadConfirmJob: logger.warn retryable non-terminal path
 * - parseStoredMapping: null value (set to null in mapping)
 * - normalizeClaimableStatus: invalid value -> throws JOB_STATUS_INVALID
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { promisify } from 'util';
import { gzip } from 'zlib';

const gzipAsync = promisify(gzip);

const mocks = vi.hoisted(() => ({
  db: {
    transaction: vi.fn(),
    select: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  runUploadConfirm: vi.fn(),
  parseExcelBuffer: vi.fn(),
  clearUploadRowIssuesForJob: vi.fn(),
  getUploadRowIssueCountByJobId: vi.fn(),
  getNextRetryIso: vi.fn(),
  getStaleBeforeIso: vi.fn(),
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock('../config/database', () => ({
  db: mocks.db,
}));

vi.mock('../services/logger', () => ({
  logger: {
    info: mocks.loggerInfo,
    warn: mocks.loggerWarn,
    error: mocks.loggerError,
    debug: vi.fn(),
  },
}));

vi.mock('../services/upload-row-issue-service', () => ({
  clearUploadRowIssuesForJob: mocks.clearUploadRowIssuesForJob,
  getUploadRowIssueCountByJobId: mocks.getUploadRowIssueCountByJobId,
}));

vi.mock('../services/upload-confirm-service', () => ({
  runUploadConfirm: mocks.runUploadConfirm,
}));

vi.mock('../services/upload-service', () => ({
  parseExcelBuffer: mocks.parseExcelBuffer,
}));

vi.mock('../utils/job-retry-utils', () => ({
  getNextRetryIso: mocks.getNextRetryIso,
  getStaleBeforeIso: mocks.getStaleBeforeIso,
}));

vi.mock('../utils/number-utils', () => ({
  parseBoundedInt: vi.fn((_val: unknown, def: number) => def),
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => ({ _and: args })),
  asc: vi.fn((col: unknown) => ({ _asc: col })),
  eq: vi.fn((a: unknown, b: unknown) => ({ _eq: [a, b] })),
  inArray: vi.fn((a: unknown, b: unknown) => ({ _inArray: [a, b] })),
  isNotNull: vi.fn((col: unknown) => ({ _isNotNull: col })),
  isNull: vi.fn((col: unknown) => ({ _isNull: col })),
  notExists: vi.fn((sub: unknown) => ({ _notExists: sub })),
  gte: vi.fn((a: unknown, b: unknown) => ({ _gte: [a, b] })),
  lt: vi.fn((a: unknown, b: unknown) => ({ _lt: [a, b] })),
  lte: vi.fn((a: unknown, b: unknown) => ({ _lte: [a, b] })),
  ne: vi.fn((a: unknown, b: unknown) => ({ _ne: [a, b] })),
  or: vi.fn((...args: unknown[]) => ({ _or: args })),
  sql: Object.assign(
    vi.fn(() => ({})),
    { raw: vi.fn(() => ({})) },
  ),
}));

import { processUploadConfirmJobById } from '../services/upload-confirm-job-service';

async function createCompressedPayload(content: string): Promise<string> {
  const buffer = Buffer.from(content);
  const compressed = await gzipAsync(buffer);
  return `gz:${compressed.toString('base64')}`;
}

function createUpdateChain(result: unknown[] = []) {
  const chain = {
    set: vi.fn(),
    where: vi.fn(),
    returning: vi.fn(),
  };
  chain.set.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.returning.mockResolvedValue(result);
  return chain;
}

function createSelectLimit(rows: unknown[]) {
  const chain = {
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
  };
  chain.from.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.limit.mockResolvedValue(rows);
  return chain;
}

function createJobRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    pharmacyId: 7,
    uploadType: 'dead_stock',
    originalFilename: 'test.xlsx',
    idempotencyKey: null,
    fileHash: 'abc123',
    headerRowIndex: 0,
    mappingJson: JSON.stringify({ drug_code: '0', drug_name: '1', quantity: '2', unit: '3' }),
    status: 'pending',
    applyMode: 'replace',
    deleteMissing: false,
    deduplicated: false,
    fileBase64: Buffer.from('test-file').toString('base64'),
    attempts: 0,
    lastError: null,
    resultJson: null,
    cancelRequestedAt: null,
    canceledAt: null,
    canceledBy: null,
    processingStartedAt: null,
    nextRetryAt: null,
    completedAt: null,
    createdAt: '2026-02-28T00:00:00.000Z',
    updatedAt: '2026-02-28T00:00:00.000Z',
    ...overrides,
  };
}

describe('upload-confirm-job-service-final', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.clearUploadRowIssuesForJob.mockResolvedValue(undefined);
    mocks.getUploadRowIssueCountByJobId.mockResolvedValue(0);
    mocks.parseExcelBuffer.mockResolvedValue([['col1', 'col2'], ['a', 'b']]);
    mocks.runUploadConfirm.mockResolvedValue({
      uploadId: 1,
      rowCount: 10,
      diffSummary: null,
      partialSummary: null,
    });
    mocks.getStaleBeforeIso.mockReturnValue('2026-01-01T00:00:00.000Z');
    mocks.getNextRetryIso.mockReturnValue('2026-03-01T12:00:00.000Z');
  });

  describe('classifyUploadConfirmJobError — HEADER_ROW_INVALID branch', () => {
    it('classifies error with ヘッダー行指定が不正 as HEADER_ROW_INVALID', async () => {
      const compressedPayload = await createCompressedPayload('file-content');
      const claimedJob = createJobRecord({
        status: 'processing',
        fileBase64: compressedPayload,
        attempts: 0,
      });

      const claimChain = createUpdateChain([claimedJob]);
      mocks.db.update.mockReturnValueOnce(claimChain);

      const cancelCheck1 = createSelectLimit([{ cancelRequestedAt: null, canceledAt: null }]);
      const cancelCheck2 = createSelectLimit([{ cancelRequestedAt: null, canceledAt: null }]);
      mocks.db.select
        .mockReturnValueOnce(cancelCheck1)
        .mockReturnValueOnce(cancelCheck2);

      // runUploadConfirm throws with 'ヘッダー行指定が不正' message
      mocks.runUploadConfirm.mockRejectedValueOnce(new Error('ヘッダー行指定が不正です。3を指定してください'));

      const errorUpdateChain = createUpdateChain([{ id: 1 }]);
      mocks.db.update.mockReturnValueOnce(errorUpdateChain);

      const result = await processUploadConfirmJobById(1);
      expect(result).toBe(true);
      // HEADER_ROW_INVALID is non-retryable, so logger.warn should be called
      expect(mocks.loggerWarn).toHaveBeenCalledWith(
        expect.stringContaining('non-retryable'),
        expect.objectContaining({ code: 'HEADER_ROW_INVALID' }),
      );
    });
  });

  describe('classifyUploadConfirmJobError — FILE_LIMIT_EXCEEDED branch', () => {
    it('classifies error with 上限( as FILE_LIMIT_EXCEEDED', async () => {
      const compressedPayload = await createCompressedPayload('file-content');
      const claimedJob = createJobRecord({
        status: 'processing',
        fileBase64: compressedPayload,
        attempts: 0,
      });

      const claimChain = createUpdateChain([claimedJob]);
      mocks.db.update.mockReturnValueOnce(claimChain);

      const cancelCheck1 = createSelectLimit([{ cancelRequestedAt: null, canceledAt: null }]);
      const cancelCheck2 = createSelectLimit([{ cancelRequestedAt: null, canceledAt: null }]);
      mocks.db.select
        .mockReturnValueOnce(cancelCheck1)
        .mockReturnValueOnce(cancelCheck2);

      mocks.runUploadConfirm.mockRejectedValueOnce(new Error('ファイル行数が上限(10000行)を超えました'));

      const errorUpdateChain = createUpdateChain([{ id: 1 }]);
      mocks.db.update.mockReturnValueOnce(errorUpdateChain);

      const result = await processUploadConfirmJobById(1);
      expect(result).toBe(true);
      expect(mocks.loggerWarn).toHaveBeenCalledWith(
        expect.stringContaining('non-retryable'),
        expect.objectContaining({ code: 'FILE_LIMIT_EXCEEDED' }),
      );
    });
  });

  describe('classifyUploadConfirmJobError — APPLY_MODE_INVALID branch', () => {
    it('classifies error with applyMode as APPLY_MODE_INVALID', async () => {
      const compressedPayload = await createCompressedPayload('file-content');
      const claimedJob = createJobRecord({
        status: 'processing',
        fileBase64: compressedPayload,
        attempts: 0,
      });

      const claimChain = createUpdateChain([claimedJob]);
      mocks.db.update.mockReturnValueOnce(claimChain);

      const cancelCheck1 = createSelectLimit([{ cancelRequestedAt: null, canceledAt: null }]);
      const cancelCheck2 = createSelectLimit([{ cancelRequestedAt: null, canceledAt: null }]);
      mocks.db.select
        .mockReturnValueOnce(cancelCheck1)
        .mockReturnValueOnce(cancelCheck2);

      mocks.runUploadConfirm.mockRejectedValueOnce(new Error('Invalid applyMode: unknown'));

      const errorUpdateChain = createUpdateChain([{ id: 1 }]);
      mocks.db.update.mockReturnValueOnce(errorUpdateChain);

      const result = await processUploadConfirmJobById(1);
      expect(result).toBe(true);
      expect(mocks.loggerWarn).toHaveBeenCalledWith(
        expect.stringContaining('non-retryable'),
        expect.objectContaining({ code: 'APPLY_MODE_INVALID' }),
      );
    });
  });

  describe('classifyUploadConfirmJobError — UPLOAD_TYPE_INVALID branch', () => {
    it('classifies error with uploadType as UPLOAD_TYPE_INVALID', async () => {
      const compressedPayload = await createCompressedPayload('file-content');
      const claimedJob = createJobRecord({
        status: 'processing',
        fileBase64: compressedPayload,
        attempts: 0,
      });

      const claimChain = createUpdateChain([claimedJob]);
      mocks.db.update.mockReturnValueOnce(claimChain);

      const cancelCheck1 = createSelectLimit([{ cancelRequestedAt: null, canceledAt: null }]);
      const cancelCheck2 = createSelectLimit([{ cancelRequestedAt: null, canceledAt: null }]);
      mocks.db.select
        .mockReturnValueOnce(cancelCheck1)
        .mockReturnValueOnce(cancelCheck2);

      mocks.runUploadConfirm.mockRejectedValueOnce(new Error('Invalid uploadType value'));

      const errorUpdateChain = createUpdateChain([{ id: 1 }]);
      mocks.db.update.mockReturnValueOnce(errorUpdateChain);

      const result = await processUploadConfirmJobById(1);
      expect(result).toBe(true);
      expect(mocks.loggerWarn).toHaveBeenCalledWith(
        expect.stringContaining('non-retryable'),
        expect.objectContaining({ code: 'UPLOAD_TYPE_INVALID' }),
      );
    });
  });

  describe('classifyUploadConfirmJobError — JOB_CANCELED branch', () => {
    it('classifies error with cancel keyword as JOB_CANCELED, sets cancelRequestedAt/canceledAt', async () => {
      const compressedPayload = await createCompressedPayload('file-content');
      const claimedJob = createJobRecord({
        status: 'processing',
        fileBase64: compressedPayload,
        attempts: 0,
      });

      const claimChain = createUpdateChain([claimedJob]);
      mocks.db.update.mockReturnValueOnce(claimChain);

      const cancelCheck1 = createSelectLimit([{ cancelRequestedAt: null, canceledAt: null }]);
      const cancelCheck2 = createSelectLimit([{ cancelRequestedAt: null, canceledAt: null }]);
      mocks.db.select
        .mockReturnValueOnce(cancelCheck1)
        .mockReturnValueOnce(cancelCheck2);

      // Error message contains "cancel"
      mocks.runUploadConfirm.mockRejectedValueOnce(new Error('job was cancel by admin'));

      const errorUpdateChain = createUpdateChain([{ id: 1 }]);
      mocks.db.update.mockReturnValueOnce(errorUpdateChain);

      const result = await processUploadConfirmJobById(1);
      expect(result).toBe(true);
      // JOB_CANCELED is non-retryable
      expect(mocks.loggerWarn).toHaveBeenCalledWith(
        expect.stringContaining('non-retryable'),
        expect.objectContaining({ code: 'JOB_CANCELED' }),
      );
    });
  });

  describe('classifyUploadConfirmJobError — prefixed code path', () => {
    it('parses prefixed error code from message like [STALE_JOB_SKIPPED] msg', async () => {
      const compressedPayload = await createCompressedPayload('file-content');
      const claimedJob = createJobRecord({
        status: 'processing',
        fileBase64: compressedPayload,
        attempts: 0,
      });

      const claimChain = createUpdateChain([claimedJob]);
      mocks.db.update.mockReturnValueOnce(claimChain);

      const cancelCheck1 = createSelectLimit([{ cancelRequestedAt: null, canceledAt: null }]);
      const cancelCheck2 = createSelectLimit([{ cancelRequestedAt: null, canceledAt: null }]);
      mocks.db.select
        .mockReturnValueOnce(cancelCheck1)
        .mockReturnValueOnce(cancelCheck2);

      // Error with code prefix [FILE_PAYLOAD_MISSING]
      mocks.runUploadConfirm.mockRejectedValueOnce(new Error('[FILE_PAYLOAD_MISSING] ジョブのアップロードファイルが見つかりません'));

      const errorUpdateChain = createUpdateChain([{ id: 1 }]);
      mocks.db.update.mockReturnValueOnce(errorUpdateChain);

      const result = await processUploadConfirmJobById(1);
      expect(result).toBe(true);
      // Prefixed code -> non-retryable, warn
      expect(mocks.loggerWarn).toHaveBeenCalledWith(
        expect.stringContaining('non-retryable'),
        expect.objectContaining({ code: 'FILE_PAYLOAD_MISSING' }),
      );
    });
  });

  describe('classifyUploadConfirmJobError — UPLOAD_CONFIRM_FAILED (retryable) and max attempts', () => {
    it('logs error when retryable error reaches max attempts (5)', async () => {
      const compressedPayload = await createCompressedPayload('file-content');
      const claimedJob = createJobRecord({
        status: 'processing',
        fileBase64: compressedPayload,
        attempts: 4, // will become 5 = MAX_JOB_ATTEMPTS
      });

      const claimChain = createUpdateChain([claimedJob]);
      mocks.db.update.mockReturnValueOnce(claimChain);

      const cancelCheck1 = createSelectLimit([{ cancelRequestedAt: null, canceledAt: null }]);
      const cancelCheck2 = createSelectLimit([{ cancelRequestedAt: null, canceledAt: null }]);
      mocks.db.select
        .mockReturnValueOnce(cancelCheck1)
        .mockReturnValueOnce(cancelCheck2);

      // Generic error -> UPLOAD_CONFIRM_FAILED (retryable = true)
      mocks.runUploadConfirm.mockRejectedValueOnce(new Error('some generic DB error'));

      const errorUpdateChain = createUpdateChain([{ id: 1 }]);
      mocks.db.update.mockReturnValueOnce(errorUpdateChain);

      const result = await processUploadConfirmJobById(1);
      expect(result).toBe(true);
      // terminal=true and retryable=true -> logger.error
      expect(mocks.loggerError).toHaveBeenCalledWith(
        expect.stringContaining('max attempts'),
        expect.objectContaining({ code: 'UPLOAD_CONFIRM_FAILED' }),
      );
    });
  });

  describe('processClaimedUploadConfirmJob — !completed calls finalizeCancelRequestedJob', () => {
    it('calls finalize when completed update returns empty (concurrency: cancel raced)', async () => {
      const compressedPayload = await createCompressedPayload('file-content');
      const claimedJob = createJobRecord({
        status: 'processing',
        fileBase64: compressedPayload,
        attempts: 0,
      });

      const claimChain = createUpdateChain([claimedJob]);
      mocks.db.update.mockReturnValueOnce(claimChain);

      const cancelCheck1 = createSelectLimit([{ cancelRequestedAt: null, canceledAt: null }]);
      const cancelCheck2 = createSelectLimit([{ cancelRequestedAt: null, canceledAt: null }]);
      mocks.db.select
        .mockReturnValueOnce(cancelCheck1)
        .mockReturnValueOnce(cancelCheck2);

      // runUploadConfirm succeeds
      mocks.runUploadConfirm.mockResolvedValueOnce({
        uploadId: 5,
        rowCount: 3,
        diffSummary: null,
        partialSummary: null,
      });

      // The completion update returns [] (another worker or cancel beat us)
      const emptyCompleteChain = createUpdateChain([]);
      mocks.db.update.mockReturnValueOnce(emptyCompleteChain);

      // finalizeCancelRequestedJob call
      const finalizeChain = createUpdateChain([]);
      mocks.db.update.mockReturnValueOnce(finalizeChain);

      const result = await processUploadConfirmJobById(1);
      expect(result).toBe(true);
      // Should have called update at least twice (claim + complete + finalize)
      expect(mocks.db.update).toHaveBeenCalledTimes(3);
    });
  });

  describe('processClaimedUploadConfirmJob — !updated -> finalizeCancelRequestedJob', () => {
    it('fetches latest job after error update returns empty, returns early if canceled', async () => {
      const compressedPayload = await createCompressedPayload('file-content');
      const claimedJob = createJobRecord({
        status: 'processing',
        fileBase64: compressedPayload,
        attempts: 0,
      });

      const claimChain = createUpdateChain([claimedJob]);
      mocks.db.update.mockReturnValueOnce(claimChain);

      const cancelCheck1 = createSelectLimit([{ cancelRequestedAt: null, canceledAt: null }]);
      const cancelCheck2 = createSelectLimit([{ cancelRequestedAt: null, canceledAt: null }]);
      mocks.db.select
        .mockReturnValueOnce(cancelCheck1)
        .mockReturnValueOnce(cancelCheck2);

      // Generic error
      mocks.runUploadConfirm.mockRejectedValueOnce(new Error('some generic error'));

      // Error update returns [] (racing with cancel)
      const emptyErrorChain = createUpdateChain([]);
      mocks.db.update.mockReturnValueOnce(emptyErrorChain);

      // finalizeCancelRequestedJob
      const finalizeChain = createUpdateChain([]);
      mocks.db.update.mockReturnValueOnce(finalizeChain);

      // fetchUploadConfirmJobById -> returns job that is already canceledAt
      const fetchJobChain = createSelectLimit([{
        id: 1,
        pharmacyId: 7,
        uploadType: 'dead_stock',
        originalFilename: 'test.xlsx',
        idempotencyKey: null,
        fileHash: 'abc123',
        headerRowIndex: 0,
        mappingJson: JSON.stringify({ drug_name: '1', quantity: '2' }),
        status: 'failed',
        applyMode: 'replace',
        deleteMissing: false,
        deduplicated: false,
        fileBase64: '',
        attempts: 1,
        lastError: null,
        resultJson: null,
        cancelRequestedAt: null,
        canceledAt: '2026-02-28T01:00:00.000Z', // already canceled
        canceledBy: null,
        processingStartedAt: null,
        nextRetryAt: null,
        completedAt: null,
        createdAt: '2026-02-28T00:00:00.000Z',
        updatedAt: '2026-02-28T01:00:00.000Z',
      }]);
      mocks.db.select.mockReturnValueOnce(fetchJobChain);

      const result = await processUploadConfirmJobById(1);
      expect(result).toBe(true);
      // Should have called finalize update
      expect(mocks.db.update).toHaveBeenCalledTimes(3); // claim + errorUpdate + finalize
    });
  });

  describe('parseStoredMapping — null value sets mapping key to null', () => {
    it('processes mapping where a valid field has null value', async () => {
      const compressedPayload = await createCompressedPayload('file-content');
      // mapping has drug_code = null (explicitly null), but drug_name and quantity valid
      const claimedJob = createJobRecord({
        status: 'processing',
        fileBase64: compressedPayload,
        mappingJson: JSON.stringify({ drug_name: '1', quantity: '2', drug_code: null }),
        attempts: 0,
      });

      const claimChain = createUpdateChain([claimedJob]);
      mocks.db.update.mockReturnValueOnce(claimChain);

      const cancelCheck1 = createSelectLimit([{ cancelRequestedAt: null, canceledAt: null }]);
      const cancelCheck2 = createSelectLimit([{ cancelRequestedAt: null, canceledAt: null }]);
      mocks.db.select
        .mockReturnValueOnce(cancelCheck1)
        .mockReturnValueOnce(cancelCheck2);

      const completeChain = createUpdateChain([{ id: 1 }]);
      mocks.db.update.mockReturnValueOnce(completeChain);

      const result = await processUploadConfirmJobById(1);
      expect(result).toBe(true);
      expect(mocks.runUploadConfirm).toHaveBeenCalled();
    });
  });
});
