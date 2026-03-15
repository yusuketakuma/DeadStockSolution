import { and, desc, eq, gte, lte } from 'drizzle-orm';
import { uploads } from '../../db/schema';
import { type DbClient, type RawTimelineEvent } from '../../types/timeline';
import { toTimelineEventType } from '../../utils/timeline-utils';

function resolveEventTimestamp(timestamp: string | null): string {
  return timestamp ?? new Date().toISOString();
}

function appendDateRangeConditions<T>(
  conditions: T[],
  since: string | undefined,
  before: string | undefined,
  buildSinceCondition: (value: string) => T,
  buildBeforeCondition: (value: string) => T,
): void {
  if (since) {
    conditions.push(buildSinceCondition(since));
  }
  if (before) {
    conditions.push(buildBeforeCondition(before));
  }
}

export function mapUploadToEvent(row: {
  id: number;
  uploadType: string;
  originalFilename: string;
  createdAt: string | null;
}): RawTimelineEvent {
  const typeLabel = row.uploadType === 'dead_stock' ? 'デッドストック' : '使用量';

  return {
    id: `upload_${row.id}`,
    source: 'upload',
    type: toTimelineEventType(`upload_${row.uploadType}`),
    title: `${typeLabel}データをアップロードしました`,
    body: `ファイル: ${row.originalFilename}`,
    timestamp: resolveEventTimestamp(row.createdAt),
    isRead: true,
    actionPath: '/upload',
    metadata: {
      uploadType: row.uploadType,
      originalFilename: row.originalFilename,
    },
  };
}

export async function fetchUploadEvents(
  db: DbClient,
  pharmacyId: number,
  since?: string,
  limit?: number,
  before?: string,
): Promise<RawTimelineEvent[]> {
  const conditions = [eq(uploads.pharmacyId, pharmacyId)];
  appendDateRangeConditions(
    conditions,
    since,
    before,
    (value) => gte(uploads.createdAt, value),
    (value) => lte(uploads.createdAt, value),
  );

  let query = db
    .select({
      id: uploads.id,
      uploadType: uploads.uploadType,
      originalFilename: uploads.originalFilename,
      createdAt: uploads.createdAt,
    })
    .from(uploads)
    .where(and(...conditions))
    .orderBy(desc(uploads.createdAt));
  if (limit) query = query.limit(limit);

  const rows = await query;
  return rows.map(mapUploadToEvent);
}
