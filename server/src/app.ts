import express, { Request } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import authRoutes from './routes/auth';
import accountRoutes from './routes/account';
import adminRoutes from './routes/admin';
import uploadRoutes from './routes/upload';
import inventoryRoutes from './routes/inventory';
import exchangeRoutes from './routes/exchange';
import pharmaciesRoutes from './routes/pharmacies';
import notificationsRoutes from './routes/notifications';
import requestsRoutes from './routes/requests';
import openclawRoutes from './routes/openclaw';
import businessHoursRoutes from './routes/business-hours';
import searchRoutes from './routes/search';
import drugMasterRoutes from './routes/drug-master';
import updatesRoutes from './routes/updates';
import internalMatchingRefreshRoutes from './routes/internal-matching-refresh';
import internalMonthlyReportsRoutes from './routes/internal-monthly-reports';
import { errorHandler } from './middleware/error-handler';
import { requestLogger } from './middleware/request-logger';
import { csrfProtection } from './middleware/csrf';
import { db } from './config/database';
import { sql } from 'drizzle-orm';
import { logger } from './services/logger';
import { resolveTrustProxySetting } from './utils/trust-proxy';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', resolveTrustProxySetting());

function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/\/$/, '');
}

function extractHostname(value: string): string | null {
  const candidate = value.split(',')[0]?.trim();
  if (!candidate) return null;

  try {
    const normalized = candidate.includes('://')
      ? candidate
      : `http://${candidate}`;
    return new URL(normalized).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isSameHostOrigin(origin: string, req: Request): boolean {
  try {
    const originHost = new URL(origin).hostname.toLowerCase();
    const forwardedHost = req.headers['x-forwarded-host'];
    const requestHostRaw = Array.isArray(forwardedHost)
      ? forwardedHost[0]
      : forwardedHost ?? req.headers.host;

    if (!requestHostRaw) {
      return false;
    }

    const requestHost = extractHostname(requestHostRaw);
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

const uniqueAllowedOrigins = Array.from(new Set(allowedOrigins));

if (process.env.NODE_ENV === 'production' && uniqueAllowedOrigins.length === 0) {
  throw new Error('CORS_ORIGINS must be set in production');
}

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
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));
app.use(express.json({
  limit: '1mb',
  verify: (req, _res, buf) => {
    // rawBody is only required for OpenClaw webhook HMAC verification.
    if (req.url?.startsWith('/api/openclaw/callback')) {
      (req as Request).rawBody = buf.toString('utf8');
    }
  },
}));
app.use(cookieParser());

// Request logging
app.use(requestLogger);

const apiRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1200,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: (req) => req.method === 'OPTIONS',
  message: { error: 'リクエストが集中しています。しばらくしてから再試行してください' },
});
app.use('/api', apiRateLimiter);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && !uniqueAllowedOrigins.includes(normalizeOrigin(origin)) && !isSameHostOrigin(origin, req)) {
    res.status(403).json({ error: '許可されていないオリジンです' });
    return;
  }
  next();
});
app.use('/api', csrfProtection);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/account', accountRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/exchange', exchangeRoutes);
app.use('/api/pharmacies', pharmaciesRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/requests', requestsRoutes);
app.use('/api/openclaw', openclawRoutes);
app.use('/api/business-hours', businessHoursRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/admin/drug-master', drugMasterRoutes);
app.use('/api/updates', updatesRoutes);
app.use('/api/internal/matching-refresh', internalMatchingRefreshRoutes);
app.use('/api/internal/monthly-reports', internalMonthlyReportsRoutes);

// Health check with DB connectivity
app.get('/api/health', async (_req, res) => {
  const checks: Record<string, string> = {
    server: 'ok',
    database: 'unknown',
  };

  try {
    await db.execute(sql`SELECT 1`);
    checks.database = 'ok';
  } catch (err) {
    checks.database = 'error';
    logger.error('Health check: database connection failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const allOk = Object.values(checks).every((v) => v === 'ok');
  const status = allOk ? 'ok' : 'degraded';

  res.status(allOk ? 200 : 503).json({
    status,
    timestamp: new Date().toISOString(),
    checks,
    uptime: process.uptime(),
  });
});

app.use(errorHandler);

export default app;
