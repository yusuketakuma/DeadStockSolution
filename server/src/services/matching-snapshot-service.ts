import crypto from 'crypto';
import { eq } from 'drizzle-orm';
import { db } from '../config/database';
import { matchCandidateSnapshots, matchNotifications } from '../db/schema';
import { MatchCandidate } from '../types';
import { roundTo2 } from './matching-score-service';

interface TopCandidateDigest {
  pharmacyId: number;
  score: number;
  matchRate: number;
  valueDifference: number;
  totalValueA: number;
  totalValueB: number;
  itemCountA: number;
  itemCountB: number;
  mutualStagnantItems: number;
  mutualNearExpiryItems: number;
  estimatedWasteAvoidanceYen: number;
  estimatedWorkingCapitalReleaseYen: number;
}

interface SnapshotPayload {
  hash: string;
  candidateCount: number;
  topCandidates: TopCandidateDigest[];
}

interface SnapshotHashItem {
  deadStockItemId: number;
  quantity: number;
}

interface SnapshotHashEntry {
  pharmacyId: number;
  totalValueA: number;
  totalValueB: number;
  valueDifference: number;
  itemsFromA: SnapshotHashItem[];
  itemsFromB: SnapshotHashItem[];
}

interface SnapshotDiff {
  addedPharmacyIds: number[];
  removedPharmacyIds: number[];
  beforeCount: number;
  afterCount: number;
}

function safeNumber(value: number | undefined): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0;
  return roundTo2(value);
}

function roundTo3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function normalizeHashItems(items: MatchCandidate['itemsFromA']): SnapshotHashItem[] {
  return items
    .map((item) => ({
      deadStockItemId: item.deadStockItemId,
      quantity: roundTo3(Number(item.quantity)),
    }))
    .sort((a, b) => a.deadStockItemId - b.deadStockItemId || a.quantity - b.quantity);
}

export function buildTopCandidateDigest(candidates: readonly MatchCandidate[], limit: number = 10): TopCandidateDigest[] {
  return candidates
    .slice(0, limit)
    .map((candidate) => ({
      pharmacyId: candidate.pharmacyId,
      score: safeNumber(candidate.score),
      matchRate: safeNumber(candidate.matchRate),
      valueDifference: safeNumber(candidate.valueDifference),
      totalValueA: safeNumber(candidate.totalValueA),
      totalValueB: safeNumber(candidate.totalValueB),
      itemCountA: candidate.itemsFromA.length,
      itemCountB: candidate.itemsFromB.length,
      mutualStagnantItems: safeNumber(candidate.priorityBreakdown?.mutualStagnantItems),
      mutualNearExpiryItems: safeNumber(candidate.priorityBreakdown?.mutualNearExpiryItems),
      estimatedWasteAvoidanceYen: safeNumber(candidate.businessImpact?.estimatedWasteAvoidanceYen),
      estimatedWorkingCapitalReleaseYen: safeNumber(candidate.businessImpact?.estimatedWorkingCapitalReleaseYen),
    }));
}

export function buildSnapshotHashInput(candidates: readonly MatchCandidate[], limit: number = 10): SnapshotHashEntry[] {
  return candidates
    .slice(0, limit)
    .map((candidate) => ({
      pharmacyId: candidate.pharmacyId,
      totalValueA: safeNumber(candidate.totalValueA),
      totalValueB: safeNumber(candidate.totalValueB),
      valueDifference: safeNumber(candidate.valueDifference),
      itemsFromA: normalizeHashItems(candidate.itemsFromA),
      itemsFromB: normalizeHashItems(candidate.itemsFromB),
    }));
}

export function createCandidateHash(hashEntries: SnapshotHashEntry[]): string {
  const serialized = JSON.stringify(hashEntries);
  return crypto.createHash('sha256').update(serialized).digest('hex');
}

function createNotificationDedupeKey(params: {
  triggerPharmacyId: number;
  triggerUploadType: 'dead_stock' | 'used_medication';
  candidateCountAfter: number;
  diffSerialized: string;
}): string {
  const { triggerPharmacyId, triggerUploadType, candidateCountAfter, diffSerialized } = params;
  const payload = `${triggerPharmacyId}:${triggerUploadType}:${candidateCountAfter}:${diffSerialized}`;
  return crypto.createHash('sha256').update(payload).digest('hex');
}

export function createSnapshotPayload(candidates: MatchCandidate[]): SnapshotPayload {
  const top = candidates.slice(0, 10);
  const topCandidates = buildTopCandidateDigest(top, top.length);
  const hashEntries = buildSnapshotHashInput(top, top.length);
  return {
    hash: createCandidateHash(hashEntries),
    candidateCount: candidates.length,
    topCandidates,
  };
}

export function calculateSnapshotDiff(
  beforeTopCandidates: TopCandidateDigest[],
  afterTopCandidates: TopCandidateDigest[],
  beforeCount: number,
  afterCount: number,
): SnapshotDiff {
  const beforeIds = new Set(beforeTopCandidates.map((item) => item.pharmacyId));
  const afterIds = new Set(afterTopCandidates.map((item) => item.pharmacyId));

  const addedPharmacyIds = [...afterIds].filter((id) => !beforeIds.has(id));
  const removedPharmacyIds = [...beforeIds].filter((id) => !afterIds.has(id));

  return {
    addedPharmacyIds,
    removedPharmacyIds,
    beforeCount,
    afterCount,
  };
}

export async function saveMatchSnapshotAndNotifyOnChange(params: {
  pharmacyId: number;
  triggerPharmacyId: number;
  triggerUploadType: 'dead_stock' | 'used_medication';
  candidates: MatchCandidate[];
}): Promise<{ changed: boolean; beforeCount: number; afterCount: number }> {
  const { pharmacyId, triggerPharmacyId, triggerUploadType, candidates } = params;

  const next = createSnapshotPayload(candidates);

  const [current] = await db.select({
    id: matchCandidateSnapshots.id,
    candidateHash: matchCandidateSnapshots.candidateHash,
    candidateCount: matchCandidateSnapshots.candidateCount,
    topCandidatesJson: matchCandidateSnapshots.topCandidatesJson,
  })
    .from(matchCandidateSnapshots)
    .where(eq(matchCandidateSnapshots.pharmacyId, pharmacyId))
    .limit(1);

  const beforeCount = Number(current?.candidateCount ?? 0);
  const changed = !current || current.candidateHash !== next.hash || beforeCount !== next.candidateCount;

  if (current) {
    await db.update(matchCandidateSnapshots)
      .set({
        candidateHash: next.hash,
        candidateCount: next.candidateCount,
        topCandidatesJson: JSON.stringify(next.topCandidates),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(matchCandidateSnapshots.id, current.id));
  } else {
    await db.insert(matchCandidateSnapshots).values({
      pharmacyId,
      candidateHash: next.hash,
      candidateCount: next.candidateCount,
      topCandidatesJson: JSON.stringify(next.topCandidates),
      updatedAt: new Date().toISOString(),
    });
  }

  if (changed) {
    const beforeTopCandidates: TopCandidateDigest[] = current?.topCandidatesJson
      ? JSON.parse(current.topCandidatesJson) as TopCandidateDigest[]
      : [];
    const diff = calculateSnapshotDiff(beforeTopCandidates, next.topCandidates, beforeCount, next.candidateCount);
    const diffSerialized = JSON.stringify(diff);
    const dedupeKey = createNotificationDedupeKey({
      triggerPharmacyId,
      triggerUploadType,
      candidateCountAfter: next.candidateCount,
      diffSerialized,
    });

    await db.insert(matchNotifications).values({
      pharmacyId,
      triggerPharmacyId,
      triggerUploadType,
      candidateCountBefore: beforeCount,
      candidateCountAfter: next.candidateCount,
      diffJson: diffSerialized,
      dedupeKey,
      isRead: false,
    }).onConflictDoNothing({
      target: [matchNotifications.pharmacyId, matchNotifications.dedupeKey],
    });
  }

  return {
    changed,
    beforeCount,
    afterCount: next.candidateCount,
  };
}
