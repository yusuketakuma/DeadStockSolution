import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { logger } from '../services/logger';
import { recordRequestMetric } from '../services/observability-service';
import { parseBooleanFlag } from '../utils/number-utils';

const REQUEST_LOG_ERRORS_ONLY = parseBooleanFlag(process.env.REQUEST_LOG_ERRORS_ONLY, true);
const REQUEST_METRICS_ENABLED = parseBooleanFlag(process.env.REQUEST_METRICS_ENABLED, true);
const MAX_REQUEST_ID_LENGTH = 128;
const SAFE_REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;

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

function normalizeIncomingRequestId(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }

  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_REQUEST_ID_LENGTH) {
    return '';
  }

  return SAFE_REQUEST_ID_PATTERN.test(trimmed) ? trimmed : '';
}

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const incomingRequestId = normalizeIncomingRequestId(req.headers['x-request-id']);
  const requestId = incomingRequestId || randomUUID();
  (req as Request & { requestId?: string }).requestId = requestId;
  res.setHeader('x-request-id', requestId);

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
        requestId,
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
      requestId,
    });
  });

  next();
}
