import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('../middleware/auth', () => ({
  requireLogin: (req: { user?: { id: number; email: string; isAdmin: boolean } }, _res: unknown, next: () => void) => {
    req.user = { id: 1, email: 'test@example.com', isAdmin: false };
    next();
  },
}));

vi.mock('../config/database', () => ({ db: mocks.db }));

vi.mock('../services/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../utils/business-hours-utils', () => ({
  getBusinessHoursStatus: vi.fn(() => ({ isOpen: false, label: '休業' })),
}));

vi.mock('../utils/array-utils', () => ({
  groupBy: vi.fn(() => new Map()),
}));

vi.mock('../utils/geo-utils', () => ({
  haversineDistance: vi.fn(() => 10.5),
}));

vi.mock('../utils/kana-utils', () => ({
  katakanaToHiragana: vi.fn((s: string) => s),
  hiraganaToKatakana: vi.fn((s: string) => s),
  normalizeKana: vi.fn((s: string) => s),
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(() => ({})),
  and: vi.fn(() => ({})),
  or: vi.fn(() => ({})),
  like: vi.fn(() => ({})),
  desc: vi.fn(() => ({})),
  asc: vi.fn(() => ({})),
  inArray: vi.fn(() => ({})),
  sql: vi.fn(() => ({})),
}));

import pharmaciesRouter from '../routes/pharmacies';
import { createAuthenticatedApp } from './helpers/mock-builders';

function createApp() {
  return createAuthenticatedApp('/api/pharmacies', pharmaciesRouter);
}

describe('pharmacies routes — coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /:id', () => {
    it('returns pharmacy detail', async () => {
      const app = createApp();
      mocks.db.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{
              id: 5, name: 'テスト薬局', prefecture: '東京都', address: '千代田1-1',
              phone: '03-1234-5678', fax: '03-1234-5679',
            }]),
          }),
        }),
      });

      const res = await request(app).get('/api/pharmacies/5');

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('テスト薬局');
    });

    it('returns 404 when pharmacy not found', async () => {
      const app = createApp();
      mocks.db.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      });

      const res = await request(app).get('/api/pharmacies/999');

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('薬局が見つかりません');
    });

    it('returns 400 for invalid id', async () => {
      const app = createApp();

      const res = await request(app).get('/api/pharmacies/abc');

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('不正なID');
    });

    it('returns 500 on database error', async () => {
      const app = createApp();
      mocks.db.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockRejectedValue(new Error('DB error')),
          }),
        }),
      });

      const res = await request(app).get('/api/pharmacies/5');

      expect(res.status).toBe(500);
      expect(res.body.error).toContain('薬局情報の取得に失敗');
    });
  });

  describe('POST /:id/favorite', () => {
    it('adds favorite successfully', async () => {
      const app = createApp();
      mocks.db.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ id: 5 }]),
          }),
        }),
      });
      mocks.db.insert.mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
        }),
      });

      const res = await request(app).post('/api/pharmacies/5/favorite');

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('お気に入りに設定');
    });

    it('returns 400 for self-favorite', async () => {
      const app = createApp();

      const res = await request(app).post('/api/pharmacies/1/favorite');

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('自分自身');
    });

    it('returns 404 when target pharmacy not found', async () => {
      const app = createApp();
      mocks.db.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      });

      const res = await request(app).post('/api/pharmacies/999/favorite');

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('対象の薬局が見つかりません');
    });

    it('returns 400 for invalid id', async () => {
      const app = createApp();

      const res = await request(app).post('/api/pharmacies/abc/favorite');

      expect(res.status).toBe(400);
    });

    it('returns 500 on database error', async () => {
      const app = createApp();
      mocks.db.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockRejectedValue(new Error('DB error')),
          }),
        }),
      });

      const res = await request(app).post('/api/pharmacies/5/favorite');

      expect(res.status).toBe(500);
    });
  });

  describe('DELETE /:id/favorite', () => {
    it('removes favorite', async () => {
      const app = createApp();
      mocks.db.delete.mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      });

      const res = await request(app).delete('/api/pharmacies/5/favorite');

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('お気に入りを解除');
    });

    it('returns 400 for invalid id', async () => {
      const app = createApp();

      const res = await request(app).delete('/api/pharmacies/abc/favorite');

      expect(res.status).toBe(400);
    });

    it('returns 500 on database error', async () => {
      const app = createApp();
      mocks.db.delete.mockReturnValue({
        where: vi.fn().mockRejectedValue(new Error('DB error')),
      });

      const res = await request(app).delete('/api/pharmacies/5/favorite');

      expect(res.status).toBe(500);
    });
  });

  describe('POST /:id/block', () => {
    it('blocks pharmacy successfully', async () => {
      const app = createApp();
      mocks.db.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ id: 5 }]),
          }),
        }),
      });
      mocks.db.insert.mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
        }),
      });

      const res = await request(app).post('/api/pharmacies/5/block');

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('ブロックしました');
    });

    it('returns 400 for self-block', async () => {
      const app = createApp();

      const res = await request(app).post('/api/pharmacies/1/block');

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('自分自身');
    });

    it('returns 404 when target not found', async () => {
      const app = createApp();
      mocks.db.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      });

      const res = await request(app).post('/api/pharmacies/999/block');

      expect(res.status).toBe(404);
    });

    it('returns 500 on database error', async () => {
      const app = createApp();
      mocks.db.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockRejectedValue(new Error('DB error')),
          }),
        }),
      });

      const res = await request(app).post('/api/pharmacies/5/block');

      expect(res.status).toBe(500);
    });
  });

  describe('DELETE /:id/block', () => {
    it('removes block', async () => {
      const app = createApp();
      mocks.db.delete.mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      });

      const res = await request(app).delete('/api/pharmacies/5/block');

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('ブロックを解除');
    });

    it('returns 400 for invalid id', async () => {
      const app = createApp();

      const res = await request(app).delete('/api/pharmacies/abc/block');

      expect(res.status).toBe(400);
    });

    it('returns 500 on database error', async () => {
      const app = createApp();
      mocks.db.delete.mockReturnValue({
        where: vi.fn().mockRejectedValue(new Error('DB error')),
      });

      const res = await request(app).delete('/api/pharmacies/5/block');

      expect(res.status).toBe(500);
    });
  });

  describe('GET /relationships', () => {
    it('returns relationships list', async () => {
      const app = createApp();
      mocks.db.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([
              { id: 1, targetPharmacyId: 5, relationshipType: 'favorite', createdAt: '2026-01-01', targetPharmacyName: 'テスト' },
              { id: 2, targetPharmacyId: 6, relationshipType: 'blocked', createdAt: '2026-01-02', targetPharmacyName: 'テスト2' },
            ]),
          }),
        }),
      });

      const res = await request(app).get('/api/pharmacies/relationships');

      expect(res.status).toBe(200);
      expect(res.body.favorites).toHaveLength(1);
      expect(res.body.blocked).toHaveLength(1);
    });

    it('returns 500 on database error', async () => {
      const app = createApp();
      mocks.db.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockRejectedValue(new Error('DB error')),
          }),
        }),
      });

      const res = await request(app).get('/api/pharmacies/relationships');

      expect(res.status).toBe(500);
      expect(res.body.error).toContain('リレーション情報の取得に失敗');
    });
  });
});
