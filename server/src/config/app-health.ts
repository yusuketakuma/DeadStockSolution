import type { Express, RequestHandler } from 'express';
import { db } from './database';
import { sql } from 'drizzle-orm';
import { logger } from '../services/logger';
import { API_PREFIXES } from './app-cors';

const HEALTH_CHECK_DB_TIMEOUT_MS = 5_000;

const healthHandler: RequestHandler = async (_req, res) => {
  const start = Date.now();
  let dbStatus: 'ok' | 'error' = 'ok';
  let dbResponseTime: number;

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

export function setupHealthChecks(app: Express): void {
  for (const prefix of API_PREFIXES) {
    app.get(`${prefix}/health`, healthHandler);
    app.get(`${prefix}/health/ready`, readinessHandler);
  }
}
