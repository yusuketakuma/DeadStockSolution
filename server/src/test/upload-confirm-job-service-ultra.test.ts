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

import {
  enqueueUploadConfirmJob,
  processUploadConfirmJobById,
  processPendingUploadConfirmJobs,
  getUploadConfirmJobById,
  cancelUploadConfirmJobByAdmin,
  cancelUploadConfirmJobForPharmacy,
  retryUploadConfirmJobByAdmin,
  cleanupUploadConfirmJobs,
  ensureUploadConfirmQueueHasCapacity,
} from '../services/upload-confirm-job-service';

function createCountSelectChain(count: number) {
  const query = {
    from: vi.fn(),
    where: vi.fn(),
  };
  query.from.mockReturnValue(query);
  query.where.mockResolvedValue([{ count }]);
  return query;
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

function createDeleteChain() {
  return {
    where: vi.fn().mockResolvedValue(undefined),
  };
}

async function createCompressedPayload(content: string): Promise<string> {
  const buffer = Buffer.from(content);
  const compressed = await gzipAsync(buffer);
  return `gz:${compressed.toString('base64')}`;
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

describe('upload-confirm-job-service-ultra', () => {
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
  });

  // ── processUploadConfirmJobById: uncompressed base64 file payload ──
  describe('processUploadConfirmJobById with uncompressed payload', () => {
    it('processes a job with uncompressed base64 file payload', async () => {
      // File payload without gz: prefix triggers the base64 fallback path
      const plainBase64 = Buffer.from('excel-content').toString('base64');
      const claimedJob = createJobRecord({
        status: 'processing',
        fileBase64: plainBase64,
      });

      const claimChain = createUpdateChain([claimedJob]);
      mocks.db.update.mockReturnValueOnce(claimChain);

      const cancelCheck1 = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([{ cancelRequestedAt: null, canceledAt: null }]),
      };
      const cancelCheck2 = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([{ cancelRequestedAt: null, canceledAt: null }]),
      };
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

  // ── processUploadConfirmJobById: empty gz: payload ──
  describe('processUploadConfirmJobById with empty gz: payload', () => {
    it('handles gz: prefix with no content as FILE_PAYLOAD_MISSING', async () => {
      const claimedJob = createJobRecord({
        status: 'processing',
        fileBase64: 'gz:', // gz: prefix but no base64 content
        attempts: 0,
      });

      const claimChain = createUpdateChain([claimedJob]);
      mocks.db.update.mockReturnValueOnce(claimChain);

      const cancelCheck = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([{ cancelRequestedAt: null, canceledAt: null }]),
      };
      mocks.db.select.mockReturnValueOnce(cancelCheck);

      const errorUpdateChain = createUpdateChain([{ id: 1 }]);
      mocks.db.update.mockReturnValueOnce(errorUpdateChain);

      const result = await processUploadConfirmJobById(1);
      expect(result).toBe(true);
    });
  });

  // ── processUploadConfirmJobById: corrupt gzip content ──
  describe('processUploadConfirmJobById with corrupt gzip', () => {
    it('handles corrupt gzip content as FILE_PARSE_FAILED', async () => {
      // gz: prefix with invalid base64 data that is not valid gzip
      const claimedJob = createJobRecord({
        status: 'processing',
        fileBase64: `gz:${Buffer.from('not-gzip-data').toString('base64')}`,
        attempts: 0,
      });

      const claimChain = createUpdateChain([claimedJob]);
      mocks.db.update.mockReturnValueOnce(claimChain);

      const cancelCheck = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([{ cancelRequestedAt: null, canceledAt: null }]),
      };
      mocks.db.select.mockReturnValueOnce(cancelCheck);

      const errorUpdateChain = createUpdateChain([{ id: 1 }]);
      mocks.db.update.mockReturnValueOnce(errorUpdateChain);

      const result = await processUploadConfirmJobById(1);
      expect(result).toBe(true);
    });
  });

  // ── processUploadConfirmJobById: mapping with array-like JSON ──
  describe('processUploadConfirmJobById with invalid mapping types', () => {
    it('rejects mapping that is a JSON array', async () => {
      const compressedPayload = await createCompressedPayload('file-content');
      const claimedJob = createJobRecord({
        status: 'processing',
        mappingJson: '[1,2,3]', // array, not object
        fileBase64: compressedPayload,
        attempts: 0,
      });

      const claimChain = createUpdateChain([claimedJob]);
      mocks.db.update.mockReturnValueOnce(claimChain);

      const cancelCheck = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([{ cancelRequestedAt: null, canceledAt: null }]),
      };
      mocks.db.select.mockReturnValueOnce(cancelCheck);

      const errorUpdateChain = createUpdateChain([{ id: 1 }]);
      mocks.db.update.mockReturnValueOnce(errorUpdateChain);

      const result = await processUploadConfirmJobById(1);
      expect(result).toBe(true);
    });
  });

  // ── processUploadConfirmJobById: used_medication type without quantity ──
  describe('processUploadConfirmJobById used_medication type', () => {
    it('allows used_medication type without quantity in mapping', async () => {
      const compressedPayload = await createCompressedPayload('file-content');
      const claimedJob = createJobRecord({
        status: 'processing',
        uploadType: 'used_medication',
        mappingJson: JSON.stringify({ drug_name: '1' }), // no quantity needed for used_medication
        fileBase64: compressedPayload,
      });

      const claimChain = createUpdateChain([claimedJob]);
      mocks.db.update.mockReturnValueOnce(claimChain);

      const cancelCheck1 = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([{ cancelRequestedAt: null, canceledAt: null }]),
      };
      const cancelCheck2 = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([{ cancelRequestedAt: null, canceledAt: null }]),
      };
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

  // ── processUploadConfirmJobById: mapping with column index > MAX_MAPPING_COLUMN_INDEX ──
  describe('processUploadConfirmJobById with out-of-range column index', () => {
    it('ignores column indices beyond MAX_MAPPING_COLUMN_INDEX', async () => {
      const compressedPayload = await createCompressedPayload('file-content');
      const claimedJob = createJobRecord({
        status: 'processing',
        mappingJson: JSON.stringify({ drug_name: '999', quantity: '2' }), // 999 > 199, drug_name will be null
        fileBase64: compressedPayload,
        attempts: 0,
      });

      const claimChain = createUpdateChain([claimedJob]);
      mocks.db.update.mockReturnValueOnce(claimChain);

      const cancelCheck = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([{ cancelRequestedAt: null, canceledAt: null }]),
      };
      mocks.db.select.mockReturnValueOnce(cancelCheck);

      // drug_name > 199 will be ignored, so mapping.drug_name will be null
      // This triggers MAPPING_INVALID (missing drug_name)
      const errorUpdateChain = createUpdateChain([{ id: 1 }]);
      mocks.db.update.mockReturnValueOnce(errorUpdateChain);

      const result = await processUploadConfirmJobById(1);
      expect(result).toBe(true);
    });
  });

  // ── processUploadConfirmJobById: retryable error with retry scheduled ──
  describe('processUploadConfirmJobById retryable error with scheduled retry', () => {
    it('schedules retry when retryable error occurs and attempts < max', async () => {
      const compressedPayload = await createCompressedPayload('file-content');
      const claimedJob = createJobRecord({
        status: 'processing',
        fileBase64: compressedPayload,
        attempts: 1, // below max (5)
      });

      const claimChain = createUpdateChain([claimedJob]);
      mocks.db.update.mockReturnValueOnce(claimChain);

      const cancelCheck1 = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([{ cancelRequestedAt: null, canceledAt: null }]),
      };
      const cancelCheck2 = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([{ cancelRequestedAt: null, canceledAt: null }]),
      };
      mocks.db.select
        .mockReturnValueOnce(cancelCheck1)
        .mockReturnValueOnce(cancelCheck2);

      // runUploadConfirm throws generic retryable error
      mocks.runUploadConfirm.mockRejectedValueOnce(new Error('transient DB timeout'));

      // Error handling: update succeeds (status goes to pending with nextRetryAt)
      const errorUpdateChain = createUpdateChain([{ id: 1 }]);
      mocks.db.update.mockReturnValueOnce(errorUpdateChain);

      const result = await processUploadConfirmJobById(1);
      expect(result).toBe(true);
    });
  });

  // ── enqueueUploadConfirmJob: idempotency conflict (different uploadType) ──
  describe('enqueueUploadConfirmJob idempotency conflict', () => {
    it('throws idempotency conflict when existing job has different uploadType', async () => {
      const { createHash } = await import('crypto');
      const fileBuffer = Buffer.from('file-data');
      const fileHash = createHash('sha256').update(fileBuffer).digest('hex');

      const existingJob = createJobRecord({
        id: 10,
        status: 'pending',
        idempotencyKey: 'key-1',
        uploadType: 'used_medication', // Different from request
        fileHash,
      });

      const idempotencySelectChain = {
        from: vi.fn(),
        where: vi.fn(),
        orderBy: vi.fn(),
        limit: vi.fn(),
      };
      idempotencySelectChain.from.mockReturnValue(idempotencySelectChain);
      idempotencySelectChain.where.mockReturnValue(idempotencySelectChain);
      idempotencySelectChain.orderBy.mockReturnValue(idempotencySelectChain);
      idempotencySelectChain.limit.mockResolvedValue([existingJob]);

      const tx = {
        execute: vi.fn().mockResolvedValue(undefined),
        select: vi.fn().mockReturnValueOnce(idempotencySelectChain),
        insert: vi.fn(),
        update: vi.fn(),
      };
      mocks.db.transaction.mockImplementation(
        async (callback: (executor: typeof tx) => Promise<unknown>) => callback(tx),
      );

      await expect(
        enqueueUploadConfirmJob({
          pharmacyId: 7,
          uploadType: 'dead_stock', // Different from existing
          originalFilename: 'test.xlsx',
          idempotencyKey: 'key-1',
          headerRowIndex: 0,
          mapping: { drug_code: '0', drug_name: '1', quantity: '2', unit: '3' },
          applyMode: 'replace',
          deleteMissing: false,
          fileBuffer,
        }),
      ).rejects.toThrow();
    });
  });

  // ── cancelUploadConfirmJobForPharmacy: cancel pending job ──
  describe('cancelUploadConfirmJobForPharmacy cancel pending', () => {
    it('cancels a pending job for matching pharmacy', async () => {
      const jobRecord = createJobRecord({ id: 1, pharmacyId: 7, status: 'pending' });
      const cancelledResult = {
        id: 1,
        status: 'failed',
        canceledAt: '2026-02-28T01:00:00Z',
        cancelRequestedAt: '2026-02-28T01:00:00Z',
      };

      const tx = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([jobRecord]),
            }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([cancelledResult]),
            }),
          }),
        }),
      };
      mocks.db.transaction.mockImplementation(
        async (callback: (executor: typeof tx) => Promise<unknown>) => callback(tx),
      );

      const result = await cancelUploadConfirmJobForPharmacy(1, 7);
      expect(result).not.toBeNull();
      expect(result!.id).toBe(1);
      expect(result!.canceledAt).toBe('2026-02-28T01:00:00Z');
    });
  });

  // ── cancelUploadConfirmJobByAdmin: processing job gets cancel-requested ──
  describe('cancelUploadConfirmJobByAdmin processing job', () => {
    it('sets cancelRequestedAt for a processing job', async () => {
      const jobRecord = createJobRecord({ id: 1, status: 'processing' });
      const cancelResult = {
        id: 1,
        status: 'processing',
        canceledAt: null,
        cancelRequestedAt: '2026-02-28T01:00:00Z',
      };

      const tx = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([jobRecord]),
            }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([cancelResult]),
            }),
          }),
        }),
      };
      mocks.db.transaction.mockImplementation(
        async (callback: (executor: typeof tx) => Promise<unknown>) => callback(tx),
      );

      const result = await cancelUploadConfirmJobByAdmin(1, 99);
      expect(result).not.toBeNull();
      expect(result!.cancelRequestedAt).toBe('2026-02-28T01:00:00Z');
    });
  });

  // ── cleanupUploadConfirmJobs: Infinity is not valid limit ──
  describe('cleanupUploadConfirmJobs with Infinity', () => {
    it('returns 0 for Infinity limit', async () => {
      const result = await cleanupUploadConfirmJobs(Infinity);
      expect(result).toBe(0);
    });
  });

  // ── getUploadConfirmJobById: job with resultJson ──
  describe('getUploadConfirmJobById returns view with result', () => {
    it('returns job view including resultJson', async () => {
      const jobRecord = createJobRecord({
        id: 5,
        status: 'completed',
        resultJson: JSON.stringify({ uploadId: 42, rowCount: 10 }),
      });
      const chain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([jobRecord]),
      };
      mocks.db.select.mockReturnValue(chain);
      mocks.getUploadRowIssueCountByJobId.mockResolvedValue(0);

      const result = await getUploadConfirmJobById(5);
      expect(result).not.toBeNull();
      expect(result!.id).toBe(5);
      expect(result!.resultJson).toContain('uploadId');
      expect(result!.cancelable).toBe(false);
    });
  });

  // ── ensureUploadConfirmQueueHasCapacity: both limits exceeded ──
  describe('ensureUploadConfirmQueueHasCapacity pharmacy limit exceeded', () => {
    it('throws when per-pharmacy limit is exceeded', async () => {
      const tx = {
        execute: vi.fn().mockResolvedValue(undefined),
        select: vi.fn()
          .mockReturnValueOnce(createCountSelectChain(999)), // pharmacy count exceeded
      };
      mocks.db.transaction.mockImplementation(
        async (callback: (executor: typeof tx) => Promise<unknown>) => callback(tx),
      );

      await expect(ensureUploadConfirmQueueHasCapacity(7)).rejects.toThrow();
    });
  });

  // ── processPendingUploadConfirmJobs: claim contention ──
  describe('processPendingUploadConfirmJobs claim contention', () => {
    it('retries claim on contention', async () => {
      const claimedJob = createJobRecord({ id: 1, status: 'processing', fileBase64: '' });

      // First claim attempt: find candidate, claim fails (returns empty), then retry finds nothing
      const findCandidateChain1 = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([claimedJob]),
      };

      const subQueryChain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([]),
      };

      // Second iteration: no candidate
      const noCandidateChain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
      };

      mocks.db.select
        .mockReturnValueOnce(findCandidateChain1) // find candidate
        .mockReturnValueOnce(subQueryChain)        // notExists subquery
        .mockReturnValueOnce(noCandidateChain);    // second iteration finds nothing

      // Claim attempt: update returns empty (contention)
      const claimChain = createUpdateChain([]);
      mocks.db.update.mockReturnValueOnce(claimChain);

      const result = await processPendingUploadConfirmJobs(1);
      expect(result).toBe(0);
    });
  });

  // ── processUploadConfirmJobById: canceledAt already set on job ──
  describe('processUploadConfirmJobById detects canceledAt on cancel check', () => {
    it('treats canceledAt as cancellation', async () => {
      const compressedPayload = await createCompressedPayload('file-content');
      const claimedJob = createJobRecord({
        status: 'processing',
        fileBase64: compressedPayload,
      });

      const claimChain = createUpdateChain([claimedJob]);
      mocks.db.update.mockReturnValueOnce(claimChain);

      // assertJobNotCancellationRequested detects canceledAt (already cancelled)
      const cancelCheck = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([{ cancelRequestedAt: null, canceledAt: '2026-02-28T01:00:00Z' }]),
      };
      mocks.db.select.mockReturnValueOnce(cancelCheck);

      // Error handling for JOB_CANCELED
      const errorUpdateChain = createUpdateChain([{ id: 1 }]);
      mocks.db.update.mockReturnValueOnce(errorUpdateChain);

      const result = await processUploadConfirmJobById(1);
      expect(result).toBe(true);
    });
  });

  // ── retryUploadConfirmJobByAdmin: retry with compressed file ──
  describe('retryUploadConfirmJobByAdmin with compressed file', () => {
    it('retries a failed job with compressed file payload', async () => {
      const compressedPayload = await createCompressedPayload('file-data');
      const jobRecord = createJobRecord({
        id: 1,
        status: 'failed',
        idempotencyKey: null,
        fileBase64: compressedPayload,
      });
      const updatedResult = {
        id: 1,
        status: 'pending',
        canceledAt: null,
        cancelRequestedAt: null,
      };

      const tx = {
        select: vi.fn()
          .mockReturnValueOnce({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([jobRecord]),
              }),
            }),
          })
          // Queue capacity checks
          .mockReturnValueOnce(createCountSelectChain(0))
          .mockReturnValueOnce(createCountSelectChain(0)),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([updatedResult]),
            }),
          }),
        }),
        execute: vi.fn().mockResolvedValue(undefined),
      };
      mocks.db.transaction.mockImplementation(
        async (callback: (executor: typeof tx) => Promise<unknown>) => callback(tx),
      );

      mocks.clearUploadRowIssuesForJob.mockResolvedValue(undefined);

      const result = await retryUploadConfirmJobByAdmin(1);
      expect(result).not.toBeNull();
      expect(result!.status).toBe('pending');
    });
  });
});
