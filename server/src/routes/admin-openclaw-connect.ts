import { Router, Response } from 'express';
import { desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../config/database';
import { openclawRunbookLogs, pharmacies } from '../db/schema';
import { AuthRequest } from '../types';
import { adminWriteLimiter } from './admin-write-limiter';
import { handleAdminError } from './admin-utils';
import {
  issueDdsBootstrapToken,
  rotateDdsControlToken,
} from '../services/dds-agent-service';
import { getAdminDdsConnectionStatus } from '../services/openclaw/admin-runtime-status-service';

const router = Router();

const bootstrapSchema = z.object({
  adminId: z.number().int().positive().nullable().optional(),
}).strict();

router.get('/openclaw/dds-agent', async (_req: AuthRequest, res: Response) => {
  try {
    const data = await getAdminDdsConnectionStatus();
    res.json({ data });
  } catch (err) {
    handleAdminError(err, 'Admin DDS agent status error', 'DDSエージェント状態の取得に失敗しました', res);
  }
});

router.post('/openclaw/bootstrap-token', adminWriteLimiter, async (req: AuthRequest, res: Response) => {
  const parsed = bootstrapSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'リクエスト形式が不正です' });
    return;
  }

  try {
    const adminId = parsed.data.adminId ?? req.user?.id ?? null;
    const data = await issueDdsBootstrapToken(adminId);
    res.status(201).json({ data });
  } catch (err) {
    handleAdminError(err, 'Admin DDS bootstrap token issue error', 'DDS bootstrap token の発行に失敗しました', res);
  }
});

router.post('/openclaw/control-token/rotate', adminWriteLimiter, async (_req: AuthRequest, res: Response) => {
  try {
    await rotateDdsControlToken();
    res.json({ message: 'DDS control token をローテーションしました' });
  } catch (err) {
    handleAdminError(err, 'Admin DDS control token rotation error', 'DDS control token のローテーションに失敗しました', res);
  }
});

router.get('/openclaw/runbook-logs', async (_req: AuthRequest, res: Response) => {
  try {
    const rows = await db.select({
      id: openclawRunbookLogs.id,
      action: openclawRunbookLogs.action,
      status: openclawRunbookLogs.status,
      detail: openclawRunbookLogs.detail,
      resultSummary: openclawRunbookLogs.resultSummary,
      createdAt: openclawRunbookLogs.createdAt,
      adminId: openclawRunbookLogs.adminId,
      adminName: pharmacies.name,
    })
      .from(openclawRunbookLogs)
      .leftJoin(pharmacies, sql`${pharmacies.id} = ${openclawRunbookLogs.adminId}`)
      .orderBy(desc(openclawRunbookLogs.createdAt))
      .limit(20);
    res.json({ data: rows });
  } catch (err) {
    handleAdminError(err, 'Admin OpenClaw runbook logs error', 'runbook履歴の取得に失敗しました', res);
  }
});

router.post('/openclaw/runbook-logs', adminWriteLimiter, async (req: AuthRequest, res: Response) => {
  try {
    const action = typeof req.body?.action === 'string' ? req.body.action.trim().slice(0, 128) : '';
    const status = typeof req.body?.status === 'string' ? req.body.status.trim().slice(0, 24) : 'success';
    const detail = typeof req.body?.detail === 'string' ? req.body.detail.trim().slice(0, 2000) : null;
    const resultSummary = typeof req.body?.resultSummary === 'string' ? req.body.resultSummary.trim().slice(0, 2000) : null;
    if (!action) {
      res.status(400).json({ error: 'action が必要です' });
      return;
    }

    const [row] = await db.insert(openclawRunbookLogs).values({
      adminId: req.user?.id ?? null,
      action,
      status,
      detail,
      resultSummary,
    }).returning({
      id: openclawRunbookLogs.id,
      action: openclawRunbookLogs.action,
      status: openclawRunbookLogs.status,
      detail: openclawRunbookLogs.detail,
      resultSummary: openclawRunbookLogs.resultSummary,
      createdAt: openclawRunbookLogs.createdAt,
    });
    res.status(201).json({ data: row });
  } catch (err) {
    handleAdminError(err, 'Admin OpenClaw runbook log create error', 'runbook履歴の記録に失敗しました', res);
  }
});

router.put('/openclaw/runbook-logs/:id', adminWriteLimiter, async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'id が不正です' });
      return;
    }
    const status = typeof req.body?.status === 'string' ? req.body.status.trim().slice(0, 24) : undefined;
    const detail = typeof req.body?.detail === 'string' ? req.body.detail.trim().slice(0, 2000) : undefined;
    const resultSummary = typeof req.body?.resultSummary === 'string' ? req.body.resultSummary.trim().slice(0, 2000) : undefined;
    const [row] = await db.update(openclawRunbookLogs)
      .set({
        ...(status !== undefined ? { status } : {}),
        ...(detail !== undefined ? { detail } : {}),
        ...(resultSummary !== undefined ? { resultSummary } : {}),
      })
      .where(eq(openclawRunbookLogs.id, id))
      .returning({
        id: openclawRunbookLogs.id,
        action: openclawRunbookLogs.action,
        status: openclawRunbookLogs.status,
        detail: openclawRunbookLogs.detail,
        resultSummary: openclawRunbookLogs.resultSummary,
        createdAt: openclawRunbookLogs.createdAt,
      });
    if (!row) {
      res.status(404).json({ error: 'runbook log が見つかりません' });
      return;
    }
    res.json({ data: row });
  } catch (err) {
    handleAdminError(err, 'Admin OpenClaw runbook log update error', 'runbook履歴の更新に失敗しました', res);
  }
});

export default router;
