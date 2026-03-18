// 3省2ガイドライン §17: アクセスログを分析し、緊急時にアラートを発する仕組み
// 同一IPからの連続ログイン失敗を追跡し、閾値超過時にアラートを発する

import { logger } from '../services/logger';

const ALERT_THRESHOLD = 5;      // 5回連続失敗でアラート
const WINDOW_MS = 15 * 60 * 1000; // 15分ウィンドウ

interface FailureRecord {
  count: number;
  firstAt: number;
  alertedAt: number | null; // 同一ウィンドウで重複アラートを防ぐ
}

const failures = new Map<string, FailureRecord>();

// 定期的に期限切れエントリを削除（メモリリーク防止）
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of failures) {
    if (now - record.firstAt >= WINDOW_MS) {
      failures.delete(key);
    }
  }
}, 60_000);

/** ログイン失敗を記録し、閾値超過時にアラートを発する */
export function trackLoginFailure(ip: string): void {
  const now = Date.now();
  const existing = failures.get(ip);

  if (!existing || now - existing.firstAt >= WINDOW_MS) {
    failures.delete(ip);
    failures.set(ip, { count: 1, firstAt: now, alertedAt: null });
    return;
  }

  existing.count += 1;

  if (existing.count >= ALERT_THRESHOLD && !existing.alertedAt) {
    existing.alertedAt = now;
    logger.warn('Brute force alert: repeated login failures detected', {
      ip,
      failureCount: existing.count,
      windowMinutes: WINDOW_MS / 60_000,
    });
  }
}

/** ログイン成功時にカウンターをリセット */
export function clearLoginFailures(ip: string): void {
  failures.delete(ip);
}

/** テスト用: 内部カウンターを返す */
export function getFailureCount(ip: string): number {
  return failures.get(ip)?.count ?? 0;
}
