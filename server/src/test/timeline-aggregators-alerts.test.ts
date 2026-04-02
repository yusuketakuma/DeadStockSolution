import { describe, expect, it, vi } from 'vitest';
import { fetchNotificationEvents } from '../services/timeline-aggregators';
import type { DbClient } from '../types/timeline';

function createSelectChain(result: unknown) {
  const dynamicChain = {
    limit: vi.fn().mockResolvedValue(result),
    then: (resolve: (v: unknown) => void) => Promise.resolve(result).then(resolve),
  };
  const chain = {
    from: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
  };
  chain.from.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.orderBy.mockReturnValue({ $dynamic: vi.fn().mockReturnValue(dynamicChain) });
  return chain;
}

function createDbMock(result: unknown): DbClient {
  return {
    select: vi.fn(() => createSelectChain(result)),
  } as unknown as DbClient;
}

describe('timeline-aggregators alert routing', () => {
  it('maps alert notifications to /alerts', async () => {
    const db = createDbMock([
      {
        id: 43,
        type: 'alert_near_expiry',
        title: '期限切迫在庫の予兆があります',
        message: '確認してください',
        referenceType: 'alert',
        referenceId: 11,
        isRead: false,
        createdAt: '2026-03-01T08:30:00.000Z',
      },
    ]);

    const events = await fetchNotificationEvents(db, 1);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      id: 'notification_43',
      source: 'notification',
      type: 'alert_near_expiry',
      actionPath: '/alerts',
    });
  });

  it('maps alert notifications to /alerts even when legacy referenceType is match', async () => {
    const db = createDbMock([
      {
        id: 44,
        type: 'alert_excess_stock',
        title: '過剰在庫の予兆があります',
        message: '確認してください',
        referenceType: 'match',
        referenceId: null,
        isRead: false,
        createdAt: '2026-03-01T08:35:00.000Z',
      },
    ]);

    const events = await fetchNotificationEvents(db, 1);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      id: 'notification_44',
      source: 'notification',
      type: 'alert_excess_stock',
      actionPath: '/alerts',
    });
  });
});
