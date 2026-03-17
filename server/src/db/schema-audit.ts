import { sql } from 'drizzle-orm';
import { pgTable, serial, text, integer, varchar, boolean, timestamp, index, check } from 'drizzle-orm/pg-core';
import { pharmacies } from './schema-pharmacy';
import {
  adminAuditActionValues,
  errorCodeCategoryValues,
  errorCodeSeverityValues,
  systemEventLevelValues,
  systemEventSourceValues,
} from './schema-common';

export const adminAuditLogs = pgTable('admin_audit_logs', {
  id: serial('id').primaryKey(),
  adminId: integer('admin_id').notNull().references(() => pharmacies.id),
  targetPharmacyId: integer('target_pharmacy_id').notNull().references(() => pharmacies.id),
  action: text('action').$type<(typeof adminAuditActionValues)[number]>().notNull(),
  previousStatus: text('previous_status'),
  newStatus: text('new_status').notNull(),
  reason: text('reason'),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
}, (table) => ({
  idxAdminAuditLogsAdminCreated: index('idx_admin_audit_logs_admin_created')
    .on(table.adminId, table.createdAt),
  idxAdminAuditLogsTargetCreated: index('idx_admin_audit_logs_target_created')
    .on(table.targetPharmacyId, table.createdAt),
  idxAdminAuditLogsActionCreated: index('idx_admin_audit_logs_action_created')
    .on(table.action, table.createdAt),
  chkAdminAuditAction: check('chk_admin_audit_action', sql`${table.action} IN ('verify', 'reject', 're-review')`),
}));

export const activityLogs = pgTable('activity_logs', {
  id: serial('id').primaryKey(),
  pharmacyId: integer('pharmacy_id').references(() => pharmacies.id, { onDelete: 'set null' }),
  action: text('action').notNull(),
  detail: text('detail'),
  resourceType: text('resource_type'),
  resourceId: text('resource_id'),
  metadataJson: text('metadata_json'),
  ipAddress: text('ip_address'),
  errorCode: varchar('error_code', { length: 64 }),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
}, (table) => ({
  idxActivityLogsCreatedAt: index('idx_activity_logs_created_at')
    .on(table.createdAt),
  idxActivityLogsPharmacyCreated: index('idx_activity_logs_pharmacy_created')
    .on(table.pharmacyId, table.createdAt),
  idxActivityLogsAction: index('idx_activity_logs_action')
    .on(table.action, table.createdAt),
  idxActivityLogsResource: index('idx_activity_logs_resource')
    .on(table.resourceType, table.resourceId, table.createdAt),
  idxActivityLogsFailurePatternScan: index('idx_activity_logs_failure_pattern_scan')
    .on(table.action, table.createdAt)
    .where(sql`${table.detail} LIKE '失敗|%'`),
}));

export const systemEvents = pgTable('system_events', {
  id: serial('id').primaryKey(),
  source: text('source').$type<(typeof systemEventSourceValues)[number]>().notNull(),
  level: text('level').$type<(typeof systemEventLevelValues)[number]>().notNull().default('error'),
  eventType: text('event_type').notNull(),
  message: text('message').notNull(),
  detailJson: text('detail_json'),
  errorCode: varchar('error_code', { length: 64 }),
  occurredAt: timestamp('occurred_at', { mode: 'string' }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
}, (table) => ({
  idxSystemEventsOccurredAt: index('idx_system_events_occurred_at')
    .on(table.occurredAt),
  idxSystemEventsSourceOccurredAt: index('idx_system_events_source_occurred_at')
    .on(table.source, table.occurredAt),
  idxSystemEventsLevelOccurredAt: index('idx_system_events_level_occurred_at')
    .on(table.level, table.occurredAt),
  idxSystemEventsTypeOccurredAt: index('idx_system_events_type_occurred_at')
    .on(table.eventType, table.occurredAt),
  chkSystemEventsSource: check('chk_system_events_source', sql`${table.source} IN ('runtime_error', 'unhandled_rejection', 'uncaught_exception', 'vercel_deploy')`),
  chkSystemEventsLevel: check('chk_system_events_level', sql`${table.level} IN ('info', 'warning', 'error')`),
}));

export const errorCodes = pgTable('error_codes', {
  id: serial('id').primaryKey(),
  code: varchar('code', { length: 64 }).unique().notNull(),
  category: text('category').$type<(typeof errorCodeCategoryValues)[number]>().notNull(),
  severity: text('severity').$type<(typeof errorCodeSeverityValues)[number]>().notNull(),
  titleJa: varchar('title_ja', { length: 128 }).notNull(),
  descriptionJa: text('description_ja'),
  resolutionJa: text('resolution_ja'),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow(),
}, (table) => ({
  idxErrorCodesCategory: index('idx_error_codes_category').on(table.category),
  idxErrorCodesSeverity: index('idx_error_codes_severity').on(table.severity),
  chkErrorCodesCategory: check('chk_error_codes_category', sql`${table.category} IN ('upload', 'auth', 'sync', 'system', 'openclaw')`),
  chkErrorCodesSeverity: check('chk_error_codes_severity', sql`${table.severity} IN ('critical', 'error', 'warning', 'info')`),
}));
