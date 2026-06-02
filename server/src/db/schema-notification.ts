import { sql } from 'drizzle-orm';
import { pgTable, serial, text, integer, boolean, timestamp, jsonb, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { pharmacies } from './schema-pharmacy';
import { adminMessageTargetTypeEnum, tenants } from './schema-common';

export const adminMessages = pgTable('admin_messages', {
  id: serial('id').primaryKey(),
  senderAdminId: integer('sender_admin_id').notNull().references(() => pharmacies.id),
  targetType: adminMessageTargetTypeEnum('target_type').notNull().default('all'),
  targetPharmacyId: integer('target_pharmacy_id').references(() => pharmacies.id),
  title: text('title').notNull(),
  body: text('body').notNull(),
  actionPath: text('action_path'),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
}, (table) => ({
  idxAdminMessagesTarget: index('idx_admin_messages_target')
    .on(table.targetType, table.targetPharmacyId, table.createdAt),
}));

export const adminMessageReads = pgTable('admin_message_reads', {
  id: serial('id').primaryKey(),
  messageId: integer('message_id').notNull().references(() => adminMessages.id, { onDelete: 'cascade' }),
  pharmacyId: integer('pharmacy_id').notNull().references(() => pharmacies.id, { onDelete: 'cascade' }),
  readAt: timestamp('read_at', { mode: 'string' }).defaultNow(),
}, (table) => ({
  idxAdminMessageReadsUnique: uniqueIndex('idx_admin_message_reads_unique')
    .on(table.messageId, table.pharmacyId),
}));

export const notifications = pgTable('notifications', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  pharmacyId: integer('pharmacy_id').notNull().references(() => pharmacies.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  title: text('title').notNull(),
  message: text('message').notNull(),
  referenceType: text('reference_type'),
  referenceId: integer('reference_id'),
  isRead: boolean('is_read').notNull().default(false),
  readAt: timestamp('read_at', { mode: 'string' }),
  detailJson: jsonb('detail_json'),
  sourcePharmacyId: integer('source_pharmacy_id').references(() => pharmacies.id),
  dedupeKey: text('dedupe_key'),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
}, (table) => ({
  idxNotificationsTenantCreated: index('idx_notifications_tenant_created')
    .on(table.tenantId, table.createdAt),
  idxNotificationsPharmacyUnread: index('idx_notifications_pharmacy_unread')
    .on(table.pharmacyId, table.isRead, table.createdAt),
  idxNotificationsTypeCreated: index('idx_notifications_type_created')
    .on(table.type, table.createdAt.desc()),
  idxNotificationsReferenceLookup: index('idx_notifications_reference_lookup')
    .on(table.referenceType, table.referenceId),
  dedupeKeyIdx: uniqueIndex('notifications_pharmacy_dedupe_key_idx')
    .on(table.pharmacyId, table.dedupeKey)
    .where(sql`dedupe_key IS NOT NULL`),
}));

export const matchNotifications = pgTable('match_notifications', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  pharmacyId: integer('pharmacy_id').notNull().references(() => pharmacies.id, { onDelete: 'cascade' }),
  triggerPharmacyId: integer('trigger_pharmacy_id').references(() => pharmacies.id, { onDelete: 'set null' }),
  triggerUploadType: text('trigger_upload_type'),
  candidateCountBefore: integer('candidate_count_before'),
  candidateCountAfter: integer('candidate_count_after'),
  diffJson: jsonb('diff_json'),
  isRead: boolean('is_read').notNull().default(false),
  dedupeKey: text('dedupe_key').notNull(),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
}, (table) => ({
  idxMatchNotificationsTenantCreated: index('idx_match_notifications_tenant_created')
    .on(table.tenantId, table.createdAt),
  idxMatchNotificationsPharmacy: index('idx_match_notifications_pharmacy').on(table.pharmacyId, table.createdAt),
  uqMatchNotificationsDedupeKey: uniqueIndex('uq_match_notifications_dedupe_key')
    .on(table.pharmacyId, table.dedupeKey),
}));

export const notificationGroupStates = pgTable('notification_group_states', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  pharmacyId: integer('pharmacy_id').notNull().references(() => pharmacies.id, { onDelete: 'cascade' }),
  actionPath: text('action_path').notNull(),
  snoozedUntil: timestamp('snoozed_until', { mode: 'string', withTimezone: true }),
  lastReadAt: timestamp('last_read_at', { mode: 'string', withTimezone: true }),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow(),
}, (table) => ({
  uqNotificationGroupState: uniqueIndex('uq_notification_group_state').on(table.pharmacyId, table.actionPath),
  idxNotificationGroupStateTenant: index('idx_notification_group_state_tenant').on(table.tenantId, table.updatedAt),
  idxNotificationGroupStatePharmacy: index('idx_notification_group_state_pharmacy').on(table.pharmacyId, table.updatedAt),
}));

export const pushSubscriptions = pgTable('push_subscriptions', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  pharmacyId: integer('pharmacy_id').notNull().references(() => pharmacies.id, { onDelete: 'cascade' }),
  endpoint: text('endpoint').notNull(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
  lastUsedAt: timestamp('last_used_at', { mode: 'string' }),
}, (table) => ([
  uniqueIndex('idx_push_subscriptions_unique').on(table.pharmacyId, table.endpoint),
  index('idx_push_subscriptions_tenant').on(table.tenantId),
  index('idx_push_subscriptions_pharmacy').on(table.pharmacyId),
  index('idx_push_subscriptions_created').on(table.createdAt),
]));
