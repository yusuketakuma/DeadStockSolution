import { sql } from 'drizzle-orm';
import { pgTable, serial, text, integer, real, numeric, boolean, timestamp, jsonb, index, uniqueIndex, check } from 'drizzle-orm/pg-core';
import { pharmacies } from './schema-pharmacy';
import { drugMasterRevisionTypeEnum, drugMasterSyncStatusEnum, equivalenceTypeEnum } from './schema-common';

export const drugMaster = pgTable('drug_master', {
  id: serial('id').primaryKey(),
  yjCode: text('yj_code').notNull().unique(),
  drugName: text('drug_name').notNull(),
  genericName: text('generic_name'),
  specification: text('specification'),
  unit: text('unit'),
  yakkaPrice: numeric('yakka_price', { precision: 12, scale: 2 }).notNull(),
  manufacturer: text('manufacturer'),
  category: text('category'),
  therapeuticCategory: text('therapeutic_category'),
  isListed: boolean('is_listed').default(true),
  listedDate: text('listed_date'),
  transitionDeadline: text('transition_deadline'),
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
  gs1Code: text('gs1_code'),
  janCode: text('jan_code'),
  hotCode: text('hot_code'),
  packageDescription: text('package_description'),
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
  syncType: text('sync_type').notNull(),
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

export const drugEquivalences = pgTable('drug_equivalences', {
  id: serial('id').primaryKey(),
  drugNameA: text('drug_name_a').notNull(),
  drugNameB: text('drug_name_b').notNull(),
  equivalenceType: equivalenceTypeEnum('equivalence_type').notNull(),
  notes: text('notes'),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow(),
}, (table) => ({
  idxDrugEquivalencesDrugNameA: index('idx_drug_equivalences_drug_name_a')
    .on(table.drugNameA),
  idxDrugEquivalencesDrugNameB: index('idx_drug_equivalences_drug_name_b')
    .on(table.drugNameB),
  idxDrugEquivalencesType: index('idx_drug_equivalences_type')
    .on(table.equivalenceType),
  idxDrugEquivalencesUniquePair: uniqueIndex('idx_drug_equivalences_unique_pair')
    .on(table.drugNameA, table.drugNameB),
}));

export const drugMasterSourceState = pgTable('drug_master_source_state', {
  id: serial('id').primaryKey(),
  sourceKey: text('source_key').notNull().unique(),
  url: text('url').notNull(),
  etag: text('etag'),
  lastModified: text('last_modified'),
  contentHash: text('content_hash'),
  lastCheckedAt: timestamp('last_checked_at', { mode: 'string' }),
  lastChangedAt: timestamp('last_changed_at', { mode: 'string' }),
  metadataJson: jsonb('metadata_json'),
}, (table) => ({
  idxSourceStateSourceKey: uniqueIndex('idx_source_state_source_key').on(table.sourceKey),
}));
