/**
 * admin-upload-job-service-final.test.ts
 * Covers uncovered lines in admin-upload-job-service.ts:
 * - parseResultJson: catch branch (line 88) — invalid JSON string
 * - resolveErrorReportAvailable: issueCount > 0 (line 100), errorReportAvailable === true (line 105),
 *   partialSummary not object (line 110), rejectedRows > 0 (line 114)
 * - createWhereConditions: non-canceled status adds isNull conditions (lines 129-131),
 *   applyMode filter (line 138)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
  },
  getUploadRowIssueCountByJobIds: vi.fn(),
  getUploadRowIssueSummary: vi.fn(),
  getUploadRowIssuesForJob: vi.fn(),
  getUploadConfirmJobById: vi.fn(),
  cancelUploadConfirmJobByAdmin: vi.fn(),
  retryUploadConfirmJobByAdmin: vi.fn(),
  isUploadConfirmRetryUnavailableError: vi.fn(),
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
  buildUploadRowIssueCsv: vi.fn().mockReturnValue('rowNumber,issueCode\n'),
  getUploadRowIssueCountByJobIds: (...args: unknown[]) => mocks.getUploadRowIssueCountByJobIds(...args),
  getUploadRowIssueSummary: (...args: unknown[]) => mocks.getUploadRowIssueSummary(...args),
  getUploadRowIssuesForJob: (...args: unknown[]) => mocks.getUploadRowIssuesForJob(...args),
}));

vi.mock('../services/upload-confirm-job-service', () => ({
  cancelUploadConfirmJobByAdmin: (...args: unknown[]) => mocks.cancelUploadConfirmJobByAdmin(...args),
  getUploadConfirmJobById: (...args: unknown[]) => mocks.getUploadConfirmJobById(...args),
  isUploadConfirmRetryUnavailableError: (...args: unknown[]) => mocks.isUploadConfirmRetryUnavailableError(...args),
  retryUploadConfirmJobByAdmin: (...args: unknown[]) => mocks.retryUploadConfirmJobByAdmin(...args),
}));

vi.mock('../utils/db-utils', () => ({
  rowCount: {},
}));

import { listAdminUploadJobs } from '../services/admin-upload-job-service';

// Helper: create a standard DB select chain for listAdminUploadJobs
function createListSelectMock(
  jobRows: unknown[],
  totalCount: number,
  pharmacyRows: unknown[] = [],
) {
  let callNum = 0;
  return () => {
    callNum++;
    if (callNum === 1) {
      // jobs
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                offset: vi.fn().mockResolvedValue(jobRows),
              }),
            }),
          }),
        }),
      };
    }
    if (callNum === 2) {
      // count
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ count: totalCount }]),
        }),
      };
    }
    // pharmacies
    return {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(pharmacyRows),
      }),
    };
  };
}

describe('admin-upload-job-service-final', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUploadRowIssueCountByJobIds.mockResolvedValue(new Map());
    mocks.getUploadRowIssueSummary.mockResolvedValue({ totalIssues: 0, byCode: {} });
    mocks.getUploadRowIssuesForJob.mockResolvedValue([]);
    mocks.isUploadConfirmRetryUnavailableError.mockReturnValue(false);
  });

  describe('parseResultJson — catch branch (line 88)', () => {
    it('returns null when resultJson is invalid JSON (catch path)', async () => {
      // resultJson = 'invalid-json' → JSON.parse throws → returns null (line 88)
      const jobRows = [
        {
          id: 1,
          pharmacyId: 5,
          uploadType: 'dead_stock' as const,
          originalFilename: 'test.xlsx',
          status: 'completed',
          applyMode: 'replace',
          attempts: 1,
          deduplicated: false,
          cancelRequestedAt: null,
          canceledAt: null,
          resultJson: 'invalid-json-string{{{',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
          completedAt: '2026-01-01T00:01:00Z',
        },
      ];

      mocks.db.select.mockImplementation(createListSelectMock(jobRows, 1));

      const result = await listAdminUploadJobs({ page: 1, limit: 10 });
      expect(result.data).toHaveLength(1);
      // parseResultJson returns null for invalid JSON → extractPartialSummary returns null
      expect(result.data[0].partialSummary).toBeNull();
      // resolveErrorReportAvailable(0, null): issueCount = 0, result = null → returns false
      expect(result.data[0].errorReportAvailable).toBe(false);
    });
  });

  describe('resolveErrorReportAvailable — branches (lines 100-114)', () => {
    it('returns true when issueCount > 0 (line 100)', async () => {
      // issueCount > 0 → returns true immediately
      const jobRows = [
        {
          id: 2,
          pharmacyId: 5,
          uploadType: 'dead_stock' as const,
          originalFilename: 'test.xlsx',
          status: 'completed',
          applyMode: 'replace',
          attempts: 1,
          deduplicated: false,
          cancelRequestedAt: null,
          canceledAt: null,
          resultJson: null,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
          completedAt: '2026-01-01T00:01:00Z',
        },
      ];

      mocks.db.select.mockImplementation(createListSelectMock(jobRows, 1));
      // Return issueCount = 3 for job id=2
      mocks.getUploadRowIssueCountByJobIds.mockResolvedValue(new Map([[2, 3]]));

      const result = await listAdminUploadJobs({ page: 1, limit: 10 });
      expect(result.data[0].errorReportAvailable).toBe(true);
    });

    it('returns true when result.errorReportAvailable === true (line 105)', async () => {
      // issueCount = 0, result = { errorReportAvailable: true }
      const jobRows = [
        {
          id: 3,
          pharmacyId: 5,
          uploadType: 'dead_stock' as const,
          originalFilename: 'test.xlsx',
          status: 'completed',
          applyMode: 'replace',
          attempts: 1,
          deduplicated: false,
          cancelRequestedAt: null,
          canceledAt: null,
          resultJson: JSON.stringify({ errorReportAvailable: true }),
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
          completedAt: '2026-01-01T00:01:00Z',
        },
      ];

      mocks.db.select.mockImplementation(createListSelectMock(jobRows, 1));
      // issueCount = 0
      mocks.getUploadRowIssueCountByJobIds.mockResolvedValue(new Map());

      const result = await listAdminUploadJobs({ page: 1, limit: 10 });
      expect(result.data[0].errorReportAvailable).toBe(true);
    });

    it('returns false when partialSummary is not object (line 110)', async () => {
      // issueCount = 0, errorReportAvailable not true, partialSummary = null → returns false
      const jobRows = [
        {
          id: 4,
          pharmacyId: 5,
          uploadType: 'dead_stock' as const,
          originalFilename: 'test.xlsx',
          status: 'completed',
          applyMode: 'replace',
          attempts: 1,
          deduplicated: false,
          cancelRequestedAt: null,
          canceledAt: null,
          resultJson: JSON.stringify({ errorReportAvailable: false, partialSummary: null }),
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
          completedAt: '2026-01-01T00:01:00Z',
        },
      ];

      mocks.db.select.mockImplementation(createListSelectMock(jobRows, 1));
      mocks.getUploadRowIssueCountByJobIds.mockResolvedValue(new Map());

      const result = await listAdminUploadJobs({ page: 1, limit: 10 });
      // partialSummary = null → not object → returns false (line 110)
      expect(result.data[0].errorReportAvailable).toBe(false);
    });

    it('returns true when partialSummary.rejectedRows > 0 (line 114)', async () => {
      // issueCount = 0, errorReportAvailable not set, partialSummary.rejectedRows = 5
      const jobRows = [
        {
          id: 5,
          pharmacyId: 5,
          uploadType: 'dead_stock' as const,
          originalFilename: 'test.xlsx',
          status: 'completed',
          applyMode: 'replace',
          attempts: 1,
          deduplicated: false,
          cancelRequestedAt: null,
          canceledAt: null,
          resultJson: JSON.stringify({ partialSummary: { rejectedRows: 5 } }),
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
          completedAt: '2026-01-01T00:01:00Z',
        },
      ];

      mocks.db.select.mockImplementation(createListSelectMock(jobRows, 1));
      mocks.getUploadRowIssueCountByJobIds.mockResolvedValue(new Map());

      const result = await listAdminUploadJobs({ page: 1, limit: 10 });
      // partialSummary.rejectedRows = 5 > 0 → returns true (line 114)
      expect(result.data[0].errorReportAvailable).toBe(true);
    });
  });

  describe('createWhereConditions — non-canceled status and applyMode (lines 129-138)', () => {
    it('adds isNull conditions when status is "pending" (lines 129-131)', async () => {
      // filters.status = 'pending' (not 'canceled') → else branch: adds eq + 2x isNull
      mocks.db.select.mockImplementation(createListSelectMock([], 0));

      await listAdminUploadJobs({ page: 1, limit: 10, status: 'pending' });

      // isNull should have been called (via drizzle-orm mock)
      const { isNull } = await import('drizzle-orm');
      expect(isNull).toHaveBeenCalled();
    });

    it('adds eq condition when applyMode is specified (line 138)', async () => {
      // filters.applyMode set → conditions.push(eq(...)) for applyMode
      mocks.db.select.mockImplementation(createListSelectMock([], 0));

      await listAdminUploadJobs({ page: 1, limit: 10, applyMode: 'replace' });

      // eq should have been called for applyMode
      const { eq } = await import('drizzle-orm');
      expect(eq).toHaveBeenCalled();
    });

    it('adds isNull conditions when status is "completed" (non-canceled)', async () => {
      mocks.db.select.mockImplementation(createListSelectMock([], 0));

      await listAdminUploadJobs({ page: 1, limit: 10, status: 'completed' });

      const { isNull } = await import('drizzle-orm');
      expect(isNull).toHaveBeenCalled();
    });
  });
});
