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
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const pharmacyRelationshipTypeEnum = pgEnum('pharmacy_relationship_type_enum', ['favorite', 'blocked']);
export const uploadTypeEnum = pgEnum('upload_type_enum', ['dead_stock', 'used_medication']);
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
  version: integer('version').notNull().default(1),
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
  ipAddress: text('ip_address'),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
}, (table) => ({
  idxActivityLogsCreatedAt: index('idx_activity_logs_created_at')
    .on(table.createdAt),
  idxActivityLogsPharmacyCreated: index('idx_activity_logs_pharmacy_created')
    .on(table.pharmacyId, table.createdAt),
  idxActivityLogsAction: index('idx_activity_logs_action')
    .on(table.action, table.createdAt),
  idxActivityLogsFailurePatternScan: index('idx_activity_logs_failure_pattern_scan')
    .on(table.action, table.createdAt)
    .where(sql`${table.detail} LIKE '失敗|%'`),
}));

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

// ── 通知 ──────────────────────────────────────────────────

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
