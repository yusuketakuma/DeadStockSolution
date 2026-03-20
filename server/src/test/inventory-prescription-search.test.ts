import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  searchPrescriptionInventory: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock('../middleware/auth', () => ({
  requireLogin: (req: { user?: { id: number; email: string; isAdmin: boolean } }, _res: unknown, next: () => void) => {
    req.user = { id: 1, email: 'pharmacy@example.com', isAdmin: false };
    next();
  },
}));

vi.mock('../config/database', () => ({
  db: {
    select: vi.fn(),
    delete: vi.fn(),
    insert: vi.fn(),
    transaction: vi.fn(),
  },
}));

vi.mock('../services/prescription-search-service', () => ({
  searchPrescriptionInventory: mocks.searchPrescriptionInventory,
}));

vi.mock('../services/expiry-risk-service', () => ({
  getPharmacyRiskDetail: vi.fn(),
  invalidateAdminRiskSnapshotCache: vi.fn(),
}));

vi.mock('../services/matching-refresh-service', () => ({
  triggerMatchingRefreshOnUpload: vi.fn(),
}));

vi.mock('../utils/business-hours-utils', () => ({
  getBusinessHoursStatus: vi.fn(() => ({ isOpen: true, statusText: '営業中' })),
}));

vi.mock('../services/log-service', () => ({
  writeLog: vi.fn(),
  getClientIp: vi.fn(() => '127.0.0.1'),
}));

vi.mock('../services/logger', () => ({
  logger: {
    error: mocks.loggerError,
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(() => ({})),
  and: vi.fn(() => ({})),
  or: vi.fn(() => ({})),
  like: vi.fn(() => ({})),
  ilike: vi.fn(() => ({})),
  desc: vi.fn(() => ({})),
  inArray: vi.fn(() => ({})),
  notExists: vi.fn(() => ({})),
  ne: vi.fn(() => ({})),
  isNull: vi.fn(() => ({})),
  sql: vi.fn(() => ({})),
}));

import inventoryRouter from '../routes/inventory';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/inventory', inventoryRouter);
  return app;
}

const validDrugKey = {
  drugMasterId: 10,
  genericName: 'テスト成分',
  specification: '10mg',
};

const validSearchBody = {
  drugKeys: [validDrugKey],
  filters: { groupOnly: false, openOnly: false, favoritePriority: false },
  coordinates: null,
};

const mockSearchResult = {
  summary: [
    {
      pharmacyId: 2,
      pharmacyName: '相手薬局',
      matchedCount: 1,
      totalDrugs: 1,
      totalYakka: 100,
      distance: 1.5,
      isFavorite: false,
      isGroupMember: false,
      businessStatus: { isOpen: true, message: '', isConfigured: false },
    },
  ],
  matrix: {
    columns: [{ genericName: 'テスト成分', specification: '10mg', columnLabel: 'テスト成分 10mg' }],
    rows: [
      {
        pharmacyId: 2,
        pharmacyName: '相手薬局',
        cells: [{ available: true, items: [{ drugName: '薬A錠10mg', manufacturer: null, yakkaUnitPrice: 100, quantity: 5, unit: '錠' }] }],
      },
    ],
  },
};

describe('POST /api/inventory/prescription-search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 when drugKeys is empty array', async () => {
    const app = createApp();

    const response = await request(app)
      .post('/api/inventory/prescription-search')
      .send({ drugKeys: [], filters: { groupOnly: false, openOnly: false, favoritePriority: false }, coordinates: null });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('薬剤を1つ以上選択してください');
    expect(mocks.searchPrescriptionInventory).not.toHaveBeenCalled();
  });

  it('returns 400 when drugKeys is missing', async () => {
    const app = createApp();

    const response = await request(app)
      .post('/api/inventory/prescription-search')
      .send({});

    expect(response.status).toBe(400);
    expect(mocks.searchPrescriptionInventory).not.toHaveBeenCalled();
  });

  it('returns 200 with search result for valid request', async () => {
    const app = createApp();
    mocks.searchPrescriptionInventory.mockResolvedValue(mockSearchResult);

    const response = await request(app)
      .post('/api/inventory/prescription-search')
      .send(validSearchBody);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(mockSearchResult);
    expect(mocks.searchPrescriptionInventory).toHaveBeenCalledWith(
      1,
      validSearchBody.drugKeys,
      validSearchBody.filters,
      validSearchBody.coordinates,
    );
  });

  it('returns 400 when drugKeys exceeds 10 items', async () => {
    const app = createApp();

    const elevenKeys = Array.from({ length: 11 }, (_, i) => ({
      drugMasterId: i + 1,
      genericName: `成分${i + 1}`,
      specification: null,
    }));

    const response = await request(app)
      .post('/api/inventory/prescription-search')
      .send({ drugKeys: elevenKeys, filters: { groupOnly: false, openOnly: false, favoritePriority: false }, coordinates: null });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('薬剤は10品目まで検索できます');
    expect(mocks.searchPrescriptionInventory).not.toHaveBeenCalled();
  });

  it('returns 500 when service throws unexpected error', async () => {
    const app = createApp();
    mocks.searchPrescriptionInventory.mockRejectedValue(new Error('DB接続エラー'));

    const response = await request(app)
      .post('/api/inventory/prescription-search')
      .send(validSearchBody);

    expect(response.status).toBe(500);
    expect(response.body.error).toBe('サーバーエラーが発生しました');
    expect(mocks.loggerError).toHaveBeenCalledWith('Prescription search error', expect.objectContaining({ error: 'DB接続エラー' }));
  });

  it('applies default filters when filters field is omitted', async () => {
    const app = createApp();
    mocks.searchPrescriptionInventory.mockResolvedValue(mockSearchResult);

    const response = await request(app)
      .post('/api/inventory/prescription-search')
      .send({ drugKeys: [validDrugKey] });

    expect(response.status).toBe(200);
    expect(mocks.searchPrescriptionInventory).toHaveBeenCalledWith(
      1,
      [validDrugKey],
      { groupOnly: false, openOnly: false, favoritePriority: false },
      null,
    );
  });
});
