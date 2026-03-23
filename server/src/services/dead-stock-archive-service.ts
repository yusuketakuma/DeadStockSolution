import { db } from '../config/database';
import { deadStockItems } from '../db/schema-inventory';
import { and, eq, lt, isNotNull } from 'drizzle-orm';
import { logger } from './logger';

export async function archiveExpiredDeadStock(): Promise<{ archivedCount: number }> {
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
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
