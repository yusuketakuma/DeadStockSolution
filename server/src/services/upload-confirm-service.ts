import { and, desc, eq, sql, type InferInsertModel } from 'drizzle-orm';
import { db } from '../config/database';
import {
  columnMappingTemplates,
  deadStockItems,
  uploads,
  usedMedicationItems,
} from '../db/schema';
import type { ColumnMapping } from '../types';
import { computeHeaderHash } from './column-mapper';
import { extractDeadStockRows, extractUsedMedicationRows } from './data-extractor';
import { enrichWithDrugMaster } from './drug-master-enrichment';
import { triggerMatchingRefreshOnUpload } from './matching-refresh-service';
import {
  applyDeadStockDiff,
  applyUsedMedicationDiff,
  type DiffSummary,
} from './upload-diff-service';

const INSERT_BATCH_SIZE = 500;

export type ApplyMode = 'replace' | 'diff';
export type UploadType = 'dead_stock' | 'used_medication';

type DeadStockInsertRow = InferInsertModel<typeof deadStockItems>;
type UsedMedicationInsertRow = InferInsertModel<typeof usedMedicationItems>;
type DrugMasterLinkFields = Pick<DeadStockInsertRow, 'drugMasterId' | 'drugMasterPackageId' | 'packageLabel'>;

interface DeadStockInsertSource extends DrugMasterLinkFields {
  drugCode: string | null;
  drugName: string;
  quantity: number;
  unit: string | null;
  yakkaUnitPrice: number | null;
  yakkaTotal: number | null;
  expirationDate: string | null;
  lotNumber: string | null;
}

interface UsedMedicationInsertSource extends DrugMasterLinkFields {
  drugCode: string | null;
  drugName: string;
  monthlyUsage: number | null;
  unit: string | null;
  yakkaUnitPrice: number | null;
}

export interface UploadConfirmExecutionParams {
  pharmacyId: number;
  uploadType: UploadType;
  originalFilename: string;
  headerRowIndex: number;
  mapping: ColumnMapping;
  allRows: unknown[][];
  applyMode: ApplyMode;
  deleteMissing: boolean;
  staleGuardCreatedAt?: string | null;
}

export interface UploadConfirmExecutionResult {
  uploadId: number;
  rowCount: number;
  diffSummary: DiffSummary | null;
}

function toNumericText(value: number | null): string | null {
  return value !== null ? String(value) : null;
}

function normalizeExpirationDateIso(expirationDate: string | null): string | null {
  if (typeof expirationDate !== 'string') return null;
  const normalized = expirationDate.replace(/\//g, '-').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

function extractDrugMasterLinkFields(item: DrugMasterLinkFields): DrugMasterLinkFields {
  return {
    drugMasterId: item.drugMasterId ?? null,
    drugMasterPackageId: item.drugMasterPackageId ?? null,
    packageLabel: item.packageLabel ?? null,
  };
}

function toTimestampMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveUploadTypeLockKey(uploadType: UploadType): number {
  return uploadType === 'dead_stock' ? 1 : 2;
}

function toDeadStockInsertRow(
  pharmacyId: number,
  uploadId: number,
  item: DeadStockInsertSource,
): DeadStockInsertRow {
  return {
    pharmacyId,
    uploadId,
    drugCode: item.drugCode,
    drugName: item.drugName,
    ...extractDrugMasterLinkFields(item),
    quantity: item.quantity,
    unit: item.unit,
    yakkaUnitPrice: toNumericText(item.yakkaUnitPrice),
    yakkaTotal: toNumericText(item.yakkaTotal),
    expirationDate: item.expirationDate,
    expirationDateIso: normalizeExpirationDateIso(item.expirationDate),
    lotNumber: item.lotNumber,
  };
}

function toUsedMedicationInsertRow(
  pharmacyId: number,
  uploadId: number,
  item: UsedMedicationInsertSource,
): UsedMedicationInsertRow {
  return {
    pharmacyId,
    uploadId,
    drugCode: item.drugCode,
    drugName: item.drugName,
    ...extractDrugMasterLinkFields(item),
    monthlyUsage: item.monthlyUsage,
    unit: item.unit,
    yakkaUnitPrice: toNumericText(item.yakkaUnitPrice),
  };
}

async function insertInBatches(
  totalCount: number,
  insertBatch: (start: number, end: number) => Promise<unknown>,
): Promise<void> {
  for (let i = 0; i < totalCount; i += INSERT_BATCH_SIZE) {
    await insertBatch(i, i + INSERT_BATCH_SIZE);
  }
}

export async function runUploadConfirm(
  params: UploadConfirmExecutionParams,
): Promise<UploadConfirmExecutionResult> {
  const {
    pharmacyId,
    uploadType,
    originalFilename,
    headerRowIndex,
    mapping,
    allRows,
    applyMode,
    deleteMissing,
    staleGuardCreatedAt = null,
  } = params;

  if (!Number.isInteger(headerRowIndex) || headerRowIndex < 0 || headerRowIndex >= allRows.length) {
    throw new Error('ヘッダー行指定が不正です');
  }

  const headerRow = allRows[headerRowIndex];
  const dataStartIndex = headerRowIndex + 1;
  const headerHash = computeHeaderHash(headerRow);

  const deadStockExtracted = uploadType === 'dead_stock'
    ? extractDeadStockRows(allRows, mapping, dataStartIndex)
    : null;
  const usedMedicationExtracted = uploadType === 'used_medication'
    ? extractUsedMedicationRows(allRows, mapping, dataStartIndex)
    : null;
  const parsedRowCount = deadStockExtracted?.length ?? usedMedicationExtracted?.length ?? 0;

  const enrichedDeadStock = deadStockExtracted
    ? await enrichWithDrugMaster(deadStockExtracted, 'dead_stock')
    : null;
  const enrichedUsedMedication = usedMedicationExtracted
    ? await enrichWithDrugMaster(usedMedicationExtracted, 'used_medication')
    : null;
  const requestedAtIso = staleGuardCreatedAt ?? new Date().toISOString();
  const mappingJson = JSON.stringify(mapping);

  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${pharmacyId}, ${resolveUploadTypeLockKey(uploadType)})`);

    if (staleGuardCreatedAt) {
      const staleGuardMs = toTimestampMs(staleGuardCreatedAt);
      if (staleGuardMs !== null) {
        const [latestUpload] = await tx.select({
          id: uploads.id,
          requestedAt: uploads.requestedAt,
        })
          .from(uploads)
          .where(and(
            eq(uploads.pharmacyId, pharmacyId),
            eq(uploads.uploadType, uploadType),
          ))
          .orderBy(desc(uploads.requestedAt), desc(uploads.id))
          .limit(1);
        const latestUploadMs = toTimestampMs(latestUpload?.requestedAt ?? null);
        if (latestUploadMs !== null && latestUploadMs >= staleGuardMs) {
          throw new Error('[STALE_JOB_SKIPPED] より新しいアップロードが既に反映されているため、このジョブはスキップされました');
        }
      }
    }

    const [uploadRecord] = await tx.insert(uploads).values({
      pharmacyId,
      uploadType,
      originalFilename,
      columnMapping: mappingJson,
      rowCount: 0,
      requestedAt: requestedAtIso,
    }).returning({ id: uploads.id });

    let diffSummary: DiffSummary | null = null;

    if (uploadType === 'dead_stock') {
      const sourceRows = (enrichedDeadStock ?? deadStockExtracted) ?? [];
      if (applyMode === 'replace') {
        await tx.delete(deadStockItems).where(eq(deadStockItems.pharmacyId, pharmacyId));
        if (sourceRows.length > 0) {
          const insertRows = sourceRows.map((item) =>
            toDeadStockInsertRow(pharmacyId, uploadRecord.id, item)
          );

          await insertInBatches(insertRows.length, async (start, end) =>
            tx.insert(deadStockItems).values(insertRows.slice(start, end))
          );
        }
      } else {
        diffSummary = await applyDeadStockDiff(tx, pharmacyId, uploadRecord.id, sourceRows, { deleteMissing });
      }
    } else {
      const sourceRows = (enrichedUsedMedication ?? usedMedicationExtracted) ?? [];
      if (applyMode === 'replace') {
        await tx.delete(usedMedicationItems).where(eq(usedMedicationItems.pharmacyId, pharmacyId));
        if (sourceRows.length > 0) {
          const insertRows = sourceRows.map((item) =>
            toUsedMedicationInsertRow(pharmacyId, uploadRecord.id, item)
          );

          await insertInBatches(insertRows.length, async (start, end) =>
            tx.insert(usedMedicationItems).values(insertRows.slice(start, end))
          );
        }
      } else {
        diffSummary = await applyUsedMedicationDiff(tx, pharmacyId, uploadRecord.id, sourceRows, { deleteMissing });
      }
    }

    const persistedRowCount = applyMode === 'diff'
      ? diffSummary?.totalIncoming ?? parsedRowCount
      : parsedRowCount;

    await tx.update(uploads)
      .set({ rowCount: persistedRowCount })
      .where(eq(uploads.id, uploadRecord.id));

    await tx.insert(columnMappingTemplates).values({
      pharmacyId,
      uploadType,
      headerHash,
      mapping: mappingJson,
    }).onConflictDoUpdate({
      target: [
        columnMappingTemplates.pharmacyId,
        columnMappingTemplates.uploadType,
        columnMappingTemplates.headerHash,
      ],
      set: {
        mapping: mappingJson,
      },
    });

    await triggerMatchingRefreshOnUpload({
      triggerPharmacyId: pharmacyId,
      uploadType,
    }, tx);

    return {
      uploadId: uploadRecord.id,
      rowCount: persistedRowCount,
      diffSummary,
    };
  });
}
