import type { NextFunction, Request, Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
  recordRequestMetric: vi.fn(),
}));

vi.mock('../services/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: mocks.loggerInfo,
    warn: mocks.loggerWarn,
    error: mocks.loggerError,
  },
}));

vi.mock('../services/observability-service', () => ({
  recordRequestMetric: mocks.recordRequestMetric,
}));

const ORIGINAL_REQUEST_LOG_ERRORS_ONLY = process.env.REQUEST_LOG_ERRORS_ONLY;
const ORIGINAL_REQUEST_METRICS_ENABLED = process.env.REQUEST_METRICS_ENABLED;

interface RequestLoggerTestContext {
  req: Request;
  res: Response;
  next: NextFunction;
  finish: () => void;
}

async function loadRequestLogger() {
  vi.resetModules();
  return import('../middleware/request-logger');
}

function createRequestLoggerTestContext(statusCode: number, path = '/api/example'): RequestLoggerTestContext {
  let finishHandler: (() => void) | null = null;

  const res = {
    statusCode,
    setHeader: vi.fn(),
    on: vi.fn((event: string, handler: () => void) => {
      if (event === 'finish') {
        finishHandler = handler;
      }
      return res;
    }),
  } as unknown as Response;

  const req = {
    method: 'GET',
    path,
    ip: '127.0.0.1',
    headers: {
      'user-agent': 'vitest',
    },
  } as unknown as Request;

  return {
    req,
    res,
    next: vi.fn() as unknown as NextFunction,
    finish: () => {
      finishHandler?.();
    },
  };
}

describe('request-logger flags', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (ORIGINAL_REQUEST_LOG_ERRORS_ONLY === undefined) {
      delete process.env.REQUEST_LOG_ERRORS_ONLY;
    } else {
      process.env.REQUEST_LOG_ERRORS_ONLY = ORIGINAL_REQUEST_LOG_ERRORS_ONLY;
    }

    if (ORIGINAL_REQUEST_METRICS_ENABLED === undefined) {
      delete process.env.REQUEST_METRICS_ENABLED;
    } else {
      process.env.REQUEST_METRICS_ENABLED = ORIGINAL_REQUEST_METRICS_ENABLED;
    }
  });

  it('default behavior keeps errors-only request logging and metrics enabled', async () => {
    process.env.REQUEST_LOG_ERRORS_ONLY = 'true';
    process.env.REQUEST_METRICS_ENABLED = 'true';
    const { requestLogger } = await loadRequestLogger();
    const ctx = createRequestLoggerTestContext(200);

    requestLogger(ctx.req, ctx.res, ctx.next);
    ctx.finish();

    expect(ctx.next).toHaveBeenCalledOnce();
    expect(mocks.recordRequestMetric).toHaveBeenCalledOnce();
    expect(mocks.loggerInfo).not.toHaveBeenCalled();
    expect(mocks.loggerWarn).not.toHaveBeenCalled();
    expect(mocks.loggerError).not.toHaveBeenCalled();
  });

  it('can log non-error responses when REQUEST_LOG_ERRORS_ONLY=false', async () => {
    process.env.REQUEST_LOG_ERRORS_ONLY = 'false';
    process.env.REQUEST_METRICS_ENABLED = 'true';
    const { requestLogger } = await loadRequestLogger();
    const ctx = createRequestLoggerTestContext(200, '/api/orders');

    requestLogger(ctx.req, ctx.res, ctx.next);
    ctx.finish();

    expect(mocks.recordRequestMetric).toHaveBeenCalledOnce();
    expect(mocks.loggerInfo).toHaveBeenCalledWith(
      'request',
      expect.objectContaining({
        path: '/api/orders',
        status: 200,
      }),
    );
  });

  it('logs warn for 4xx status codes', async () => {
    process.env.REQUEST_LOG_ERRORS_ONLY = 'true';
    process.env.REQUEST_METRICS_ENABLED = 'true';
    const { requestLogger } = await loadRequestLogger();
    const ctx = createRequestLoggerTestContext(404, '/api/missing');

    requestLogger(ctx.req, ctx.res, ctx.next);
    ctx.finish();

    expect(mocks.loggerWarn).toHaveBeenCalledWith(
      'request',
      expect.objectContaining({
        path: '/api/missing',
        status: 404,
      }),
    );
  });

  it('skips logging for /api/health path', async () => {
    process.env.REQUEST_LOG_ERRORS_ONLY = 'false';
    process.env.REQUEST_METRICS_ENABLED = 'true';
    const { requestLogger } = await loadRequestLogger();
    const ctx = createRequestLoggerTestContext(200, '/api/health');

    requestLogger(ctx.req, ctx.res, ctx.next);

    expect(ctx.next).toHaveBeenCalledOnce();
    expect(ctx.res.on).not.toHaveBeenCalled();
  });

  it('can disable request metrics collection independently', async () => {
    process.env.REQUEST_LOG_ERRORS_ONLY = 'true';
    process.env.REQUEST_METRICS_ENABLED = 'false';
    const { requestLogger } = await loadRequestLogger();
    const ctx = createRequestLoggerTestContext(500, '/api/fail');

    requestLogger(ctx.req, ctx.res, ctx.next);
    ctx.finish();

    expect(mocks.recordRequestMetric).not.toHaveBeenCalled();
    expect(mocks.loggerError).toHaveBeenCalledWith(
      'request',
      expect.objectContaining({
        path: '/api/fail',
        status: 500,
      }),
    );
  });

  it('falls back to a generated request id when x-request-id is too long', async () => {
    process.env.REQUEST_LOG_ERRORS_ONLY = 'false';
    process.env.REQUEST_METRICS_ENABLED = 'true';
    const { requestLogger } = await loadRequestLogger();
    const ctx = createRequestLoggerTestContext(200, '/api/orders');
    ctx.req.headers['x-request-id'] = 'a'.repeat(200);

    requestLogger(ctx.req, ctx.res, ctx.next);
    ctx.finish();

    expect(ctx.res.setHeader).toHaveBeenCalledWith('x-request-id', expect.stringMatching(/^[0-9a-f-]{36}$/));
    expect(mocks.recordRequestMetric).toHaveBeenCalledWith(expect.objectContaining({
      requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
    }));
  });

  it('falls back to a generated request id when x-request-id contains unsafe characters', async () => {
    process.env.REQUEST_LOG_ERRORS_ONLY = 'false';
    process.env.REQUEST_METRICS_ENABLED = 'true';
    const { requestLogger } = await loadRequestLogger();
    const ctx = createRequestLoggerTestContext(200, '/api/orders');
    ctx.req.headers['x-request-id'] = 'req-123\nmalicious';

    requestLogger(ctx.req, ctx.res, ctx.next);
    ctx.finish();

    expect(ctx.res.setHeader).toHaveBeenCalledWith('x-request-id', expect.stringMatching(/^[0-9a-f-]{36}$/));
    expect(mocks.loggerInfo).toHaveBeenCalledWith(
      'request',
      expect.objectContaining({
        requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      }),
    );
  });
});
