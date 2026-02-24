import {
  pgEnum,
  pgTable,
  serial,
  text,
  integer,
  real,
  boolean,
  timestamp,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

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
export const drugMasterSyncStatusEnum = pgEnum('drug_master_sync_status_enum', ['running', 'success', 'failed', 'partial']);
export const drugMasterRevisionTypeEnum = pgEnum('drug_master_revision_type_enum', ['price_revision', 'new_listing', 'delisting', 'transition']);

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
}));

export const deadStockItems = pgTable('dead_stock_items', {
  id: serial('id').primaryKey(),
  pharmacyId: integer('pharmacy_id').notNull().references(() => pharmacies.id, { onDelete: 'cascade' }),
  uploadId: integer('upload_id').notNull().references(() => uploads.id, { onDelete: 'cascade' }),
  drugCode: text('drug_code'),
  drugName: text('drug_name').notNull(),
  drugMasterId: integer('drug_master_id'),
  quantity: real('quantity').notNull(),
  unit: text('unit'),
  yakkaUnitPrice: real('yakka_unit_price'),
  yakkaTotal: real('yakka_total'),
  expirationDate: text('expiration_date'),
  lotNumber: text('lot_number'),
  isAvailable: boolean('is_available').default(true),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
}, (table) => ({
  idxDeadStockPharmacyAvailableCreated: index('idx_dead_stock_pharmacy_available_created')
    .on(table.pharmacyId, table.isAvailable, table.createdAt),
  idxDeadStockAvailableName: index('idx_dead_stock_available_name')
    .on(table.isAvailable, table.drugName),
  idxDeadStockDrugMasterId: index('idx_dead_stock_drug_master_id')
    .on(table.drugMasterId),
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
  monthlyUsage: real('monthly_usage'),
  unit: text('unit'),
  yakkaUnitPrice: real('yakka_unit_price'),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
}, (table) => ({
  idxUsedMedicationPharmacyCreated: index('idx_used_medication_pharmacy_created')
    .on(table.pharmacyId, table.createdAt),
  idxUsedMedDrugMasterId: index('idx_used_med_drug_master_id')
    .on(table.drugMasterId),
  chkYakkaUnitPriceNonNeg: check('chk_used_med_yakka_price', sql`${table.yakkaUnitPrice} IS NULL OR ${table.yakkaUnitPrice} >= 0`),
}));

export const exchangeProposals = pgTable('exchange_proposals', {
  id: serial('id').primaryKey(),
  pharmacyAId: integer('pharmacy_a_id').notNull().references(() => pharmacies.id),
  pharmacyBId: integer('pharmacy_b_id').notNull().references(() => pharmacies.id),
  status: exchangeStatusEnum('status').notNull().default('proposed'),
  totalValueA: real('total_value_a'),
  totalValueB: real('total_value_b'),
  valueDifference: real('value_difference'),
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
  yakkaValue: real('yakka_value'),
}, (table) => ({
  idxExchangeItemsProposal: index('idx_exchange_items_proposal').on(table.proposalId),
  chkQuantityPositive: check('chk_exchange_item_quantity', sql`${table.quantity} > 0`),
}));

export const exchangeHistory = pgTable('exchange_history', {
  id: serial('id').primaryKey(),
  proposalId: integer('proposal_id').notNull().references(() => exchangeProposals.id),
  pharmacyAId: integer('pharmacy_a_id').notNull().references(() => pharmacies.id),
  pharmacyBId: integer('pharmacy_b_id').notNull().references(() => pharmacies.id),
  totalValue: real('total_value'),
  completedAt: timestamp('completed_at', { mode: 'string' }).defaultNow(),
}, (table) => ({
  idxExchangeHistoryACompleted: index('idx_exchange_history_a_completed')
    .on(table.pharmacyAId, table.completedAt),
  idxExchangeHistoryBCompleted: index('idx_exchange_history_b_completed')
    .on(table.pharmacyBId, table.completedAt),
  idxExchangeHistoryProposal: index('idx_exchange_history_proposal')
    .on(table.proposalId),
}));

export const columnMappingTemplates = pgTable('column_mapping_templates', {
  id: serial('id').primaryKey(),
  pharmacyId: integer('pharmacy_id').notNull().references(() => pharmacies.id, { onDelete: 'cascade' }),
  uploadType: uploadTypeEnum('upload_type').notNull(),
  headerHash: text('header_hash').notNull(),
  mapping: text('mapping').notNull(),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
}, (table) => ({
  idxMappingTemplatesPharmacyTypeHash: index('idx_mapping_templates_pharmacy_type_hash')
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
}));

export const pharmacyBusinessHours = pgTable('pharmacy_business_hours', {
  id: serial('id').primaryKey(),
  pharmacyId: integer('pharmacy_id').notNull().references(() => pharmacies.id, { onDelete: 'cascade' }),
  dayOfWeek: integer('day_of_week').notNull(), // 0=日曜, 1=月曜, ..., 6=土曜
  openTime: text('open_time'), // "09:00" format, null if closed
  closeTime: text('close_time'), // "18:00" format, null if closed
  isClosed: boolean('is_closed').default(false),
  is24Hours: boolean('is_24_hours').default(false),
}, (table) => ({
  idxBusinessHoursPharmacy: index('idx_business_hours_pharmacy').on(table.pharmacyId),
  idxBusinessHoursPharmacyDay: uniqueIndex('idx_business_hours_pharmacy_day').on(table.pharmacyId, table.dayOfWeek),
  chkDayOfWeek: check('chk_day_of_week', sql`${table.dayOfWeek} >= 0 AND ${table.dayOfWeek} <= 6`),
}));

// ── 医薬品マスター ──────────────────────────────────────

export const drugMaster = pgTable('drug_master', {
  id: serial('id').primaryKey(),
  yjCode: text('yj_code').notNull().unique(),
  drugName: text('drug_name').notNull(),
  genericName: text('generic_name'),
  specification: text('specification'),
  unit: text('unit'),
  yakkaPrice: real('yakka_price').notNull(),
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
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow(),
}, (table) => ({
  idxDrugPackagesDrugMasterId: index('idx_drug_packages_drug_master_id').on(table.drugMasterId),
  idxDrugPackagesGs1: index('idx_drug_packages_gs1').on(table.gs1Code),
  idxDrugPackagesJan: index('idx_drug_packages_jan').on(table.janCode),
  idxDrugPackagesHot: index('idx_drug_packages_hot').on(table.hotCode),
}));

export const drugMasterPriceHistory = pgTable('drug_master_price_history', {
  id: serial('id').primaryKey(),
  yjCode: text('yj_code').notNull(),
  previousPrice: real('previous_price'),
  newPrice: real('new_price'),
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
}));
