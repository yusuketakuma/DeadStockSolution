import { sql } from 'drizzle-orm';
import { pgTable, serial, text, date, integer, real, numeric, boolean, timestamp, index, uniqueIndex, check } from 'drizzle-orm/pg-core';
import { pharmacies } from './schema-auth';
import { uploadTypeEnum } from './schema-common';

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
  idxDeadStockPharmacyDrugMasterAvailable: index('idx_dead_stock_pharmacy_drug_master_available')
    .on(table.pharmacyId, table.drugMasterId)
    .where(sql`${table.isAvailable} = true`),
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
