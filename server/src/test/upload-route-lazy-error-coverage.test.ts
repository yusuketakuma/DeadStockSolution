import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { describe, it, expect, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
  },
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

vi.mock('../middleware/auth', () => ({
  requireLogin: (req: Request & { user?: { id: number } }, _res: Response, next: NextFunction) => {
    req.user = { id: 1 };
    next();
  },
}));

vi.mock('../services/logger', () => ({
  logger: mocks.logger,
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(() => ({})),
  and: vi.fn(() => ({})),
  inArray: vi.fn(() => ({})),
  sql: vi.fn(() => ({})),
}));

vi.mock('../routes/upload-parser', async () => {
  const { Router } = await import('express');
  return { default: Router() };
});

describe('routes/upload.ts lazy logger payload coverage', () => {
  it('executes lazy payload callback in catch block', async () => {
    // Force DB error to hit catch path
    mocks.db.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          groupBy: vi.fn().mockRejectedValue(new Error('db down')),
        }),
      }),
    });

    // Evaluate lazy payload callback passed to logger.error
    mocks.logger.error.mockImplementation((_msg: string, payload?: unknown) => {
      if (typeof payload === 'function') {
        (payload as () => Record<string, unknown>)();
      }
    });

    const { default: uploadRouter } = await import('../routes/upload');

    const app = express();
    app.use(express.json());
    app.use('/api/upload', uploadRouter);

    const res = await request(app).get('/api/upload/status');

    expect(res.status).toBe(500);
    expect(mocks.logger.error).toHaveBeenCalledWith(
      'Upload status error',
      expect.any(Function),
    );
  });
});
