import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
    transaction: vi.fn(),
    update: vi.fn(),
    insert: vi.fn(),
    delete: vi.fn(),
  },
  createNotification: vi.fn(),
  sendToPharmacy: vi.fn(),
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../config/database', () => ({
  db: mocks.db,
}));

vi.mock('../services/notification-service', () => ({
  createNotification: mocks.createNotification,
}));

vi.mock('../services/push-dispatch-service', () => ({
  sendToPharmacy: mocks.sendToPharmacy,
  sendToMultiple: vi.fn(),
}));

vi.mock('../services/logger', () => ({
  logger: mocks.logger,
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn(() => ({})),
  desc: vi.fn(() => ({})),
  eq: vi.fn(() => ({})),
  gte: vi.fn(() => ({})),
  inArray: vi.fn(() => ({})),
  isNotNull: vi.fn(() => ({})),
  lte: vi.fn(() => ({})),
  notInArray: vi.fn(() => ({})),
  or: vi.fn(() => ({})),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values })),
}));

import { runPredictiveAlertsJob } from '../services/predictive-alert-service';
import { acceptInvitation, inviteMember, leaveGroup } from '../services/group-service';

function createSelectWhereResult(result: unknown) {
  const where = vi.fn().mockResolvedValue(result);
  const from = vi.fn().mockReturnValue({ where });
  return { from, where };
}

function createSelectWhereGroupByResult(result: unknown) {
  const groupBy = vi.fn().mockResolvedValue(result);
  const where = vi.fn().mockReturnValue({ groupBy });
  const from = vi.fn().mockReturnValue({ where });
  return { from, where, groupBy };
}

function createUpdateReturningResult(result: unknown) {
  const returning = vi.fn().mockResolvedValue(result);
  const where = vi.fn().mockReturnValue({ returning });
  const set = vi.fn().mockReturnValue({ where });
  return { set };
}

function createDeleteResult(result: unknown) {
  const returning = vi.fn().mockResolvedValue(result);
  const where = vi.fn().mockReturnValue({ returning });
  return { where };
}

function createTxInsertAlertReturning(alertId: number | null) {
  const returning = vi.fn().mockResolvedValue(alertId === null ? [] : [{ id: alertId }]);
  const onConflictDoNothing = vi.fn().mockReturnValue({ returning });
  const values = vi.fn().mockReturnValue({ onConflictDoNothing });
  return { values };
}

function createTxInsertNotificationReturning(notificationId: number | null) {
  const returning = vi.fn().mockResolvedValue(notificationId === null ? [] : [{ id: notificationId }]);
  const values = vi.fn().mockReturnValue({ returning });
  return { values };
}

describe('alert/group push integration', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('VAPID_PUBLIC_KEY', 'test-public-key');
    vi.stubEnv('VAPID_PRIVATE_KEY', 'test-private-key');
  });

  it('runPredictiveAlertsJob dispatches push after alert creation', async () => {
    const activePharmaciesQuery = createSelectWhereResult([{ id: 10 }]);
    const nearExpiryQuery = createSelectWhereGroupByResult([
      { pharmacyId: 10, itemCount: 2, totalValue: 1200, nearestExpiryDate: '2026-03-15' },
    ]);
    const stockRowsQuery = createSelectWhereResult([]);
    const usageRowsQuery = createSelectWhereResult([]);

    mocks.db.select
      .mockReturnValueOnce({ from: activePharmaciesQuery.from })
      .mockReturnValueOnce({ from: nearExpiryQuery.from })
      .mockReturnValueOnce({ from: stockRowsQuery.from })
      .mockReturnValueOnce({ from: usageRowsQuery.from });

    mocks.db.transaction.mockImplementation(async (callback: (tx: {
      insert: typeof mocks.db.insert;
      update: typeof mocks.db.update;
    }) => Promise<'created' | 'duplicate'>) => {
      const tx = {
        insert: vi.fn()
          .mockReturnValueOnce(createTxInsertAlertReturning(501))
          .mockReturnValueOnce(createTxInsertNotificationReturning(900)),
        update: vi.fn().mockReturnValue(createUpdateReturningResult([{ id: 501 }])),
      };
      return callback(tx);
    });

    await runPredictiveAlertsJob({
      now: new Date('2026-03-01T00:00:00.000Z'),
      nearExpiryDays: 45,
      excessStockMonths: 3,
    });

    expect(mocks.sendToPharmacy).toHaveBeenCalledTimes(1);
    expect(mocks.sendToPharmacy).toHaveBeenCalledWith(
      10,
      expect.objectContaining({
        title: '期限切迫在庫の予兆があります',
        body: expect.stringContaining('期限到来予定です'),
        data: expect.objectContaining({
          url: '/alerts',
          type: 'near_expiry',
        }),
      }),
    );
  });

  it('runPredictiveAlertsJob skips push dispatch when VAPID keys are missing', async () => {
    vi.stubEnv('VAPID_PUBLIC_KEY', '');
    vi.stubEnv('VAPID_PRIVATE_KEY', '');

    const activePharmaciesQuery = createSelectWhereResult([{ id: 10 }]);
    const nearExpiryQuery = createSelectWhereGroupByResult([
      { pharmacyId: 10, itemCount: 1, totalValue: 300, nearestExpiryDate: '2026-03-10' },
    ]);
    const stockRowsQuery = createSelectWhereResult([]);
    const usageRowsQuery = createSelectWhereResult([]);

    mocks.db.select
      .mockReturnValueOnce({ from: activePharmaciesQuery.from })
      .mockReturnValueOnce({ from: nearExpiryQuery.from })
      .mockReturnValueOnce({ from: stockRowsQuery.from })
      .mockReturnValueOnce({ from: usageRowsQuery.from });

    mocks.db.transaction.mockImplementation(async (callback: (tx: {
      insert: typeof mocks.db.insert;
      update: typeof mocks.db.update;
    }) => Promise<'created' | 'duplicate'>) => {
      const tx = {
        insert: vi.fn()
          .mockReturnValueOnce(createTxInsertAlertReturning(777))
          .mockReturnValueOnce(createTxInsertNotificationReturning(888)),
        update: vi.fn().mockReturnValue(createUpdateReturningResult([{ id: 777 }])),
      };
      return callback(tx);
    });

    await runPredictiveAlertsJob({ now: new Date('2026-03-01T00:00:00.000Z') });

    expect(mocks.sendToPharmacy).not.toHaveBeenCalled();
  });

  it('inviteMember dispatches push to invited pharmacy', async () => {
    const inviterRoleQuery = createSelectWhereResult([{ role: 'owner' }]);
    const inviteeMembershipQuery = createSelectWhereResult([]);
    const existingInvitationQuery = createSelectWhereResult([]);

    mocks.db.select
      .mockReturnValueOnce({ from: inviterRoleQuery.from })
      .mockReturnValueOnce({ from: inviteeMembershipQuery.from })
      .mockReturnValueOnce({ from: existingInvitationQuery.from });

    mocks.createNotification.mockResolvedValue({ id: 301 });

    await inviteMember(55, 1, 2);

    expect(mocks.sendToPharmacy).toHaveBeenCalledWith(
      2,
      expect.objectContaining({
        title: 'グループ招待',
        data: expect.objectContaining({
          url: '/groups',
          type: 'group_invitation',
        }),
      }),
    );
  });

  it('acceptInvitation dispatches push to group owner', async () => {
    const membershipQuery = createSelectWhereResult([]);
    const invitationQuery = createSelectWhereResult([
      { id: 900, pharmacyId: 5, referenceId: 10, type: 'group_invitation', isRead: false },
    ]);
    const ownerGroupQuery = createSelectWhereResult([
      { id: 10, ownerPharmacyId: 1 },
    ]);

    mocks.db.select
      .mockReturnValueOnce({ from: membershipQuery.from })
      .mockReturnValueOnce({ from: invitationQuery.from })
      .mockReturnValueOnce({ from: ownerGroupQuery.from });

    const insertReturning = vi.fn().mockResolvedValue([
      { id: 44, groupId: 10, pharmacyId: 5, role: 'member', joinedAt: '2026-03-01T00:00:00.000Z' },
    ]);
    const insertValues = vi.fn().mockReturnValue({ returning: insertReturning });
    mocks.db.insert.mockReturnValue({ values: insertValues });
    mocks.db.update.mockReturnValue(createUpdateReturningResult([{ id: 900 }]));

    await acceptInvitation(10, 5);

    expect(mocks.sendToPharmacy).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        title: 'グループ参加',
        data: expect.objectContaining({
          url: '/groups/10',
          type: 'group_joined',
        }),
      }),
    );
  });

  it('leaveGroup dispatches push to group owner', async () => {
    const membershipQuery = createSelectWhereResult([{ role: 'member' }]);
    const ownerGroupQuery = createSelectWhereResult([
      { id: 10, ownerPharmacyId: 1 },
    ]);
    mocks.db.select
      .mockReturnValueOnce({ from: membershipQuery.from })
      .mockReturnValueOnce({ from: ownerGroupQuery.from });

    mocks.db.delete.mockReturnValue(createDeleteResult([{ id: 2 }]));

    await leaveGroup(10, 2);

    expect(mocks.sendToPharmacy).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        title: 'グループ脱退',
        data: expect.objectContaining({
          url: '/groups/10',
          type: 'group_left',
        }),
      }),
    );
  });
});
