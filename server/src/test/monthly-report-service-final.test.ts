/**
 * monthly-report-service-final.test.ts
 * Covers uncovered lines in monthly-report-service.ts:
 * - generateMonthlyReport: lines 165-191 (calls buildMonthlyReportMetrics + db.insert + returns)
 * - escapeCsv: line 258 (branch for values containing [",\n])
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
  },
}));

vi.mock('../config/database', () => ({
  db: mocks.db,
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn(() => ({})),
  desc: vi.fn(() => ({})),
  eq: vi.fn(() => ({})),
  gte: vi.fn(() => ({})),
  lt: vi.fn(() => ({})),
  lte: vi.fn(() => ({})),
  sql: vi.fn(() => ({})),
}));

import {
  generateMonthlyReport,
  monthlyReportToCsv,
  type MonthlyReportMetrics,
} from '../services/monthly-report-service';

// Helper: build a fluent select query chain that resolves to `result`
function createSelectChain(result: unknown) {
  const chain: Record<string, unknown> = {};
  const methods = ['from', 'where', 'orderBy', 'limit', 'offset'];
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  // The terminal call resolves with result
  for (const m of methods) {
    (chain[m] as ReturnType<typeof vi.fn>).mockResolvedValue(result);
    (chain[m] as ReturnType<typeof vi.fn>).mockReturnValue(chain);
  }
  // Make any call on the chain eventually resolve
  Object.defineProperty(chain, 'then', {
    get() { return undefined; },
  });
  return chain;
}

function createInsertChain(result: unknown) {
  const chain: Record<string, unknown> = {};
  chain['values'] = vi.fn().mockReturnValue(chain);
  chain['onConflictDoUpdate'] = vi.fn().mockReturnValue(chain);
  chain['returning'] = vi.fn().mockResolvedValue([result]);
  return chain;
}

describe('monthly-report-service-final', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('generateMonthlyReport (lines 165-191)', () => {
    it('calls buildMonthlyReportMetrics, saves to DB, and returns combined result', async () => {
      // Setup: 10 parallel select calls for buildMonthlyReportMetrics
      // Each returns a count/total row in an array
      const zeroCountRow = [{ count: 0 }];
      const zeroTotalRow = [{ total: 0 }];

      mocks.db.select
        // proposalCount
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(zeroCountRow),
          }),
        })
        // rejectedCount
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(zeroCountRow),
          }),
        })
        // confirmedCount
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(zeroCountRow),
          }),
        })
        // historyCount
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(zeroCountRow),
          }),
        })
        // totalExchangeValue
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(zeroTotalRow),
          }),
        })
        // uploadCount
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(zeroCountRow),
          }),
        })
        // deadStockUploadCount
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(zeroCountRow),
          }),
        })
        // usedMedUploadCount
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(zeroCountRow),
          }),
        })
        // nearExpiryCount
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(zeroCountRow),
          }),
        })
        // expiredCount
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(zeroCountRow),
          }),
        });

      // Setup: insert for saving report
      const savedReport = {
        id: 42,
        year: 2026,
        month: 2,
        generatedAt: '2026-03-01T00:00:00.000Z',
      };
      mocks.db.insert.mockReturnValue(createInsertChain(savedReport));

      const result = await generateMonthlyReport(2026, 2, 1);

      expect(result.id).toBe(42);
      expect(result.year).toBe(2026);
      expect(result.month).toBe(2);
      expect(result.generatedAt).toBe('2026-03-01T00:00:00.000Z');
      expect(result.metrics).toBeDefined();
      expect(result.metrics.proposalCount).toBe(0);
      expect(mocks.db.insert).toHaveBeenCalled();
    });

    it('passes null generatedBy when called with null', async () => {
      const zeroCountRow = [{ count: 0 }];
      const zeroTotalRow = [{ total: 0 }];

      // 10 select calls
      for (let i = 0; i < 8; i++) {
        mocks.db.select.mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(zeroCountRow),
          }),
        });
      }
      mocks.db.select
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(zeroTotalRow),
          }),
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(zeroCountRow),
          }),
        });

      mocks.db.insert.mockReturnValue(createInsertChain({
        id: 10,
        year: 2025,
        month: 12,
        generatedAt: '2026-01-01T00:00:00.000Z',
      }));

      const result = await generateMonthlyReport(2025, 12, null);
      expect(result.id).toBe(10);
    });
  });

  describe('escapeCsv — special char branch (line 258)', () => {
    it('wraps periodStart containing comma in double quotes (escapeCsv branch)', () => {
      // Pass a periodStart value that contains a comma → triggers escapeCsv line 258
      const metrics: MonthlyReportMetrics = {
        year: 2026,
        month: 1,
        periodStart: '2026,01,01', // contains comma → escapeCsv wraps in quotes
        periodEnd: '2026-02-01',
        proposalCount: 0,
        completedExchangeCount: 0,
        rejectedProposalCount: 0,
        confirmedProposalCount: 0,
        totalExchangeValue: 0,
        uploadCount: 0,
        deadStockUploadCount: 0,
        usedMedicationUploadCount: 0,
        nearExpiryItemCount: 0,
        expiredItemCount: 0,
      };
      const csv = monthlyReportToCsv(metrics);
      // periodStart value has commas → should be wrapped in quotes
      expect(csv).toContain('"2026,01,01"');
    });

    it('wraps value containing double-quote in double quotes with escaped quote', () => {
      const metrics: MonthlyReportMetrics = {
        year: 2026,
        month: 1,
        periodStart: '2026-01-01',
        periodEnd: 'end"value', // contains double-quote → escapeCsv wraps and escapes
        proposalCount: 0,
        completedExchangeCount: 0,
        rejectedProposalCount: 0,
        confirmedProposalCount: 0,
        totalExchangeValue: 0,
        uploadCount: 0,
        deadStockUploadCount: 0,
        usedMedicationUploadCount: 0,
        nearExpiryItemCount: 0,
        expiredItemCount: 0,
      };
      const csv = monthlyReportToCsv(metrics);
      // "end"value" → should escape inner quote to ""
      expect(csv).toContain('"end""value"');
    });
  });
});
