import { sql } from 'drizzle-orm';
import { pgTable, serial, text, integer, date, timestamp, jsonb, index, uniqueIndex, check } from 'drizzle-orm/pg-core';
import { pharmacies } from './schema-pharmacy';
import { monthlyReportStatusEnum, predictiveAlertTypeValues, tenants } from './schema-common';
import { notifications } from './schema-notification';

export const monthlyReports = pgTable('monthly_reports', {
  id: serial('id').primaryKey(),
  year: integer('year').notNull(),
  month: integer('month').notNull(),
  status: monthlyReportStatusEnum('status').notNull().default('success'),
  reportJson: jsonb('report_json').notNull(),
  generatedBy: integer('generated_by').references(() => pharmacies.id, { onDelete: 'set null' }),
  generatedAt: timestamp('generated_at', { mode: 'string' }).defaultNow(),
}, (table) => ({
  idxMonthlyReportsYearMonthUnique: uniqueIndex('idx_monthly_reports_year_month_unique')
    .on(table.year, table.month),
  idxMonthlyReportsGeneratedAt: index('idx_monthly_reports_generated_at')
    .on(table.generatedAt),
  chkMonthlyReportsMonthRange: check('chk_monthly_reports_month_range', sql`${table.month} >= 1 AND ${table.month} <= 12`),
}));

export const dailyStatistics = pgTable('daily_statistics', {
  id: serial('id').primaryKey(),
  date: date('date', { mode: 'string' }).notNull(),
  pharmacyId: integer('pharmacy_id').notNull().references(() => pharmacies.id),
  metrics: jsonb('metrics').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('uq_daily_stats_date_pharmacy').on(table.date, table.pharmacyId),
  index('idx_daily_stats_pharmacy_date').on(table.pharmacyId, table.date),
]);

export const predictiveAlerts = pgTable('predictive_alerts', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  pharmacyId: integer('pharmacy_id').notNull().references(() => pharmacies.id, { onDelete: 'cascade' }),
  alertType: text('alert_type').$type<(typeof predictiveAlertTypeValues)[number]>().notNull(),
  title: text('title').notNull(),
  message: text('message').notNull(),
  detailJson: jsonb('detail_json').notNull(),
  dedupeKey: text('dedupe_key').notNull(),
  notificationId: integer('notification_id').references(() => notifications.id, { onDelete: 'set null' }),
  detectedAt: timestamp('detected_at', { mode: 'string' }).notNull().defaultNow(),
  resolvedAt: timestamp('resolved_at', { mode: 'string' }),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
}, (table) => ({
  idxPredictiveAlertsTenantCreated: index('idx_predictive_alerts_tenant_created')
    .on(table.tenantId, table.createdAt),
  idxPredictiveAlertsPharmacyCreated: index('idx_predictive_alerts_pharmacy_created')
    .on(table.pharmacyId, table.createdAt),
  idxPredictiveAlertsUnresolved: index('idx_predictive_alerts_unresolved')
    .on(table.pharmacyId, table.resolvedAt, table.createdAt),
  idxPredictiveAlertsTypeDetected: index('idx_predictive_alerts_type_detected')
    .on(table.alertType, table.detectedAt),
  idxPredictiveAlertsDedupeUnique: uniqueIndex('idx_predictive_alerts_dedupe_unique')
    .on(table.pharmacyId, table.dedupeKey),
  chkPredictiveAlertsType: check('chk_predictive_alerts_type', sql`${table.alertType} IN ('near_expiry', 'excess_stock')`),
}));

export const adminDashboardSnapshots = pgTable('admin_dashboard_snapshots', {
  id: serial('id').primaryKey(),
  totalUploads: integer('total_uploads').notNull().default(0),
  totalExchanges: integer('total_exchanges').notNull().default(0),
  unreadNotifications: integer('unread_notifications').notNull().default(0),
  failedUploadJobs24h: integer('failed_upload_jobs_24h').notNull().default(0),
  pendingProposalActions24h: integer('pending_proposal_actions_24h').notNull().default(0),
  escalatedRequests24h: integer('escalated_requests_24h').notNull().default(0),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
}, (table) => ({
  idxAdminDashboardSnapshotsCreated: index('idx_admin_dashboard_snapshots_created')
    .on(table.createdAt),
}));
