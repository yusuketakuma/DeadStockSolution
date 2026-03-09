import { Router, Response } from 'express';
import { and, eq, desc, inArray } from 'drizzle-orm';
import { db } from '../config/database';
import {
  pharmacies,
  exchangeProposals,
  adminMessages,
  userRequests,
  proposalComments,
} from '../db/schema';
import { AuthRequest } from '../types';
import type { BulkPharmacyActionRequest, BulkPharmacyActionResponse, BulkActionResult } from '../types/admin';
import { parsePositiveInt } from '../utils/request-utils';
import { isSafeInternalPath } from '../utils/path-utils';
import { rowCount } from '../utils/db-utils';
import { writeLog, getClientIp } from '../services/log-service';
import { logger } from '../services/logger';
import { buildOpenClawLogContext } from '../services/openclaw-log-context-service';
import {
  handoffToOpenClaw,
  type OpenClawHandoffResult,
} from '../services/openclaw-service';
import {
  buildProposalTimeline,
  fetchProposalTimelineActionRows,
} from '../services/proposal-timeline-service';
import { adminWriteLimiter } from './admin-write-limiter';
import { sendPaginated, parseListPagination, parseIdOrBadRequest, getErrorMessage, handleAdminError } from './admin-utils';
import { invalidateAuthUserCache } from '../middleware/auth';
import { recordAuditLog } from '../services/audit-log-service';

type AdminHandoffResponse = Pick<
  OpenClawHandoffResult,
  'accepted' | 'connectorConfigured' | 'implementationBranch' | 'status' | 'note'
>;

type BulkPharmacyActionKind = 'verify' | 'reject';

interface BulkPharmacyActionConfig {
  nextStatus: 'verified' | 'rejected';
  skippedStatus: 'verified' | 'rejected';
  isActive: boolean;
}

async function collectAdminHandoffContext(
  pharmacyId: number,
  requestId: number,
): Promise<Record<string, unknown> | undefined> {
  try {
    const operationLogs = await buildOpenClawLogContext(pharmacyId);
    return { operationLogs };
  } catch (contextErr) {
    logger.warn('OpenClaw context collection failed on admin handoff', {
      requestId,
      pharmacyId,
      error: getErrorMessage(contextErr),
    });
    return undefined;
  }
}

function buildAdminHandoffResponse(handoff: OpenClawHandoffResult): AdminHandoffResponse {
  return {
    accepted: handoff.accepted,
    connectorConfigured: handoff.connectorConfigured,
    implementationBranch: handoff.implementationBranch,
    status: handoff.status,
    note: handoff.note,
  };
}

function sendAdminHandoffResponse(res: Response, handoff: OpenClawHandoffResult): void {
  const handoffPayload = buildAdminHandoffResponse(handoff);
  if (handoff.accepted) {
    res.json({
      message: 'OpenClawへ再連携しました',
      handoff: handoffPayload,
    });
    return;
  }

  res.status(202).json({
    message: 'OpenClaw連携は保留中です',
    handoff: handoffPayload,
  });
}

const router = Router();

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

router.get('/exchanges/:proposalId/comments', async (req: AuthRequest, res: Response) => {
  try {
    const proposalId = parseIdOrBadRequest(res, req.params.proposalId);
    if (!proposalId) return;

    const proposalRows = await db.select({ id: exchangeProposals.id })
      .from(exchangeProposals)
      .where(eq(exchangeProposals.id, proposalId))
      .limit(1);
    if (proposalRows.length === 0) {
      res.status(404).json({ error: 'マッチングが見つかりません' });
      return;
    }

    const rows = await db.select({
      id: proposalComments.id,
      proposalId: proposalComments.proposalId,
      authorPharmacyId: proposalComments.authorPharmacyId,
      authorName: pharmacies.name,
      body: proposalComments.body,
      isDeleted: proposalComments.isDeleted,
      createdAt: proposalComments.createdAt,
      updatedAt: proposalComments.updatedAt,
    })
      .from(proposalComments)
      .innerJoin(pharmacies, eq(proposalComments.authorPharmacyId, pharmacies.id))
      .where(eq(proposalComments.proposalId, proposalId))
      .orderBy(desc(proposalComments.createdAt), desc(proposalComments.id));

    res.json({
      data: rows.map((row) => ({
        ...row,
        body: row.isDeleted ? '（削除済み）' : row.body,
      })),
    });
  } catch (err) {
    handleAdminError(err, 'Admin exchange comments error', '交渉メモの取得に失敗しました', res);
  }
});


router.get('/exchanges/:proposalId/timeline', async (req: AuthRequest, res: Response) => {
  try {
    const proposalId = parseIdOrBadRequest(res, req.params.proposalId);
    if (!proposalId) return;

    const [proposal] = await db.select({
      id: exchangeProposals.id,
      pharmacyAId: exchangeProposals.pharmacyAId,
      proposedAt: exchangeProposals.proposedAt,
    })
      .from(exchangeProposals)
      .where(eq(exchangeProposals.id, proposalId))
      .limit(1);

    if (!proposal) {
      res.status(404).json({ error: 'マッチングが見つかりません' });
      return;
    }

    const [proposalCreator] = await db.select({ name: pharmacies.name })
      .from(pharmacies)
      .where(eq(pharmacies.id, proposal.pharmacyAId))
      .limit(1);

    const actionRows = await fetchProposalTimelineActionRows(proposalId);

    res.json({
      data: buildProposalTimeline({
        proposedAt: proposal.proposedAt,
        proposalCreatorPharmacyId: proposal.pharmacyAId,
        proposalCreatorName: proposalCreator?.name ?? '提案元薬局',
        actionRows,
      }),
    });
  } catch (err) {
    handleAdminError(err, 'Admin exchange timeline error', '進行履歴の取得に失敗しました', res);
  }
});

router.post('/messages', adminWriteLimiter, async (req: AuthRequest, res: Response) => {
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

    void writeLog('admin_send_message', {
      pharmacyId: req.user!.id,
      detail: `メッセージ送信: ${title} (対象: ${targetType === 'all' ? '全体' : `薬局ID:${targetPharmacyId}`})`,
      ipAddress: getClientIp(req),
    });

    res.status(201).json({ message: '加盟薬局へメッセージを送信しました' });
  } catch (err) {
    handleAdminError(err, 'Admin message send error', 'メッセージ送信に失敗しました', res);
  }
});

router.post('/requests/:id/handoff', adminWriteLimiter, async (req: AuthRequest, res: Response) => {
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

    if (requestRow.openclawStatus !== 'pending_handoff') {
      res.status(400).json({ error: '連携待ちの要望のみ再連携できます' });
      return;
    }

    const handoff = await handoffToOpenClaw({
      requestId: requestRow.id,
      pharmacyId: requestRow.pharmacyId,
      requestText: requestRow.requestText,
      context: await collectAdminHandoffContext(requestRow.pharmacyId, requestRow.id),
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
    }

    sendAdminHandoffResponse(res, handoff);
  } catch (err) {
    handleAdminError(err, 'Admin user request handoff error', '再連携に失敗しました', res);
  }
});

// ── 一括操作 ───────────────────────────────────────────────

function parseBulkActionBody(body: unknown): { ok: true; data: BulkPharmacyActionRequest } | { ok: false; error: string } {
  if (typeof body !== 'object' || body === null) {
    return { ok: false, error: 'リクエスト形式が不正です' };
  }
  const { pharmacyIds, reason } = body as Record<string, unknown>;
  if (!Array.isArray(pharmacyIds) || pharmacyIds.length === 0) {
    return { ok: false, error: '対象薬局IDを1つ以上指定してください' };
  }
  if (pharmacyIds.length > 100) {
    return { ok: false, error: '一括操作は最大100件までです' };
  }
  if (!pharmacyIds.every((id): id is number => typeof id === 'number' && Number.isInteger(id) && id > 0)) {
    return { ok: false, error: '薬局IDは正の整数で指定してください' };
  }
  const uniqueIds = [...new Set(pharmacyIds)];
  const validReason = typeof reason === 'string' && reason.trim().length > 0 ? reason.trim() : undefined;
  return { ok: true, data: { pharmacyIds: uniqueIds, reason: validReason } };
}

async function runBulkPharmacyStatusUpdate(
  pharmacyIds: number[],
  reason: string | undefined,
  config: BulkPharmacyActionConfig,
): Promise<BulkActionResult[]> {
  return db.transaction(async (tx) => {
    const targetPharmacies = await tx.select({
      id: pharmacies.id,
      verificationStatus: pharmacies.verificationStatus,
    })
      .from(pharmacies)
      .where(inArray(pharmacies.id, pharmacyIds));

    const targetMap = new Map(targetPharmacies.map((pharmacy) => [pharmacy.id, pharmacy]));
    const results: BulkActionResult[] = [];

    for (const pharmacyId of pharmacyIds) {
      const target = targetMap.get(pharmacyId);
      if (!target) {
        throw new Error(`薬局ID:${pharmacyId} が見つかりません`);
      }
      if (target.verificationStatus === config.skippedStatus) {
        results.push({ pharmacyId, success: true });
        continue;
      }

      const now = new Date().toISOString();
      await tx.update(pharmacies)
        .set({
          verificationStatus: config.nextStatus,
          isActive: config.isActive,
          verifiedAt: config.nextStatus === 'verified' ? now : null,
          rejectionReason: config.nextStatus === 'rejected' ? reason ?? null : null,
          updatedAt: now,
        })
        .where(eq(pharmacies.id, pharmacyId));

      results.push({ pharmacyId, success: true });
    }

    return results;
  });
}

function logBulkAuditFailure(action: BulkPharmacyActionKind, pharmacyId: number, err: unknown): void {
  logger.error(`Failed to record audit log for bulk-${action}`, {
    pharmacyId,
    error: err instanceof Error ? err.message : String(err),
  });
}

function writeBulkAuditLogs(
  results: BulkActionResult[],
  adminId: number,
  action: BulkPharmacyActionKind,
  reason: string | undefined,
): void {
  const newStatus = action === 'verify' ? 'verified' : 'rejected';
  for (const result of results) {
    if (!result.success) {
      continue;
    }
    invalidateAuthUserCache(result.pharmacyId);
    void recordAuditLog({
      adminId,
      targetPharmacyId: result.pharmacyId,
      action,
      previousStatus: 'pending_verification',
      newStatus,
      reason: reason ?? null,
    }).catch((err) => {
      logBulkAuditFailure(action, result.pharmacyId, err);
    });
  }
}

function sendBulkActionResponse(
  res: Response,
  pharmacyIds: number[],
  results: BulkActionResult[],
): void {
  const response: BulkPharmacyActionResponse = {
    totalRequested: pharmacyIds.length,
    succeeded: results.filter((result) => result.success).length,
    failed: results.filter((result) => !result.success).length,
    results,
  };
  res.json(response);
}

router.post('/pharmacies/bulk-verify', adminWriteLimiter, async (req: AuthRequest, res: Response) => {
  try {
    const parsed = parseBulkActionBody(req.body);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    const { pharmacyIds, reason } = parsed.data;
    const adminId = req.user!.id;

    const results = await runBulkPharmacyStatusUpdate(pharmacyIds, reason, {
      nextStatus: 'verified',
      skippedStatus: 'verified',
      isActive: true,
    });
    writeBulkAuditLogs(results, adminId, 'verify', reason);

    void writeLog('admin_bulk_verify', {
      pharmacyId: adminId,
      detail: `一括承認: ${pharmacyIds.length}件`,
      ipAddress: getClientIp(req),
    });

    sendBulkActionResponse(res, pharmacyIds, results);
  } catch (err) {
    handleAdminError(err, 'Admin bulk verify error', '一括承認に失敗しました', res);
  }
});

router.post('/pharmacies/bulk-reject', adminWriteLimiter, async (req: AuthRequest, res: Response) => {
  try {
    const parsed = parseBulkActionBody(req.body);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    const { pharmacyIds, reason } = parsed.data;
    const adminId = req.user!.id;

    if (!reason) {
      res.status(400).json({ error: '却下理由は必須です' });
      return;
    }

    const results = await runBulkPharmacyStatusUpdate(pharmacyIds, reason, {
      nextStatus: 'rejected',
      skippedStatus: 'rejected',
      isActive: false,
    });
    writeBulkAuditLogs(results, adminId, 'reject', reason);

    void writeLog('admin_bulk_reject', {
      pharmacyId: adminId,
      detail: `一括却下: ${pharmacyIds.length}件 理由: ${reason}`,
      ipAddress: getClientIp(req),
    });

    sendBulkActionResponse(res, pharmacyIds, results);
  } catch (err) {
    handleAdminError(err, 'Admin bulk reject error', '一括却下に失敗しました', res);
  }
});

export default router;
