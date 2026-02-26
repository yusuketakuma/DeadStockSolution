function hasControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7F) return true;
  }
  return false;
}

function sanitizeInternalPathInternal(path: string | null | undefined): string | null {
  if (typeof path !== 'string') return null;
  const normalizedPath = path.trim();
  if (!normalizedPath) return null;
  if (!normalizedPath.startsWith('/')) return null;
  if (normalizedPath.startsWith('//')) return null;
  if (normalizedPath.startsWith('/\\')) return null;
  if (hasControlChars(normalizedPath)) return null;
  return normalizedPath;
}

export function sanitizeInternalPath(path: string | null | undefined, fallback: string): string {
  if (fallback === '') return sanitizeInternalPathInternal(path) ?? '';
  const normalizedFallback = sanitizeInternalPathInternal(fallback);
  if (normalizedFallback) return sanitizeInternalPathInternal(path) ?? normalizedFallback;
  return sanitizeInternalPathInternal(path) ?? '/';
}
