import { Request, Response, NextFunction } from 'express';
import { captureException } from '../config/sentry';
import { logger } from '../services/logger';
import { recordHttpUnhandledError } from '../services/system-event-service';

export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export function handleRouteError(err: unknown, logContext: string, responseMessage: string, res: Response): void {
  logger.error(logContext, { error: getErrorMessage(err) });
  res.status(500).json({ error: responseMessage });
}

interface HttpLikeError extends Error {
  status?: number;
  statusCode?: number;
  type?: string;
  code?: string;
}

const PUBLIC_ERROR_CODES = new Set<string>([
  'UPLOAD_CONFIRM_QUEUE_LIMIT',
]);

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
    return 'サーバーエラーが発生しました';
  }

  return 'リクエストに失敗しました';
}

function resolveLogMessage(err: HttpLikeError, status: number): string {
  if (status === 400 && err.type === 'entity.parse.failed') {
    return 'Malformed JSON payload';
  }
  return err.message || 'Request failed';
}

function resolveLogStack(err: HttpLikeError, status: number): string | undefined {
  if (status === 400 && err.type === 'entity.parse.failed') {
    return undefined;
  }
  return err.stack;
}

function resolveResponseCode(err: HttpLikeError, status: number): string {
  if (typeof err.code === 'string' && PUBLIC_ERROR_CODES.has(err.code)) {
    return err.code;
  }
  if (status === 400 && err.type === 'entity.parse.failed') {
    return 'BAD_JSON_PAYLOAD';
  }
  if (status >= 500) {
    return 'INTERNAL_SERVER_ERROR';
  }
  return `HTTP_${status}`;
}

export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction): void {
  const httpErr = err as HttpLikeError;
  const status = resolveStatusCode(httpErr);
  const requestId = (req as Request & { requestId?: string }).requestId
    ?? (typeof req.headers['x-request-id'] === 'string' ? req.headers['x-request-id'] : undefined);
  captureException(err);
  logger.error('Unhandled error', {
    error: resolveLogMessage(httpErr, status),
    stack: resolveLogStack(httpErr, status),
    method: req.method,
    path: req.path,
    status,
    requestId,
  });
  void recordHttpUnhandledError({
    method: req.method,
    path: req.path,
    status,
    requestId,
    errorCode: typeof httpErr.code === 'string' ? httpErr.code : undefined,
  });
  res.status(status).json({
    error: resolveResponseMessage(httpErr, status),
    code: resolveResponseCode(httpErr, status),
  });
}
