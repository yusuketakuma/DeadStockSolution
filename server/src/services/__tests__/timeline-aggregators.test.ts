import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RawTimelineEvent, DbClient } from '../../types/timeline';
import {
  fetchAdminMessageEvents,
  fetchCommentEvents,
  fetchExchangeHistoryEvents,
  fetchExpiryRiskEvents,
  fetchFeedbackEvents,
  fetchMatchEvents,
  fetchNotificationEvents,
  fetchProposalEvents,
  fetchUploadEvents,
} from '../timeline-aggregators';

type SelectChain = {
  from: ReturnType<typeof vi.fn>;
  where: ReturnType<typeof vi.fn>;
  innerJoin: ReturnType<typeof vi.fn>;
  orderBy: ReturnType<typeof vi.fn>;
};

function createSelectChain(result: unknown): SelectChain {
  const dynamicChain = {
    limit: vi.fn().mockResolvedValue(result),
    then: (resolve: (v: unknown) => void) => Promise.resolve(result).then(resolve),
  };
  const chain: SelectChain = {
    from: vi.fn(),
    where: vi.fn(),
    innerJoin: vi.fn(),
    orderBy: vi.fn(),
  };
  chain.from.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.innerJoin.mockReturnValue(chain);
  chain.orderBy.mockReturnValue({ $dynamic: vi.fn().mockReturnValue(dynamicChain) });
  return chain;
}

function createDbMock(...results: unknown[]): DbClient {
  const select = vi.fn();
  for (const result of results) {
    select.mockImplementationOnce(() => createSelectChain(result));
  }
  return { select } as unknown as DbClient;
}

function expectSingleEvent(events: RawTimelineEvent[], source: RawTimelineEvent['source']) {
  expect(events).toHaveLength(1);
  expect(events[0]?.source).toBe(source);
  expect(events[0]?.isRead).toBe(false);
}

describe('timeline-aggregators', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-01T09:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('fetchNotificationEvents', () => {
    it('maps notification rows into RawTimelineEvent', async () => {
      const db = createDbMock([
        {
          id: 42,
          type: 'proposal_status_changed',
          title: '提案ステータス更新',
          message: '確認してください',
          referenceType: 'proposal',
          referenceId: 10,
          createdAt: '2026-03-01T08:00:00.000Z',
        },
      ]);

      const events = await fetchNotificationEvents(db, 1, '2026-03-01T00:00:00.000Z');

      expectSingleEvent(events, 'notification');
      expect(events[0]).toMatchObject({
        id: 'notification_42',
        type: 'proposal_status_changed',
        title: '提案ステータス更新',
        body: '確認してください',
        timestamp: '2026-03-01T08:00:00.000Z',
        actionPath: '/proposals/10',
      });
    });

    it('returns empty array when no notifications exist', async () => {
      const db = createDbMock([]);
      await expect(fetchNotificationEvents(db, 1)).resolves.toEqual([]);
    });

  });

  describe('fetchMatchEvents', () => {
    it('maps match notification rows', async () => {
      const db = createDbMock([
        {
          id: 7,
          triggerUploadType: 'dead_stock',
          createdAt: '2026-03-01T07:00:00.000Z',
          candidateCountBefore: 1,
          candidateCountAfter: 3,
        },
      ]);

      const events = await fetchMatchEvents(db, 5);

      expectSingleEvent(events, 'match');
      expect(events[0]).toMatchObject({
        id: 'match_7',
        type: 'updated',
        actionPath: '/matching',
      });
    });

    it('returns empty array when no matches exist', async () => {
      const db = createDbMock([]);
      await expect(fetchMatchEvents(db, 5)).resolves.toEqual([]);
    });
  });

  describe('fetchProposalEvents', () => {
    it('merges branch A/B rows and maps with proposedAt timestamp', async () => {
      const db = createDbMock(
        [
          {
            id: 11,
            pharmacyAId: 1,
            pharmacyBId: 2,
            status: 'proposed',
            proposedAt: '2026-03-01T06:00:00.000Z',
          },
        ],
        [
          {
            id: 12,
            pharmacyAId: 3,
            pharmacyBId: 1,
            status: 'confirmed',
            proposedAt: '2026-03-01T05:00:00.000Z',
          },
        ],
      );

      const events = await fetchProposalEvents(db, 1);

      expect(events).toHaveLength(2);
      expect(events.map((event) => event.id)).toEqual(['proposal_11', 'proposal_12']);
      expect(events[0]?.timestamp).toBe('2026-03-01T06:00:00.000Z');
      expect(events[1]?.timestamp).toBe('2026-03-01T05:00:00.000Z');
      expect(events[0]?.actionPath).toBe('/proposals/11');
    });

    it('returns empty array when no proposals match either branch', async () => {
      const db = createDbMock([], []);
      await expect(fetchProposalEvents(db, 1)).resolves.toEqual([]);
    });
  });

  describe('fetchCommentEvents', () => {
    it('maps proposal comments joined with exchange proposals', async () => {
      const db = createDbMock([
        {
          commentId: 3,
          proposalId: 99,
          authorPharmacyId: 2,
          body: 'コメント',
          createdAt: '2026-03-01T04:00:00.000Z',
        },
      ]);

      const events = await fetchCommentEvents(db, 1);

      expectSingleEvent(events, 'comment');
      expect(events[0]).toMatchObject({
        id: 'comment_3',
        type: 'new_comment',
        actionPath: '/proposals/99',
        timestamp: '2026-03-01T04:00:00.000Z',
      });
    });

    it('returns empty array when no comments are linked to pharmacy proposals', async () => {
      const db = createDbMock([]);
      await expect(fetchCommentEvents(db, 1)).resolves.toEqual([]);
    });
  });

  describe('fetchFeedbackEvents', () => {
    it('maps feedback rows for recipient pharmacy', async () => {
      const db = createDbMock([
        {
          id: 8,
          proposalId: 123,
          rating: 5,
          comment: 'thank you',
          createdAt: '2026-03-01T03:00:00.000Z',
        },
      ]);

      const events = await fetchFeedbackEvents(db, 1);

      expectSingleEvent(events, 'feedback');
      expect(events[0]).toMatchObject({
        id: 'feedback_8',
        type: 'received',
        actionPath: '/proposals/123',
      });
    });

    it('returns empty array when no feedback rows are found', async () => {
      const db = createDbMock([]);
      await expect(fetchFeedbackEvents(db, 1)).resolves.toEqual([]);
    });
  });

  describe('fetchUploadEvents', () => {
    it('maps upload rows for pharmacy', async () => {
      const db = createDbMock([
        {
          id: 4,
          uploadType: 'dead_stock',
          originalFilename: 'sample.csv',
          createdAt: '2026-03-01T02:00:00.000Z',
        },
      ]);

      const events = await fetchUploadEvents(db, 1);

      expectSingleEvent(events, 'upload');
      expect(events[0]).toMatchObject({
        id: 'upload_4',
        type: 'dead_stock',
        actionPath: '/upload',
      });
    });

    it('returns empty array when no upload rows are found', async () => {
      const db = createDbMock([]);
      await expect(fetchUploadEvents(db, 1)).resolves.toEqual([]);
    });
  });

  describe('fetchAdminMessageEvents', () => {
    it('maps admin message rows without pharmacy filter', async () => {
      const db = createDbMock([
        {
          id: 15,
          title: 'お知らせ',
          body: '運用メッセージ',
          actionPath: '/settings',
          createdAt: '2026-03-01T01:00:00.000Z',
        },
      ]);

      const events = await fetchAdminMessageEvents(db, 999);

      expectSingleEvent(events, 'admin_message');
      expect(events[0]).toMatchObject({
        id: 'admin_message_15',
        type: 'new_message',
        actionPath: '/settings',
      });
    });

    it('returns empty array when no admin messages exist', async () => {
      const db = createDbMock([]);
      await expect(fetchAdminMessageEvents(db, 999)).resolves.toEqual([]);
    });
  });

  describe('fetchExchangeHistoryEvents', () => {
    it('maps exchange history rows with completedAt timestamp', async () => {
      const db = createDbMock([
        {
          id: 31,
          proposalId: 77,
          completedAt: '2026-03-01T00:30:00.000Z',
        },
      ]);

      const events = await fetchExchangeHistoryEvents(db, 1);

      expectSingleEvent(events, 'exchange_history');
      expect(events[0]).toMatchObject({
        id: 'exchange_history_31',
        timestamp: '2026-03-01T00:30:00.000Z',
        actionPath: '/proposals/77',
      });
    });

    it('returns empty array when no exchange history rows are found', async () => {
      const db = createDbMock([]);
      await expect(fetchExchangeHistoryEvents(db, 1)).resolves.toEqual([]);
    });
  });

  describe('fetchExpiryRiskEvents', () => {
    it('maps expiry risk events with today timestamp', async () => {
      const db = createDbMock([
        {
          id: 5,
          drugName: 'アスピリン',
          expirationDateIso: '2026-03-03',
        },
      ]);

      const events = await fetchExpiryRiskEvents(db, 1);

      expectSingleEvent(events, 'expiry_risk');
      expect(events[0]).toMatchObject({
        id: 'expiry_risk_5',
        type: 'detected',
        timestamp: '2026-03-01T09:00:00.000Z',
        actionPath: '/inventory',
      });
    });

    it('returns empty array when no expiry risk rows are found', async () => {
      const db = createDbMock([]);
      await expect(fetchExpiryRiskEvents(db, 1)).resolves.toEqual([]);
    });
  });
});
