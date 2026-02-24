import { Router, Response } from 'express';
import { and, eq, inArray, desc, sql } from 'drizzle-orm';
import { db } from '../config/database';
import {
  pharmacies,
  uploads,
  exchangeProposals,
  exchangeProposalItems,
  exchangeHistory,
  adminMessages,
  userRequests,
  activityLogs,
} from '../db/schema';
import { requireLogin, requireAdmin } from '../middleware/auth';
import { AuthRequest } from '../types';
import { parsePagination, parsePositiveInt } from '../utils/request-utils';
import { isSafeInternalPath, sanitizeInternalPath } from '../utils/path-utils';
import { rowCount } from '../utils/db-utils';
import { writeLog, getClientIp, type LogAction } from '../services/log-service';
import { logger } from '../services/logger';
import { getObservabilitySnapshot } from '../services/observability-service';
import {
  getOpenClawImplementationBranch,
  handoffToOpenClaw,
  isOpenClawConnectorConfigured,
  isOpenClawWebhookConfigured,
} from '../services/openclaw-service';

const VALID_LOG_ACTIONS: LogAction[] = [
  'login', 'login_failed', 'admin_login', 'register', 'logout',
  'upload', 'proposal_create', 'proposal_accept', 'proposal_reject', 'proposal_complete',
  'account_update', 'account_deactivate', 'admin_toggle_active', 'admin_send_message',
  'dead_stock_delete', 'password_reset_request', 'password_reset_complete',
  'password_reset_failed', 'drug_master_sync', 'drug_master_package_upload', 'drug_master_edit',
];

const router = Router();

router.use(requireLogin);
router.use(requireAdmin);

function sendPaginated<T>(
  res: Response,
  data: T[],
  page: number,
  limit: number,
  total: number,
  extra: Record<string, unknown> = {},
): void {
  res.json({
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
    ...extra,
  });
}

function parseListPagination(req: AuthRequest, defaultLimit: number = 20): { page: number; limit: number; offset: number } {
  return parsePagination(req.query.page, req.query.limit, {
    defaultLimit,
    maxLimit: 100,
  });
}

function parseIdOrBadRequest(res: Response, rawId: string | string[] | undefined): number | null {
  const id = parsePositiveInt(typeof rawId === 'string' ? rawId : undefined);
  if (!id) {
    res.status(400).json({ error: '不正なIDです' });
    return null;
  }
  return id;
}

function handleAdminError(err: unknown, logContext: string, responseMessage: string, res: Response): void {
  logger.error(logContext, { error: (err as Error).message });
  res.status(500).json({ error: responseMessage });
}

router.get('/stats', async (_req: AuthRequest, res: Response) => {
  try {
    const [
      [pharmacyCount],
      [activePharmacyCount],
      [uploadCount],
      [proposalCount],
      [historyCount],
      [pickupCount],
      [exchangeAmount],
    ] = await Promise.all([
      db.select({ count: rowCount }).from(pharmacies),
      db.select({ count: rowCount })
        .from(pharmacies)
        .where(eq(pharmacies.isActive, true)),
      db.select({ count: rowCount }).from(uploads),
      db.select({ count: rowCount }).from(exchangeProposals),
      db.select({ count: rowCount }).from(exchangeHistory),
      db.select({ count: rowCount })
        .from(exchangeProposalItems)
        .innerJoin(exchangeProposals, eq(exchangeProposalItems.proposalId, exchangeProposals.id))
        .where(eq(exchangeProposals.status, 'completed')),
      db.select({
        total: sql<number>`coalesce(sum(${exchangeHistory.totalValue}), 0)`,
      }).from(exchangeHistory),
    ]);

    res.json({
      totalPharmacies: pharmacyCount.count,
      activePharmacies: activePharmacyCount.count,
      inactivePharmacies: pharmacyCount.count - activePharmacyCount.count,
      totalUploads: uploadCount.count,
      totalProposals: proposalCount.count,
      totalExchanges: historyCount.count,
      totalPickupItems: pickupCount.count,
      totalExchangeValue: Number(exchangeAmount.total ?? 0),
    });
  } catch (err) {
    handleAdminError(err, 'Admin stats error', '統計情報の取得に失敗しました', res);
  }
});

router.get('/observability', async (req: AuthRequest, res: Response) => {
  try {
    const minutesRaw = Number(req.query.minutes);
    const minutes = Number.isFinite(minutesRaw) ? minutesRaw : 60;
    const snapshot = getObservabilitySnapshot(minutes);
    res.json(snapshot);
  } catch (err) {
    handleAdminError(err, 'Admin observability error', '監視情報の取得に失敗しました', res);
  }
});

router.get('/pharmacies/options', async (_req: AuthRequest, res: Response) => {
  try {
    const rows = await db.select({
      id: pharmacies.id,
      name: pharmacies.name,
      isActive: pharmacies.isActive,
    })
      .from(pharmacies)
      .orderBy(desc(pharmacies.createdAt));

    res.json({
      data: rows,
    });
  } catch (err) {
    handleAdminError(err, 'Admin pharmacy options error', '薬局候補の取得に失敗しました', res);
  }
});

router.get('/pharmacies', async (req: AuthRequest, res: Response) => {
  try {
    const { page, limit, offset } = parseListPagination(req);

    const rows = await db.select({
      id: pharmacies.id,
      email: pharmacies.email,
      name: pharmacies.name,
      prefecture: pharmacies.prefecture,
      phone: pharmacies.phone,
      fax: pharmacies.fax,
      isActive: pharmacies.isActive,
      isAdmin: pharmacies.isAdmin,
      createdAt: pharmacies.createdAt,
    })
      .from(pharmacies)
      .orderBy(desc(pharmacies.createdAt))
      .limit(limit)
      .offset(offset);

    const [total] = await db.select({ count: rowCount }).from(pharmacies);

    sendPaginated(res, rows, page, limit, total.count);
  } catch (err) {
    handleAdminError(err, 'Admin pharmacies error', '薬局一覧の取得に失敗しました', res);
  }
});

router.get('/pharmacies/:id', async (req: AuthRequest, res: Response) => {
  try {
    const id = parseIdOrBadRequest(res, req.params.id);
    if (!id) return;
    const rows = await db.select()
      .from(pharmacies)
      .where(eq(pharmacies.id, id))
      .limit(1);

    if (rows.length === 0) {
      res.status(404).json({ error: '薬局が見つかりません' });
      return;
    }

    const { passwordHash: _, ...pharmacy } = rows[0];
    res.json(pharmacy);
  } catch (err) {
    handleAdminError(err, 'Admin pharmacy detail error', '薬局情報の取得に失敗しました', res);
  }
});

router.put('/pharmacies/:id/toggle-active', async (req: AuthRequest, res: Response) => {
  try {
    const id = parseIdOrBadRequest(res, req.params.id);
    if (!id) return;
    const rows = await db.select({ isActive: pharmacies.isActive })
      .from(pharmacies)
      .where(eq(pharmacies.id, id))
      .limit(1);

    if (rows.length === 0) {
      res.status(404).json({ error: '薬局が見つかりません' });
      return;
    }

    await db.update(pharmacies)
      .set({
        isActive: !rows[0].isActive,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(pharmacies.id, id));

    writeLog('admin_toggle_active', {
      pharmacyId: req.user!.id,
      detail: `薬局ID:${id}を${rows[0].isActive ? '無効' : '有効'}に変更`,
      ipAddress: getClientIp(req),
    });

    res.json({ message: `薬局を${rows[0].isActive ? '無効' : '有効'}にしました` });
  } catch (err) {
    handleAdminError(err, 'Admin toggle active error', '状態変更に失敗しました', res);
  }
});

router.get('/exchanges', async (req: AuthRequest, res: Response) => {
  try {
    const { page, limit, offset } = parseListPagination(req);

    const rows = await db.select()
      .from(exchangeProposals)
      .orderBy(desc(exchangeProposals.proposedAt))
      .limit(limit)
      .offset(offset);

    const [total] = await db.select({ count: rowCount }).from(exchangeProposals);

    sendPaginated(res, rows, page, limit, total.count);
  } catch (err) {
    handleAdminError(err, 'Admin exchanges error', '交換一覧の取得に失敗しました', res);
  }
});

router.get('/history', async (req: AuthRequest, res: Response) => {
  try {
    const { page, limit, offset } = parseListPagination(req);

    const rows = await db.select({
      id: exchangeHistory.id,
      proposalId: exchangeHistory.proposalId,
      pharmacyAId: exchangeHistory.pharmacyAId,
      pharmacyBId: exchangeHistory.pharmacyBId,
      totalValue: exchangeHistory.totalValue,
      completedAt: exchangeHistory.completedAt,
    })
      .from(exchangeHistory)
      .orderBy(desc(exchangeHistory.completedAt))
      .limit(limit)
      .offset(offset);

    const pharmacyIds = [...new Set(rows.flatMap((row) => [row.pharmacyAId, row.pharmacyBId]))];
    const pharmacyRows = pharmacyIds.length > 0
      ? await db.select({
        id: pharmacies.id,
        name: pharmacies.name,
      })
        .from(pharmacies)
        .where(inArray(pharmacies.id, pharmacyIds))
      : [];

    const pharmacyMap = new Map(pharmacyRows.map((row) => [row.id, row.name]));
    const [total] = await db.select({ count: rowCount }).from(exchangeHistory);

    const mappedRows = rows.map((row) => ({
      ...row,
      pharmacyAName: pharmacyMap.get(row.pharmacyAId) ?? '',
      pharmacyBName: pharmacyMap.get(row.pharmacyBId) ?? '',
    }));
    sendPaginated(res, mappedRows, page, limit, total.count);
  } catch (err) {
    handleAdminError(err, 'Admin history error', '交換履歴の取得に失敗しました', res);
  }
});

router.get('/messages', async (req: AuthRequest, res: Response) => {
  try {
    const { page, limit, offset } = parseListPagination(req);

    const rows = await db.select({
      id: adminMessages.id,
      senderAdminId: adminMessages.senderAdminId,
      targetType: adminMessages.targetType,
      targetPharmacyId: adminMessages.targetPharmacyId,
      title: adminMessages.title,
      body: adminMessages.body,
      actionPath: adminMessages.actionPath,
      createdAt: adminMessages.createdAt,
    })
      .from(adminMessages)
      .orderBy(desc(adminMessages.createdAt))
      .limit(limit)
      .offset(offset);

    const [total] = await db.select({ count: rowCount }).from(adminMessages);

    const mappedRows = rows.map((row) => ({
      ...row,
      actionPath: sanitizeInternalPath(row.actionPath) ?? null,
    }));
    sendPaginated(res, mappedRows, page, limit, total.count);
  } catch (err) {
    handleAdminError(err, 'Admin messages list error', '管理者メッセージ一覧の取得に失敗しました', res);
  }
});

router.post('/messages', async (req: AuthRequest, res: Response) => {
  try {
    const targetType = req.body.targetType as 'all' | 'pharmacy';
    const targetPharmacyIdRaw = req.body.targetPharmacyId;
    const title = typeof req.body.title === 'string' ? req.body.title.trim() : '';
    const body = typeof req.body.body === 'string' ? req.body.body.trim() : '';
    const actionPath = typeof req.body.actionPath === 'string' ? req.body.actionPath.trim() : '';

    if (!targetType || !['all', 'pharmacy'].includes(targetType)) {
      res.status(400).json({ error: '送信対象が不正です' });
      return;
    }

    if (!title || title.length > 100) {
      res.status(400).json({ error: 'タイトルは1〜100文字で入力してください' });
      return;
    }

    if (!body || body.length > 2000) {
      res.status(400).json({ error: '本文は1〜2000文字で入力してください' });
      return;
    }

    let targetPharmacyId: number | null = null;
    if (targetType === 'pharmacy') {
      targetPharmacyId = parsePositiveInt(String(targetPharmacyIdRaw ?? ''));
      if (!targetPharmacyId) {
        res.status(400).json({ error: '送信先薬局IDが不正です' });
        return;
      }

      const targetRows = await db.select({ id: pharmacies.id })
        .from(pharmacies)
        .where(and(
          eq(pharmacies.id, targetPharmacyId),
          eq(pharmacies.isActive, true),
        ))
        .limit(1);

      if (targetRows.length === 0) {
        res.status(404).json({ error: '送信先薬局が見つかりません' });
        return;
      }
    }

    if (actionPath && !isSafeInternalPath(actionPath)) {
      res.status(400).json({ error: '遷移先パスが不正です' });
      return;
    }

    await db.insert(adminMessages).values({
      senderAdminId: req.user!.id,
      targetType,
      targetPharmacyId,
      title,
      body,
      actionPath: actionPath || null,
    });

    writeLog('admin_send_message', {
      pharmacyId: req.user!.id,
      detail: `メッセージ送信: ${title} (対象: ${targetType === 'all' ? '全体' : `薬局ID:${targetPharmacyId}`})`,
      ipAddress: getClientIp(req),
    });

    res.status(201).json({ message: '加盟薬局へメッセージを送信しました' });
  } catch (err) {
    handleAdminError(err, 'Admin message send error', 'メッセージ送信に失敗しました', res);
  }
});

router.get('/requests', async (req: AuthRequest, res: Response) => {
  try {
    const { page, limit, offset } = parseListPagination(req);

    const rows = await db.select({
      id: userRequests.id,
      pharmacyId: userRequests.pharmacyId,
      pharmacyName: pharmacies.name,
      requestText: userRequests.requestText,
      openclawStatus: userRequests.openclawStatus,
      openclawThreadId: userRequests.openclawThreadId,
      openclawSummary: userRequests.openclawSummary,
      createdAt: userRequests.createdAt,
      updatedAt: userRequests.updatedAt,
    })
      .from(userRequests)
      .innerJoin(pharmacies, eq(userRequests.pharmacyId, pharmacies.id))
      .orderBy(desc(userRequests.createdAt))
      .limit(limit)
      .offset(offset);

    const [total] = await db.select({ count: rowCount }).from(userRequests);
    sendPaginated(res, rows, page, limit, total.count, {
      connector: {
        configured: isOpenClawConnectorConfigured(),
        webhookConfigured: isOpenClawWebhookConfigured(),
        implementationBranch: getOpenClawImplementationBranch(),
      },
    });
  } catch (err) {
    handleAdminError(err, 'Admin user requests list error', '要望一覧の取得に失敗しました', res);
  }
});

router.post('/requests/:id/handoff', async (req: AuthRequest, res: Response) => {
  try {
    const requestId = parseIdOrBadRequest(res, req.params.id);
    if (!requestId) return;

    const [requestRow] = await db.select({
      id: userRequests.id,
      pharmacyId: userRequests.pharmacyId,
      requestText: userRequests.requestText,
      openclawStatus: userRequests.openclawStatus,
    })
      .from(userRequests)
      .where(eq(userRequests.id, requestId))
      .limit(1);

    if (!requestRow) {
      res.status(404).json({ error: '要望が見つかりません' });
      return;
    }

    if (requestRow.openclawStatus === 'completed') {
      res.status(400).json({ error: '完了済み要望は再連携できません' });
      return;
    }

    const handoff = await handoffToOpenClaw({
      requestId: requestRow.id,
      pharmacyId: requestRow.pharmacyId,
      requestText: requestRow.requestText,
    });

    if (handoff.accepted) {
      await db.update(userRequests)
        .set({
          openclawStatus: handoff.status,
          openclawThreadId: handoff.threadId,
          openclawSummary: handoff.summary,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(userRequests.id, requestRow.id));

      res.json({
        message: 'OpenClawへ再連携しました',
        handoff: {
          accepted: handoff.accepted,
          connectorConfigured: handoff.connectorConfigured,
          implementationBranch: handoff.implementationBranch,
          status: handoff.status,
          note: handoff.note,
        },
      });
      return;
    }

    res.status(202).json({
      message: 'OpenClaw連携は保留中です',
      handoff: {
        accepted: handoff.accepted,
        connectorConfigured: handoff.connectorConfigured,
        implementationBranch: handoff.implementationBranch,
        status: handoff.status,
        note: handoff.note,
      },
    });
  } catch (err) {
    handleAdminError(err, 'Admin user request handoff error', '再連携に失敗しました', res);
  }
});

router.get('/logs', async (req: AuthRequest, res: Response) => {
  try {
    const { page, limit, offset } = parseListPagination(req, 50);

    const rawAction = typeof req.query.action === 'string' ? req.query.action.trim() : '';
    const actionFilter = VALID_LOG_ACTIONS.includes(rawAction as LogAction) ? rawAction : undefined;

    const conditions = [];
    if (actionFilter) {
      conditions.push(eq(activityLogs.action, actionFilter));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const rows = await db.select({
      id: activityLogs.id,
      pharmacyId: activityLogs.pharmacyId,
      action: activityLogs.action,
      detail: activityLogs.detail,
      ipAddress: activityLogs.ipAddress,
      createdAt: activityLogs.createdAt,
    })
      .from(activityLogs)
      .where(whereClause)
      .orderBy(desc(activityLogs.createdAt))
      .limit(limit)
      .offset(offset);

    // Resolve pharmacy names
    const pharmacyIds = [...new Set(rows.map((r) => r.pharmacyId).filter((id): id is number => id !== null))];
    const pharmacyRows = pharmacyIds.length > 0
      ? await db.select({ id: pharmacies.id, name: pharmacies.name })
          .from(pharmacies)
          .where(inArray(pharmacies.id, pharmacyIds))
      : [];
    const pharmacyMap = new Map(pharmacyRows.map((r) => [r.id, r.name]));

    const [total] = await db.select({ count: rowCount })
      .from(activityLogs)
      .where(whereClause);

    const mappedRows = rows.map((row) => ({
      ...row,
      pharmacyName: row.pharmacyId ? pharmacyMap.get(row.pharmacyId) ?? null : null,
    }));
    sendPaginated(res, mappedRows, page, limit, total.count);
  } catch (err) {
    handleAdminError(err, 'Admin logs error', 'ログの取得に失敗しました', res);
  }
});

export default router;
