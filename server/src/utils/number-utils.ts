export function parseBoundedInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;

  const value = Math.floor(parsed);
  if (value < min || value > max) return fallback;
  return value;
}

export function parseBooleanFlag(raw: string | undefined, fallback: boolean): boolean {
  if (typeof raw !== 'string') return fallback;

  const normalized = raw.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return fallback;
}
