// ── アラート関連の型定義 ──────────────────────────────────

import type { PredictiveAlertType } from '../db/schema';

/**
 * アラート項目
 * DB の predictive_alerts テーブルに対応
 */
export interface AlertItem {
  id: number;
  pharmacyId: number;
  alertType: PredictiveAlertType;
  title: string;
  message: string;
  detailJson: Record<string, unknown>;
  detectedAt: string; // ISO string
  resolvedAt: string | null; // ISO string, null if unresolved
  notificationId?: number | null;
}

/**
 * アラート一覧レスポンス
 */
export interface AlertListResponse {
  alerts: AlertItem[];
  total: number;
  offset: number;
  limit: number;
  unresolvedCount: number;
}

/**
 * アラート詳細レスポンス
 * 基本的には AlertItem と同じだが、API レスポンスとして拡張可能
 */
export type AlertDetailResponse = AlertItem;

/**
 * アラート解決リクエスト
 */
export interface AlertResolveRequest {
  resolvedAt?: string; // ISO string, optional — defaults to now
}

/**
 * アラート統計情報
 */
export interface AlertStats {
  unresolvedCount: number;
  byType: Record<string, number>;
}
