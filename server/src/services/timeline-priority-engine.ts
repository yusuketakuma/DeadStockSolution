/**
 * タイムラインイベントの優先度判定エンジン
 *
 * Pure Function のみ。DB アクセス・外部 API 呼び出し禁止。
 */

import type { RawTimelineEvent, TimelinePriority } from '../types/timeline';

/**
 * ルールベースでイベントの優先度を判定する。
 *
 * 優先度（高い順）:
 *   critical > high > medium > low
 *
 * @param event - 優先度を判定する生のタイムラインイベント
 * @param now   - 現在時刻（省略時は new Date()）。テストで固定時刻を注入する用途に使用。
 * @returns 判定された優先度
 */
export function assignPriority(event: RawTimelineEvent, now: Date = new Date()): TimelinePriority {
  // ────────────────────────────────────────────────────────────
  // Critical
  // ────────────────────────────────────────────────────────────

  // confirmed 提案の取引完了待ち
  if (
    event.source === 'proposal' &&
    event.type === 'proposal_confirmed' &&
    (event.metadata?.completedAt === null || event.metadata?.completedAt === undefined)
  ) {
    return 'critical';
  }

  // 期限切れ3日以内のデッドストック
  if (event.source === 'expiry_risk') {
    return 'critical';
  }

  // ────────────────────────────────────────────────────────────
  // High
  // ────────────────────────────────────────────────────────────

  // 未返信コメント 24h 以上
  if (event.source === 'comment' && !event.isRead) {
    const eventTime = new Date(event.timestamp).getTime();
    const diffMs = now.getTime() - eventTime;
    const twentyFourHoursMs = 24 * 60 * 60 * 1000;
    if (diffMs >= twentyFourHoursMs) {
      return 'high';
    }
  }

  // 受信提案の承認/拒否待ち
  if (
    event.source === 'proposal' &&
    event.type === 'proposal_proposed' &&
    (
      event.metadata?.isRequester === false ||
      event.metadata?.isInbound === true
    )
  ) {
    return 'high';
  }

  // 新規マッチング候補
  if (event.source === 'match' && !event.isRead) {
    return 'high';
  }

  // ────────────────────────────────────────────────────────────
  // Medium
  // ────────────────────────────────────────────────────────────

  // 提案ステータス変更通知
  if (event.source === 'notification' && event.type === 'proposal_status_changed') {
    return 'medium';
  }

  // 新規コメント受信通知
  if (event.source === 'notification' && event.type === 'new_comment') {
    return 'medium';
  }

  // 在庫アップロード完了
  if (event.source === 'upload') {
    return 'medium';
  }

  // ────────────────────────────────────────────────────────────
  // Low（デフォルト）
  // ────────────────────────────────────────────────────────────

  // 管理者メッセージ、取引完了履歴、その他すべて
  return 'low';
}
