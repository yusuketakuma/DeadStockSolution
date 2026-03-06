import { beforeEach, describe, expect, it, vi } from 'vitest';
import { promisify } from 'util';
import { gzip } from 'zlib';

const gzipAsync = promisify(gzip);

// ── Hoisted mocks ──────────────────────────────────────────

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
}));

vi.mock('../config/database', () => ({
  db: mocks.db,
}));

vi.mock('../services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../services/upload-row-issue-service', () => ({
  clearUploadRowIssuesForJob: mocks.clearUploadRowIssuesForJob.mockResolvedValue(undefined),
  getUploadRowIssueCountByJobId: mocks.getUploadRowIssueCountByJobId.mockResolvedValue(0),
}));

vi.mock('../services/upload-confirm-service', () => ({
  runUploadConfirm: mocks.runUploadConfirm.mockResolvedValue({
    uploadId: 1,
    rowCount: 10,
    diffSummary: null,
    partialSummary: null,
  }),
}));

vi.mock('../services/upload-service', () => ({
  parseExcelBuffer: mocks.parseExcelBuffer.mockResolvedValue([['col1', 'col2'], ['a', 'b']]),
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
  getUploadConfirmJobForPharmacy,
  cancelUploadConfirmJobByAdmin,
  cancelUploadConfirmJobForPharmacy,
  retryUploadConfirmJobByAdmin,
  cleanupUploadConfirmJobs,
  ensureUploadConfirmQueueHasCapacity,
} from '../services/upload-confirm-job-service';

// ── Helper factories ─────────────────────────────────────

function createCountSelectChain(count: number) {
  const query = {
    from: vi.fn(),
    where: vi.fn(),
  };
  query.from.mockReturnValue(query);
  query.where.mockResolvedValue([{ count }]);
  return query;
}

function createSelectChain(result: unknown[]) {
  const query = {
    from: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    offset: vi.fn(),
  };
  query.from.mockReturnValue(query);
  query.where.mockReturnValue(query);
  query.orderBy.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  query.offset.mockResolvedValue(result);
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

function createInsertChain(result: unknown[] = []) {
  const chain = {
    values: vi.fn(),
    returning: vi.fn(),
  };
  chain.values.mockReturnValue(chain);
  chain.returning.mockResolvedValue(result);
  return chain;
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

// ── Tests ────────────────────────────────────────────────

describe('processUploadConfirmJobById deep coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('processes a claimed job successfully', async () => {
    const compressedPayload = await createCompressedPayload('test-file-content');
    const claimedJob = createJobRecord({
      status: 'processing',
      fileBase64: compressedPayload,
    });

    // Claim the job
    const claimChain = createUpdateChain([claimedJob]);
    mocks.db.update.mockReturnValueOnce(claimChain);

    // assertJobNotCancellationRequested: two calls
    const cancelCheckChain1 = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ cancelRequestedAt: null, canceledAt: null }]),
    };
    const cancelCheckChain2 = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ cancelRequestedAt: null, canceledAt: null }]),
    };

    // Complete update
    const completeChain = createUpdateChain([{ id: 1 }]);

    mocks.db.select
      .mockReturnValueOnce(cancelCheckChain1) // first assertJobNotCancellationRequested
      .mockReturnValueOnce(cancelCheckChain2); // second assertJobNotCancellationRequested

    mocks.db.update.mockReturnValueOnce(completeChain);

    mocks.runUploadConfirm.mockResolvedValue({
      uploadId: 42,
      rowCount: 10,
      diffSummary: null,
      partialSummary: null,
    });

    const result = await processUploadConfirmJobById(1);
    expect(result).toBe(true);
    expect(mocks.runUploadConfirm).toHaveBeenCalled();
  });

  it('handles non-retryable error in processing', async () => {
    const claimedJob = createJobRecord({
      status: 'processing',
      fileBase64: '', // empty file causes FILE_PAYLOAD_MISSING
      attempts: 0,
    });

    const claimChain = createUpdateChain([claimedJob]);
    mocks.db.update.mockReturnValueOnce(claimChain);

    // Error handling update
    const errorUpdateChain = createUpdateChain([{ id: 1 }]);
    mocks.db.update.mockReturnValueOnce(errorUpdateChain);

    mocks.clearUploadRowIssuesForJob.mockResolvedValue(undefined);

    const result = await processUploadConfirmJobById(1);
    expect(result).toBe(true);
  });

  it('handles retryable error in processing with failed update leading to cancel', async () => {
    const compressedPayload = await createCompressedPayload('file-content');
    const claimedJob = createJobRecord({
      status: 'processing',
      fileBase64: compressedPayload,
      attempts: 0,
    });

    // 1. Claim the job via db.update
    const claimChain = createUpdateChain([claimedJob]);
    mocks.db.update.mockReturnValueOnce(claimChain);

    // 2. First assertJobNotCancellationRequested passes (before parsing)
    const cancelCheck1 = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ cancelRequestedAt: null, canceledAt: null }]),
    };
    // 3. Second assertJobNotCancellationRequested passes (after parsing, before runUploadConfirm)
    const cancelCheck2 = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ cancelRequestedAt: null, canceledAt: null }]),
    };
    mocks.db.select
      .mockReturnValueOnce(cancelCheck1)
      .mockReturnValueOnce(cancelCheck2);

    // 4. runUploadConfirm throws generic retryable error
    mocks.runUploadConfirm.mockRejectedValueOnce(new Error('temporary failure'));

    // 5. Error handling: update fails (returns empty), meaning job was concurrently cancelled
    const errorUpdateChain = createUpdateChain([]);
    mocks.db.update.mockReturnValueOnce(errorUpdateChain);

    // 6. finalizeCancelRequestedJob: db.update().set().where() — no .returning()
    const finalizeSet = {
      where: vi.fn().mockResolvedValue(undefined),
    };
    const finalizeChain = {
      set: vi.fn().mockReturnValue(finalizeSet),
    };
    mocks.db.update.mockReturnValueOnce(finalizeChain);

    // 7. fetchUploadConfirmJobById: db.select(COLUMNS).from().where().limit()
    const latestJob = createJobRecord({ canceledAt: '2026-02-28T01:00:00Z', status: 'failed' });
    const latestChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([latestJob]),
    };
    mocks.db.select.mockReturnValueOnce(latestChain);

    const result = await processUploadConfirmJobById(1);
    expect(result).toBe(true);
  });

  it('handles diff applyMode in response payload', async () => {
    const compressedPayload = await createCompressedPayload('file-content');
    const claimedJob = createJobRecord({
      status: 'processing',
      applyMode: 'diff',
      deleteMissing: true,
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
    mocks.db.select.mockReturnValueOnce(cancelCheck1).mockReturnValueOnce(cancelCheck2);

    mocks.runUploadConfirm.mockResolvedValueOnce({
      uploadId: 42,
      rowCount: 10,
      diffSummary: { added: 5, updated: 3, deleted: 2 },
      partialSummary: null,
    });

    const completeChain = createUpdateChain([{ id: 1 }]);
    mocks.db.update.mockReturnValueOnce(completeChain);

    const result = await processUploadConfirmJobById(1);
    expect(result).toBe(true);
  });

  it('handles partial applyMode in response payload', async () => {
    const compressedPayload = await createCompressedPayload('file-content');
    const claimedJob = createJobRecord({
      status: 'processing',
      applyMode: 'partial',
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
    mocks.db.select.mockReturnValueOnce(cancelCheck1).mockReturnValueOnce(cancelCheck2);

    mocks.runUploadConfirm.mockResolvedValueOnce({
      uploadId: 42,
      rowCount: 10,
      diffSummary: null,
      partialSummary: { acceptedRows: 8, rejectedRows: 2 },
    });

    const completeChain = createUpdateChain([{ id: 1 }]);
    mocks.db.update.mockReturnValueOnce(completeChain);

    const result = await processUploadConfirmJobById(1);
    expect(result).toBe(true);
  });

  it('handles parseExcelBuffer failure', async () => {
    const compressedPayload = await createCompressedPayload('file-content');
    const claimedJob = createJobRecord({
      status: 'processing',
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

    mocks.parseExcelBuffer.mockRejectedValueOnce(new Error('corrupt file'));

    // Error handling update
    const errorUpdateChain = createUpdateChain([{ id: 1 }]);
    mocks.db.update.mockReturnValueOnce(errorUpdateChain);

    const result = await processUploadConfirmJobById(1);
    expect(result).toBe(true);
  });

  it('handles invalid mapping JSON', async () => {
    const compressedPayload = await createCompressedPayload('file-content');
    const claimedJob = createJobRecord({
      status: 'processing',
      mappingJson: 'not-valid-json',
      fileBase64: compressedPayload,
      attempts: 0,
    });

    const claimChain = createUpdateChain([claimedJob]);
    mocks.db.update.mockReturnValueOnce(claimChain);

    mocks.clearUploadRowIssuesForJob.mockResolvedValue(undefined);

    const cancelCheck = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ cancelRequestedAt: null, canceledAt: null }]),
    };
    mocks.db.select.mockReturnValueOnce(cancelCheck);

    // Error handling update for MAPPING_INVALID
    const errorUpdateChain = createUpdateChain([{ id: 1 }]);
    mocks.db.update.mockReturnValueOnce(errorUpdateChain);

    const result = await processUploadConfirmJobById(1);
    expect(result).toBe(true);
  });

  it('handles mapping missing drug_name', async () => {
    const compressedPayload = await createCompressedPayload('file-content');
    const claimedJob = createJobRecord({
      status: 'processing',
      // mapping without drug_name
      mappingJson: JSON.stringify({ drug_code: '0', quantity: '2', unit: '3' }),
      fileBase64: compressedPayload,
      attempts: 0,
    });

    const claimChain = createUpdateChain([claimedJob]);
    mocks.db.update.mockReturnValueOnce(claimChain);

    mocks.clearUploadRowIssuesForJob.mockResolvedValue(undefined);

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

  it('handles mapping missing quantity for dead_stock type', async () => {
    const compressedPayload = await createCompressedPayload('file-content');
    const claimedJob = createJobRecord({
      status: 'processing',
      uploadType: 'dead_stock',
      // drug_name present but no quantity
      mappingJson: JSON.stringify({ drug_name: '1', unit: '3' }),
      fileBase64: compressedPayload,
      attempts: 0,
    });

    const claimChain = createUpdateChain([claimedJob]);
    mocks.db.update.mockReturnValueOnce(claimChain);

    mocks.clearUploadRowIssuesForJob.mockResolvedValue(undefined);

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

  it('handles job cancellation detected mid-processing', async () => {
    const compressedPayload = await createCompressedPayload('file-content');
    const claimedJob = createJobRecord({
      status: 'processing',
      fileBase64: compressedPayload,
    });

    const claimChain = createUpdateChain([claimedJob]);
    mocks.db.update.mockReturnValueOnce(claimChain);

    mocks.clearUploadRowIssuesForJob.mockResolvedValue(undefined);

    // assertJobNotCancellationRequested detects cancellation
    const cancelCheck = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ cancelRequestedAt: '2026-02-28T01:00:00Z', canceledAt: null }]),
    };
    mocks.db.select.mockReturnValueOnce(cancelCheck);

    // Error handling: job was cancelled, classified as JOB_CANCELED
    const errorUpdateChain = createUpdateChain([{ id: 1 }]);
    mocks.db.update.mockReturnValueOnce(errorUpdateChain);

    const result = await processUploadConfirmJobById(1);
    expect(result).toBe(true);
  });

  it('handles terminal failure at max attempts', async () => {
    const compressedPayload = await createCompressedPayload('file-content');
    const claimedJob = createJobRecord({
      status: 'processing',
      fileBase64: compressedPayload,
      attempts: 4, // next attempt will be 5, which is max
    });

    const claimChain = createUpdateChain([claimedJob]);
    mocks.db.update.mockReturnValueOnce(claimChain);

    mocks.clearUploadRowIssuesForJob.mockResolvedValue(undefined);

    const cancelCheck = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ cancelRequestedAt: null, canceledAt: null }]),
    };
    mocks.db.select.mockReturnValueOnce(cancelCheck);

    // runUploadConfirm throws retryable error
    mocks.runUploadConfirm.mockRejectedValueOnce(new Error('transient issue'));

    // Terminal error update
    const errorUpdateChain = createUpdateChain([{ id: 1 }]);
    mocks.db.update.mockReturnValueOnce(errorUpdateChain);

    const result = await processUploadConfirmJobById(1);
    expect(result).toBe(true);
  });
});

describe('getUploadConfirmJobById deep coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns view with issueCount when job found', async () => {
    const jobRecord = createJobRecord({ id: 5, status: 'completed' });
    const chain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([jobRecord]),
    };
    mocks.db.select.mockReturnValue(chain);
    mocks.getUploadRowIssueCountByJobId.mockResolvedValue(3);

    const result = await getUploadConfirmJobById(5);
    expect(result).not.toBeNull();
    expect(result!.id).toBe(5);
    expect(result!.issueCount).toBe(3);
    expect(result!.cancelable).toBe(false); // completed status is not cancelable
  });
});

describe('getUploadConfirmJobForPharmacy deep coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns job when pharmacyId matches', async () => {
    const jobRecord = createJobRecord({ id: 5, pharmacyId: 7, status: 'pending' });
    const chain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([jobRecord]),
    };
    mocks.db.select.mockReturnValue(chain);
    mocks.getUploadRowIssueCountByJobId.mockResolvedValue(0);

    const result = await getUploadConfirmJobForPharmacy(5, 7);
    expect(result).not.toBeNull();
    expect(result!.id).toBe(5);
    expect(result!.cancelable).toBe(true);
  });

  it('returns null when pharmacyId does not match', async () => {
    const jobRecord = createJobRecord({ id: 5, pharmacyId: 7 });
    const chain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([jobRecord]),
    };
    mocks.db.select.mockReturnValue(chain);
    mocks.getUploadRowIssueCountByJobId.mockResolvedValue(0);

    const result = await getUploadConfirmJobForPharmacy(5, 999);
    expect(result).toBeNull();
  });
});

describe('cancelUploadConfirmJobByAdmin deep coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('cancels a pending job immediately (sets to failed)', async () => {
    const jobRecord = createJobRecord({ id: 1, status: 'pending' });
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

    const result = await cancelUploadConfirmJobByAdmin(1, 99);
    expect(result).not.toBeNull();
    expect(result!.id).toBe(1);
    expect(result!.canceledAt).toBe('2026-02-28T01:00:00Z');
  });

  it('returns cancel result for already completed job (non-cancelable)', async () => {
    const jobRecord = createJobRecord({ id: 1, status: 'completed' });

    const tx = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([jobRecord]),
          }),
        }),
      }),
      update: vi.fn(),
    };
    mocks.db.transaction.mockImplementation(
      async (callback: (executor: typeof tx) => Promise<unknown>) => callback(tx),
    );

    const result = await cancelUploadConfirmJobByAdmin(1, 99);
    expect(result).not.toBeNull();
    // completed status means not cancelable, returns as-is
    expect(result!.cancelable).toBe(false);
  });

  it('handles concurrent update failure in cancel', async () => {
    const jobRecord = createJobRecord({ id: 1, status: 'processing' });
    const latestJob = createJobRecord({ id: 1, status: 'completed', canceledAt: null, cancelRequestedAt: null });

    const tx = {
      select: vi.fn()
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([jobRecord]),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([latestJob]),
            }),
          }),
        }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
    };
    mocks.db.transaction.mockImplementation(
      async (callback: (executor: typeof tx) => Promise<unknown>) => callback(tx),
    );

    const result = await cancelUploadConfirmJobByAdmin(1, 99);
    expect(result).not.toBeNull();
  });
});

describe('cancelUploadConfirmJobForPharmacy deep coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when pharmacyId does not match', async () => {
    const jobRecord = createJobRecord({ id: 1, pharmacyId: 7 });

    const tx = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([jobRecord]),
          }),
        }),
      }),
      update: vi.fn(),
    };
    mocks.db.transaction.mockImplementation(
      async (callback: (executor: typeof tx) => Promise<unknown>) => callback(tx),
    );

    const result = await cancelUploadConfirmJobForPharmacy(1, 999);
    expect(result).toBeNull();
  });
});

describe('retryUploadConfirmJobByAdmin deep coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retries a failed job with idempotency key and no active duplicates', async () => {
    const jobRecord = createJobRecord({
      id: 1,
      status: 'failed',
      idempotencyKey: 'key-abc',
      fileBase64: Buffer.from('test').toString('base64'),
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
        // Check for active jobs with same idempotency key
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([]),
            }),
          }),
        })
        // Queue capacity checks: pharmacy count and global count
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
    expect(result!.cancelable).toBe(true);
  });

  it('throws when idempotency key has active duplicate', async () => {
    const jobRecord = createJobRecord({
      id: 1,
      status: 'failed',
      idempotencyKey: 'key-abc',
      fileBase64: Buffer.from('test').toString('base64'),
    });

    const tx = {
      select: vi.fn()
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([jobRecord]),
            }),
          }),
        })
        // Active job with same key exists
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([{ id: 999 }]),
            }),
          }),
        }),
      update: vi.fn(),
      execute: vi.fn().mockResolvedValue(undefined),
    };
    mocks.db.transaction.mockImplementation(
      async (callback: (executor: typeof tx) => Promise<unknown>) => callback(tx),
    );

    await expect(retryUploadConfirmJobByAdmin(1)).rejects.toThrow();
  });

  it('retries a completed job without idempotency key', async () => {
    const jobRecord = createJobRecord({
      id: 1,
      status: 'completed',
      idempotencyKey: null,
      fileBase64: Buffer.from('test').toString('base64'),
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
        // No idempotency check needed, go straight to capacity checks
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

  it('returns null when update returns empty', async () => {
    const jobRecord = createJobRecord({
      id: 1,
      status: 'failed',
      idempotencyKey: null,
      fileBase64: Buffer.from('test').toString('base64'),
    });

    const tx = {
      select: vi.fn()
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([jobRecord]),
            }),
          }),
        })
        .mockReturnValueOnce(createCountSelectChain(0))
        .mockReturnValueOnce(createCountSelectChain(0)),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([]),
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
    expect(result).toBeNull();
  });
});

describe('enqueueUploadConfirmJob deep coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates new job when no idempotency key conflicts', async () => {
    const insertedJob = {
      id: 42,
      status: 'pending',
      canceledAt: null,
      cancelRequestedAt: null,
    };

    const tx = {
      execute: vi.fn().mockResolvedValue(undefined),
      select: vi.fn().mockImplementation(() => createCountSelectChain(0)),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([insertedJob]),
        }),
      }),
      update: vi.fn(),
    };
    mocks.db.transaction.mockImplementation(
      async (callback: (executor: typeof tx) => Promise<unknown>) => callback(tx),
    );

    const result = await enqueueUploadConfirmJob({
      pharmacyId: 7,
      uploadType: 'dead_stock',
      originalFilename: 'test.xlsx',
      headerRowIndex: 0,
      mapping: { drug_code: '0', drug_name: '1', quantity: '2', unit: '3' },
      applyMode: 'replace',
      deleteMissing: false,
      fileBuffer: Buffer.from('file-data'),
    });

    expect(result.jobId).toBe(42);
    expect(result.status).toBe('pending');
    expect(result.deduplicated).toBe(false);
    expect(result.cancelable).toBe(true);
  });

  it('deduplicates when existing job matches idempotency key', async () => {
    // We need the fileHash and mappingJson to match exactly
    const { createHash } = await import('crypto');
    const fileBuffer = Buffer.from('file-data');
    const fileHash = createHash('sha256').update(fileBuffer).digest('hex');
    const mapping = { drug_code: '0', drug_name: '1', quantity: '2', unit: '3' };
    const mappingJson = JSON.stringify(mapping);

    const existingJob = createJobRecord({
      id: 10,
      status: 'pending',
      idempotencyKey: 'dedup-key',
      deduplicated: false,
      uploadType: 'dead_stock',
      fileHash,
      headerRowIndex: 0,
      mappingJson,
      applyMode: 'replace',
      deleteMissing: false,
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

    let selectCallCount = 0;
    const tx = {
      execute: vi.fn().mockResolvedValue(undefined),
      select: vi.fn().mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount === 1) {
          return idempotencySelectChain;
        }
        return createCountSelectChain(0);
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      }),
      insert: vi.fn(),
    };
    mocks.db.transaction.mockImplementation(
      async (callback: (executor: typeof tx) => Promise<unknown>) => callback(tx),
    );

    const result = await enqueueUploadConfirmJob({
      pharmacyId: 7,
      uploadType: 'dead_stock',
      originalFilename: 'test.xlsx',
      idempotencyKey: 'dedup-key',
      headerRowIndex: 0,
      mapping,
      applyMode: 'replace',
      deleteMissing: false,
      fileBuffer,
    });

    expect(result.jobId).toBe(10);
    expect(result.deduplicated).toBe(true);
  });
});

describe('processPendingUploadConfirmJobs deep coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('processes up to limit jobs', async () => {
    // claimPendingUploadConfirmJob uses the following db.select calls:
    // 1. db.select({...}).from().where().orderBy().limit() — find candidate
    // 2. db.select({id:...}).from().where() — buildNoOtherActiveProcessingCondition subquery (inside notExists)
    // Then processClaimedUploadConfirmJob uses:
    // 3. db.select({cancelRequestedAt, canceledAt}).from().where().limit() — assertJobNotCancellationRequested
    // fileBase64 is empty -> FILE_PAYLOAD_MISSING error, goes to catch handler
    // Then second iteration of claimPendingUploadConfirmJob:
    // 4. db.select({...}).from().where().orderBy().limit() — find candidate (returns none)

    const claimedJob = createJobRecord({ id: 1, status: 'processing', fileBase64: '' });

    // 1. Find candidate — select with orderBy chain
    const findCandidateChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([claimedJob]),
    };

    // 2. buildNoOtherActiveProcessingCondition subquery
    const subQueryChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
    };

    // 3. assertJobNotCancellationRequested
    const cancelCheckChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ cancelRequestedAt: null, canceledAt: null }]),
    };

    // 4. Second iteration: no candidate
    const noCandidateChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };

    mocks.db.select
      .mockReturnValueOnce(findCandidateChain)   // 1. find candidate
      .mockReturnValueOnce(subQueryChain)          // 2. notExists subquery
      .mockReturnValueOnce(cancelCheckChain)       // 3. assertJobNotCancellationRequested
      .mockReturnValueOnce(noCandidateChain);      // 4. second iteration

    // db.update calls:
    // 1. claim the job (update returning)
    const claimChain = createUpdateChain([claimedJob]);
    // 2. error handling update (non-retryable FILE_PAYLOAD_MISSING)
    const errorUpdateChain = createUpdateChain([{ id: 1 }]);

    mocks.db.update
      .mockReturnValueOnce(claimChain)
      .mockReturnValueOnce(errorUpdateChain);

    const result = await processPendingUploadConfirmJobs(3);
    expect(result).toBe(1);
  });

  it('normalizes limit to valid range', async () => {
    // Zero/negative limit should be treated as 1
    const selectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };
    mocks.db.select.mockReturnValue(selectChain);

    const result = await processPendingUploadConfirmJobs(0);
    expect(result).toBe(0);
  });
});

describe('ensureUploadConfirmQueueHasCapacity deep coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws when global queue limit is exceeded', async () => {
    const tx = {
      execute: vi.fn().mockResolvedValue(undefined),
      select: vi.fn()
        .mockReturnValueOnce(createCountSelectChain(0))  // pharmacy count OK
        .mockReturnValueOnce(createCountSelectChain(999)), // global count exceeded
    };
    mocks.db.transaction.mockImplementation(
      async (callback: (executor: typeof tx) => Promise<unknown>) => callback(tx),
    );

    await expect(ensureUploadConfirmQueueHasCapacity(7)).rejects.toThrow();
  });
});

describe('cleanupUploadConfirmJobs deep coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('handles non-integer limit as invalid', async () => {
    expect(await cleanupUploadConfirmJobs(1.5)).toBe(0);
    expect(await cleanupUploadConfirmJobs(NaN)).toBe(0);
  });
});
