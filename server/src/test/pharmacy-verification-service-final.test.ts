/**
 * pharmacy-verification-service-final.test.ts
 * Covers uncovered lines in pharmacy-verification-service.ts:
 * - triggerReverification: reuse existing request (lines 111-126)
 * - triggerReverification: no id returned from insert → throw (line 137)
 * - triggerReverification: handoff not accepted → logger.warn (line 155)
 * - triggerReverification: handoff catch → logger.error (line 163)
 * - triggerReverification: outer catch → fallback update fails → logger.error (line 181)
 * - triggerReverification: rethrow ReverificationTriggerError (line 193)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  },
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
  handoffToOpenClaw: vi.fn(),
  isPositiveSafeInteger: vi.fn(),
  getErrorMessage: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
}));

vi.mock('../config/database', () => ({ db: mocks.db }));
vi.mock('../services/logger', () => ({ logger: mocks.logger }));
vi.mock('../services/openclaw-service', () => ({
  handoffToOpenClaw: (...args: unknown[]) => mocks.handoffToOpenClaw(...args),
}));
vi.mock('../utils/request-utils', () => ({
  isPositiveSafeInteger: (v: unknown) => mocks.isPositiveSafeInteger(v),
}));
vi.mock('../middleware/error-handler', () => ({
  getErrorMessage: (e: unknown) => mocks.getErrorMessage(e),
}));
vi.mock('drizzle-orm', () => ({
  eq: vi.fn(() => ({})),
}));

import {
  triggerReverification,
  ReverificationTriggerError,
} from '../services/pharmacy-verification-service';

describe('pharmacy-verification-service-final', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: isPositiveSafeInteger returns false (no reuse)
    mocks.isPositiveSafeInteger.mockReturnValue(false);
    // Default: handoff succeeds and is accepted
    mocks.handoffToOpenClaw.mockResolvedValue({ accepted: true });
    // Default: update succeeds
    const updateChain = {
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    };
    mocks.db.update.mockReturnValue(updateChain);
    // Default: insert returns valid id
    const insertChain = {
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: 100 }]),
      }),
    };
    mocks.db.insert.mockReturnValue(insertChain);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('triggerReverification — reuse existing request (lines 111-126)', () => {
    it('reuses existing request when requestText matches and not completed', async () => {
      // isPositiveSafeInteger(currentReqId) = true → DB select runs
      mocks.isPositiveSafeInteger.mockReturnValue(true);

      const requestPayload = {
        type: 'pharmacy_reverification',
        changedFields: ['name'],
      };
      const requestText = JSON.stringify(requestPayload);

      // DB select returns existing request with matching requestText and non-completed status
      mocks.db.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([
              {
                id: 77,
                requestText,
                openclawStatus: 'pending',
              },
            ]),
          }),
        }),
      });

      const result = await triggerReverification(
        1,
        ['name'],
        { currentVerificationRequestId: 77 },
      );

      // Should reuse existing request (line 125-126)
      expect(result.requestId).toBe(77);
      expect(result.reusedExistingRequest).toBe(true);
      // db.insert should NOT be called (reused path)
      expect(mocks.db.insert).not.toHaveBeenCalled();
    });

    it('does not reuse when requestText differs (creates new request)', async () => {
      mocks.isPositiveSafeInteger.mockReturnValue(true);

      const differentRequestText = JSON.stringify({
        type: 'pharmacy_reverification',
        changedFields: ['email'], // different fields
      });

      mocks.db.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([
              {
                id: 55,
                requestText: differentRequestText,
                openclawStatus: 'pending',
              },
            ]),
          }),
        }),
      });

      const result = await triggerReverification(
        1,
        ['name'], // different from stored changedFields
        { currentVerificationRequestId: 55 },
      );

      // Should create new request (insert called)
      expect(mocks.db.insert).toHaveBeenCalled();
      expect(result.reusedExistingRequest).toBe(false);
    });
  });

  describe('triggerReverification — insert returns no id → throw (line 137)', () => {
    it('throws ReverificationTriggerError when insert returns empty result', async () => {
      mocks.isPositiveSafeInteger.mockReturnValue(false);

      // Insert returns empty array (no id)
      const insertChain = {
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([]),
        }),
      };
      mocks.db.insert.mockReturnValue(insertChain);

      // Outer catch → update fallback
      const updateChain = {
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      };
      mocks.db.update.mockReturnValue(updateChain);

      await expect(
        triggerReverification(1, ['name']),
      ).rejects.toThrow('再審査リクエストの作成に失敗しました');
    });
  });

  describe('triggerReverification — handoff not accepted (line 155)', () => {
    it('logs warning when handoff.accepted is false', async () => {
      mocks.isPositiveSafeInteger.mockReturnValue(false);
      // handoff returns not accepted
      mocks.handoffToOpenClaw.mockResolvedValue({ accepted: false, note: 'queue full' });

      const result = await triggerReverification(5, ['email']);

      expect(result.requestId).toBe(100);
      // Wait for async handoff to settle
      await vi.runAllTimersAsync().catch(() => undefined);
      // Flush microtasks
      await new Promise((r) => setTimeout(r, 10));

      expect(mocks.logger.warn).toHaveBeenCalledWith(
        'Re-verification handoff was not accepted',
        expect.objectContaining({ pharmacyId: 5 }),
      );
    });
  });

  describe('triggerReverification — handoff catch (line 163)', () => {
    it('logs error when handoff rejects (catch path)', async () => {
      mocks.isPositiveSafeInteger.mockReturnValue(false);
      // handoff rejects
      mocks.handoffToOpenClaw.mockRejectedValue(new Error('network error'));

      const result = await triggerReverification(6, ['phone']);

      expect(result.requestId).toBe(100);
      // Wait for async handoff error to propagate
      await new Promise((r) => setTimeout(r, 20));

      expect(mocks.logger.error).toHaveBeenCalledWith(
        'Re-verification handoff failed',
        expect.objectContaining({ pharmacyId: 6 }),
      );
    });
  });

  describe('triggerReverification — outer catch with fallback update failure (line 181)', () => {
    it('logs error when fallback update also fails', async () => {
      mocks.isPositiveSafeInteger.mockReturnValue(false);

      // Insert fails (triggers outer catch)
      const insertChain = {
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockRejectedValue(new Error('DB insert failed')),
        }),
      };
      mocks.db.insert.mockReturnValue(insertChain);

      // Fallback update also fails (line 181)
      const failingUpdate = {
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockRejectedValue(new Error('DB update also failed')),
        }),
      };
      mocks.db.update.mockReturnValue(failingUpdate);

      await expect(
        triggerReverification(7, ['address']),
      ).rejects.toThrow('再審査依頼の登録に失敗しました');

      // Fallback error logger should be called (line 181)
      expect(mocks.logger.error).toHaveBeenCalledWith(
        'Failed to enforce pending_verification fallback',
        expect.objectContaining({ pharmacyId: 7 }),
      );
    });
  });

  describe('triggerReverification — rethrow ReverificationTriggerError (line 193)', () => {
    it('rethrows ReverificationTriggerError without wrapping', async () => {
      mocks.isPositiveSafeInteger.mockReturnValue(false);

      // Insert returns empty → throws ReverificationTriggerError internally
      const insertChain = {
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([]),
        }),
      };
      mocks.db.insert.mockReturnValue(insertChain);

      // Update succeeds for fallback
      const updateChain = {
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      };
      mocks.db.update.mockReturnValue(updateChain);

      const err = await triggerReverification(1, ['name']).catch((e: unknown) => e);

      // Should be the original ReverificationTriggerError (line 193: if (err instanceof ReverificationTriggerError) throw err)
      expect(err).toBeInstanceOf(ReverificationTriggerError);
      expect((err as ReverificationTriggerError).name).toBe('ReverificationTriggerError');
    });
  });
});
