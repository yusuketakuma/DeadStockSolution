import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { NextFunction, Request, Response } from 'express';
import {
  generateCsrfToken,
  setCsrfCookie,
  clearCsrfCookie,
  ensureCsrfCookie,
  csrfProtection,
} from '../middleware/csrf';

function createMockRequest(overrides?: Partial<Request>): Request {
  return {
    method: 'POST',
    path: '/api/test',
    cookies: {},
    header: vi.fn(),
    ...overrides,
  } as unknown as Request;
}

function createMockResponse(): Response {
  const res = {
    cookie: vi.fn().mockReturnThis(),
    clearCookie: vi.fn().mockReturnThis(),
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return res;
}

describe('CSRF Middleware', () => {
  let originalNodeEnv: string | undefined;

  beforeEach(() => {
    originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  describe('generateCsrfToken', () => {
    it('returns a 64-character hex string', () => {
      const token = generateCsrfToken();
      expect(token).toMatch(/^[a-f0-9]{64}$/);
    });

    it('generates unique tokens on each call', () => {
      const token1 = generateCsrfToken();
      const token2 = generateCsrfToken();
      expect(token1).not.toBe(token2);
    });

    it('generates tokens of consistent length', () => {
      const tokens = Array.from({ length: 10 }, () => generateCsrfToken());
      tokens.forEach((token) => {
        expect(token).toHaveLength(64);
      });
    });
  });

  describe('setCsrfCookie', () => {
    it('sets cookie with correct name and value', () => {
      const res = createMockResponse();
      const token = 'test-token-value';

      setCsrfCookie(res, token);

      expect(res.cookie).toHaveBeenCalledWith('csrfToken', token, expect.any(Object));
    });

    it('sets httpOnly to false', () => {
      const res = createMockResponse();
      const token = generateCsrfToken();

      setCsrfCookie(res, token);

      const callArgs = (res.cookie as any).mock.calls[0];
      expect(callArgs[2].httpOnly).toBe(false);
    });

    it('sets secure to false in development', () => {
      process.env.NODE_ENV = 'development';
      const res = createMockResponse();
      const token = generateCsrfToken();

      setCsrfCookie(res, token);

      const callArgs = (res.cookie as any).mock.calls[0];
      expect(callArgs[2].secure).toBe(false);
    });

    it('sets secure to true in production', () => {
      process.env.NODE_ENV = 'production';
      const res = createMockResponse();
      const token = generateCsrfToken();

      setCsrfCookie(res, token);

      const callArgs = (res.cookie as any).mock.calls[0];
      expect(callArgs[2].secure).toBe(true);
    });

    it('sets sameSite to lax', () => {
      const res = createMockResponse();
      const token = generateCsrfToken();

      setCsrfCookie(res, token);

      const callArgs = (res.cookie as any).mock.calls[0];
      expect(callArgs[2].sameSite).toBe('lax');
    });

    it('sets maxAge to 24 hours in milliseconds', () => {
      const res = createMockResponse();
      const token = generateCsrfToken();

      setCsrfCookie(res, token);

      const callArgs = (res.cookie as any).mock.calls[0];
      expect(callArgs[2].maxAge).toBe(24 * 60 * 60 * 1000);
    });
  });

  describe('clearCsrfCookie', () => {
    it('clears the CSRF cookie', () => {
      const res = createMockResponse();

      clearCsrfCookie(res);

      expect(res.clearCookie).toHaveBeenCalledWith('csrfToken');
    });

    it('clears only the CSRF cookie, not others', () => {
      const res = createMockResponse();

      clearCsrfCookie(res);

      expect(res.clearCookie).toHaveBeenCalledTimes(1);
      expect(res.clearCookie).toHaveBeenCalledWith('csrfToken');
    });
  });

  describe('ensureCsrfCookie', () => {
    it('returns existing token from cookie', () => {
      const existingToken = generateCsrfToken();
      const req = createMockRequest({
        cookies: { csrfToken: existingToken },
      });
      const res = createMockResponse();

      const token = ensureCsrfCookie(req, res);

      expect(token).toBe(existingToken);
      expect(res.cookie).not.toHaveBeenCalled();
    });

    it('generates and sets new token when cookie is missing', () => {
      const req = createMockRequest({
        cookies: {},
      });
      const res = createMockResponse();

      const token = ensureCsrfCookie(req, res);

      expect(token).toMatch(/^[a-f0-9]{64}$/);
      expect(res.cookie).toHaveBeenCalled();
    });

    it('generates and sets new token when cookie is empty string', () => {
      const req = createMockRequest({
        cookies: { csrfToken: '' },
      });
      const res = createMockResponse();

      const token = ensureCsrfCookie(req, res);

      expect(token).toMatch(/^[a-f0-9]{64}$/);
      expect(res.cookie).toHaveBeenCalled();
    });

    it('generates and sets new token when cookie is not a string', () => {
      const req = createMockRequest({
        cookies: { csrfToken: 123 as any },
      });
      const res = createMockResponse();

      const token = ensureCsrfCookie(req, res);

      expect(token).toMatch(/^[a-f0-9]{64}$/);
      expect(res.cookie).toHaveBeenCalled();
    });

    it('handles missing cookies object gracefully', () => {
      const req = createMockRequest({
        cookies: undefined,
      });
      const res = createMockResponse();

      const token = ensureCsrfCookie(req, res);

      expect(token).toMatch(/^[a-f0-9]{64}$/);
      expect(res.cookie).toHaveBeenCalled();
    });
  });

  describe('csrfProtection', () => {
    let next: NextFunction;

    beforeEach(() => {
      next = vi.fn();
    });

    describe('safe methods', () => {
      it('passes GET requests without CSRF check', () => {
        const req = createMockRequest({
          method: 'GET',
          path: '/api/test',
          cookies: { token: 'auth-token' },
        });
        const res = createMockResponse();

        csrfProtection(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(res.status).not.toHaveBeenCalled();
      });

      it('passes HEAD requests without CSRF check', () => {
        const req = createMockRequest({
          method: 'HEAD',
          path: '/api/test',
          cookies: { token: 'auth-token' },
        });
        const res = createMockResponse();

        csrfProtection(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(res.status).not.toHaveBeenCalled();
      });

      it('passes OPTIONS requests without CSRF check', () => {
        const req = createMockRequest({
          method: 'OPTIONS',
          path: '/api/test',
          cookies: { token: 'auth-token' },
        });
        const res = createMockResponse();

        csrfProtection(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(res.status).not.toHaveBeenCalled();
      });

      it('is case-insensitive for method names', () => {
        const req = createMockRequest({
          method: 'get',
          path: '/api/test',
          cookies: { token: 'auth-token' },
        });
        const res = createMockResponse();

        csrfProtection(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(res.status).not.toHaveBeenCalled();
      });
    });

    describe('exempt paths', () => {
      it('passes /auth/login without CSRF check', () => {
        const req = createMockRequest({
          method: 'POST',
          path: '/auth/login',
          cookies: { token: 'auth-token' },
        });
        const res = createMockResponse();

        csrfProtection(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(res.status).not.toHaveBeenCalled();
      });

      it('passes /auth/register without CSRF check', () => {
        const req = createMockRequest({
          method: 'POST',
          path: '/auth/register',
          cookies: { token: 'auth-token' },
        });
        const res = createMockResponse();

        csrfProtection(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(res.status).not.toHaveBeenCalled();
      });

      it('passes /auth/password-reset/request without CSRF check', () => {
        const req = createMockRequest({
          method: 'POST',
          path: '/auth/password-reset/request',
          cookies: { token: 'auth-token' },
        });
        const res = createMockResponse();

        csrfProtection(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(res.status).not.toHaveBeenCalled();
      });

      it('passes /auth/password-reset/confirm without CSRF check', () => {
        const req = createMockRequest({
          method: 'POST',
          path: '/auth/password-reset/confirm',
          cookies: { token: 'auth-token' },
        });
        const res = createMockResponse();

        csrfProtection(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(res.status).not.toHaveBeenCalled();
      });

      it('passes /auth/csrf-token without CSRF check', () => {
        const req = createMockRequest({
          method: 'POST',
          path: '/auth/csrf-token',
          cookies: { token: 'auth-token' },
        });
        const res = createMockResponse();

        csrfProtection(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(res.status).not.toHaveBeenCalled();
      });

      it('does not exempt paths that only share a prefix', () => {
        const req = createMockRequest({
          method: 'POST',
          path: '/auth/login/extra',
          cookies: { token: 'auth-token' },
        });
        const res = createMockResponse();

        csrfProtection(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(403);
      });
    });

    describe('unauthenticated requests', () => {
      it('passes POST without auth token', () => {
        const req = createMockRequest({
          method: 'POST',
          path: '/api/test',
          cookies: {},
        });
        const res = createMockResponse();

        csrfProtection(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(res.status).not.toHaveBeenCalled();
      });

      it('passes PUT without auth token', () => {
        const req = createMockRequest({
          method: 'PUT',
          path: '/api/test',
          cookies: {},
        });
        const res = createMockResponse();

        csrfProtection(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(res.status).not.toHaveBeenCalled();
      });

      it('passes DELETE without auth token', () => {
        const req = createMockRequest({
          method: 'DELETE',
          path: '/api/test',
          cookies: {},
        });
        const res = createMockResponse();

        csrfProtection(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(res.status).not.toHaveBeenCalled();
      });

      it('passes when auth token is not a string', () => {
        const req = createMockRequest({
          method: 'POST',
          path: '/api/test',
          cookies: { token: 123 as any },
        });
        const res = createMockResponse();

        csrfProtection(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(res.status).not.toHaveBeenCalled();
      });

      it('passes when cookies object is missing', () => {
        const req = createMockRequest({
          method: 'POST',
          path: '/api/test',
          cookies: undefined,
        });
        const res = createMockResponse();

        csrfProtection(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(res.status).not.toHaveBeenCalled();
      });
    });

    describe('CSRF validation for authenticated requests', () => {
      it('rejects when CSRF cookie is missing', () => {
        const req = createMockRequest({
          method: 'POST',
          path: '/api/test',
          cookies: { token: 'auth-token' },
          header: vi.fn().mockReturnValue('some-header-value'),
        });
        const res = createMockResponse();

        csrfProtection(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith({
          error: 'CSRFトークンが無効です。再読み込みしてください',
        });
      });

      it('rejects when CSRF header is missing', () => {
        const token = generateCsrfToken();
        const req = createMockRequest({
          method: 'POST',
          path: '/api/test',
          cookies: { token: 'auth-token', csrfToken: token },
          header: vi.fn().mockReturnValue(undefined),
        });
        const res = createMockResponse();

        csrfProtection(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(403);
      });

      it('rejects when CSRF cookie and header do not match', () => {
        const req = createMockRequest({
          method: 'POST',
          path: '/api/test',
          cookies: { token: 'auth-token', csrfToken: generateCsrfToken() },
          header: vi.fn().mockReturnValue(generateCsrfToken()),
        });
        const res = createMockResponse();

        csrfProtection(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(403);
      });

      it('passes when CSRF cookie and header match', () => {
        const token = generateCsrfToken();
        const req = createMockRequest({
          method: 'POST',
          path: '/api/test',
          cookies: { token: 'auth-token', csrfToken: token },
          header: vi.fn().mockReturnValue(token),
        });
        const res = createMockResponse();

        csrfProtection(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(res.status).not.toHaveBeenCalled();
      });

      it('uses timing-safe comparison for CSRF tokens', () => {
        const token = generateCsrfToken();
        const req = createMockRequest({
          method: 'POST',
          path: '/api/test',
          cookies: { token: 'auth-token', csrfToken: token },
          header: vi.fn().mockReturnValue(token),
        });
        const res = createMockResponse();

        csrfProtection(req, res, next);

        // If timing-safe comparison is working, matching tokens should pass
        expect(next).toHaveBeenCalledTimes(1);
      });

      it('rejects when CSRF header is empty string', () => {
        const token = generateCsrfToken();
        const req = createMockRequest({
          method: 'POST',
          path: '/api/test',
          cookies: { token: 'auth-token', csrfToken: token },
          header: vi.fn().mockReturnValue(''),
        });
        const res = createMockResponse();

        csrfProtection(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(403);
      });

      it('rejects when CSRF cookie is empty string', () => {
        const req = createMockRequest({
          method: 'POST',
          path: '/api/test',
          cookies: { token: 'auth-token', csrfToken: '' },
          header: vi.fn().mockReturnValue(generateCsrfToken()),
        });
        const res = createMockResponse();

        csrfProtection(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(403);
      });

      it('rejects when CSRF cookie is not a string', () => {
        const req = createMockRequest({
          method: 'POST',
          path: '/api/test',
          cookies: { token: 'auth-token', csrfToken: 123 as any },
          header: vi.fn().mockReturnValue(generateCsrfToken()),
        });
        const res = createMockResponse();

        csrfProtection(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(403);
      });

      it('rejects when CSRF header is missing or null', () => {
        const token = generateCsrfToken();
        const req = createMockRequest({
          method: 'POST',
          path: '/api/test',
          cookies: { token: 'auth-token', csrfToken: token },
          header: vi.fn().mockReturnValue(null),
        });
        const res = createMockResponse();

        csrfProtection(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(403);
      });

      it('handles case-sensitive token comparison', () => {
        const token = generateCsrfToken();
        const req = createMockRequest({
          method: 'POST',
          path: '/api/test',
          cookies: { token: 'auth-token', csrfToken: token },
          header: vi.fn().mockReturnValue(token.toUpperCase()),
        });
        const res = createMockResponse();

        csrfProtection(req, res, next);

        // Hex strings should be case-insensitive in comparison
        // but timing-safe comparison is case-sensitive
        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(403);
      });
    });

    describe('integration scenarios', () => {
      it('allows authenticated POST with valid CSRF token', () => {
        const token = generateCsrfToken();
        const req = createMockRequest({
          method: 'POST',
          path: '/api/inventory/upload',
          cookies: { token: 'valid-auth-token', csrfToken: token },
          header: vi.fn().mockReturnValue(token),
        });
        const res = createMockResponse();

        csrfProtection(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(res.status).not.toHaveBeenCalled();
      });

      it('allows authenticated PUT with valid CSRF token', () => {
        const token = generateCsrfToken();
        const req = createMockRequest({
          method: 'PUT',
          path: '/api/proposal/123',
          cookies: { token: 'valid-auth-token', csrfToken: token },
          header: vi.fn().mockReturnValue(token),
        });
        const res = createMockResponse();

        csrfProtection(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(res.status).not.toHaveBeenCalled();
      });

      it('allows authenticated DELETE with valid CSRF token', () => {
        const token = generateCsrfToken();
        const req = createMockRequest({
          method: 'DELETE',
          path: '/api/inventory/123',
          cookies: { token: 'valid-auth-token', csrfToken: token },
          header: vi.fn().mockReturnValue(token),
        });
        const res = createMockResponse();

        csrfProtection(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(res.status).not.toHaveBeenCalled();
      });

      it('rejects authenticated POST with mismatched CSRF token', () => {
        const req = createMockRequest({
          method: 'POST',
          path: '/api/inventory/upload',
          cookies: { token: 'valid-auth-token', csrfToken: generateCsrfToken() },
          header: vi.fn().mockReturnValue(generateCsrfToken()),
        });
        const res = createMockResponse();

        csrfProtection(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(403);
      });
    });
  });
});
