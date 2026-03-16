import { eq, inArray, like, or } from 'drizzle-orm';
import { db } from '../config/database';
import { deadStockItems, drugMaster, drugMasterPackages, uploads } from '../db/schema';
import { katakanaToHiragana, hiraganaToKatakana, normalizeKana } from '../utils/kana-utils';
import { escapeLikeWildcards } from '../utils/request-utils';
import { parseCameraCode, type ParsedCameraCode } from './gs1-parser';
import { triggerMatchingRefreshOnUpload } from './matching-refresh-service';

export interface CameraCodeMatch {
  drugMasterId: number;
  drugMasterPackageId: number | null;
  drugName: string;
  yjCode: string | null;
  gs1Code: string | null;
  janCode: string | null;
  packageLabel: string | null;
  unit: string | null;
  yakkaUnitPrice: number | null;
}

export interface CameraConfirmItemInput {
  rawCode?: unknown;
  drugMasterId?: unknown;
  drugMasterPackageId?: unknown;
  packageLabel?: unknown;
  expirationDate?: unknown;
  lotNumber?: unknown;
  quantity?: unknown;
}

interface ParsedCameraConfirmItem {
  rowNumber: number;
  rawCode: string;
  codeFromRaw: string | null;
  drugMasterId: number;
  drugMasterPackageId: number | null;
  packageLabel: string | null;
  expirationDate: string | null;
  lotNumber: string | null;
  quantity: number;
}

interface MasterRow {
  id: number;
  yjCode: string;
  drugName: string;
  unit: string | null;
  yakkaPrice: string | null;
}

interface PackageRow {
  id: number;
  drugMasterId: number;
  packageDescription: string | null;
  normalizedPackageLabel: string | null;
  gs1Code?: string | null;
  janCode?: string | null;
}

type ManualSearchWhereExpr = ReturnType<typeof like> | ReturnType<typeof or>;

const MAX_CAMERA_BATCH_COUNT = 200;
const MAX_CAMERA_QUANTITY = 100_000;
const CAMERA_QUANTITY_SCALE = 1000;
const MIN_MANUAL_SEARCH_LENGTH = 2;
const MAX_MANUAL_SEARCH_LENGTH = 80;
const MASTER_ROW_FIELDS = {
  id: drugMaster.id,
  yjCode: drugMaster.yjCode,
  drugName: drugMaster.drugName,
  unit: drugMaster.unit,
  yakkaPrice: drugMaster.yakkaPrice,
} as const;
const PACKAGE_MATCH_FIELDS = {
  id: drugMasterPackages.id,
  drugMasterId: drugMasterPackages.drugMasterId,
  gs1Code: drugMasterPackages.gs1Code,
  janCode: drugMasterPackages.janCode,
  hotCode: drugMasterPackages.hotCode,
  packageDescription: drugMasterPackages.packageDescription,
  normalizedPackageLabel: drugMasterPackages.normalizedPackageLabel,
} as const;
const PACKAGE_SUMMARY_FIELDS = {
  id: drugMasterPackages.id,
  drugMasterId: drugMasterPackages.drugMasterId,
  packageDescription: drugMasterPackages.packageDescription,
  normalizedPackageLabel: drugMasterPackages.normalizedPackageLabel,
} as const;

export function sanitizeRawCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const sanitized = value
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1C\x1E-\x1F\x7F]/g, '')
    .trim();
  if (!sanitized) return null;
  return sanitized.slice(0, 500);
}

export function normalizeExpirationDateIso(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\//g, '-').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;
  const [yearRaw, monthRaw, dayRaw] = normalized.split('-');
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime())) return null;
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return normalized;
}

export function normalizeOptionalText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized) return null;
  return normalized.slice(0, maxLength);
}

export function normalizeOptionalNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function toNumericText(value: number | null): string | null {
  if (value === null || Number.isNaN(value)) return null;
  return String(value);
}

function toNullablePrice(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildCameraCodeMatch(masterRow: MasterRow, pkg: PackageRow | null): CameraCodeMatch {
  return {
    drugMasterId: masterRow.id,
    drugMasterPackageId: pkg?.id ?? null,
    drugName: masterRow.drugName,
    yjCode: masterRow.yjCode,
    gs1Code: pkg?.gs1Code ?? null,
    janCode: pkg?.janCode ?? null,
    packageLabel: pkg?.normalizedPackageLabel ?? pkg?.packageDescription ?? null,
    unit: masterRow.unit,
    yakkaUnitPrice: toNullablePrice(masterRow.yakkaPrice),
  };
}

export function buildCameraUploadFilename(now: Date): string {
  const iso = now.toISOString().replace(/[:.]/g, '-');
  return `camera-scan-${iso}.json`;
}

function normalizeManualCandidateLimit(value: unknown): number {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number(value)
      : Number.NaN;
  if (!Number.isInteger(parsed) || parsed <= 0) return 10;
  return Math.min(parsed, 20);
}

function normalizeManualCandidateSearch(search: string): string {
  const normalized = search.trim().replace(/\s+/g, ' ');
  if (normalized.length < MIN_MANUAL_SEARCH_LENGTH) {
    throw new Error(`検索キーワードは${MIN_MANUAL_SEARCH_LENGTH}文字以上で入力してください`);
  }
  if (normalized.length > MAX_MANUAL_SEARCH_LENGTH) {
    throw new Error(`検索キーワードは${MAX_MANUAL_SEARCH_LENGTH}文字以内で入力してください`);
  }
  return normalized;
}

function buildManualSearchWhere(search: string): ManualSearchWhereExpr {
  const normalized = normalizeKana(search);
  const hiragana = katakanaToHiragana(normalized);
  const katakana = hiraganaToKatakana(normalized);
  const likeTerms = [...new Set([search, normalized, hiragana, katakana].filter(Boolean))];
  const likeConditions = likeTerms.flatMap((term) => {
    const escapedLikeTerm = `%${escapeLikeWildcards(term)}%`;
    return [
      like(drugMaster.drugName, escapedLikeTerm),
      like(drugMaster.genericName, escapedLikeTerm),
    ];
  });

  if (/^[A-Z0-9]+$/i.test(search)) {
    likeConditions.push(like(drugMaster.yjCode, `%${escapeLikeWildcards(search)}%`));
  }

  return likeConditions.length === 1 ? likeConditions[0] : or(...likeConditions);
}

function buildFirstPackageByMasterId(packageRows: PackageRow[]): Map<number, PackageRow> {
  const firstPackageByMasterId = new Map<number, PackageRow>();
  for (const pkg of packageRows) {
    if (!firstPackageByMasterId.has(pkg.drugMasterId)) {
      firstPackageByMasterId.set(pkg.drugMasterId, pkg);
    }
  }
  return firstPackageByMasterId;
}

function buildDeadStockInsertRows(params: {
  pharmacyId: number;
  uploadId: number;
  parsedItems: ParsedCameraConfirmItem[];
  masterById: Map<number, MasterRow>;
  packageById: Map<number, PackageRow>;
}): Array<typeof deadStockItems.$inferInsert> {
  const { pharmacyId, uploadId, parsedItems, masterById, packageById } = params;
  return parsedItems.map((item) => {
    const master = masterById.get(item.drugMasterId)!;
    const pkg = item.drugMasterPackageId ? packageById.get(item.drugMasterPackageId) : null;
    const unit = master.unit ?? null;
    const yakkaUnitPrice = toNullablePrice(master.yakkaPrice);
    const yakkaTotal = yakkaUnitPrice !== null ? yakkaUnitPrice * item.quantity : null;

    return {
      pharmacyId,
      uploadId,
      drugCode: item.codeFromRaw ?? master.yjCode,
      drugName: master.drugName,
      drugMasterId: item.drugMasterId,
      drugMasterPackageId: item.drugMasterPackageId ?? null,
      packageLabel: item.packageLabel ?? pkg?.normalizedPackageLabel ?? pkg?.packageDescription ?? null,
      quantity: item.quantity,
      unit,
      yakkaUnitPrice: toNumericText(yakkaUnitPrice),
      yakkaTotal: toNumericText(yakkaTotal),
      expirationDate: item.expirationDate,
      expirationDateIso: item.expirationDate,
      lotNumber: item.lotNumber,
      isAvailable: true,
    };
  });
}

async function findPackagesByMasterIds(drugMasterIds: number[]): Promise<PackageRow[]> {
  if (drugMasterIds.length === 0) return [];
  return db.select(PACKAGE_MATCH_FIELDS)
    .from(drugMasterPackages)
    .where(inArray(drugMasterPackages.drugMasterId, drugMasterIds));
}

async function findPackagesByIds(packageIds: number[]): Promise<PackageRow[]> {
  if (packageIds.length === 0) return [];
  return db.select(PACKAGE_SUMMARY_FIELDS)
    .from(drugMasterPackages)
    .where(inArray(drugMasterPackages.id, packageIds));
}

function resolveParsedCodeFromRaw(rawCode: string, parsedCodeCache: Map<string, string | null>): string | null {
  if (!rawCode) {
    return null;
  }
  if (parsedCodeCache.has(rawCode)) {
    return parsedCodeCache.get(rawCode) ?? null;
  }

  const parsedFromRaw = parseCameraCode(rawCode);
  const codeFromRaw = parsedFromRaw.yjCode ?? parsedFromRaw.gtin ?? null;
  parsedCodeCache.set(rawCode, codeFromRaw);
  return codeFromRaw;
}

export async function resolveCameraMatchByCode(parsed: ParsedCameraCode): Promise<CameraCodeMatch | null> {
  const normalizedGtins = new Set<string>();
  if (parsed.gtin) {
    normalizedGtins.add(parsed.gtin);
    if (/^0\d{13}$/.test(parsed.gtin)) {
      normalizedGtins.add(parsed.gtin.slice(1));
    }
  }

  if (parsed.codeType === 'gs1' && normalizedGtins.size > 0) {
    const gtinCandidates = [...normalizedGtins];
    const packageRows = await db.select(PACKAGE_MATCH_FIELDS)
      .from(drugMasterPackages)
      .where(or(
        inArray(drugMasterPackages.gs1Code, gtinCandidates),
        inArray(drugMasterPackages.janCode, gtinCandidates),
        inArray(drugMasterPackages.hotCode, gtinCandidates),
      ))
      .limit(5);

    if (packageRows.length > 0) {
      const pkg = packageRows[0];
      const [masterRow] = await db.select(MASTER_ROW_FIELDS)
        .from(drugMaster)
        .where(eq(drugMaster.id, pkg.drugMasterId))
        .limit(1);

      if (masterRow) {
        return buildCameraCodeMatch(masterRow, pkg);
      }
    }
  }

  if (!parsed.yjCode) {
    return null;
  }

  const [masterRow] = await db.select(MASTER_ROW_FIELDS)
    .from(drugMaster)
    .where(eq(drugMaster.yjCode, parsed.yjCode))
    .limit(1);
  if (!masterRow) {
    // YJ完全一致なし: YJ先頭7桁（同成分）でファジーマッチ
    return resolveByYjPrefix7(parsed.yjCode);
  }

  const [pkg] = await db.select(PACKAGE_MATCH_FIELDS)
    .from(drugMasterPackages)
    .where(eq(drugMasterPackages.drugMasterId, masterRow.id))
    .limit(1);
  return buildCameraCodeMatch(masterRow, pkg ?? null);
}

/**
 * YJコード先頭7桁（同成分レベル）でファジーマッチ。
 * 完全一致する品目がDBに無い場合に、同成分の別規格・別メーカー品を候補として返す。
 */
async function resolveByYjPrefix7(yjCode: string): Promise<CameraCodeMatch | null> {
  if (yjCode.length < 7) return null;
  const yjPrefix7 = yjCode.slice(0, 7);

  // 同成分で包装情報がある品目を優先
  const candidates = await db.select(MASTER_ROW_FIELDS)
    .from(drugMaster)
    .where(like(drugMaster.yjCode, `${escapeLikeWildcards(yjPrefix7)}%`))
    .limit(10);

  if (candidates.length === 0) return null;

  // 全候補の包装情報を一括取得
  const allPackages = await findPackagesByMasterIds(candidates.map((candidate) => candidate.id));
  const packageByMasterId = buildFirstPackageByMasterId(allPackages);

  // 包装情報がある品目を優先して返す
  for (const candidate of candidates) {
    const pkg = packageByMasterId.get(candidate.id);
    if (pkg) return buildCameraCodeMatch(candidate, pkg);
  }

  // 包装なしでも成分一致の最初の品目を返す
  return buildCameraCodeMatch(candidates[0], null);
}

export async function searchCameraManualCandidates(
  search: string,
  limitInput: unknown,
): Promise<CameraCodeMatch[]> {
  const normalizedSearch = normalizeManualCandidateSearch(search);
  const whereExpr = buildManualSearchWhere(normalizedSearch);

  const limit = normalizeManualCandidateLimit(limitInput);
  const masters = await db.select(MASTER_ROW_FIELDS)
    .from(drugMaster)
    .where(whereExpr)
    .limit(limit);

  if (masters.length === 0) {
    return [];
  }
  const packageRows = await findPackagesByMasterIds(masters.map((master) => master.id));
  const firstPackageByMasterId = buildFirstPackageByMasterId(packageRows);

  return masters.map((master) => {
    const pkg = firstPackageByMasterId.get(master.id);
    return buildCameraCodeMatch(master, pkg ?? null);
  });
}

export function resolveDisplayCode(parsed: ParsedCameraCode, fallback: string): string {
  if (parsed.yjCode) return parsed.yjCode;
  if (parsed.gtin) return parsed.gtin;
  return fallback;
}

function parseCameraConfirmItems(rawItems: unknown): ParsedCameraConfirmItem[] {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new Error('登録する行がありません');
  }
  if (rawItems.length > MAX_CAMERA_BATCH_COUNT) {
    throw new Error('一度に登録できる件数は200件までです');
  }

  const parsedCodeCache = new Map<string, string | null>();

  return rawItems.map((item, idx) => {
    const row = (item ?? {}) as CameraConfirmItemInput;
    const quantityRaw = normalizeOptionalNumber(row.quantity);
    const quantity = quantityRaw !== null
      ? Math.round(quantityRaw * CAMERA_QUANTITY_SCALE) / CAMERA_QUANTITY_SCALE
      : null;
    if (quantity === null || quantity <= 0) {
      throw new Error(`行${idx + 1}: 数量は0より大きい値を入力してください`);
    }
    if (quantity > MAX_CAMERA_QUANTITY) {
      throw new Error(`行${idx + 1}: 数量は${MAX_CAMERA_QUANTITY}以下で入力してください`);
    }

    const drugMasterId = normalizeOptionalNumber(row.drugMasterId);
    if (drugMasterId === null || !Number.isInteger(drugMasterId) || drugMasterId <= 0) {
      throw new Error(`行${idx + 1}: 医薬品が未確定です。再解析またはコード補完を行ってください`);
    }

    const drugMasterPackageId = normalizeOptionalNumber(row.drugMasterPackageId);
    if (drugMasterPackageId !== null && (!Number.isInteger(drugMasterPackageId) || drugMasterPackageId <= 0)) {
      throw new Error(`行${idx + 1}: 包装情報が不正です`);
    }

    const expirationDate = normalizeExpirationDateIso(row.expirationDate);
    const hasRawExpirationDate = typeof row.expirationDate === 'string'
      ? row.expirationDate.trim().length > 0
      : row.expirationDate !== null && row.expirationDate !== undefined;
    if (hasRawExpirationDate && expirationDate === null) {
      throw new Error(`行${idx + 1}: 使用期限はYYYY-MM-DD形式で入力してください`);
    }

    const rawCode = sanitizeRawCode(row.rawCode) ?? '';
    const codeFromRaw = resolveParsedCodeFromRaw(rawCode, parsedCodeCache);

    return {
      rowNumber: idx + 1,
      rawCode,
      codeFromRaw,
      drugMasterId,
      drugMasterPackageId,
      packageLabel: normalizeOptionalText(row.packageLabel, 120),
      expirationDate,
      lotNumber: normalizeOptionalText(row.lotNumber, 120),
      quantity,
    };
  });
}

function buildMasterById(rows: MasterRow[]): Map<number, MasterRow> {
  return new Map(rows.map((row) => [row.id, row]));
}

function buildPackageById(rows: PackageRow[]): Map<number, PackageRow> {
  return new Map(rows.map((row) => [row.id, row]));
}

function assertMasterAndPackageConsistency(
  parsedItems: ParsedCameraConfirmItem[],
  masterById: Map<number, MasterRow>,
  packageById: Map<number, PackageRow>,
): void {
  for (const item of parsedItems) {
    const master = masterById.get(item.drugMasterId);
    if (!master) {
      throw new Error(`行${item.rowNumber}: 医薬品マスタが見つかりません`);
    }
    if (item.drugMasterPackageId === null) {
      continue;
    }
    const pkg = packageById.get(item.drugMasterPackageId);
    if (!pkg) {
      throw new Error(`行${item.rowNumber}: 包装単位マスタが見つかりません`);
    }
    if (pkg.drugMasterId !== item.drugMasterId) {
      throw new Error(`行${item.rowNumber}: 包装単位が医薬品と一致しません`);
    }
  }
}

export async function confirmCameraDeadStockBatch(
  pharmacyId: number,
  rawItems: unknown,
): Promise<{ uploadId: number; createdCount: number }> {
  const parsedItems = parseCameraConfirmItems(rawItems);

  const masterIds = [...new Set(parsedItems.map((item) => item.drugMasterId))];
  const packageIds = [...new Set(parsedItems
    .map((item) => item.drugMasterPackageId)
    .filter((id): id is number => typeof id === 'number'))];
  const [masterRows, packageRows] = await Promise.all([
    db.select(MASTER_ROW_FIELDS)
      .from(drugMaster)
      .where(inArray(drugMaster.id, masterIds)),
    findPackagesByIds(packageIds),
  ]);
  const masterById = buildMasterById(masterRows);
  const packageById = buildPackageById(packageRows);
  assertMasterAndPackageConsistency(parsedItems, masterById, packageById);

  const now = new Date();
  const uploadFilename = buildCameraUploadFilename(now);
  const uploadRequestedAt = now.toISOString();

  return db.transaction(async (tx) => {
    const [uploadRecord] = await tx.insert(uploads).values({
      pharmacyId,
      uploadType: 'dead_stock',
      originalFilename: uploadFilename,
      columnMapping: null,
      rowCount: parsedItems.length,
      requestedAt: uploadRequestedAt,
    }).returning({ id: uploads.id });

    const rows = buildDeadStockInsertRows({
      pharmacyId,
      uploadId: uploadRecord.id,
      parsedItems,
      masterById,
      packageById,
    });

    await tx.insert(deadStockItems).values(rows);
    await triggerMatchingRefreshOnUpload({
      triggerPharmacyId: pharmacyId,
      uploadType: 'dead_stock',
    }, tx);

    return {
      uploadId: uploadRecord.id,
      createdCount: rows.length,
    };
  });
}
