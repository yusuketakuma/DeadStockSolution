import { Request, Response, NextFunction } from 'express';
import { logger } from '../services/logger';
import { recordRequestMetric } from '../services/observability-service';

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  // Skip health check and static asset logging
  if (req.path === '/api/health') {
    next();
    return;
  }

  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';

    recordRequestMetric({
      timestamp: Date.now(),
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: duration,
    });

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
