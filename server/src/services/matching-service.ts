import { eq, ne, and, gte } from 'drizzle-orm';
import { db } from '../config/database';
import { pharmacies, deadStockItems, usedMedicationItems, uploads } from '../db/schema';
import { haversineDistance } from '../utils/geo-utils';
import { normalizeString } from '../utils/string-utils';
import { distance as levenshtein } from 'fastest-levenshtein';
import { MatchCandidate, MatchItem } from '../types';

const MIN_EXCHANGE_VALUE = 10000;
const VALUE_TOLERANCE = 10;

interface PharmacyWithCoords {
  id: number;
  name: string;
  latitude: number | null;
  longitude: number | null;
}

interface DeadStockRow {
  id: number;
  pharmacyId: number;
  drugName: string;
  quantity: number;
  unit: string | null;
  yakkaUnitPrice: number | null;
  isAvailable: boolean | null;
}

interface UsedMedRow {
  drugName: string;
}

function drugNamesMatch(name1: string, name2: string): boolean {
  const n1 = normalizeString(name1);
  const n2 = normalizeString(name2);

  // Exact match
  if (n1 === n2) return true;

  // Containment match
  if (n1.includes(n2) || n2.includes(n1)) return true;

  // Levenshtein distance (20% threshold)
  const maxLen = Math.max(n1.length, n2.length);
  if (maxLen === 0) return false;
  const dist = levenshtein(n1, n2);
  return dist / maxLen <= 0.2;
}

function balanceValues(
  itemsA: MatchItem[],
  itemsB: MatchItem[],
): { balancedA: MatchItem[]; balancedB: MatchItem[]; totalA: number; totalB: number } {
  let totalA = itemsA.reduce((sum, i) => sum + i.yakkaValue, 0);
  let totalB = itemsB.reduce((sum, i) => sum + i.yakkaValue, 0);

  // Sort copies by unit price descending for adjustment
  const adjustableA = [...itemsA].sort((a, b) => (b.yakkaUnitPrice || 0) - (a.yakkaUnitPrice || 0));
  const adjustableB = [...itemsB].sort((a, b) => (b.yakkaUnitPrice || 0) - (a.yakkaUnitPrice || 0));

  // Adjust the higher side
  if (totalA > totalB + VALUE_TOLERANCE) {
    const diff = totalA - totalB;
    let remaining = diff;
    for (const item of adjustableA) {
      if (remaining <= VALUE_TOLERANCE) break;
      if (!item.yakkaUnitPrice || item.yakkaUnitPrice === 0) continue;

      const maxReduction = item.yakkaValue;
      const reduction = Math.min(remaining, maxReduction - item.yakkaUnitPrice * 0.1);
      if (reduction > 0) {
        const unitsToRemove = Math.floor(reduction / item.yakkaUnitPrice * 10) / 10;
        const newQty = Math.max(0.1, item.quantity - unitsToRemove);
        const actualReduction = (item.quantity - newQty) * item.yakkaUnitPrice;
        item.quantity = newQty;
        item.yakkaValue = newQty * item.yakkaUnitPrice;
        remaining -= actualReduction;
      }
    }
    totalA = adjustableA.reduce((sum, i) => sum + i.yakkaValue, 0);
  } else if (totalB > totalA + VALUE_TOLERANCE) {
    const diff = totalB - totalA;
    let remaining = diff;
    for (const item of adjustableB) {
      if (remaining <= VALUE_TOLERANCE) break;
      if (!item.yakkaUnitPrice || item.yakkaUnitPrice === 0) continue;

      const maxReduction = item.yakkaValue;
      const reduction = Math.min(remaining, maxReduction - item.yakkaUnitPrice * 0.1);
      if (reduction > 0) {
        const unitsToRemove = Math.floor(reduction / item.yakkaUnitPrice * 10) / 10;
        const newQty = Math.max(0.1, item.quantity - unitsToRemove);
        const actualReduction = (item.quantity - newQty) * item.yakkaUnitPrice;
        item.quantity = newQty;
        item.yakkaValue = newQty * item.yakkaUnitPrice;
        remaining -= actualReduction;
      }
    }
    totalB = adjustableB.reduce((sum, i) => sum + i.yakkaValue, 0);
  }

  return {
    balancedA: adjustableA.filter((i) => i.quantity > 0),
    balancedB: adjustableB.filter((i) => i.quantity > 0),
    totalA,
    totalB,
  };
}

export async function findMatches(pharmacyId: number): Promise<MatchCandidate[]> {
  // Get current pharmacy coordinates
  const [currentPharmacy] = await db.select({
    id: pharmacies.id,
    name: pharmacies.name,
    latitude: pharmacies.latitude,
    longitude: pharmacies.longitude,
  })
    .from(pharmacies)
    .where(eq(pharmacies.id, pharmacyId))
    .limit(1);

  if (!currentPharmacy) throw new Error('薬局が見つかりません');

  // Get my dead stock
  const myDeadStock = await db.select()
    .from(deadStockItems)
    .where(and(
      eq(deadStockItems.pharmacyId, pharmacyId),
      eq(deadStockItems.isAvailable, true),
    ));

  if (myDeadStock.length === 0) {
    return [];
  }

  // Get my used medications
  const myUsedMeds = await db.select()
    .from(usedMedicationItems)
    .where(eq(usedMedicationItems.pharmacyId, pharmacyId));

  // Get all other active pharmacies that uploaded used medications this month
  const now = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const otherPharmacyIds = await db.select({ pharmacyId: uploads.pharmacyId })
    .from(uploads)
    .where(and(
      ne(uploads.pharmacyId, pharmacyId),
      eq(uploads.uploadType, 'used_medication'),
      gte(uploads.createdAt, firstOfMonth),
    ));

  const uniquePharmacyIds = [...new Set(otherPharmacyIds.map((r) => r.pharmacyId))];
  if (uniquePharmacyIds.length === 0) return [];

  // Get pharmacy details with coordinates
  const otherPharmacies: PharmacyWithCoords[] = [];
  for (const pid of uniquePharmacyIds) {
    const [p] = await db.select({
      id: pharmacies.id,
      name: pharmacies.name,
      latitude: pharmacies.latitude,
      longitude: pharmacies.longitude,
    })
      .from(pharmacies)
      .where(and(eq(pharmacies.id, pid), eq(pharmacies.isActive, true)))
      .limit(1);
    if (p) otherPharmacies.push(p);
  }

  // Calculate distances and sort
  const withDistance = otherPharmacies.map((p) => ({
    ...p,
    distance: (currentPharmacy.latitude && currentPharmacy.longitude && p.latitude && p.longitude)
      ? haversineDistance(currentPharmacy.latitude, currentPharmacy.longitude, p.latitude, p.longitude)
      : 9999,
  })).sort((a, b) => a.distance - b.distance);

  const candidates: MatchCandidate[] = [];

  for (const otherPharmacy of withDistance) {
    // Get other pharmacy's dead stock and used medications
    const theirDeadStock = await db.select()
      .from(deadStockItems)
      .where(and(
        eq(deadStockItems.pharmacyId, otherPharmacy.id),
        eq(deadStockItems.isAvailable, true),
      ));

    const theirUsedMeds = await db.select()
      .from(usedMedicationItems)
      .where(eq(usedMedicationItems.pharmacyId, otherPharmacy.id));

    // A→B: My dead stock that they use
    const itemsFromA: MatchItem[] = [];
    for (const ds of myDeadStock) {
      const match = theirUsedMeds.find((um) => drugNamesMatch(ds.drugName, um.drugName));
      if (match && ds.yakkaUnitPrice) {
        itemsFromA.push({
          deadStockItemId: ds.id,
          drugName: ds.drugName,
          quantity: ds.quantity,
          unit: ds.unit,
          yakkaUnitPrice: ds.yakkaUnitPrice,
          yakkaValue: ds.yakkaUnitPrice * ds.quantity,
        });
      }
    }

    // B→A: Their dead stock that I use
    const itemsFromB: MatchItem[] = [];
    for (const ds of theirDeadStock) {
      const match = myUsedMeds.find((um) => drugNamesMatch(ds.drugName, um.drugName));
      if (match && ds.yakkaUnitPrice) {
        itemsFromB.push({
          deadStockItemId: ds.id,
          drugName: ds.drugName,
          quantity: ds.quantity,
          unit: ds.unit,
          yakkaUnitPrice: ds.yakkaUnitPrice,
          yakkaValue: ds.yakkaUnitPrice * ds.quantity,
        });
      }
    }

    // Both sides must have items
    if (itemsFromA.length === 0 || itemsFromB.length === 0) continue;

    // Balance values
    const { balancedA, balancedB, totalA, totalB } = balanceValues(itemsFromA, itemsFromB);

    // Check minimum value
    const minValue = Math.min(totalA, totalB);
    if (minValue < MIN_EXCHANGE_VALUE) continue;

    // Check value difference
    const diff = Math.abs(totalA - totalB);
    if (diff > VALUE_TOLERANCE) continue;

    candidates.push({
      pharmacyId: otherPharmacy.id,
      pharmacyName: otherPharmacy.name,
      distance: Math.round(otherPharmacy.distance * 10) / 10,
      itemsFromA: balancedA,
      itemsFromB: balancedB,
      totalValueA: Math.round(totalA * 100) / 100,
      totalValueB: Math.round(totalB * 100) / 100,
      valueDifference: Math.round(diff * 100) / 100,
    });
  }

  return candidates;
}
