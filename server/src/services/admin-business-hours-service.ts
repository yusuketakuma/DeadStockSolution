import { desc, eq } from 'drizzle-orm';
import { db } from '../config/database';
import { pharmacyBusinessHours, pharmacySpecialHours, pharmacies } from '../db/schema';

export async function listAllBusinessHours() {
  const regular = await db.select({
    pharmacyId: pharmacyBusinessHours.pharmacyId,
    pharmacyName: pharmacies.name,
    dayOfWeek: pharmacyBusinessHours.dayOfWeek,
    openTime: pharmacyBusinessHours.openTime,
    closeTime: pharmacyBusinessHours.closeTime,
    isClosed: pharmacyBusinessHours.isClosed,
    is24Hours: pharmacyBusinessHours.is24Hours,
  })
    .from(pharmacyBusinessHours)
    .leftJoin(pharmacies, eq(pharmacyBusinessHours.pharmacyId, pharmacies.id))
    .orderBy(pharmacyBusinessHours.pharmacyId, pharmacyBusinessHours.dayOfWeek)
    .limit(500);

  return regular;
}

export async function listSpecialHours() {
  const special = await db.select({
    id: pharmacySpecialHours.id,
    pharmacyId: pharmacySpecialHours.pharmacyId,
    pharmacyName: pharmacies.name,
    specialType: pharmacySpecialHours.specialType,
    startDate: pharmacySpecialHours.startDate,
    endDate: pharmacySpecialHours.endDate,
    openTime: pharmacySpecialHours.openTime,
    closeTime: pharmacySpecialHours.closeTime,
    isClosed: pharmacySpecialHours.isClosed,
    is24Hours: pharmacySpecialHours.is24Hours,
    note: pharmacySpecialHours.note,
  })
    .from(pharmacySpecialHours)
    .leftJoin(pharmacies, eq(pharmacySpecialHours.pharmacyId, pharmacies.id))
    .orderBy(desc(pharmacySpecialHours.startDate))
    .limit(200);

  return special;
}
