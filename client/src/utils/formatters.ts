export function formatNumberJa(
  value: number | null | undefined,
  fallback: string = '-',
): string {
  if (value === null || value === undefined || Number.isNaN(value)) return fallback;
  return value.toLocaleString('ja-JP');
}

export function formatCountJa(
  value: number | null | undefined,
  suffix: string = '件',
  fallback: string = '-',
): string {
  const formatted = formatNumberJa(value, fallback);
  return formatted === fallback ? fallback : `${formatted}${suffix}`;
}

export function formatYen(value: number | null | undefined): string {
  return value === null || value === undefined ? '-' : `${formatNumberJa(value)}円`;
}

export function formatDateTimeJa(
  value: string | null | undefined,
  fallback: string = '-',
): string {
  if (!value) return fallback;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return fallback;
  return parsed.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
}

export function formatDateJa(
  value: string | null | undefined,
  fallback: string = '-',
): string {
  if (!value) return fallback;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return fallback;
  return parsed.toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' });
}

/**
 * 値をプレビュー用に切り詰める（ログ詳細・更新本文などで共用）
 */
export function truncatePreview(value: unknown, maxLength = 180, fallback = '-'): string {
  if (value === null || value === undefined) return fallback;
  const str = typeof value === 'string' ? value : JSON.stringify(value);
  const normalized = str.replace(/\s+/g, ' ').trim();
  if (!normalized) return fallback;
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength)}...`;
}
