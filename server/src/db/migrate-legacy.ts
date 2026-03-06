import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { createClient, type Client } from '@libsql/client';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/vercel-postgres/migrator';
import { db } from '../config/database';
import { logger } from '../services/logger';
import {
  pharmacies,
  uploads,
  deadStockItems,
  usedMedicationItems,
  exchangeProposals,
  exchangeProposalItems,
  exchangeHistory,
  columnMappingTemplates,
  adminMessages,
  adminMessageReads,
} from './schema';
import { applyPerformanceScaleIndexes } from './performance-scale-indexes';

type LegacyRow = Record<string, unknown>;

const uploadTypes = new Set(['dead_stock', 'used_medication'] as const);
const exchangeStatuses = new Set([
  'proposed',
  'accepted_a',
  'accepted_b',
  'confirmed',
  'rejected',
  'completed',
  'cancelled',
] as const);
const messageTargetTypes = new Set(['all', 'pharmacy'] as const);
const SEQUENCE_TABLE_NAMES = [
  'pharmacies',
  'uploads',
  'dead_stock_items',
  'used_medication_items',
  'exchange_proposals',
  'exchange_proposal_items',
  'exchange_history',
  'column_mapping_templates',
  'admin_messages',
  'admin_message_reads',
] as const;

const CHUNK_SIZE = 300;

function toNumber(value: unknown, fieldName: string): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  throw new Error(`Invalid numeric value in ${fieldName}: ${String(value)}`);
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  return toNumber(value, 'nullable_number');
}

function toNullableNumericString(value: unknown): string | null {
  const num = toNullableNumber(value);
  return num === null ? null : String(num);
}

function toBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'bigint') return value !== 0n;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 't', 'yes', 'y'].includes(normalized)) return true;
    if (['0', 'false', 'f', 'no', 'n'].includes(normalized)) return false;
  }
  throw new Error(`Invalid boolean value: ${String(value)}`);
}

function toNullableBoolean(value: unknown): boolean | null {
  if (value === null || value === undefined || value === '') return null;
  return toBoolean(value);
}

function toStringValue(value: unknown, fieldName: string): string {
  if (value === null || value === undefined) {
    throw new Error(`Missing required field: ${fieldName}`);
  }
  return String(value);
}

function toNullableString(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  return String(value);
}

function toOptionalString(value: unknown): string | undefined {
  return toNullableString(value) ?? undefined;
}

function parseSetValue<T extends string>(value: unknown, allowedValues: Set<T>, errorLabel: string): T {
  const normalized = String(value) as T;
  if (allowedValues.has(normalized)) {
    return normalized;
  }
  throw new Error(`Invalid ${errorLabel}: ${normalized}`);
}

function toUploadType(value: unknown): 'dead_stock' | 'used_medication' {
  return parseSetValue(value, uploadTypes, 'upload_type');
}

function toExchangeStatus(value: unknown): 'proposed' | 'accepted_a' | 'accepted_b' | 'confirmed' | 'rejected' | 'completed' | 'cancelled' {
  return parseSetValue(value, exchangeStatuses, 'exchange status');
}

function toMessageTargetType(value: unknown): 'all' | 'pharmacy' {
  return parseSetValue(value, messageTargetTypes, 'message target type');
}

function toLibsqlFileUrl(filePath: string): string {
  return `file:${filePath.replace(/\\/g, '/')}`;
}

function resolveLegacyUrl(): { url: string; authToken?: string } {
  const url = process.env.LEGACY_DATABASE_URL ?? process.env.TURSO_DATABASE_URL;
  const authToken = process.env.LEGACY_AUTH_TOKEN ?? process.env.TURSO_AUTH_TOKEN;

  if (url) {
    return { url, authToken };
  }

  const explicitPath = process.env.LEGACY_SQLITE_PATH;
  const candidates = [
    explicitPath,
    path.resolve(process.cwd(), 'local.db'),
    path.resolve(process.cwd(), 'server/local.db'),
    path.resolve(process.cwd(), '../local.db'),
    path.resolve(__dirname, '../../local.db'),
    path.resolve(__dirname, '../../../local.db'),
  ].filter((candidate): candidate is string => Boolean(candidate));

  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error('Legacy DB not found. Set LEGACY_DATABASE_URL or LEGACY_SQLITE_PATH.');
  }

  return { url: toLibsqlFileUrl(found) };
}

async function readLegacyTable(client: Client, tableName: string): Promise<LegacyRow[]> {
  try {
    const result = await client.execute(`SELECT * FROM "${tableName}" ORDER BY id ASC`);
    return result.rows as LegacyRow[];
  } catch (err) {
    const message = err instanceof Error ? err.message.toLowerCase() : '';
    if (message.includes('no such table')) {
      logger.warn(`[skip] legacy table "${tableName}" does not exist`);
      return [];
    }
    throw err;
  }
}

async function insertChunked<T>(tableName: string, rows: T[], inserter: (chunk: T[]) => Promise<void>): Promise<void> {
  if (rows.length === 0) {
    logger.info(`[ok] ${tableName}: 0 rows`);
    return;
  }

  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    await inserter(chunk);
  }
  logger.info(`[ok] ${tableName}: ${rows.length} rows`);
}

async function migrateTable<T>(
  legacy: Client,
  tableName: string,
  mapper: (row: LegacyRow) => T,
  inserter: (chunk: T[]) => Promise<void>,
): Promise<void> {
  const rows = await readLegacyTable(legacy, tableName);
  await insertChunked(tableName, rows.map(mapper), inserter);
}

async function syncSequence(tableName: string): Promise<void> {
  await db.execute(sql.raw(`
    SELECT setval(
      pg_get_serial_sequence('"${tableName}"', 'id'),
      COALESCE((SELECT MAX(id) FROM "${tableName}"), 1),
      COALESCE((SELECT MAX(id) IS NOT NULL FROM "${tableName}"), false)
    );
  `));
}

async function clearTargetData(): Promise<void> {
  await db.execute(sql.raw(`
    TRUNCATE TABLE
      "admin_message_reads",
      "admin_messages",
      "user_requests",
      "exchange_history",
      "exchange_proposal_items",
      "exchange_proposals",
      "used_medication_items",
      "dead_stock_items",
      "column_mapping_templates",
      "uploads",
      "pharmacies"
    RESTART IDENTITY CASCADE;
  `));
}

async function main() {
  logger.info('Running PostgreSQL schema migration...');
  await migrate(db, { migrationsFolder: './drizzle' });
  await applyPerformanceScaleIndexes();

  const replaceMode = process.env.LEGACY_MIGRATION_MODE === 'replace';
  if (replaceMode) {
    logger.info('LEGACY_MIGRATION_MODE=replace detected. Target tables will be truncated first.');
    await clearTargetData();
  }

  const { url, authToken } = resolveLegacyUrl();
  logger.info(`Using legacy source: ${url.startsWith('file:') ? url : '[remote]'}`);

  const legacy = createClient({ url, authToken });

  try {
    await migrateTable(legacy, 'pharmacies', (row) => ({
      id: toNumber(row.id, 'pharmacies.id'),
      email: toStringValue(row.email, 'pharmacies.email'),
      passwordHash: toStringValue(row.password_hash, 'pharmacies.password_hash'),
      name: toStringValue(row.name, 'pharmacies.name'),
      postalCode: toStringValue(row.postal_code, 'pharmacies.postal_code'),
      address: toStringValue(row.address, 'pharmacies.address'),
      phone: toStringValue(row.phone, 'pharmacies.phone'),
      fax: toStringValue(row.fax, 'pharmacies.fax'),
      licenseNumber: toStringValue(row.license_number, 'pharmacies.license_number'),
      prefecture: toStringValue(row.prefecture, 'pharmacies.prefecture'),
      latitude: toNullableNumber(row.latitude),
      longitude: toNullableNumber(row.longitude),
      isAdmin: toNullableBoolean(row.is_admin) ?? false,
      isActive: toNullableBoolean(row.is_active) ?? true,
      createdAt: toOptionalString(row.created_at),
      updatedAt: toOptionalString(row.updated_at),
    }), async (chunk) => {
      await db.insert(pharmacies).values(chunk).onConflictDoNothing();
    });

    await migrateTable(legacy, 'uploads', (row) => ({
      id: toNumber(row.id, 'uploads.id'),
      pharmacyId: toNumber(row.pharmacy_id, 'uploads.pharmacy_id'),
      uploadType: toUploadType(row.upload_type),
      originalFilename: toStringValue(row.original_filename, 'uploads.original_filename'),
      columnMapping: toNullableString(row.column_mapping),
      rowCount: toNullableNumber(row.row_count),
      createdAt: toOptionalString(row.created_at),
    }), async (chunk) => {
      await db.insert(uploads).values(chunk).onConflictDoNothing();
    });

    await migrateTable(legacy, 'dead_stock_items', (row) => ({
      id: toNumber(row.id, 'dead_stock_items.id'),
      pharmacyId: toNumber(row.pharmacy_id, 'dead_stock_items.pharmacy_id'),
      uploadId: toNumber(row.upload_id, 'dead_stock_items.upload_id'),
      drugCode: toNullableString(row.drug_code),
      drugName: toStringValue(row.drug_name, 'dead_stock_items.drug_name'),
      quantity: toNumber(row.quantity, 'dead_stock_items.quantity'),
      unit: toNullableString(row.unit),
      yakkaUnitPrice: toNullableNumericString(row.yakka_unit_price),
      yakkaTotal: toNullableNumericString(row.yakka_total),
      expirationDate: toNullableString(row.expiration_date),
      lotNumber: toNullableString(row.lot_number),
      isAvailable: toNullableBoolean(row.is_available) ?? true,
      createdAt: toOptionalString(row.created_at),
    }), async (chunk) => {
      await db.insert(deadStockItems).values(chunk).onConflictDoNothing();
    });

    await migrateTable(legacy, 'used_medication_items', (row) => ({
      id: toNumber(row.id, 'used_medication_items.id'),
      pharmacyId: toNumber(row.pharmacy_id, 'used_medication_items.pharmacy_id'),
      uploadId: toNumber(row.upload_id, 'used_medication_items.upload_id'),
      drugCode: toNullableString(row.drug_code),
      drugName: toStringValue(row.drug_name, 'used_medication_items.drug_name'),
      monthlyUsage: toNullableNumber(row.monthly_usage),
      unit: toNullableString(row.unit),
      yakkaUnitPrice: toNullableNumericString(row.yakka_unit_price),
      createdAt: toOptionalString(row.created_at),
    }), async (chunk) => {
      await db.insert(usedMedicationItems).values(chunk).onConflictDoNothing();
    });

    await migrateTable(legacy, 'exchange_proposals', (row) => ({
      id: toNumber(row.id, 'exchange_proposals.id'),
      pharmacyAId: toNumber(row.pharmacy_a_id, 'exchange_proposals.pharmacy_a_id'),
      pharmacyBId: toNumber(row.pharmacy_b_id, 'exchange_proposals.pharmacy_b_id'),
      status: toExchangeStatus(row.status),
      totalValueA: toNullableNumericString(row.total_value_a),
      totalValueB: toNullableNumericString(row.total_value_b),
      valueDifference: toNullableNumericString(row.value_difference),
      proposedAt: toOptionalString(row.proposed_at),
      completedAt: toNullableString(row.completed_at),
    }), async (chunk) => {
      await db.insert(exchangeProposals).values(chunk).onConflictDoNothing();
    });

    await migrateTable(legacy, 'exchange_proposal_items', (row) => ({
      id: toNumber(row.id, 'exchange_proposal_items.id'),
      proposalId: toNumber(row.proposal_id, 'exchange_proposal_items.proposal_id'),
      deadStockItemId: toNumber(row.dead_stock_item_id, 'exchange_proposal_items.dead_stock_item_id'),
      fromPharmacyId: toNumber(row.from_pharmacy_id, 'exchange_proposal_items.from_pharmacy_id'),
      toPharmacyId: toNumber(row.to_pharmacy_id, 'exchange_proposal_items.to_pharmacy_id'),
      quantity: toNumber(row.quantity, 'exchange_proposal_items.quantity'),
      yakkaValue: toNullableNumericString(row.yakka_value),
    }), async (chunk) => {
      await db.insert(exchangeProposalItems).values(chunk).onConflictDoNothing();
    });

    await migrateTable(legacy, 'exchange_history', (row) => ({
      id: toNumber(row.id, 'exchange_history.id'),
      proposalId: toNumber(row.proposal_id, 'exchange_history.proposal_id'),
      pharmacyAId: toNumber(row.pharmacy_a_id, 'exchange_history.pharmacy_a_id'),
      pharmacyBId: toNumber(row.pharmacy_b_id, 'exchange_history.pharmacy_b_id'),
      totalValue: toNullableNumericString(row.total_value),
      completedAt: toOptionalString(row.completed_at),
    }), async (chunk) => {
      await db.insert(exchangeHistory).values(chunk).onConflictDoNothing();
    });

    await migrateTable(legacy, 'column_mapping_templates', (row) => ({
      id: toNumber(row.id, 'column_mapping_templates.id'),
      pharmacyId: toNumber(row.pharmacy_id, 'column_mapping_templates.pharmacy_id'),
      uploadType: toUploadType(row.upload_type),
      headerHash: toStringValue(row.header_hash, 'column_mapping_templates.header_hash'),
      mapping: toStringValue(row.mapping, 'column_mapping_templates.mapping'),
      createdAt: toOptionalString(row.created_at),
    }), async (chunk) => {
      await db.insert(columnMappingTemplates).values(chunk).onConflictDoNothing();
    });

    await migrateTable(legacy, 'admin_messages', (row) => ({
      id: toNumber(row.id, 'admin_messages.id'),
      senderAdminId: toNumber(row.sender_admin_id, 'admin_messages.sender_admin_id'),
      targetType: toMessageTargetType(row.target_type),
      targetPharmacyId: toNullableNumber(row.target_pharmacy_id),
      title: toStringValue(row.title, 'admin_messages.title'),
      body: toStringValue(row.body, 'admin_messages.body'),
      actionPath: toNullableString(row.action_path),
      createdAt: toOptionalString(row.created_at),
    }), async (chunk) => {
      await db.insert(adminMessages).values(chunk).onConflictDoNothing();
    });

    await migrateTable(legacy, 'admin_message_reads', (row) => ({
      id: toNumber(row.id, 'admin_message_reads.id'),
      messageId: toNumber(row.message_id, 'admin_message_reads.message_id'),
      pharmacyId: toNumber(row.pharmacy_id, 'admin_message_reads.pharmacy_id'),
      readAt: toOptionalString(row.read_at),
    }), async (chunk) => {
      await db.insert(adminMessageReads).values(chunk).onConflictDoNothing();
    });

    for (const tableName of SEQUENCE_TABLE_NAMES) {
      await syncSequence(tableName);
    }
  } finally {
    legacy.close();
  }

  logger.info('Legacy migration finished.');
  process.exit(0);
}

main().catch((err) => {
  logger.error('Legacy migration failed', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
