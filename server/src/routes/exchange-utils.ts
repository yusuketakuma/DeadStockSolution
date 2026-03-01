import { Response } from 'express';
import { parsePositiveInt } from '../utils/request-utils';

export function parseExchangeIdOrBadRequest(
  res: Response,
  rawId: string | string[] | undefined,
): number | null {
  const id = parsePositiveInt(typeof rawId === 'string' ? rawId : undefined);
  if (!id) {
    res.status(400).json({ error: '不正なIDです' });
    return null;
  }
  return id;
}
