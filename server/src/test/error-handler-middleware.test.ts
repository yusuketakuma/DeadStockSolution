import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Request, Response, NextFunction } from 'express';

// ── Hoisted mocks ──────────────────────────────────
const mocks = vi.hoisted(() => ({
  loggerError: vi.fn(),
  recordHttpUnhandledError: vi.fn(),
  captureException: vi.fn().mockReturnValue('evt-123'),
  buildErrorFixContext: vi.fn().mockReturnValue({
    errorMessage: 'test',
    stackTrace: null,
    sourceFile: 'server/src/test.ts',
    sourceLine: 10,
    endpoint: 'GET /api/test',
    sentryEventId: 'evt-123',
    timestamp: '2026-01-01T00:00:00.000Z',
  }),
  handoffErrorToOpenClaw: vi.fn().mockResolvedValue({
    triggered: false,
    accepted: false,
    requestId: null,
    reason: 'disabled',
  }),
}));

vi.mock('../services/logger', () => ({
  logger: {
    error: mocks.loggerError,
  },
}));

vi.mock('../services/system-event-service', () => ({
  recordHttpUnhandledError: mocks.recordHttpUnhandledError,
}));

vi.mock('../config/sentry', () => ({
  captureException: mocks.captureException,
}));

vi.mock('../services/error-fix-context', () => ({
  buildErrorFixContext: mocks.buildErrorFixContext,
}));

vi.mock('../services/openclaw-error-autofix-service', () => ({
  handoffErrorToOpenClaw: mocks.handoffErrorToOpenClaw,
}));

import {
  getErrorMessage,
  handleRouteError,
  errorHandler,
} from '../middleware/error-handler';

// ── Helper: create mock response ──────────────
function createRes() {
  const res = {
    status: vi.fn(),
    json: vi.fn(),
  };
  res.status.mockReturnValue(res);
  return res as unknown as Response;
}

// ── Helper: create mock request ──────────────
function createReq(overrides?: Partial<Request>) {
  return {
    method: 'GET',
    path: '/api/test',
    headers: {},
    ...overrides,
  } as unknown as Request;
}

describe('error-handler middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ────────────────────────────────────────────────────
  // getErrorMessage
  // ────────────────────────────────────────────────────
  describe('getErrorMessage', () => {
    it('returns message for Error instance', () => {
      const err = new Error('test error message');
      const result = getErrorMessage(err);
      expect(result).toBe('test error message');
    });

    it('returns String for non-Error object', () => {
      const result = getErrorMessage('string error');
      expect(result).toBe('string error');
    });

    it('returns String for number', () => {
      const result = getErrorMessage(123);
      expect(result).toBe('123');
    });

    it('returns String for null', () => {
      const result = getErrorMessage(null);
      expect(result).toBe('null');
    });

    it('returns String for undefined', () => {
      const result = getErrorMessage(undefined);
      expect(result).toBe('undefined');
    });

    it('returns String for object', () => {
      const result = getErrorMessage({ foo: 'bar' });
      expect(result).toBe('[object Object]');
    });
  });

  // ────────────────────────────────────────────────────
  // handleRouteError
  // ────────────────────────────────────────────────────
  describe('handleRouteError', () => {
    it('logs error and returns 500 with message', () => {
      const err = new Error('route error');
      const res = createRes();

      handleRouteError(err, 'test context', 'user message', res);

      expect(mocks.loggerError).toHaveBeenCalledWith('test context', {
        error: 'route error',
      });
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'user message' });
    });

    it('handles non-Error objects', () => {
      const res = createRes();

      handleRouteError('string error', 'context', 'message', res);

      expect(mocks.loggerError).toHaveBeenCalledWith('context', {
        error: 'string error',
      });
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'message' });
    });
  });

  // ────────────────────────────────────────────────────
  // errorHandler
  // ────────────────────────────────────────────────────
  describe('errorHandler', () => {
    it('resolves status code from err.status', () => {
      const err = new Error('test') as Error & { status?: number };
      err.status = 404;
      const req = createReq();
      const res = createRes();
      const next = vi.fn() as NextFunction;

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('resolves status code from err.statusCode', () => {
      const err = new Error('test') as Error & { statusCode?: number };
      err.statusCode = 403;
      const req = createReq();
      const res = createRes();
      const next = vi.fn() as NextFunction;

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('prefers err.status over err.statusCode', () => {
      const err = new Error('test') as Error & { status?: number; statusCode?: number };
      err.status = 404;
      err.statusCode = 403;
      const req = createReq();
      const res = createRes();
      const next = vi.fn() as NextFunction;

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('defaults to 500 for invalid status code', () => {
      const err = new Error('test') as Error & { status?: number };
      err.status = 999;
      const req = createReq();
      const res = createRes();
      const next = vi.fn() as NextFunction;

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
    });

    it('defaults to 500 for non-integer status code', () => {
      const err = new Error('test') as Error & { status?: unknown };
      err.status = '404' as unknown;
      const req = createReq();
      const res = createRes();
      const next = vi.fn() as NextFunction;

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
    });

    it('returns 400 for entity.parse.failed (malformed JSON)', () => {
      const err = new Error('Unexpected token') as Error & { type?: string; status?: number };
      err.type = 'entity.parse.failed';
      err.status = 400;
      const req = createReq({ method: 'POST', path: '/api/upload' });
      const res = createRes();
      const next = vi.fn() as NextFunction;

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'リクエスト本文の形式が不正です',
        code: 'BAD_JSON_PAYLOAD',
      });
    });

    it('returns user-friendly message for 5xx errors', () => {
      const err = new Error('database connection failed');
      const req = createReq();
      const res = createRes();
      const next = vi.fn() as NextFunction;

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: 'サーバーエラーが発生しました',
        code: 'INTERNAL_SERVER_ERROR',
      });
    });

    it('returns user-friendly message for 4xx errors', () => {
      const err = new Error('not found') as Error & { status?: number };
      err.status = 404;
      const req = createReq();
      const res = createRes();
      const next = vi.fn() as NextFunction;

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        error: 'リクエストに失敗しました',
        code: 'HTTP_404',
      });
    });

    it('includes error code in response for public error codes', () => {
      const err = new Error('queue limit') as Error & { status?: number; code?: string };
      err.status = 429;
      err.code = 'UPLOAD_CONFIRM_QUEUE_LIMIT';
      const req = createReq();
      const res = createRes();
      const next = vi.fn() as NextFunction;

      errorHandler(err, req, res, next);

      expect(res.json).toHaveBeenCalledWith({
        error: 'リクエストに失敗しました',
        code: 'UPLOAD_CONFIRM_QUEUE_LIMIT',
      });
    });

    it('does not expose non-whitelisted error codes', () => {
      const err = new Error('db error') as Error & { status?: number; code?: string };
      err.status = 400;
      err.code = 'INTERNAL_DB_ERROR';
      const req = createReq();
      const res = createRes();
      const next = vi.fn() as NextFunction;

      errorHandler(err, req, res, next);

      expect(res.json).toHaveBeenCalledWith({
        error: 'リクエストに失敗しました',
        code: 'HTTP_400',
      });
    });

    it('logs error with correct context (method, path, status, requestId)', () => {
      const err = new Error('test error');
      const req = createReq({
        method: 'POST',
        path: '/api/inventory/upload',
        headers: { 'x-request-id': 'req-123' },
      });
      const res = createRes();
      const next = vi.fn() as NextFunction;

      errorHandler(err, req, res, next);

      expect(mocks.loggerError).toHaveBeenCalledWith('Unhandled error', {
        error: 'test error',
        stack: expect.any(String),
        method: 'POST',
        path: '/api/inventory/upload',
        status: 500,
        requestId: 'req-123',
      });
    });

    it('logs error with requestId from req.requestId if available', () => {
      const err = new Error('test error');
      const req = createReq({
        method: 'GET',
        path: '/api/test',
      });
      (req as Request & { requestId?: string }).requestId = 'req-456';
      const res = createRes();
      const next = vi.fn() as NextFunction;

      errorHandler(err, req, res, next);

      expect(mocks.loggerError).toHaveBeenCalledWith('Unhandled error', {
        error: 'test error',
        stack: expect.any(String),
        method: 'GET',
        path: '/api/test',
        status: 500,
        requestId: 'req-456',
      });
    });

    it('logs error without requestId if not available', () => {
      const err = new Error('test error');
      const req = createReq({
        method: 'GET',
        path: '/api/test',
      });
      const res = createRes();
      const next = vi.fn() as NextFunction;

      errorHandler(err, req, res, next);

      expect(mocks.loggerError).toHaveBeenCalledWith('Unhandled error', {
        error: 'test error',
        stack: expect.any(String),
        method: 'GET',
        path: '/api/test',
        status: 500,
        requestId: undefined,
      });
    });

    it('does not include stack for malformed JSON errors', () => {
      const err = new Error('Unexpected token') as Error & { type?: string; status?: number };
      err.type = 'entity.parse.failed';
      err.status = 400;
      const req = createReq();
      const res = createRes();
      const next = vi.fn() as NextFunction;

      errorHandler(err, req, res, next);

      expect(mocks.loggerError).toHaveBeenCalledWith('Unhandled error', {
        error: 'Malformed JSON payload',
        stack: undefined,
        method: 'GET',
        path: '/api/test',
        status: 400,
        requestId: undefined,
      });
    });

    it('includes stack for other errors', () => {
      const err = new Error('database error');
      const req = createReq();
      const res = createRes();
      const next = vi.fn() as NextFunction;

      errorHandler(err, req, res, next);

      expect(mocks.loggerError).toHaveBeenCalledWith(
        'Unhandled error',
        expect.objectContaining({
          stack: expect.any(String),
        }),
      );
    });

    it('records unhandled error via recordHttpUnhandledError', () => {
      const err = new Error('test error') as Error & { status?: number; code?: string };
      err.status = 500;
      err.code = 'DB_CONNECTION_FAILED';
      const req = createReq({
        method: 'POST',
        path: '/api/inventory',
        headers: { 'x-request-id': 'req-789' },
      });
      const res = createRes();
      const next = vi.fn() as NextFunction;

      errorHandler(err, req, res, next);

      expect(mocks.recordHttpUnhandledError).toHaveBeenCalledWith({
        method: 'POST',
        path: '/api/inventory',
        status: 500,
        requestId: 'req-789',
        errorCode: 'DB_CONNECTION_FAILED',
      });
    });

    it('records unhandled error without errorCode if not a string', () => {
      const err = new Error('test error') as Error & { status?: number; code?: unknown };
      err.status = 500;
      err.code = 123 as unknown;
      const req = createReq({
        method: 'GET',
        path: '/api/test',
      });
      const res = createRes();
      const next = vi.fn() as NextFunction;

      errorHandler(err, req, res, next);

      expect(mocks.recordHttpUnhandledError).toHaveBeenCalledWith({
        method: 'GET',
        path: '/api/test',
        status: 500,
        requestId: undefined,
        errorCode: undefined,
      });
    });

    it('handles 400 status code correctly', () => {
      const err = new Error('bad request') as Error & { status?: number };
      err.status = 400;
      const req = createReq();
      const res = createRes();
      const next = vi.fn() as NextFunction;

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'リクエストに失敗しました',
        code: 'HTTP_400',
      });
    });

    it('handles 599 status code correctly', () => {
      const err = new Error('server error') as Error & { status?: number };
      err.status = 599;
      const req = createReq();
      const res = createRes();
      const next = vi.fn() as NextFunction;

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(599);
      expect(res.json).toHaveBeenCalledWith({
        error: 'サーバーエラーが発生しました',
        code: 'INTERNAL_SERVER_ERROR',
      });
    });

    it('handles 401 status code correctly', () => {
      const err = new Error('unauthorized') as Error & { status?: number };
      err.status = 401;
      const req = createReq();
      const res = createRes();
      const next = vi.fn() as NextFunction;

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'リクエストに失敗しました',
        code: 'HTTP_401',
      });
    });

    it('handles 500 status code correctly', () => {
      const err = new Error('internal server error') as Error & { status?: number };
      err.status = 500;
      const req = createReq();
      const res = createRes();
      const next = vi.fn() as NextFunction;

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: 'サーバーエラーが発生しました',
        code: 'INTERNAL_SERVER_ERROR',
      });
    });

    it('handles error without message property', () => {
      const err = {} as Error;
      const req = createReq();
      const res = createRes();
      const next = vi.fn() as NextFunction;

      errorHandler(err, req, res, next);

      expect(mocks.loggerError).toHaveBeenCalledWith('Unhandled error', {
        error: 'Request failed',
        stack: undefined,
        method: 'GET',
        path: '/api/test',
        status: 500,
        requestId: undefined,
      });
    });

    it('handles error with empty message', () => {
      const err = new Error('');
      const req = createReq();
      const res = createRes();
      const next = vi.fn() as NextFunction;

      errorHandler(err, req, res, next);

      expect(mocks.loggerError).toHaveBeenCalledWith('Unhandled error', {
        error: 'Request failed',
        stack: expect.any(String),
        method: 'GET',
        path: '/api/test',
        status: 500,
        requestId: undefined,
      });
    });

    it('handles multiple public error codes correctly', () => {
      const err = new Error('queue limit') as Error & { status?: number; code?: string };
      err.status = 429;
      err.code = 'UPLOAD_CONFIRM_QUEUE_LIMIT';
      const req = createReq();
      const res = createRes();
      const next = vi.fn() as NextFunction;

      errorHandler(err, req, res, next);

      expect(res.json).toHaveBeenCalledWith({
        error: 'リクエストに失敗しました',
        code: 'UPLOAD_CONFIRM_QUEUE_LIMIT',
      });
    });

    it('handles error with both status and statusCode (prefers status)', () => {
      const err = new Error('test') as Error & { status?: number; statusCode?: number };
      err.status = 404;
      err.statusCode = 500;
      const req = createReq();
      const res = createRes();
      const next = vi.fn() as NextFunction;

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('handles error with only statusCode', () => {
      const err = new Error('test') as Error & { statusCode?: number };
      err.statusCode = 403;
      const req = createReq();
      const res = createRes();
      const next = vi.fn() as NextFunction;

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('handles error with negative status code', () => {
      const err = new Error('test') as Error & { status?: number };
      err.status = -1;
      const req = createReq();
      const res = createRes();
      const next = vi.fn() as NextFunction;

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
    });

    it('handles error with float status code', () => {
      const err = new Error('test') as Error & { status?: number };
      err.status = 404.5;
      const req = createReq();
      const res = createRes();
      const next = vi.fn() as NextFunction;

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
    });

    it('handles error with status code 399 (below valid range)', () => {
      const err = new Error('test') as Error & { status?: number };
      err.status = 399;
      const req = createReq();
      const res = createRes();
      const next = vi.fn() as NextFunction;

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
    });

    it('handles error with status code 600 (above valid range)', () => {
      const err = new Error('test') as Error & { status?: number };
      err.status = 600;
      const req = createReq();
      const res = createRes();
      const next = vi.fn() as NextFunction;

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
    });

    // ────────────────────────────────────────────────────
    // OpenClaw autofix integration
    // ────────────────────────────────────────────────────
    describe('OpenClaw autofix integration', () => {
      it('should call captureException and buildErrorFixContext for 5xx errors', () => {
        const err = new Error('DB timeout');
        const req = createReq({ method: 'POST', path: '/api/upload' });
        const res = createRes();
        const next = vi.fn() as NextFunction;

        errorHandler(err, req, res, next);

        expect(mocks.captureException).toHaveBeenCalledWith(err);
        expect(mocks.buildErrorFixContext).toHaveBeenCalledWith(
          expect.objectContaining({
            err,
            method: 'POST',
            path: '/api/upload',
            status: 500,
            sentryEventId: 'evt-123',
          }),
        );
      });

      it('should call handoffErrorToOpenClaw for 5xx errors', () => {
        const err = new Error('DB timeout');
        const req = createReq({ method: 'POST', path: '/api/upload' });
        const res = createRes();
        const next = vi.fn() as NextFunction;

        errorHandler(err, req, res, next);

        expect(mocks.handoffErrorToOpenClaw).toHaveBeenCalledWith(
          expect.objectContaining({
            errorMessage: 'test',
            sentryEventId: 'evt-123',
          }),
          500,
        );
      });

      it('should NOT call handoffErrorToOpenClaw for 4xx errors', () => {
        const err = new Error('not found') as Error & { status?: number };
        err.status = 404;
        const req = createReq();
        const res = createRes();
        const next = vi.fn() as NextFunction;

        errorHandler(err, req, res, next);

        // 4xx では handoffErrorToOpenClaw は呼ばれない（status >= 500 のみ）
        expect(mocks.handoffErrorToOpenClaw).not.toHaveBeenCalled();
      });
    });
  });
});
