import crypto from 'crypto';
import { eq, inArray, sql } from 'drizzle-orm';
import { db } from '../config/database';
import { matchCandidateSnapshots, matchNotifications, pharmacies } from '../db/schema';
import { MatchCandidate } from '../types';
import { roundTo2 } from './matching-score-service';

const SNAPSHOT_TOP_CANDIDATE_LIMIT = 10;

type SnapshotTriggerUploadType = 'dead_stock' | 'used_medication';

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

interface StoredSnapshotRow {
  id: number;
  pharmacyId?: number;
  candidateHash: string;
  candidateCount: number | string | null;
  topCandidatesJson: string | null;
}

interface SnapshotSetValue {
  candidateHash: string;
  candidateCount: number;
  topCandidatesJson: string;
  updatedAt: string;
}

interface MatchNotificationValue {
  pharmacyId: number;
  triggerPharmacyId: number;
  triggerUploadType: SnapshotTriggerUploadType;
  candidateCountBefore: number;
  candidateCountAfter: number;
  diffJson: string;
  dedupeKey: string;
  isRead: boolean;
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

function createTopCandidateDigest(candidate: MatchCandidate): TopCandidateDigest {
  return {
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
  };
}

function createSnapshotHashEntry(candidate: MatchCandidate): SnapshotHashEntry {
  return {
    pharmacyId: candidate.pharmacyId,
    totalValueA: safeNumber(candidate.totalValueA),
    totalValueB: safeNumber(candidate.totalValueB),
    valueDifference: safeNumber(candidate.valueDifference),
    itemsFromA: normalizeHashItems(candidate.itemsFromA),
    itemsFromB: normalizeHashItems(candidate.itemsFromB),
  };
}

function getStoredCandidateCount(snapshot: Pick<StoredSnapshotRow, 'candidateCount'> | undefined): number {
  return Number(snapshot?.candidateCount ?? 0);
}

function hasSnapshotChanged(
  snapshot: Pick<StoredSnapshotRow, 'candidateHash' | 'candidateCount'> | undefined,
  next: SnapshotPayload,
): boolean {
  return !snapshot || snapshot.candidateHash !== next.hash || getStoredCandidateCount(snapshot) !== next.candidateCount;
}

function serializeTopCandidates(topCandidates: TopCandidateDigest[]): string {
  return JSON.stringify(topCandidates);
}

function parseTopCandidates(topCandidatesJson: string | null | undefined): TopCandidateDigest[] {
  return topCandidatesJson ? JSON.parse(topCandidatesJson) as TopCandidateDigest[] : [];
}

function createSnapshotSetValue(next: SnapshotPayload, updatedAt: string): SnapshotSetValue {
  return {
    candidateHash: next.hash,
    candidateCount: next.candidateCount,
    topCandidatesJson: serializeTopCandidates(next.topCandidates),
    updatedAt,
  };
}

function createMatchNotificationValue(params: {
  pharmacyId: number;
  triggerPharmacyId: number;
  triggerUploadType: SnapshotTriggerUploadType;
  beforeCount: number;
  beforeTopCandidatesJson?: string | null;
  next: SnapshotPayload;
}): MatchNotificationValue {
  const beforeTopCandidates = parseTopCandidates(params.beforeTopCandidatesJson);
  const diff = calculateSnapshotDiff(
    beforeTopCandidates,
    params.next.topCandidates,
    params.beforeCount,
    params.next.candidateCount,
  );
  const diffSerialized = JSON.stringify(diff);

  return {
    pharmacyId: params.pharmacyId,
    triggerPharmacyId: params.triggerPharmacyId,
    triggerUploadType: params.triggerUploadType,
    candidateCountBefore: params.beforeCount,
    candidateCountAfter: params.next.candidateCount,
    diffJson: diffSerialized,
    dedupeKey: createNotificationDedupeKey({
      triggerPharmacyId: params.triggerPharmacyId,
      triggerUploadType: params.triggerUploadType,
      candidateCountAfter: params.next.candidateCount,
      diffSerialized,
    }),
    isRead: false,
  };
}

async function resolveShouldNotify(pharmacyId: number, notifyEnabled?: boolean): Promise<boolean> {
  if (notifyEnabled !== undefined) {
    return notifyEnabled;
  }

  const [pharmacy] = await db.select({ matchingAutoNotifyEnabled: pharmacies.matchingAutoNotifyEnabled })
    .from(pharmacies)
    .where(eq(pharmacies.id, pharmacyId))
    .limit(1);

  return pharmacy?.matchingAutoNotifyEnabled !== false;
}

export function buildTopCandidateDigest(
  candidates: readonly MatchCandidate[],
  limit: number = SNAPSHOT_TOP_CANDIDATE_LIMIT,
): TopCandidateDigest[] {
  return candidates
    .slice(0, limit)
    .map(createTopCandidateDigest);
}

export function buildSnapshotHashInput(
  candidates: readonly MatchCandidate[],
  limit: number = SNAPSHOT_TOP_CANDIDATE_LIMIT,
): SnapshotHashEntry[] {
  return candidates
    .slice(0, limit)
    .map(createSnapshotHashEntry);
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
  const topCandidates = buildTopCandidateDigest(candidates, SNAPSHOT_TOP_CANDIDATE_LIMIT);
  const hashEntries = buildSnapshotHashInput(candidates, SNAPSHOT_TOP_CANDIDATE_LIMIT);
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
  triggerUploadType: SnapshotTriggerUploadType;
  candidates: MatchCandidate[];
  notifyEnabled?: boolean;
}): Promise<{ changed: boolean; beforeCount: number; afterCount: number }> {
  const { pharmacyId, triggerPharmacyId, triggerUploadType, candidates, notifyEnabled } = params;

  const next = createSnapshotPayload(candidates);
  const snapshotSetValue = createSnapshotSetValue(next, new Date().toISOString());

  const [current] = await db.select({
    id: matchCandidateSnapshots.id,
    candidateHash: matchCandidateSnapshots.candidateHash,
    candidateCount: matchCandidateSnapshots.candidateCount,
    topCandidatesJson: matchCandidateSnapshots.topCandidatesJson,
  })
    .from(matchCandidateSnapshots)
    .where(eq(matchCandidateSnapshots.pharmacyId, pharmacyId))
    .limit(1);

  const beforeCount = getStoredCandidateCount(current);
  const changed = hasSnapshotChanged(current, next);

  if (current) {
    await db.update(matchCandidateSnapshots)
      .set(snapshotSetValue)
      .where(eq(matchCandidateSnapshots.id, current.id));
  } else {
    await db.insert(matchCandidateSnapshots).values({
      pharmacyId,
      ...snapshotSetValue,
    });
  }

  if (changed) {
    if (await resolveShouldNotify(pharmacyId, notifyEnabled)) {
      await db.insert(matchNotifications).values(createMatchNotificationValue({
        pharmacyId,
        triggerPharmacyId,
        triggerUploadType,
        beforeCount,
        beforeTopCandidatesJson: current?.topCandidatesJson,
        next,
      })).onConflictDoNothing({
        target: [matchNotifications.pharmacyId, matchNotifications.dedupeKey],
      });
    }
  }

  return {
    changed,
    beforeCount,
    afterCount: next.candidateCount,
  };
}

// ── バッチスナップショット保存 ──────────────────────────────────────────

/**
 * 複数薬局のスナップショット保存を一括処理する。
 * M回の個別クエリを3回のDBラウンドトリップに削減：
 *   1. 既存スナップショットを一括 SELECT
 *   2. 全スナップショットを一括 UPSERT
 *   3. 変更があった薬局の通知を一括 INSERT
 */
export async function saveMatchSnapshotsBatch(entries: Array<{
  pharmacyId: number;
  triggerPharmacyId: number;
  triggerUploadType: SnapshotTriggerUploadType;
  candidates: MatchCandidate[];
  notifyEnabled: boolean;
}>): Promise<{ changedCount: number }> {
  if (entries.length === 0) return { changedCount: 0 };

  const allPharmacyIds = entries.map((e) => e.pharmacyId);
  const now = new Date().toISOString();

  // 1. 既存スナップショットを一括取得
  const existingRows = await db.select({
    id: matchCandidateSnapshots.id,
    pharmacyId: matchCandidateSnapshots.pharmacyId,
    candidateHash: matchCandidateSnapshots.candidateHash,
    candidateCount: matchCandidateSnapshots.candidateCount,
    topCandidatesJson: matchCandidateSnapshots.topCandidatesJson,
  })
    .from(matchCandidateSnapshots)
    .where(inArray(matchCandidateSnapshots.pharmacyId, allPharmacyIds));

  const existingMap = new Map(existingRows.map((row) => [row.pharmacyId, row]));

  // 2. 各薬局のスナップショットを計算し、変更検知
  type ExistingRow = StoredSnapshotRow;
  type SnapshotEntry = typeof entries[number];
  const upsertValues: Array<{ pharmacyId: number } & SnapshotSetValue> = [];
  const changedEntries: Array<{
    entry: SnapshotEntry;
    next: ReturnType<typeof createSnapshotPayload>;
    existing: ExistingRow | undefined;
  }> = [];

  for (const entry of entries) {
    const next = createSnapshotPayload(entry.candidates);
    const existing = existingMap.get(entry.pharmacyId);
    const changed = hasSnapshotChanged(existing, next);

    upsertValues.push({
      pharmacyId: entry.pharmacyId,
      ...createSnapshotSetValue(next, now),
    });

    if (changed) {
      changedEntries.push({ entry, next, existing });
    }
  }

  // 3. 一括 UPSERT（INSERT ... ON CONFLICT DO UPDATE）
  await db.insert(matchCandidateSnapshots)
    .values(upsertValues)
    .onConflictDoUpdate({
      target: matchCandidateSnapshots.pharmacyId,
      set: {
        candidateHash: sql`excluded.candidate_hash`,
        candidateCount: sql`excluded.candidate_count`,
        topCandidatesJson: sql`excluded.top_candidates_json`,
        updatedAt: sql`excluded.updated_at`,
      },
    });

  // 4. 変更があった薬局の通知を一括 INSERT
  const notificationValues: MatchNotificationValue[] = [];

  for (const { entry, next, existing } of changedEntries) {
    if (!entry.notifyEnabled) continue;

    notificationValues.push(createMatchNotificationValue({
      pharmacyId: entry.pharmacyId,
      triggerPharmacyId: entry.triggerPharmacyId,
      triggerUploadType: entry.triggerUploadType,
      beforeCount: getStoredCandidateCount(existing),
      beforeTopCandidatesJson: existing?.topCandidatesJson,
      next,
    }));
  }

  if (notificationValues.length > 0) {
    await db.insert(matchNotifications)
      .values(notificationValues)
      .onConflictDoNothing({
        target: [matchNotifications.pharmacyId, matchNotifications.dedupeKey],
      });
  }

  return { changedCount: changedEntries.length };
}
