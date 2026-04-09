import { initSentry } from './config/sentry';
initSentry();

import express, { Request, RequestHandler } from 'express';
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
import realtimeRoutes from './routes/realtime';
import timelineRoutes from './routes/timeline';
import requestsRoutes from './routes/requests';
import openclawRoutes from './routes/openclaw';
import businessHoursRoutes from './routes/business-hours';
import searchRoutes from './routes/search';
import drugMasterRoutes from './routes/drug-master';
import adminErrorCodesRoutes from './routes/admin-error-codes';
import adminLogCenterRoutes from './routes/admin-log-center';
import adminRateLimitsRoutes from './routes/admin-rate-limits';
import openclawCommandsRoutes from './routes/openclaw-commands';
import openclawConnectRoutes from './routes/openclaw-connect';
import updatesRoutes from './routes/updates';
import internalMatchingRefreshRoutes from './routes/internal-matching-refresh';
import internalMonthlyReportsRoutes from './routes/internal-monthly-reports';
import internalOpenClawRetriesRoutes from './routes/internal-openclaw-retries';
import internalUploadJobsRoutes from './routes/internal-upload-jobs';
import internalMonitoringRoutes from './routes/internal-monitoring';
import internalPredictiveAlertsRoutes from './routes/internal-predictive-alerts';
import internalVercelDeployEventsRoutes from './routes/internal-vercel-deploy-events';
import internalDeadStockArchiveRoutes from './routes/internal-dead-stock-archive';
import internalProposalExpiryRoutes from './routes/internal-proposal-expiry';
import internalAdminDashboardSnapshotRoutes from './routes/internal-admin-dashboard-snapshot';
import internalDailyStatisticsRoutes from './routes/internal-daily-statistics';
import internalE2EProposalFlowRoutes from './routes/internal-e2e-proposal-flow';
import internalDrugMasterSyncRoutes from './routes/internal-drug-master-sync';
import statisticsRoutes from './routes/statistics';
import groupsRoutes from './routes/groups';
import alertsRoutes from './routes/alerts';
import matchBookmarksRoutes from './routes/match-bookmarks';
import adminMatchingExperimentsRoutes from './routes/admin-matching-experiments';
import adminOpenClawRetriesRoutes from './routes/admin-openclaw-retries';
import pushRoutes from './routes/push';
import uploadQualityRoutes from './routes/upload-quality';
import messagesRoutes from './routes/messages';
import sseRoutes from './routes/sse';
import proposalTemplatesRoutes from './routes/proposal-templates';
import stripeWebhookRoutes from './routes/stripe-webhook';
import subscriptionsRoutes from './routes/subscriptions';
import { errorHandler } from './middleware/error-handler';
import { requestLogger } from './middleware/request-logger';
import { csrfProtection } from './middleware/csrf';
import { requireLogin, rejectAdmin, requireAdmin } from './middleware/auth';
import { db } from './config/database';
import { sql } from 'drizzle-orm';
import { logger } from './services/logger';
import { getOpenClawHealthSnapshot } from './services/openclaw/health-service';
import { resolveTrustProxySetting } from './utils/trust-proxy';

const app = express();
app.disable('x-powered-by');

if (process.env.NODE_ENV === 'production' && !process.env.UPSTASH_REDIS_REST_URL) {
  console.warn('[WARN] UPSTASH_REDIS_REST_URL is not set in production. Rate limiting is degraded to in-memory store.');
}
app.set('trust proxy', resolveTrustProxySetting());

const API_PREFIXES = ['/api', '/api/v1'] as const;
const API_BASE_PATH_PATTERN = /^\/api(?:\/v1)?(?:\/|$)/;

function registerApiRoute(path: string, ...handlers: RequestHandler[]): void {
  for (const prefix of API_PREFIXES) {
    app.use(`${prefix}${path}`, ...handlers);
  }
}

function isRawBodyRoute(url?: string): boolean {
  if (!url) {
    return false;
  }

  return (
    url.startsWith('/api/openclaw/callback')
    || url.startsWith('/api/openclaw/report')
    || url.startsWith('/api/openclaw/commands')
    || url.startsWith('/api/openclaw/connect')
    || url.startsWith('/api/v1/openclaw/callback')
    || url.startsWith('/api/v1/openclaw/report')
    || url.startsWith('/api/v1/openclaw/commands')
    || url.startsWith('/api/v1/openclaw/connect')
    || url.startsWith('/api/stripe/webhook')
    || url.startsWith('/api/v1/stripe/webhook')
  );
}

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
      imgSrc: ["'self'", "data:", "blob:"],
      mediaSrc: ["'self'", "blob:"],
      workerSrc: ["'self'", "blob:"],
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
  // 3省2ガイドライン §13.3: 通信の暗号化 — HSTS を明示的に設定
  strictTransportSecurity: {
    maxAge: 31536000,       // 1年
    includeSubDomains: true,
    preload: true,
  },
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
    // rawBody is required for OpenClaw webhook HMAC verification and Stripe webhook signature verification.
    if (isRawBodyRoute(req.url)) {
      (req as Request).rawBody = buf.toString('utf8');
    }
  },
}));
app.use(cookieParser());

// Request logging
app.use(requestLogger);

// Health check endpoints (before rate limiter — no rate limiting needed)
const HEALTH_CHECK_DB_TIMEOUT_MS = 5_000;

const healthHandler: RequestHandler = async (_req, res) => {
  const start = Date.now();
  let dbStatus: 'ok' | 'error' = 'ok';
  let dbResponseTime: number | null = null;

  try {
    await Promise.race([
      db.execute(sql`SELECT 1`),
      new Promise((_resolve, reject) =>
        setTimeout(() => reject(new Error('Health check DB query timed out')), HEALTH_CHECK_DB_TIMEOUT_MS),
      ),
    ]);
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
};

const readinessHandler: RequestHandler = async (_req, res) => {
  try {
    await Promise.race([
      db.execute(sql`SELECT 1`),
      new Promise((_resolve, reject) =>
        setTimeout(() => reject(new Error('Readiness check DB query timed out')), HEALTH_CHECK_DB_TIMEOUT_MS),
      ),
    ]);
    res.status(200).json({ ready: true });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.error('Readiness check: database connection failed', { error: reason });
    res.status(503).json({ ready: false });
  }
};

const openClawHealthHandler: RequestHandler = async (_req, res) => {
  try {
    const snapshot = await getOpenClawHealthSnapshot();
    res.status(200).json(snapshot);
  } catch (err) {
    logger.error('OpenClaw health check failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(503).json({
      status: 'degraded',
      timestamp: new Date().toISOString(),
      error: 'openclaw health check failed',
    });
  }
};

for (const prefix of API_PREFIXES) {
  app.get(`${prefix}/health`, healthHandler);
  app.get(`${prefix}/health/ready`, readinessHandler);
  app.get(`${prefix}/health/openclaw`, openClawHealthHandler);
}

const apiRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1200,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: (req) => req.method === 'OPTIONS',
  message: { error: 'リクエストが集中しています。しばらくしてから再試行してください' },
});
app.use(API_BASE_PATH_PATTERN, apiRateLimiter);

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
registerApiRoute('/stripe', stripeWebhookRoutes);
app.use(API_BASE_PATH_PATTERN, csrfProtection);

// Routes
registerApiRoute('/auth', authRoutes);
registerApiRoute('/auth', verificationRoutes);
registerApiRoute('/account', accountRoutes);
registerApiRoute('/admin', adminRoutes);
// User-only routes (admin accounts are blocked)
registerApiRoute('/upload', rejectAdmin, uploadRoutes);
registerApiRoute('/inventory', rejectAdmin, inventoryRoutes);
registerApiRoute('/exchange', rejectAdmin, exchangeRoutes);
registerApiRoute('/pharmacies', rejectAdmin, pharmaciesRoutes);
registerApiRoute('/requests', rejectAdmin, requestsRoutes);
registerApiRoute('/business-hours', rejectAdmin, businessHoursRoutes);
registerApiRoute('/search', rejectAdmin, searchRoutes);
registerApiRoute('/statistics', rejectAdmin, statisticsRoutes);
registerApiRoute('/groups', requireLogin, rejectAdmin, groupsRoutes);
registerApiRoute('/alerts', requireLogin, rejectAdmin, alertsRoutes);
registerApiRoute('/match-bookmarks', requireLogin, rejectAdmin, matchBookmarksRoutes);
registerApiRoute('/push', rejectAdmin, pushRoutes);
registerApiRoute('/upload-quality', rejectAdmin, uploadQualityRoutes);
registerApiRoute('/messages', requireLogin, rejectAdmin, messagesRoutes);
registerApiRoute('/sse', requireLogin, rejectAdmin, sseRoutes);
registerApiRoute('/proposal-templates', rejectAdmin, proposalTemplatesRoutes);
registerApiRoute('/realtime', realtimeRoutes);
registerApiRoute('/subscriptions', subscriptionsRoutes);

// Shared routes (both admin and user)
registerApiRoute('/notifications', notificationsRoutes);
registerApiRoute('/timeline', timelineRoutes);
registerApiRoute('/updates', updatesRoutes);

// OpenClaw (webhook callbacks need access regardless)
registerApiRoute('/openclaw', openclawRoutes);
registerApiRoute('/openclaw/commands', openclawCommandsRoutes);
registerApiRoute('/openclaw/connect', openclawConnectRoutes);

// Admin-only routes
registerApiRoute('/admin', requireLogin, requireAdmin, adminMatchingExperimentsRoutes);
registerApiRoute('/admin', requireLogin, requireAdmin, adminOpenClawRetriesRoutes);
registerApiRoute('/admin/drug-master', requireLogin, requireAdmin, drugMasterRoutes);
registerApiRoute('/admin/error-codes', requireLogin, requireAdmin, adminErrorCodesRoutes);
registerApiRoute('/admin/log-center', requireLogin, requireAdmin, adminLogCenterRoutes);
registerApiRoute('/admin/rate-limits', requireLogin, requireAdmin, adminRateLimitsRoutes);

// Internal routes
registerApiRoute('/internal/matching-refresh', internalMatchingRefreshRoutes);
registerApiRoute('/internal/monthly-reports', internalMonthlyReportsRoutes);
registerApiRoute('/internal/openclaw-retries', internalOpenClawRetriesRoutes);
registerApiRoute('/internal/upload-jobs', internalUploadJobsRoutes);
registerApiRoute('/internal/monitoring', internalMonitoringRoutes);
registerApiRoute('/internal/predictive-alerts', internalPredictiveAlertsRoutes);
registerApiRoute('/internal/vercel', internalVercelDeployEventsRoutes);
registerApiRoute('/internal/dead-stock', internalDeadStockArchiveRoutes);
registerApiRoute('/internal/proposals', internalProposalExpiryRoutes);
registerApiRoute('/internal/admin-dashboard', internalAdminDashboardSnapshotRoutes);
registerApiRoute('/internal/daily-statistics', internalDailyStatisticsRoutes);
registerApiRoute('/internal/e2e/proposal-flow', internalE2EProposalFlowRoutes);
registerApiRoute('/internal/drug-master-sync', internalDrugMasterSyncRoutes);

app.use(errorHandler);

export default app;
