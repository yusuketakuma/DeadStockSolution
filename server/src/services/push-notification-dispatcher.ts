import type { NotificationReferenceType, NotificationType } from '../db/schema';
import type {
  PushNotificationCategory,
  PushNotificationPayload,
  PushNotificationPriority,
} from '../types/push';
import { logger } from './logger';
import { sendToMultiple, sendToPharmacy } from './push-dispatch-service';

interface DispatchNotificationPushInput {
  pharmacyId: number;
  type: NotificationType;
  title: string;
  message: string;
  referenceType?: NotificationReferenceType;
  referenceId?: number;
}

interface DispatchCustomPushInput {
  pharmacyId: number;
  title: string;
  message: string;
  url: string;
  type: string;
  category: PushNotificationCategory;
  priority?: PushNotificationPriority;
  referenceId?: number | string;
}

interface DispatchCustomPushToManyInput {
  pharmacyIds: number[];
  title: string;
  message: string;
  url: string;
  type: string;
  category: PushNotificationCategory;
  priority?: PushNotificationPriority;
  referenceId?: number | string;
}

function resolveActionUrl(referenceType: NotificationReferenceType | undefined, referenceId: number | undefined): string {
  if ((referenceType === 'proposal' || referenceType === 'comment') && referenceId) {
    return `/proposals/${referenceId}`;
  }
  if (referenceType === 'match') {
    return '/matching';
  }
  if (referenceType === 'request') {
    return '/requests';
  }
  return '/';
}

function resolveCategory(
  type: NotificationType,
  referenceType: NotificationReferenceType | undefined,
): PushNotificationCategory | null {
  switch (type) {
    case 'proposal_received':
      return 'proposals';
    case 'proposal_status_changed':
      if (referenceType === 'match') return 'matching';
      return 'proposals';
    case 'request_update':
      return 'requests';
    case 'new_comment':
      return 'comments';
    case 'alert_near_expiry':
    case 'alert_excess_stock':
    case 'alert_resolved':
      return 'alerts';
    case 'matching_refresh_complete':
    case 'match_update':
      return 'matching';
    default:
      return null;
  }
}

function resolvePriority(type: NotificationType, title: string): PushNotificationPriority {
  if (type === 'matching_refresh_complete' && title.includes('失敗')) {
    return 'critical';
  }
  if ([
    'proposal_received',
    'proposal_status_changed',
    'request_update',
    'new_comment',
    'alert_near_expiry',
    'alert_excess_stock',
  ].includes(type)) {
    return 'high';
  }
  return 'normal';
}

function buildCustomPayload(input: Omit<DispatchCustomPushInput, 'pharmacyId'>): PushNotificationPayload {
  return {
    title: input.title,
    body: input.message,
    data: {
      url: input.url,
      type: input.type,
      referenceId: input.referenceId != null ? String(input.referenceId) : undefined,
      category: input.category,
      priority: input.priority ?? 'normal',
    },
  };
}

export async function dispatchNotificationPush(input: DispatchNotificationPushInput): Promise<void> {
  if (input.type === 'group_invitation') {
    return;
  }

  const category = resolveCategory(input.type, input.referenceType);
  if (!category) {
    return;
  }

  const payload: PushNotificationPayload = {
    title: input.title,
    body: input.message,
    data: {
      url: resolveActionUrl(input.referenceType, input.referenceId),
      type: input.type,
      referenceId: input.referenceId ? String(input.referenceId) : undefined,
      category,
      priority: resolvePriority(input.type, input.title),
    },
  };

  try {
    await sendToPharmacy(input.pharmacyId, payload);
  } catch (error) {
    logger.warn('Notification push dispatch failed', {
      pharmacyId: input.pharmacyId,
      notificationType: input.type,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function dispatchCustomPush(input: DispatchCustomPushInput): Promise<void> {
  try {
    await sendToPharmacy(input.pharmacyId, buildCustomPayload(input));
  } catch (error) {
    logger.warn('Custom push dispatch failed', {
      pharmacyId: input.pharmacyId,
      pushType: input.type,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function dispatchCustomPushToMany(input: DispatchCustomPushToManyInput): Promise<void> {
  if (input.pharmacyIds.length === 0) {
    return;
  }

  try {
    await sendToMultiple(input.pharmacyIds, buildCustomPayload(input));
  } catch (error) {
    logger.warn('Custom bulk push dispatch failed', {
      pharmacyCount: input.pharmacyIds.length,
      pushType: input.type,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
