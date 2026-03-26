import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadInventorySearchPreferences: vi.fn(),
  saveInventorySearchPreferences: vi.fn(),
  saveUpdatedInventorySearchPreferences: vi.fn(),
}));

vi.mock('../middleware/auth', () => ({
  requireLogin: (
    req: { user?: { id: number; email: string; isAdmin: boolean } },
    _res: unknown,
    next: () => void,
  ) => {
    req.user = { id: 1, email: 'pharmacy@example.com', isAdmin: false };
    next();
  },
}));

vi.mock('../services/inventory-search-preferences-service', () => ({
  loadInventorySearchPreferences: mocks.loadInventorySearchPreferences,
  saveInventorySearchPreferences: mocks.saveInventorySearchPreferences,
  saveUpdatedInventorySearchPreferences: mocks.saveUpdatedInventorySearchPreferences,
}));

vi.mock('../services/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../middleware/error-handler', () => ({
  getErrorMessage: (err: unknown) => (err instanceof Error ? err.message : String(err)),
}));

let accountInventorySearchRouter: express.Router;

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/account', accountInventorySearchRouter);
  return app;
}

const validDraft = {
  chips: [{
    drugMasterId: 1,
    genericName: 'アスピリン',
    specification: '100mg',
    displayLabel: 'アスピリン 100mg',
  }],
  filters: {
    groupOnly: true,
    openOnly: false,
    favoritePriority: true,
  },
  useCurrentLocation: false,
};

const validPreferences = {
  version: 3,
  draft: validDraft,
  searchHistory: [],
  savedPresets: [],
};

describe('account inventory search routes', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    vi.resetModules();
    ({ default: accountInventorySearchRouter } = await import('../routes/account-inventory-search'));
  });

  it('GET /api/account/inventory-search-preferences returns the saved preferences', async () => {
    mocks.loadInventorySearchPreferences.mockResolvedValue(validPreferences);

    const res = await request(createApp()).get('/api/account/inventory-search-preferences');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(validPreferences);
    expect(mocks.loadInventorySearchPreferences).toHaveBeenCalledWith(1);
  });

  it('PUT /api/account/inventory-search-preferences saves the full preferences payload', async () => {
    mocks.saveInventorySearchPreferences.mockResolvedValue({ ok: true, version: 4 });

    const res = await request(createApp())
      .put('/api/account/inventory-search-preferences')
      .send(validPreferences);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: '検索条件を保存しました', version: 4 });
    expect(mocks.saveInventorySearchPreferences).toHaveBeenCalledWith(1, validPreferences);
  });

  it('PUT /api/account/inventory-search-preferences/draft returns 409 with latest data on conflict', async () => {
    mocks.saveUpdatedInventorySearchPreferences.mockResolvedValue({
      ok: false,
      latestData: validPreferences,
    });

    const res = await request(createApp())
      .put('/api/account/inventory-search-preferences/draft')
      .send({
        version: 3,
        draft: validDraft,
      });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      error: '検索条件が別の画面で更新されました。最新の条件を確認してください',
      latestData: validPreferences,
    });
  });

  it('PUT /api/account/inventory-search-preferences/history validates the payload', async () => {
    const res = await request(createApp())
      .put('/api/account/inventory-search-preferences/history')
      .send({
        version: 1,
        searchHistory: [{
          id: 'bad-history',
        }],
      });

    expect(res.status).toBe(400);
    expect(mocks.saveUpdatedInventorySearchPreferences).not.toHaveBeenCalled();
  });

  it('PUT /api/account/inventory-search-preferences/presets saves presets updates', async () => {
    mocks.saveUpdatedInventorySearchPreferences.mockResolvedValue({ ok: true, version: 8 });

    const res = await request(createApp())
      .put('/api/account/inventory-search-preferences/presets')
      .send({
        version: 7,
        savedPresets: [{
          id: 'preset-1',
          name: '営業時間優先',
          createdAt: '2026-03-21T00:00:00.000Z',
          updatedAt: '2026-03-21T00:00:00.000Z',
          useCount: 0,
          pinned: false,
          chips: [],
          filters: {
            groupOnly: false,
            openOnly: true,
            favoritePriority: false,
          },
          useCurrentLocation: false,
        }],
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: '保存済み検索を保存しました', version: 8 });
  });
});
