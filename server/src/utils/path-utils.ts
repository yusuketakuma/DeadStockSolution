export function isSafeInternalPath(value: string): boolean {
  if (!value || value.length > 200) return false;
  if (!value.startsWith('/')) return false;
  if (value.startsWith('//')) return false;
  if (/\.\./.test(value)) return false;
  if (/[^\x20-\x7E]/.test(value)) return false;
  return true;
}

export function sanitizeInternalPath(value: string | null | undefined): string | null {
  if (!value) return null;
  return isSafeInternalPath(value) ? value : null;
}
