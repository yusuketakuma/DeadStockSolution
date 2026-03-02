import {
  pgEnum,
  pgTable,
  serial,
  text,
  date,
  integer,
  real,
  numeric,
  boolean,
  timestamp,
  varchar,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const pharmacyRelationshipTypeEnum = pgEnum('pharmacy_relationship_type_enum', ['favorite', 'blocked']);
export const uploadTypeEnum = pgEnum('upload_type_enum', ['dead_stock', 'used_medication']);
export const uploadJobStatusEnum = pgEnum('upload_job_status_enum', ['pending', 'processing', 'completed', 'failed']);
export const exchangeStatusEnum = pgEnum('exchange_status_enum', [
  'proposed',
  'accepted_a',
  'accepted_b',
  'confirmed',
  'rejected',
  'completed',
  'cancelled',
]);
export const adminMessageTargetTypeEnum = pgEnum('admin_message_target_type_enum', ['all', 'pharmacy']);
export const openclawStatusEnum = pgEnum('openclaw_status_enum', [
  'pending_handoff',
  'in_dialogue',
  'implementing',
  'completed',
]);
export const drugMasterSyncStatusEnum = pgEnum('drug_master_sync_status_enum', ['running', 'success', 'failed', 'partial']);
export const drugMasterRevisionTypeEnum = pgEnum('drug_master_revision_type_enum', ['price_revision', 'new_listing', 'delisting', 'transition']);
export const specialBusinessHoursTypeEnum = pgEnum('special_business_hours_type_enum', [
  'holiday_closed',
  'long_holiday_closed',
  'temporary_closed',
  'special_open',
]);
export const monthlyReportStatusEnum = pgEnum('monthly_report_status_enum', ['success', 'failed']);
export const systemEventSourceValues = ['runtime_error', 'unhandled_rejection', 'uncaught_exception', 'vercel_deploy'] as const;
export type SystemEventSource = (typeof systemEventSourceValues)[number];
export const systemEventLevelValues = ['info', 'warning', 'error'] as const;
export type SystemEventLevel = (typeof systemEventLevelValues)[number];
export const registrationReviewVerdictValues = ['approved', 'rejected'] as const;
export type RegistrationReviewVerdict = (typeof registrationReviewVerdictValues)[number];

export const pharmacies = pgTable('pharmacies', {
  id: serial('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
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
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow(),
}, (table) => ({
  chkLatitude: check('chk_latitude', sql`${table.latitude} IS NULL OR (${table.latitude} >= -90 AND ${table.latitude} <= 90)`),
  chkLongitude: check('chk_longitude', sql`${table.longitude} IS NULL OR (${table.longitude} >= -180 AND ${table.longitude} <= 180)`),
}));

export const uploads = pgTable('uploads', {
  id: serial('id').primaryKey(),
  pharmacyId: integer('pharmacy_id').notNull().references(() => pharmacies.id, { onDelete: 'cascade' }),
  uploadType: uploadTypeEnum('upload_type').notNull(),
  originalFilename: text('original_filename').notNull(),
  columnMapping: text('column_mapping'),
  rowCount: integer('row_count'),
  requestedAt: timestamp('requested_at', { mode: 'string' }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
}, (table) => ({
  idxUploadsPharmacyTypeCreated: index('idx_uploads_pharmacy_type_created')
    .on(table.pharmacyId, table.uploadType, table.createdAt),
  idxUploadsUsedMedicationRecentCandidates: index('idx_uploads_used_med_recent_candidates')
    .on(table.createdAt, table.pharmacyId)
    .where(sql`${table.uploadType} = 'used_medication'`),
}));

export const deadStockItems = pgTable('dead_stock_items', {
  id: serial('id').primaryKey(),
  pharmacyId: integer('pharmacy_id').notNull().references(() => pharmacies.id, { onDelete: 'cascade' }),
  uploadId: integer('upload_id').notNull().references(() => uploads.id, { onDelete: 'cascade' }),
  drugCode: text('drug_code'),
  drugName: text('drug_name').notNull(),
  drugMasterId: integer('drug_master_id'),
  drugMasterPackageId: integer('drug_master_package_id'),
  packageLabel: text('package_label'),
  quantity: real('quantity').notNull(),
  unit: text('unit'),
  yakkaUnitPrice: numeric('yakka_unit_price', { precision: 12, scale: 2 }),
  yakkaTotal: numeric('yakka_total', { precision: 12, scale: 2 }),
  expirationDate: text('expiration_date'),
  expirationDateIso: date('expiration_date_iso', { mode: 'string' }),
  lotNumber: text('lot_number'),
  isAvailable: boolean('is_available').default(true),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
}, (table) => ({
  idxDeadStockPharmacyAvailableCreated: index('idx_dead_stock_pharmacy_available_created')
    .on(table.pharmacyId, table.isAvailable, table.createdAt),
  idxDeadStockPharmacyCreated: index('idx_dead_stock_pharmacy_created')
    .on(table.pharmacyId, table.createdAt),
  idxDeadStockAvailableCreated: index('idx_dead_stock_available_created')
    .on(table.createdAt)
    .where(sql`${table.isAvailable} = true`),
  idxDeadStockAvailableName: index('idx_dead_stock_available_name')
    .on(table.isAvailable, table.drugName),
  idxDeadStockExpiryRisk: index('idx_dead_stock_expiry_risk')
    .on(table.pharmacyId, table.isAvailable, table.expirationDateIso),
  idxDeadStockDrugMasterId: index('idx_dead_stock_drug_master_id')
    .on(table.drugMasterId),
  idxDeadStockDrugMasterPackageId: index('idx_dead_stock_drug_master_package_id')
    .on(table.drugMasterPackageId),
  idxDeadStockPharmacyAvailableName: index('idx_dead_stock_pharmacy_available_name')
    .on(table.pharmacyId, table.isAvailable, table.drugName),
  chkQuantityPositive: check('chk_dead_stock_quantity', sql`${table.quantity} > 0`),
  chkYakkaUnitPriceNonNeg: check('chk_dead_stock_yakka_price', sql`${table.yakkaUnitPrice} IS NULL OR ${table.yakkaUnitPrice} >= 0`),
}));

export const usedMedicationItems = pgTable('used_medication_items', {
  id: serial('id').primaryKey(),
  pharmacyId: integer('pharmacy_id').notNull().references(() => pharmacies.id, { onDelete: 'cascade' }),
  uploadId: integer('upload_id').notNull().references(() => uploads.id, { onDelete: 'cascade' }),
  drugCode: text('drug_code'),
  drugName: text('drug_name').notNull(),
  drugMasterId: integer('drug_master_id'),
  drugMasterPackageId: integer('drug_master_package_id'),
  packageLabel: text('package_label'),
  monthlyUsage: real('monthly_usage'),
  unit: text('unit'),
  yakkaUnitPrice: numeric('yakka_unit_price', { precision: 12, scale: 2 }),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
}, (table) => ({
  idxUsedMedicationPharmacyCreated: index('idx_used_medication_pharmacy_created')
    .on(table.pharmacyId, table.createdAt),
  idxUsedMedDrugMasterId: index('idx_used_med_drug_master_id')
    .on(table.drugMasterId),
  idxUsedMedDrugMasterPackageId: index('idx_used_med_drug_master_package_id')
    .on(table.drugMasterPackageId),
  idxUsedMedPharmacyName: index('idx_used_med_pharmacy_name')
    .on(table.pharmacyId, table.drugName),
  chkYakkaUnitPriceNonNeg: check('chk_used_med_yakka_price', sql`${table.yakkaUnitPrice} IS NULL OR ${table.yakkaUnitPrice} >= 0`),
}));

export const exchangeProposals = pgTable('exchange_proposals', {
  id: serial('id').primaryKey(),
  pharmacyAId: integer('pharmacy_a_id').notNull().references(() => pharmacies.id),
  pharmacyBId: integer('pharmacy_b_id').notNull().references(() => pharmacies.id),
  status: exchangeStatusEnum('status').notNull().default('proposed'),
  totalValueA: numeric('total_value_a', { precision: 12, scale: 2 }),
  totalValueB: numeric('total_value_b', { precision: 12, scale: 2 }),
  valueDifference: numeric('value_difference', { precision: 12, scale: 2 }),
  proposedAt: timestamp('proposed_at', { mode: 'string' }).defaultNow(),
  completedAt: timestamp('completed_at', { mode: 'string' }),
}, (table) => ({
  idxExchangeProposalsAProposed: index('idx_exchange_proposals_a_proposed')
    .on(table.pharmacyAId, table.proposedAt),
  idxExchangeProposalsBProposed: index('idx_exchange_proposals_b_proposed')
    .on(table.pharmacyBId, table.proposedAt),
  idxExchangeProposalsStatusProposed: index('idx_exchange_proposals_status_proposed')
    .on(table.status, table.proposedAt),
}));

export const exchangeProposalItems = pgTable('exchange_proposal_items', {
  id: serial('id').primaryKey(),
  proposalId: integer('proposal_id').notNull().references(() => exchangeProposals.id, { onDelete: 'cascade' }),
  deadStockItemId: integer('dead_stock_item_id').notNull().references(() => deadStockItems.id),
  fromPharmacyId: integer('from_pharmacy_id').notNull().references(() => pharmacies.id),
  toPharmacyId: integer('to_pharmacy_id').notNull().references(() => pharmacies.id),
  quantity: real('quantity').notNull(),
  yakkaValue: numeric('yakka_value', { precision: 12, scale: 2 }),
}, (table) => ({
  idxExchangeItemsProposal: index('idx_exchange_items_proposal').on(table.proposalId),
  chkQuantityPositive: check('chk_exchange_item_quantity', sql`${table.quantity} > 0`),
}));

export const exchangeHistory = pgTable('exchange_history', {
  id: serial('id').primaryKey(),
  proposalId: integer('proposal_id').notNull().references(() => exchangeProposals.id),
  pharmacyAId: integer('pharmacy_a_id').notNull().references(() => pharmacies.id),
  pharmacyBId: integer('pharmacy_b_id').notNull().references(() => pharmacies.id),
  totalValue: numeric('total_value', { precision: 12, scale: 2 }),
  completedAt: timestamp('completed_at', { mode: 'string' }).defaultNow(),
}, (table) => ({
  idxExchangeHistoryACompleted: index('idx_exchange_history_a_completed')
    .on(table.pharmacyAId, table.completedAt),
  idxExchangeHistoryBCompleted: index('idx_exchange_history_b_completed')
    .on(table.pharmacyBId, table.completedAt),
  idxExchangeHistoryProposal: index('idx_exchange_history_proposal')
    .on(table.proposalId),
}));

export const proposalComments = pgTable('proposal_comments', {
  id: serial('id').primaryKey(),
  proposalId: integer('proposal_id').notNull().references(() => exchangeProposals.id, { onDelete: 'cascade' }),
  authorPharmacyId: integer('author_pharmacy_id').notNull().references(() => pharmacies.id, { onDelete: 'cascade' }),
  body: text('body').notNull(),
  isDeleted: boolean('is_deleted').notNull().default(false),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow(),
  readByRecipient: boolean('read_by_recipient').notNull().default(false),
}, (table) => ({
  idxProposalCommentsProposalCreated: index('idx_proposal_comments_proposal_created')
    .on(table.proposalId, table.createdAt),
  idxProposalCommentsAuthor: index('idx_proposal_comments_author')
    .on(table.authorPharmacyId, table.createdAt),
}));

export const exchangeFeedback = pgTable('exchange_feedback', {
  id: serial('id').primaryKey(),
  proposalId: integer('proposal_id').notNull().references(() => exchangeProposals.id, { onDelete: 'cascade' }),
  fromPharmacyId: integer('from_pharmacy_id').notNull().references(() => pharmacies.id, { onDelete: 'cascade' }),
  toPharmacyId: integer('to_pharmacy_id').notNull().references(() => pharmacies.id, { onDelete: 'cascade' }),
  rating: integer('rating').notNull(),
  comment: text('comment'),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow(),
}, (table) => ({
  idxExchangeFeedbackProposalFromUnique: uniqueIndex('idx_exchange_feedback_proposal_from_unique')
    .on(table.proposalId, table.fromPharmacyId),
  idxExchangeFeedbackTarget: index('idx_exchange_feedback_target')
    .on(table.toPharmacyId, table.createdAt),
  chkExchangeFeedbackRating: check('chk_exchange_feedback_rating', sql`${table.rating} >= 1 AND ${table.rating} <= 5`),
}));

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
  reportJson: text('report_json').notNull(),
  generatedBy: integer('generated_by').references(() => pharmacies.id, { onDelete: 'set null' }),
  generatedAt: timestamp('generated_at', { mode: 'string' }).defaultNow(),
}, (table) => ({
  idxMonthlyReportsYearMonthUnique: uniqueIndex('idx_monthly_reports_year_month_unique')
    .on(table.year, table.month),
  idxMonthlyReportsGeneratedAt: index('idx_monthly_reports_generated_at')
    .on(table.generatedAt),
  chkMonthlyReportsMonthRange: check('chk_monthly_reports_month_range', sql`${table.month} >= 1 AND ${table.month} <= 12`),
}));

export const columnMappingTemplates = pgTable('column_mapping_templates', {
  id: serial('id').primaryKey(),
  pharmacyId: integer('pharmacy_id').notNull().references(() => pharmacies.id, { onDelete: 'cascade' }),
  uploadType: uploadTypeEnum('upload_type').notNull(),
  headerHash: text('header_hash').notNull(),
  mapping: text('mapping').notNull(),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
}, (table) => ({
  idxMappingTemplatesPharmacyTypeHash: uniqueIndex('idx_mapping_templates_pharmacy_type_hash')
    .on(table.pharmacyId, table.uploadType, table.headerHash),
}));

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

export const userRequests = pgTable('user_requests', {
  id: serial('id').primaryKey(),
  pharmacyId: integer('pharmacy_id').notNull().references(() => pharmacies.id, { onDelete: 'cascade' }),
  requestText: text('request_text').notNull(),
  openclawStatus: openclawStatusEnum('openclaw_status').notNull().default('pending_handoff'),
  openclawThreadId: text('openclaw_thread_id'),
  openclawSummary: text('openclaw_summary'),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow(),
}, (table) => ({
  idxUserRequestsCreatedAt: index('idx_user_requests_created_at').on(table.createdAt),
  idxUserRequestsPharmacyCreated: index('idx_user_requests_pharmacy_created').on(table.pharmacyId, table.createdAt),
  idxUserRequestsStatusCreated: index('idx_user_requests_status_created').on(table.openclawStatus, table.createdAt),
}));

export const pharmacyRegistrationReviews = pgTable('pharmacy_registration_reviews', {
  id: serial('id').primaryKey(),
  email: text('email').notNull(),
  pharmacyName: text('pharmacy_name').notNull(),
  postalCode: text('postal_code').notNull(),
  prefecture: text('prefecture').notNull(),
  address: text('address').notNull(),
  phone: text('phone').notNull(),
  fax: text('fax').notNull(),
  licenseNumber: text('license_number').notNull(),
  permitLicenseNumber: text('permit_license_number').notNull(),
  permitPharmacyName: text('permit_pharmacy_name').notNull(),
  permitAddress: text('permit_address').notNull(),
  verdict: text('verdict').$type<RegistrationReviewVerdict>().notNull(),
  screeningScore: integer('screening_score').notNull().default(0),
  screeningReasons: text('screening_reasons').notNull(),
  mismatchDetailsJson: text('mismatch_details_json'),
  createdPharmacyId: integer('created_pharmacy_id').references(() => pharmacies.id, { onDelete: 'set null' }),
  registrationIp: text('registration_ip'),
  submittedAt: timestamp('submitted_at', { mode: 'string' }).defaultNow(),
  reviewedAt: timestamp('reviewed_at', { mode: 'string' }).defaultNow(),
}, (table) => ({
  idxRegistrationReviewsSubmitted: index('idx_registration_reviews_submitted')
    .on(table.submittedAt),
  idxRegistrationReviewsVerdictSubmitted: index('idx_registration_reviews_verdict_submitted')
    .on(table.verdict, table.submittedAt),
  idxRegistrationReviewsCreatedPharmacy: index('idx_registration_reviews_created_pharmacy')
    .on(table.createdPharmacyId),
  chkRegistrationReviewsVerdict: check('chk_registration_reviews_verdict', sql`${table.verdict} IN ('approved', 'rejected')`),
  chkRegistrationReviewsScore: check('chk_registration_reviews_score', sql`${table.screeningScore} >= 0 AND ${table.screeningScore} <= 100`),
}));

export const passwordResetTokens = pgTable('password_reset_tokens', {
  id: serial('id').primaryKey(),
  pharmacyId: integer('pharmacy_id').notNull().references(() => pharmacies.id, { onDelete: 'cascade' }),
  token: text('token').notNull(),
  expiresAt: timestamp('expires_at', { mode: 'string' }).notNull(),
  usedAt: timestamp('used_at', { mode: 'string' }),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
}, (table) => ({
  idxPasswordResetToken: uniqueIndex('idx_password_reset_token').on(table.token),
  idxPasswordResetPharmacy: index('idx_password_reset_pharmacy').on(table.pharmacyId),
  idxPasswordResetActiveTokens: index('idx_password_reset_active_tokens')
    .on(table.pharmacyId, table.expiresAt)
    .where(sql`${table.usedAt} IS NULL`),
}));

export const pharmacyBusinessHours = pgTable('pharmacy_business_hours', {
  id: serial('id').primaryKey(),
  pharmacyId: integer('pharmacy_id').notNull().references(() => pharmacies.id, { onDelete: 'cascade' }),
  dayOfWeek: integer('day_of_week').notNull(), // 0=日曜, 1=月曜, ..., 6=土曜
  openTime: text('open_time'), // "09:00" format, null if closed
  closeTime: text('close_time'), // "18:00" format, null if closed
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

// ── 医薬品マスター ──────────────────────────────────────

export const drugMaster = pgTable('drug_master', {
  id: serial('id').primaryKey(),
  yjCode: text('yj_code').notNull().unique(),
  drugName: text('drug_name').notNull(),
  genericName: text('generic_name'),
  specification: text('specification'),
  unit: text('unit'),
  yakkaPrice: numeric('yakka_price', { precision: 12, scale: 2 }).notNull(),
  manufacturer: text('manufacturer'),
  category: text('category'), // 内用薬/外用薬/注射薬/歯科用薬剤
  therapeuticCategory: text('therapeutic_category'), // 薬効分類番号
  isListed: boolean('is_listed').default(true),
  listedDate: text('listed_date'),
  transitionDeadline: text('transition_deadline'), // 経過措置期限
  deletedDate: text('deleted_date'),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow(),
}, (table) => ({
  idxDrugMasterName: index('idx_drug_master_name').on(table.drugName),
  idxDrugMasterGenericName: index('idx_drug_master_generic_name').on(table.genericName),
  idxDrugMasterListedName: index('idx_drug_master_listed_name').on(table.isListed, table.drugName),
  chkYakkaPriceNonNeg: check('chk_drug_master_yakka_price', sql`${table.yakkaPrice} >= 0`),
}));

export const drugMasterPackages = pgTable('drug_master_packages', {
  id: serial('id').primaryKey(),
  drugMasterId: integer('drug_master_id').notNull().references(() => drugMaster.id, { onDelete: 'cascade' }),
  gs1Code: text('gs1_code'),   // 14桁 販売包装単位コード
  janCode: text('jan_code'),   // 13桁
  hotCode: text('hot_code'),   // 9〜13桁
  packageDescription: text('package_description'), // 例: 100錠(10錠×10)PTP
  packageQuantity: real('package_quantity'),
  packageUnit: text('package_unit'),
  normalizedPackageLabel: text('normalized_package_label'),
  packageForm: text('package_form'),
  isLoosePackage: boolean('is_loose_package').notNull().default(false),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow(),
}, (table) => ({
  idxDrugPackagesDrugMasterId: index('idx_drug_packages_drug_master_id').on(table.drugMasterId),
  idxDrugPackagesGs1: index('idx_drug_packages_gs1').on(table.gs1Code),
  idxDrugPackagesJan: index('idx_drug_packages_jan').on(table.janCode),
  idxDrugPackagesHot: index('idx_drug_packages_hot').on(table.hotCode),
  idxDrugPackagesNormalizedLabel: index('idx_drug_packages_normalized_label').on(table.normalizedPackageLabel),
}));

export const drugMasterPriceHistory = pgTable('drug_master_price_history', {
  id: serial('id').primaryKey(),
  yjCode: text('yj_code').notNull(),
  previousPrice: numeric('previous_price', { precision: 12, scale: 2 }),
  newPrice: numeric('new_price', { precision: 12, scale: 2 }),
  revisionDate: text('revision_date').notNull(),
  revisionType: drugMasterRevisionTypeEnum('revision_type').notNull(),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
}, (table) => ({
  idxPriceHistoryYjCode: index('idx_price_history_yj_code').on(table.yjCode),
  idxPriceHistoryDate: index('idx_price_history_date').on(table.revisionDate),
}));

export const drugMasterSyncLogs = pgTable('drug_master_sync_logs', {
  id: serial('id').primaryKey(),
  syncType: text('sync_type').notNull(), // manual / auto
  sourceDescription: text('source_description'),
  status: drugMasterSyncStatusEnum('status').notNull(),
  itemsProcessed: integer('items_processed').default(0),
  itemsAdded: integer('items_added').default(0),
  itemsUpdated: integer('items_updated').default(0),
  itemsDeleted: integer('items_deleted').default(0),
  errorMessage: text('error_message'),
  startedAt: timestamp('started_at', { mode: 'string' }).defaultNow(),
  completedAt: timestamp('completed_at', { mode: 'string' }),
  triggeredBy: integer('triggered_by').references(() => pharmacies.id, { onDelete: 'set null' }),
}, (table) => ({
  idxSyncLogsStartedAt: index('idx_sync_logs_started_at').on(table.startedAt),
}));

// ── アクティビティログ ──────────────────────────────────

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
  source: text('source').$type<SystemEventSource>().notNull(),
  level: text('level').$type<SystemEventLevel>().notNull().default('error'),
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

// ── エラーコードレジストリ ──────────────────────────────────

export const errorCodeCategoryValues = ['upload', 'auth', 'sync', 'system', 'openclaw'] as const;
export type ErrorCodeCategory = (typeof errorCodeCategoryValues)[number];

export const errorCodeSeverityValues = ['critical', 'error', 'warning', 'info'] as const;
export type ErrorCodeSeverity = (typeof errorCodeSeverityValues)[number];

export const errorCodes = pgTable('error_codes', {
  id: serial('id').primaryKey(),
  code: varchar('code', { length: 64 }).unique().notNull(),
  category: text('category').$type<ErrorCodeCategory>().notNull(),
  severity: text('severity').$type<ErrorCodeSeverity>().notNull(),
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

// ── OpenClawコマンド管理 ──────────────────────────────────

export const openclawCommands = pgTable('openclaw_commands', {
  id: serial('id').primaryKey(),
  commandName: varchar('command_name', { length: 64 }).notNull(),
  parameters: text('parameters'),
  status: varchar('status', { length: 16 }).notNull(),
  result: text('result'),
  errorMessage: text('error_message'),
  openclawThreadId: varchar('openclaw_thread_id', { length: 255 }),
  signature: varchar('signature', { length: 255 }).notNull(),
  receivedAt: timestamp('received_at', { mode: 'string' }).defaultNow(),
  completedAt: timestamp('completed_at', { mode: 'string' }),
}, (table) => ({
  idxOpenclawCommandsReceivedAt: index('idx_openclaw_commands_received_at').on(table.receivedAt),
  idxOpenclawCommandsStatus: index('idx_openclaw_commands_status').on(table.status),
  idxOpenclawCommandsName: index('idx_openclaw_commands_name').on(table.commandName),
}));

export const openclawCommandWhitelist = pgTable('openclaw_command_whitelist', {
  id: serial('id').primaryKey(),
  commandName: varchar('command_name', { length: 64 }).unique().notNull(),
  category: varchar('category', { length: 16 }).notNull(),
  descriptionJa: varchar('description_ja', { length: 255 }),
  isEnabled: boolean('is_enabled').default(true).notNull(),
  parametersSchema: text('parameters_schema'),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow(),
});

// ── 薬局リレーション（お気に入り / ブロック）────────────────

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

// ── マッチング予約・通知 ─────────────────────────────────

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
  topCandidatesJson: text('top_candidates_json').notNull(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow(),
}, (table) => ({
  idxMatchSnapshotsPharmacyUnique: uniqueIndex('idx_match_snapshots_pharmacy_unique')
    .on(table.pharmacyId),
}));

export const matchNotifications = pgTable('match_notifications', {
  id: serial('id').primaryKey(),
  pharmacyId: integer('pharmacy_id').notNull().references(() => pharmacies.id, { onDelete: 'cascade' }),
  triggerPharmacyId: integer('trigger_pharmacy_id').notNull().references(() => pharmacies.id, { onDelete: 'cascade' }),
  triggerUploadType: uploadTypeEnum('trigger_upload_type').notNull(),
  candidateCountBefore: integer('candidate_count_before').notNull().default(0),
  candidateCountAfter: integer('candidate_count_after').notNull().default(0),
  diffJson: text('diff_json').notNull(),
  dedupeKey: text('dedupe_key').notNull(),
  isRead: boolean('is_read').notNull().default(false),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
}, (table) => ({
  idxMatchNotificationsPharmacyCreated: index('idx_match_notifications_pharmacy_created')
    .on(table.pharmacyId, table.createdAt),
  idxMatchNotificationsUnread: index('idx_match_notifications_unread')
    .on(table.pharmacyId, table.isRead, table.createdAt),
  idxMatchNotificationsDedupe: uniqueIndex('idx_match_notifications_dedupe')
    .on(table.pharmacyId, table.dedupeKey),
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

export const uploadConfirmJobs = pgTable('upload_confirm_jobs', {
  id: serial('id').primaryKey(),
  pharmacyId: integer('pharmacy_id').notNull().references(() => pharmacies.id, { onDelete: 'cascade' }),
  uploadType: uploadTypeEnum('upload_type').notNull(),
  originalFilename: text('original_filename').notNull(),
  idempotencyKey: text('idempotency_key'),
  fileHash: text('file_hash').notNull(),
  headerRowIndex: integer('header_row_index').notNull(),
  mappingJson: text('mapping_json').notNull(),
  applyMode: text('apply_mode').notNull().default('replace'),
  deleteMissing: boolean('delete_missing').notNull().default(false),
  deduplicated: boolean('deduplicated').notNull().default(false),
  fileBase64: text('file_base64').notNull(),
  status: uploadJobStatusEnum('status').notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
  resultJson: text('result_json'),
  cancelRequestedAt: timestamp('cancel_requested_at', { mode: 'string' }),
  canceledAt: timestamp('canceled_at', { mode: 'string' }),
  canceledBy: integer('canceled_by').references(() => pharmacies.id, { onDelete: 'set null' }),
  processingStartedAt: timestamp('processing_started_at', { mode: 'string' }),
  nextRetryAt: timestamp('next_retry_at', { mode: 'string' }),
  completedAt: timestamp('completed_at', { mode: 'string' }),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow(),
}, (table) => ({
  idxUploadConfirmJobsPharmacyCreated: index('idx_upload_confirm_jobs_pharmacy_created')
    .on(table.pharmacyId, table.createdAt),
  idxUploadConfirmJobsPharmacyIdempotency: index('idx_upload_confirm_jobs_pharmacy_idempotency')
    .on(table.pharmacyId, table.idempotencyKey),
  idxUploadConfirmJobsIdempotencyActive: uniqueIndex('idx_upload_confirm_jobs_idempotency_active')
    .on(table.pharmacyId, table.idempotencyKey)
    .where(sql`${table.idempotencyKey} IS NOT NULL AND ${table.status} IN ('pending', 'processing')`),
  idxUploadConfirmJobsPharmacyFileHashCreated: index('idx_upload_confirm_jobs_pharmacy_file_hash_created')
    .on(table.pharmacyId, table.fileHash, table.createdAt),
  idxUploadConfirmJobsReady: index('idx_upload_confirm_jobs_ready')
    .on(table.status, table.attempts, table.nextRetryAt, table.processingStartedAt, table.createdAt),
  chkUploadConfirmJobsApplyMode: check('chk_upload_confirm_jobs_apply_mode', sql`${table.applyMode} IN ('replace', 'diff', 'partial')`),
  chkUploadConfirmJobsAttemptsNonNegative: check('chk_upload_confirm_jobs_attempts_non_negative', sql`${table.attempts} >= 0`),
}));

export const uploadRowIssues = pgTable('upload_row_issues', {
  id: serial('id').primaryKey(),
  jobId: integer('job_id').notNull().references(() => uploadConfirmJobs.id, { onDelete: 'cascade' }),
  pharmacyId: integer('pharmacy_id').notNull().references(() => pharmacies.id, { onDelete: 'cascade' }),
  uploadType: uploadTypeEnum('upload_type').notNull(),
  rowNumber: integer('row_number').notNull(),
  issueCode: text('issue_code').notNull(),
  issueMessage: text('issue_message').notNull(),
  rowDataJson: text('row_data_json'),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
}, (table) => ({
  idxUploadRowIssuesJobRow: index('idx_upload_row_issues_job_row')
    .on(table.jobId, table.rowNumber, table.id),
  idxUploadRowIssuesPharmacyCreated: index('idx_upload_row_issues_pharmacy_created')
    .on(table.pharmacyId, table.createdAt),
  chkUploadRowIssuesRowNumber: check('chk_upload_row_issues_row_number', sql`${table.rowNumber} > 0`),
}));

export const matchingRuleProfiles = pgTable('matching_rule_profiles', {
  id: serial('id').primaryKey(),
  profileName: text('profile_name').notNull(),
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
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow(),
}, (table) => ({
  idxMatchingRuleProfilesNameUnique: uniqueIndex('idx_matching_rule_profiles_name_unique')
    .on(table.profileName),
  idxMatchingRuleProfilesActiveUnique: uniqueIndex('idx_matching_rule_profiles_active_unique')
    .on(table.isActive)
    .where(sql`${table.isActive} = true`),
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
  chkMatchingRuleVersion: check('chk_matching_rule_version', sql`${table.version} >= 1`),
}));

// ── 通知 ──────────────────────────────────────────────────

export const notificationTypeValues = ['proposal_received', 'proposal_status_changed', 'new_comment', 'request_update'] as const;
export type NotificationType = (typeof notificationTypeValues)[number];

export const notificationReferenceTypeValues = ['proposal', 'match', 'comment', 'request'] as const;
export type NotificationReferenceType = (typeof notificationReferenceTypeValues)[number];
export const predictiveAlertTypeValues = ['near_expiry', 'excess_stock'] as const;
export type PredictiveAlertType = (typeof predictiveAlertTypeValues)[number];

export const notifications = pgTable('notifications', {
  id: serial('id').primaryKey(),
  pharmacyId: integer('pharmacy_id').notNull().references(() => pharmacies.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  title: text('title').notNull(),
  message: text('message').notNull(),
  referenceType: text('reference_type'),
  referenceId: integer('reference_id'),
  isRead: boolean('is_read').notNull().default(false),
  readAt: timestamp('read_at', { mode: 'string' }),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
}, (table) => ({
  idxNotificationsPharmacyUnread: index('idx_notifications_pharmacy_unread')
    .on(table.pharmacyId, table.isRead, table.createdAt),
}));

export const predictiveAlerts = pgTable('predictive_alerts', {
  id: serial('id').primaryKey(),
  pharmacyId: integer('pharmacy_id').notNull().references(() => pharmacies.id, { onDelete: 'cascade' }),
  alertType: text('alert_type').$type<PredictiveAlertType>().notNull(),
  title: text('title').notNull(),
  message: text('message').notNull(),
  detailJson: text('detail_json').notNull(),
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

// ── 医薬品マスターソース状態 ──────────────────────────────

export const drugMasterSourceState = pgTable('drug_master_source_state', {
  id: serial('id').primaryKey(),
  sourceKey: text('source_key').notNull().unique(),
  url: text('url').notNull(),
  etag: text('etag'),
  lastModified: text('last_modified'),
  contentHash: text('content_hash'),
  lastCheckedAt: timestamp('last_checked_at', { mode: 'string' }),
  lastChangedAt: timestamp('last_changed_at', { mode: 'string' }),
  metadataJson: text('metadata_json'),
}, (table) => ({
  idxSourceStateSourceKey: uniqueIndex('idx_source_state_source_key').on(table.sourceKey),
}));
