import { Response } from 'express';
import { AuthRequest } from '../types';
import { parsePagination, parsePositiveInt } from '../utils/request-utils';
import { logger } from '../services/logger';
import { getErrorMessage } from '../middleware/error-handler';

export function sendPaginated<T>(
  res: Response,
  data: T[],
  page: number,
  limit: number,
  total: number,
  extra: Record<string, unknown> = {},
): void {
  res.json({
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
    ...extra,
  });
}

export function parseListPagination(req: AuthRequest, defaultLimit: number = 20): { page: number; limit: number; offset: number } {
  return parsePagination(req.query.page, req.query.limit, {
    defaultLimit,
    maxLimit: 100,
  });
}

export function parseIdOrBadRequest(res: Response, rawId: string | string[] | undefined): number | null {
  const id = parsePositiveInt(typeof rawId === 'string' ? rawId : undefined);
  if (!id) {
    res.status(400).json({ error: '不正なIDです' });
    return null;
  }
  return id;
}

export { getErrorMessage } from '../middleware/error-handler';

export function handleAdminError(err: unknown, logContext: string, responseMessage: string, res: Response): void {
  logger.error(logContext, { error: getErrorMessage(err) });
  res.status(500).json({ error: responseMessage });
}
