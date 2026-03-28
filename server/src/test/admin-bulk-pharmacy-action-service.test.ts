import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    transaction: vi.fn(),
  },
  invalidateAuthUserCache: vi.fn(),
  recordAuditLog: vi.fn(),
  logger: {
    error: vi.fn(),
  },
}));

vi.mock('../config/database', () => ({ db: mocks.db }));
vi.mock('../middleware/auth', () => ({
  invalidateAuthUserCache: mocks.invalidateAuthUserCache,
}));
vi.mock('../services/audit-log-service', () => ({
  recordAuditLog: mocks.recordAuditLog,
}));
vi.mock('../services/logger', () => ({
  logger: mocks.logger,
}));
vi.mock('drizzle-orm', () => ({
  eq: vi.fn(() => ({})),
  inArray: vi.fn(() => ({})),
}));

import { executeBulkPharmacyAction } from '../services/admin-bulk-pharmacy-action-service';

function buildTransaction(targets: Array<{ id: number; verificationStatus?: string | null; isActive?: boolean | null }>) {
  const selectWhere = vi.fn().mockResolvedValue(targets);
  const selectFrom = vi.fn().mockReturnValue({ where: selectWhere });
  const select = vi.fn().mockReturnValue({ from: selectFrom });
  const updateWhere = vi.fn().mockResolvedValue(undefined);
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
  const update = vi.fn().mockReturnValue({ set: updateSet });

  return {
    tx: { select, update },
    spies: { select, update, updateSet, updateWhere },
  };
}

describe('admin-bulk-pharmacy-action-service', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.recordAuditLog.mockResolvedValue(undefined);
  });

  it('verifies pending pharmacies and records audit logs', async () => {
    const { tx, spies } = buildTransaction([
      { id: 1, verificationStatus: 'pending_verification', isActive: false },
    ]);
    mocks.db.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => await callback(tx));

    const result = await executeBulkPharmacyAction({
      adminId: 10,
      pharmacyIds: [1],
      action: 'verify',
    });

    expect(result.succeeded).toBe(1);
    expect(spies.update).toHaveBeenCalled();
    expect(mocks.invalidateAuthUserCache).toHaveBeenCalledWith(1);
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      adminId: 10,
      targetPharmacyId: 1,
      action: 'verify',
      newStatus: 'verified',
    }));
  });

  it('skips already verified pharmacies without updating', async () => {
    const { tx, spies } = buildTransaction([
      { id: 1, verificationStatus: 'verified', isActive: true },
    ]);
    mocks.db.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => await callback(tx));

    const result = await executeBulkPharmacyAction({
      adminId: 10,
      pharmacyIds: [1],
      action: 'verify',
    });

    expect(result.succeeded).toBe(1);
    expect(spies.update).not.toHaveBeenCalled();
  });

  it('skips already rejected pharmacies without updating', async () => {
    const { tx, spies } = buildTransaction([
      { id: 1, verificationStatus: 'rejected', isActive: false },
    ]);
    mocks.db.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => await callback(tx));

    const result = await executeBulkPharmacyAction({
      adminId: 10,
      pharmacyIds: [1],
      action: 'reject',
      reason: '不適切',
    });

    expect(result.succeeded).toBe(1);
    expect(spies.update).not.toHaveBeenCalled();
  });

  it('activates inactive pharmacies', async () => {
    const { tx, spies } = buildTransaction([
      { id: 5, verificationStatus: 'verified', isActive: false },
    ]);
    mocks.db.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => await callback(tx));

    const result = await executeBulkPharmacyAction({
      adminId: 10,
      pharmacyIds: [5],
      action: 'activate',
    });

    expect(result.succeeded).toBe(1);
    expect(spies.update).toHaveBeenCalled();
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'activate',
      newStatus: 'active',
    }));
  });

  it('throws when a requested pharmacy does not exist', async () => {
    const { tx } = buildTransaction([]);
    mocks.db.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => await callback(tx));

    await expect(executeBulkPharmacyAction({
      adminId: 10,
      pharmacyIds: [999],
      action: 'reject',
      reason: '不適切',
    })).rejects.toThrow('薬局ID:999 が見つかりません');
  });
});
