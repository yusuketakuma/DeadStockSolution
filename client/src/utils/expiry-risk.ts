/** サーバー側 expiry-risk-service.ts のバケットロジックをフロント向けに移植 */

export type RiskBucket = 'expired' | 'within30' | 'within60' | 'within90' | 'within120' | 'over120' | 'unknown';

export function parseDateOnly(value: string | null | undefined): Date | null {
  if (!value) return null;
  const normalized = value.replace(/\//g, '-').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;
  const [y, m, d] = normalized.split('-').map(Number);
  const parsed = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(parsed.getTime())) return null;
  // ラウンドトリップ検証: Date が自動補正した場合は不正日付
  if (parsed.getUTCFullYear() !== y || parsed.getUTCMonth() !== m - 1 || parsed.getUTCDate() !== d) return null;
  return parsed;
}

export function daysUntilExpiry(expirationDate: string | null | undefined, today?: Date): number | null {
  const parsed = parseDateOnly(expirationDate);
  if (!parsed) return null;
  const now = today ?? new Date();
  const todayUtc = today ? now : new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(),
  ));
  return Math.floor((parsed.getTime() - todayUtc.getTime()) / (24 * 60 * 60 * 1000));
}

export function resolveBucket(days: number | null): RiskBucket {
  if (days === null) return 'unknown';
  if (days < 0) return 'expired';
  if (days <= 30) return 'within30';
  if (days <= 60) return 'within60';
  if (days <= 90) return 'within90';
  if (days <= 120) return 'within120';
  return 'over120';
}

export function bucketVariant(bucket: RiskBucket): string {
  switch (bucket) {
    case 'expired':
    case 'within30':
      return 'danger';
    case 'within60':
      return 'warning';
    case 'within90':
    case 'within120':
      return 'info';
    case 'over120':
      return 'success';
    case 'unknown':
      return 'secondary';
  }
}

export function formatDaysRemaining(days: number | null): string {
  if (days === null) return '不明';
  if (days < 0) return '期限切れ';
  if (days === 0) return '本日期限';
  return `残り${days}日`;
}
