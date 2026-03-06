import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Hoisted mocks ──────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  db: {
    transaction: vi.fn(),
    select: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('../config/database', () => ({
  db: mocks.db,
}));

vi.mock('../services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../services/upload-row-issue-service', () => ({
  clearUploadRowIssuesForJob: vi.fn().mockResolvedValue(undefined),
  getUploadRowIssueCountByJobId: vi.fn().mockResolvedValue(0),
}));

vi.mock('../services/upload-confirm-service', () => ({
  runUploadConfirm: vi.fn().mockResolvedValue({
    uploadId: 1,
    rowCount: 10,
    diffSummary: null,
    partialSummary: null,
  }),
}));

vi.mock('../services/upload-service', () => ({
  parseExcelBuffer: vi.fn().mockResolvedValue([['col1', 'col2'], ['a', 'b']]),
}));

import {
  isUploadConfirmQueueLimitError,
  isUploadConfirmIdempotencyConflictError,
  isUploadConfirmRetryUnavailableError,
  UPLOAD_CONFIRM_QUEUE_LIMIT_ERROR_CODE,
  UPLOAD_CONFIRM_IDEMPOTENCY_CONFLICT_ERROR_CODE,
  UPLOAD_CONFIRM_RETRY_UNAVAILABLE_ERROR_CODE,
  enqueueUploadConfirmJob,
  getUploadConfirmJobById,
  getUploadConfirmJobForPharmacy,
  cleanupUploadConfirmJobs,
  processPendingUploadConfirmJobs,
  ensureUploadConfirmQueueHasCapacity,
  cancelUploadConfirmJobByAdmin,
  cancelUploadConfirmJobForPharmacy,
  retryUploadConfirmJobByAdmin,
  processUploadConfirmJobById,
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
  const chain = {
    where: vi.fn().mockResolvedValue(undefined),
  };
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

// ── Tests ────────────────────────────────────────────────

describe('upload-confirm-job-service error type guards', () => {
  it('isUploadConfirmQueueLimitError returns true for matching error', () => {
    const error = Object.assign(new Error('queue full'), {
      code: UPLOAD_CONFIRM_QUEUE_LIMIT_ERROR_CODE,
      limit: 3,
      activeJobs: 3,
    });
    expect(isUploadConfirmQueueLimitError(error)).toBe(true);
  });

  it('isUploadConfirmQueueLimitError returns false for non-matching error', () => {
    expect(isUploadConfirmQueueLimitError(new Error('generic'))).toBe(false);
    expect(isUploadConfirmQueueLimitError(null)).toBe(false);
    expect(isUploadConfirmQueueLimitError(undefined)).toBe(false);
    expect(isUploadConfirmQueueLimitError('string')).toBe(false);
    expect(isUploadConfirmQueueLimitError(42)).toBe(false);
  });

  it('isUploadConfirmIdempotencyConflictError returns true for matching error', () => {
    const error = Object.assign(new Error('conflict'), {
      code: UPLOAD_CONFIRM_IDEMPOTENCY_CONFLICT_ERROR_CODE,
    });
    expect(isUploadConfirmIdempotencyConflictError(error)).toBe(true);
  });

  it('isUploadConfirmIdempotencyConflictError returns false for non-matching error', () => {
    expect(isUploadConfirmIdempotencyConflictError(new Error('generic'))).toBe(false);
    expect(isUploadConfirmIdempotencyConflictError(null)).toBe(false);
  });

  it('isUploadConfirmRetryUnavailableError returns true for matching error', () => {
    const error = Object.assign(new Error('retry unavailable'), {
      code: UPLOAD_CONFIRM_RETRY_UNAVAILABLE_ERROR_CODE,
    });
    expect(isUploadConfirmRetryUnavailableError(error)).toBe(true);
  });

  it('isUploadConfirmRetryUnavailableError returns false for non-matching error', () => {
    expect(isUploadConfirmRetryUnavailableError(new Error('generic'))).toBe(false);
    expect(isUploadConfirmRetryUnavailableError(null)).toBe(false);
    expect(isUploadConfirmRetryUnavailableError({ code: 'OTHER' })).toBe(false);
  });
});

describe('enqueueUploadConfirmJob queue limit enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws queue limit error when pharmacy exceeds per-pharmacy limit', async () => {
    let callCount = 0;
    const tx = {
      execute: vi.fn().mockResolvedValue(undefined),
      select: vi.fn().mockImplementation(() => {
        callCount++;
        // First call is idempotency check (if any), second is pharmacy count
        return createCountSelectChain(99);
      }),
      insert: vi.fn(),
    };
    mocks.db.transaction.mockImplementation(
      async (callback: (executor: typeof tx) => Promise<unknown>) => callback(tx),
    );

    await expect(
      enqueueUploadConfirmJob({
        pharmacyId: 7,
        uploadType: 'dead_stock',
        originalFilename: 'test.xlsx',
        headerRowIndex: 0,
        mapping: { drug_code: '0', drug_name: '1', quantity: '2', unit: '3' },
        applyMode: 'replace',
        deleteMissing: false,
        fileBuffer: Buffer.from('file-data'),
      }),
    ).rejects.toThrow();
  });
});

describe('getUploadConfirmJobById', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when job is not found', async () => {
    // fetchUploadConfirmJobById uses [row] = await executor.select(...).from().where().limit()
    const chain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };
    mocks.db.select.mockReturnValue(chain);

    const result = await getUploadConfirmJobById(999);
    expect(result).toBe(null);
  });
});

describe('getUploadConfirmJobForPharmacy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when pharmacyId does not match', async () => {
    const jobRecord = createJobRecord({ pharmacyId: 7 });
    const selectChain = {
      from: vi.fn(),
      where: vi.fn(),
      limit: vi.fn(),
    };
    selectChain.from.mockReturnValue(selectChain);
    selectChain.where.mockReturnValue(selectChain);
    selectChain.limit.mockResolvedValue([jobRecord]);
    mocks.db.select.mockReturnValue(selectChain);

    // The function calls getUploadConfirmJobById internally which also calls getUploadRowIssueCountByJobId
    const result = await getUploadConfirmJobForPharmacy(1, 999);
    // pharmacyId 7 != 999, so should be null
    if (result !== null) {
      expect(result.pharmacyId).toBe(999);
    }
  });
});

describe('cleanupUploadConfirmJobs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 0 when limit is invalid', async () => {
    expect(await cleanupUploadConfirmJobs(0)).toBe(0);
    expect(await cleanupUploadConfirmJobs(-1)).toBe(0);
  });

  it('returns 0 when no stale rows found', async () => {
    const chain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };
    mocks.db.select.mockReturnValue(chain);

    const result = await cleanupUploadConfirmJobs(10);
    expect(result).toBe(0);
  });

  it('deletes stale rows and returns count', async () => {
    const chain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ id: 1 }, { id: 2 }]),
    };
    mocks.db.select.mockReturnValue(chain);
    const deleteChain = createDeleteChain();
    mocks.db.delete.mockReturnValue(deleteChain);

    const result = await cleanupUploadConfirmJobs(10);
    expect(result).toBe(2);
    expect(mocks.db.delete).toHaveBeenCalled();
  });
});

describe('processPendingUploadConfirmJobs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 0 when no pending jobs', async () => {
    // claimPendingUploadConfirmJob uses destructuring [candidate] = await db.select(...)...
    const chain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };
    mocks.db.select.mockReturnValue(chain);

    const result = await processPendingUploadConfirmJobs(1);
    expect(result).toBe(0);
  });
});

describe('ensureUploadConfirmQueueHasCapacity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not throw when within limits', async () => {
    const tx = {
      execute: vi.fn().mockResolvedValue(undefined),
      select: vi.fn().mockImplementation(() => createCountSelectChain(0)),
    };
    mocks.db.transaction.mockImplementation(
      async (callback: (executor: typeof tx) => Promise<unknown>) => callback(tx),
    );

    await expect(ensureUploadConfirmQueueHasCapacity(7)).resolves.toBeUndefined();
  });
});

describe('cancelUploadConfirmJobByAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when job not found', async () => {
    const tx = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
      update: vi.fn(),
    };
    mocks.db.transaction.mockImplementation(
      async (callback: (executor: typeof tx) => Promise<unknown>) => callback(tx),
    );

    const result = await cancelUploadConfirmJobByAdmin(999, 1);
    expect(result).toBe(null);
  });
});

describe('cancelUploadConfirmJobForPharmacy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when job not found', async () => {
    const tx = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
      update: vi.fn(),
    };
    mocks.db.transaction.mockImplementation(
      async (callback: (executor: typeof tx) => Promise<unknown>) => callback(tx),
    );

    const result = await cancelUploadConfirmJobForPharmacy(999, 7);
    expect(result).toBe(null);
  });
});

describe('retryUploadConfirmJobByAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when job not found', async () => {
    const tx = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
      update: vi.fn(),
      execute: vi.fn().mockResolvedValue(undefined),
    };
    mocks.db.transaction.mockImplementation(
      async (callback: (executor: typeof tx) => Promise<unknown>) => callback(tx),
    );

    const result = await retryUploadConfirmJobByAdmin(999);
    expect(result).toBe(null);
  });

  it('throws retry unavailable error when job is in pending status', async () => {
    const jobRecord = createJobRecord({ status: 'pending' });
    const tx = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([jobRecord]),
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

  it('throws when file payload is missing on failed job', async () => {
    const jobRecord = createJobRecord({ status: 'failed', fileBase64: '' });
    const tx = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([jobRecord]),
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
});

describe('processUploadConfirmJobById', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns false when job cannot be claimed', async () => {
    const updateChain = createUpdateChain([]);
    mocks.db.update.mockReturnValue(updateChain);

    const result = await processUploadConfirmJobById(999);
    expect(result).toBe(false);
  });
});
