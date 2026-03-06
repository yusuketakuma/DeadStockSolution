import crypto from 'crypto';
import { NextFunction, Request, Response } from 'express';

const CSRF_COOKIE_NAME = 'csrfToken';
const CSRF_HEADER_NAME = 'x-csrf-token';

const EXEMPT_PATHS = new Set([
  '/auth/login',
  '/auth/register',
  '/auth/password-reset/request',
  '/auth/password-reset/confirm',
  '/auth/csrf-token',
]);

function isSafeMethod(method: string): boolean {
  return ['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());
}

function isExemptPath(path: string): boolean {
  return EXEMPT_PATHS.has(path);
}
function timingSafeCompare(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a, 'utf8');
  const bBuffer = Buffer.from(b, 'utf8');
  if (aBuffer.length !== bBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(aBuffer, bBuffer);
}

export function generateCsrfToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function setCsrfCookie(res: Response, token: string): void {
  res.cookie(CSRF_COOKIE_NAME, token, {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000,
  });
}

export function clearCsrfCookie(res: Response): void {
  res.clearCookie(CSRF_COOKIE_NAME);
}

export function ensureCsrfCookie(req: Request, res: Response): string {
  const token = typeof req.cookies?.[CSRF_COOKIE_NAME] === 'string'
    ? req.cookies[CSRF_COOKIE_NAME]
    : '';
  if (token) {
    return token;
  }
  const created = generateCsrfToken();
  setCsrfCookie(res, created);
  return created;
}

export function csrfProtection(req: Request, res: Response, next: NextFunction): void {
  if (isSafeMethod(req.method) || isExemptPath(req.path)) {
    next();
    return;
  }

  // CSRF is required only for authenticated cookie sessions.
  const authToken = typeof req.cookies?.token === 'string' ? req.cookies.token : '';
  if (!authToken) {
    next();
    return;
  }

  const csrfCookie = typeof req.cookies?.[CSRF_COOKIE_NAME] === 'string'
    ? req.cookies[CSRF_COOKIE_NAME]
    : '';
  const csrfHeader = req.header(CSRF_HEADER_NAME) ?? '';
  if (!csrfCookie || !csrfHeader || !timingSafeCompare(csrfCookie, csrfHeader)) {
    res.status(403).json({ error: 'CSRFトークンが無効です。再読み込みしてください' });
    return;
  }

  next();
}
