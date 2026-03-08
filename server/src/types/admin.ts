// ── 管理者一括操作・監査ログ型定義 ──────────────────────────

import type { AdminAuditAction } from '../db/schema';

/**
 * 薬局ステータス一括変更リクエスト
 */
export interface BulkPharmacyActionRequest {
  pharmacyIds: number[];
  reason?: string;
}

/**
 * 一括操作の個別結果
 */
export interface BulkActionResult {
  pharmacyId: number;
  success: boolean;
  error?: string;
}

/**
 * 一括操作レスポンス
 */
export interface BulkPharmacyActionResponse {
  totalRequested: number;
  succeeded: number;
  failed: number;
  results: BulkActionResult[];
}

/**
 * 監査ログエントリ（APIレスポンス用）
 */
export interface AuditLogEntry {
  id: number;
  adminId: number;
  targetPharmacyId: number;
  action: AdminAuditAction;
  previousStatus: string | null;
  newStatus: string;
  reason: string | null;
  createdAt: string;
}

/**
 * 監査ログ一覧レスポンス
 */
export interface AuditLogListResponse {
  logs: AuditLogEntry[];
  total: number;
  offset: number;
  limit: number;
}
