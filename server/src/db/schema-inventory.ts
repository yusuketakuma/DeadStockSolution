import { sql } from 'drizzle-orm';
import { pgTable, serial, text, date, integer, real, numeric, boolean, timestamp, index, uniqueIndex, check } from 'drizzle-orm/pg-core';
import { pharmacies } from './schema-pharmacy';
import { uploadJobStatusEnum, uploadTypeEnum } from './schema-common';

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
