import { Router, Response } from 'express';
import { and, desc, count, eq } from 'drizzle-orm';
import { db } from '../config/database';
import { openclawRetryJobs, userRequests, pharmacies } from '../db/schema';
import { AuthRequest } from '../types';
import { handleAdminError, parseListPagination, sendPaginated } from './admin-utils';
import {
  getOpenClawRetryQueueSnapshot,
  isMissingOpenClawRetrySchemaError,
} from '../services/openclaw-retry-service';

const router = Router();

/**
 * GET /admin/openclaw-retries
 * リトライジョブ一覧と統計情報を返す
 */
router.get('/openclaw-retries', async (req: AuthRequest, res: Response) => {
  try {
    const { page, limit, offset } = parseListPagination(req, 20);

    const rawStatus = typeof req.query.status === 'string' ? req.query.status : 'all';
    const validStatuses = ['pending', 'processing', 'completed', 'failed'] as const;
    type RetryStatus = typeof validStatuses[number];
    const statusFilter: RetryStatus | null = (validStatuses as readonly string[]).includes(rawStatus)
      ? rawStatus as RetryStatus
      : null;

    const whereClause = statusFilter
      ? and(eq(openclawRetryJobs.status, statusFilter))
      : undefined;

    const [snapshot, rows, [totalRow]] = await Promise.all([
      getOpenClawRetryQueueSnapshot(),
      (async () => {
        try {
          return await db.select({
            id: openclawRetryJobs.id,
            requestId: openclawRetryJobs.requestId,
            pharmacyId: openclawRetryJobs.pharmacyId,
            pharmacyName: pharmacies.name,
            status: openclawRetryJobs.status,
            attemptCount: openclawRetryJobs.attemptCount,
            maxAttempts: openclawRetryJobs.maxAttempts,
            nextRetryAt: openclawRetryJobs.nextRetryAt,
            lastAttemptAt: openclawRetryJobs.lastAttemptAt,
            completedAt: openclawRetryJobs.completedAt,
            lastError: openclawRetryJobs.lastError,
            triggerReason: openclawRetryJobs.triggerReason,
            createdAt: openclawRetryJobs.createdAt,
            updatedAt: openclawRetryJobs.updatedAt,
            requestText: userRequests.requestText,
          })
            .from(openclawRetryJobs)
            .innerJoin(userRequests, eq(openclawRetryJobs.requestId, userRequests.id))
            .innerJoin(pharmacies, eq(openclawRetryJobs.pharmacyId, pharmacies.id))
            .where(whereClause)
            .orderBy(desc(openclawRetryJobs.updatedAt))
            .limit(limit)
            .offset(offset);
        } catch (err) {
          if (!isMissingOpenClawRetrySchemaError(err)) {
            throw err;
          }
          return [];
        }
      })(),
      (async () => {
        try {
          return await db.select({ value: count() })
            .from(openclawRetryJobs)
            .where(whereClause);
        } catch (err) {
          if (!isMissingOpenClawRetrySchemaError(err)) {
            throw err;
          }
          return [{ value: 0 }];
        }
      })(),
    ]);

    sendPaginated(res, rows, page, limit, totalRow?.value ?? 0, { stats: snapshot });
  } catch (err) {
    handleAdminError(err, 'Admin openclaw retries list error', 'リトライジョブ一覧の取得に失敗しました', res);
  }
});

export default router;
