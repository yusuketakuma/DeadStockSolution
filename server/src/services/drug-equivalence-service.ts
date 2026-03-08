import { and, eq, or, desc } from 'drizzle-orm';
import { db } from '../config/database';
import { drugEquivalences } from '../db/schema';
import type { DrugEquivalence, EquivalenceType } from '../types';
import { logger } from './logger';

const VALID_EQUIVALENCE_TYPES: ReadonlySet<string> = new Set<string>(['brand_generic', 'generic_generic']);

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

async function checkDuplicate(drugNameA: string, drugNameB: string): Promise<void> {
  // Check A-B
  const [existingAB] = await db.select()
    .from(drugEquivalences)
    .where(and(
      eq(drugEquivalences.drugNameA, drugNameA),
      eq(drugEquivalences.drugNameB, drugNameB),
    ))
    .limit(1);

  if (existingAB) {
    throw new DrugEquivalenceDuplicateError('この薬品ペアは既に登録されています');
  }

  // Check B-A (reverse pair)
  const [existingBA] = await db.select()
    .from(drugEquivalences)
    .where(and(
      eq(drugEquivalences.drugNameA, drugNameB),
      eq(drugEquivalences.drugNameB, drugNameA),
    ))
    .limit(1);

  if (existingBA) {
    throw new DrugEquivalenceDuplicateError('この薬品ペアは逆順で既に登録されています');
  }
}

export async function createDrugEquivalence(input: CreateDrugEquivalenceInput): Promise<DrugEquivalence> {
  validateInput(input);
  const trimmedA = input.drugNameA.trim();
  const trimmedB = input.drugNameB.trim();

  await checkDuplicate(trimmedA, trimmedB);

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
  const { limit = 50, offset = 0 } = options;

  const rows = await db.select()
    .from(drugEquivalences)
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
    updateData.drugNameA = input.drugNameA.trim();
  }
  if (input.drugNameB !== undefined) {
    updateData.drugNameB = input.drugNameB.trim();
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

  logger.info('Drug equivalence deleted', { id });
  return true;
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
