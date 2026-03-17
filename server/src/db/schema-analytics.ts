import { sql } from 'drizzle-orm';
import { pgTable, serial, text, integer, numeric, timestamp, jsonb, index, uniqueIndex, check } from 'drizzle-orm/pg-core';
import { pharmacies } from './schema-pharmacy';
import { monthlyReportStatusEnum, predictiveAlertTypeValues } from './schema-common';
import { notifications } from './schema-notification';

export const pharmacyTrustScores = pgTable('pharmacy_trust_scores', {
  pharmacyId: integer('pharmacy_id').primaryKey().references(() => pharmacies.id, { onDelete: 'cascade' }),
  trustScore: numeric('trust_score', { precision: 5, scale: 2 }).notNull().default('60.00'),
  ratingCount: integer('rating_count').notNull().default(0),
  positiveRate: numeric('positive_rate', { precision: 5, scale: 2 }).notNull().default('0.00'),
  updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow(),
}, (table) => ({
  idxTrustScoresUpdatedAt: index('idx_trust_scores_updated_at').on(table.updatedAt),
}));

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

export const predictiveAlerts = pgTable('predictive_alerts', {
  id: serial('id').primaryKey(),
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
