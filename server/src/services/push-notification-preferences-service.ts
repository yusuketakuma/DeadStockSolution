import { eq } from 'drizzle-orm';
import { db } from '../config/database';
import { pushNotificationPreferences } from '../db/schema';
import type {
  PushNotificationCategory,
  PushNotificationPreferenceCategories,
  PushNotificationPreferences,
} from '../types/push';
import { pushNotificationCategoryValues } from '../types/push';

export const DEFAULT_PUSH_NOTIFICATION_CATEGORIES: PushNotificationPreferenceCategories = {
  proposals: true,
  requests: true,
  comments: true,
  matching: true,
  groups: true,
  alerts: true,
  admin: true,
};

export const DEFAULT_PUSH_NOTIFICATION_PREFERENCES: PushNotificationPreferences = {
  categories: DEFAULT_PUSH_NOTIFICATION_CATEGORIES,
  allowCritical: true,
};

const VALID_PUSH_NOTIFICATION_CATEGORIES = new Set<string>(pushNotificationCategoryValues);

function normalizeCategories(raw: unknown): PushNotificationPreferenceCategories {
  const source = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  return {
    proposals: source.proposals !== false,
    requests: source.requests !== false,
    comments: source.comments !== false,
    matching: source.matching !== false,
    groups: source.groups !== false,
    alerts: source.alerts !== false,
    admin: source.admin !== false,
  };
}

function assertValidCategoryInput(
  categories: unknown,
): asserts categories is Partial<Record<PushNotificationCategory, boolean>> | undefined {
  if (categories == null) {
    return;
  }

  if (typeof categories !== 'object' || Array.isArray(categories)) {
    throw new Error('Push notification categories must be an object');
  }

  for (const [key, value] of Object.entries(categories as Record<string, unknown>)) {
    if (!VALID_PUSH_NOTIFICATION_CATEGORIES.has(key)) {
      throw new Error(`Invalid push notification category: ${key}`);
    }
    if (value !== undefined && typeof value !== 'boolean') {
      throw new Error(`Push notification category "${key}" must be a boolean`);
    }
  }
}

export async function getPushNotificationPreferences(
  pharmacyId: number,
): Promise<PushNotificationPreferences> {
  const [row] = await db.select()
    .from(pushNotificationPreferences)
    .where(eq(pushNotificationPreferences.pharmacyId, pharmacyId))
    .limit(1);

  if (!row) {
    return DEFAULT_PUSH_NOTIFICATION_PREFERENCES;
  }

  return {
    categories: normalizeCategories(row.categoriesJson),
    allowCritical: row.allowCritical ?? true,
  };
}

export async function upsertPushNotificationPreferences(
  pharmacyId: number,
  input: {
    categories?: Partial<PushNotificationPreferenceCategories>;
    allowCritical?: boolean;
  },
): Promise<PushNotificationPreferences> {
  assertValidCategoryInput(input.categories);

  const current = await getPushNotificationPreferences(pharmacyId);
  const next: PushNotificationPreferences = {
    categories: {
      ...current.categories,
      ...(input.categories ?? {}),
    },
    allowCritical: input.allowCritical ?? current.allowCritical,
  };

  const existing = await db.select({ id: pushNotificationPreferences.id })
    .from(pushNotificationPreferences)
    .where(eq(pushNotificationPreferences.pharmacyId, pharmacyId))
    .limit(1);

  if (existing.length > 0) {
    await db.update(pushNotificationPreferences)
      .set({
        categoriesJson: next.categories,
        allowCritical: next.allowCritical,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(pushNotificationPreferences.pharmacyId, pharmacyId));
  } else {
    await db.insert(pushNotificationPreferences).values({
      pharmacyId,
      categoriesJson: next.categories,
      allowCritical: next.allowCritical,
    });
  }

  return next;
}
