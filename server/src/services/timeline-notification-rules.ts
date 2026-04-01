import { sql, type SQL } from 'drizzle-orm';

export const TIMELINE_SEPARATE_NOTIFICATION_TYPES: string[] = [
  'match_update',
  'new_comment',
];

const TIMELINE_SEPARATE_NOTIFICATION_TYPE_SET = new Set<string>(
  TIMELINE_SEPARATE_NOTIFICATION_TYPES,
);

export function shouldIncludeNotificationTypeInTimeline(type: string): boolean {
  return !TIMELINE_SEPARATE_NOTIFICATION_TYPE_SET.has(type);
}

export function filterNotificationRowsForTimeline<T extends { type: string }>(rows: readonly T[]): T[] {
  return rows.filter((row) => shouldIncludeNotificationTypeInTimeline(row.type));
}

export function buildTimelineExcludedNotificationTypesSql(): SQL {
  return sql.join(
    TIMELINE_SEPARATE_NOTIFICATION_TYPES.map((type) => sql`${type}`),
    sql`, `,
  );
}
