import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock all external dependencies before importing the service
vi.mock('../config/database', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    execute: vi.fn(),
    transaction: vi.fn(),
  },
}));

vi.mock('../services/matching-service', () => ({
  findMatches: vi.fn(),
  findMatchesBatch: vi.fn(),
}));

vi.mock('../services/matching-snapshot-service', () => ({
  saveMatchSnapshotAndNotifyOnChange: vi.fn(),
  saveMatchSnapshotsBatch: vi.fn(),
}));

vi.mock('../db/materialized-views', () => ({
  refreshDrugAvailabilitySummary: vi.fn(),
}));

vi.mock('../services/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../services/notification-service', () => ({
  createNotification: vi.fn().mockResolvedValue(undefined),
}));

import { saveMatchSnapshotAndNotifyOnChange, saveMatchSnapshotsBatch } from '../services/matching-snapshot-service';
import { logger } from '../services/logger';
import { db } from '../config/database';

const mockSaveMatchSnapshotAndNotifyOnChange = vi.mocked(saveMatchSnapshotAndNotifyOnChange);
const mockSaveMatchSnapshotsBatch = vi.mocked(saveMatchSnapshotsBatch);
const mockLogger = vi.mocked(logger);
const mockDb = vi.mocked(db);

// Helper: set up db.select mock for a given set of pharmacy IDs.
//
// Call order of db.select() in runSingleRefresh flow:
//   index 0: resolveImpactedPharmacyIds outer query   → awaited → pharmacyRows
//   index 1: deadStockItems exists subquery            → NOT awaited (built synchronously)
//   index 2: usedMedicationItems exists subquery       → NOT awaited
//   index 3: uploadJobs exists subquery                → NOT awaited
//   index 4: fetchNotifyEnabledMap                     → awaited → notifyRows
//   index 5: triggerSnapshot (after loop)              → awaited .limit(1)
//
// Subquery builders (1-3) need a chain but never get awaited.
function setupDbMocks(pharmacyIds: number[]) {
  const pharmacyRows = pharmacyIds.map((id) => ({ id }));
  const notifyRows = pharmacyIds.map((id) => ({ id, matchingAutoNotifyEnabled: true }));

  let callIndex = 0;

   
  (mockDb.select as any).mockImplementation(() => {
    const idx = callIndex++;

    if (idx === 0) {
      // resolveImpactedPharmacyIds outer query
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(pharmacyRows),
        }),
      };
    }

    if (idx >= 1 && idx <= 3) {
      // exists() subquery builders — synchronously built, never awaited
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnThis(),
        }),
      };
    }

    if (idx === 4) {
      // fetchNotifyEnabledMap
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(notifyRows),
        }),
      };
    }

    // idx >= 5: triggerSnapshot query (uses .limit(1))
    return {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ candidateCount: 5 }]),
        }),
      }),
    };
  });
}

describe('persistSnapshotEntries fallback parallel execution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('processes entries in parallel batches when batch save fails', async () => {
    const { findMatchesBatch } = await import('../services/matching-service');
    const mockFindMatchesBatch = vi.mocked(findMatchesBatch);

    const pharmacyIds = [10, 20, 30, 40, 50, 60, 70, 80]; // 8 entries → 2 batches of 5 and 3

    let concurrentCount = 0;
    let maxConcurrent = 0;

    // Batch save always fails → triggers fallback per-pharmacy parallel path
    mockSaveMatchSnapshotsBatch.mockRejectedValue(new Error('batch fail'));

    // Individual saves succeed but have async delay so we can detect concurrency
    mockSaveMatchSnapshotAndNotifyOnChange.mockImplementation(async (entry) => {
      concurrentCount += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrentCount);
      await new Promise((resolve) => setTimeout(resolve, 10));
      concurrentCount -= 1;
      return { changed: true, beforeCount: 0, afterCount: 1 };
    });

    setupDbMocks(pharmacyIds);

    mockFindMatchesBatch.mockResolvedValue(
      new Map(pharmacyIds.map((id) => [id, []])) as never,
    );

    const { __testables } = await import('../services/matching-refresh-service');
    // triggerPharmacyId=10 is already in pharmacyIds → Set stays at 8
    await __testables.runSingleRefresh(10, 'dead_stock');

    // All 8 entries saved individually (batch failed)
    expect(mockSaveMatchSnapshotAndNotifyOnChange).toHaveBeenCalledTimes(8);

    // Parallelism within a batch: max concurrent > 1 due to 10ms delay
    expect(maxConcurrent).toBeGreaterThan(1);
    // CONCURRENCY cap of 5 is respected
    expect(maxConcurrent).toBeLessThanOrEqual(5);
  });

  it('does not let one entry failure prevent others from being saved', async () => {
    const { findMatchesBatch } = await import('../services/matching-service');
    const mockFindMatchesBatch = vi.mocked(findMatchesBatch);

    const pharmacyIds = [10, 20, 30];

    mockSaveMatchSnapshotsBatch.mockRejectedValue(new Error('batch fail'));

    // Entry pharmacyId=20 always throws; others succeed
    mockSaveMatchSnapshotAndNotifyOnChange.mockImplementation(async (entry) => {
      if ((entry as { pharmacyId: number }).pharmacyId === 20) {
        throw new Error('individual save failed');
      }
      return { changed: true, beforeCount: 0, afterCount: 1 };
    });

    setupDbMocks(pharmacyIds);

    mockFindMatchesBatch.mockResolvedValue(
      new Map(pharmacyIds.map((id) => [id, []])) as never,
    );

    const { __testables } = await import('../services/matching-refresh-service');

    // runSingleRefresh throws because failedPharmacyIds contains 20
    // triggerPharmacyId=10 is already in the list → Set stays at 3
    await expect(__testables.runSingleRefresh(10, 'dead_stock')).rejects.toThrow('20');

    // Pharmacies 10 and 30 were still saved
    const savedIds = mockSaveMatchSnapshotAndNotifyOnChange.mock.calls.map(
      (call) => (call[0] as { pharmacyId: number }).pharmacyId,
    );
    expect(savedIds).toContain(10);
    expect(savedIds).toContain(30);

    // Failure for pharmacy 20 was logged
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('Matching auto refresh failed for pharmacy'),
      expect.objectContaining({ pharmacyId: 20 }),
    );
  });

  it('respects CONCURRENCY=5 limit: peak in-flight never exceeds 5', async () => {
    const { findMatchesBatch } = await import('../services/matching-service');
    const mockFindMatchesBatch = vi.mocked(findMatchesBatch);

    const pharmacyIds = [1, 2, 3, 4, 5, 6, 7]; // 7 entries → batch 1 of 5, batch 2 of 2

    const peakCounts: number[] = [];
    let inFlight = 0;

    mockSaveMatchSnapshotsBatch.mockRejectedValue(new Error('batch fail'));

    mockSaveMatchSnapshotAndNotifyOnChange.mockImplementation(async (entry) => {
      inFlight += 1;
      peakCounts.push(inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return { changed: (entry as { pharmacyId: number }).pharmacyId % 2 === 0, beforeCount: 0, afterCount: 1 };
    });

    setupDbMocks(pharmacyIds);

    mockFindMatchesBatch.mockResolvedValue(
      new Map(pharmacyIds.map((id) => [id, []])) as never,
    );

    const { __testables } = await import('../services/matching-refresh-service');
    // triggerPharmacyId=1 is already in pharmacyIds → Set stays at 7
    await __testables.runSingleRefresh(1, 'dead_stock');

    // All 7 entries processed
    expect(mockSaveMatchSnapshotAndNotifyOnChange).toHaveBeenCalledTimes(7);

    // Peak concurrency never exceeds CONCURRENCY=5
    expect(Math.max(...peakCounts)).toBeLessThanOrEqual(5);
  });
});
