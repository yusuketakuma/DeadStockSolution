import webpush from 'web-push';
import { eq } from 'drizzle-orm';

import { db } from '../config/database';
import { pushSubscriptions } from '../db/schema';
import { logger } from './logger';
import { getPushNotificationPreferences } from './push-notification-preferences-service';
import type {
  PushNotificationCategory,
  PushNotificationPayload,
  PushNotificationPriority,
  PushSendResult,
} from '../types/push';

function getVapidConfig(): { publicKey: string; privateKey: string; subject: string } | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;

  if (!publicKey || !privateKey || !subject) {
    return null;
  }

  return { publicKey, privateKey, subject };
}

/** 期限切れ購読として扱うステータスコード */
function isExpiredSubscriptionError(error: unknown): boolean {
  const statusCode = (error as { statusCode?: number }).statusCode;
  return statusCode === 410 || statusCode === 404;
}

function toWebPushSubscription(sub: typeof pushSubscriptions.$inferSelect) {
  return {
    endpoint: sub.endpoint,
    keys: {
      p256dh: sub.p256dh,
      auth: sub.auth,
    },
  };
}

function resolvePayloadCategory(payload: PushNotificationPayload): PushNotificationCategory | null {
  if (payload.data.category) {
    return payload.data.category;
  }

  switch (payload.data.type) {
    case 'proposal_received':
    case 'proposal_status_changed':
      return 'proposals';
    case 'request_update':
      return 'requests';
    case 'new_comment':
      return 'comments';
    case 'match_update':
    case 'matching_refresh_complete':
      return 'matching';
    case 'group_invitation':
    case 'group_joined':
    case 'group_left':
      return 'groups';
    case 'alert_near_expiry':
    case 'alert_excess_stock':
    case 'alert_resolved':
      return 'alerts';
    case 'admin_message':
      return 'admin';
    default:
      return null;
  }
}

function resolvePayloadPriority(payload: PushNotificationPayload): PushNotificationPriority {
  if (payload.data.priority) {
    return payload.data.priority;
  }

  if ([
    'proposal_received',
    'proposal_status_changed',
    'request_update',
    'new_comment',
    'group_invitation',
    'alert_near_expiry',
    'alert_excess_stock',
  ].includes(payload.data.type)) {
    return 'high';
  }

  return 'normal';
}

async function touchSentSubscriptions(subscriptionIds: number[]): Promise<void> {
  await Promise.allSettled(
    subscriptionIds.map((subId) =>
      db
        .update(pushSubscriptions)
        .set({ lastUsedAt: new Date().toISOString() })
        .where(eq(pushSubscriptions.id, subId)),
    ),
  );
}

/**
 * 薬局IDに紐づく全購読へプッシュ通知を送信
 *
 * @param pharmacyId - 送信先薬局ID
 * @param payload - 通知ペイロード
 * @returns PushSendResult - 送信結果 { sent, failed, cleaned }
 */
export async function sendToPharmacy(
  pharmacyId: number,
  payload: PushNotificationPayload,
): Promise<PushSendResult> {
  const result: PushSendResult = { sent: 0, failed: 0, cleaned: 0 };

  const vapid = getVapidConfig();
  if (!vapid) {
    logger.warn('VAPID環境変数が未設定のためプッシュ通知をスキップします', {
      pharmacyId,
    });
    return result;
  }

  const category = resolvePayloadCategory(payload);
  const priority = resolvePayloadPriority(payload);

  if (category) {
    const preferences = await getPushNotificationPreferences(pharmacyId);
    const categoryEnabled = preferences.categories[category];
    const allowByCriticalOverride = preferences.allowCritical && (priority === 'high' || priority === 'critical');
    if (!categoryEnabled && !allowByCriticalOverride) {
      return result;
    }
  }

  webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);

  const subscriptions = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.pharmacyId, pharmacyId));

  if (subscriptions.length === 0) {
    return result;
  }

  const payloadString = JSON.stringify(payload);

  const results = await Promise.allSettled(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(toWebPushSubscription(sub), payloadString);
        return { status: 'sent' as const, subId: sub.id };
      } catch (error) {
        if (isExpiredSubscriptionError(error)) {
          await db
            .delete(pushSubscriptions)
            .where(eq(pushSubscriptions.id, sub.id));
          return { status: 'cleaned' as const, subId: sub.id };
        }
        logger.warn('プッシュ通知送信エラー', {
          pharmacyId,
          subscriptionId: sub.id,
          endpoint: sub.endpoint,
          error: error instanceof Error ? error.message : String(error),
        });
        return { status: 'failed' as const, subId: sub.id };
      }
    }),
  );

  for (const r of results) {
    if (r.status === 'fulfilled') {
      result[r.value.status]++;
    } else {
      result.failed++;
    }
  }

  if (result.sent > 0) {
    const sentSubIds = results
      .filter(
        (r): r is PromiseFulfilledResult<{ status: 'sent'; subId: number }> =>
          r.status === 'fulfilled' && r.value.status === 'sent',
      )
      .map((r) => r.value.subId);

    await touchSentSubscriptions(sentSubIds);
  }

  return result;
}

/**
 * 複数薬局へプッシュ通知を一括送信
 *
 * 薬局ごとにバッチ処理（単一の巨大 Promise.all を避ける）
 *
 * @param pharmacyIds - 送信先薬局ID配列
 * @param payload - 通知ペイロード
 * @returns PushSendResult - 集約結果
 */
export async function sendToMultiple(
  pharmacyIds: number[],
  payload: PushNotificationPayload,
): Promise<PushSendResult> {
  const aggregate: PushSendResult = { sent: 0, failed: 0, cleaned: 0 };

  if (pharmacyIds.length === 0) {
    return aggregate;
  }

  const vapid = getVapidConfig();
  if (!vapid) {
    logger.warn('VAPID環境変数が未設定のためプッシュ通知をスキップします', {
      pharmacyIds,
    });
    return aggregate;
  }

  for (const pharmacyId of [...new Set(pharmacyIds)]) {
    const result = await sendToPharmacy(pharmacyId, payload);
    aggregate.sent += result.sent;
    aggregate.failed += result.failed;
    aggregate.cleaned += result.cleaned;
  }

  return aggregate;
}
