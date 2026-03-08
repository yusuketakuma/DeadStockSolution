// ── 監査ログサービス ──────────────────────────────────────
// 管理者操作の監査ログを記録・取得する不変（immutable）サービス。
// 削除・更新機能は実装しない。

import { desc, eq, and, sql } from 'drizzle-orm';
import { db } from '../config/database';
import { adminAuditLogs, type AdminAuditAction } from '../db/schema';
import type { AuditLogEntry, AuditLogListResponse } from '../types/admin';
import { logger } from './logger';

// ── 記録 ──────────────────────────────────────────────────

export interface RecordAuditLogInput {
  adminId: number;
  targetPharmacyId: number;
  action: AdminAuditAction;
  previousStatus: string | null;
  newStatus: string;
  reason?: string | null;
}

export async function recordAuditLog(input: RecordAuditLogInput): Promise<AuditLogEntry> {
  const [row] = await db.insert(adminAuditLogs).values({
    adminId: input.adminId,
    targetPharmacyId: input.targetPharmacyId,
    action: input.action,
    previousStatus: input.previousStatus,
    newStatus: input.newStatus,
    reason: input.reason ?? null,
  }).returning();

  if (!row) {
    throw new Error('監査ログの記録に失敗しました');
  }

  return toAuditLogEntry(row);
}

// ── 取得 ──────────────────────────────────────────────────

export interface ListAuditLogsInput {
  offset?: number;
  limit?: number;
  adminId?: number;
  targetPharmacyId?: number;
  action?: AdminAuditAction;
}

export async function listAuditLogs(input: ListAuditLogsInput = {}): Promise<AuditLogListResponse> {
  const queryLimit = Math.min(Math.max(input.limit ?? 20, 1), 100);
  const queryOffset = Math.max(input.offset ?? 0, 0);

  const conditions = buildFilterConditions(input);

  try {
    const rows = await db.select()
      .from(adminAuditLogs)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(adminAuditLogs.createdAt), desc(adminAuditLogs.id))
      .limit(queryLimit)
      .offset(queryOffset);

    const [countResult] = await db.select({ count: sql<number>`count(*)::int` })
      .from(adminAuditLogs)
      .where(conditions.length > 0 ? and(...conditions) : undefined);

    return {
      logs: rows.map(toAuditLogEntry),
      total: countResult?.count ?? 0,
      offset: queryOffset,
      limit: queryLimit,
    };
  } catch (err) {
    logger.error('監査ログの取得に失敗しました', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

// ── ヘルパー ──────────────────────────────────────────────

function toAuditLogEntry(row: typeof adminAuditLogs.$inferSelect): AuditLogEntry {
  return {
    id: row.id,
    adminId: row.adminId,
    targetPharmacyId: row.targetPharmacyId,
    action: row.action,
    previousStatus: row.previousStatus,
    newStatus: row.newStatus,
    reason: row.reason,
    createdAt: row.createdAt,
  };
}

function buildFilterConditions(input: ListAuditLogsInput) {
  const conditions = [];

  if (input.adminId !== undefined) {
    conditions.push(eq(adminAuditLogs.adminId, input.adminId));
  }
  if (input.targetPharmacyId !== undefined) {
    conditions.push(eq(adminAuditLogs.targetPharmacyId, input.targetPharmacyId));
  }
  if (input.action !== undefined) {
    conditions.push(eq(adminAuditLogs.action, input.action));
  }

  return conditions;
}
