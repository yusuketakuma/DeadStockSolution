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
  return parsed.toLocaleString('ja-JP');
}

export function formatDateJa(
  value: string | null | undefined,
  fallback: string = '-',
): string {
  if (!value) return fallback;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return fallback;
  return parsed.toLocaleDateString('ja-JP');
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

/**
 * 相対時間を日本語で返す
 * 例: 「たった今」「5分前」「2時間前」「昨日」「3日前」
 */
export function formatRelativeTime(timestamp: string): string {
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  if (Number.isNaN(then)) return timestamp;

  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffSec < 60) return 'たった今';
  if (diffMin < 60) return `${diffMin}分前`;
  if (diffHours < 24) return `${diffHours}時間前`;
  if (diffDays === 1) return '昨日';
  return `${diffDays}日前`;
}
