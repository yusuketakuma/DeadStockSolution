export function normalizeString(str: string): string {
  // NFKC normalization (full-width to half-width, etc.)
  let normalized = str.normalize('NFKC');
  // Remove whitespace
  normalized = normalized.replace(/\s+/g, '');
  // Remove parentheses and their content variations
  normalized = normalized.replace(/[（()）\[\]【】]/g, '');
  return normalized.toLowerCase();
}

export function normalizeDrugName(name: string): string {
  let normalized = name.normalize('NFKC');
  // Remove common suffixes and patterns
  normalized = normalized.replace(/\s+/g, '');
  // Keep basic structure for matching
  return normalized;
}

export function toHalfWidth(str: string): string {
  return str.replace(/[Ａ-Ｚａ-ｚ０-９]/g, (s) => {
    return String.fromCharCode(s.charCodeAt(0) - 0xFEE0);
  });
}

export function parseNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    const maybeAsciiNumber = trimmed.replace(/,/g, '');
    const quick = Number(maybeAsciiNumber);
    if (Number.isFinite(quick)) return quick;
  }

  const str = String(value).normalize('NFKC').replace(/,/g, '').trim();
  const num = parseFloat(str);
  return isNaN(num) ? null : num;
}
