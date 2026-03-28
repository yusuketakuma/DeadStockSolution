import { sql } from 'drizzle-orm';
import { pgTable, serial, text, integer, numeric, timestamp, boolean, real, date, index, uniqueIndex, check, jsonb } from 'drizzle-orm/pg-core';
import {
  pharmacyRelationshipTypeEnum,
  specialBusinessHoursTypeEnum,
} from './schema-common';

export const pharmacies = pgTable('pharmacies', {
  id: serial('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash'),
  workosUserId: text('workos_user_id').unique(),
  name: text('name').notNull(),
  postalCode: text('postal_code').notNull(),
  address: text('address').notNull(),
  phone: text('phone').notNull(),
  fax: text('fax').notNull(),
  licenseNumber: text('license_number').notNull().unique(),
  prefecture: text('prefecture').notNull(),
  latitude: real('latitude'),
  longitude: real('longitude'),
  isAdmin: boolean('is_admin').default(false),
  isActive: boolean('is_active').default(true),
  isTestAccount: boolean('is_test_account').notNull().default(false),
  testAccountPassword: text('test_account_password'),
  version: integer('version').notNull().default(1),
  lastTimelineViewedAt: timestamp('last_timeline_viewed_at', { mode: 'string' }),
  verificationStatus: text('verification_status').notNull().default('pending_verification'),
  verificationRequestId: integer('verification_request_id'),
  verifiedAt: timestamp('verified_at', { mode: 'string' }),
  rejectionReason: text('rejection_reason'),
  matchingAutoNotifyEnabled: boolean('matching_auto_notify_enabled').notNull().default(true),
  trustScore: numeric('trust_score', { precision: 5, scale: 2 }).default('60.00'),
  ratingCount: integer('rating_count').default(0),
  positiveRate: numeric('positive_rate', { precision: 5, scale: 2 }).default('0.00'),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow(),
}, (table) => ({
  idxPharmaciesIsActive: index('idx_pharmacies_is_active').on(table.isActive),
  idxPharmaciesVerificationStatus: index('idx_pharmacies_verification_status').on(table.verificationStatus),
  idxPharmaciesIsAdmin: index('idx_pharmacies_is_admin').on(table.isAdmin),
  chkLatitude: check('chk_latitude', sql`${table.latitude} IS NULL OR (${table.latitude} >= -90 AND ${table.latitude} <= 90)`),
  chkLongitude: check('chk_longitude', sql`${table.longitude} IS NULL OR (${table.longitude} >= -180 AND ${table.longitude} <= 180)`),
}));

export const pharmacyBusinessHours = pgTable('pharmacy_business_hours', {
  id: serial('id').primaryKey(),
  pharmacyId: integer('pharmacy_id').notNull().references(() => pharmacies.id, { onDelete: 'cascade' }),
  dayOfWeek: integer('day_of_week').notNull(),
  openTime: text('open_time'),
  closeTime: text('close_time'),
  isClosed: boolean('is_closed').default(false),
  is24Hours: boolean('is_24_hours').default(false),
  version: integer('version').notNull().default(1),
}, (table) => ({
  idxBusinessHoursPharmacy: index('idx_business_hours_pharmacy').on(table.pharmacyId),
  idxBusinessHoursPharmacyDay: uniqueIndex('idx_business_hours_pharmacy_day').on(table.pharmacyId, table.dayOfWeek),
  chkDayOfWeek: check('chk_day_of_week', sql`${table.dayOfWeek} >= 0 AND ${table.dayOfWeek} <= 6`),
}));

export const pharmacySpecialHours = pgTable('pharmacy_special_hours', {
  id: serial('id').primaryKey(),
  pharmacyId: integer('pharmacy_id').notNull().references(() => pharmacies.id, { onDelete: 'cascade' }),
  specialType: specialBusinessHoursTypeEnum('special_type').notNull(),
  startDate: date('start_date', { mode: 'string' }).notNull(),
  endDate: date('end_date', { mode: 'string' }).notNull(),
  openTime: text('open_time'),
  closeTime: text('close_time'),
  isClosed: boolean('is_closed').notNull().default(true),
  is24Hours: boolean('is_24_hours').notNull().default(false),
  note: text('note'),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow(),
}, (table) => ({
  idxSpecialHoursPharmacyDate: index('idx_special_hours_pharmacy_date')
    .on(table.pharmacyId, table.startDate, table.endDate),
  chkSpecialHoursDateRange: check('chk_special_hours_date_range', sql`${table.startDate} <= ${table.endDate}`),
  chkSpecialHoursFlags: check('chk_special_hours_flags', sql`NOT (${table.isClosed} = true AND ${table.is24Hours} = true)`),
}));

export const pharmacyRelationships = pgTable('pharmacy_relationships', {
  id: serial('id').primaryKey(),
  pharmacyId: integer('pharmacy_id').notNull().references(() => pharmacies.id, { onDelete: 'cascade' }),
  targetPharmacyId: integer('target_pharmacy_id').notNull().references(() => pharmacies.id, { onDelete: 'cascade' }),
  relationshipType: pharmacyRelationshipTypeEnum('relationship_type').notNull(),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
}, (table) => ({
  idxRelationshipsPharmacy: index('idx_relationships_pharmacy')
    .on(table.pharmacyId, table.relationshipType),
  idxRelationshipsUnique: uniqueIndex('idx_relationships_unique')
    .on(table.pharmacyId, table.targetPharmacyId),
  chkNotSelfRelationship: check('chk_not_self_relationship', sql`${table.pharmacyId} != ${table.targetPharmacyId}`),
}));

export const inventorySearchPreferences = pgTable('inventory_search_preferences', {
  id: serial('id').primaryKey(),
  pharmacyId: integer('pharmacy_id').notNull().references(() => pharmacies.id, { onDelete: 'cascade' }),
  draftJson: jsonb('draft_json').notNull(),
  searchHistoryJson: jsonb('search_history_json').notNull(),
  savedPresetsJson: jsonb('saved_presets_json').notNull(),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow(),
}, (table) => ({
  idxInventorySearchPreferencesPharmacy: uniqueIndex('idx_inventory_search_preferences_pharmacy')
    .on(table.pharmacyId),
}));

export const pushNotificationPreferences = pgTable('push_notification_preferences', {
  id: serial('id').primaryKey(),
  pharmacyId: integer('pharmacy_id').notNull().references(() => pharmacies.id, { onDelete: 'cascade' }),
  categoriesJson: jsonb('categories_json').notNull(),
  allowCritical: boolean('allow_critical').notNull().default(true),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow(),
}, (table) => ({
  idxPushNotificationPreferencesPharmacy: uniqueIndex('idx_push_notification_preferences_pharmacy')
    .on(table.pharmacyId),
}));

export const subscriptionPlanValues = ['light', 'standard', 'enterprise'] as const;
export type SubscriptionPlan = (typeof subscriptionPlanValues)[number];

export const subscriptionStatusValues = ['active', 'past_due', 'canceled', 'incomplete', 'incomplete_expired', 'trialing', 'unpaid', 'paused'] as const;
export type SubscriptionStatus = (typeof subscriptionStatusValues)[number];

export const subscriptions = pgTable('subscriptions', {
  id: serial('id').primaryKey(),
  pharmacyId: integer('pharmacy_id').notNull().references(() => pharmacies.id, { onDelete: 'cascade' }),
  stripeSubscriptionId: text('stripe_subscription_id').notNull().unique(),
  stripeCustomerId: text('stripe_customer_id').notNull(),
  planType: text('plan_type').$type<SubscriptionPlan>().notNull(),
  status: text('status').$type<SubscriptionStatus>().notNull(),
  currentPeriodStart: timestamp('current_period_start', { mode: 'string' }),
  currentPeriodEnd: timestamp('current_period_end', { mode: 'string' }),
  cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
  canceledAt: timestamp('canceled_at', { mode: 'string' }),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow(),
}, (table) => ({
  idxSubscriptionsPharmacyId: index('idx_subscriptions_pharmacy_id').on(table.pharmacyId),
  idxSubscriptionsStripeCustomerId: index('idx_subscriptions_stripe_customer_id').on(table.stripeCustomerId),
  idxSubscriptionsStatus: index('idx_subscriptions_status').on(table.status),
}));
