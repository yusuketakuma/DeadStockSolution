import { describe, expect, it, vi } from 'vitest';
import type { DbClient } from '../types/timeline';
import {
  fetchNotificationEvents,
  fetchMatchEvents,
  fetchProposalEvents,
  fetchFeedbackEvents,
  fetchUploadEvents,
  fetchExchangeHistoryEvents,
  fetchExpiryRiskEvents,
  fetchAdminMessageEvents,
  getExpiryDateRange,
} from '../services/timeline-aggregators';

function createQueryChain(result: unknown[]): DbClient & Record<string, ReturnType<typeof vi.fn>> {
  const methods = ['select', 'update', 'from', 'where', 'orderBy', 'limit', 'innerJoin'];
  const chain = {} as DbClient & Record<string, ReturnType<typeof vi.fn>>;
  for (const m of methods) {
    chain[m] = vi.fn();
  }
  for (const m of methods) {
    chain[m].mockImplementation(() => {
      const thenableChain: Record<string, unknown> = {};
      for (const m2 of methods) {
        thenableChain[m2] = chain[m2];
      }
      thenableChain.then = (resolve: (v: unknown) => void) => Promise.resolve(result).then(resolve);
      return thenableChain;
    });
  }
  return chain;
}

describe('timeline-aggregators coverage: fetcher functions', () => {
  describe('fetchNotificationEvents', () => {
    it('returns mapped events', async () => {
      const rows = [{
        id: 1,
        type: 'proposal_received',
        title: 'タイトル',
        message: 'メッセージ',
        referenceType: 'proposal',
        referenceId: 10,
        isRead: false,
        createdAt: '2026-01-01T00:00:00Z',
      }];
      const db = createQueryChain(rows);

      const events = await fetchNotificationEvents(db, 1);
      expect(events).toHaveLength(1);
      expect(events[0].id).toBe('notification_1');
    });

    it('applies since filter', async () => {
      const db = createQueryChain([]);
      await fetchNotificationEvents(db, 1, '2026-01-01');
      expect(db.where).toHaveBeenCalled();
    });

    it('applies before filter', async () => {
      const db = createQueryChain([]);
      await fetchNotificationEvents(db, 1, undefined, undefined, '2026-02-01');
      expect(db.where).toHaveBeenCalled();
    });

    it('applies limit', async () => {
      const chain = createQueryChain([]);
      // When limit is provided, the chain uses .limit()
      await fetchNotificationEvents(chain, 1, undefined, 5);
      // limit should be called (after orderBy)
      expect(chain.limit).toHaveBeenCalled();
    });
  });

  describe('fetchMatchEvents', () => {
    it('returns mapped match notification events', async () => {
      const rows = [{
        id: 1,
        candidateCountBefore: 3,
        candidateCountAfter: 5,
        isRead: false,
        createdAt: '2026-01-01T00:00:00Z',
      }];
      const db = createQueryChain(rows);

      const events = await fetchMatchEvents(db, 1);
      expect(events).toHaveLength(1);
      expect(events[0].id).toBe('match_1');
      expect(events[0].type).toBe('match_update');
    });

    it('applies since and before filters', async () => {
      const db = createQueryChain([]);
      await fetchMatchEvents(db, 1, '2026-01-01', undefined, '2026-02-01');
      expect(db.where).toHaveBeenCalled();
    });

    it('applies limit when provided', async () => {
      const db = createQueryChain([]);
      await fetchMatchEvents(db, 1, undefined, 10);
      expect(db.limit).toHaveBeenCalled();
    });
  });

  describe('fetchProposalEvents', () => {
    it('returns mapped proposal events', async () => {
      const rows = [{
        id: 20,
        pharmacyAId: 1,
        pharmacyBId: 2,
        status: 'proposed',
        proposedAt: '2026-01-01T00:00:00Z',
        completedAt: null,
      }];
      const db = createQueryChain(rows);

      const events = await fetchProposalEvents(db, 1);
      expect(events).toHaveLength(1);
      expect(events[0].id).toBe('proposal_20');
    });

    it('applies since and before filters', async () => {
      const db = createQueryChain([]);
      await fetchProposalEvents(db, 1, '2026-01-01', undefined, '2026-06-01');
      expect(db.where).toHaveBeenCalled();
    });

    it('applies limit when provided', async () => {
      const db = createQueryChain([]);
      await fetchProposalEvents(db, 1, undefined, 5);
      expect(db.limit).toHaveBeenCalled();
    });
  });

  describe('fetchFeedbackEvents', () => {
    it('returns mapped feedback events', async () => {
      const rows = [{
        id: 1,
        proposalId: 10,
        rating: 5,
        comment: 'よかった',
        createdAt: '2026-01-01T00:00:00Z',
      }];
      const db = createQueryChain(rows);

      const events = await fetchFeedbackEvents(db, 1);
      expect(events).toHaveLength(1);
      expect(events[0].id).toBe('feedback_1');
      expect(events[0].type).toBe('exchange_feedback');
    });

    it('applies since filter', async () => {
      const db = createQueryChain([]);
      await fetchFeedbackEvents(db, 1, '2026-01-01');
      expect(db.where).toHaveBeenCalled();
    });

    it('applies before filter', async () => {
      const db = createQueryChain([]);
      await fetchFeedbackEvents(db, 1, undefined, undefined, '2026-03-01');
      expect(db.where).toHaveBeenCalled();
    });

    it('applies limit when provided', async () => {
      const db = createQueryChain([]);
      await fetchFeedbackEvents(db, 1, undefined, 10);
      expect(db.limit).toHaveBeenCalled();
    });
  });

  describe('fetchUploadEvents', () => {
    it('returns mapped upload events', async () => {
      const rows = [{
        id: 1,
        uploadType: 'dead_stock',
        originalFilename: 'test.xlsx',
        createdAt: '2026-01-01T00:00:00Z',
      }];
      const db = createQueryChain(rows);

      const events = await fetchUploadEvents(db, 1);
      expect(events).toHaveLength(1);
      expect(events[0].id).toBe('upload_1');
    });

    it('applies since and before filters', async () => {
      const db = createQueryChain([]);
      await fetchUploadEvents(db, 1, '2026-01-01', undefined, '2026-06-01');
      expect(db.where).toHaveBeenCalled();
    });

    it('applies limit when provided', async () => {
      const db = createQueryChain([]);
      await fetchUploadEvents(db, 1, undefined, 5);
      expect(db.limit).toHaveBeenCalled();
    });
  });

  describe('fetchExchangeHistoryEvents', () => {
    it('returns mapped exchange history events', async () => {
      const rows = [{
        id: 1,
        proposalId: 10,
        pharmacyAId: 1,
        pharmacyBId: 2,
        totalValue: '20000',
        completedAt: '2026-01-01T00:00:00Z',
      }];
      const db = createQueryChain(rows);

      const events = await fetchExchangeHistoryEvents(db, 1);
      expect(events).toHaveLength(1);
      expect(events[0].id).toBe('exchange_history_1');
      expect(events[0].type).toBe('exchange_completed');
    });

    it('applies since and before filters', async () => {
      const db = createQueryChain([]);
      await fetchExchangeHistoryEvents(db, 1, '2026-01-01', undefined, '2026-06-01');
      expect(db.where).toHaveBeenCalled();
    });

    it('applies limit when provided', async () => {
      const db = createQueryChain([]);
      await fetchExchangeHistoryEvents(db, 1, undefined, 10);
      expect(db.limit).toHaveBeenCalled();
    });
  });

  describe('fetchExpiryRiskEvents', () => {
    it('returns mapped expiry risk events', async () => {
      const rows = [{
        id: 1,
        drugName: 'テスト薬',
        expirationDateIso: '2026-01-05',
        quantity: 10,
        createdAt: '2026-01-01T00:00:00Z',
      }];
      const db = createQueryChain(rows);

      const events = await fetchExpiryRiskEvents(db, 1);
      expect(events).toHaveLength(1);
      expect(events[0].id).toBe('expiry_risk_1');
      expect(events[0].type).toBe('near_expiry');
    });

    it('applies limit when provided', async () => {
      const db = createQueryChain([]);
      await fetchExpiryRiskEvents(db, 1, 5);
      expect(db.limit).toHaveBeenCalled();
    });

    it('applies before filter', async () => {
      const db = createQueryChain([]);
      await fetchExpiryRiskEvents(db, 1, undefined, '2026-03-01');
      expect(db.where).toHaveBeenCalled();
    });
  });

  describe('fetchAdminMessageEvents', () => {
    it('returns merged admin messages with read status', async () => {
      const allMessages = [{
        id: 1,
        title: 'お知らせ',
        body: 'テスト',
        createdAt: '2026-01-01T00:00:00Z',
      }];
      const readRows = [{ messageId: 1 }];

      const db = {
        select: vi.fn(),
        update: vi.fn(),
      };

      function makeOrderByChain(result: unknown[]) {
        const c = {
          from: vi.fn(),
          where: vi.fn(),
          orderBy: vi.fn(),
          limit: vi.fn(),
        };
        c.from.mockReturnValue(c);
        c.where.mockReturnValue(c);
        c.orderBy.mockResolvedValue(result);
        c.limit.mockResolvedValue(result);
        return c;
      }

      function makeWhereChain(result: unknown[]) {
        const c = {
          from: vi.fn(),
          where: vi.fn(),
        };
        c.from.mockReturnValue(c);
        c.where.mockResolvedValue(result);
        return c;
      }

      db.select
        .mockReturnValueOnce(makeOrderByChain(allMessages)) // all messages
        .mockReturnValueOnce(makeOrderByChain([])) // pharmacy messages
        .mockReturnValueOnce(makeWhereChain(readRows)); // read rows

      const events = await fetchAdminMessageEvents(db, 1);
      expect(events).toHaveLength(1);
      expect(events[0].id).toBe('admin_message_1');
      expect(events[0].isRead).toBe(true); // message id 1 is in readRows
    });

    it('deduplicates messages from all + pharmacy', async () => {
      const sharedMessage = { id: 1, title: 'shared', body: 'body', createdAt: '2026-01-01T00:00:00Z' };

      const db = {
        select: vi.fn(),
        update: vi.fn(),
      };

      function makeChain(result: unknown[]) {
        const c = {
          from: vi.fn(),
          where: vi.fn(),
          orderBy: vi.fn(),
          limit: vi.fn(),
        };
        c.from.mockReturnValue(c);
        c.where.mockReturnValue(c);
        c.orderBy.mockResolvedValue(result);
        c.limit.mockResolvedValue(result);
        return c;
      }

      function makeReadChain(result: unknown[]) {
        const c = {
          from: vi.fn(),
          where: vi.fn(),
        };
        c.from.mockReturnValue(c);
        c.where.mockResolvedValue(result);
        return c;
      }

      db.select
        .mockReturnValueOnce(makeChain([sharedMessage]))
        .mockReturnValueOnce(makeChain([sharedMessage])) // same message in both
        .mockReturnValueOnce(makeReadChain([])); // readRows

      const events = await fetchAdminMessageEvents(db, 1);
      expect(events).toHaveLength(1); // deduplicated
    });

    it('returns empty when no messages found', async () => {
      const db = {
        select: vi.fn(),
        update: vi.fn(),
      };

      function makeChain(result: unknown[]) {
        const c = {
          from: vi.fn(),
          where: vi.fn(),
          orderBy: vi.fn(),
          limit: vi.fn(),
        };
        c.from.mockReturnValue(c);
        c.where.mockReturnValue(c);
        c.orderBy.mockResolvedValue(result);
        c.limit.mockResolvedValue(result);
        return c;
      }

      db.select
        .mockReturnValueOnce(makeChain([]))
        .mockReturnValueOnce(makeChain([]));

      const events = await fetchAdminMessageEvents(db, 1);
      expect(events).toHaveLength(0);
    });

    it('applies since and before filters', async () => {
      const db = {
        select: vi.fn(),
        update: vi.fn(),
      };

      function makeChain2(result: unknown[]) {
        const c = {
          from: vi.fn(),
          where: vi.fn(),
          orderBy: vi.fn(),
          limit: vi.fn(),
        };
        c.from.mockReturnValue(c);
        c.where.mockReturnValue(c);
        c.orderBy.mockResolvedValue(result);
        c.limit.mockResolvedValue(result);
        return c;
      }

      db.select
        .mockReturnValueOnce(makeChain2([]))
        .mockReturnValueOnce(makeChain2([]));

      const events = await fetchAdminMessageEvents(db, 1, '2026-01-01', undefined, '2026-06-01');
      expect(events).toHaveLength(0);
    });

    it('applies limit when provided', async () => {
      const db = {
        select: vi.fn(),
        update: vi.fn(),
      };

      function makeChain3(result: unknown[]) {
        const c = {
          from: vi.fn(),
          where: vi.fn(),
          orderBy: vi.fn(),
          limit: vi.fn(),
        };
        c.from.mockReturnValue(c);
        c.where.mockReturnValue(c);
        c.orderBy.mockReturnValue(c);
        c.limit.mockResolvedValue(result);
        return c;
      }

      db.select
        .mockReturnValueOnce(makeChain3([]))
        .mockReturnValueOnce(makeChain3([]));

      const events = await fetchAdminMessageEvents(db, 1, undefined, 10);
      expect(events).toHaveLength(0);
    });
  });

  describe('getExpiryDateRange', () => {
    it('returns today and 3 days later as date strings', () => {
      const { todayStr, threeDaysLaterStr } = getExpiryDateRange();
      expect(typeof todayStr).toBe('string');
      expect(typeof threeDaysLaterStr).toBe('string');
      // threeDaysLater should be after today
      expect(threeDaysLaterStr > todayStr).toBe(true);
    });
  });
});
