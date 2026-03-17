import crypto from 'crypto';
import { eq, inArray, sql } from 'drizzle-orm';
import { db } from '../config/database';
import { matchCandidateSnapshots, notifications, pharmacies } from '../db/schema';
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
  topCandidatesJson: unknown;
}

interface SnapshotSetValue {
  candidateHash: string;
  candidateCount: number;
  topCandidatesJson: unknown;
  updatedAt: string;
}

interface MatchNotificationValue {
  pharmacyId: number;
  type: 'match_update';
  title: string;
  message: string;
  referenceType: 'match';
  sourcePharmacyId: number;
  dedupeKey: string;
  detailJson: {
    trigger_upload_type: SnapshotTriggerUploadType;
    candidate_count_before: number;
    candidate_count_after: number;
    diff: unknown;
  };
}

type SnapshotDbExecutor = Pick<typeof db, 'select' | 'insert' | 'update'>;
type SnapshotMutationExecutor = Pick<typeof db, 'insert' | 'update'>;

function selectSnapshotColumns() {
  return {
    id: matchCandidateSnapshots.id,
    pharmacyId: matchCandidateSnapshots.pharmacyId,
    candidateHash: matchCandidateSnapshots.candidateHash,
    candidateCount: matchCandidateSnapshots.candidateCount,
    topCandidatesJson: matchCandidateSnapshots.topCandidatesJson,
  };
}

async function fetchSnapshotByPharmacyId(
  executor: SnapshotDbExecutor,
  pharmacyId: number,
): Promise<StoredSnapshotRow | undefined> {
  const [snapshot] = await executor.select(selectSnapshotColumns())
    .from(matchCandidateSnapshots)
    .where(eq(matchCandidateSnapshots.pharmacyId, pharmacyId))
    .limit(1);

  return snapshot;
}

async function fetchSnapshotsByPharmacyIds(
  executor: SnapshotDbExecutor,
  pharmacyIds: number[],
): Promise<StoredSnapshotRow[]> {
  if (pharmacyIds.length === 0) {
    return [];
  }

  return executor.select(selectSnapshotColumns())
    .from(matchCandidateSnapshots)
    .where(inArray(matchCandidateSnapshots.pharmacyId, pharmacyIds));
}

async function insertMatchNotifications(
  executor: SnapshotMutationExecutor,
  values: MatchNotificationValue | MatchNotificationValue[],
): Promise<void> {
  if (Array.isArray(values) && values.length === 0) {
    return;
  }

  const insertQuery = executor.insert(notifications);
  if (Array.isArray(values)) {
    await insertQuery.values(values).onConflictDoNothing({
      target: [notifications.pharmacyId, notifications.dedupeKey],
    });
    return;
  }

  await insertQuery.values(values).onConflictDoNothing({
    target: [notifications.pharmacyId, notifications.dedupeKey],
  });
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

function parseTopCandidates(topCandidatesJson: unknown): TopCandidateDigest[] {
  if (!topCandidatesJson || !Array.isArray(topCandidatesJson)) return [];
  return topCandidatesJson as TopCandidateDigest[];
}

function createSnapshotSetValue(next: SnapshotPayload, updatedAt: string): SnapshotSetValue {
  return {
    candidateHash: next.hash,
    candidateCount: next.candidateCount,
    topCandidatesJson: next.topCandidates,
    updatedAt,
  };
}

function createMatchNotificationValue(params: {
  pharmacyId: number;
  triggerPharmacyId: number;
  triggerUploadType: SnapshotTriggerUploadType;
  beforeCount: number;
  beforeTopCandidatesJson?: unknown;
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
    type: 'match_update',
    title: 'マッチング候補更新',
    message: '新しいマッチング候補があります',
    referenceType: 'match',
    sourcePharmacyId: params.triggerPharmacyId,
    dedupeKey: createNotificationDedupeKey({
      triggerPharmacyId: params.triggerPharmacyId,
      triggerUploadType: params.triggerUploadType,
      candidateCountAfter: params.next.candidateCount,
      diffSerialized,
    }),
    detailJson: {
      trigger_upload_type: params.triggerUploadType,
      candidate_count_before: params.beforeCount,
      candidate_count_after: params.next.candidateCount,
      diff,
    },
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

  const current = await fetchSnapshotByPharmacyId(db, pharmacyId);

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

  if (!changed) {
    return {
      changed,
      beforeCount,
      afterCount: next.candidateCount,
    };
  }

  if (!await resolveShouldNotify(pharmacyId, notifyEnabled)) {
    return {
      changed,
      beforeCount,
      afterCount: next.candidateCount,
    };
  }

  await insertMatchNotifications(db, createMatchNotificationValue({
    pharmacyId,
    triggerPharmacyId,
    triggerUploadType,
    beforeCount,
    beforeTopCandidatesJson: current?.topCandidatesJson,
    next,
  }));

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

  const runBatchSave = async (executor: SnapshotDbExecutor): Promise<{ changedCount: number }> => {
    const allPharmacyIds = entries.map((entry) => entry.pharmacyId);
    const now = new Date().toISOString();

    const existingRows = await fetchSnapshotsByPharmacyIds(executor, allPharmacyIds);

    const existingMap = new Map(existingRows.map((row) => [row.pharmacyId, row]));

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

    await executor.insert(matchCandidateSnapshots)
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

    if (changedEntries.length === 0) {
      return { changedCount: 0 };
    }

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

    await insertMatchNotifications(executor, notificationValues);

    return { changedCount: changedEntries.length };
  };

  if (typeof (db as { transaction?: unknown }).transaction === 'function') {
    return db.transaction(async (tx) => runBatchSave(tx));
  }

  return runBatchSave(db);
}
