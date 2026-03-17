import { sql } from 'drizzle-orm';
import { pgTable, serial, text, integer, boolean, timestamp, index, uniqueIndex, check } from 'drizzle-orm/pg-core';
import { pharmacies } from './schema-pharmacy';
import { uploadJobStatusEnum, uploadTypeEnum } from './schema-common';

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
