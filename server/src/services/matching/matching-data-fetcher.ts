import { and, eq, exists, gte, inArray, ne, notExists, or, sql } from 'drizzle-orm';
import { db } from '../../config/database';
import {
  deadStockItems,
  deadStockReservations,
  exchangeProposals,
  pharmacies,
  pharmacyBusinessHours,
  pharmacyRelationships,
  pharmacySpecialHours,
  uploadJobs,
  usedMedicationItems,
} from '../../db/schema';
import type { getBusinessHoursStatus } from '../../utils/business-hours-utils';
import { groupByPharmacy } from '../matching-filter-service';
import { createCache } from '../cache-service';

import type {
  DeadStockRow,
  ViablePharmacyRow,
} from '../../types/matching';

export type BusinessHoursRows = Parameters<typeof getBusinessHoursStatus>[0];
export type SpecialHoursRows = NonNullable<Exclude<Parameters<typeof getBusinessHoursStatus>[1], Date>>;

const RESERVATION_ACTIVE_STATUSES = ['proposed', 'accepted_a', 'accepted_b', 'confirmed'] as const;
const BUSINESS_HOURS_CACHE = createCache<{
  businessHours: BusinessHoursRows;
  specialHours: SpecialHoursRows;
}>({
  ttlMs: 86_400_000,
  maxEntries: 5_000,
  name: 'matching_business_hours',
});

export const DEAD_STOCK_SELECT_FIELDS = {
  id: deadStockItems.id,
  pharmacyId: deadStockItems.pharmacyId,
  drugCode: deadStockItems.drugCode,
  drugName: deadStockItems.drugName,
  quantity: deadStockItems.quantity,
  unit: deadStockItems.unit,
  packageLabel: deadStockItems.packageLabel,
  yakkaUnitPrice: deadStockItems.yakkaUnitPrice,
  expirationDate: deadStockItems.expirationDate,
  expirationDateIso: deadStockItems.expirationDateIso,
  lotNumber: deadStockItems.lotNumber,
  createdAt: deadStockItems.createdAt,
};

export const USED_MED_SELECT_FIELDS = {
  pharmacyId: usedMedicationItems.pharmacyId,
  drugName: usedMedicationItems.drugName,
};

type PreparedMatchingDeadStockByPharmacyId = {
  execute(params: { pharmacyId: number }): Promise<any[]>;
};

let prepared_matching_dead_stock_by_pharmacy_id: PreparedMatchingDeadStockByPharmacyId | null = null;

function bindParam<T>(name: string): T {
  const placeholderFn = (sql as typeof sql & { placeholder?: (placeholderName: string) => unknown }).placeholder;
  if (typeof placeholderFn === 'function') {
    return placeholderFn(name) as T;
  }
  return name as T;
}

function getPreparedMatchingDeadStockByPharmacyId(): PreparedMatchingDeadStockByPharmacyId | null {
  const placeholderFn = (sql as (typeof sql | undefined) & { placeholder?: unknown })?.placeholder;
  if (process.env.NODE_ENV === 'test' || typeof placeholderFn !== 'function') return null;
  if (prepared_matching_dead_stock_by_pharmacy_id) {
    return prepared_matching_dead_stock_by_pharmacy_id;
  }
  const query = db.select(DEAD_STOCK_SELECT_FIELDS)
    .from(deadStockItems)
    .where(and(
      eq(deadStockItems.pharmacyId, bindParam<number>('pharmacyId')),
      eq(deadStockItems.isAvailable, true),
    ))
    .orderBy(deadStockItems.id);
  if (typeof (query as { prepare?: unknown }).prepare === 'function') {
    prepared_matching_dead_stock_by_pharmacy_id = (query as { prepare(name: string): PreparedMatchingDeadStockByPharmacyId })
      .prepare('prepared_matching_dead_stock_by_pharmacy_id');
  }
  return prepared_matching_dead_stock_by_pharmacy_id;
}

function buildActiveUploadExistsClause(firstOfMonth: string) {
  return exists(
    db.select({ id: uploadJobs.id })
      .from(uploadJobs)
      .where(and(
        eq(uploadJobs.pharmacyId, pharmacies.id),
        eq(uploadJobs.uploadType, 'used_medication'),
        gte(uploadJobs.createdAt, firstOfMonth),
      )),
  );
}

function buildBlockedRelationshipClause(pharmacyId: number) {
  return notExists(
    db.select({ id: pharmacyRelationships.id })
      .from(pharmacyRelationships)
      .where(or(
        and(
          eq(pharmacyRelationships.pharmacyId, pharmacyId),
          eq(pharmacyRelationships.targetPharmacyId, pharmacies.id),
          eq(pharmacyRelationships.relationshipType, 'blocked'),
        ),
        and(
          eq(pharmacyRelationships.pharmacyId, pharmacies.id),
          eq(pharmacyRelationships.targetPharmacyId, pharmacyId),
          eq(pharmacyRelationships.relationshipType, 'blocked'),
        ),
      )),
  );
}

function buildHasAvailableDeadStockClause() {
  return exists(
    db.select({ id: deadStockItems.id })
      .from(deadStockItems)
      .where(and(
        eq(deadStockItems.pharmacyId, pharmacies.id),
        eq(deadStockItems.isAvailable, true),
      )),
  );
}

function buildHasUsedMedicationClause() {
  return exists(
    db.select({ id: usedMedicationItems.id })
      .from(usedMedicationItems)
      .where(eq(usedMedicationItems.pharmacyId, pharmacies.id)),
  );
}

function buildReservedByItemId(reservationRows: Array<{ deadStockItemId: number; reservedQty: number }>): Map<number, number> {
  const reservedByItemId = new Map<number, number>();
  for (const row of reservationRows) {
    reservedByItemId.set(row.deadStockItemId, Number(row.reservedQty ?? 0));
  }
  return reservedByItemId;
}

function buildEmptyBusinessHoursMaps() {
  return {
    businessHoursByPharmacy: new Map<number, BusinessHoursRows>(),
    specialHoursByPharmacy: new Map<number, SpecialHoursRows>(),
  };
}

function businessHoursCacheKey(pharmacyId: number): string {
  return String(pharmacyId);
}

export async function fetchViablePharmacies(
  pharmacyId: number,
  firstOfMonth: string,
): Promise<ViablePharmacyRow[]> {
  return db.select({
    id: pharmacies.id,
    name: pharmacies.name,
    phone: pharmacies.phone,
    fax: pharmacies.fax,
    latitude: pharmacies.latitude,
    longitude: pharmacies.longitude,
  })
    .from(pharmacies)
    .where(and(
      ne(pharmacies.id, pharmacyId),
      eq(pharmacies.isActive, true),
      buildActiveUploadExistsClause(firstOfMonth),
      buildBlockedRelationshipClause(pharmacyId),
      buildHasAvailableDeadStockClause(),
      buildHasUsedMedicationClause(),
    ));
}

export async function fetchReservationMap(
  allDeadStockIds: number[],
): Promise<Map<number, number>> {
  const reservationRows = allDeadStockIds.length > 0
    ? await db.select({
      deadStockItemId: deadStockReservations.deadStockItemId,
      reservedQty: sql<number>`coalesce(sum(${deadStockReservations.reservedQuantity}), 0)`,
    })
      .from(deadStockReservations)
      .innerJoin(exchangeProposals, eq(deadStockReservations.proposalId, exchangeProposals.id))
      .where(and(
        inArray(deadStockReservations.deadStockItemId, allDeadStockIds),
        inArray(exchangeProposals.status, RESERVATION_ACTIVE_STATUSES),
      ))
      .groupBy(deadStockReservations.deadStockItemId)
    : [];

  return buildReservedByItemId(reservationRows);
}

export async function fetchAvailableDeadStockByPharmacy(pharmacyId: number): Promise<DeadStockRow[]> {
  const prepared = getPreparedMatchingDeadStockByPharmacyId();
  if (prepared) {
    return prepared.execute({ pharmacyId });
  }
  return db.select(DEAD_STOCK_SELECT_FIELDS)
    .from(deadStockItems)
    .where(and(
      eq(deadStockItems.pharmacyId, pharmacyId),
      eq(deadStockItems.isAvailable, true),
    ))
    .orderBy(deadStockItems.id);
}

export async function fetchBusinessHoursMaps(
  pharmacyIds: number[],
): Promise<{
  businessHoursByPharmacy: Map<number, BusinessHoursRows>;
  specialHoursByPharmacy: Map<number, SpecialHoursRows>;
}> {
  if (pharmacyIds.length === 0) {
    return buildEmptyBusinessHoursMaps();
  }

  const uniquePharmacyIds = [...new Set(pharmacyIds)];
  const businessHoursByPharmacy = new Map<number, BusinessHoursRows>();
  const specialHoursByPharmacy = new Map<number, SpecialHoursRows>();
  const cacheMissPharmacyIds: number[] = [];

  for (const pharmacyId of uniquePharmacyIds) {
    const cached = BUSINESS_HOURS_CACHE.get(businessHoursCacheKey(pharmacyId));
    if (cached !== undefined) {
      businessHoursByPharmacy.set(pharmacyId, [...cached.businessHours]);
      specialHoursByPharmacy.set(pharmacyId, [...cached.specialHours]);
    } else {
      cacheMissPharmacyIds.push(pharmacyId);
    }
  }

  if (cacheMissPharmacyIds.length === 0) {
    return { businessHoursByPharmacy, specialHoursByPharmacy };
  }

  const [allBusinessHours, allSpecialHours] = await Promise.all([
    db.select({
      pharmacyId: pharmacyBusinessHours.pharmacyId,
      dayOfWeek: pharmacyBusinessHours.dayOfWeek,
      openTime: pharmacyBusinessHours.openTime,
      closeTime: pharmacyBusinessHours.closeTime,
      isClosed: pharmacyBusinessHours.isClosed,
      is24Hours: pharmacyBusinessHours.is24Hours,
    })
      .from(pharmacyBusinessHours)
      .where(inArray(pharmacyBusinessHours.pharmacyId, cacheMissPharmacyIds)),
    db.select({
      pharmacyId: pharmacySpecialHours.pharmacyId,
      id: pharmacySpecialHours.id,
      specialType: pharmacySpecialHours.specialType,
      startDate: pharmacySpecialHours.startDate,
      endDate: pharmacySpecialHours.endDate,
      openTime: pharmacySpecialHours.openTime,
      closeTime: pharmacySpecialHours.closeTime,
      isClosed: pharmacySpecialHours.isClosed,
      is24Hours: pharmacySpecialHours.is24Hours,
      note: pharmacySpecialHours.note,
      updatedAt: pharmacySpecialHours.updatedAt,
    })
      .from(pharmacySpecialHours)
      .where(inArray(pharmacySpecialHours.pharmacyId, cacheMissPharmacyIds)),
  ]);

  const fetchedBusinessHoursByPharmacy = groupByPharmacy(allBusinessHours);
  const fetchedSpecialHoursByPharmacy = groupByPharmacy(allSpecialHours);

  for (const pharmacyId of cacheMissPharmacyIds) {
    const businessHours = fetchedBusinessHoursByPharmacy.get(pharmacyId) ?? [];
    const specialHours = fetchedSpecialHoursByPharmacy.get(pharmacyId) ?? [];

    businessHoursByPharmacy.set(pharmacyId, businessHours);
    specialHoursByPharmacy.set(pharmacyId, specialHours);
    BUSINESS_HOURS_CACHE.set(businessHoursCacheKey(pharmacyId), {
      businessHours: [...businessHours],
      specialHours: [...specialHours],
    });
  }

  return {
    businessHoursByPharmacy,
    specialHoursByPharmacy,
  };
}
