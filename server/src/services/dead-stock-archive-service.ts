import { db } from '../config/database';
import { deadStockItems } from '../db/schema-inventory';
import { and, eq, lt, isNotNull } from 'drizzle-orm';
import { logger } from './logger';

export async function archiveExpiredDeadStock(): Promise<{ archivedCount: number }> {
  // JST (Asia/Tokyo) の日付を取得（サーバーTZに依存しない）
  const now = new Date();
  const jstDate = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const today = jstDate.toISOString().split('T')[0]; // YYYY-MM-DD in JST
  const result = await db
    .update(deadStockItems)
    .set({ isAvailable: false })
    .where(and(
      eq(deadStockItems.isAvailable, true),
      isNotNull(deadStockItems.expirationDateIso),
      lt(deadStockItems.expirationDateIso, today),
    ))
    .returning({ id: deadStockItems.id });

  const archivedCount = result.length;
  if (archivedCount > 0) {
    logger.info('Dead stock archive completed', { archivedCount, asOf: today });
  }
  return { archivedCount };
}
