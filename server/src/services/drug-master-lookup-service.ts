import { eq, like, or, and, desc, sql, count } from 'drizzle-orm';
import { db } from '../config/database';
import {
  drugMaster,
  drugMasterPackages,
  drugMasterPriceHistory,
  drugMasterSyncLogs,
} from '../db/schema';
import { katakanaToHiragana, hiraganaToKatakana, normalizeKana } from '../utils/kana-utils';
import { normalizePackageInfo } from '../utils/package-utils';

// ── 型定義 ──────────────────────────────────────────

export interface DrugMasterStats {
  totalItems: number;
  listedItems: number;
  transitionItems: number;
  delistedItems: number;
  lastSyncAt: string | null;
}

// ── 検索・照会 ──────────────────────────────────────

/** LIKE パターン中の % と _ をエスケープする */
function escapeLikePattern(term: string): string {
  return term.replace(/%/g, '\\%').replace(/_/g, '\\_');
}

export async function searchDrugMaster(query: string, limit: number = 20) {
  if (!query.trim()) return [];

  const safeLimit = Math.min(Math.max(limit, 1), 100);
  const normalized = normalizeKana(query);
  const hiragana = katakanaToHiragana(normalized);
  const katakana = hiraganaToKatakana(normalized);

  const likeTerms = new Set([normalized, hiragana, katakana]);
  const nameConditions = [...likeTerms].map((term) => like(drugMaster.drugName, `%${escapeLikePattern(term)}%`));
  const genericConditions = [...likeTerms].map((term) => like(drugMaster.genericName, `%${escapeLikePattern(term)}%`));

  // YJコード直接検索も対応
  const isCodeSearch = /^[A-Z0-9]+$/i.test(query.trim());
  const codeCondition = isCodeSearch ? like(drugMaster.yjCode, `%${escapeLikePattern(query.trim())}%`) : null;

  const allConditions = [...nameConditions, ...genericConditions];
  if (codeCondition) allConditions.push(codeCondition);

  return db.select({
    id: drugMaster.id,
    yjCode: drugMaster.yjCode,
    drugName: drugMaster.drugName,
    genericName: drugMaster.genericName,
    specification: drugMaster.specification,
    unit: drugMaster.unit,
    yakkaPrice: drugMaster.yakkaPrice,
    manufacturer: drugMaster.manufacturer,
    category: drugMaster.category,
    isListed: drugMaster.isListed,
    transitionDeadline: drugMaster.transitionDeadline,
  })
    .from(drugMaster)
    .where(or(...allConditions))
    .limit(safeLimit);
}

export async function lookupByCode(code: string) {
  const cleaned = code.replace(/[\s\-]/g, '').normalize('NFKC');

  // YJコード（12桁）直接検索
  const byYj = await db.select()
    .from(drugMaster)
    .where(eq(drugMaster.yjCode, cleaned))
    .limit(1);
  if (byYj[0]) return byYj[0];

  // GS1/JAN/HOTコードで包装テーブルを検索
  const pkgResult = await db.select({
    drugMasterId: drugMasterPackages.drugMasterId,
  })
    .from(drugMasterPackages)
    .where(or(
      eq(drugMasterPackages.gs1Code, cleaned),
      eq(drugMasterPackages.janCode, cleaned),
      eq(drugMasterPackages.hotCode, cleaned),
    ))
    .limit(1);

  if (pkgResult[0]) {
    const master = await db.select()
      .from(drugMaster)
      .where(eq(drugMaster.id, pkgResult[0].drugMasterId))
      .limit(1);
    return master[0] || null;
  }

  return null;
}

export async function getDrugMasterStats(): Promise<DrugMasterStats> {
  const [totalResult] = await db.select({ value: count() }).from(drugMaster);
  const [listedResult] = await db.select({ value: count() }).from(drugMaster).where(eq(drugMaster.isListed, true));
  const [transitionResult] = await db.select({ value: count() }).from(drugMaster)
    .where(and(eq(drugMaster.isListed, true), sql`${drugMaster.transitionDeadline} IS NOT NULL`));
  const [delistedResult] = await db.select({ value: count() }).from(drugMaster).where(eq(drugMaster.isListed, false));

  const [lastSync] = await db.select({ startedAt: drugMasterSyncLogs.startedAt })
    .from(drugMasterSyncLogs)
    .where(eq(drugMasterSyncLogs.status, 'success'))
    .orderBy(desc(drugMasterSyncLogs.startedAt))
    .limit(1);

  return {
    totalItems: totalResult.value,
    listedItems: listedResult.value,
    transitionItems: transitionResult.value,
    delistedItems: delistedResult.value,
    lastSyncAt: lastSync?.startedAt || null,
  };
}

export async function getDrugDetail(yjCode: string) {
  const [drug] = await db.select().from(drugMaster).where(eq(drugMaster.yjCode, yjCode));
  if (!drug) return null;

  const packageRows = await db.select().from(drugMasterPackages)
    .where(eq(drugMasterPackages.drugMasterId, drug.id));
  const packages = packageRows.map((pkg) => {
    const normalized = normalizePackageInfo({
      packageDescription: pkg.packageDescription,
      packageQuantity: pkg.packageQuantity,
      packageUnit: pkg.packageUnit,
    });
    return {
      ...pkg,
      normalizedPackageLabel: pkg.normalizedPackageLabel ?? normalized.normalizedPackageLabel,
      packageForm: pkg.packageForm ?? normalized.packageForm,
      isLoosePackage: pkg.isLoosePackage ?? normalized.isLoosePackage,
    };
  });

  const priceHistory = await db.select().from(drugMasterPriceHistory)
    .where(eq(drugMasterPriceHistory.yjCode, yjCode))
    .orderBy(desc(drugMasterPriceHistory.revisionDate));

  return { ...drug, packages, priceHistory };
}

export async function getSyncLogs(limit: number = 20) {
  const safeLimit = Math.min(Math.max(limit, 1), 100);
  return db.select()
    .from(drugMasterSyncLogs)
    .orderBy(desc(drugMasterSyncLogs.startedAt))
    .limit(safeLimit);
}

export async function updateDrugMasterItem(yjCode: string, updates: {
  drugName?: string;
  genericName?: string | null;
  specification?: string | null;
  unit?: string | null;
  yakkaPrice?: number;
  manufacturer?: string | null;
  category?: string | null;
  therapeuticCategory?: string | null;
  isListed?: boolean;
  transitionDeadline?: string | null;
}) {
  const { yakkaPrice, ...rest } = updates;
  const setValues: Record<string, unknown> = { ...rest, updatedAt: new Date().toISOString() };
  if (yakkaPrice !== undefined) {
    setValues.yakkaPrice = String(yakkaPrice);
  }
  const [updated] = await db.update(drugMaster)
    .set(setValues)
    .where(eq(drugMaster.yjCode, yjCode))
    .returning();
  return updated || null;
}
