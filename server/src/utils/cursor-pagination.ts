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

/**
 * Parse and validate a cursor query parameter.
 * Returns `undefined` if absent, `null` if invalid, or a validated cursor object.
 *
 * @param raw - The raw query parameter value
 * @param validate - A function that returns true if the decoded cursor has valid fields
 */
export function parseCursor<T extends { id: number }>(
  raw: unknown,
  validate: (cursor: T) => boolean,
): T | null | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string' || raw.trim().length === 0) return null;
  const cursor = decodeCursor<T>(raw);
  if (!cursor) return null;
  if (typeof cursor.id !== 'number' || !Number.isInteger(cursor.id) || cursor.id <= 0) return null;
  if (!validate(cursor)) return null;
  return cursor;
}
