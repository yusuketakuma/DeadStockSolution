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
  invalidateAdminRiskSnapshotCache: vi.fn(),
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

vi.mock('../services/expiry-risk-service', () => ({
  invalidateAdminRiskSnapshotCache: mocks.invalidateAdminRiskSnapshotCache,
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn(() => ({})),
  desc: vi.fn(() => ({})),
  eq: vi.fn(() => ({})),
  sql: vi.fn(() => ({})),
}));

import { runUploadConfirm } from '../services/upload-confirm-service';

function createTx() {
  const insertReturning = vi.fn().mockResolvedValue([{ id: 1 }]);
  const insertValues = vi.fn().mockReturnValue({ returning: insertReturning });
  const insertOnConflict = vi.fn().mockResolvedValue(undefined);
  const onConflictInsertValues = vi.fn().mockReturnValue({ onConflictDoUpdate: insertOnConflict });

  const tx = {
    execute: vi.fn().mockResolvedValue(undefined),
    select: vi.fn(),
    insert: vi.fn().mockImplementation(() => ({
      values: vi.fn().mockImplementation((vals) => {
        if (vals && typeof vals === 'object' && 'pharmacyId' in vals && 'uploadType' in vals && 'headerHash' in vals) {
          return { onConflictDoUpdate: insertOnConflict };
        }
        if (vals && typeof vals === 'object' && 'pharmacyId' in vals && 'uploadType' in vals && 'originalFilename' in vals) {
          return { returning: insertReturning };
        }
        return { returning: vi.fn().mockResolvedValue([{ id: 1 }]) };
      }),
    })),
    update: vi.fn().mockImplementation(() => ({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    })),
    delete: vi.fn().mockImplementation(() => ({
      where: vi.fn().mockResolvedValue(undefined),
    })),
  };
  return tx;
}

const baseMapping = {
  drug_code: '0',
  drug_name: '1',
  quantity: '2',
  unit: '3',
  expiration_date: '4',
};

const baseRows = [['コード', '薬剤名', '数量', '単位', '期限'], ['111', '薬A', 10, '錠', '2026-03-31']];

describe('upload-confirm-service ultra coverage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.computeHeaderHash.mockReturnValue('hash-abc');
    mocks.extractDeadStockRowsWithIssues.mockReturnValue({
      rows: [{ drugCode: '111', drugName: '薬A', quantity: 10, unit: '錠', yakkaUnitPrice: null, yakkaTotal: null, expirationDate: '2026-03-31', lotNumber: null }],
      issues: [],
      inspectedRowCount: 1,
    });
    mocks.extractUsedMedicationRowsWithIssues.mockReturnValue({
      rows: [{ drugCode: '222', drugName: '薬B', monthlyUsage: 5, unit: '錠', yakkaUnitPrice: null }],
      issues: [],
      inspectedRowCount: 1,
    });
    mocks.enrichWithDrugMaster.mockImplementation(async (rows: unknown[]) => rows);
    mocks.triggerMatchingRefreshOnUpload.mockResolvedValue(undefined);
    mocks.applyDeadStockDiff.mockResolvedValue({ totalIncoming: 1, added: 1, updated: 0, deleted: 0, unchanged: 0 });
    mocks.applyUsedMedicationDiff.mockResolvedValue({ totalIncoming: 1, added: 1, updated: 0, deleted: 0, unchanged: 0 });
    mocks.invalidateAdminRiskSnapshotCache.mockReturnValue(undefined);
  });

  it('throws when headerRowIndex is negative', async () => {
    await expect(runUploadConfirm({
      pharmacyId: 1,
      uploadType: 'dead_stock',
      originalFilename: 'test.xlsx',
      headerRowIndex: -1,
      mapping: baseMapping,
      allRows: baseRows,
      applyMode: 'replace',
      deleteMissing: false,
    })).rejects.toThrow('ヘッダー行指定が不正です');
  });

  it('throws when headerRowIndex >= allRows.length', async () => {
    await expect(runUploadConfirm({
      pharmacyId: 1,
      uploadType: 'dead_stock',
      originalFilename: 'test.xlsx',
      headerRowIndex: 5,
      mapping: baseMapping,
      allRows: baseRows,
      applyMode: 'replace',
      deleteMissing: false,
    })).rejects.toThrow('ヘッダー行指定が不正です');
  });

  it('processes dead_stock in diff mode', async () => {
    const tx = createTx();
    mocks.db.transaction.mockImplementation(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx));

    const result = await runUploadConfirm({
      pharmacyId: 1,
      uploadType: 'dead_stock',
      originalFilename: 'test.xlsx',
      headerRowIndex: 0,
      mapping: baseMapping,
      allRows: baseRows,
      applyMode: 'diff',
      deleteMissing: true,
    });

    expect(mocks.applyDeadStockDiff).toHaveBeenCalled();
    expect(result.diffSummary).toBeTruthy();
  });

  it('processes used_medication in replace mode', async () => {
    const tx = createTx();
    mocks.db.transaction.mockImplementation(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx));

    const result = await runUploadConfirm({
      pharmacyId: 1,
      uploadType: 'used_medication',
      originalFilename: 'test.xlsx',
      headerRowIndex: 0,
      mapping: {
        drug_code: '0',
        drug_name: '1',
        monthly_usage: '2',
        unit: '3',
      },
      allRows: [['コード', '薬剤名', '使用量', '単位'], ['222', '薬B', 5, '錠']],
      applyMode: 'replace',
      deleteMissing: false,
    });

    expect(result.uploadId).toBeDefined();
    expect(result.diffSummary).toBeNull();
  });

  it('processes used_medication in diff mode', async () => {
    const tx = createTx();
    mocks.db.transaction.mockImplementation(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx));

    const result = await runUploadConfirm({
      pharmacyId: 1,
      uploadType: 'used_medication',
      originalFilename: 'test.xlsx',
      headerRowIndex: 0,
      mapping: {
        drug_code: '0',
        drug_name: '1',
        monthly_usage: '2',
        unit: '3',
      },
      allRows: [['コード', '薬剤名', '使用量', '単位'], ['222', '薬B', 5, '錠']],
      applyMode: 'diff',
      deleteMissing: false,
    });

    expect(mocks.applyUsedMedicationDiff).toHaveBeenCalled();
    expect(result.diffSummary).toBeTruthy();
  });

  it('processes partial mode and builds partialSummary', async () => {
    mocks.extractDeadStockRowsWithIssues.mockReturnValue({
      rows: [{ drugCode: '111', drugName: '薬A', quantity: 10, unit: '錠', yakkaUnitPrice: null, yakkaTotal: null, expirationDate: '2026-03-31', lotNumber: null }],
      issues: [
        { rowNumber: 2, issueCode: 'MISSING_QUANTITY', issueMessage: '数量が不足', rowData: {} },
      ],
      inspectedRowCount: 2,
    });

    const tx = createTx();
    mocks.db.transaction.mockImplementation(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx));

    const result = await runUploadConfirm({
      pharmacyId: 1,
      uploadType: 'dead_stock',
      originalFilename: 'test.xlsx',
      jobId: 42,
      headerRowIndex: 0,
      mapping: baseMapping,
      allRows: baseRows,
      applyMode: 'partial',
      deleteMissing: false,
    });

    expect(result.partialSummary).toBeTruthy();
    expect(result.partialSummary!.inspectedRows).toBe(2);
    expect(result.partialSummary!.acceptedRows).toBe(1);
    expect(result.partialSummary!.rejectedRows).toBe(1);
    expect(result.partialSummary!.issueCounts).toEqual({ MISSING_QUANTITY: 1 });
    expect(mocks.replaceUploadRowIssuesForJob).toHaveBeenCalled();
  });

  it('clears row issues for non-partial mode with jobId', async () => {
    const tx = createTx();
    mocks.db.transaction.mockImplementation(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx));

    await runUploadConfirm({
      pharmacyId: 1,
      uploadType: 'dead_stock',
      originalFilename: 'test.xlsx',
      jobId: 42,
      headerRowIndex: 0,
      mapping: baseMapping,
      allRows: baseRows,
      applyMode: 'replace',
      deleteMissing: false,
    });

    expect(mocks.clearUploadRowIssuesForJob).toHaveBeenCalledWith(42, expect.anything());
  });

  it('skips stale guard check when staleGuardCreatedAt is null', async () => {
    const tx = createTx();
    mocks.db.transaction.mockImplementation(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx));

    const result = await runUploadConfirm({
      pharmacyId: 1,
      uploadType: 'dead_stock',
      originalFilename: 'test.xlsx',
      headerRowIndex: 0,
      mapping: baseMapping,
      allRows: baseRows,
      applyMode: 'replace',
      deleteMissing: false,
      staleGuardCreatedAt: null,
    });

    expect(result.uploadId).toBeDefined();
  });

  it('passes stale guard when staleGuardCreatedAt is newer than latest upload', async () => {
    const tx = createTx();
    // Mock the latest upload query to return an older upload
    const latestSelectChain = {
      from: vi.fn(),
      where: vi.fn(),
      orderBy: vi.fn(),
      limit: vi.fn(),
    };
    latestSelectChain.from.mockReturnValue(latestSelectChain);
    latestSelectChain.where.mockReturnValue(latestSelectChain);
    latestSelectChain.orderBy.mockReturnValue(latestSelectChain);
    latestSelectChain.limit.mockResolvedValue([{ id: 50, requestedAt: '2026-02-27T09:00:00.000Z' }]);

    tx.select = vi.fn().mockImplementation(() => latestSelectChain);

    mocks.db.transaction.mockImplementation(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx));

    const result = await runUploadConfirm({
      pharmacyId: 1,
      uploadType: 'dead_stock',
      originalFilename: 'test.xlsx',
      headerRowIndex: 0,
      mapping: baseMapping,
      allRows: baseRows,
      applyMode: 'replace',
      deleteMissing: false,
      staleGuardCreatedAt: '2026-02-28T10:00:00.000Z',
    });

    expect(result.uploadId).toBeDefined();
  });

  it('handles used_medication in partial mode', async () => {
    mocks.extractUsedMedicationRowsWithIssues.mockReturnValue({
      rows: [{ drugCode: '222', drugName: '薬B', monthlyUsage: 5, unit: '錠', yakkaUnitPrice: null }],
      issues: [],
      inspectedRowCount: 1,
    });

    const tx = createTx();
    mocks.db.transaction.mockImplementation(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx));

    const result = await runUploadConfirm({
      pharmacyId: 1,
      uploadType: 'used_medication',
      originalFilename: 'test.xlsx',
      headerRowIndex: 0,
      mapping: {
        drug_code: '0',
        drug_name: '1',
        monthly_usage: '2',
        unit: '3',
      },
      allRows: [['コード', '薬剤名', '使用量', '単位'], ['222', '薬B', 5, '錠']],
      applyMode: 'partial',
      deleteMissing: false,
    });

    expect(result.partialSummary).toBeTruthy();
    expect(result.partialSummary!.rejectedRows).toBe(0);
  });
});
