import type { Express, Request, RequestHandler } from 'express';
import cors from 'cors';
import { logger } from '../services/logger';

export const API_PREFIXES = ['/api', '/api/v1'] as const;
export const API_BASE_PATH_PATTERN = /^\/api(?:\/v1)?(?:\/|$)/;

export function registerApiRoute(app: Express, path: string, ...handlers: RequestHandler[]): void {
  for (const prefix of API_PREFIXES) {
    app.use(`${prefix}${path}`, ...handlers);
  }
}

function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/\/$/, '');
}

function isSameHostOrigin(origin: string, req: Request): boolean {
  try {
    const originHost = new URL(origin).hostname.toLowerCase();
    // Use req.hostname which respects Express trust proxy setting
    // instead of manually reading x-forwarded-host (user-controlled header)
    const requestHost = req.hostname?.toLowerCase();
    if (!requestHost) {
      return false;
    }
    return originHost === requestHost;
  } catch {
    return false;
  }
}

const configuredOrigins = (process.env.CORS_ORIGINS ?? '')
  .split(',')
  .map((origin) => normalizeOrigin(origin))
  .filter((origin) => origin.length > 0);

const vercelOrigin = process.env.VERCEL_URL
  ? normalizeOrigin(`https://${process.env.VERCEL_URL}`)
  : null;

const allowedOrigins = process.env.NODE_ENV === 'production'
  ? [...configuredOrigins, ...(vercelOrigin ? [vercelOrigin] : [])]
  : ['http://localhost:5173', 'http://127.0.0.1:5173', ...configuredOrigins];

export const uniqueAllowedOrigins = Array.from(new Set(allowedOrigins));

if (process.env.NODE_ENV === 'production' && uniqueAllowedOrigins.length === 0) {
  throw new Error('CORS_ORIGINS must be set in production');
}

export function setupCors(app: Express): void {
  app.use(cors({
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }

      if (uniqueAllowedOrigins.includes(normalizeOrigin(origin))) {
        callback(null, true);
        return;
      }

      callback(null, false);
    },
    credentials: true,
  }));
}

export function setupCorsGuard(app: Express): void {
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && !uniqueAllowedOrigins.includes(normalizeOrigin(origin)) && !isSameHostOrigin(origin, req)) {
      logger.warn('Origin blocked by CORS guard', {
        origin,
        method: req.method,
        path: req.path,
        host: req.headers.host ?? null,
        forwardedHost: req.headers['x-forwarded-host'] ?? null,
        requestId: (req as Request & { requestId?: string }).requestId ?? null,
      });
      res.status(403).json({ error: '許可されていないオリジンです' });
      return;
    }
    next();
  });
}
