import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { db } from '../config/database';
import {
  deadStockItems,
  exchangeProposals,
  pharmacyRelationships,
} from '../db/schema';
import { roundTo2 } from './matching-score-service';

export const MIN_EXCHANGE_VALUE = 10000;
export const VALUE_TOLERANCE = 10;
export const RESERVATION_ACTIVE_STATUSES = ['proposed', 'accepted_a', 'accepted_b', 'confirmed'] as const;

export interface ProposalItemInput {
  deadStockItemId: number;
  quantity: number;
}

export interface ValidatedProposalItem extends ProposalItemInput {
  fromPharmacyId: number;
  toPharmacyId: number;
  yakkaValue: number;
}

export interface ParsedCandidate {
  pharmacyBId: number;
  itemsFromA: ProposalItemInput[];
  itemsFromB: ProposalItemInput[];
}

export type ProposalStatus = typeof exchangeProposals.$inferSelect.status;

export interface ProposalStockRow {
  id: number;
  pharmacyId: number;
  quantity: number | string | null;
  yakkaUnitPrice: number | string | null;
  isAvailable: boolean | null;
}

export interface ProposalValueSummary {
  totalValueA: number;
  totalValueB: number;
  valueDifference: number;
}

export type TransactionClient = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Valid state transitions for exchange proposals
export const VALID_TRANSITIONS = {
  proposed: ['accepted_a', 'accepted_b', 'rejected'],
  accepted_a: ['confirmed', 'rejected'],
  accepted_b: ['confirmed', 'rejected'],
  confirmed: ['completed'],
  rejected: [],
  completed: [],
  cancelled: [],
} satisfies Partial<Record<ProposalStatus, readonly ProposalStatus[]>>;

export function canTransition(from: ProposalStatus, to: ProposalStatus): boolean {
  const candidates = VALID_TRANSITIONS[from];
  return Array.isArray(candidates) && candidates.some((candidate) => candidate === to);
}

export function parseProposalItems(items: unknown, fieldName: string): ProposalItemInput[] {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error(`${fieldName} が不正です`);
  }

  const normalized = items.map((item) => {
    if (!item || typeof item !== 'object') {
      throw new Error(`${fieldName} に不正な要素が含まれています`);
    }

    const id = Number((item as Record<string, unknown>).deadStockItemId);
    const quantityRaw = Number((item as Record<string, unknown>).quantity);
    const quantity = Math.round(quantityRaw * 1000) / 1000;

    if (!Number.isInteger(id) || id <= 0) {
      throw new Error(`${fieldName} に不正な在庫IDが含まれています`);
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error(`${fieldName} に不正な数量が含まれています`);
    }

    return { deadStockItemId: id, quantity };
  });

  const idSet = new Set<number>();
  for (const item of normalized) {
    if (idSet.has(item.deadStockItemId)) {
      throw new Error(`${fieldName} に重複した在庫IDが含まれています`);
    }
    idSet.add(item.deadStockItemId);
  }

  return normalized;
}

export function parseCandidate(pharmacyAId: number, rawCandidate: unknown): ParsedCandidate {
  if (!rawCandidate || typeof rawCandidate !== 'object') {
    throw new Error('候補データが不正です');
  }

  const candidate = rawCandidate as Record<string, unknown>;
  const pharmacyBId = Number(candidate.pharmacyId);

  if (!Number.isInteger(pharmacyBId) || pharmacyBId <= 0 || pharmacyBId === pharmacyAId) {
    throw new Error('交換先薬局IDが不正です');
  }

  return {
    pharmacyBId,
    itemsFromA: parseProposalItems(candidate.itemsFromA, 'itemsFromA'),
    itemsFromB: parseProposalItems(candidate.itemsFromB, 'itemsFromB'),
  };
}

export function validateAndMapProposalItems(params: {
  items: ProposalItemInput[];
  stockMap: Map<number, ProposalStockRow>;
  reservedByStockId: Map<number, number>;
  ownerPharmacyId: number;
  ownerMismatchMessage: string;
  fromPharmacyId: number;
  toPharmacyId: number;
}): ValidatedProposalItem[] {
  const {
    items,
    stockMap,
    reservedByStockId,
    ownerPharmacyId,
    ownerMismatchMessage,
    fromPharmacyId,
    toPharmacyId,
  } = params;

  return items.map((item) => {
    const stock = stockMap.get(item.deadStockItemId);
    if (!stock) throw new Error('提案対象の在庫が見つかりません');
    if (stock.pharmacyId !== ownerPharmacyId) throw new Error(ownerMismatchMessage);
    if (!stock.isAvailable) throw new Error('提案対象の在庫が既に利用不可です');
    const availableQty = Number(stock.quantity) - (reservedByStockId.get(item.deadStockItemId) ?? 0);
    if (item.quantity > availableQty) throw new Error('提案数量が利用可能在庫数を超えています');
    const unitPrice = Number(stock.yakkaUnitPrice);
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) throw new Error('薬価が設定されていない在庫は提案できません');

    return {
      deadStockItemId: item.deadStockItemId,
      fromPharmacyId,
      toPharmacyId,
      quantity: item.quantity,
      yakkaValue: roundTo2(unitPrice * item.quantity),
    };
  });
}

export function calculateProposalValues(
  validatedA: ValidatedProposalItem[],
  validatedB: ValidatedProposalItem[],
): ProposalValueSummary {
  const totalValueA = roundTo2(validatedA.reduce((sum, item) => sum + item.yakkaValue, 0));
  const totalValueB = roundTo2(validatedB.reduce((sum, item) => sum + item.yakkaValue, 0));
  const valueDifference = roundTo2(Math.abs(totalValueA - totalValueB));
  return { totalValueA, totalValueB, valueDifference };
}

export function assertProposalValues(summary: ProposalValueSummary): void {
  if (Math.min(summary.totalValueA, summary.totalValueB) < MIN_EXCHANGE_VALUE) {
    throw new Error('交換金額が最低金額に達していません');
  }
  if (summary.valueDifference > VALUE_TOLERANCE) {
    throw new Error('交換金額差が許容範囲を超えています');
  }
}

export function assertActionPermission(
  proposal: Pick<{ pharmacyAId: number; pharmacyBId: number }, 'pharmacyAId' | 'pharmacyBId'>,
  pharmacyId: number,
): void {
  const isParty = proposal.pharmacyAId === pharmacyId || proposal.pharmacyBId === pharmacyId;
  if (!isParty) {
    throw new Error('このマッチングにアクセスする権限がありません');
  }
}

export async function assertNotBlocked(
  tx: TransactionClient,
  pharmacyAId: number,
  pharmacyBId: number,
): Promise<void> {
  const [blockedRelationship] = await tx.select({ id: pharmacyRelationships.id })
    .from(pharmacyRelationships)
    .where(and(
      eq(pharmacyRelationships.relationshipType, 'blocked'),
      or(
        and(
          eq(pharmacyRelationships.pharmacyId, pharmacyAId),
          eq(pharmacyRelationships.targetPharmacyId, pharmacyBId),
        ),
        and(
          eq(pharmacyRelationships.pharmacyId, pharmacyBId),
          eq(pharmacyRelationships.targetPharmacyId, pharmacyAId),
        ),
      ),
    ))
    .limit(1);

  if (blockedRelationship) {
    throw new Error('ブロック中の薬局には提案できません');
  }
}

export async function validateAndUpdateStock(
  tx: TransactionClient,
  items: Array<{ deadStockItemId: number; fromPharmacyId: number; quantity: number }>,
): Promise<void> {
  const itemIds = [...new Set(items.map((item) => item.deadStockItemId))];
  const stockRows = await tx.select({
    id: deadStockItems.id,
    pharmacyId: deadStockItems.pharmacyId,
    quantity: deadStockItems.quantity,
    isAvailable: deadStockItems.isAvailable,
    drugName: deadStockItems.drugName,
  })
    .from(deadStockItems)
    .where(inArray(deadStockItems.id, itemIds));

  const stockMap = new Map(stockRows.map((row) => [row.id, row]));
  const issues: string[] = [];
  for (const item of items) {
    const stock = stockMap.get(item.deadStockItemId);
    if (!stock || stock.pharmacyId !== item.fromPharmacyId || !stock.isAvailable) {
      const name = stock?.drugName ?? `ID:${item.deadStockItemId}`;
      issues.push(`${name}: 利用不可`);
      continue;
    }
    const currentQty = Number(stock.quantity);
    if (currentQty < Number(item.quantity)) {
      issues.push(`${stock.drugName}: 必要${item.quantity} / 残り${currentQty}`);
    }
  }
  if (issues.length > 0) {
    throw new Error(`在庫状態の問題により交換を完了できません: ${issues.join(', ')}`);
  }
  // N回の逐次UPDATEをPromise.allで並列化しDBラウンドトリップを削減
  const updateResults = await Promise.all(
    items.map((item) =>
      tx.update(deadStockItems)
        .set({
          quantity: sql`${deadStockItems.quantity} - ${item.quantity}`,
          isAvailable: sql`CASE WHEN (${deadStockItems.quantity} - ${item.quantity}) <= 0 THEN false ELSE true END`,
        })
        .where(and(
          eq(deadStockItems.id, item.deadStockItemId),
          eq(deadStockItems.isAvailable, true),
          sql`${deadStockItems.quantity} >= ${item.quantity}`,
        ))
        .returning({ id: deadStockItems.id }),
    ),
  );
  if (updateResults.some((result) => result.length === 0)) {
    throw new Error('在庫状態が変更されているため、交換を完了できません');
  }
}

export function buildStockMap(rows: ProposalStockRow[]): Map<number, ProposalStockRow> {
  return new Map(rows.map((row) => [row.id, row]));
}

export function buildReservedByStockId(
  rows: Array<{ deadStockItemId: number; reservedQty: number | string | null }>,
): Map<number, number> {
  const reservedByStockId = new Map<number, number>();
  for (const row of rows) {
    reservedByStockId.set(row.deadStockItemId, Number(row.reservedQty ?? 0));
  }
  return reservedByStockId;
}

