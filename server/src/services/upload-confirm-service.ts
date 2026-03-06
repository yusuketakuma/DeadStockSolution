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
import {
  extractDeadStockRowsWithIssues,
  extractUsedMedicationRowsWithIssues,
  type UploadExtractionIssue,
} from './data-extractor';
import { enrichWithDrugMaster } from './drug-master-enrichment';
import { invalidateAdminRiskSnapshotCache } from './expiry-risk-service';
import { triggerMatchingRefreshOnUpload } from './matching-refresh-service';
import {
  applyDeadStockDiff,
  applyUsedMedicationDiff,
  type DiffSummary,
} from './upload-diff-service';
import {
  clearUploadRowIssuesForJob,
  replaceUploadRowIssuesForJob,
  type UploadRowIssueInput,
} from './upload-row-issue-service';

const INSERT_BATCH_SIZE = 500;

export type ApplyMode = 'replace' | 'diff' | 'partial';
export type UploadType = 'dead_stock' | 'used_medication';

type DeadStockInsertRow = InferInsertModel<typeof deadStockItems>;
type UsedMedicationInsertRow = InferInsertModel<typeof usedMedicationItems>;
type DrugMasterLinkFields = Pick<DeadStockInsertRow, 'drugMasterId' | 'drugMasterPackageId' | 'packageLabel'>;
type UploadConfirmTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

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
  jobId?: number;
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
  partialSummary: PartialSummary | null;
}

export interface PartialSummary {
  inspectedRows: number;
  acceptedRows: number;
  rejectedRows: number;
  issueCounts: Record<string, number>;
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

function shouldReplaceRows(applyMode: ApplyMode): boolean {
  return applyMode !== 'diff';
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

function toUploadRowIssueInputs(issues: UploadExtractionIssue[]): UploadRowIssueInput[] {
  return issues.map((issue) => ({
    rowNumber: issue.rowNumber,
    issueCode: issue.issueCode,
    issueMessage: issue.issueMessage,
    rowData: issue.rowData,
  }));
}

function buildPartialSummary(
  inspectedRows: number,
  acceptedRows: number,
  issues: UploadExtractionIssue[],
): PartialSummary {
  const issueCounts: Record<string, number> = {};
  for (const issue of issues) {
    issueCounts[issue.issueCode] = (issueCounts[issue.issueCode] ?? 0) + 1;
  }
  const rejectedRows = issues.length;
  return {
    inspectedRows,
    acceptedRows,
    rejectedRows,
    issueCounts,
  };
}

async function assertUploadIsFresh(
  tx: UploadConfirmTx,
  pharmacyId: number,
  uploadType: UploadType,
  staleGuardCreatedAt: string | null,
): Promise<void> {
  if (!staleGuardCreatedAt) return;

  const staleGuardMs = toTimestampMs(staleGuardCreatedAt);
  if (staleGuardMs === null) return;

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

async function syncUploadRowIssuesForJob(
  tx: UploadConfirmTx,
  jobId: number | undefined,
  pharmacyId: number,
  uploadType: UploadType,
  applyMode: ApplyMode,
  extractedIssues: UploadExtractionIssue[],
): Promise<void> {
  if (!jobId) return;

  if (applyMode !== 'partial') {
    await clearUploadRowIssuesForJob(jobId, tx);
    return;
  }

  await replaceUploadRowIssuesForJob(
    jobId,
    pharmacyId,
    uploadType,
    toUploadRowIssueInputs(extractedIssues),
    tx,
  );
}

async function replaceUploadItems<TSource, TInsertRow>(
  sourceRows: TSource[],
  clearExistingRows: () => Promise<unknown>,
  toInsertRow: (item: TSource) => TInsertRow,
  insertRows: (rows: TInsertRow[]) => Promise<unknown>,
): Promise<void> {
  await clearExistingRows();
  if (sourceRows.length === 0) return;

  const preparedRows = sourceRows.map(toInsertRow);
  await insertInBatches(preparedRows.length, (start, end) =>
    insertRows(preparedRows.slice(start, end))
  );
}

export async function runUploadConfirm(
  params: UploadConfirmExecutionParams,
): Promise<UploadConfirmExecutionResult> {
  const {
    pharmacyId,
    uploadType,
    originalFilename,
    jobId,
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

  const deadStockExtraction = uploadType === 'dead_stock'
    ? extractDeadStockRowsWithIssues(allRows, mapping, dataStartIndex)
    : null;
  const usedMedicationExtraction = uploadType === 'used_medication'
    ? extractUsedMedicationRowsWithIssues(allRows, mapping, dataStartIndex)
    : null;
  const parsedRowCount = deadStockExtraction?.rows.length ?? usedMedicationExtraction?.rows.length ?? 0;
  const extractedIssues = deadStockExtraction?.issues ?? usedMedicationExtraction?.issues ?? [];
  const inspectedRows = deadStockExtraction?.inspectedRowCount ?? usedMedicationExtraction?.inspectedRowCount ?? 0;
  const partialSummary = applyMode === 'partial'
    ? buildPartialSummary(inspectedRows, parsedRowCount, extractedIssues)
    : null;

  const enrichedDeadStock = deadStockExtraction
    ? await enrichWithDrugMaster(deadStockExtraction.rows, 'dead_stock')
    : null;
  const enrichedUsedMedication = usedMedicationExtraction
    ? await enrichWithDrugMaster(usedMedicationExtraction.rows, 'used_medication')
    : null;
  const requestedAtIso = staleGuardCreatedAt ?? new Date().toISOString();
  const mappingJson = JSON.stringify(mapping);

  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${pharmacyId}, ${resolveUploadTypeLockKey(uploadType)})`);
    await assertUploadIsFresh(tx, pharmacyId, uploadType, staleGuardCreatedAt);
    await syncUploadRowIssuesForJob(tx, jobId, pharmacyId, uploadType, applyMode, extractedIssues);

    const [uploadRecord] = await tx.insert(uploads).values({
      pharmacyId,
      uploadType,
      originalFilename,
      columnMapping: mappingJson,
      rowCount: 0,
      requestedAt: requestedAtIso,
    }).returning({ id: uploads.id });

    let diffSummary: DiffSummary | null = null;
    const isReplaceMode = shouldReplaceRows(applyMode);

    if (uploadType === 'dead_stock') {
      const sourceRows = (enrichedDeadStock ?? deadStockExtraction?.rows) ?? [];
      if (!isReplaceMode) {
        diffSummary = await applyDeadStockDiff(tx, pharmacyId, uploadRecord.id, sourceRows, { deleteMissing });
      } else {
        await replaceUploadItems(
          sourceRows,
          () => tx.delete(deadStockItems).where(eq(deadStockItems.pharmacyId, pharmacyId)),
          (item) => toDeadStockInsertRow(pharmacyId, uploadRecord.id, item),
          (rows) => tx.insert(deadStockItems).values(rows),
        );
      }
    } else {
      const sourceRows = (enrichedUsedMedication ?? usedMedicationExtraction?.rows) ?? [];
      if (!isReplaceMode) {
        diffSummary = await applyUsedMedicationDiff(tx, pharmacyId, uploadRecord.id, sourceRows, { deleteMissing });
      } else {
        await replaceUploadItems(
          sourceRows,
          () => tx.delete(usedMedicationItems).where(eq(usedMedicationItems.pharmacyId, pharmacyId)),
          (item) => toUsedMedicationInsertRow(pharmacyId, uploadRecord.id, item),
          (rows) => tx.insert(usedMedicationItems).values(rows),
        );
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
        createdAt: sql`now()`,
      },
    });

    await triggerMatchingRefreshOnUpload({
      triggerPharmacyId: pharmacyId,
      uploadType,
    }, tx);
    invalidateAdminRiskSnapshotCache();

    return {
      uploadId: uploadRecord.id,
      rowCount: persistedRowCount,
      diffSummary,
      partialSummary,
    };
  });
}
