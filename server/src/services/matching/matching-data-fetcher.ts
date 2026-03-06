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
  uploads,
  usedMedicationItems,
} from '../../db/schema';
import type { getBusinessHoursStatus } from '../../utils/business-hours-utils';
import { groupByPharmacy } from '../matching-filter-service';

export interface DeadStockRow {
  id: number;
  pharmacyId: number;
  drugName: string;
  quantity: number;
  unit: string | null;
  yakkaUnitPrice: number | string | null;
  expirationDate: string | null;
  expirationDateIso: string | null;
  lotNumber: string | null;
  createdAt: string | null;
}

export interface ViablePharmacyRow {
  id: number;
  name: string;
  phone: string | null;
  fax: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface PharmacyWithDistance extends ViablePharmacyRow {
  distance: number;
}

export type BusinessHoursRows = Parameters<typeof getBusinessHoursStatus>[0];
export type SpecialHoursRows = Exclude<Parameters<typeof getBusinessHoursStatus>[1], Date>;

const RESERVATION_ACTIVE_STATUSES = ['proposed', 'accepted_a', 'accepted_b', 'confirmed'] as const;

export const DEAD_STOCK_SELECT_FIELDS = {
  id: deadStockItems.id,
  pharmacyId: deadStockItems.pharmacyId,
  drugName: deadStockItems.drugName,
  quantity: deadStockItems.quantity,
  unit: deadStockItems.unit,
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
      exists(
        db.select({ id: uploads.id })
          .from(uploads)
          .where(and(
            eq(uploads.pharmacyId, pharmacies.id),
            eq(uploads.uploadType, 'used_medication'),
            gte(uploads.createdAt, firstOfMonth),
          )),
      ),
      notExists(
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
      ),
      exists(
        db.select({ id: deadStockItems.id })
          .from(deadStockItems)
          .where(and(
            eq(deadStockItems.pharmacyId, pharmacies.id),
            eq(deadStockItems.isAvailable, true),
          )),
      ),
      exists(
        db.select({ id: usedMedicationItems.id })
          .from(usedMedicationItems)
          .where(eq(usedMedicationItems.pharmacyId, pharmacies.id)),
      ),
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

  const reservedByItemId = new Map<number, number>();
  for (const row of reservationRows) {
    reservedByItemId.set(row.deadStockItemId, Number(row.reservedQty ?? 0));
  }
  return reservedByItemId;
}

export async function fetchBusinessHoursMaps(
  pharmacyIds: number[],
): Promise<{
  businessHoursByPharmacy: Map<number, BusinessHoursRows>;
  specialHoursByPharmacy: Map<number, SpecialHoursRows>;
}> {
  if (pharmacyIds.length === 0) {
    return {
      businessHoursByPharmacy: new Map(),
      specialHoursByPharmacy: new Map(),
    };
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
      .where(inArray(pharmacyBusinessHours.pharmacyId, pharmacyIds)),
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
      .where(inArray(pharmacySpecialHours.pharmacyId, pharmacyIds)),
  ]);

  return {
    businessHoursByPharmacy: groupByPharmacy(allBusinessHours),
    specialHoursByPharmacy: groupByPharmacy(allSpecialHours),
  };
}
