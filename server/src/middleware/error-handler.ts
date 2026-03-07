import { Request, Response, NextFunction } from 'express';
import { captureException } from '../config/sentry';
import { getErrorMessage } from '../utils/error-utils';
import { logger } from '../services/logger';
import { recordHttpUnhandledError } from '../services/system-event-service';
import { buildErrorFixContext } from '../services/error-fix-context';
import { handoffErrorToOpenClaw } from '../services/openclaw-error-autofix-service';

export { getErrorMessage } from '../utils/error-utils';

export function handleRouteError(err: unknown, logContext: string, responseMessage: string, res: Response, status = 500): void {
  logger.error(logContext, { error: getErrorMessage(err) });
  res.status(status).json({ error: responseMessage });
}

interface HttpLikeError extends Error {
  status?: number;
  statusCode?: number;
  type?: string;
  code?: string;
}

const ENTITY_PARSE_FAILED = 'entity.parse.failed';

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
  if (status === 400 && err.type === ENTITY_PARSE_FAILED) {
    return 'リクエスト本文の形式が不正です';
  }

  if (status >= 500) {
    return 'サーバーエラーが発生しました';
  }

  return 'リクエストに失敗しました';
}

function resolveLogMessage(err: HttpLikeError, status: number): string {
  if (status === 400 && err.type === ENTITY_PARSE_FAILED) {
    return 'Malformed JSON payload';
  }
  return err.message || 'Request failed';
}

function resolveLogStack(err: HttpLikeError, status: number): string | undefined {
  if (status === 400 && err.type === ENTITY_PARSE_FAILED) {
    return undefined;
  }
  return err.stack;
}

function resolveResponseCode(err: HttpLikeError, status: number): string {
  if (typeof err.code === 'string' && PUBLIC_ERROR_CODES.has(err.code)) {
    return err.code;
  }
  if (status === 400 && err.type === ENTITY_PARSE_FAILED) {
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
  const eventId = captureException(err);
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

  // 5xx の場合のみ OpenClaw 自動修正ハンドオフ（非ブロック）
  if (status >= 500) {
    const fixContext = buildErrorFixContext({
      err,
      method: req.method,
      path: req.path,
      status,
      sentryEventId: eventId,
    });
    void handoffErrorToOpenClaw(fixContext, status);
  }

  res.status(status).json({
    error: resolveResponseMessage(httpErr, status),
    code: resolveResponseCode(httpErr, status),
  });
}
