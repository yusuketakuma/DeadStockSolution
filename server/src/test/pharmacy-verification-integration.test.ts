import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock setup
const mocks = vi.hoisted(() => ({
  db: {
    update: vi.fn(),
  },
  loggerInfo: vi.fn(),
}));

vi.mock('../config/database', () => ({
  db: mocks.db,
}));

vi.mock('../services/logger', () => ({
  logger: {
    info: mocks.loggerInfo,
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(() => ({})),
}));

import { processVerificationCallback } from '../services/pharmacy-verification-callback-service';
import { canLogin } from '../services/pharmacy-verification-service';

describe('Pharmacy verification integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('processVerificationCallback', () => {
    function createUpdateChain() {
      const chain = {
        set: vi.fn(),
        where: vi.fn(),
      };
      chain.set.mockReturnValue(chain);
      chain.where.mockResolvedValue(undefined);
      return chain;
    }

    it('approves and activates pharmacy', async () => {
      const chain = createUpdateChain();
      mocks.db.update.mockReturnValue(chain);

      const result = await processVerificationCallback({
        pharmacyId: 1,
        requestId: 1,
        approved: true,
        reason: '一致確認済み',
      });

      expect(result.verificationStatus).toBe('verified');
      expect(result.pharmacyId).toBe(1);
      expect(chain.set).toHaveBeenCalledWith(expect.objectContaining({
        verificationStatus: 'verified',
        isActive: true,
      }));
    });

    it('rejects and deactivates pharmacy', async () => {
      const chain = createUpdateChain();
      mocks.db.update.mockReturnValue(chain);

      const result = await processVerificationCallback({
        pharmacyId: 2,
        requestId: 2,
        approved: false,
        reason: '情報不一致',
      });

      expect(result.verificationStatus).toBe('rejected');
      expect(result.pharmacyId).toBe(2);
      expect(chain.set).toHaveBeenCalledWith(expect.objectContaining({
        verificationStatus: 'rejected',
        isActive: false,
        rejectionReason: '情報不一致',
      }));
    });
  });

  describe('canLogin verification gate', () => {
    it('allows verified + active', () => {
      expect(canLogin('verified', true)).toBe(true);
    });

    it('blocks pending_verification', () => {
      expect(canLogin('pending_verification', true)).toBe(false);
    });

    it('allows unverified + active (legacy)', () => {
      expect(canLogin('unverified', true)).toBe(true);
    });

    it('blocks inactive regardless of status', () => {
      expect(canLogin('verified', false)).toBe(false);
    });
  });
});
