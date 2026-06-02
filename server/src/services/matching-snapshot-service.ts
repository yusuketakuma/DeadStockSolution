import crypto from 'crypto';
import { eq, inArray, sql } from 'drizzle-orm';
import { db } from '../config/database';
import { matchCandidateSnapshots, matchNotifications, pharmacies } from '../db/schema';
import { MatchCandidate } from '../types';
import { roundTo2 } from './matching-score-service';
import { publishTimelineRefresh } from './realtime-service';

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

const SNAPSHOT_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24時間

function isSnapshotStale(updatedAt: string | null): boolean {
  if (!updatedAt) return true;
  const updatedTime = new Date(updatedAt).getTime();
  return Date.now() - updatedTime > SNAPSHOT_MAX_AGE_MS;
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
  const topCandidates = buildTopCandidateDigest(candidates, 10);
  const hashEntries = buildSnapshotHashInput(candidates, 10);
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
  notifyEnabled?: boolean;
}): Promise<{ changed: boolean; beforeCount: number; afterCount: number }> {
  const { pharmacyId, triggerPharmacyId, triggerUploadType, candidates, notifyEnabled } = params;

  const next = createSnapshotPayload(candidates);

  const [current] = await db.select({
    id: matchCandidateSnapshots.id,
    candidateHash: matchCandidateSnapshots.candidateHash,
    candidateCount: matchCandidateSnapshots.candidateCount,
    topCandidatesJson: matchCandidateSnapshots.topCandidatesJson,
    updatedAt: matchCandidateSnapshots.updatedAt,
  })
    .from(matchCandidateSnapshots)
    .where(eq(matchCandidateSnapshots.pharmacyId, pharmacyId))
    .limit(1);

  const beforeCount = Number(current?.candidateCount ?? 0);
  const hashOrCountChanged = !current || current.candidateHash !== next.hash || beforeCount !== next.candidateCount;
  const stale = current ? isSnapshotStale(current.updatedAt) : false;
  // 通知判定はハッシュ/件数の変化のみ（TTL超過のみの場合は通知しない）
  const changed = hashOrCountChanged;
  const needsUpdate = hashOrCountChanged || stale;

  if (current) {
    if (needsUpdate) {
      await db.update(matchCandidateSnapshots)
        .set({
          candidateHash: next.hash,
          candidateCount: next.candidateCount,
          topCandidatesJson: JSON.stringify(next.topCandidates),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(matchCandidateSnapshots.id, current.id));
    }
  } else {
    await db.insert(matchCandidateSnapshots).values({
      tenantId: pharmacyId,
      pharmacyId,
      candidateHash: next.hash,
      candidateCount: next.candidateCount,
      topCandidatesJson: JSON.stringify(next.topCandidates),
      updatedAt: new Date().toISOString(),
    });
  }

  if (changed) {
    // 通知設定を確認: OFF なら通知レコードをスキップ
    // notifyEnabled が事前に渡されていればDBクエリをスキップ（N+1防止）
    let shouldNotify: boolean;
    if (notifyEnabled !== undefined) {
      shouldNotify = notifyEnabled;
    } else {
      const [pharmacy] = await db.select({ matchingAutoNotifyEnabled: pharmacies.matchingAutoNotifyEnabled })
        .from(pharmacies)
        .where(eq(pharmacies.id, pharmacyId))
        .limit(1);
      shouldNotify = pharmacy?.matchingAutoNotifyEnabled !== false;
    }

    if (shouldNotify) {
      const beforeTopCandidates: TopCandidateDigest[] = current?.topCandidatesJson
        ? (typeof current.topCandidatesJson === 'string'
          ? JSON.parse(current.topCandidatesJson) as TopCandidateDigest[]
          : current.topCandidatesJson as TopCandidateDigest[])
        : [];
      const diff = calculateSnapshotDiff(beforeTopCandidates, next.topCandidates, beforeCount, next.candidateCount);
      const diffSerialized = JSON.stringify(diff);
      const dedupeKey = createNotificationDedupeKey({
        triggerPharmacyId,
        triggerUploadType,
        candidateCountAfter: next.candidateCount,
        diffSerialized,
      });

      const insertedRows = await db.insert(matchNotifications).values({
        tenantId: pharmacyId,
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
      }).returning({ pharmacyId: matchNotifications.pharmacyId });
      if (insertedRows.length > 0) {
        publishTimelineRefresh({
          pharmacyId,
          reason: 'match_notification_created',
        });
      }
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
  triggerUploadType: 'dead_stock' | 'used_medication';
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
    updatedAt: matchCandidateSnapshots.updatedAt,
  })
    .from(matchCandidateSnapshots)
    .where(inArray(matchCandidateSnapshots.pharmacyId, allPharmacyIds));

  const existingMap = new Map(existingRows.map((row) => [row.pharmacyId, row]));

  // 2. 各薬局のスナップショットを計算し、変更検知
  type ExistingRow = typeof existingRows[number];
  type SnapshotEntry = typeof entries[number];
  const upsertValues: Array<{
    tenantId: number;
    pharmacyId: number;
    candidateHash: string;
    candidateCount: number;
    topCandidatesJson: string;
    updatedAt: string;
  }> = [];
  const changedEntries: Array<{
    entry: SnapshotEntry;
    next: ReturnType<typeof createSnapshotPayload>;
    existing: ExistingRow | undefined;
  }> = [];

  for (const entry of entries) {
    const next = createSnapshotPayload(entry.candidates);
    const existing = existingMap.get(entry.pharmacyId);
    const hashOrCountChanged = !existing
      || existing.candidateHash !== next.hash
      || Number(existing.candidateCount) !== next.candidateCount;
    const stale = existing ? isSnapshotStale(existing.updatedAt) : false;
    // 通知判定はハッシュ/件数の変化のみ（TTL超過のみの場合は通知しない）
    const changed = hashOrCountChanged;

    if (hashOrCountChanged || stale) {
      upsertValues.push({
        tenantId: entry.pharmacyId,
        pharmacyId: entry.pharmacyId,
        candidateHash: next.hash,
        candidateCount: next.candidateCount,
        topCandidatesJson: JSON.stringify(next.topCandidates),
        updatedAt: now,
      });
    }

    if (changed) {
      changedEntries.push({ entry, next, existing });
    }
  }

  // 3. 一括 UPSERT（INSERT ... ON CONFLICT DO UPDATE）
  if (upsertValues.length > 0) {
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
  }

  // 4. 変更があった薬局の通知を一括 INSERT
  const notificationValues: Array<{
    tenantId: number;
    pharmacyId: number;
    triggerPharmacyId: number;
    triggerUploadType: 'dead_stock' | 'used_medication';
    candidateCountBefore: number;
    candidateCountAfter: number;
    diffJson: string;
    dedupeKey: string;
    isRead: boolean;
  }> = [];

  for (const { entry, next, existing } of changedEntries) {
    if (!entry.notifyEnabled) continue;

    const beforeTopCandidates: TopCandidateDigest[] = existing?.topCandidatesJson
      ? (typeof existing.topCandidatesJson === 'string'
        ? JSON.parse(existing.topCandidatesJson) as TopCandidateDigest[]
        : existing.topCandidatesJson as TopCandidateDigest[])
      : [];
    const beforeCount = Number(existing?.candidateCount ?? 0);
    const diff = calculateSnapshotDiff(beforeTopCandidates, next.topCandidates, beforeCount, next.candidateCount);
    const diffSerialized = JSON.stringify(diff);
    const dedupeKey = createNotificationDedupeKey({
      triggerPharmacyId: entry.triggerPharmacyId,
      triggerUploadType: entry.triggerUploadType,
      candidateCountAfter: next.candidateCount,
      diffSerialized,
    });

    notificationValues.push({
      tenantId: entry.pharmacyId,
      pharmacyId: entry.pharmacyId,
      triggerPharmacyId: entry.triggerPharmacyId,
      triggerUploadType: entry.triggerUploadType,
      candidateCountBefore: beforeCount,
      candidateCountAfter: next.candidateCount,
      diffJson: diffSerialized,
      dedupeKey,
      isRead: false,
    });
  }

  if (notificationValues.length > 0) {
    const insertedRows = await db.insert(matchNotifications)
      .values(notificationValues)
      .onConflictDoNothing({
        target: [matchNotifications.pharmacyId, matchNotifications.dedupeKey],
      })
      .returning({ pharmacyId: matchNotifications.pharmacyId });

    for (const pharmacyId of new Set(insertedRows.map((row) => row.pharmacyId))) {
      publishTimelineRefresh({
        pharmacyId,
        reason: 'match_notification_created',
      });
    }
  }

  return { changedCount: changedEntries.length };
}
