import { describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { csrfProtection, ensureCsrfCookie } from '../middleware/csrf';

function createResponseMock() {
  const status = vi.fn();
  const json = vi.fn();
  const cookie = vi.fn();
  const res = {
    status,
    json,
    cookie,
  } as unknown as Response;
  status.mockReturnValue(res);
  json.mockReturnValue(res);
  return { res, status, json, cookie };
}

function createRequestMock(overrides: Partial<Request> = {}): Request {
  const defaultHeader = ((_: string) => '') as Request['header'];
  return {
    method: 'POST',
    path: '/inventory/dead-stock',
    cookies: {},
    header: defaultHeader,
    ...overrides,
  } as unknown as Request;
}

describe('csrf middleware', () => {
  it('reuses existing csrf cookie token', () => {
    const token = 'existing-token';
    const req = createRequestMock({
      cookies: { csrfToken: token },
    });
    const { res, cookie } = createResponseMock();

    const value = ensureCsrfCookie(req, res);

    expect(value).toBe(token);
    expect(cookie).not.toHaveBeenCalled();
  });

  it('allows safe method requests', () => {
    const req = createRequestMock({ method: 'GET' });
    const { res, status } = createResponseMock();
    const next = vi.fn() as unknown as NextFunction;

    csrfProtection(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(status).not.toHaveBeenCalled();
  });

  it('allows exact exempt auth paths without csrf validation', () => {
    const req = createRequestMock({
      path: '/auth/login',
      cookies: {
        token: 'auth-cookie',
        csrfToken: 'cookie-token',
      },
    });
    const { res, status } = createResponseMock();
    const next = vi.fn() as unknown as NextFunction;

    csrfProtection(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(status).not.toHaveBeenCalled();
  });

  it('allows unauthenticated unsafe requests', () => {
    const req = createRequestMock({
      cookies: {},
      header: ((_: string) => '') as Request['header'],
    });
    const { res, status } = createResponseMock();
    const next = vi.fn() as unknown as NextFunction;

    csrfProtection(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(status).not.toHaveBeenCalled();
  });

  it('blocks authenticated request when csrf token mismatches', () => {
    const req = createRequestMock({
      cookies: {
        token: 'auth-cookie',
        csrfToken: 'cookie-token',
      },
      header: ((_: string) => 'different-token') as Request['header'],
    });
    const { res, status, json } = createResponseMock();
    const next = vi.fn() as unknown as NextFunction;

    csrfProtection(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({ error: 'CSRFトークンが無効です。再読み込みしてください' });
  });

  it('allows authenticated request when csrf token matches', () => {
    const req = createRequestMock({
      cookies: {
        token: 'auth-cookie',
        csrfToken: 'same-token',
      },
      header: ((name: string) => (name === 'x-csrf-token' ? 'same-token' : '')) as Request['header'],
    });
    const { res, status } = createResponseMock();
    const next = vi.fn() as unknown as NextFunction;

    csrfProtection(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(status).not.toHaveBeenCalled();
  });

  it('does not exempt auth subpaths that only share a prefix', () => {
    const req = createRequestMock({
      path: '/auth/login/extra',
      cookies: {
        token: 'auth-cookie',
        csrfToken: 'cookie-token',
      },
      header: ((_: string) => '') as Request['header'],
    });
    const { res, status, json } = createResponseMock();
    const next = vi.fn() as unknown as NextFunction;

    csrfProtection(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({ error: 'CSRFトークンが無効です。再読み込みしてください' });
  });
});
