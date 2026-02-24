import express from 'express';
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
import { errorHandler } from './middleware/error-handler';
import { requestLogger } from './middleware/request-logger';
import { db } from './config/database';
import { sql } from 'drizzle-orm';
import { logger } from './services/logger';

const app = express();
app.disable('x-powered-by');

const configuredOrigins = (process.env.CORS_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0);

const allowedOrigins = process.env.NODE_ENV === 'production'
  ? configuredOrigins
  : ['http://localhost:5173', 'http://127.0.0.1:5173', ...configuredOrigins];

if (process.env.NODE_ENV === 'production' && allowedOrigins.length === 0) {
  throw new Error('CORS_ORIGINS must be set in production');
}

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) {
      callback(null, true);
      return;
    }

    if (allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }

    callback(null, false);
  },
  credentials: true,
}));
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));
app.use(express.json({ limit: '1mb' }));
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
  if (origin && !allowedOrigins.includes(origin)) {
    res.status(403).json({ error: '許可されていないオリジンです' });
    return;
  }
  next();
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/account', accountRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/exchange', exchangeRoutes);
app.use('/api/pharmacies', pharmaciesRoutes);
app.use('/api/notifications', notificationsRoutes);

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
