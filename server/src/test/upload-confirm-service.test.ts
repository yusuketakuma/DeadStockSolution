import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    transaction: vi.fn(),
  },
  computeHeaderHash: vi.fn(),
  extractDeadStockRowsWithIssues: vi.fn(),
  extractUsedMedicationRowsWithIssues: vi.fn(),
  enrichWithDrugMaster: vi.fn(),
  triggerMatchingRefreshOnUpload: vi.fn(),
  applyDeadStockDiff: vi.fn(),
  applyUsedMedicationDiff: vi.fn(),
  replaceUploadRowIssuesForJob: vi.fn(),
  clearUploadRowIssuesForJob: vi.fn(),
}));

vi.mock('../config/database', () => ({
  db: mocks.db,
}));

vi.mock('../services/column-mapper', () => ({
  computeHeaderHash: mocks.computeHeaderHash,
}));

vi.mock('../services/data-extractor', () => ({
  extractDeadStockRowsWithIssues: mocks.extractDeadStockRowsWithIssues,
  extractUsedMedicationRowsWithIssues: mocks.extractUsedMedicationRowsWithIssues,
}));

vi.mock('../services/drug-master-enrichment', () => ({
  enrichWithDrugMaster: mocks.enrichWithDrugMaster,
}));

vi.mock('../services/matching-refresh-service', () => ({
  triggerMatchingRefreshOnUpload: mocks.triggerMatchingRefreshOnUpload,
}));

vi.mock('../services/upload-diff-service', () => ({
  applyDeadStockDiff: mocks.applyDeadStockDiff,
  applyUsedMedicationDiff: mocks.applyUsedMedicationDiff,
}));

vi.mock('../services/upload-row-issue-service', () => ({
  replaceUploadRowIssuesForJob: mocks.replaceUploadRowIssuesForJob,
  clearUploadRowIssuesForJob: mocks.clearUploadRowIssuesForJob,
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn(() => ({})),
  desc: vi.fn(() => ({})),
  eq: vi.fn(() => ({})),
  sql: vi.fn(() => ({})),
}));

import { runUploadConfirm } from '../services/upload-confirm-service';

function createLatestUploadSelectChain(requestedAt: string | null) {
  const query = {
    from: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
  };
  query.from.mockReturnValue(query);
  query.where.mockReturnValue(query);
  query.orderBy.mockReturnValue(query);
  query.limit.mockResolvedValue(requestedAt ? [{ id: 99, requestedAt }] : []);
  return query;
}

describe('upload-confirm-service stale guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.computeHeaderHash.mockReturnValue('header-hash');
    mocks.extractDeadStockRowsWithIssues.mockReturnValue({
      rows: [],
      issues: [],
      inspectedRowCount: 0,
    });
    mocks.extractUsedMedicationRowsWithIssues.mockReturnValue({
      rows: [],
      issues: [],
      inspectedRowCount: 0,
    });
    mocks.enrichWithDrugMaster.mockResolvedValue([]);
    mocks.applyDeadStockDiff.mockResolvedValue(null);
    mocks.applyUsedMedicationDiff.mockResolvedValue(null);
  });

  it('skips stale job when latest upload requestedAt equals stale guard time', async () => {
    const staleGuard = '2026-02-28T10:00:00.000Z';
    const tx = {
      execute: vi.fn().mockResolvedValue(undefined),
      select: vi.fn().mockImplementation(() => createLatestUploadSelectChain(staleGuard)),
      insert: vi.fn(),
      delete: vi.fn(),
      update: vi.fn(),
    };
    mocks.db.transaction.mockImplementation(async (callback: (executor: typeof tx) => Promise<unknown>) => callback(tx));

    await expect(runUploadConfirm({
      pharmacyId: 1,
      uploadType: 'dead_stock',
      originalFilename: 'sample.xlsx',
      headerRowIndex: 0,
      mapping: {
        drug_code: '0',
        drug_name: '1',
        quantity: '2',
        unit: '3',
        expiration_date: '4',
      },
      allRows: [['コード', '薬剤名', '数量', '単位', '期限'], ['111', '薬A', 10, '錠', '2026-03-31']],
      applyMode: 'replace',
      deleteMissing: false,
      staleGuardCreatedAt: staleGuard,
    })).rejects.toThrow('[STALE_JOB_SKIPPED]');

    expect(tx.insert).not.toHaveBeenCalled();
  });
});
