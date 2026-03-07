import { initSentry } from './config/sentry';
initSentry();

import express, { Request } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import compression from 'compression';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import authRoutes from './routes/auth';
import verificationRoutes from './routes/verification';
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
import adminErrorCodesRoutes from './routes/admin-error-codes';
import adminLogCenterRoutes from './routes/admin-log-center';
import openclawCommandsRoutes from './routes/openclaw-commands';
import updatesRoutes from './routes/updates';
import internalMatchingRefreshRoutes from './routes/internal-matching-refresh';
import internalMonthlyReportsRoutes from './routes/internal-monthly-reports';
import internalUploadJobsRoutes from './routes/internal-upload-jobs';
import internalMonitoringRoutes from './routes/internal-monitoring';
import internalPredictiveAlertsRoutes from './routes/internal-predictive-alerts';
import internalVercelDeployEventsRoutes from './routes/internal-vercel-deploy-events';
import timelineRoutes from './routes/timeline';
import statisticsRoutes from './routes/statistics';
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

/**
 * Sentry DSN からホスト部分を抽出して connectSrc に追加するためのヘルパー。
 * 例: "https://abc@o123.ingest.sentry.io/456" → "https://o123.ingest.sentry.io"
 */
function extractSentryOrigin(dsn: string): string | null {
  try {
    const url = new URL(dsn);
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
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

// Report-To ヘッダー: CSP_REPORT_URI が設定されている場合のみ出力（Helmet より前に配置）
const cspReportUri = process.env.CSP_REPORT_URI ?? null;
if (cspReportUri) {
  app.use((_req, res, next) => {
    res.setHeader(
      'Report-To',
      JSON.stringify({
        group: 'csp-endpoint',
        max_age: 10886400,
        endpoints: [{ url: cspReportUri }],
      }),
    );
    next();
  });
}

// connectSrc: SENTRY_DSN が設定されている場合は Sentry のオリジンを追加
const connectSrcDirective: string[] = ["'self'"];
const sentryDsn = process.env.SENTRY_DSN ?? null;
if (sentryDsn) {
  const sentryOrigin = extractSentryOrigin(sentryDsn);
  if (sentryOrigin) {
    connectSrcDirective.push(sentryOrigin);
  }
}

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: connectSrcDirective,
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: [],
      ...(cspReportUri
        ? {
            reportUri: [cspReportUri],
            reportTo: ['csp-endpoint'],
          }
        : {}),
    },
  },
  crossOriginEmbedderPolicy: false,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));
// Permissions-Policy は Helmet が直接サポートしていないためカスタムミドルウェアで追加
// camera=(self): カメラは自分のオリジンからのみ許可（バーコードスキャン機能で使用）
app.use((_req, res, next) => {
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=(), payment=()');
  next();
});
app.use(compression({
  threshold: 1024,
}));
app.use(express.json({
  limit: '1mb',
  verify: (req, _res, buf) => {
    // rawBody is required for OpenClaw webhook HMAC verification.
    if (req.url?.startsWith('/api/openclaw/callback') || req.url?.startsWith('/api/openclaw/commands')) {
      (req as Request).rawBody = buf.toString('utf8');
    }
  },
}));
app.use(cookieParser());

// Request logging
app.use(requestLogger);

// Health check endpoints (before rate limiter — no rate limiting needed)
app.get('/api/health', async (_req, res) => {
  const start = Date.now();
  let dbStatus: 'ok' | 'error' = 'ok';
  let dbResponseTime: number | null = null;

  try {
    await db.execute(sql`SELECT 1`);
    dbResponseTime = Date.now() - start;
  } catch (err) {
    dbStatus = 'error';
    dbResponseTime = Date.now() - start;
    logger.error('Health check: database connection failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const overallStatus = dbStatus === 'ok' ? 'ok' : 'degraded';

  res.status(dbStatus === 'ok' ? 200 : 503).json({
    status: overallStatus,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    db: { status: dbStatus, responseTime: dbResponseTime },
    version: process.env.npm_package_version ?? '0.0.0',
  });
});

app.get('/api/health/ready', async (_req, res) => {
  try {
    await db.execute(sql`SELECT 1`);
    res.status(200).json({ ready: true });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.error('Readiness check: database connection failed', { error: reason });
    res.status(503).json({ ready: false });
  }
});

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
app.use('/api', csrfProtection);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/auth', verificationRoutes);
app.use('/api/account', accountRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/exchange', exchangeRoutes);
app.use('/api/pharmacies', pharmaciesRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/requests', requestsRoutes);
app.use('/api/openclaw', openclawRoutes);
app.use('/api/openclaw/commands', openclawCommandsRoutes);
app.use('/api/business-hours', businessHoursRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/admin/drug-master', drugMasterRoutes);
app.use('/api/admin/error-codes', adminErrorCodesRoutes);
app.use('/api/admin/log-center', adminLogCenterRoutes);
app.use('/api/updates', updatesRoutes);
app.use('/api/internal/matching-refresh', internalMatchingRefreshRoutes);
app.use('/api/internal/monthly-reports', internalMonthlyReportsRoutes);
app.use('/api/internal/upload-jobs', internalUploadJobsRoutes);
app.use('/api/internal/monitoring', internalMonitoringRoutes);
app.use('/api/internal/predictive-alerts', internalPredictiveAlertsRoutes);
app.use('/api/internal/vercel', internalVercelDeployEventsRoutes);
app.use('/api/timeline', timelineRoutes);
app.use('/api/statistics', statisticsRoutes);

app.use(errorHandler);

export default app;
