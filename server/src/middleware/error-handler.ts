import { Request, Response, NextFunction } from 'express';
import { logger } from '../services/logger';

interface HttpLikeError extends Error {
  status?: number;
  statusCode?: number;
  type?: string;
}

function resolveStatusCode(err: HttpLikeError): number {
  const candidates = [err.status, err.statusCode];
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isInteger(candidate) && candidate >= 400 && candidate <= 599) {
      return candidate;
    }
  }
  return 500;
}

function resolveResponseMessage(err: HttpLikeError, status: number): string {
  if (status === 400 && err.type === 'entity.parse.failed') {
    return 'リクエスト本文の形式が不正です';
  }

  if (status >= 500) {
    return process.env.NODE_ENV === 'production'
      ? 'サーバーエラーが発生しました'
      : err.message;
  }

  return err.message || 'リクエストに失敗しました';
}

export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction): void {
  const httpErr = err as HttpLikeError;
  const status = resolveStatusCode(httpErr);
  logger.error('Unhandled error', {
    error: err.message,
    stack: err.stack,
    method: req.method,
    path: req.path,
    status,
  });
  res.status(status).json({
    error: resolveResponseMessage(httpErr, status),
  });
}
