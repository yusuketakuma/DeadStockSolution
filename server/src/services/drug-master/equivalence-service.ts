import { and, eq, or, desc } from 'drizzle-orm';
import { db } from '../../config/database';
import { drugEquivalences } from '../../db/schema';
import type { DrugEquivalence, EquivalenceType } from '../../types';
import { logger } from '../logger';
import { buildTokenizedSearchConditions } from '../../utils/search-utils';

const VALID_EQUIVALENCE_TYPES: ReadonlySet<string> = new Set<string>(['brand_generic', 'generic_generic']);
const DEFAULT_EQUIVALENCE_PAGE_SIZE = 50 as const;

export class DrugEquivalenceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DrugEquivalenceValidationError';
  }
}

export class DrugEquivalenceDuplicateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DrugEquivalenceDuplicateError';
  }
}

export interface CreateDrugEquivalenceInput {
  drugNameA: string;
  drugNameB: string;
  equivalenceType: EquivalenceType;
  notes?: string;
}

export interface UpdateDrugEquivalenceInput {
  drugNameA?: string;
  drugNameB?: string;
  equivalenceType?: EquivalenceType;
  notes?: string | null;
}

export interface ListDrugEquivalencesOptions {
  limit?: number;
  offset?: number;
  search?: string;
}

function validateInput(input: CreateDrugEquivalenceInput): void {
  if (!input.drugNameA || input.drugNameA.trim().length === 0) {
    throw new DrugEquivalenceValidationError('薬品名Aを入力してください');
  }
  if (!input.drugNameB || input.drugNameB.trim().length === 0) {
    throw new DrugEquivalenceValidationError('薬品名Bを入力してください');
  }
  if (input.drugNameA.trim() === input.drugNameB.trim()) {
    throw new DrugEquivalenceValidationError('薬品名Aと薬品名Bは異なる名前を指定してください');
  }
  if (!VALID_EQUIVALENCE_TYPES.has(input.equivalenceType)) {
    throw new DrugEquivalenceValidationError('同等性タイプが不正です。brand_generic または generic_generic を指定してください');
  }
}

function trimDrugName(value: string): string {
  return value.trim();
}

function buildPairCondition(drugNameA: string, drugNameB: string) {
  return and(
    eq(drugEquivalences.drugNameA, drugNameA),
    eq(drugEquivalences.drugNameB, drugNameB),
  );
}

async function checkCircularEquivalence(
  drugNameA: string,
  drugNameB: string,
): Promise<void> {
  // 既存の同等性マップを取得（取得失敗時はスキップ — 新規DBなど）
  let map: Map<string, string[]>;
  try {
    map = await fetchEquivalenceMap();
  } catch {
    return;
  }

  // BFS: drugNameB から出発して drugNameA に到達できるか
  // （A→Bを追加しようとしているので、B→...→A のパスがあれば循環）
  const visited = new Set<string>();
  const queue = [drugNameB];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === drugNameA) {
      throw new DrugEquivalenceValidationError(
        `循環する同等性関係が検出されました: ${drugNameA} ↔ ${drugNameB} を追加すると循環が発生します`,
      );
    }
    if (visited.has(current)) continue;
    visited.add(current);

    const neighbors = map.get(current) ?? [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        queue.push(neighbor);
      }
    }
  }
}

async function checkDuplicate(drugNameA: string, drugNameB: string): Promise<void> {
  // Check A-B
  const [existingAB] = await db.select()
    .from(drugEquivalences)
    .where(buildPairCondition(drugNameA, drugNameB))
    .limit(1);

  if (existingAB) {
    throw new DrugEquivalenceDuplicateError('この薬品ペアは既に登録されています');
  }

  // Check B-A (reverse pair)
  const [existingBA] = await db.select()
    .from(drugEquivalences)
    .where(buildPairCondition(drugNameB, drugNameA))
    .limit(1);

  if (existingBA) {
    throw new DrugEquivalenceDuplicateError('この薬品ペアは逆順で既に登録されています');
  }
}

export async function createDrugEquivalence(input: CreateDrugEquivalenceInput): Promise<DrugEquivalence> {
  validateInput(input);
  const trimmedA = trimDrugName(input.drugNameA);
  const trimmedB = trimDrugName(input.drugNameB);

  await checkDuplicate(trimmedA, trimmedB);
  await checkCircularEquivalence(trimmedA, trimmedB);

  const now = new Date().toISOString();
  const [inserted] = await db.insert(drugEquivalences)
    .values({
      drugNameA: trimmedA,
      drugNameB: trimmedB,
      equivalenceType: input.equivalenceType,
      notes: input.notes?.trim() || null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  if (!inserted) {
    throw new Error('薬品同等性の登録に失敗しました');
  }

  cachedEquivalenceMap = null;
  logger.info('Drug equivalence created', { id: inserted.id, drugNameA: trimmedA, drugNameB: trimmedB });
  return toResponse(inserted);
}

export async function getDrugEquivalenceById(id: number): Promise<DrugEquivalence | null> {
  const [row] = await db.select()
    .from(drugEquivalences)
    .where(eq(drugEquivalences.id, id))
    .limit(1);

  return row ? toResponse(row) : null;
}

export async function listDrugEquivalences(
  options: ListDrugEquivalencesOptions = {},
): Promise<DrugEquivalence[]> {
  const { limit = DEFAULT_EQUIVALENCE_PAGE_SIZE, offset = 0, search } = options;

  const searchCondition = search
    ? buildTokenizedSearchConditions(search, [drugEquivalences.drugNameA, drugEquivalences.drugNameB])
    : undefined;

  const rows = await db.select()
    .from(drugEquivalences)
    .where(searchCondition)
    .orderBy(desc(drugEquivalences.id))
    .limit(limit)
    .offset(offset);

  return rows.map(toResponse);
}

export async function updateDrugEquivalence(
  id: number,
  input: UpdateDrugEquivalenceInput,
): Promise<DrugEquivalence | null> {
  const updateData: Record<string, unknown> = {
    updatedAt: new Date().toISOString(),
  };

  if (input.drugNameA !== undefined) {
    updateData.drugNameA = trimDrugName(input.drugNameA);
  }
  if (input.drugNameB !== undefined) {
    updateData.drugNameB = trimDrugName(input.drugNameB);
  }
  if (input.equivalenceType !== undefined) {
    if (!VALID_EQUIVALENCE_TYPES.has(input.equivalenceType)) {
      throw new DrugEquivalenceValidationError('同等性タイプが不正です');
    }
    updateData.equivalenceType = input.equivalenceType;
  }
  if (input.notes !== undefined) {
    updateData.notes = input.notes === null ? null : input.notes.trim() || null;
  }

  const [updated] = await db.update(drugEquivalences)
    .set(updateData)
    .where(eq(drugEquivalences.id, id))
    .returning();

  if (!updated) {
    return null;
  }

  cachedEquivalenceMap = null;
  logger.info('Drug equivalence updated', { id });
  return toResponse(updated);
}

export async function deleteDrugEquivalence(id: number): Promise<boolean> {
  const [deleted] = await db.delete(drugEquivalences)
    .where(eq(drugEquivalences.id, id))
    .returning();

  if (!deleted) {
    return false;
  }

  cachedEquivalenceMap = null;
  logger.info('Drug equivalence deleted', { id });
  return true;
}

const EQUIVALENCE_MAP_TTL_MS = 30 * 60 * 1000; // 30 minutes
let cachedEquivalenceMap: Map<string, string[]> | null = null;
let cachedEquivalenceMapAt = 0;
let pendingFetch: Promise<Map<string, string[]>> | null = null;

export async function fetchEquivalenceMap(): Promise<Map<string, string[]>> {
  const now = Date.now();
  if (cachedEquivalenceMap && now - cachedEquivalenceMapAt < EQUIVALENCE_MAP_TTL_MS) {
    return cachedEquivalenceMap;
  }

  if (pendingFetch) return pendingFetch;

  pendingFetch = (async () => {
    const rows = await db.select().from(drugEquivalences);
    const map = new Map<string, string[]>();
    for (const row of rows) {
      const existingA = map.get(row.drugNameA) ?? [];
      existingA.push(row.drugNameB);
      map.set(row.drugNameA, existingA);
      const existingB = map.get(row.drugNameB) ?? [];
      existingB.push(row.drugNameA);
      map.set(row.drugNameB, existingB);
    }

    cachedEquivalenceMap = map;
    cachedEquivalenceMapAt = Date.now();
    pendingFetch = null;
    return map;
  })();

  return pendingFetch;
}

export async function findEquivalentDrugNames(drugName: string): Promise<string[]> {
  const equivalentNames: string[] = [];

  // Find all equivalence rows involving this drug name (use or() for single query)
  const rows = await db.select()
    .from(drugEquivalences)
    .where(or(
      eq(drugEquivalences.drugNameA, drugName),
      eq(drugEquivalences.drugNameB, drugName),
    ));

  for (const row of rows) {
    if (row.drugNameA === drugName) {
      equivalentNames.push(row.drugNameB);
    } else {
      equivalentNames.push(row.drugNameA);
    }
  }

  return equivalentNames;
}

function toResponse(row: typeof drugEquivalences.$inferSelect): DrugEquivalence {
  return {
    id: row.id,
    drugNameA: row.drugNameA,
    drugNameB: row.drugNameB,
    equivalenceType: row.equivalenceType,
    notes: row.notes,
    createdAt: row.createdAt ?? null,
    updatedAt: row.updatedAt ?? null,
  };
}
