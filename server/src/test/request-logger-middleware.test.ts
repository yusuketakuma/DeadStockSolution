import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Request, Response, NextFunction } from 'express';

// ── Hoisted mocks ──────────────────────────────────
const mocks = vi.hoisted(() => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  recordRequestMetric: vi.fn(),
}));

vi.mock('../services/logger', () => ({
  logger: mocks.logger,
}));

vi.mock('../services/observability-service', () => ({
  recordRequestMetric: mocks.recordRequestMetric,
}));

vi.mock('crypto', async () => {
  const actual = await vi.importActual<typeof import('crypto')>('crypto');
  return {
    ...actual,
    randomUUID: vi.fn(() => 'test-uuid-1234'),
  };
});

import { requestLogger } from '../middleware/request-logger';
import { randomUUID } from 'crypto';

// ── Helper: create mock request ──────────────
function createReq(overrides?: Partial<Request>): Request {
  return {
    headers: {},
    path: '/api/test',
    method: 'GET',
    ip: '127.0.0.1',
    ...overrides,
  } as Request;
}

// ── Helper: create mock response ──────────────
function createRes(): Response & { on: (event: string, cb: () => void) => void } {
  const listeners: Record<string, () => void> = {};
  const res = {
    statusCode: 200,
    setHeader: vi.fn(),
    on: vi.fn((event: string, cb: () => void) => {
      listeners[event] = cb;
    }),
    _triggerFinish: () => {
      if (listeners['finish']) {
        listeners['finish']();
      }
    },
  } as unknown as Response & { on: (event: string, cb: () => void) => void };
  return res;
}

describe('requestLogger middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ────────────────────────────────────────────────────
  // x-request-id header handling
  // ────────────────────────────────────────────────────
  describe('x-request-id header handling', () => {
    it('should generate UUID when x-request-id is not provided', () => {
      const req = createReq();
      const res = createRes();
      const next = vi.fn();

      requestLogger(req, res, next);

      expect(res.setHeader).toHaveBeenCalledWith('x-request-id', 'test-uuid-1234');
      expect((req as Request & { requestId?: string }).requestId).toBe('test-uuid-1234');
    });

    it('should preserve incoming x-request-id header', () => {
      const req = createReq({
        headers: { 'x-request-id': 'incoming-request-id' },
      });
      const res = createRes();
      const next = vi.fn();

      requestLogger(req, res, next);

      expect(res.setHeader).toHaveBeenCalledWith('x-request-id', 'incoming-request-id');
      expect((req as Request & { requestId?: string }).requestId).toBe('incoming-request-id');
    });

    it('should trim whitespace from incoming x-request-id', () => {
      const req = createReq({
        headers: { 'x-request-id': '  trimmed-id  ' },
      });
      const res = createRes();
      const next = vi.fn();

      requestLogger(req, res, next);

      expect(res.setHeader).toHaveBeenCalledWith('x-request-id', 'trimmed-id');
      expect((req as Request & { requestId?: string }).requestId).toBe('trimmed-id');
    });

    it('should handle non-string x-request-id header gracefully', () => {
      const req = createReq({
        headers: { 'x-request-id': ['array-value'] },
      });
      const res = createRes();
      const next = vi.fn();

      requestLogger(req, res, next);

      expect(res.setHeader).toHaveBeenCalledWith('x-request-id', 'test-uuid-1234');
      expect((req as Request & { requestId?: string }).requestId).toBe('test-uuid-1234');
    });
  });

  // ────────────────────────────────────────────────────
  // next() invocation
  // ────────────────────────────────────────────────────
  describe('next() invocation', () => {
    it('should call next() immediately', () => {
      const req = createReq();
      const res = createRes();
      const next = vi.fn();

      requestLogger(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
    });

    it('should call next() before response finish event', () => {
      const req = createReq();
      const res = createRes();
      const next = vi.fn();
      const callOrder: string[] = [];

      next.mockImplementation(() => {
        callOrder.push('next');
      });

      requestLogger(req, res, next);
      (res as any)._triggerFinish();

      expect(callOrder).toEqual(['next']);
    });
  });

  // ────────────────────────────────────────────────────
  // /api/health path skipping
  // ────────────────────────────────────────────────────
  describe('/api/health path skipping', () => {
    it('should skip logging for /api/health path', () => {
      const req = createReq({ path: '/api/health' });
      const res = createRes();
      const next = vi.fn();

      requestLogger(req, res, next);
      (res as any)._triggerFinish();

      expect(mocks.logger.info).not.toHaveBeenCalled();
      expect(mocks.logger.warn).not.toHaveBeenCalled();
      expect(mocks.logger.error).not.toHaveBeenCalled();
      expect(mocks.recordRequestMetric).not.toHaveBeenCalled();
    });

    it('should still set x-request-id for /api/health', () => {
      const req = createReq({ path: '/api/health' });
      const res = createRes();
      const next = vi.fn();

      requestLogger(req, res, next);

      expect(res.setHeader).toHaveBeenCalledWith('x-request-id', 'test-uuid-1234');
    });

    it('should still call next() for /api/health', () => {
      const req = createReq({ path: '/api/health' });
      const res = createRes();
      const next = vi.fn();

      requestLogger(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  // ────────────────────────────────────────────────────
  // Log level resolution
  // ────────────────────────────────────────────────────
  describe('log level resolution', () => {
    it('should skip logging for 2xx when REQUEST_LOG_ERRORS_ONLY=true (default)', () => {
      const req = createReq();
      const res = createRes();
      res.statusCode = 200;
      const next = vi.fn();

      requestLogger(req, res, next);
      (res as any)._triggerFinish();

      expect(mocks.logger.info).not.toHaveBeenCalled();
      expect(mocks.logger.warn).not.toHaveBeenCalled();
      expect(mocks.logger.error).not.toHaveBeenCalled();
    });

    it('should skip logging for 3xx when REQUEST_LOG_ERRORS_ONLY=true (default)', () => {
      const req = createReq();
      const res = createRes();
      res.statusCode = 301;
      const next = vi.fn();

      requestLogger(req, res, next);
      (res as any)._triggerFinish();

      expect(mocks.logger.info).not.toHaveBeenCalled();
      expect(mocks.logger.warn).not.toHaveBeenCalled();
      expect(mocks.logger.error).not.toHaveBeenCalled();
    });

    it('should log with warn level for 4xx status', () => {
      const req = createReq();
      const res = createRes();
      res.statusCode = 404;
      const next = vi.fn();

      requestLogger(req, res, next);
      (res as any)._triggerFinish();

      expect(mocks.logger.warn).toHaveBeenCalledWith(
        'request',
        expect.objectContaining({
          status: 404,
        }),
      );
      expect(mocks.logger.info).not.toHaveBeenCalled();
      expect(mocks.logger.error).not.toHaveBeenCalled();
    });

    it('should log with error level for 5xx status', () => {
      const req = createReq();
      const res = createRes();
      res.statusCode = 500;
      const next = vi.fn();

      requestLogger(req, res, next);
      (res as any)._triggerFinish();

      expect(mocks.logger.error).toHaveBeenCalledWith(
        'request',
        expect.objectContaining({
          status: 500,
        }),
      );
      expect(mocks.logger.info).not.toHaveBeenCalled();
      expect(mocks.logger.warn).not.toHaveBeenCalled();
    });

    it('should log with warn level for 400 status', () => {
      const req = createReq();
      const res = createRes();
      res.statusCode = 400;
      const next = vi.fn();

      requestLogger(req, res, next);
      (res as any)._triggerFinish();

      expect(mocks.logger.warn).toHaveBeenCalledWith(
        'request',
        expect.objectContaining({
          status: 400,
        }),
      );
    });

    it('should log with error level for 500 status', () => {
      const req = createReq();
      const res = createRes();
      res.statusCode = 500;
      const next = vi.fn();

      requestLogger(req, res, next);
      (res as any)._triggerFinish();

      expect(mocks.logger.error).toHaveBeenCalledWith(
        'request',
        expect.objectContaining({
          status: 500,
        }),
      );
    });
  });

  // ────────────────────────────────────────────────────
  // REQUEST_LOG_ERRORS_ONLY environment variable
  // ────────────────────────────────────────────────────
  describe('REQUEST_LOG_ERRORS_ONLY environment variable', () => {
    const originalEnv = process.env.REQUEST_LOG_ERRORS_ONLY;

    afterEach(() => {
      process.env.REQUEST_LOG_ERRORS_ONLY = originalEnv;
      vi.resetModules();
    });

    it('should log for 2xx when REQUEST_LOG_ERRORS_ONLY=false', async () => {
      process.env.REQUEST_LOG_ERRORS_ONLY = 'false';
      vi.resetModules();
      const { requestLogger: logger } = await import('../middleware/request-logger');

      const req = createReq();
      const res = createRes();
      res.statusCode = 200;
      const next = vi.fn();

      logger(req, res, next);
      (res as any)._triggerFinish();

      expect(mocks.logger.info).toHaveBeenCalledWith(
        'request',
        expect.objectContaining({
          status: 200,
        }),
      );
    });

    it('should always log for 4xx regardless of REQUEST_LOG_ERRORS_ONLY', async () => {
      process.env.REQUEST_LOG_ERRORS_ONLY = 'true';
      vi.resetModules();
      const { requestLogger: logger } = await import('../middleware/request-logger');

      const req = createReq();
      const res = createRes();
      res.statusCode = 404;
      const next = vi.fn();

      logger(req, res, next);
      (res as any)._triggerFinish();

      expect(mocks.logger.warn).toHaveBeenCalledWith(
        'request',
        expect.objectContaining({
          status: 404,
        }),
      );
    });
  });

  // ────────────────────────────────────────────────────
  // REQUEST_METRICS_ENABLED environment variable
  // ────────────────────────────────────────────────────
  describe('REQUEST_METRICS_ENABLED environment variable', () => {
    const originalEnv = process.env.REQUEST_METRICS_ENABLED;

    afterEach(() => {
      process.env.REQUEST_METRICS_ENABLED = originalEnv;
      vi.resetModules();
    });

    it('should record metrics when REQUEST_METRICS_ENABLED=true (default)', async () => {
      process.env.REQUEST_METRICS_ENABLED = 'true';
      vi.resetModules();
      const { requestLogger: logger } = await import('../middleware/request-logger');

      const req = createReq();
      const res = createRes();
      res.statusCode = 200;
      const next = vi.fn();

      logger(req, res, next);
      vi.advanceTimersByTime(100);
      (res as any)._triggerFinish();

      expect(mocks.recordRequestMetric).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'GET',
          path: '/api/test',
          status: 200,
          durationMs: 100,
          requestId: 'test-uuid-1234',
        }),
      );
    });

    it('should skip metrics when REQUEST_METRICS_ENABLED=false', async () => {
      process.env.REQUEST_METRICS_ENABLED = 'false';
      vi.resetModules();
      const { requestLogger: logger } = await import('../middleware/request-logger');

      const req = createReq();
      const res = createRes();
      res.statusCode = 200;
      const next = vi.fn();

      logger(req, res, next);
      (res as any)._triggerFinish();

      expect(mocks.recordRequestMetric).not.toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────────
  // Log payload content
  // ────────────────────────────────────────────────────
  describe('log payload content', () => {
    it('should include method, path, status, duration, ip, userAgent, requestId', () => {
      const req = createReq({
        method: 'POST',
        path: '/api/proposals',
        ip: '192.168.1.1',
        headers: {
          'user-agent': 'Mozilla/5.0',
          'x-request-id': 'custom-id',
        },
      });
      const res = createRes();
      res.statusCode = 400; // Use 4xx to ensure logging with default REQUEST_LOG_ERRORS_ONLY=true
      const next = vi.fn();

      requestLogger(req, res, next);
      vi.advanceTimersByTime(250);
      (res as any)._triggerFinish();

      expect(mocks.logger.warn).toHaveBeenCalledWith(
        'request',
        expect.objectContaining({
          method: 'POST',
          path: '/api/proposals',
          status: 400,
          duration: 250,
          ip: '192.168.1.1',
          userAgent: 'Mozilla/5.0',
          requestId: 'custom-id',
        }),
      );
    });

    it('should handle missing user-agent header', () => {
      const req = createReq({
        headers: {},
      });
      const res = createRes();
      res.statusCode = 404; // Use 4xx to ensure logging with default REQUEST_LOG_ERRORS_ONLY=true
      const next = vi.fn();

      requestLogger(req, res, next);
      (res as any)._triggerFinish();

      expect(mocks.logger.warn).toHaveBeenCalledWith(
        'request',
        expect.objectContaining({
          userAgent: undefined,
        }),
      );
    });
  });

  // ────────────────────────────────────────────────────
  // Metric payload content
  // ────────────────────────────────────────────────────
  describe('metric payload content', () => {
    it('should record metric with correct fields', () => {
      const req = createReq({
        method: 'DELETE',
        path: '/api/inventory/123',
      });
      const res = createRes();
      res.statusCode = 204;
      const next = vi.fn();

      requestLogger(req, res, next);
      vi.advanceTimersByTime(50);
      (res as any)._triggerFinish();

      expect(mocks.recordRequestMetric).toHaveBeenCalledWith(
        expect.objectContaining({
          timestamp: expect.any(Number),
          method: 'DELETE',
          path: '/api/inventory/123',
          status: 204,
          durationMs: 50,
          requestId: 'test-uuid-1234',
        }),
      );
    });

    it('should measure duration correctly', () => {
      const req = createReq();
      const res = createRes();
      res.statusCode = 200;
      const next = vi.fn();

      requestLogger(req, res, next);
      vi.advanceTimersByTime(1234);
      (res as any)._triggerFinish();

      expect(mocks.recordRequestMetric).toHaveBeenCalledWith(
        expect.objectContaining({
          durationMs: 1234,
        }),
      );
    });
  });

  // ────────────────────────────────────────────────────
  // Edge cases
  // ────────────────────────────────────────────────────
  describe('edge cases', () => {
    it('should handle multiple finish events gracefully', () => {
      const req = createReq();
      const res = createRes();
      res.statusCode = 400; // Use 4xx to ensure logging with default REQUEST_LOG_ERRORS_ONLY=true
      const next = vi.fn();

      requestLogger(req, res, next);
      (res as any)._triggerFinish();
      (res as any)._triggerFinish();

      expect(mocks.logger.warn).toHaveBeenCalledTimes(2);
    });

    it('should handle 0ms duration', () => {
      const req = createReq();
      const res = createRes();
      res.statusCode = 200;
      const next = vi.fn();

      requestLogger(req, res, next);
      (res as any)._triggerFinish();

      expect(mocks.recordRequestMetric).toHaveBeenCalledWith(
        expect.objectContaining({
          durationMs: 0,
        }),
      );
    });

    it('should handle various HTTP methods', () => {
      const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

      methods.forEach((method) => {
        vi.clearAllMocks();
        const req = createReq({ method: method as any });
        const res = createRes();
        res.statusCode = 400; // Use 4xx to ensure logging with default REQUEST_LOG_ERRORS_ONLY=true
        const next = vi.fn();

        requestLogger(req, res, next);
        (res as any)._triggerFinish();

        expect(mocks.logger.warn).toHaveBeenCalledWith(
          'request',
          expect.objectContaining({
            method,
          }),
        );
      });
    });

    it('should handle various status codes', () => {
      const statusCodes = [400, 401, 403, 404, 500, 502, 503];

      statusCodes.forEach((status) => {
        vi.clearAllMocks();
        const req = createReq();
        const res = createRes();
        res.statusCode = status;
        const next = vi.fn();

        requestLogger(req, res, next);
        (res as any)._triggerFinish();

        const expectedLevel = status >= 500 ? 'error' : 'warn';
        expect(mocks.logger[expectedLevel as 'warn' | 'error']).toHaveBeenCalledWith(
          'request',
          expect.objectContaining({
            status,
          }),
        );
      });
    });
  });
});
