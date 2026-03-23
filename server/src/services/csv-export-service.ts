// ── CSV エクスポートサービス ──────────────────────────────
// ストリーミング CSV 生成（UTF-8 with BOM）。
// Excel 文字化け防止のため BOM を先頭に付与する。

import { desc, eq } from 'drizzle-orm';
import { db } from '../config/database';
import {
  pharmacies,
  exchangeProposals,
  monthlyReports,
  events,
  adminAuditLogs,
} from '../db/schema';
import { deadStockItems } from '../db/schema-inventory';
import { logger } from './logger';

// ── 定数 ──────────────────────────────────────────────────

const CSV_BOM = '\uFEFF';
const BATCH_SIZE = 500;

// ── 型定義 ──────────────────────────────────────────────

export interface CsvWriter {
  write(chunk: string): boolean;
}

export interface CsvExportOptions {
  batchSize?: number;
}

interface CsvExportRunnerOptions<Row> {
  writer: CsvWriter;
  headers: string[];
  batchSize: number;
  fetchRows: (offset: number, batchSize: number) => Promise<Row[]>;
  writeRow: (writer: CsvWriter, row: Row) => void;
  errorMessage: string;
}

// ── ヘルパー ──────────────────────────────────────────────

function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  const str = String(value);
  // ダブルクォートかカンマか改行を含む場合はエスケープ
  if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function toCsvRow(values: unknown[]): string {
  return values.map(escapeCsvField).join(',') + '\r\n';
}

function writeBom(writer: CsvWriter): void {
  writer.write(CSV_BOM);
}

function writeHeader(writer: CsvWriter, headers: string[]): void {
  writer.write(toCsvRow(headers));
}

async function runCsvExport<Row>({
  writer,
  headers,
  batchSize,
  fetchRows,
  writeRow,
  errorMessage,
}: CsvExportRunnerOptions<Row>): Promise<number> {
  writeBom(writer);
  writeHeader(writer, headers);

  let offset = 0;
  let totalRows = 0;

  try {
    while (true) {
      const rows = await fetchRows(offset, batchSize);
      if (rows.length === 0) break;

      for (const row of rows) {
        writeRow(writer, row);
      }

      totalRows += rows.length;
      if (rows.length < batchSize) break;
      offset += batchSize;
    }
  } catch (err) {
    logger.error(errorMessage, {
      error: err instanceof Error ? err.message : String(err),
      exportedRows: totalRows,
    });
    throw err;
  }

  return totalRows;
}

// ── 薬局エクスポート ──────────────────────────────────────

const PHARMACY_HEADERS = [
  'ID', 'メールアドレス', '薬局名', '都道府県', '住所', '郵便番号',
  '電話番号', 'FAX', '有効', '管理者', 'テストアカウント',
  '審査状態', '登録日',
];

export async function exportPharmaciesCsv(
  writer: CsvWriter,
  _options: CsvExportOptions = {},
): Promise<number> {
  const batchSize = _options.batchSize ?? BATCH_SIZE;
  return runCsvExport({
    writer,
    headers: PHARMACY_HEADERS,
    batchSize,
    fetchRows: (offset, limit) => db.select({
        id: pharmacies.id,
        email: pharmacies.email,
        name: pharmacies.name,
        prefecture: pharmacies.prefecture,
        address: pharmacies.address,
        postalCode: pharmacies.postalCode,
        phone: pharmacies.phone,
        fax: pharmacies.fax,
        isActive: pharmacies.isActive,
        isAdmin: pharmacies.isAdmin,
        isTestAccount: pharmacies.isTestAccount,
        verificationStatus: pharmacies.verificationStatus,
        createdAt: pharmacies.createdAt,
      })
        .from(pharmacies)
        .orderBy(desc(pharmacies.createdAt))
        .limit(limit)
        .offset(offset),
    writeRow: (targetWriter, row) => {
      targetWriter.write(toCsvRow([
        row.id,
        row.email,
        row.name,
        row.prefecture,
        row.address,
        row.postalCode,
        row.phone,
        row.fax,
        row.isActive ? 'はい' : 'いいえ',
        row.isAdmin ? 'はい' : 'いいえ',
        row.isTestAccount ? 'はい' : 'いいえ',
        row.verificationStatus,
        row.createdAt,
      ]));
    },
    errorMessage: 'CSV export pharmacies failed',
  });
}

// ── 交換エクスポート ──────────────────────────────────────

const EXCHANGE_HEADERS = [
  'ID', '提案元薬局ID', '提案先薬局ID', 'ステータス',
  '提案元合計金額', '提案先合計金額', '差額',
  '提案日', '完了日',
];

export async function exportExchangesCsv(
  writer: CsvWriter,
  _options: CsvExportOptions = {},
): Promise<number> {
  const batchSize = _options.batchSize ?? BATCH_SIZE;
  return runCsvExport({
    writer,
    headers: EXCHANGE_HEADERS,
    batchSize,
    fetchRows: (offset, limit) => db.select({
        id: exchangeProposals.id,
        pharmacyAId: exchangeProposals.pharmacyAId,
        pharmacyBId: exchangeProposals.pharmacyBId,
        status: exchangeProposals.status,
        totalValueA: exchangeProposals.totalValueA,
        totalValueB: exchangeProposals.totalValueB,
        valueDifference: exchangeProposals.valueDifference,
        proposedAt: exchangeProposals.proposedAt,
        completedAt: exchangeProposals.completedAt,
      })
        .from(exchangeProposals)
        .orderBy(desc(exchangeProposals.proposedAt))
        .limit(limit)
        .offset(offset),
    writeRow: (targetWriter, row) => {
      targetWriter.write(toCsvRow([
        row.id,
        row.pharmacyAId,
        row.pharmacyBId,
        row.status,
        row.totalValueA,
        row.totalValueB,
        row.valueDifference,
        row.proposedAt,
        row.completedAt,
      ]));
    },
    errorMessage: 'CSV export exchanges failed',
  });
}

// ── レポートエクスポート ──────────────────────────────────

const REPORT_HEADERS = [
  'ID', '年', '月', 'ステータス', '生成日',
];

export async function exportReportsCsv(
  writer: CsvWriter,
  _options: CsvExportOptions = {},
): Promise<number> {
  const batchSize = _options.batchSize ?? BATCH_SIZE;
  return runCsvExport({
    writer,
    headers: REPORT_HEADERS,
    batchSize,
    fetchRows: (offset, limit) => db.select({
        id: monthlyReports.id,
        year: monthlyReports.year,
        month: monthlyReports.month,
        status: monthlyReports.status,
        generatedAt: monthlyReports.generatedAt,
      })
        .from(monthlyReports)
        .orderBy(desc(monthlyReports.generatedAt))
        .limit(limit)
        .offset(offset),
    writeRow: (targetWriter, row) => {
      targetWriter.write(toCsvRow([
        row.id,
        row.year,
        row.month,
        row.status,
        row.generatedAt,
      ]));
    },
    errorMessage: 'CSV export reports failed',
  });
}

// ── ログエクスポート ──────────────────────────────────────

const LOG_HEADERS = ['ID', '薬局ID', 'アクション', '詳細', '日時'];

export async function exportLogsCsv(
  writer: CsvWriter,
  _options: CsvExportOptions = {},
): Promise<number> {
  const batchSize = _options.batchSize ?? BATCH_SIZE;
  return runCsvExport({
    writer,
    headers: LOG_HEADERS,
    batchSize,
    fetchRows: (offset, limit) => db.select({
        id: events.id,
        pharmacyId: events.pharmacyId,
        action: events.action,
        detail: events.detail,
        createdAt: events.createdAt,
      })
        .from(events)
        .orderBy(desc(events.createdAt))
        .limit(limit)
        .offset(offset),
    writeRow: (targetWriter, row) => {
      targetWriter.write(toCsvRow([
        row.id,
        row.pharmacyId,
        row.action,
        row.detail,
        row.createdAt,
      ]));
    },
    errorMessage: 'CSV export logs failed',
  });
}

// ── 提案履歴エクスポート ──────────────────────────────────

const PROPOSAL_HEADERS = [
  'ID', '提案元薬局ID', '提案元薬局名', '提案先薬局ID', '提案先薬局名',
  'ステータス', '提案元合計金額', '提案先合計金額', '差額',
  '提案完了合計金額', '提案日', '完了日',
];

export async function exportProposalsCsv(
  writer: CsvWriter,
  _options: CsvExportOptions = {},
): Promise<number> {
  const batchSize = _options.batchSize ?? BATCH_SIZE;
  const pharmacyA = db.select({ id: pharmacies.id, name: pharmacies.name }).from(pharmacies).as('pa');
  const pharmacyB = db.select({ id: pharmacies.id, name: pharmacies.name }).from(pharmacies).as('pb');
  return runCsvExport({
    writer,
    headers: PROPOSAL_HEADERS,
    batchSize,
    fetchRows: (offset, limit) => db.select({
        id: exchangeProposals.id,
        pharmacyAId: exchangeProposals.pharmacyAId,
        pharmacyAName: pharmacyA.name,
        pharmacyBId: exchangeProposals.pharmacyBId,
        pharmacyBName: pharmacyB.name,
        status: exchangeProposals.status,
        totalValueA: exchangeProposals.totalValueA,
        totalValueB: exchangeProposals.totalValueB,
        valueDifference: exchangeProposals.valueDifference,
        completedTotalValue: exchangeProposals.completedTotalValue,
        proposedAt: exchangeProposals.proposedAt,
        completedAt: exchangeProposals.completedAt,
      })
        .from(exchangeProposals)
        .leftJoin(pharmacyA, eq(exchangeProposals.pharmacyAId, pharmacyA.id))
        .leftJoin(pharmacyB, eq(exchangeProposals.pharmacyBId, pharmacyB.id))
        .orderBy(desc(exchangeProposals.proposedAt))
        .limit(limit)
        .offset(offset),
    writeRow: (targetWriter, row) => {
      targetWriter.write(toCsvRow([
        row.id,
        row.pharmacyAId,
        row.pharmacyAName,
        row.pharmacyBId,
        row.pharmacyBName,
        row.status,
        row.totalValueA,
        row.totalValueB,
        row.valueDifference,
        row.completedTotalValue,
        row.proposedAt,
        row.completedAt,
      ]));
    },
    errorMessage: 'CSV export proposals failed',
  });
}

// ── 監査ログエクスポート ──────────────────────────────────

const AUDIT_LOG_HEADERS = [
  'ID', '管理者ID', '管理者名', 'アクション',
  '対象薬局ID', '対象薬局名', '変更前ステータス', '変更後ステータス', '理由', '実行日時',
];

export async function exportAuditLogsCsv(
  writer: CsvWriter,
  _options: CsvExportOptions = {},
): Promise<number> {
  const batchSize = _options.batchSize ?? BATCH_SIZE;
  const adminPharmacy = db.select({ id: pharmacies.id, name: pharmacies.name }).from(pharmacies).as('ap');
  const targetPharmacy = db.select({ id: pharmacies.id, name: pharmacies.name }).from(pharmacies).as('tp');
  return runCsvExport({
    writer,
    headers: AUDIT_LOG_HEADERS,
    batchSize,
    fetchRows: (offset, limit) => db.select({
        id: adminAuditLogs.id,
        adminId: adminAuditLogs.adminId,
        adminName: adminPharmacy.name,
        action: adminAuditLogs.action,
        targetPharmacyId: adminAuditLogs.targetPharmacyId,
        targetPharmacyName: targetPharmacy.name,
        previousStatus: adminAuditLogs.previousStatus,
        newStatus: adminAuditLogs.newStatus,
        reason: adminAuditLogs.reason,
        createdAt: adminAuditLogs.createdAt,
      })
        .from(adminAuditLogs)
        .leftJoin(adminPharmacy, eq(adminAuditLogs.adminId, adminPharmacy.id))
        .leftJoin(targetPharmacy, eq(adminAuditLogs.targetPharmacyId, targetPharmacy.id))
        .orderBy(desc(adminAuditLogs.createdAt))
        .limit(limit)
        .offset(offset),
    writeRow: (targetWriter, row) => {
      targetWriter.write(toCsvRow([
        row.id,
        row.adminId,
        row.adminName,
        row.action,
        row.targetPharmacyId,
        row.targetPharmacyName,
        row.previousStatus,
        row.newStatus,
        row.reason,
        row.createdAt,
      ]));
    },
    errorMessage: 'CSV export audit-logs failed',
  });
}

// ── リスク（期限間近デッドストック）エクスポート ──────────

const RISK_HEADERS = ['ID', '薬局ID', '医薬品名', '数量', '有効期限', '薬価単価', '登録日'];

export async function exportRiskCsv(
  writer: CsvWriter,
  _options: CsvExportOptions = {},
): Promise<number> {
  const batchSize = _options.batchSize ?? BATCH_SIZE;
  return runCsvExport({
    writer,
    headers: RISK_HEADERS,
    batchSize,
    fetchRows: (offset, limit) => db.select({
        id: deadStockItems.id,
        pharmacyId: deadStockItems.pharmacyId,
        drugName: deadStockItems.drugName,
        quantity: deadStockItems.quantity,
        expiryDate: deadStockItems.expirationDateIso,
        yakkaUnitPrice: deadStockItems.yakkaUnitPrice,
        createdAt: deadStockItems.createdAt,
      })
        .from(deadStockItems)
        .orderBy(desc(deadStockItems.createdAt))
        .limit(limit)
        .offset(offset),
    writeRow: (targetWriter, row) => {
      targetWriter.write(toCsvRow([
        row.id,
        row.pharmacyId,
        row.drugName,
        row.quantity,
        row.expiryDate,
        row.yakkaUnitPrice,
        row.createdAt,
      ]));
    },
    errorMessage: 'CSV export risk failed',
  });
}
