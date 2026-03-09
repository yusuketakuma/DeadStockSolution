// ── プッシュ購読管理サービス ──────────────────────────────
import { and, asc, eq, lt, isNull, or } from 'drizzle-orm';

import { db } from '../config/database';
import { pushSubscriptions } from '../db/schema';
import { logger } from './logger';
import type { PushSubscriptionPayload, PushSubscriptionRecord } from '../types/push';

/** 薬局あたりの最大購読数 */
export const MAX_SUBSCRIPTIONS_PER_PHARMACY = 10;

/** 古い購読と見なす日数（lastUsedAt が null かつ createdAt が閾値以前） */
const STALE_DAYS = 30;

/**
 * DB レコードを PushSubscriptionRecord 型にマッピング
 */
function mapToRecord(row: typeof pushSubscriptions.$inferSelect): PushSubscriptionRecord {
  return {
    id: row.id,
    pharmacyId: row.pharmacyId,
    endpoint: row.endpoint,
    p256dh: row.p256dh,
    auth: row.auth,
    userAgent: row.userAgent,
    createdAt: row.createdAt ?? new Date().toISOString(),
    lastUsedAt: row.lastUsedAt,
  };
}

async function trimSubscriptionsToLimit(pharmacyId: number): Promise<void> {
  const currentSubs = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.pharmacyId, pharmacyId))
    .orderBy(asc(pushSubscriptions.createdAt));

  if (currentSubs.length < MAX_SUBSCRIPTIONS_PER_PHARMACY) {
    return;
  }

  const removeCount = currentSubs.length - MAX_SUBSCRIPTIONS_PER_PHARMACY + 1;
  const toRemove = currentSubs.slice(0, removeCount);
  for (const sub of toRemove) {
    await db
      .delete(pushSubscriptions)
      .where(eq(pushSubscriptions.id, sub.id));
  }
  logger.info('デバイス上限超過のため古い購読を削除しました', {
    pharmacyId,
    removedCount: toRemove.length,
  });
}

/**
 * プッシュ購読を登録（upsert）
 *
 * - 同一 (pharmacyId, endpoint) が既に存在する場合はキーを更新
 * - デバイス上限（MAX_SUBSCRIPTIONS_PER_PHARMACY）を超える場合は最も古い購読を削除
 *
 * @param pharmacyId - 薬局ID
 * @param payload - Web Push 購読ペイロード
 * @param userAgent - User-Agent 文字列（オプション）
 * @returns 登録/更新された購読レコード
 */
export async function subscribe(
  pharmacyId: number,
  payload: PushSubscriptionPayload,
  userAgent?: string,
): Promise<PushSubscriptionRecord> {
  // 1. 既存の同一エンドポイント購読を検索
  const existing = await db
    .select()
    .from(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.pharmacyId, pharmacyId),
        eq(pushSubscriptions.endpoint, payload.endpoint),
      ),
    );

  // 2. 存在する場合は更新（upsert）
  if (existing.length > 0) {
    const [updated] = await db
      .update(pushSubscriptions)
      .set({
        p256dh: payload.keys.p256dh,
        auth: payload.keys.auth,
        userAgent: userAgent ?? existing[0].userAgent,
      })
      .where(eq(pushSubscriptions.id, existing[0].id))
      .returning();

    return mapToRecord(updated);
  }

  // 3. デバイス上限チェック — 超過分は古い順に削除
  await trimSubscriptionsToLimit(pharmacyId);

  // 4. 新規登録
  const [inserted] = await db
    .insert(pushSubscriptions)
    .values({
      pharmacyId,
      endpoint: payload.endpoint,
      p256dh: payload.keys.p256dh,
      auth: payload.keys.auth,
      userAgent: userAgent ?? null,
    })
    .returning();

  return mapToRecord(inserted);
}

/**
 * プッシュ購読を解除
 *
 * @param pharmacyId - 薬局ID
 * @param endpoint - 購読エンドポイントURL
 * @returns 削除成功なら true、存在しなければ false
 */
export async function unsubscribe(
  pharmacyId: number,
  endpoint: string,
): Promise<boolean> {
  const deleted = await db
    .delete(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.pharmacyId, pharmacyId),
        eq(pushSubscriptions.endpoint, endpoint),
      ),
    )
    .returning();

  return deleted.length > 0;
}

/**
 * 薬局の購読一覧を取得
 *
 * @param pharmacyId - 薬局ID
 * @returns 購読レコード配列
 */
export async function listSubscriptions(
  pharmacyId: number,
): Promise<PushSubscriptionRecord[]> {
  const rows = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.pharmacyId, pharmacyId));

  return rows.map(mapToRecord);
}

/**
 * 古い購読を一括削除
 *
 * lastUsedAt が null かつ createdAt が STALE_DAYS 日以前、
 * または lastUsedAt が STALE_DAYS 日以前の購読を削除
 *
 * @returns 削除した件数
 */
export async function cleanupStale(): Promise<number> {
  const threshold = new Date();
  threshold.setDate(threshold.getDate() - STALE_DAYS);
  const thresholdStr = threshold.toISOString();

  const deleted = await db
    .delete(pushSubscriptions)
    .where(
      or(
        and(
          isNull(pushSubscriptions.lastUsedAt),
          lt(pushSubscriptions.createdAt, thresholdStr),
        ),
        lt(pushSubscriptions.lastUsedAt, thresholdStr),
      ),
    )
    .returning();

  if (deleted.length > 0) {
    logger.info('古い購読をクリーンアップしました', {
      cleanedCount: deleted.length,
    });
  }

  return deleted.length;
}
