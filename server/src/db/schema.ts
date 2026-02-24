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
  chkQuantityPositive: check('chk_dead_stock_quantity', sql`${table.quantity} > 0`),
  chkYakkaUnitPriceNonNeg: check('chk_dead_stock_yakka_price', sql`${table.yakkaUnitPrice} IS NULL OR ${table.yakkaUnitPrice} >= 0`),
}));

export const usedMedicationItems = pgTable('used_medication_items', {
  id: serial('id').primaryKey(),
  pharmacyId: integer('pharmacy_id').notNull().references(() => pharmacies.id, { onDelete: 'cascade' }),
  uploadId: integer('upload_id').notNull().references(() => uploads.id, { onDelete: 'cascade' }),
  drugCode: text('drug_code'),
  drugName: text('drug_name').notNull(),
  monthlyUsage: real('monthly_usage'),
  unit: text('unit'),
  yakkaUnitPrice: real('yakka_unit_price'),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
}, (table) => ({
  idxUsedMedicationPharmacyCreated: index('idx_used_medication_pharmacy_created')
    .on(table.pharmacyId, table.createdAt),
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
  idxExchangeHistoryStatus: index('idx_exchange_history_proposal')
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
