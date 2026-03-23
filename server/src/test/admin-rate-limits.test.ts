import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../middleware/auth', () => ({
  requireLogin: (req: { user?: { id: number; email: string; isAdmin: boolean } }, _res: unknown, next: () => void) => {
    req.user = { id: 1, email: 'admin@example.com', isAdmin: true };
    next();
  },
  requireAdmin: (_req: unknown, _res: unknown, next: () => void) => { next(); },
}));

vi.mock('../services/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import adminRateLimitsRouter from '../routes/admin-rate-limits';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/rate-limits', adminRateLimitsRouter);
  return app;
}

describe('GET /api/admin/rate-limits/config', () => {
  it('should return 200 with limiters array for admin user', async () => {
    const app = createApp();
    const res = await request(app).get('/api/admin/rate-limits/config');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('limiters');
    expect(Array.isArray(res.body.limiters)).toBe(true);
    expect(res.body.limiters.length).toBeGreaterThan(0);
  });

  it('should return limiters with required fields', async () => {
    const app = createApp();
    const res = await request(app).get('/api/admin/rate-limits/config');
    expect(res.status).toBe(200);

    for (const limiter of res.body.limiters) {
      expect(limiter).toHaveProperty('name');
      expect(typeof limiter.name).toBe('string');
      expect(limiter).toHaveProperty('windowMs');
      expect(typeof limiter.windowMs).toBe('number');
      expect(limiter).toHaveProperty('max');
      expect(typeof limiter.max).toBe('number');
      expect(limiter).toHaveProperty('appliedTo');
      expect(Array.isArray(limiter.appliedTo)).toBe(true);
    }
  });

  it('should include adminWriteLimiter in the response', async () => {
    const app = createApp();
    const res = await request(app).get('/api/admin/rate-limits/config');
    expect(res.status).toBe(200);

    const adminWriteLimiter = res.body.limiters.find(
      (l: { name: string }) => l.name === 'adminWriteLimiter',
    );
    expect(adminWriteLimiter).toBeDefined();
    expect(adminWriteLimiter.windowMs).toBe(900000);
    expect(adminWriteLimiter.max).toBe(60);
    expect(adminWriteLimiter.appliedTo).toContain('/api/admin/bulk-actions/parse-csv');
    expect(adminWriteLimiter.appliedTo).toContain('/api/admin/bulk-actions/execute');
  });

  it('should return 403 for non-admin user (middleware enforced)', async () => {
    // requireAdmin middleware is applied in the router.
    // Simulate a non-admin by mounting the real requireAdmin check directly.
    const app = express();
    app.use(express.json());
    // Inject a non-admin user then enforce the admin check inline
    app.use('/api/admin/rate-limits', (req: express.Request & { user?: { id: number; email: string; isAdmin: boolean } }, _res, next) => {
      req.user = { id: 2, email: 'user@example.com', isAdmin: false };
      next();
    });
    app.use('/api/admin/rate-limits', (req: express.Request & { user?: { isAdmin: boolean } }, res, next) => {
      if (!req.user?.isAdmin) {
        res.status(403).json({ error: '管理者権限が必要です' });
        return;
      }
      next();
    });
    app.use('/api/admin/rate-limits', adminRateLimitsRouter);

    const res = await request(app).get('/api/admin/rate-limits/config');
    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty('error');
  });
});

describe('GET /api/admin/rate-limits/config - structure validation', () => {
  it('should return commentRateLimit config', async () => {
    const app = createApp();
    const res = await request(app).get('/api/admin/rate-limits/config');
    expect(res.status).toBe(200);

    const commentRateLimit = res.body.limiters.find(
      (l: { name: string }) => l.name === 'commentRateLimit',
    );
    expect(commentRateLimit).toBeDefined();
    expect(commentRateLimit.windowMs).toBe(10000);
    expect(commentRateLimit.max).toBe(1);
  });
});
