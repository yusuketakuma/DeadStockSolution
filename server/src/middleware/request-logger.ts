import { Request, Response, NextFunction } from 'express';
import { logger } from '../services/logger';
import { recordRequestMetric } from '../services/observability-service';
import { parseBooleanFlag } from '../utils/number-utils';

const REQUEST_LOG_ERRORS_ONLY = parseBooleanFlag(process.env.REQUEST_LOG_ERRORS_ONLY, true);
const REQUEST_METRICS_ENABLED = parseBooleanFlag(process.env.REQUEST_METRICS_ENABLED, true);

function resolveRequestLogLevel(statusCode: number): 'info' | 'warn' | 'error' | null {
  if (REQUEST_LOG_ERRORS_ONLY && statusCode < 400) {
    return null;
  }

  if (statusCode >= 500) {
    return 'error';
  }
  if (statusCode >= 400) {
    return 'warn';
  }
  return 'info';
}

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  // Skip health check and static asset logging
  if (req.path === '/api/health') {
    next();
    return;
  }

  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    const level = resolveRequestLogLevel(res.statusCode);
    if (REQUEST_METRICS_ENABLED) {
      recordRequestMetric({
        timestamp: Date.now(),
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: duration,
      });
    }

    if (!level) {
      return;
    }

    logger[level]('request', {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  });

  next();
}
