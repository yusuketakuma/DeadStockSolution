import { describe, it, expect } from 'vitest';
import { ApiError, isApiError } from '../utils/api-error';

describe('ApiError', () => {
  describe('constructor', () => {
    it('creates error with all properties', () => {
      const error = new ApiError(400, 'Bad request', 'BAD_REQUEST', { field: 'email' });

      expect(error.status).toBe(400);
      expect(error.message).toBe('Bad request');
      expect(error.code).toBe('BAD_REQUEST');
      expect(error.details).toEqual({ field: 'email' });
      expect(error.name).toBe('ApiError');
    });

    it('creates error with default code', () => {
      const error = new ApiError(500, 'Server error');

      expect(error.status).toBe(500);
      expect(error.message).toBe('Server error');
      expect(error.code).toBe('INTERNAL_ERROR');
      expect(error.details).toBeUndefined();
    });
  });

  describe('static factory methods', () => {
    it('badRequest creates 400 error', () => {
      const error = ApiError.badRequest('Invalid input');

      expect(error.status).toBe(400);
      expect(error.message).toBe('Invalid input');
      expect(error.code).toBe('BAD_REQUEST');
    });

    it('badRequest with custom code and details', () => {
      const error = ApiError.badRequest('Invalid input', 'CUSTOM_CODE', { field: 'name' });

      expect(error.status).toBe(400);
      expect(error.code).toBe('CUSTOM_CODE');
      expect(error.details).toEqual({ field: 'name' });
    });

    it('unauthorized creates 401 error with default message', () => {
      const error = ApiError.unauthorized();

      expect(error.status).toBe(401);
      expect(error.message).toBe('認証が必要です');
      expect(error.code).toBe('UNAUTHORIZED');
    });

    it('unauthorized with custom message', () => {
      const error = ApiError.unauthorized('Token expired');

      expect(error.status).toBe(401);
      expect(error.message).toBe('Token expired');
    });

    it('forbidden creates 403 error with default message', () => {
      const error = ApiError.forbidden();

      expect(error.status).toBe(403);
      expect(error.message).toBe('アクセス権限がありません');
      expect(error.code).toBe('FORBIDDEN');
    });

    it('forbidden with custom message', () => {
      const error = ApiError.forbidden('Admin only');

      expect(error.status).toBe(403);
      expect(error.message).toBe('Admin only');
    });

    it('notFound creates 404 error with default message', () => {
      const error = ApiError.notFound();

      expect(error.status).toBe(404);
      expect(error.message).toBe('リソースが見つかりません');
      expect(error.code).toBe('NOT_FOUND');
    });

    it('notFound with custom message', () => {
      const error = ApiError.notFound('User not found');

      expect(error.status).toBe(404);
      expect(error.message).toBe('User not found');
    });

    it('conflict creates 409 error', () => {
      const error = ApiError.conflict('Email already exists');

      expect(error.status).toBe(409);
      expect(error.message).toBe('Email already exists');
      expect(error.code).toBe('CONFLICT');
    });

    it('conflict with details', () => {
      const error = ApiError.conflict('Duplicate', 'DUPLICATE', { email: 'test@example.com' });

      expect(error.status).toBe(409);
      expect(error.code).toBe('DUPLICATE');
      expect(error.details).toEqual({ email: 'test@example.com' });
    });

    it('validationError creates 400 error with VALIDATION_ERROR code', () => {
      const error = ApiError.validationError('Validation failed', { fields: ['email', 'name'] });

      expect(error.status).toBe(400);
      expect(error.message).toBe('Validation failed');
      expect(error.code).toBe('VALIDATION_ERROR');
      expect(error.details).toEqual({ fields: ['email', 'name'] });
    });

    it('internal creates 500 error with default message', () => {
      const error = ApiError.internal();

      expect(error.status).toBe(500);
      expect(error.message).toBe('サーバーエラーが発生しました');
      expect(error.code).toBe('INTERNAL_ERROR');
    });

    it('internal with custom message and code', () => {
      const error = ApiError.internal('Database error', 'DB_ERROR');

      expect(error.status).toBe(500);
      expect(error.message).toBe('Database error');
      expect(error.code).toBe('DB_ERROR');
    });
  });

  describe('toBody', () => {
    it('converts to response body with all fields', () => {
      const error = new ApiError(400, 'Bad request', 'BAD_REQUEST', { field: 'email' });
      const body = error.toBody();

      expect(body).toEqual({
        error: 'Bad request',
        code: 'BAD_REQUEST',
        details: { field: 'email' },
      });
    });

    it('omits details when undefined', () => {
      const error = new ApiError(404, 'Not found', 'NOT_FOUND');
      const body = error.toBody();

      expect(body).toEqual({
        error: 'Not found',
        code: 'NOT_FOUND',
      });
      expect(body.details).toBeUndefined();
    });
  });

  describe('isApiError type guard', () => {
    it('returns true for ApiError instances', () => {
      const error = new ApiError(400, 'Bad request');
      expect(isApiError(error)).toBe(true);
    });

    it('returns false for regular Error', () => {
      const error = new Error('Regular error');
      expect(isApiError(error)).toBe(false);
    });

    it('returns false for non-error values', () => {
      expect(isApiError(null)).toBe(false);
      expect(isApiError(undefined)).toBe(false);
      expect(isApiError('error')).toBe(false);
      expect(isApiError({ status: 400 })).toBe(false);
    });
  });

  describe('instanceof checks', () => {
    it('works with instanceof operator', () => {
      const error = new ApiError(400, 'Bad request');
      expect(error instanceof ApiError).toBe(true);
      expect(error instanceof Error).toBe(true);
    });
  });
});
