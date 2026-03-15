import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
    transaction: vi.fn(),
    update: vi.fn(),
    insert: vi.fn(),
  },
  sendToPharmacy: vi.fn(),
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  normalizeString: vi.fn((s: string) => s.trim().toLowerCase()),
  parseBoundedInt: vi.fn((val: string | undefined, def: number) => (val ? parseInt(val, 10) || def : def)),
  splitIntoChunks: vi.fn(<T>(arr: T[], size: number) => {
    const chunks: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
      chunks.push(arr.slice(i, i + size));
    }
    return chunks;
  }),
}));

vi.mock('../config/database', () => ({
  db: mocks.db,
}));

vi.mock('../services/push-dispatch-service', () => ({
  sendToPharmacy: mocks.sendToPharmacy,
}));

vi.mock('../services/logger', () => ({
  logger: mocks.logger,
}));

vi.mock('../utils/string-utils', () => ({
  normalizeString: mocks.normalizeString,
}));

vi.mock('../utils/number-utils', () => ({
  parseBoundedInt: mocks.parseBoundedInt,
}));

vi.mock('../utils/array-utils', () => ({
  splitIntoChunks: mocks.splitIntoChunks,
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn(() => ({})),
  eq: vi.fn(() => ({})),
  gte: vi.fn(() => ({})),
  inArray: vi.fn(() => ({})),
  isNotNull: vi.fn(() => ({})),
  lte: vi.fn(() => ({})),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values })),
}));

import { runPredictiveAlertsJob } from '../services/predictive-alert-service';

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

function createUpdateSetWhereResult(result: unknown) {
  const returning = vi.fn().mockResolvedValue(result);
  const where = vi.fn().mockReturnValue({ returning });
  const set = vi.fn().mockReturnValue({ where });
  return { set };
}

function createTxInsertAlert(alertId: number | null) {
  const returning = vi.fn().mockResolvedValue(alertId === null ? [] : [{ id: alertId }]);
  const onConflictDoNothing = vi.fn().mockReturnValue({ returning });
  const values = vi.fn().mockReturnValue({ onConflictDoNothing });
  return { values };
}

function createTxInsertNotification(notificationId: number | null) {
  const returning = vi.fn().mockResolvedValue(notificationId === null ? [] : [{ id: notificationId }]);
  const values = vi.fn().mockReturnValue({ returning });
  return { values };
}

function makeTx(alertId: number | null, notifId: number | null) {
  const txInsert = vi.fn()
    .mockReturnValueOnce(createTxInsertAlert(alertId))
    .mockReturnValueOnce(createTxInsertNotification(notifId));
  const txUpdate = vi.fn().mockReturnValue(createUpdateSetWhereResult([{ id: alertId }]));
  return { insert: txInsert, update: txUpdate };
}

describe('predictive-alert-service coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  describe('runPredictiveAlertsJob - no pharmacies', () => {
    it('returns empty result when no active pharmacies', async () => {
      const activePharmaciesQuery = createSelectWhereResult([]);
      mocks.db.select.mockReturnValueOnce({ from: activePharmaciesQuery.from });

      const result = await runPredictiveAlertsJob({});
      expect(result.processedPharmacies).toBe(0);
      expect(result.generatedAlerts).toBe(0);
      expect(result.nearExpiryAlerts).toBe(0);
      expect(result.excessStockAlerts).toBe(0);
    });
  });

  describe('runPredictiveAlertsJob - near expiry alerts', () => {
    it('creates near expiry alert for pharmacy', async () => {
      const activePharmaciesQuery = createSelectWhereResult([{ id: 1 }]);
      const nearExpiryQuery = createSelectWhereGroupByResult([
        { pharmacyId: 1, itemCount: 3, totalValue: 1500, nearestExpiryDate: '2026-04-01' },
      ]);
      const stockQuery = createSelectWhereResult([]);
      const usageQuery = createSelectWhereResult([]);

      mocks.db.select
        .mockReturnValueOnce({ from: activePharmaciesQuery.from })
        .mockReturnValueOnce({ from: nearExpiryQuery.from })
        .mockReturnValueOnce({ from: stockQuery.from })
        .mockReturnValueOnce({ from: usageQuery.from });

      mocks.db.transaction.mockImplementation(async (callback: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) => {
        return callback(makeTx(1001, 2001));
      });

      const result = await runPredictiveAlertsJob({
        now: new Date('2026-03-15T00:00:00.000Z'),
        nearExpiryDays: 30,
      });

      expect(result.processedPharmacies).toBe(1);
      expect(result.generatedAlerts).toBe(1);
      expect(result.nearExpiryAlerts).toBe(1);
      expect(result.excessStockAlerts).toBe(0);
    });

    it('counts near expiry alert as duplicate when conflict exists', async () => {
      const activePharmaciesQuery = createSelectWhereResult([{ id: 1 }]);
      const nearExpiryQuery = createSelectWhereGroupByResult([
        { pharmacyId: 1, itemCount: 2, totalValue: 800, nearestExpiryDate: '2026-04-01' },
      ]);
      const stockQuery = createSelectWhereResult([]);
      const usageQuery = createSelectWhereResult([]);

      mocks.db.select
        .mockReturnValueOnce({ from: activePharmaciesQuery.from })
        .mockReturnValueOnce({ from: nearExpiryQuery.from })
        .mockReturnValueOnce({ from: stockQuery.from })
        .mockReturnValueOnce({ from: usageQuery.from });

      // Transaction returns 'duplicate' (alert insert returns no rows)
      mocks.db.transaction.mockImplementation(async (callback: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) => {
        return callback(makeTx(null, null));
      });

      const result = await runPredictiveAlertsJob({
        now: new Date('2026-03-15T00:00:00.000Z'),
      });

      expect(result.duplicateAlerts).toBe(1);
      expect(result.generatedAlerts).toBe(0);
    });

    it('counts alert as failed when transaction throws', async () => {
      const activePharmaciesQuery = createSelectWhereResult([{ id: 1 }]);
      const nearExpiryQuery = createSelectWhereGroupByResult([
        { pharmacyId: 1, itemCount: 5, totalValue: 3000, nearestExpiryDate: '2026-04-01' },
      ]);
      const stockQuery = createSelectWhereResult([]);
      const usageQuery = createSelectWhereResult([]);

      mocks.db.select
        .mockReturnValueOnce({ from: activePharmaciesQuery.from })
        .mockReturnValueOnce({ from: nearExpiryQuery.from })
        .mockReturnValueOnce({ from: stockQuery.from })
        .mockReturnValueOnce({ from: usageQuery.from });

      mocks.db.transaction.mockRejectedValueOnce(new Error('DB constraint error'));

      const result = await runPredictiveAlertsJob({
        now: new Date('2026-03-15T00:00:00.000Z'),
      });

      expect(result.failedAlerts).toBe(1);
      expect(mocks.logger.error).toHaveBeenCalled();
    });

    it('handles zero itemCount rows (filtered out)', async () => {
      const activePharmaciesQuery = createSelectWhereResult([{ id: 1 }]);
      const nearExpiryQuery = createSelectWhereGroupByResult([
        { pharmacyId: 1, itemCount: 0, totalValue: 0, nearestExpiryDate: null },
      ]);
      const stockQuery = createSelectWhereResult([]);
      const usageQuery = createSelectWhereResult([]);

      mocks.db.select
        .mockReturnValueOnce({ from: activePharmaciesQuery.from })
        .mockReturnValueOnce({ from: nearExpiryQuery.from })
        .mockReturnValueOnce({ from: stockQuery.from })
        .mockReturnValueOnce({ from: usageQuery.from });

      const result = await runPredictiveAlertsJob({
        now: new Date('2026-03-15T00:00:00.000Z'),
      });

      expect(result.generatedAlerts).toBe(0);
      expect(mocks.db.transaction).not.toHaveBeenCalled();
    });
  });

  describe('runPredictiveAlertsJob - excess stock alerts', () => {
    it('creates excess stock alert when stock exceeds usage threshold', async () => {
      const activePharmaciesQuery = createSelectWhereResult([{ id: 2 }]);
      const nearExpiryQuery = createSelectWhereGroupByResult([]);
      const stockQuery = createSelectWhereResult([
        {
          pharmacyId: 2,
          drugName: 'ロキソプロフェン錠',
          drugMasterId: 100,
          drugMasterPackageId: null,
          quantity: 300,
          yakkaUnitPrice: 15,
        },
      ]);
      const usageQuery = createSelectWhereResult([
        {
          pharmacyId: 2,
          drugName: 'ロキソプロフェン錠',
          drugMasterId: 100,
          drugMasterPackageId: null,
          monthlyUsage: 50,
        },
      ]);

      mocks.db.select
        .mockReturnValueOnce({ from: activePharmaciesQuery.from })
        .mockReturnValueOnce({ from: nearExpiryQuery.from })
        .mockReturnValueOnce({ from: stockQuery.from })
        .mockReturnValueOnce({ from: usageQuery.from });

      mocks.db.transaction.mockImplementation(async (callback: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) => {
        return callback(makeTx(2001, 3001));
      });

      const result = await runPredictiveAlertsJob({
        now: new Date('2026-03-15T00:00:00.000Z'),
        excessStockMonths: 3,
      });

      expect(result.excessStockAlerts).toBe(1);
      expect(result.generatedAlerts).toBe(1);
    });

    it('does not create excess alert when stock is below threshold', async () => {
      const activePharmaciesQuery = createSelectWhereResult([{ id: 2 }]);
      const nearExpiryQuery = createSelectWhereGroupByResult([]);
      // Stock = 50 units, monthly usage = 50, threshold = 3 months * 50 = 150
      // 50 <= 150, so no excess
      const stockQuery = createSelectWhereResult([
        {
          pharmacyId: 2,
          drugName: 'テスト薬',
          drugMasterId: 200,
          drugMasterPackageId: null,
          quantity: 50,
          yakkaUnitPrice: 20,
        },
      ]);
      const usageQuery = createSelectWhereResult([
        {
          pharmacyId: 2,
          drugName: 'テスト薬',
          drugMasterId: 200,
          drugMasterPackageId: null,
          monthlyUsage: 50,
        },
      ]);

      mocks.db.select
        .mockReturnValueOnce({ from: activePharmaciesQuery.from })
        .mockReturnValueOnce({ from: nearExpiryQuery.from })
        .mockReturnValueOnce({ from: stockQuery.from })
        .mockReturnValueOnce({ from: usageQuery.from });

      const result = await runPredictiveAlertsJob({
        now: new Date('2026-03-15T00:00:00.000Z'),
        excessStockMonths: 3,
      });

      expect(result.excessStockAlerts).toBe(0);
      expect(result.generatedAlerts).toBe(0);
    });

    it('skips usage row with non-positive monthlyUsage', async () => {
      const activePharmaciesQuery = createSelectWhereResult([{ id: 3 }]);
      const nearExpiryQuery = createSelectWhereGroupByResult([]);
      const stockQuery = createSelectWhereResult([
        {
          pharmacyId: 3,
          drugName: '廃止薬',
          drugMasterId: 300,
          drugMasterPackageId: null,
          quantity: 100,
          yakkaUnitPrice: 10,
        },
      ]);
      // monthlyUsage = 0, should be skipped
      const usageQuery = createSelectWhereResult([
        {
          pharmacyId: 3,
          drugName: '廃止薬',
          drugMasterId: 300,
          drugMasterPackageId: null,
          monthlyUsage: 0,
        },
      ]);

      mocks.db.select
        .mockReturnValueOnce({ from: activePharmaciesQuery.from })
        .mockReturnValueOnce({ from: nearExpiryQuery.from })
        .mockReturnValueOnce({ from: stockQuery.from })
        .mockReturnValueOnce({ from: usageQuery.from });

      const result = await runPredictiveAlertsJob({
        now: new Date('2026-03-15T00:00:00.000Z'),
      });

      expect(result.excessStockAlerts).toBe(0);
    });

    it('uses drugMasterPackageId key when available', async () => {
      const activePharmaciesQuery = createSelectWhereResult([{ id: 4 }]);
      const nearExpiryQuery = createSelectWhereGroupByResult([]);
      const stockQuery = createSelectWhereResult([
        {
          pharmacyId: 4,
          drugName: 'パッケージ薬',
          drugMasterId: 400,
          drugMasterPackageId: 50,
          quantity: 200,
          yakkaUnitPrice: 30,
        },
      ]);
      const usageQuery = createSelectWhereResult([
        {
          pharmacyId: 4,
          drugName: 'パッケージ薬',
          drugMasterId: 400,
          drugMasterPackageId: 50,
          monthlyUsage: 30,
        },
      ]);

      mocks.db.select
        .mockReturnValueOnce({ from: activePharmaciesQuery.from })
        .mockReturnValueOnce({ from: nearExpiryQuery.from })
        .mockReturnValueOnce({ from: stockQuery.from })
        .mockReturnValueOnce({ from: usageQuery.from });

      mocks.db.transaction.mockImplementation(async (callback: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) => {
        return callback(makeTx(4001, 5001));
      });

      const result = await runPredictiveAlertsJob({
        now: new Date('2026-03-15T00:00:00.000Z'),
        excessStockMonths: 3,
      });

      expect(result.excessStockAlerts).toBe(1);
    });

    it('uses name-based key when no drugMasterId or packageId', async () => {
      const activePharmaciesQuery = createSelectWhereResult([{ id: 5 }]);
      const nearExpiryQuery = createSelectWhereGroupByResult([]);
      const stockQuery = createSelectWhereResult([
        {
          pharmacyId: 5,
          drugName: 'アスピリン',
          drugMasterId: null,
          drugMasterPackageId: null,
          quantity: 500,
          yakkaUnitPrice: 5,
        },
      ]);
      const usageQuery = createSelectWhereResult([
        {
          pharmacyId: 5,
          drugName: 'アスピリン',
          drugMasterId: null,
          drugMasterPackageId: null,
          monthlyUsage: 100,
        },
      ]);

      mocks.db.select
        .mockReturnValueOnce({ from: activePharmaciesQuery.from })
        .mockReturnValueOnce({ from: nearExpiryQuery.from })
        .mockReturnValueOnce({ from: stockQuery.from })
        .mockReturnValueOnce({ from: usageQuery.from });

      mocks.db.transaction.mockImplementation(async (callback: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) => {
        return callback(makeTx(5001, 6001));
      });

      const result = await runPredictiveAlertsJob({
        now: new Date('2026-03-15T00:00:00.000Z'),
        excessStockMonths: 3,
      });

      expect(result.excessStockAlerts).toBe(1);
    });

    it('skips stock row with empty normalized drug name (null key)', async () => {
      const activePharmaciesQuery = createSelectWhereResult([{ id: 6 }]);
      const nearExpiryQuery = createSelectWhereGroupByResult([]);
      // normalizeString returns empty string for blank input
      mocks.normalizeString.mockReturnValueOnce('');
      const stockQuery = createSelectWhereResult([
        {
          pharmacyId: 6,
          drugName: '   ',
          drugMasterId: null,
          drugMasterPackageId: null,
          quantity: 100,
          yakkaUnitPrice: 10,
        },
      ]);
      const usageQuery = createSelectWhereResult([]);

      mocks.db.select
        .mockReturnValueOnce({ from: activePharmaciesQuery.from })
        .mockReturnValueOnce({ from: nearExpiryQuery.from })
        .mockReturnValueOnce({ from: stockQuery.from })
        .mockReturnValueOnce({ from: usageQuery.from });

      const result = await runPredictiveAlertsJob({
        now: new Date('2026-03-15T00:00:00.000Z'),
      });

      expect(result.excessStockAlerts).toBe(0);
    });

    it('skips stock row with non-positive quantity', async () => {
      const activePharmaciesQuery = createSelectWhereResult([{ id: 7 }]);
      const nearExpiryQuery = createSelectWhereGroupByResult([]);
      const stockQuery = createSelectWhereResult([
        {
          pharmacyId: 7,
          drugName: 'テスト',
          drugMasterId: 700,
          drugMasterPackageId: null,
          quantity: 0,
          yakkaUnitPrice: 100,
        },
      ]);
      const usageQuery = createSelectWhereResult([
        {
          pharmacyId: 7,
          drugName: 'テスト',
          drugMasterId: 700,
          drugMasterPackageId: null,
          monthlyUsage: 5,
        },
      ]);

      mocks.db.select
        .mockReturnValueOnce({ from: activePharmaciesQuery.from })
        .mockReturnValueOnce({ from: nearExpiryQuery.from })
        .mockReturnValueOnce({ from: stockQuery.from })
        .mockReturnValueOnce({ from: usageQuery.from });

      const result = await runPredictiveAlertsJob({
        now: new Date('2026-03-15T00:00:00.000Z'),
      });

      expect(result.excessStockAlerts).toBe(0);
    });

    it('skips excess stock pharmacy when no matching usage data', async () => {
      const activePharmaciesQuery = createSelectWhereResult([{ id: 8 }]);
      const nearExpiryQuery = createSelectWhereGroupByResult([]);
      const stockQuery = createSelectWhereResult([
        {
          pharmacyId: 8,
          drugName: 'テスト薬',
          drugMasterId: 800,
          drugMasterPackageId: null,
          quantity: 200,
          yakkaUnitPrice: 15,
        },
      ]);
      // No usage data at all
      const usageQuery = createSelectWhereResult([]);

      mocks.db.select
        .mockReturnValueOnce({ from: activePharmaciesQuery.from })
        .mockReturnValueOnce({ from: nearExpiryQuery.from })
        .mockReturnValueOnce({ from: stockQuery.from })
        .mockReturnValueOnce({ from: usageQuery.from });

      const result = await runPredictiveAlertsJob({
        now: new Date('2026-03-15T00:00:00.000Z'),
      });

      expect(result.excessStockAlerts).toBe(0);
    });
  });

  describe('runPredictiveAlertsJob - push notification', () => {
    it('dispatches push when VAPID keys are set', async () => {
      vi.stubEnv('VAPID_PUBLIC_KEY', 'test-public-key');
      vi.stubEnv('VAPID_PRIVATE_KEY', 'test-private-key');

      const activePharmaciesQuery = createSelectWhereResult([{ id: 10 }]);
      const nearExpiryQuery = createSelectWhereGroupByResult([
        { pharmacyId: 10, itemCount: 2, totalValue: 600, nearestExpiryDate: '2026-04-15' },
      ]);
      const stockQuery = createSelectWhereResult([]);
      const usageQuery = createSelectWhereResult([]);

      mocks.db.select
        .mockReturnValueOnce({ from: activePharmaciesQuery.from })
        .mockReturnValueOnce({ from: nearExpiryQuery.from })
        .mockReturnValueOnce({ from: stockQuery.from })
        .mockReturnValueOnce({ from: usageQuery.from });

      mocks.db.transaction.mockImplementation(async (callback: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) => {
        return callback(makeTx(9001, 9002));
      });

      await runPredictiveAlertsJob({ now: new Date('2026-03-15T00:00:00.000Z') });

      expect(mocks.sendToPharmacy).toHaveBeenCalledWith(
        10,
        expect.objectContaining({
          title: '期限切迫在庫の予兆があります',
          data: expect.objectContaining({ type: 'near_expiry' }),
        }),
      );
    });

    it('does not dispatch push when VAPID keys missing', async () => {
      vi.stubEnv('VAPID_PUBLIC_KEY', '');
      vi.stubEnv('VAPID_PRIVATE_KEY', '');

      const activePharmaciesQuery = createSelectWhereResult([{ id: 11 }]);
      const nearExpiryQuery = createSelectWhereGroupByResult([
        { pharmacyId: 11, itemCount: 1, totalValue: 200, nearestExpiryDate: '2026-04-15' },
      ]);
      const stockQuery = createSelectWhereResult([]);
      const usageQuery = createSelectWhereResult([]);

      mocks.db.select
        .mockReturnValueOnce({ from: activePharmaciesQuery.from })
        .mockReturnValueOnce({ from: nearExpiryQuery.from })
        .mockReturnValueOnce({ from: stockQuery.from })
        .mockReturnValueOnce({ from: usageQuery.from });

      mocks.db.transaction.mockImplementation(async (callback: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) => {
        return callback(makeTx(9101, 9102));
      });

      await runPredictiveAlertsJob({ now: new Date('2026-03-15T00:00:00.000Z') });

      expect(mocks.sendToPharmacy).not.toHaveBeenCalled();
    });

    it('logs warning when push dispatch fails but does not fail the alert', async () => {
      vi.stubEnv('VAPID_PUBLIC_KEY', 'test-key');
      vi.stubEnv('VAPID_PRIVATE_KEY', 'test-key');
      mocks.sendToPharmacy.mockRejectedValueOnce(new Error('Push failed'));

      const activePharmaciesQuery = createSelectWhereResult([{ id: 12 }]);
      const nearExpiryQuery = createSelectWhereGroupByResult([
        { pharmacyId: 12, itemCount: 1, totalValue: 100, nearestExpiryDate: '2026-04-15' },
      ]);
      const stockQuery = createSelectWhereResult([]);
      const usageQuery = createSelectWhereResult([]);

      mocks.db.select
        .mockReturnValueOnce({ from: activePharmaciesQuery.from })
        .mockReturnValueOnce({ from: nearExpiryQuery.from })
        .mockReturnValueOnce({ from: stockQuery.from })
        .mockReturnValueOnce({ from: usageQuery.from });

      mocks.db.transaction.mockImplementation(async (callback: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) => {
        return callback(makeTx(9201, 9202));
      });

      const result = await runPredictiveAlertsJob({ now: new Date('2026-03-15T00:00:00.000Z') });

      // Alert was still created despite push failure
      expect(result.generatedAlerts).toBe(1);
      expect(mocks.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('push notification'),
        expect.any(Object),
      );
    });

    it('logs warning with error message string when non-Error is thrown', async () => {
      vi.stubEnv('VAPID_PUBLIC_KEY', 'test-key');
      vi.stubEnv('VAPID_PRIVATE_KEY', 'test-key');
      mocks.sendToPharmacy.mockRejectedValueOnce('string error');

      const activePharmaciesQuery = createSelectWhereResult([{ id: 13 }]);
      const nearExpiryQuery = createSelectWhereGroupByResult([
        { pharmacyId: 13, itemCount: 1, totalValue: 100, nearestExpiryDate: '2026-04-15' },
      ]);
      const stockQuery = createSelectWhereResult([]);
      const usageQuery = createSelectWhereResult([]);

      mocks.db.select
        .mockReturnValueOnce({ from: activePharmaciesQuery.from })
        .mockReturnValueOnce({ from: nearExpiryQuery.from })
        .mockReturnValueOnce({ from: stockQuery.from })
        .mockReturnValueOnce({ from: usageQuery.from });

      mocks.db.transaction.mockImplementation(async (callback: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) => {
        return callback(makeTx(9301, 9302));
      });

      const result = await runPredictiveAlertsJob({ now: new Date('2026-03-15T00:00:00.000Z') });
      expect(result.generatedAlerts).toBe(1);
    });
  });

  describe('runPredictiveAlertsJob - excess stock notification type', () => {
    it('creates excess_stock notification type for excess stock alerts', async () => {
      vi.stubEnv('VAPID_PUBLIC_KEY', '');
      vi.stubEnv('VAPID_PRIVATE_KEY', '');

      const activePharmaciesQuery = createSelectWhereResult([{ id: 20 }]);
      const nearExpiryQuery = createSelectWhereGroupByResult([]);
      const stockQuery = createSelectWhereResult([
        {
          pharmacyId: 20,
          drugName: 'テスト薬品',
          drugMasterId: 2000,
          drugMasterPackageId: null,
          quantity: 1000,
          yakkaUnitPrice: 50,
        },
      ]);
      const usageQuery = createSelectWhereResult([
        {
          pharmacyId: 20,
          drugName: 'テスト薬品',
          drugMasterId: 2000,
          drugMasterPackageId: null,
          monthlyUsage: 100,
        },
      ]);

      mocks.db.select
        .mockReturnValueOnce({ from: activePharmaciesQuery.from })
        .mockReturnValueOnce({ from: nearExpiryQuery.from })
        .mockReturnValueOnce({ from: stockQuery.from })
        .mockReturnValueOnce({ from: usageQuery.from });

      let capturedNotifValues: unknown = null;
      mocks.db.transaction.mockImplementation(async (callback: (tx: {
        insert: ReturnType<typeof vi.fn>;
        update: ReturnType<typeof vi.fn>;
      }) => Promise<unknown>) => {
        const alertInsert = createTxInsertAlert(8001);
        const notifInsert = createTxInsertNotification(8002);
        const txInsert = vi.fn()
          .mockReturnValueOnce(alertInsert)
          .mockReturnValueOnce(notifInsert);

        // Capture notification values
        const originalValues = notifInsert.values;
        notifInsert.values = vi.fn().mockImplementation((vals: unknown) => {
          capturedNotifValues = vals;
          return originalValues(vals);
        });

        const txUpdate = vi.fn().mockReturnValue(createUpdateSetWhereResult([{ id: 8001 }]));
        return callback({ insert: txInsert, update: txUpdate });
      });

      await runPredictiveAlertsJob({
        now: new Date('2026-03-15T00:00:00.000Z'),
        excessStockMonths: 3,
      });

      expect(capturedNotifValues).toMatchObject({
        type: 'alert_excess_stock',
        pharmacyId: 20,
      });
    });
  });

  describe('runPredictiveAlertsJob - options resolution', () => {
    it('uses nearExpiryDays from options when valid', async () => {
      const activePharmaciesQuery = createSelectWhereResult([{ id: 1 }]);
      const nearExpiryQuery = createSelectWhereGroupByResult([]);
      const stockQuery = createSelectWhereResult([]);
      const usageQuery = createSelectWhereResult([]);

      mocks.db.select
        .mockReturnValueOnce({ from: activePharmaciesQuery.from })
        .mockReturnValueOnce({ from: nearExpiryQuery.from })
        .mockReturnValueOnce({ from: stockQuery.from })
        .mockReturnValueOnce({ from: usageQuery.from });

      // Valid nearExpiryDays = 90
      const result = await runPredictiveAlertsJob({
        now: new Date('2026-03-15T00:00:00.000Z'),
        nearExpiryDays: 90,
      });

      expect(result.processedPharmacies).toBe(1);
    });

    it('falls back to env when nearExpiryDays is invalid', async () => {
      const activePharmaciesQuery = createSelectWhereResult([{ id: 1 }]);
      const nearExpiryQuery = createSelectWhereGroupByResult([]);
      const stockQuery = createSelectWhereResult([]);
      const usageQuery = createSelectWhereResult([]);

      mocks.db.select
        .mockReturnValueOnce({ from: activePharmaciesQuery.from })
        .mockReturnValueOnce({ from: nearExpiryQuery.from })
        .mockReturnValueOnce({ from: stockQuery.from })
        .mockReturnValueOnce({ from: usageQuery.from });

      // Invalid nearExpiryDays (outside 1-180 range)
      const result = await runPredictiveAlertsJob({
        now: new Date('2026-03-15T00:00:00.000Z'),
        nearExpiryDays: 200,
      });

      expect(result.processedPharmacies).toBe(1);
    });

    it('falls back to env when excessStockMonths is invalid', async () => {
      const activePharmaciesQuery = createSelectWhereResult([{ id: 1 }]);
      const nearExpiryQuery = createSelectWhereGroupByResult([]);
      const stockQuery = createSelectWhereResult([]);
      const usageQuery = createSelectWhereResult([]);

      mocks.db.select
        .mockReturnValueOnce({ from: activePharmaciesQuery.from })
        .mockReturnValueOnce({ from: nearExpiryQuery.from })
        .mockReturnValueOnce({ from: stockQuery.from })
        .mockReturnValueOnce({ from: usageQuery.from });

      // Invalid excessStockMonths (outside 1-12 range)
      const result = await runPredictiveAlertsJob({
        now: new Date('2026-03-15T00:00:00.000Z'),
        excessStockMonths: 15,
      });

      expect(result.processedPharmacies).toBe(1);
    });

    it('includes generatedAt ISO timestamp in result', async () => {
      const activePharmaciesQuery = createSelectWhereResult([]);
      mocks.db.select.mockReturnValueOnce({ from: activePharmaciesQuery.from });

      const result = await runPredictiveAlertsJob({});
      expect(result.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('processes multiple pharmacies in batch', async () => {
      const pharmacyIds = Array.from({ length: 3 }, (_, i) => ({ id: i + 1 }));
      const activePharmaciesQuery = createSelectWhereResult(pharmacyIds);
      const nearExpiryQuery = createSelectWhereGroupByResult([
        { pharmacyId: 1, itemCount: 2, totalValue: 600, nearestExpiryDate: '2026-04-15' },
        { pharmacyId: 2, itemCount: 1, totalValue: 300, nearestExpiryDate: '2026-04-20' },
      ]);
      const stockQuery = createSelectWhereResult([]);
      const usageQuery = createSelectWhereResult([]);

      mocks.db.select
        .mockReturnValueOnce({ from: activePharmaciesQuery.from })
        .mockReturnValueOnce({ from: nearExpiryQuery.from })
        .mockReturnValueOnce({ from: stockQuery.from })
        .mockReturnValueOnce({ from: usageQuery.from });

      mocks.db.transaction
        .mockImplementationOnce(async (cb: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) => cb(makeTx(1001, 2001)))
        .mockImplementationOnce(async (cb: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) => cb(makeTx(1002, 2002)));

      const result = await runPredictiveAlertsJob({
        now: new Date('2026-03-15T00:00:00.000Z'),
      });

      expect(result.processedPharmacies).toBe(3);
      expect(result.generatedAlerts).toBe(2);
      expect(result.nearExpiryAlerts).toBe(2);
    });

    it('handles notification insert returning null notificationId', async () => {
      const activePharmaciesQuery = createSelectWhereResult([{ id: 30 }]);
      const nearExpiryQuery = createSelectWhereGroupByResult([
        { pharmacyId: 30, itemCount: 1, totalValue: 100, nearestExpiryDate: '2026-04-01' },
      ]);
      const stockQuery = createSelectWhereResult([]);
      const usageQuery = createSelectWhereResult([]);

      mocks.db.select
        .mockReturnValueOnce({ from: activePharmaciesQuery.from })
        .mockReturnValueOnce({ from: nearExpiryQuery.from })
        .mockReturnValueOnce({ from: stockQuery.from })
        .mockReturnValueOnce({ from: usageQuery.from });

      // Alert created but notification returns null
      mocks.db.transaction.mockImplementation(async (callback: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) => {
        return callback(makeTx(7001, null));
      });

      const result = await runPredictiveAlertsJob({
        now: new Date('2026-03-15T00:00:00.000Z'),
      });

      expect(result.generatedAlerts).toBe(1);
    });
  });
});
