import { Request, Response, NextFunction } from 'express';
import { logger } from '../services/logger';

export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction): void {
  logger.error('Unhandled error', {
    error: err.message,
    stack: err.stack,
    method: req.method,
    path: req.path,
  });
  res.status(500).json({
    error: process.env.NODE_ENV === 'production'
      ? 'サーバーエラーが発生しました'
      : err.message,
  });
}
