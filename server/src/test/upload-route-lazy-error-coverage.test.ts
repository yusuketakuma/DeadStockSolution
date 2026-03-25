import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { beforeEach, describe, it, expect, vi } from 'vitest';

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

function mockUploadRouteLazyErrorDependencies() {
  vi.doMock('../config/database', () => ({
    db: mocks.db,
  }));

  vi.doMock('../middleware/auth', () => ({
    requireLogin: (req: Request & { user?: { id: number } }, _res: Response, next: NextFunction) => {
      req.user = { id: 1 };
      next();
    },
  }));

  vi.doMock('../services/logger', () => ({
    logger: mocks.logger,
  }));

  vi.doMock('drizzle-orm', () => ({
    eq: vi.fn(() => ({})),
    and: vi.fn(() => ({})),
    inArray: vi.fn(() => ({})),
    sql: vi.fn(() => ({})),
  }));

  vi.doMock('../routes/upload-parser', async () => {
    const { Router } = await import('express');
    return { default: Router() };
  });

  vi.doMock('../routes/upload-validation', async () => await vi.importActual('../routes/upload-validation'));
  vi.doMock('../db/schema', async () => await vi.importActual('../db/schema'));
}

let uploadRouter: (typeof import('../routes/upload'))['default'];

beforeEach(async () => {
  vi.resetAllMocks();
  vi.resetModules();
  mockUploadRouteLazyErrorDependencies();
  ({ default: uploadRouter } = await import('../routes/upload'));
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
