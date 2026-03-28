// ── プッシュ通知関連の型定義 ──────────────────────────────────

/**
 * Web Push API の購読ペイロード
 * PushSubscription.toJSON() の形式に準拠
 */
export interface PushSubscriptionPayload {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

/**
 * プッシュ通知ペイロード
 * Service Worker の push イベントで送信される内容
 */
export interface PushNotificationPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  data: {
    url: string;
    type: string;
    referenceId?: string;
    category?: PushNotificationCategory;
    priority?: PushNotificationPriority;
  };
}

export const pushNotificationCategoryValues = [
  'proposals',
  'requests',
  'comments',
  'matching',
  'groups',
  'alerts',
  'admin',
] as const;

export type PushNotificationCategory = (typeof pushNotificationCategoryValues)[number];

export const pushNotificationPriorityValues = ['normal', 'high', 'critical'] as const;
export type PushNotificationPriority = (typeof pushNotificationPriorityValues)[number];

export interface PushNotificationPreferenceCategories {
  proposals: boolean;
  requests: boolean;
  comments: boolean;
  matching: boolean;
  groups: boolean;
  alerts: boolean;
  admin: boolean;
}

export interface PushNotificationPreferences {
  categories: PushNotificationPreferenceCategories;
  allowCritical: boolean;
}

/**
 * プッシュ通知送信結果
 */
export interface PushSendResult {
  sent: number;
  failed: number;
  cleaned: number; // 410 Gone で削除された購読数
}

/**
 * プッシュ購読レコード
 * DB の push_subscriptions テーブルに対応
 */
export interface PushSubscriptionRecord {
  id: number;
  pharmacyId: number;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string | null;
  createdAt: string; // ISO string
  lastUsedAt?: string | null; // ISO string
}
