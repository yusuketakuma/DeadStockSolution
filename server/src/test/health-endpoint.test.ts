import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// db mock must be hoisted so it is set up before app.ts is imported
const mocks = vi.hoisted(() => ({
  dbExecute: vi.fn(),
}));

vi.mock('../config/database', () => ({
  db: { execute: mocks.dbExecute },
}));

vi.mock('../services/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Import app after mocks are set up
import app from '../app';

describe('/api/health', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('DB 正常時', () => {
    it('HTTP 200 で ok ステータスを返す', async () => {
      mocks.dbExecute.mockResolvedValue([]);

      const res = await request(app).get('/api/health');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
    });

    it('レスポンスに uptime, timestamp, version, db フィールドが含まれる', async () => {
      mocks.dbExecute.mockResolvedValue([]);

      const res = await request(app).get('/api/health');

      expect(res.status).toBe(200);
      expect(typeof res.body.uptime).toBe('number');
      expect(typeof res.body.timestamp).toBe('string');
      expect(typeof res.body.version).toBe('string');
      expect(res.body.db).toMatchObject({ status: 'ok' });
      expect(typeof res.body.db.responseTime).toBe('number');
    });

    it('timestamp が ISO 8601 形式である', async () => {
      mocks.dbExecute.mockResolvedValue([]);

      const res = await request(app).get('/api/health');

      expect(() => new Date(res.body.timestamp as string)).not.toThrow();
      expect(new Date(res.body.timestamp as string).toISOString()).toBe(res.body.timestamp);
    });
  });

  describe('DB 失敗時', () => {
    it('HTTP 503 で degraded ステータスを返す', async () => {
      mocks.dbExecute.mockRejectedValue(new Error('connection refused'));

      const res = await request(app).get('/api/health');

      expect(res.status).toBe(503);
      expect(res.body.status).toBe('degraded');
    });

    it('db.status が error になる', async () => {
      mocks.dbExecute.mockRejectedValue(new Error('timeout'));

      const res = await request(app).get('/api/health');

      expect(res.body.db.status).toBe('error');
      expect(typeof res.body.db.responseTime).toBe('number');
    });
  });
});

describe('/api/health/ready', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('DB 正常時', () => {
    it('HTTP 200 で { ready: true } を返す', async () => {
      mocks.dbExecute.mockResolvedValue([]);

      const res = await request(app).get('/api/health/ready');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ready: true });
    });
  });

  describe('DB 失敗時', () => {
    it('HTTP 503 で { ready: false } を返す', async () => {
      mocks.dbExecute.mockRejectedValue(new Error('db unavailable'));

      const res = await request(app).get('/api/health/ready');

      expect(res.status).toBe(503);
      expect(res.body).toEqual({ ready: false });
    });
  });
});
