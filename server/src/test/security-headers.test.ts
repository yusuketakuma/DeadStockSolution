import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

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

describe('セキュリティヘッダー', () => {
  it('Permissions-Policy ヘッダーが設定されており camera, microphone, geolocation, payment を含む', async () => {
    mocks.dbExecute.mockResolvedValue([]);
    const res = await request(app).get('/api/health');

    const policy = res.headers['permissions-policy'] as string;
    expect(policy).toBeDefined();
    expect(policy).toContain('camera=(self)');
    expect(policy).toContain('microphone=()');
    expect(policy).toContain('geolocation=()');
    expect(policy).toContain('payment=()');
  });

  it('Referrer-Policy ヘッダーが strict-origin-when-cross-origin である', async () => {
    mocks.dbExecute.mockResolvedValue([]);
    const res = await request(app).get('/api/health');

    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  });

  it('X-Content-Type-Options ヘッダーが nosniff である', async () => {
    mocks.dbExecute.mockResolvedValue([]);
    const res = await request(app).get('/api/health');

    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('X-Frame-Options ヘッダーが存在する', async () => {
    mocks.dbExecute.mockResolvedValue([]);
    const res = await request(app).get('/api/health');

    expect(res.headers['x-frame-options']).toBeDefined();
  });

  it('X-Powered-By ヘッダーが存在しない', async () => {
    mocks.dbExecute.mockResolvedValue([]);
    const res = await request(app).get('/api/health');

    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
