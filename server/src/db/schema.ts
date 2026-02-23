import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const pharmacies = sqliteTable('pharmacies', {
  id: integer('id').primaryKey({ autoIncrement: true }),
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
  isAdmin: integer('is_admin', { mode: 'boolean' }).default(false),
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
});

export const uploads = sqliteTable('uploads', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  pharmacyId: integer('pharmacy_id').notNull().references(() => pharmacies.id),
  uploadType: text('upload_type', { enum: ['dead_stock', 'used_medication'] }).notNull(),
  originalFilename: text('original_filename').notNull(),
  columnMapping: text('column_mapping'),
  rowCount: integer('row_count'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
});

export const deadStockItems = sqliteTable('dead_stock_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  pharmacyId: integer('pharmacy_id').notNull().references(() => pharmacies.id),
  uploadId: integer('upload_id').notNull().references(() => uploads.id),
  drugCode: text('drug_code'),
  drugName: text('drug_name').notNull(),
  quantity: real('quantity').notNull(),
  unit: text('unit'),
  yakkaUnitPrice: real('yakka_unit_price'),
  yakkaTotal: real('yakka_total'),
  expirationDate: text('expiration_date'),
  lotNumber: text('lot_number'),
  isAvailable: integer('is_available', { mode: 'boolean' }).default(true),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
});

export const usedMedicationItems = sqliteTable('used_medication_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  pharmacyId: integer('pharmacy_id').notNull().references(() => pharmacies.id),
  uploadId: integer('upload_id').notNull().references(() => uploads.id),
  drugCode: text('drug_code'),
  drugName: text('drug_name').notNull(),
  monthlyUsage: real('monthly_usage'),
  unit: text('unit'),
  yakkaUnitPrice: real('yakka_unit_price'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
});

export const exchangeProposals = sqliteTable('exchange_proposals', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  pharmacyAId: integer('pharmacy_a_id').notNull().references(() => pharmacies.id),
  pharmacyBId: integer('pharmacy_b_id').notNull().references(() => pharmacies.id),
  status: text('status', {
    enum: ['proposed', 'accepted_a', 'accepted_b', 'confirmed', 'rejected', 'completed', 'cancelled'],
  }).notNull().default('proposed'),
  totalValueA: real('total_value_a'),
  totalValueB: real('total_value_b'),
  valueDifference: real('value_difference'),
  proposedAt: text('proposed_at').default(sql`CURRENT_TIMESTAMP`),
  completedAt: text('completed_at'),
});

export const exchangeProposalItems = sqliteTable('exchange_proposal_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  proposalId: integer('proposal_id').notNull().references(() => exchangeProposals.id),
  deadStockItemId: integer('dead_stock_item_id').notNull().references(() => deadStockItems.id),
  fromPharmacyId: integer('from_pharmacy_id').notNull().references(() => pharmacies.id),
  toPharmacyId: integer('to_pharmacy_id').notNull().references(() => pharmacies.id),
  quantity: real('quantity').notNull(),
  yakkaValue: real('yakka_value'),
});

export const exchangeHistory = sqliteTable('exchange_history', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  proposalId: integer('proposal_id').notNull().references(() => exchangeProposals.id),
  pharmacyAId: integer('pharmacy_a_id').notNull().references(() => pharmacies.id),
  pharmacyBId: integer('pharmacy_b_id').notNull().references(() => pharmacies.id),
  totalValue: real('total_value'),
  completedAt: text('completed_at').default(sql`CURRENT_TIMESTAMP`),
});

export const columnMappingTemplates = sqliteTable('column_mapping_templates', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  pharmacyId: integer('pharmacy_id').notNull().references(() => pharmacies.id),
  uploadType: text('upload_type', { enum: ['dead_stock', 'used_medication'] }).notNull(),
  headerHash: text('header_hash').notNull(),
  mapping: text('mapping').notNull(),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
});

export const adminMessages = sqliteTable('admin_messages', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  senderAdminId: integer('sender_admin_id').notNull().references(() => pharmacies.id),
  targetType: text('target_type', { enum: ['all', 'pharmacy'] }).notNull().default('all'),
  targetPharmacyId: integer('target_pharmacy_id').references(() => pharmacies.id),
  title: text('title').notNull(),
  body: text('body').notNull(),
  actionPath: text('action_path'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
});

export const adminMessageReads = sqliteTable('admin_message_reads', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  messageId: integer('message_id').notNull().references(() => adminMessages.id),
  pharmacyId: integer('pharmacy_id').notNull().references(() => pharmacies.id),
  readAt: text('read_at').default(sql`CURRENT_TIMESTAMP`),
});
