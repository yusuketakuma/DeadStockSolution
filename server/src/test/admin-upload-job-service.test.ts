import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Hoisted mocks ──────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
    transaction: vi.fn(),
  },
}));

vi.mock('../config/database', () => ({
  db: mocks.db,
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => args),
  desc: vi.fn((col: unknown) => col),
  eq: vi.fn(() => ({})),
  ilike: vi.fn(() => ({})),
  inArray: vi.fn(() => ({})),
  isNotNull: vi.fn(() => ({})),
  isNull: vi.fn(() => ({})),
  or: vi.fn((...args: unknown[]) => args),
  sql: vi.fn(() => ({})),
  count: vi.fn(() => ({})),
}));

vi.mock('../services/upload-row-issue-service', () => ({
  buildUploadRowIssueCsv: vi.fn().mockReturnValue('rowNumber,issueCode,issueMessage,rowDataJson\n1,ERR,error,{}'),
  getUploadRowIssueCountByJobIds: vi.fn().mockResolvedValue(new Map()),
  getUploadRowIssueSummary: vi.fn().mockResolvedValue({ totalIssues: 1, byCode: { ERR: 1 } }),
  getUploadRowIssuesForJob: vi.fn().mockResolvedValue([]),
}));

vi.mock('../services/upload-confirm-job-service', () => ({
  cancelUploadConfirmJobByAdmin: vi.fn().mockResolvedValue(null),
  getUploadConfirmJobById: vi.fn().mockResolvedValue(null),
  isUploadConfirmRetryUnavailableError: vi.fn().mockReturnValue(false),
  retryUploadConfirmJobByAdmin: vi.fn().mockResolvedValue(null),
}));

vi.mock('../utils/db-utils', () => ({
  rowCount: vi.fn(),
}));

import {
  listAdminUploadJobs,
  getAdminUploadJobDetail,
  cancelAdminUploadJob,
  retryAdminUploadJob,
  getAdminUploadJobErrorReport,
} from '../services/admin-upload-job-service';

function createChainedSelect(rows: unknown[], totalCount = 0) {
  // For jobRows select
  const jobChain = {
    from: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    offset: vi.fn(),
  };
  jobChain.from.mockReturnValue(jobChain);
  jobChain.where.mockReturnValue(jobChain);
  jobChain.orderBy.mockReturnValue(jobChain);
  jobChain.limit.mockReturnValue(jobChain);
  jobChain.offset.mockResolvedValue(rows);

  // For count select
  const countChain = {
    from: vi.fn(),
    where: vi.fn(),
  };
  countChain.from.mockReturnValue(countChain);
  countChain.where.mockResolvedValue([{ count: totalCount }]);

  // For pharmacy select
  const pharmacyChain = {
    from: vi.fn(),
    where: vi.fn(),
  };
  pharmacyChain.from.mockReturnValue(pharmacyChain);
  pharmacyChain.where.mockResolvedValue([]);

  let callNumber = 0;
  return () => {
    callNumber++;
    if (callNumber === 1) return jobChain;
    if (callNumber === 2) return countChain;
    return pharmacyChain;
  };
}

describe('admin-upload-job-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('listAdminUploadJobs', () => {
    it('returns empty list when no jobs', async () => {
      const selectMock = createChainedSelect([], 0);
      mocks.db.select.mockImplementation(selectMock);

      const result = await listAdminUploadJobs({
        page: 1,
        limit: 10,
      });

      expect(result.data).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('maps job data with pharmacy names', async () => {
      const jobRows = [
        {
          id: 1,
          pharmacyId: 7,
          uploadType: 'dead_stock',
          originalFilename: 'test.xlsx',
          status: 'completed',
          applyMode: 'replace',
          attempts: 1,
          deduplicated: false,
          cancelRequestedAt: null,
          canceledAt: null,
          resultJson: null,
          createdAt: '2026-03-01T00:00:00Z',
          updatedAt: '2026-03-01T00:00:00Z',
          completedAt: '2026-03-01T00:01:00Z',
        },
      ];

      let callNum = 0;
      mocks.db.select.mockImplementation(() => {
        callNum++;
        if (callNum === 1) {
          // jobs
          const chain = {
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            orderBy: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            offset: vi.fn().mockResolvedValue(jobRows),
          };
          return chain;
        }
        if (callNum === 2) {
          // count
          const chain = {
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockResolvedValue([{ count: 1 }]),
          };
          return chain;
        }
        // pharmacies
        const chain = {
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockResolvedValue([{ id: 7, name: 'テスト薬局' }]),
        };
        return chain;
      });

      const result = await listAdminUploadJobs({
        page: 1,
        limit: 10,
      });

      expect(result.total).toBe(1);
      expect(result.data).toHaveLength(1);
      expect(result.data[0].pharmacyName).toBe('テスト薬局');
    });

    it('resolves canceled status', async () => {
      const jobRows = [
        {
          id: 1,
          pharmacyId: 7,
          uploadType: 'dead_stock',
          originalFilename: 'test.xlsx',
          status: 'pending',
          applyMode: 'replace',
          attempts: 0,
          deduplicated: false,
          cancelRequestedAt: '2026-03-01T00:00:00Z',
          canceledAt: '2026-03-01T00:01:00Z',
          resultJson: null,
          createdAt: '2026-03-01T00:00:00Z',
          updatedAt: '2026-03-01T00:00:00Z',
          completedAt: null,
        },
      ];

      let callNum = 0;
      mocks.db.select.mockImplementation(() => {
        callNum++;
        if (callNum === 1) {
          const chain = {
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            orderBy: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            offset: vi.fn().mockResolvedValue(jobRows),
          };
          return chain;
        }
        if (callNum === 2) {
          const chain = {
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockResolvedValue([{ count: 1 }]),
          };
          return chain;
        }
        const chain = {
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockResolvedValue([]),
        };
        return chain;
      });

      const result = await listAdminUploadJobs({ page: 1, limit: 10 });
      expect(result.data[0].status).toBe('canceled');
      expect(result.data[0].cancelable).toBe(false);
    });

    it('applies filters for pharmacyId', async () => {
      const selectMock = createChainedSelect([], 0);
      mocks.db.select.mockImplementation(selectMock);

      const result = await listAdminUploadJobs({
        page: 1,
        limit: 10,
        pharmacyId: 7,
      });

      expect(result.data).toEqual([]);
    });

    it('applies filters for status=canceled', async () => {
      const selectMock = createChainedSelect([], 0);
      mocks.db.select.mockImplementation(selectMock);

      const result = await listAdminUploadJobs({
        page: 1,
        limit: 10,
        status: 'canceled',
      });

      expect(result.data).toEqual([]);
    });

    it('applies filters for uploadType', async () => {
      const selectMock = createChainedSelect([], 0);
      mocks.db.select.mockImplementation(selectMock);

      const result = await listAdminUploadJobs({
        page: 1,
        limit: 10,
        uploadType: 'dead_stock',
      });

      expect(result.data).toEqual([]);
    });

    it('applies keyword filter', async () => {
      const selectMock = createChainedSelect([], 0);
      mocks.db.select.mockImplementation(selectMock);

      const result = await listAdminUploadJobs({
        page: 1,
        limit: 10,
        keyword: 'テスト',
      });

      expect(result.data).toEqual([]);
    });

    it('detects error report available from partial summary', async () => {
      const jobRows = [
        {
          id: 1,
          pharmacyId: 7,
          uploadType: 'dead_stock',
          originalFilename: 'test.xlsx',
          status: 'completed',
          applyMode: 'partial',
          attempts: 1,
          deduplicated: false,
          cancelRequestedAt: null,
          canceledAt: null,
          resultJson: JSON.stringify({
            partialSummary: { rejectedRows: 3 },
          }),
          createdAt: '2026-03-01T00:00:00Z',
          updatedAt: '2026-03-01T00:00:00Z',
          completedAt: '2026-03-01T00:01:00Z',
        },
      ];

      let callNum = 0;
      mocks.db.select.mockImplementation(() => {
        callNum++;
        if (callNum === 1) {
          const chain = {
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            orderBy: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            offset: vi.fn().mockResolvedValue(jobRows),
          };
          return chain;
        }
        if (callNum === 2) {
          const chain = {
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockResolvedValue([{ count: 1 }]),
          };
          return chain;
        }
        const chain = {
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockResolvedValue([]),
        };
        return chain;
      });

      const result = await listAdminUploadJobs({ page: 1, limit: 10 });
      expect(result.data[0].errorReportAvailable).toBe(true);
    });
  });

  describe('getAdminUploadJobDetail', () => {
    it('returns null when job not found', async () => {
      const { getUploadConfirmJobById } = await import('../services/upload-confirm-job-service');
      vi.mocked(getUploadConfirmJobById).mockResolvedValueOnce(null);

      const result = await getAdminUploadJobDetail(999);
      expect(result).toBe(null);
    });

    it('returns detail with pharmacy name', async () => {
      const { getUploadConfirmJobById } = await import('../services/upload-confirm-job-service');
      vi.mocked(getUploadConfirmJobById).mockResolvedValueOnce({
        id: 1,
        pharmacyId: 7,
        uploadType: 'dead_stock',
        originalFilename: 'test.xlsx',
        idempotencyKey: 'key-1',
        fileHash: 'hash123',
        status: 'completed',
        applyMode: 'replace',
        deleteMissing: false,
        attempts: 1,
        lastError: null,
        resultJson: null,
        deduplicated: false,
        cancelRequestedAt: null,
        canceledAt: null,
        canceledBy: null,
        createdAt: '2026-03-01T00:00:00Z',
        updatedAt: '2026-03-01T00:00:00Z',
        completedAt: '2026-03-01T00:01:00Z',
        issueCount: 0,
        cancelable: false,
      });

      const pharmacyChain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([{ name: 'テスト薬局' }]),
      };
      mocks.db.select.mockReturnValue(pharmacyChain);

      const result = await getAdminUploadJobDetail(1);
      expect(result).not.toBeNull();
      expect(result!.pharmacyName).toBe('テスト薬局');
    });
  });

  describe('cancelAdminUploadJob', () => {
    it('delegates to cancelUploadConfirmJobByAdmin', async () => {
      const { cancelUploadConfirmJobByAdmin } = await import('../services/upload-confirm-job-service');
      vi.mocked(cancelUploadConfirmJobByAdmin).mockResolvedValueOnce({
        id: 1,
        status: 'failed',
        canceledAt: '2026-03-01T00:00:00Z',
        cancelRequestedAt: '2026-03-01T00:00:00Z',
        cancelable: false,
      });

      const result = await cancelAdminUploadJob(1, 7);
      expect(result).not.toBeNull();
      expect(result!.status).toBe('failed');
    });
  });

  describe('retryAdminUploadJob', () => {
    it('delegates to retryUploadConfirmJobByAdmin', async () => {
      const { retryUploadConfirmJobByAdmin } = await import('../services/upload-confirm-job-service');
      vi.mocked(retryUploadConfirmJobByAdmin).mockResolvedValueOnce({
        id: 1,
        status: 'pending',
        cancelable: true,
        canceledAt: null,
      });

      const result = await retryAdminUploadJob(1);
      expect(result).not.toBeNull();
      expect(result!.status).toBe('pending');
    });
  });

  describe('getAdminUploadJobErrorReport', () => {
    it('returns null when no issues', async () => {
      const { getUploadRowIssuesForJob } = await import('../services/upload-row-issue-service');
      vi.mocked(getUploadRowIssuesForJob).mockResolvedValueOnce([]);

      const result = await getAdminUploadJobErrorReport(1, 'csv');
      expect(result).toBe(null);
    });

    it('returns CSV format error report', async () => {
      const { getUploadRowIssuesForJob } = await import('../services/upload-row-issue-service');
      vi.mocked(getUploadRowIssuesForJob).mockResolvedValueOnce([
        {
          id: 1,
          jobId: 1,
          pharmacyId: 7,
          uploadType: 'dead_stock' as const,
          rowNumber: 2,
          issueCode: 'INVALID_DATA',
          issueMessage: 'データが不正です',
          rowDataJson: '{}',
          createdAt: '2026-03-01T00:00:00Z',
        },
      ]);

      const result = await getAdminUploadJobErrorReport(1, 'csv');
      expect(result).not.toBeNull();
      expect(result!.contentType).toContain('csv');
      expect(result!.filename).toContain('error-report');
      expect(result!.issueCount).toBe(1);
    });

    it('returns JSON format error report', async () => {
      const { getUploadRowIssuesForJob } = await import('../services/upload-row-issue-service');
      vi.mocked(getUploadRowIssuesForJob).mockResolvedValueOnce([
        {
          id: 1,
          jobId: 1,
          pharmacyId: 7,
          uploadType: 'dead_stock' as const,
          rowNumber: 2,
          issueCode: 'INVALID_DATA',
          issueMessage: 'データが不正です',
          rowDataJson: '{}',
          createdAt: '2026-03-01T00:00:00Z',
        },
      ]);

      const result = await getAdminUploadJobErrorReport(1, 'json');
      expect(result).not.toBeNull();
      expect(result!.contentType).toContain('json');
      expect(result!.filename).toContain('.json');
      const body = JSON.parse(result!.body);
      expect(body.jobId).toBe(1);
      expect(body.issueCount).toBe(1);
    });
  });
});
