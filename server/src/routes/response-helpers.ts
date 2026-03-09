import { Response } from 'express';

export function sendBadRequest(res: Response, error: string): null {
  res.status(400).json({ error });
  return null;
}

export function sendConflict(res: Response, error: string): null {
  res.status(409).json({ error });
  return null;
}
