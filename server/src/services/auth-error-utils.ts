import { Response } from 'express';
import { isJwtSecretMissingError } from '../services/auth-service';
import { getErrorMessage } from '../middleware/error-handler';
import { logger } from '../services/logger';

function readErrorLikeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readErrorString(err: unknown, key: 'code' | 'constraint' | 'message'): string {
  if (!err || typeof err !== 'object') {
    return '';
  }
  return String((err as Record<string, unknown>)[key] ?? '');
}

function findErrorChainMatch(
  err: unknown,
  matcher: (message: string) => boolean,
): boolean {
  if (!err || typeof err !== 'object') {
    return false;
  }

  if (matcher(readErrorString(err, 'message').toLowerCase())) {
    return true;
  }

  return findErrorChainMatch((err as { cause?: unknown }).cause, matcher);
}

export function handleAuthConfigurationError(context: string, err: unknown, res: Response): boolean {
  if (!isJwtSecretMissingError(err)) {
    return false;
  }

  logger.error(`${context} configuration error`, {
    error: (err as { message?: unknown }).message,
  });
  res.status(503).json({ error: '認証設定が未完了です。管理者に連絡してください' });
  return true;
}

export function isDependencyServiceUnavailableError(err: unknown): boolean {
  const code = extractErrorCode(err)?.toUpperCase() ?? '';
  if (code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'ENOTFOUND' || code === 'ETIMEDOUT') {
    return true;
  }

  return findErrorChainMatch(err, (message) => {
    const normalized = message.toLowerCase();
    return normalized.includes('connection refused')
      || normalized.includes('connection lost')
      || normalized.includes('connection error')
      || normalized.includes('database connection failed')
      || normalized.includes('db connection failed')
      || normalized.includes('db connection lost')
      || normalized.includes('db unavailable')
      || normalized.includes('service unavailable')
      || normalized.includes('timeout')
      || normalized.includes('fetch failed')
      || normalized.includes('socket hang up')
      || normalized.includes('postgres url is not configured');
  });
}

export function handleDependencyServiceUnavailable(
  context: string,
  err: unknown,
  res: Response,
  message: string,
): boolean {
  if (!isDependencyServiceUnavailableError(err)) {
    return false;
  }

  logger.error(`${context} dependency unavailable`, {
    error: readErrorLikeString((err as { message?: unknown })?.message) || getErrorMessage(err),
  });
  res.status(503).json({ error: message });
  return true;
}

export function extractUniqueViolationConstraint(err: unknown): string | null {
  if (!err || typeof err !== 'object') return null;

  const code = readErrorString(err, 'code');
  if (code !== '23505') return null;

  const constraint = readErrorString(err, 'constraint').toLowerCase();
  if (constraint) return constraint;

  const message = readErrorString(err, 'message');
  const matched = message.match(/unique constraint "([^"]+)"/i);
  return matched?.[1]?.toLowerCase() ?? '';
}

export function extractErrorCode(err: unknown): string | null {
  if (!err || typeof err !== 'object') return null;
  const code = (err as { code?: unknown }).code;
  if (typeof code === 'string' && code.trim().length > 0) {
    return code;
  }
  return extractErrorCode((err as { cause?: unknown }).cause);
}

export function includesIsTestAccountToken(err: unknown): boolean {
  return findErrorChainMatch(
    err,
    (message) => message.includes('is_test_account') || message.includes('test_account_password'),
  );
}

export function isMissingTestPharmacyColumnError(err: unknown): boolean {
  return extractErrorCode(err) === '42703' || includesIsTestAccountToken(err);
}
