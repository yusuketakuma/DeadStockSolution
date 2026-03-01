export function encodeCursor<T extends object>(payload: T): string {
  return Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64url');
}

export function decodeCursor<T extends object>(raw: unknown): T | null {
  if (typeof raw !== 'string' || raw.trim().length === 0) return null;
  try {
    const decoded = Buffer.from(raw, 'base64url').toString('utf-8');
    const parsed = JSON.parse(decoded);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as T;
  } catch {
    return null;
  }
}
