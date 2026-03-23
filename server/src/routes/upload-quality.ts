import { Router, Response } from 'express';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../config/database';
import { uploadRowIssues } from '../db/schema';
import { requireLogin } from '../middleware/auth';
import { AuthRequest } from '../types';
import { logger } from '../services/logger';
import { parsePagination } from '../utils/request-utils';
import { rowCount } from '../utils/db-utils';

const router = Router();

router.get('/my-summary', requireLogin, async (req: AuthRequest, res: Response) => {
  try {
    const pharmacyId = req.user!.id;

    const [issuesByCode, [totalRow]] = await Promise.all([
      db.select({
        issueCode: uploadRowIssues.issueCode,
        count: sql<number>`count(*)`.as('count'),
      })
        .from(uploadRowIssues)
        .where(eq(uploadRowIssues.pharmacyId, pharmacyId))
        .groupBy(uploadRowIssues.issueCode)
        .orderBy(sql`count(*) desc`),
      db.select({ count: rowCount })
        .from(uploadRowIssues)
        .where(eq(uploadRowIssues.pharmacyId, pharmacyId)),
    ]);

    res.json({
      totalIssues: totalRow.count,
      issuesByCode,
    });
  } catch (err) {
    logger.error('Upload quality summary error', { error: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: 'アップロード品質サマリーの取得に失敗しました' });
  }
});

router.get('/my-issues', requireLogin, async (req: AuthRequest, res: Response) => {
  try {
    const pharmacyId = req.user!.id;
    const { page, limit, offset } = parsePagination(req.query.page, req.query.limit, {
      defaultLimit: 20,
      maxLimit: 100,
    });
    const issueCode = typeof req.query.issueCode === 'string' ? req.query.issueCode : undefined;

    const baseWhere = issueCode
      ? and(eq(uploadRowIssues.pharmacyId, pharmacyId), eq(uploadRowIssues.issueCode, issueCode))
      : eq(uploadRowIssues.pharmacyId, pharmacyId);

    const [issues, [totalRow]] = await Promise.all([
      db.select({
        id: uploadRowIssues.id,
        jobId: uploadRowIssues.jobId,
        uploadType: uploadRowIssues.uploadType,
        rowNumber: uploadRowIssues.rowNumber,
        issueCode: uploadRowIssues.issueCode,
        issueMessage: uploadRowIssues.issueMessage,
        createdAt: uploadRowIssues.createdAt,
      })
        .from(uploadRowIssues)
        .where(baseWhere)
        .orderBy(desc(uploadRowIssues.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ count: rowCount })
        .from(uploadRowIssues)
        .where(baseWhere),
    ]);

    res.json({
      issues,
      total: totalRow.count,
      page,
      limit,
    });
  } catch (err) {
    logger.error('Upload quality issues error', { error: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: 'アップロード問題一覧の取得に失敗しました' });
  }
});

export default router;
