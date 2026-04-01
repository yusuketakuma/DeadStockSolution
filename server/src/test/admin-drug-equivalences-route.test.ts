import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  class DrugEquivalenceValidationError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'DrugEquivalenceValidationError';
    }
  }
  class DrugEquivalenceDuplicateError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'DrugEquivalenceDuplicateError';
    }
  }

  return {
    createDrugEquivalence: vi.fn(),
    getDrugEquivalenceById: vi.fn(),
    listDrugEquivalences: vi.fn(),
    updateDrugEquivalence: vi.fn(),
    deleteDrugEquivalence: vi.fn(),
    DrugEquivalenceValidationError,
    DrugEquivalenceDuplicateError,
  };
});

vi.mock('../services/drug-master/equivalence-service', () => ({
  createDrugEquivalence: mocks.createDrugEquivalence,
  getDrugEquivalenceById: mocks.getDrugEquivalenceById,
  listDrugEquivalences: mocks.listDrugEquivalences,
  updateDrugEquivalence: mocks.updateDrugEquivalence,
  deleteDrugEquivalence: mocks.deleteDrugEquivalence,
  DrugEquivalenceValidationError: mocks.DrugEquivalenceValidationError,
  DrugEquivalenceDuplicateError: mocks.DrugEquivalenceDuplicateError,
}));

vi.mock('../routes/admin-write-limiter', () => ({
  adminWriteLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('../services/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

let adminDrugEquivalencesRouter: (typeof import('../routes/admin-drug-equivalences'))['default'];

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminDrugEquivalencesRouter);
  return app;
}

const sampleEquivalence = {
  id: 1,
  drugNameA: 'バイアスピリン',
  drugNameB: 'アスピリン',
  equivalenceType: 'brand_generic',
  notes: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('admin drug equivalences routes', () => {
  beforeEach(async () => {
    vi.useRealTimers();
    vi.resetAllMocks();
    vi.resetModules();
    ({ default: adminDrugEquivalencesRouter } = await import('../routes/admin-drug-equivalences'));
  });

  describe('GET /drug-equivalences', () => {
    it('一覧を取得できる', async () => {
      mocks.listDrugEquivalences.mockResolvedValue([sampleEquivalence]);
      const app = createApp();

      const response = await request(app).get('/api/admin/drug-equivalences');

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0]).toEqual(expect.objectContaining({ drugNameA: 'バイアスピリン' }));
    });

    it('limit/offsetパラメータを渡せる', async () => {
      mocks.listDrugEquivalences.mockResolvedValue([]);
      const app = createApp();

      await request(app).get('/api/admin/drug-equivalences?limit=10&offset=5');

      expect(mocks.listDrugEquivalences).toHaveBeenCalledWith({ limit: 10, offset: 5 });
    });
  });

  describe('GET /drug-equivalences/:id', () => {
    it('IDで取得できる', async () => {
      mocks.getDrugEquivalenceById.mockResolvedValue(sampleEquivalence);
      const app = createApp();

      const response = await request(app).get('/api/admin/drug-equivalences/1');

      expect(response.status).toBe(200);
      expect(response.body.data).toEqual(expect.objectContaining({ id: 1 }));
    });

    it('存在しないIDは404', async () => {
      mocks.getDrugEquivalenceById.mockResolvedValue(null);
      const app = createApp();

      const response = await request(app).get('/api/admin/drug-equivalences/999');

      expect(response.status).toBe(404);
    });

    it('不正なIDは400', async () => {
      const app = createApp();

      const response = await request(app).get('/api/admin/drug-equivalences/abc');

      expect(response.status).toBe(400);
    });
  });

  describe('POST /drug-equivalences', () => {
    it('新規作成できる', async () => {
      mocks.createDrugEquivalence.mockResolvedValue(sampleEquivalence);
      const app = createApp();

      const response = await request(app)
        .post('/api/admin/drug-equivalences')
        .send({
          drugNameA: 'バイアスピリン',
          drugNameB: 'アスピリン',
          equivalenceType: 'brand_generic',
        });

      expect(response.status).toBe(201);
      expect(response.body.data).toEqual(expect.objectContaining({ id: 1 }));
    });

    it('バリデーションエラーは400（Zodレベル）', async () => {
      const app = createApp();

      const response = await request(app)
        .post('/api/admin/drug-equivalences')
        .send({
          drugNameA: '',
          drugNameB: 'アスピリン',
          equivalenceType: 'brand_generic',
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
    });

    it('バリデーションエラーは400（サービスレベル）', async () => {
      mocks.createDrugEquivalence.mockRejectedValue(
        new mocks.DrugEquivalenceValidationError('薬品名Aと薬品名Bは異なる名前を指定してください'),
      );
      const app = createApp();

      const response = await request(app)
        .post('/api/admin/drug-equivalences')
        .send({
          drugNameA: 'アスピリン',
          drugNameB: 'アスピリン',
          equivalenceType: 'brand_generic',
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('薬品名Aと薬品名Bは異なる名前を指定してください');
    });

    it('重複エラーは409', async () => {
      mocks.createDrugEquivalence.mockRejectedValue(
        new mocks.DrugEquivalenceDuplicateError('この薬品ペアは既に登録されています'),
      );
      const app = createApp();

      const response = await request(app)
        .post('/api/admin/drug-equivalences')
        .send({
          drugNameA: 'バイアスピリン',
          drugNameB: 'アスピリン',
          equivalenceType: 'brand_generic',
        });

      expect(response.status).toBe(409);
    });

    it('不正なequivalenceTypeは400', async () => {
      const app = createApp();

      const response = await request(app)
        .post('/api/admin/drug-equivalences')
        .send({
          drugNameA: 'バイアスピリン',
          drugNameB: 'アスピリン',
          equivalenceType: 'invalid_type',
        });

      expect(response.status).toBe(400);
    });
  });

  describe('PUT /drug-equivalences/:id', () => {
    it('更新できる', async () => {
      mocks.updateDrugEquivalence.mockResolvedValue({ ...sampleEquivalence, notes: 'メモ' });
      const app = createApp();

      const response = await request(app)
        .put('/api/admin/drug-equivalences/1')
        .send({ notes: 'メモ' });

      expect(response.status).toBe(200);
      expect(response.body.data.notes).toBe('メモ');
    });

    it('存在しないIDは404', async () => {
      mocks.updateDrugEquivalence.mockResolvedValue(null);
      const app = createApp();

      const response = await request(app)
        .put('/api/admin/drug-equivalences/999')
        .send({ notes: 'メモ' });

      expect(response.status).toBe(404);
    });
  });

  describe('DELETE /drug-equivalences/:id', () => {
    it('削除できる', async () => {
      mocks.deleteDrugEquivalence.mockResolvedValue(true);
      const app = createApp();

      const response = await request(app).delete('/api/admin/drug-equivalences/1');

      expect(response.status).toBe(200);
      expect(response.body.message).toContain('削除');
    });

    it('存在しないIDは404', async () => {
      mocks.deleteDrugEquivalence.mockResolvedValue(false);
      const app = createApp();

      const response = await request(app).delete('/api/admin/drug-equivalences/999');

      expect(response.status).toBe(404);
    });
  });
});
