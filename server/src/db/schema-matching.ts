import { sql } from 'drizzle-orm';
import { pgTable, serial, text, integer, real, boolean, timestamp, jsonb, index, uniqueIndex, check } from 'drizzle-orm/pg-core';
import { pharmacies } from './schema-pharmacy';
import { uploadTypeEnum } from './schema-common';
import { exchangeProposals } from './schema-exchange';
import { deadStockItems } from './schema-inventory';

export const deadStockReservations = pgTable('dead_stock_reservations', {
  id: serial('id').primaryKey(),
  deadStockItemId: integer('dead_stock_item_id').notNull().references(() => deadStockItems.id, { onDelete: 'cascade' }),
  proposalId: integer('proposal_id').notNull().references(() => exchangeProposals.id, { onDelete: 'cascade' }),
  reservedQuantity: real('reserved_quantity').notNull(),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
}, (table) => ({
  idxDeadStockReservationsItem: index('idx_dead_stock_reservations_item')
    .on(table.deadStockItemId),
  idxDeadStockReservationsProposal: index('idx_dead_stock_reservations_proposal')
    .on(table.proposalId),
  idxDeadStockReservationsUnique: uniqueIndex('idx_dead_stock_reservations_unique')
    .on(table.proposalId, table.deadStockItemId),
  chkDeadStockReservationQtyPositive: check('chk_dead_stock_reservation_qty', sql`${table.reservedQuantity} > 0`),
}));

export const matchCandidateSnapshots = pgTable('match_candidate_snapshots', {
  id: serial('id').primaryKey(),
  pharmacyId: integer('pharmacy_id').notNull().references(() => pharmacies.id, { onDelete: 'cascade' }),
  candidateHash: text('candidate_hash').notNull(),
  candidateCount: integer('candidate_count').notNull().default(0),
  topCandidatesJson: jsonb('top_candidates_json').notNull(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow(),
}, (table) => ({
  idxMatchSnapshotsPharmacyUnique: uniqueIndex('idx_match_snapshots_pharmacy_unique')
    .on(table.pharmacyId),
}));

export const matchingRefreshJobs = pgTable('matching_refresh_jobs', {
  id: serial('id').primaryKey(),
  triggerPharmacyId: integer('trigger_pharmacy_id').notNull().references(() => pharmacies.id, { onDelete: 'cascade' }),
  uploadType: uploadTypeEnum('upload_type').notNull(),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
  processingStartedAt: timestamp('processing_started_at', { mode: 'string' }),
  nextRetryAt: timestamp('next_retry_at', { mode: 'string' }),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow(),
}, (table) => ({
  idxMatchingRefreshJobsCreated: index('idx_matching_refresh_jobs_created')
    .on(table.createdAt),
  idxMatchingRefreshJobsTrigger: index('idx_matching_refresh_jobs_trigger')
    .on(table.triggerPharmacyId, table.createdAt),
  idxMatchingRefreshJobsReady: index('idx_matching_refresh_jobs_ready')
    .on(table.attempts, table.nextRetryAt, table.processingStartedAt, table.createdAt),
}));

export const matchingRuleProfiles = pgTable('matching_rule_profiles', {
  id: serial('id').primaryKey(),
  profileName: text('profile_name').notNull(),
  pharmacyId: integer('pharmacy_id').references(() => pharmacies.id), // nullable: null = global profile
  isActive: boolean('is_active').notNull().default(true),
  nameMatchThreshold: real('name_match_threshold').notNull().default(0.7),
  valueScoreMax: real('value_score_max').notNull().default(55),
  valueScoreDivisor: real('value_score_divisor').notNull().default(2500),
  balanceScoreMax: real('balance_score_max').notNull().default(20),
  balanceScoreDiffFactor: real('balance_score_diff_factor').notNull().default(1.5),
  distanceScoreMax: real('distance_score_max').notNull().default(15),
  distanceScoreDivisor: real('distance_score_divisor').notNull().default(8),
  distanceScoreFallback: real('distance_score_fallback').notNull().default(2),
  nearExpiryScoreMax: real('near_expiry_score_max').notNull().default(10),
  nearExpiryItemFactor: real('near_expiry_item_factor').notNull().default(1.5),
  nearExpiryDays: integer('near_expiry_days').notNull().default(120),
  diversityScoreMax: real('diversity_score_max').notNull().default(10),
  diversityItemFactor: real('diversity_item_factor').notNull().default(1.5),
  favoriteBonus: real('favorite_bonus').notNull().default(15),
  groupBonus: integer('group_bonus').notNull().default(10),
  nearExpiryDecayCurve: real('near_expiry_decay_curve').notNull().default(0),
  successRateBonus: integer('success_rate_bonus').notNull().default(0),
  maxCandidates: integer('max_candidates').notNull().default(30),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow(),
}, (table) => ({
  idxMatchingRuleProfilesNameUnique: uniqueIndex('idx_matching_rule_profiles_name_unique')
    .on(table.profileName),
  uqMatchingRuleProfileActiveGlobal: uniqueIndex('uq_matching_rule_profile_active_global')
    .on(table.isActive)
    .where(sql`${table.isActive} = true AND ${table.pharmacyId} IS NULL`),
  uqMatchingRuleProfileActivePharmacy: uniqueIndex('uq_matching_rule_profile_active_pharmacy')
    .on(table.pharmacyId, table.isActive)
    .where(sql`${table.isActive} = true AND ${table.pharmacyId} IS NOT NULL`),
  idxMatchingRuleProfilesUpdatedAt: index('idx_matching_rule_profiles_updated_at')
    .on(table.updatedAt),
  chkMatchingRuleNameThreshold: check('chk_matching_rule_name_threshold', sql`${table.nameMatchThreshold} >= 0 AND ${table.nameMatchThreshold} <= 1`),
  chkMatchingRuleValueScoreMax: check('chk_matching_rule_value_score_max', sql`${table.valueScoreMax} >= 0`),
  chkMatchingRuleValueScoreDivisor: check('chk_matching_rule_value_score_divisor', sql`${table.valueScoreDivisor} > 0`),
  chkMatchingRuleBalanceScoreMax: check('chk_matching_rule_balance_score_max', sql`${table.balanceScoreMax} >= 0`),
  chkMatchingRuleBalanceScoreDiffFactor: check('chk_matching_rule_balance_diff_factor', sql`${table.balanceScoreDiffFactor} >= 0`),
  chkMatchingRuleDistanceScoreMax: check('chk_matching_rule_distance_score_max', sql`${table.distanceScoreMax} >= 0`),
  chkMatchingRuleDistanceScoreDivisor: check('chk_matching_rule_distance_score_divisor', sql`${table.distanceScoreDivisor} > 0`),
  chkMatchingRuleDistanceScoreFallback: check('chk_matching_rule_distance_fallback', sql`${table.distanceScoreFallback} >= 0`),
  chkMatchingRuleNearExpiryScoreMax: check('chk_matching_rule_near_expiry_score_max', sql`${table.nearExpiryScoreMax} >= 0`),
  chkMatchingRuleNearExpiryItemFactor: check('chk_matching_rule_near_expiry_item_factor', sql`${table.nearExpiryItemFactor} >= 0`),
  chkMatchingRuleNearExpiryDays: check('chk_matching_rule_near_expiry_days', sql`${table.nearExpiryDays} >= 1 AND ${table.nearExpiryDays} <= 365`),
  chkMatchingRuleDiversityScoreMax: check('chk_matching_rule_diversity_score_max', sql`${table.diversityScoreMax} >= 0`),
  chkMatchingRuleDiversityItemFactor: check('chk_matching_rule_diversity_item_factor', sql`${table.diversityItemFactor} >= 0`),
  chkMatchingRuleFavoriteBonus: check('chk_matching_rule_favorite_bonus', sql`${table.favoriteBonus} >= 0`),
  chkMatchingRuleGroupBonus: check('chk_matching_rule_group_bonus', sql`${table.groupBonus} >= 0 AND ${table.groupBonus} <= 50`),
  chkMatchingRuleVersion: check('chk_matching_rule_version', sql`${table.version} >= 1`),
  chkMatchingRuleNearExpiryDecayCurve: check('chk_matching_rule_near_expiry_decay_curve', sql`${table.nearExpiryDecayCurve} >= 0 AND ${table.nearExpiryDecayCurve} <= 10`),
  chkMatchingRuleSuccessRateBonus: check('chk_matching_rule_success_rate_bonus', sql`${table.successRateBonus} >= 0 AND ${table.successRateBonus} <= 50`),
  chkMatchingRuleMaxCandidates: check('chk_matching_rule_max_candidates', sql`${table.maxCandidates} >= 1 AND ${table.maxCandidates} <= 200`),
}));

export const matchingExperiments = pgTable('matching_experiments', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  controlProfileId: integer('control_profile_id').notNull().references(() => matchingRuleProfiles.id),
  treatmentProfileId: integer('treatment_profile_id').notNull().references(() => matchingRuleProfiles.id),
  trafficPercentage: integer('traffic_percentage').notNull().default(50),
  status: text('status').notNull().default('draft'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  chkExperimentStatus: check('chk_experiment_status', sql`${table.status} IN ('draft','running','completed','cancelled')`),
  chkExperimentTrafficPct: check('chk_experiment_traffic_pct', sql`${table.trafficPercentage} >= 0 AND ${table.trafficPercentage} <= 100`),
}));

export const matchingExperimentAssignments = pgTable('matching_experiment_assignments', {
  id: serial('id').primaryKey(),
  experimentId: integer('experiment_id').notNull().references(() => matchingExperiments.id),
  pharmacyId: integer('pharmacy_id').notNull().references(() => pharmacies.id),
  assignedGroup: text('assigned_group').notNull(),
  assignedAt: timestamp('assigned_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  uqExperimentPharmacy: uniqueIndex('uq_experiment_pharmacy').on(table.experimentId, table.pharmacyId),
}));

export const matchCandidateBookmarks = pgTable('match_candidate_bookmarks', {
  id: serial('id').primaryKey(),
  pharmacyId: integer('pharmacy_id').notNull().references(() => pharmacies.id),
  candidatePharmacyId: integer('candidate_pharmacy_id').notNull().references(() => pharmacies.id),
  drugCode: text('drug_code').notNull(),
  memo: text('memo'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  uqBookmarkPharmacyCandidateDrug: uniqueIndex('uq_bookmark_pharmacy_candidate_drug')
    .on(table.pharmacyId, table.candidatePharmacyId, table.drugCode),
  idxBookmarkPharmacyId: index('idx_bookmark_pharmacy_id')
    .on(table.pharmacyId),
}));

export const matchDismissFeedback = pgTable('match_dismiss_feedback', {
  id: serial('id').primaryKey(),
  pharmacyId: integer('pharmacy_id').notNull().references(() => pharmacies.id, { onDelete: 'cascade' }),
  candidatePharmacyId: integer('candidate_pharmacy_id').notNull().references(() => pharmacies.id, { onDelete: 'cascade' }),
  reason: text('reason').notNull(),
  drugCode: text('drug_code').notNull().default(''),
  drugGroup: text('drug_group').notNull().default(''),
  dismissCount: integer('dismiss_count').notNull().default(1),
  lastDismissedAt: timestamp('last_dismissed_at', { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  uqMatchDismissFeedback: uniqueIndex('uq_match_dismiss_feedback')
    .on(table.pharmacyId, table.candidatePharmacyId, table.reason, table.drugCode, table.drugGroup),
  idxMatchDismissFeedbackPharmacy: index('idx_match_dismiss_feedback_pharmacy')
    .on(table.pharmacyId, table.lastDismissedAt),
  chkMatchDismissReason: check('chk_match_dismiss_reason', sql`${table.reason} IN ('distance','expiry','value_gap','item_fit','other')`),
}));
