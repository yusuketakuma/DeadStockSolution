import type { Express, Request } from 'express';
import express from 'express';
import cookieParser from 'cookie-parser';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { requestLogger } from '../middleware/request-logger';
import { csrfProtection } from '../middleware/csrf';
import { API_BASE_PATH_PATTERN } from './app-cors';

function isOpenclawRawBodyRoute(url?: string): boolean {
  if (!url) {
    return false;
  }

  return (
    url.startsWith('/api/openclaw/callback')
    || url.startsWith('/api/openclaw/commands')
    || url.startsWith('/api/v1/openclaw/callback')
    || url.startsWith('/api/v1/openclaw/commands')
  );
}

export function setupMiddleware(app: Express): void {
  app.use(compression({
    threshold: 1024,
  }));
  app.use(express.json({
    limit: '1mb',
    verify: (req, _res, buf) => {
      // rawBody is required for OpenClaw webhook HMAC verification.
      if (isOpenclawRawBodyRoute(req.url)) {
        (req as Request).rawBody = buf.toString('utf8');
      }
    },
  }));
  app.use(cookieParser());

  // Request logging
  app.use(requestLogger);
}

export function setupRateLimitAndCsrf(app: Express): void {
  const apiRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1200,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: (req) => req.method === 'OPTIONS',
    message: { error: 'リクエストが集中しています。しばらくしてから再試行してください' },
  });
  app.use(API_BASE_PATH_PATTERN, apiRateLimiter);
  app.use(API_BASE_PATH_PATTERN, csrfProtection);
}
