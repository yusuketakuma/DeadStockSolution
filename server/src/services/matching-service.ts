import { and, eq, gte, inArray, ne } from 'drizzle-orm';
import { db } from '../config/database';
import { pharmacies, deadStockItems, usedMedicationItems, uploads, pharmacyBusinessHours, pharmacyRelationships } from '../db/schema';
import { getBusinessHoursStatus } from '../utils/business-hours-utils';
import { haversineDistance } from '../utils/geo-utils';
import { normalizeString } from '../utils/string-utils';
import { distance as levenshtein } from 'fastest-levenshtein';
import { MatchCandidate, MatchItem } from '../types';

const MIN_EXCHANGE_VALUE = 10000;
const VALUE_TOLERANCE = 10;
const NAME_MATCH_THRESHOLD = 0.7;
const MAX_CANDIDATES = 30;

interface PharmacyCandidate {
  id: number;
  name: string;
  phone: string;
  fax: string;
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
  expirationDate: string | null;
}

interface UsedMedRow {
  pharmacyId: number;
  drugName: string;
}

interface UsedMedName {
  normalizedName: string;
  tokenSet: Set<string>;
  length: number;
}

interface UsedMedIndex {
  exactNames: Set<string>;
  names: UsedMedName[];
  tokenIndex: Map<string, number[]>;
}

interface DrugMatchResult {
  score: number;
}

interface BalancedValueResult {
  balancedA: MatchItem[];
  balancedB: MatchItem[];
  totalA: number;
  totalB: number;
}

function roundTo2(value: number): number {
  return Math.round(value * 100) / 100;
}

function normalizeDrugName(name: string): string {
  return normalizeString(name)
    .replace(/[0-9]+(?:\.[0-9]+)?(?:mg|ml|μg|mcg|g|％|%)/gi, '')
    .replace(/(錠|カプセル|散|シロップ|注射|外用|内服|点眼|軟膏)$/g, '')
    .trim();
}

function createTokenSet(normalizedName: string): Set<string> {
  const baseTokens = normalizedName
    .replace(/[^a-z0-9ぁ-んァ-ヶ一-龠]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 0);

  const tokenSet = new Set<string>(baseTokens);
  const forNgram = baseTokens.length <= 1 ? (baseTokens[0] ?? normalizedName) : '';

  if (forNgram.length >= 3) {
    for (let i = 0; i < forNgram.length - 1; i++) {
      tokenSet.add(forNgram.slice(i, i + 2));
    }
  }

  if (tokenSet.size === 0 && normalizedName) {
    tokenSet.add(normalizedName);
  }

  return tokenSet;
}

function jaccardScore(tokensA: Set<string>, tokensB: Set<string>): number {
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  const [smaller, larger] = tokensA.size <= tokensB.size
    ? [tokensA, tokensB]
    : [tokensB, tokensA];

  let intersection = 0;
  for (const token of smaller) {
    if (larger.has(token)) intersection += 1;
  }
  const union = tokensA.size + tokensB.size - intersection;
  if (union === 0) return 0;
  return intersection / union;
}

function computeNameSimilarity(
  normalizedA: string,
  tokensA: Set<string>,
  nameB: UsedMedName
): number {
  const normalizedB = nameB.normalizedName;

  if (!normalizedA || !normalizedB) return 0;
  if (normalizedA === normalizedB) return 1;
  if (normalizedA.includes(normalizedB) || normalizedB.includes(normalizedA)) return 0.9;

  const tokenScore = jaccardScore(tokensA, nameB.tokenSet);
  const maxLen = Math.max(normalizedA.length, normalizedB.length);
  if (maxLen === 0) return tokenScore;

  // Token overlap and string length can reject unlikely pairs before Levenshtein.
  if (tokenScore < 0.12 && Math.abs(normalizedA.length - nameB.length) > maxLen * 0.6) {
    return tokenScore;
  }

  const levScore = maxLen === 0 ? 0 : 1 - (levenshtein(normalizedA, normalizedB) / maxLen);

  return Math.max(levScore, tokenScore);
}

function buildUsedMedIndex(rows: UsedMedRow[]): UsedMedIndex {
  const names: UsedMedName[] = [];
  const exactNames = new Set<string>();
  const tokenIndex = new Map<string, number[]>();

  for (const row of rows) {
    const normalizedName = normalizeDrugName(row.drugName);
    if (!normalizedName || exactNames.has(normalizedName)) continue;
    exactNames.add(normalizedName);
    const tokenSet = createTokenSet(normalizedName);
    const index = names.length;
    names.push({
      normalizedName,
      tokenSet,
      length: normalizedName.length,
    });

    for (const token of tokenSet) {
      if (token.length < 2) continue;
      const list = tokenIndex.get(token);
      if (list) {
        list.push(index);
      } else {
        tokenIndex.set(token, [index]);
      }
    }
  }

  return { exactNames, names, tokenIndex };
}

function collectCandidateIndices(
  normalizedDrugName: string,
  tokenSet: Set<string>,
  index: UsedMedIndex
): number[] | null {
  const candidateIds = new Set<number>();

  for (const token of tokenSet) {
    const matched = index.tokenIndex.get(token);
    if (!matched) continue;
    for (const id of matched) {
      candidateIds.add(id);
      if (candidateIds.size >= 500) break;
    }
    if (candidateIds.size >= 500) break;
  }

  // Ensure near-length alternatives are included when token hit is sparse.
  if (candidateIds.size > 0 && candidateIds.size < 25) {
    const targetLength = normalizedDrugName.length;
    for (let i = 0; i < index.names.length; i++) {
      if (Math.abs(index.names[i].length - targetLength) <= 2) {
        candidateIds.add(i);
        if (candidateIds.size >= 200) break;
      }
    }
  }

  if (candidateIds.size === 0 || candidateIds.size >= index.names.length * 0.9) {
    return null;
  }

  return [...candidateIds];
}

function findBestDrugMatch(
  drugName: string,
  index: UsedMedIndex,
  cache: Map<string, DrugMatchResult>
): DrugMatchResult {
  const normalizedDrugName = normalizeDrugName(drugName);
  if (!normalizedDrugName) return { score: 0 };
  const tokenSet = createTokenSet(normalizedDrugName);

  const cached = cache.get(normalizedDrugName);
  if (cached) return cached;

  if (index.exactNames.has(normalizedDrugName)) {
    const result = { score: 1 };
    cache.set(normalizedDrugName, result);
    return result;
  }

  let bestScore = 0;
  const candidateIndices = collectCandidateIndices(normalizedDrugName, tokenSet, index);
  const candidates = candidateIndices
    ? candidateIndices.map((i) => index.names[i])
    : index.names;

  for (const name of candidates) {
    const score = computeNameSimilarity(normalizedDrugName, tokenSet, name);
    if (score > bestScore) {
      bestScore = score;
      if (bestScore >= 0.98) break;
    }
  }

  const result = { score: bestScore };
  cache.set(normalizedDrugName, result);
  return result;
}

const parsedExpiryCache = new Map<string, Date | null>();

function parseExpiryDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const raw = value.trim();
  if (!raw) return null;
  if (parsedExpiryCache.has(raw)) {
    return parsedExpiryCache.get(raw) ?? null;
  }

  const normalized = raw
    .replace(/[年月.\-]/g, '/')
    .replace(/日/g, '')
    .replace(/\s+/g, '');

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    parsedExpiryCache.set(raw, null);
    return null;
  }

  parsedExpiryCache.set(raw, parsed);
  return parsed;
}

function getNearExpiryCount(items: MatchItem[]): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let count = 0;
  for (const item of items) {
    const expiry = parseExpiryDate(item.expirationDate);
    if (!expiry) continue;
    const diffDays = Math.floor((expiry.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
    if (diffDays >= 0 && diffDays <= 120) count += 1;
  }
  return count;
}

const FAVORITE_BONUS = 15;

function calculateCandidateScore(
  totalA: number,
  totalB: number,
  diff: number,
  distanceKm: number,
  itemsFromA: MatchItem[],
  itemsFromB: MatchItem[],
  isFavorite: boolean = false
): number {
  const minValue = Math.min(totalA, totalB);
  const valueScore = Math.min(55, minValue / 2500);
  const balanceScore = Math.max(0, 20 - diff * 1.5);
  const distanceScore = distanceKm >= 9999 ? 2 : Math.max(0, 15 - distanceKm / 8);
  const nearExpiryScore = Math.min(10, (getNearExpiryCount(itemsFromA) + getNearExpiryCount(itemsFromB)) * 1.5);
  const diversityScore = Math.min(10, Math.min(itemsFromA.length, itemsFromB.length) * 1.5);
  const favoriteScore = isFavorite ? FAVORITE_BONUS : 0;

  return roundTo2(valueScore + balanceScore + distanceScore + nearExpiryScore + diversityScore + favoriteScore);
}

function calculateMatchRate(itemsA: MatchItem[], itemsB: MatchItem[]): number {
  const scores = [...itemsA, ...itemsB]
    .map((item) => item.matchScore ?? 0)
    .filter((score) => score > 0);
  if (scores.length === 0) return 0;
  return roundTo2((scores.reduce((sum, score) => sum + score, 0) / scores.length) * 100);
}

function balanceValues(itemsA: MatchItem[], itemsB: MatchItem[]): BalancedValueResult {
  let totalA = itemsA.reduce((sum, i) => sum + i.yakkaValue, 0);
  let totalB = itemsB.reduce((sum, i) => sum + i.yakkaValue, 0);

  const adjustableA = [...itemsA].sort((a, b) => (b.yakkaUnitPrice || 0) - (a.yakkaUnitPrice || 0));
  const adjustableB = [...itemsB].sort((a, b) => (b.yakkaUnitPrice || 0) - (a.yakkaUnitPrice || 0));

  if (totalA > totalB + VALUE_TOLERANCE) {
    let remaining = totalA - totalB;
    for (const item of adjustableA) {
      if (remaining <= VALUE_TOLERANCE) break;

      const maxReduction = item.yakkaValue;
      const minReductionUnit = item.yakkaUnitPrice * 0.1;
      const reduction = Math.min(remaining, Math.max(0, maxReduction - minReductionUnit));
      if (reduction <= 0) continue;

      const unitsToRemove = Math.floor((reduction / item.yakkaUnitPrice) * 10) / 10;
      const newQty = Math.max(0.1, item.quantity - unitsToRemove);
      const actualReduction = (item.quantity - newQty) * item.yakkaUnitPrice;
      item.quantity = newQty;
      item.yakkaValue = roundTo2(newQty * item.yakkaUnitPrice);
      remaining -= actualReduction;
    }
    totalA = adjustableA.reduce((sum, i) => sum + i.yakkaValue, 0);
  } else if (totalB > totalA + VALUE_TOLERANCE) {
    let remaining = totalB - totalA;
    for (const item of adjustableB) {
      if (remaining <= VALUE_TOLERANCE) break;

      const maxReduction = item.yakkaValue;
      const minReductionUnit = item.yakkaUnitPrice * 0.1;
      const reduction = Math.min(remaining, Math.max(0, maxReduction - minReductionUnit));
      if (reduction <= 0) continue;

      const unitsToRemove = Math.floor((reduction / item.yakkaUnitPrice) * 10) / 10;
      const newQty = Math.max(0.1, item.quantity - unitsToRemove);
      const actualReduction = (item.quantity - newQty) * item.yakkaUnitPrice;
      item.quantity = newQty;
      item.yakkaValue = roundTo2(newQty * item.yakkaUnitPrice);
      remaining -= actualReduction;
    }
    totalB = adjustableB.reduce((sum, i) => sum + i.yakkaValue, 0);
  }

  return {
    balancedA: adjustableA.filter((item) => item.quantity > 0),
    balancedB: adjustableB.filter((item) => item.quantity > 0),
    totalA: roundTo2(totalA),
    totalB: roundTo2(totalB),
  };
}

function groupByPharmacy<T extends { pharmacyId: number }>(rows: T[]): Map<number, T[]> {
  const grouped = new Map<number, T[]>();
  for (const row of rows) {
    const list = grouped.get(row.pharmacyId);
    if (list) {
      list.push(row);
    } else {
      grouped.set(row.pharmacyId, [row]);
    }
  }
  return grouped;
}

export async function findMatches(pharmacyId: number): Promise<MatchCandidate[]> {
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

  const [myDeadStock, myUsedMeds] = await Promise.all([
    db.select({
      id: deadStockItems.id,
      pharmacyId: deadStockItems.pharmacyId,
      drugName: deadStockItems.drugName,
      quantity: deadStockItems.quantity,
      unit: deadStockItems.unit,
      yakkaUnitPrice: deadStockItems.yakkaUnitPrice,
      expirationDate: deadStockItems.expirationDate,
    })
      .from(deadStockItems)
      .where(and(
        eq(deadStockItems.pharmacyId, pharmacyId),
        eq(deadStockItems.isAvailable, true),
      )),
    db.select({
      pharmacyId: usedMedicationItems.pharmacyId,
      drugName: usedMedicationItems.drugName,
    })
      .from(usedMedicationItems)
      .where(eq(usedMedicationItems.pharmacyId, pharmacyId)),
  ]);

  if (myDeadStock.length === 0 || myUsedMeds.length === 0) {
    return [];
  }

  const now = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const otherPharmacyIdRows = await db.select({ pharmacyId: uploads.pharmacyId })
    .from(uploads)
    .where(and(
      ne(uploads.pharmacyId, pharmacyId),
      eq(uploads.uploadType, 'used_medication'),
      gte(uploads.createdAt, firstOfMonth),
    ));

  const uniquePharmacyIds = [...new Set(otherPharmacyIdRows.map((row) => row.pharmacyId))];
  if (uniquePharmacyIds.length === 0) return [];

  // Load pharmacy relationships (favorites and blocked)
  const relationships = await db.select({
    targetPharmacyId: pharmacyRelationships.targetPharmacyId,
    relationshipType: pharmacyRelationships.relationshipType,
  })
    .from(pharmacyRelationships)
    .where(eq(pharmacyRelationships.pharmacyId, pharmacyId));

  const blockedIds = new Set(
    relationships.filter((r) => r.relationshipType === 'blocked').map((r) => r.targetPharmacyId)
  );
  const favoriteIds = new Set(
    relationships.filter((r) => r.relationshipType === 'favorite').map((r) => r.targetPharmacyId)
  );

  // Exclude blocked pharmacies from candidates
  const filteredPharmacyIds = uniquePharmacyIds.filter((id) => !blockedIds.has(id));
  if (filteredPharmacyIds.length === 0) return [];

  const allOtherPharmacies = await db.select({
    id: pharmacies.id,
    name: pharmacies.name,
    phone: pharmacies.phone,
    fax: pharmacies.fax,
    latitude: pharmacies.latitude,
    longitude: pharmacies.longitude,
  })
    .from(pharmacies)
    .where(and(
      inArray(pharmacies.id, filteredPharmacyIds),
      eq(pharmacies.isActive, true),
    ));

  if (allOtherPharmacies.length === 0) return [];

  const activePharmacyIds = allOtherPharmacies.map((pharmacy) => pharmacy.id);

  const [allOtherDeadStock, allOtherUsedMeds] = await Promise.all([
    db.select({
      id: deadStockItems.id,
      pharmacyId: deadStockItems.pharmacyId,
      drugName: deadStockItems.drugName,
      quantity: deadStockItems.quantity,
      unit: deadStockItems.unit,
      yakkaUnitPrice: deadStockItems.yakkaUnitPrice,
      expirationDate: deadStockItems.expirationDate,
    })
      .from(deadStockItems)
      .where(and(
        inArray(deadStockItems.pharmacyId, activePharmacyIds),
        eq(deadStockItems.isAvailable, true),
      )),
    db.select({
      pharmacyId: usedMedicationItems.pharmacyId,
      drugName: usedMedicationItems.drugName,
    })
      .from(usedMedicationItems)
      .where(inArray(usedMedicationItems.pharmacyId, activePharmacyIds)),
  ]);

  // Fetch business hours for all candidate pharmacies
  const allBusinessHours = await db.select({
    pharmacyId: pharmacyBusinessHours.pharmacyId,
    dayOfWeek: pharmacyBusinessHours.dayOfWeek,
    openTime: pharmacyBusinessHours.openTime,
    closeTime: pharmacyBusinessHours.closeTime,
    isClosed: pharmacyBusinessHours.isClosed,
    is24Hours: pharmacyBusinessHours.is24Hours,
  })
    .from(pharmacyBusinessHours)
    .where(inArray(pharmacyBusinessHours.pharmacyId, activePharmacyIds));

  const businessHoursByPharmacy = new Map<number, typeof allBusinessHours>();
  for (const h of allBusinessHours) {
    const list = businessHoursByPharmacy.get(h.pharmacyId) ?? [];
    list.push(h);
    businessHoursByPharmacy.set(h.pharmacyId, list);
  }

  const deadStockByPharmacy = groupByPharmacy<DeadStockRow>(allOtherDeadStock);
  const usedMedsByPharmacy = groupByPharmacy<UsedMedRow>(allOtherUsedMeds);
  const myUsedMedIndex = buildUsedMedIndex(myUsedMeds);

  const pharmaciesWithDistance = allOtherPharmacies
    .map((pharmacy) => ({
      ...pharmacy,
      distance: (
        currentPharmacy.latitude !== null &&
        currentPharmacy.longitude !== null &&
        pharmacy.latitude !== null &&
        pharmacy.longitude !== null
      )
        ? haversineDistance(currentPharmacy.latitude, currentPharmacy.longitude, pharmacy.latitude, pharmacy.longitude)
        : 9999,
    }))
    .sort((a, b) => a.distance - b.distance);

  const candidates: MatchCandidate[] = [];

  for (const otherPharmacy of pharmaciesWithDistance) {
    const theirDeadStock = deadStockByPharmacy.get(otherPharmacy.id) ?? [];
    const theirUsedMeds = usedMedsByPharmacy.get(otherPharmacy.id) ?? [];
    if (theirDeadStock.length === 0 || theirUsedMeds.length === 0) continue;

    const theirUsedMedIndex = buildUsedMedIndex(theirUsedMeds);
    const myToTheirCache = new Map<string, DrugMatchResult>();
    const theirToMyCache = new Map<string, DrugMatchResult>();

    const itemsFromA: MatchItem[] = [];
    for (const stock of myDeadStock) {
      if (!stock.yakkaUnitPrice || stock.yakkaUnitPrice <= 0) continue;

      const match = findBestDrugMatch(stock.drugName, theirUsedMedIndex, myToTheirCache);
      if (match.score < NAME_MATCH_THRESHOLD) continue;

      itemsFromA.push({
        deadStockItemId: stock.id,
        drugName: stock.drugName,
        quantity: stock.quantity,
        unit: stock.unit,
        yakkaUnitPrice: stock.yakkaUnitPrice,
        yakkaValue: roundTo2(stock.yakkaUnitPrice * stock.quantity),
        expirationDate: stock.expirationDate,
        matchScore: roundTo2(match.score),
      });
    }

    const itemsFromB: MatchItem[] = [];
    for (const stock of theirDeadStock) {
      if (!stock.yakkaUnitPrice || stock.yakkaUnitPrice <= 0) continue;

      const match = findBestDrugMatch(stock.drugName, myUsedMedIndex, theirToMyCache);
      if (match.score < NAME_MATCH_THRESHOLD) continue;

      itemsFromB.push({
        deadStockItemId: stock.id,
        drugName: stock.drugName,
        quantity: stock.quantity,
        unit: stock.unit,
        yakkaUnitPrice: stock.yakkaUnitPrice,
        yakkaValue: roundTo2(stock.yakkaUnitPrice * stock.quantity),
        expirationDate: stock.expirationDate,
        matchScore: roundTo2(match.score),
      });
    }

    if (itemsFromA.length === 0 || itemsFromB.length === 0) continue;

    const { balancedA, balancedB, totalA, totalB } = balanceValues(itemsFromA, itemsFromB);
    if (balancedA.length === 0 || balancedB.length === 0) continue;

    const minValue = Math.min(totalA, totalB);
    if (minValue < MIN_EXCHANGE_VALUE) continue;

    const diff = roundTo2(Math.abs(totalA - totalB));
    if (diff > VALUE_TOLERANCE) continue;

    const isFavorite = favoriteIds.has(otherPharmacy.id);
    const score = calculateCandidateScore(totalA, totalB, diff, otherPharmacy.distance, balancedA, balancedB, isFavorite);
    const matchRate = calculateMatchRate(balancedA, balancedB);

    const pharmacyHours = businessHoursByPharmacy.get(otherPharmacy.id) ?? [];
    const businessStatus = getBusinessHoursStatus(pharmacyHours, now);

    candidates.push({
      pharmacyId: otherPharmacy.id,
      pharmacyName: otherPharmacy.name,
      pharmacyPhone: otherPharmacy.phone,
      pharmacyFax: otherPharmacy.fax,
      distance: roundTo2(otherPharmacy.distance),
      itemsFromA: balancedA,
      itemsFromB: balancedB,
      totalValueA: roundTo2(totalA),
      totalValueB: roundTo2(totalB),
      valueDifference: diff,
      score,
      matchRate,
      businessStatus,
      isFavorite,
    });
  }

  return candidates
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.distance - b.distance)
    .slice(0, MAX_CANDIDATES);
}
