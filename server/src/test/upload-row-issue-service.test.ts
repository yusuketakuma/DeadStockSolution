import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Hoisted mocks ──────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('../config/database', () => ({
  db: mocks.db,
}));

vi.mock('drizzle-orm', () => ({
  asc: vi.fn((col: unknown) => col),
  desc: vi.fn((col: unknown) => col),
  eq: vi.fn(() => ({})),
  inArray: vi.fn(() => ({})),
}));

vi.mock('../utils/db-utils', () => ({
  rowCount: vi.fn(),
}));

import {
  replaceUploadRowIssuesForJob,
  clearUploadRowIssuesForJob,
  getUploadRowIssueCountByJobIds,
  getUploadRowIssueCountByJobId,
  getUploadRowIssuesForJob,
  getUploadRowIssueSummary,
  getUploadRowIssueSummaryByJobIds,
  buildUploadRowIssueCsv,
} from '../services/upload-row-issue-service';

function createSelectChain(result: unknown[]) {
  const chain = {
    from: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    offset: vi.fn(),
    groupBy: vi.fn(),
  };
  chain.from.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.orderBy.mockReturnValue(chain);
  chain.limit.mockReturnValue(chain);
  chain.offset.mockResolvedValue(result);
  // groupBy can be terminal (for aggregate queries) or chained
  chain.groupBy.mockImplementation(() => {
    // Return a promise-like that resolves to result but also has orderBy chain
    const grouped = {
      orderBy: vi.fn().mockResolvedValue(result),
      then: (resolve: (value: unknown) => void) => Promise.resolve(result).then(resolve),
    };
    return grouped;
  });
  return chain;
}

describe('upload-row-issue-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('replaceUploadRowIssuesForJob', () => {
    it('deletes existing issues and inserts new ones', async () => {
      mocks.db.delete.mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      });
      mocks.db.insert.mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined),
      });

      await replaceUploadRowIssuesForJob(1, 7, 'dead_stock', [
        {
          rowNumber: 2,
          issueCode: 'INVALID',
          issueMessage: 'Invalid data',
          rowData: { key: 'value' },
        },
      ]);

      expect(mocks.db.delete).toHaveBeenCalled();
      expect(mocks.db.insert).toHaveBeenCalled();
    });

    it('only deletes when issues array is empty', async () => {
      mocks.db.delete.mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      });

      await replaceUploadRowIssuesForJob(1, 7, 'dead_stock', []);

      expect(mocks.db.delete).toHaveBeenCalled();
      expect(mocks.db.insert).not.toHaveBeenCalled();
    });

    it('handles null rowData', async () => {
      mocks.db.delete.mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      });
      mocks.db.insert.mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined),
      });

      await replaceUploadRowIssuesForJob(1, 7, 'dead_stock', [
        {
          rowNumber: 1,
          issueCode: 'ERR',
          issueMessage: 'Error',
          rowData: null,
        },
      ]);

      expect(mocks.db.insert).toHaveBeenCalled();
    });

    it('handles array rowData', async () => {
      mocks.db.delete.mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      });
      mocks.db.insert.mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined),
      });

      await replaceUploadRowIssuesForJob(1, 7, 'dead_stock', [
        {
          rowNumber: 1,
          issueCode: 'ERR',
          issueMessage: 'Error',
          rowData: ['a', 'b', 'c'],
        },
      ]);

      expect(mocks.db.insert).toHaveBeenCalled();
    });

    it('batches inserts when over 500 issues', async () => {
      mocks.db.delete.mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      });
      mocks.db.insert.mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined),
      });

      const issues = Array.from({ length: 600 }, (_, i) => ({
        rowNumber: i + 1,
        issueCode: 'ERR',
        issueMessage: `Error ${i}`,
        rowData: null,
      }));

      await replaceUploadRowIssuesForJob(1, 7, 'dead_stock', issues);

      // Should be called twice (500 + 100)
      expect(mocks.db.insert).toHaveBeenCalledTimes(2);
    });
  });

  describe('clearUploadRowIssuesForJob', () => {
    it('deletes all issues for a job', async () => {
      mocks.db.delete.mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      });

      await clearUploadRowIssuesForJob(1);
      expect(mocks.db.delete).toHaveBeenCalled();
    });
  });

  describe('getUploadRowIssueCountByJobIds', () => {
    it('returns empty map for empty jobIds', async () => {
      const result = await getUploadRowIssueCountByJobIds([]);
      expect(result.size).toBe(0);
    });

    it('returns count map for valid jobIds', async () => {
      const mockResult = [
        { jobId: 1, count: 5 },
        { jobId: 2, count: 3 },
      ];
      const chain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        groupBy: vi.fn().mockResolvedValue(mockResult),
      };
      mocks.db.select.mockReturnValue(chain);

      const result = await getUploadRowIssueCountByJobIds([1, 2]);
      expect(result.get(1)).toBe(5);
      expect(result.get(2)).toBe(3);
    });
  });

  describe('getUploadRowIssueCountByJobId', () => {
    it('returns count for a single job', async () => {
      mocks.db.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ count: 10 }]),
        }),
      });

      const result = await getUploadRowIssueCountByJobId(1);
      expect(result).toBe(10);
    });

    it('returns 0 when no row returned', async () => {
      mocks.db.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      });

      const result = await getUploadRowIssueCountByJobId(1);
      expect(result).toBe(0);
    });
  });

  describe('getUploadRowIssuesForJob', () => {
    it('returns issues with default limit/offset', async () => {
      const selectChain = createSelectChain([
        {
          id: 1,
          jobId: 1,
          pharmacyId: 7,
          uploadType: 'dead_stock',
          rowNumber: 2,
          issueCode: 'ERR',
          issueMessage: 'Error',
          rowDataJson: '{}',
          createdAt: '2026-03-01',
        },
      ]);
      mocks.db.select.mockReturnValue(selectChain);

      const result = await getUploadRowIssuesForJob(1);
      expect(result).toHaveLength(1);
    });

    it('applies custom limit and offset', async () => {
      const selectChain = createSelectChain([]);
      mocks.db.select.mockReturnValue(selectChain);

      const result = await getUploadRowIssuesForJob(1, { limit: 5, offset: 10 });
      expect(result).toHaveLength(0);
    });
  });

  describe('getUploadRowIssueSummary', () => {
    it('returns summary with issue counts by code', async () => {
      const mockResult = [
        { issueCode: 'INVALID_DATA', count: 5 },
        { issueCode: 'MISSING_FIELD', count: 3 },
      ];
      const chain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        groupBy: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockResolvedValue(mockResult),
      };
      mocks.db.select.mockReturnValue(chain);

      const result = await getUploadRowIssueSummary(1);
      expect(result.totalIssues).toBe(8);
      expect(result.byCode.INVALID_DATA).toBe(5);
      expect(result.byCode.MISSING_FIELD).toBe(3);
    });

    it('returns zero totals when no issues', async () => {
      const chain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        groupBy: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockResolvedValue([]),
      };
      mocks.db.select.mockReturnValue(chain);

      const result = await getUploadRowIssueSummary(1);
      expect(result.totalIssues).toBe(0);
      expect(Object.keys(result.byCode)).toHaveLength(0);
    });
  });

  describe('getUploadRowIssueSummaryByJobIds', () => {
    it('returns empty map for empty jobIds', async () => {
      const result = await getUploadRowIssueSummaryByJobIds([]);
      expect(result.size).toBe(0);
    });

    it('returns summaries grouped by jobId', async () => {
      const mockResult = [
        { jobId: 1, issueCode: 'ERR_A', count: 2 },
        { jobId: 1, issueCode: 'ERR_B', count: 3 },
        { jobId: 2, issueCode: 'ERR_A', count: 1 },
      ];
      const chain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        groupBy: vi.fn().mockResolvedValue(mockResult),
      };
      mocks.db.select.mockReturnValue(chain);

      const result = await getUploadRowIssueSummaryByJobIds([1, 2]);
      expect(result.get(1)!.totalIssues).toBe(5);
      expect(result.get(2)!.totalIssues).toBe(1);
    });
  });

  describe('buildUploadRowIssueCsv', () => {
    it('builds CSV with headers and data rows', () => {
      const csv = buildUploadRowIssueCsv([
        {
          id: 1,
          jobId: 1,
          pharmacyId: 7,
          uploadType: 'dead_stock' as const,
          rowNumber: 2,
          issueCode: 'INVALID',
          issueMessage: 'Invalid data',
          rowDataJson: '{"key":"value"}',
          createdAt: '2026-03-01',
        },
      ]);

      expect(csv).toContain('rowNumber,issueCode,issueMessage,rowDataJson');
      expect(csv).toContain('2,INVALID,Invalid data');
    });

    it('escapes CSV fields with special characters', () => {
      const csv = buildUploadRowIssueCsv([
        {
          id: 1,
          jobId: 1,
          pharmacyId: 7,
          uploadType: 'dead_stock' as const,
          rowNumber: 2,
          issueCode: 'ERR',
          issueMessage: 'has, comma',
          rowDataJson: null,
          createdAt: '2026-03-01',
        },
      ]);

      expect(csv).toContain('"has, comma"');
    });

    it('prefixes fields starting with dangerous characters', () => {
      const csv = buildUploadRowIssueCsv([
        {
          id: 1,
          jobId: 1,
          pharmacyId: 7,
          uploadType: 'dead_stock' as const,
          rowNumber: 2,
          issueCode: '=FORMULA',
          issueMessage: '+command',
          rowDataJson: null,
          createdAt: '2026-03-01',
        },
      ]);

      expect(csv).toContain("'=FORMULA");
      expect(csv).toContain("'+command");
    });

    it('handles empty issues array', () => {
      const csv = buildUploadRowIssueCsv([]);
      expect(csv).toBe('rowNumber,issueCode,issueMessage,rowDataJson');
    });

    it('handles null rowDataJson', () => {
      const csv = buildUploadRowIssueCsv([
        {
          id: 1,
          jobId: 1,
          pharmacyId: 7,
          uploadType: 'dead_stock' as const,
          rowNumber: 1,
          issueCode: 'ERR',
          issueMessage: 'Error',
          rowDataJson: null,
          createdAt: '2026-03-01',
        },
      ]);

      const lines = csv.split('\n');
      expect(lines).toHaveLength(2);
    });
  });
});
