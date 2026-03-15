import { eq, like, or, and, desc, sql, count } from 'drizzle-orm';
import { db } from '../config/database';
import {
  drugMaster,
  drugMasterPackages,
  drugMasterPriceHistory,
  drugMasterSyncLogs,
} from '../db/schema';
import { createCache } from './cache-service';
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

type DrugMasterTextColumn = typeof drugMaster.drugName | typeof drugMaster.genericName;
type DrugMasterRow = typeof drugMaster.$inferSelect;
type DrugDetailRow = DrugMasterRow & {
  packages: Array<ReturnType<typeof normalizePackageRow>>;
  priceHistory: Array<typeof drugMasterPriceHistory.$inferSelect>;
};

const DRUG_MASTER_LOOKUP_CACHE = createCache<DrugMasterRow | null>({
  ttlMs: 86_400_000,
  maxEntries: 10_000,
  name: 'drug_master_lookup',
});
const DRUG_MASTER_LOOKUP_CACHE_ENABLED = process.env.NODE_ENV !== 'test';

const DRUG_DETAIL_CACHE = createCache<DrugDetailRow | null>({
  ttlMs: 86_400_000,
  maxEntries: 10_000,
  name: 'drug_detail_lookup',
});

type PreparedDrugMasterById = {
  execute(params: { drugMasterId: number }): Promise<DrugMasterRow[]>;
};

type PreparedDrugMasterByCode = {
  execute(params: { yjCode: string }): Promise<DrugMasterRow[]>;
};

let prepared_drug_master_by_id: PreparedDrugMasterById | null = null;
let prepared_drug_master_by_code: PreparedDrugMasterByCode | null = null;

function bindParam<T>(name: string): T {
  const placeholderFn = (sql as typeof sql & { placeholder?: (placeholderName: string) => unknown }).placeholder;
  if (typeof placeholderFn === 'function') {
    return placeholderFn(name) as T;
  }
  return name as T;
}

function getPreparedDrugMasterById(): PreparedDrugMasterById | null {
  const placeholderFn = (sql as (typeof sql | undefined) & { placeholder?: unknown })?.placeholder;
  if (process.env.NODE_ENV === 'test' || typeof placeholderFn !== 'function') return null;
  if (prepared_drug_master_by_id) return prepared_drug_master_by_id;
  const query = db.select()
    .from(drugMaster)
    .where(eq(drugMaster.id, bindParam<number>('drugMasterId')))
    .limit(1);
  if (typeof (query as { prepare?: unknown }).prepare === 'function') {
    prepared_drug_master_by_id = (query as { prepare(name: string): PreparedDrugMasterById })
      .prepare('prepared_drug_master_by_id');
  }
  return prepared_drug_master_by_id;
}

function getPreparedDrugMasterByCode(): PreparedDrugMasterByCode | null {
  const placeholderFn = (sql as (typeof sql | undefined) & { placeholder?: unknown })?.placeholder;
  if (process.env.NODE_ENV === 'test' || typeof placeholderFn !== 'function') return null;
  if (prepared_drug_master_by_code) return prepared_drug_master_by_code;
  const query = db.select()
    .from(drugMaster)
    .where(eq(drugMaster.yjCode, bindParam<string>('yjCode')))
    .limit(1);
  if (typeof (query as { prepare?: unknown }).prepare === 'function') {
    prepared_drug_master_by_code = (query as { prepare(name: string): PreparedDrugMasterByCode })
      .prepare('prepared_drug_master_by_code');
  }
  return prepared_drug_master_by_code;
}

function drugCodeCacheKey(code: string): string {
  return `code:${code}`;
}

function drugMasterIdCacheKey(drugMasterId: number): string {
  return `id:${drugMasterId}`;
}

function primeDrugMasterLookupCache(code: string, value: DrugMasterRow | null): void {
  if (!DRUG_MASTER_LOOKUP_CACHE_ENABLED) return;
  DRUG_MASTER_LOOKUP_CACHE.set(drugCodeCacheKey(code), value);
  if (value) {
    DRUG_MASTER_LOOKUP_CACHE.set(drugMasterIdCacheKey(value.id), value);
  }
}

async function fetchDrugMasterById(drugMasterId: number): Promise<DrugMasterRow | null> {
  const cacheKey = drugMasterIdCacheKey(drugMasterId);
  if (DRUG_MASTER_LOOKUP_CACHE_ENABLED) {
    const cached = DRUG_MASTER_LOOKUP_CACHE.get(cacheKey);
    if (cached !== undefined) return cached;
  }

  const prepared = getPreparedDrugMasterById();
  const master = prepared
    ? await prepared.execute({ drugMasterId })
    : await db.select().from(drugMaster).where(eq(drugMaster.id, drugMasterId)).limit(1);
  const resolved = master[0] ?? null;
  if (DRUG_MASTER_LOOKUP_CACHE_ENABLED) {
    DRUG_MASTER_LOOKUP_CACHE.set(cacheKey, resolved);
    if (resolved) {
      DRUG_MASTER_LOOKUP_CACHE.set(drugCodeCacheKey(resolved.yjCode), resolved);
    }
  }
  return resolved;
}

export function invalidateDrugMasterLookupCache(): void {
  if (!DRUG_MASTER_LOOKUP_CACHE_ENABLED) return;
  DRUG_MASTER_LOOKUP_CACHE.invalidateAll();
  DRUG_DETAIL_CACHE.invalidateAll();
}

// ── 検索・照会 ──────────────────────────────────────

/** LIKE パターン中の % と _ をエスケープする */
function escapeLikePattern(term: string): string {
  return term.replace(/%/g, '\\%').replace(/_/g, '\\_');
}

function resolveSearchTerms(query: string): string[] {
  const normalized = normalizeKana(query);
  const hiragana = katakanaToHiragana(normalized);
  const katakana = hiraganaToKatakana(normalized);
  return [...new Set([normalized, hiragana, katakana])];
}

function buildLikeConditions(column: DrugMasterTextColumn, terms: string[]) {
  return terms.map((term) => like(column, `%${escapeLikePattern(term)}%`));
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizePackageRow(pkg: typeof drugMasterPackages.$inferSelect) {
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
}

async function countDrugMasterRows(whereClause?: ReturnType<typeof eq> | ReturnType<typeof and>) {
  const [result] = whereClause
    ? await db.select({ value: count() }).from(drugMaster).where(whereClause)
    : await db.select({ value: count() }).from(drugMaster);
  return result.value;
}

export async function searchDrugMaster(query: string, limit: number = 20) {
  if (!query.trim()) return [];

  const safeLimit = Math.min(Math.max(limit, 1), 100);
  const likeTerms = resolveSearchTerms(query);
  const nameConditions = buildLikeConditions(drugMaster.drugName, likeTerms);
  const genericConditions = buildLikeConditions(drugMaster.genericName, likeTerms);

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
  const codeCacheKey = drugCodeCacheKey(cleaned);
  if (DRUG_MASTER_LOOKUP_CACHE_ENABLED) {
    const cachedByCode = DRUG_MASTER_LOOKUP_CACHE.get(codeCacheKey);
    if (cachedByCode !== undefined) return cachedByCode;
  }

  // YJコード（12桁）直接検索
  const prepared = getPreparedDrugMasterByCode();
  const byYj = prepared
    ? await prepared.execute({ yjCode: cleaned })
    : await db.select().from(drugMaster).where(eq(drugMaster.yjCode, cleaned)).limit(1);
  if (byYj[0]) {
    primeDrugMasterLookupCache(cleaned, byYj[0]);
    return byYj[0];
  }

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
    const master = await fetchDrugMasterById(pkgResult[0].drugMasterId);
    primeDrugMasterLookupCache(cleaned, master);
    return master;
  }

  if (DRUG_MASTER_LOOKUP_CACHE_ENABLED) {
    DRUG_MASTER_LOOKUP_CACHE.set(codeCacheKey, null);
  }
  return null;
}

export async function getDrugMasterStats(): Promise<DrugMasterStats> {
  const [[totalItems, listedItems, transitionItems, delistedItems], [lastSync]] = await Promise.all([
    Promise.all([
      countDrugMasterRows(),
      countDrugMasterRows(eq(drugMaster.isListed, true)),
      countDrugMasterRows(and(eq(drugMaster.isListed, true), sql`${drugMaster.transitionDeadline} IS NOT NULL`)),
      countDrugMasterRows(eq(drugMaster.isListed, false)),
    ]),
    db.select({ startedAt: drugMasterSyncLogs.startedAt })
      .from(drugMasterSyncLogs)
      .where(eq(drugMasterSyncLogs.status, 'success'))
      .orderBy(desc(drugMasterSyncLogs.startedAt))
      .limit(1),
  ]);

  return {
    totalItems,
    listedItems,
    transitionItems,
    delistedItems,
    lastSyncAt: lastSync?.startedAt || null,
  };
}

export async function getDrugDetail(yjCode: string) {
  const detailCacheKey = drugCodeCacheKey(yjCode);
  if (DRUG_MASTER_LOOKUP_CACHE_ENABLED) {
    const cachedDetail = DRUG_DETAIL_CACHE.get(detailCacheKey);
    if (cachedDetail !== undefined) return cachedDetail;
  }

  const [drug] = await db.select().from(drugMaster).where(eq(drugMaster.yjCode, yjCode));
  if (!drug) {
    if (DRUG_MASTER_LOOKUP_CACHE_ENABLED) {
      DRUG_DETAIL_CACHE.set(detailCacheKey, null);
    }
    return null;
  }

  const packageRows = await db.select().from(drugMasterPackages)
    .where(eq(drugMasterPackages.drugMasterId, drug.id));
  const packages = packageRows.map(normalizePackageRow);

  const priceHistory = await db.select().from(drugMasterPriceHistory)
    .where(eq(drugMasterPriceHistory.yjCode, yjCode))
    .orderBy(desc(drugMasterPriceHistory.revisionDate));

  const detail = { ...drug, packages, priceHistory };
  if (DRUG_MASTER_LOOKUP_CACHE_ENABLED) {
    DRUG_DETAIL_CACHE.set(detailCacheKey, detail);
  }
  return detail;
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
  const setValues: Record<string, unknown> = { ...rest, updatedAt: nowIso() };
  if (yakkaPrice !== undefined) {
    setValues.yakkaPrice = String(yakkaPrice);
  }
  const [updated] = await db.update(drugMaster)
    .set(setValues)
    .where(eq(drugMaster.yjCode, yjCode))
    .returning();
  return updated || null;
}
