import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => {
  const returningFn = vi.fn().mockResolvedValue([{ id: 1 }]);
  const whereFn = vi.fn().mockReturnValue({ returning: returningFn });
  const setFn = vi.fn().mockReturnValue({ where: whereFn });
  const updateFn = vi.fn().mockReturnValue({ set: setFn });
  return {
    db: { update: updateFn },
    set: setFn,
    where: whereFn,
    returning: returningFn,
    logger: { info: vi.fn(), warn: vi.fn() },
  };
});

vi.mock('../config/database', () => ({ db: mocks.db }));
vi.mock('./logger', () => ({ logger: mocks.logger }));

import { processVerificationCallback } from '../services/pharmacy-verification-callback-service';

describe('processVerificationCallback', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('sets verified status on approval', async () => {
    const result = await processVerificationCallback({
      pharmacyId: 1,
      requestId: 10,
      approved: true,
      reason: '薬局名・許可番号一致',
    });
    expect(result.verificationStatus).toBe('verified');
    expect(result.pharmacyId).toBe(1);
    expect(result.applied).toBe(true);
    expect(mocks.set).toHaveBeenCalledWith(expect.objectContaining({
      verificationStatus: 'verified',
      isActive: true,
    }));
  });

  it('sets rejected status on rejection', async () => {
    const result = await processVerificationCallback({
      pharmacyId: 1,
      requestId: 10,
      approved: false,
      reason: '許可番号が見つかりません',
    });
    expect(result.verificationStatus).toBe('rejected');
    expect(result.applied).toBe(true);
    expect(mocks.set).toHaveBeenCalledWith(expect.objectContaining({
      verificationStatus: 'rejected',
      isActive: false,
      rejectionReason: '許可番号が見つかりません',
    }));
  });

  it('returns applied=false when callback is stale', async () => {
    mocks.returning.mockResolvedValueOnce([]);

    const result = await processVerificationCallback({
      pharmacyId: 1,
      requestId: 99,
      approved: true,
      reason: '',
    });

    expect(result).toEqual({
      verificationStatus: 'verified',
      pharmacyId: 1,
      applied: false,
    });
  });
});
