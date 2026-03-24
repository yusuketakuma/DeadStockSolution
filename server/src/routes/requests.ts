import { Router, Response } from 'express';
import { desc, eq } from 'drizzle-orm';
import { db } from '../config/database';
import { openclawWorkItems, userRequests } from '../db/schema';
import { requireLogin } from '../middleware/auth';
import { logger } from '../services/logger';
import { buildOpenClawLogContext } from '../services/openclaw-log-context-service';
import { handoffToOpenClaw } from '../services/openclaw-service';
import {
  buildOpenClawConversationContext,
  ensureOpenClawWorkItem,
  isMissingOpenClawSchemaError,
  listOpenClawRequestMessages,
  mapOpenClawStatusToWorkflowStatus,
  recordOpenClawRequestMessage,
  updateOpenClawWorkItem,
} from '../services/openclaw-thread-service';
import {
  publishAdminRequestsRefresh,
  publishRequestsRefresh,
} from '../services/realtime-service';
import { AuthRequest } from '../types';
import { parsePositiveInt } from '../utils/request-utils';

const router = Router();

router.use(requireLogin);

function parseRequestBodyMessage(rawValue: unknown): string {
  return typeof rawValue === 'string' ? rawValue.trim() : '';
}

async function buildRequestHandoffContext(
  pharmacyId: number,
  requestId: number,
  source: string,
  threadId: string | null,
  options?: {
    followUp?: Record<string, unknown>;
  },
): Promise<Record<string, unknown>> {
  const conversation = await buildOpenClawConversationContext(requestId);

  try {
    const operationLogs = await buildOpenClawLogContext(pharmacyId);
    return {
      source,
      conversation,
      ...(threadId ? { threadId } : {}),
      ...(options?.followUp ? { followUp: options.followUp } : {}),
      operationLogs,
    };
  } catch (contextErr) {
    logger.warn('OpenClaw context collection failed', {
      requestId,
      pharmacyId,
      source,
      error: (contextErr as Error).message,
    });

    return {
      source,
      conversation,
      ...(threadId ? { threadId } : {}),
      ...(options?.followUp ? { followUp: options.followUp } : {}),
    };
  }
}

router.get('/me', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?.id) {
      res.status(401).json({ error: 'ログインが必要です' });
      return;
    }

    const parsedLimit = parsePositiveInt(String(req.query.limit ?? ''));
    const limit = parsedLimit ? Math.min(parsedLimit, 100) : 50;

    let rows: Array<{
      id: number;
      requestText: string;
      openclawStatus: string | null;
      openclawThreadId: string | null;
      openclawSummary: string | null;
      workflowStatus: string | null;
      latestSummary: string | null;
      branchName: string | null;
      prUrl: string | null;
      prNumber: number | null;
      updatedAt: string | null;
      createdAt: string | null;
    }>;

    try {
      rows = await db.select({
        id: userRequests.id,
        requestText: userRequests.requestText,
        openclawStatus: userRequests.openclawStatus,
        openclawThreadId: userRequests.openclawThreadId,
        openclawSummary: userRequests.openclawSummary,
        workflowStatus: openclawWorkItems.workflowStatus,
        latestSummary: openclawWorkItems.latestSummary,
        branchName: openclawWorkItems.branchName,
        prUrl: openclawWorkItems.prUrl,
        prNumber: openclawWorkItems.prNumber,
        updatedAt: userRequests.updatedAt,
        createdAt: userRequests.createdAt,
      })
        .from(userRequests)
        .leftJoin(openclawWorkItems, eq(openclawWorkItems.requestId, userRequests.id))
        .where(eq(userRequests.pharmacyId, req.user.id))
        .orderBy(desc(userRequests.createdAt), desc(userRequests.id))
        .limit(limit);
    } catch (err) {
      if (!isMissingOpenClawSchemaError(err)) {
        throw err;
      }

      rows = await db.select({
        id: userRequests.id,
        requestText: userRequests.requestText,
        openclawStatus: userRequests.openclawStatus,
        openclawThreadId: userRequests.openclawThreadId,
        openclawSummary: userRequests.openclawSummary,
        updatedAt: userRequests.updatedAt,
        createdAt: userRequests.createdAt,
      })
        .from(userRequests)
        .where(eq(userRequests.pharmacyId, req.user.id))
        .orderBy(desc(userRequests.createdAt), desc(userRequests.id))
        .limit(limit)
        .then((fallbackRows) => fallbackRows.map((row) => ({
          ...row,
          workflowStatus: null,
          latestSummary: null,
          branchName: null,
          prUrl: null,
          prNumber: null,
        })));
    }

    res.json({
      data: rows,
      pagination: {
        limit,
      },
    });
  } catch (err) {
    logger.error('User request list error', { error: (err as Error).message });
    res.status(500).json({ error: '要望一覧の取得に失敗しました' });
  }
});

router.get('/:id/messages', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?.id) {
      res.status(401).json({ error: 'ログインが必要です' });
      return;
    }

    const requestId = parsePositiveInt(req.params.id);
    if (!requestId) {
      res.status(400).json({ error: '要望IDが不正です' });
      return;
    }

    let requestRows: Array<{
      id: number;
      pharmacyId: number;
      requestText: string;
      openclawStatus: string | null;
      openclawThreadId: string | null;
      openclawSummary: string | null;
      createdAt: string | null;
      updatedAt: string | null;
      workflowStatus: string | null;
      latestSummary: string | null;
      lastQuestion: string | null;
      branchName: string | null;
      prUrl: string | null;
      prNumber: number | null;
      lastError: string | null;
    }>;

    try {
      requestRows = await db.select({
        id: userRequests.id,
        pharmacyId: userRequests.pharmacyId,
        requestText: userRequests.requestText,
        openclawStatus: userRequests.openclawStatus,
        openclawThreadId: userRequests.openclawThreadId,
        openclawSummary: userRequests.openclawSummary,
        createdAt: userRequests.createdAt,
        updatedAt: userRequests.updatedAt,
        workflowStatus: openclawWorkItems.workflowStatus,
        latestSummary: openclawWorkItems.latestSummary,
        lastQuestion: openclawWorkItems.lastQuestion,
        branchName: openclawWorkItems.branchName,
        prUrl: openclawWorkItems.prUrl,
        prNumber: openclawWorkItems.prNumber,
        lastError: openclawWorkItems.lastError,
      })
        .from(userRequests)
        .leftJoin(openclawWorkItems, eq(openclawWorkItems.requestId, userRequests.id))
        .where(eq(userRequests.id, requestId))
        .limit(1);
    } catch (err) {
      if (!isMissingOpenClawSchemaError(err)) {
        throw err;
      }

      requestRows = await db.select({
        id: userRequests.id,
        pharmacyId: userRequests.pharmacyId,
        requestText: userRequests.requestText,
        openclawStatus: userRequests.openclawStatus,
        openclawThreadId: userRequests.openclawThreadId,
        openclawSummary: userRequests.openclawSummary,
        createdAt: userRequests.createdAt,
        updatedAt: userRequests.updatedAt,
      })
        .from(userRequests)
        .where(eq(userRequests.id, requestId))
        .limit(1)
        .then((fallbackRows) => fallbackRows.map((row) => ({
          ...row,
          workflowStatus: null,
          latestSummary: null,
          lastQuestion: null,
          branchName: null,
          prUrl: null,
          prNumber: null,
          lastError: null,
        })));
    }

    const [requestRow] = requestRows;

    if (!requestRow || requestRow.pharmacyId !== req.user.id) {
      res.status(404).json({ error: '要望が見つかりません' });
      return;
    }

    const messages = await listOpenClawRequestMessages(requestId);

    res.json({
      request: requestRow,
      messages,
    });
  } catch (err) {
    logger.error('User request message list error', { error: (err as Error).message });
    res.status(500).json({ error: '会話履歴の取得に失敗しました' });
  }
});

router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?.id) {
      res.status(401).json({ error: 'ログインが必要です' });
      return;
    }

    const requestText = parseRequestBodyMessage(req.body.message);
    if (!requestText || requestText.length > 2000) {
      res.status(400).json({ error: '要望は1〜2000文字で入力してください' });
      return;
    }

    const [created] = await db.insert(userRequests)
      .values({
        pharmacyId: req.user.id,
        requestText,
        openclawStatus: 'pending_handoff',
      })
      .returning({
        id: userRequests.id,
        openclawStatus: userRequests.openclawStatus,
        createdAt: userRequests.createdAt,
      });

    await ensureOpenClawWorkItem({
      requestId: created.id,
      pharmacyId: req.user.id,
      source: 'user_request',
      workflowStatus: 'queued',
      latestSummary: '要望を受け付けました',
    });

    await recordOpenClawRequestMessage({
      requestId: created.id,
      authorType: 'user',
      body: requestText,
    });

    const handoffContext = await buildRequestHandoffContext(req.user.id, created.id, 'user_request', null);
    const handoff = await handoffToOpenClaw({
      requestId: created.id,
      pharmacyId: req.user.id,
      requestText,
      context: handoffContext,
      handoffKey: 'initial',
    });

    let openclawStatus = created.openclawStatus;
    if (handoff.accepted) {
      await db.update(userRequests)
        .set({
          openclawStatus: handoff.status,
          openclawThreadId: handoff.threadId,
          openclawSummary: handoff.summary,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(userRequests.id, created.id));
      openclawStatus = handoff.status;
    }

    await updateOpenClawWorkItem({
      requestId: created.id,
      workflowStatus: handoff.accepted ? mapOpenClawStatusToWorkflowStatus(handoff.status) : 'queued',
      latestSummary: handoff.summary ?? (handoff.accepted ? 'OpenClawへ連携しました' : 'OpenClaw連携待ちです'),
    });

    publishRequestsRefresh({
      pharmacyId: req.user.id,
      requestId: created.id,
      reason: 'request_created',
    });
    publishAdminRequestsRefresh({
      requestId: created.id,
      reason: 'request_created',
    });

    res.status(201).json({
      message: '要望を受け付けました',
      nextStep: handoff.note,
      handoff: {
        accepted: handoff.accepted,
        connectorConfigured: handoff.connectorConfigured,
        implementationBranch: handoff.implementationBranch,
        status: handoff.status,
      },
      request: {
        ...created,
        openclawStatus,
      },
    });
  } catch (err) {
    logger.error('User request submit error', { error: (err as Error).message });
    res.status(500).json({ error: '要望の送信に失敗しました' });
  }
});

router.post('/:id/messages', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?.id) {
      res.status(401).json({ error: 'ログインが必要です' });
      return;
    }

    const requestId = parsePositiveInt(req.params.id);
    if (!requestId) {
      res.status(400).json({ error: '要望IDが不正です' });
      return;
    }

    const message = parseRequestBodyMessage(req.body.message);
    if (!message || message.length > 2000) {
      res.status(400).json({ error: '返信は1〜2000文字で入力してください' });
      return;
    }

    let requestRows: Array<{
      id: number;
      pharmacyId: number;
      requestText: string;
      openclawStatus: string;
      openclawThreadId: string | null;
      workflowStatus: string | null;
      lastQuestion: string | null;
    }>;

    try {
      requestRows = await db.select({
        id: userRequests.id,
        pharmacyId: userRequests.pharmacyId,
        requestText: userRequests.requestText,
        openclawStatus: userRequests.openclawStatus,
        openclawThreadId: userRequests.openclawThreadId,
        workflowStatus: openclawWorkItems.workflowStatus,
        lastQuestion: openclawWorkItems.lastQuestion,
      })
        .from(userRequests)
        .leftJoin(openclawWorkItems, eq(openclawWorkItems.requestId, userRequests.id))
        .where(eq(userRequests.id, requestId))
        .limit(1);
    } catch (err) {
      if (!isMissingOpenClawSchemaError(err)) {
        throw err;
      }

      requestRows = await db.select({
        id: userRequests.id,
        pharmacyId: userRequests.pharmacyId,
        requestText: userRequests.requestText,
        openclawStatus: userRequests.openclawStatus,
        openclawThreadId: userRequests.openclawThreadId,
      })
        .from(userRequests)
        .where(eq(userRequests.id, requestId))
        .limit(1)
        .then((fallbackRows) => fallbackRows.map((row) => ({
          ...row,
          workflowStatus: null,
          lastQuestion: null,
        })));
    }

    const [requestRow] = requestRows;

    if (!requestRow || requestRow.pharmacyId !== req.user.id) {
      res.status(404).json({ error: '要望が見つかりません' });
      return;
    }

    if (requestRow.openclawStatus === 'completed') {
      res.status(400).json({ error: '完了済み要望には返信できません' });
      return;
    }

    const recorded = await recordOpenClawRequestMessage({
      requestId,
      authorType: 'user',
      body: message,
    });

    await updateOpenClawWorkItem({
      requestId,
      workflowStatus: requestRow.workflowStatus === 'awaiting_user' ? 'analyzing' : 'queued',
      latestSummary: '追加情報を受領し、再解析を開始しました',
      lastQuestion: null,
      lastError: null,
    });

    const handoffContext = await buildRequestHandoffContext(
      req.user.id,
      requestId,
      'user_request_follow_up',
      requestRow.openclawThreadId,
      {
        followUp: {
          type: 'user_reply',
          messageId: recorded.id,
          message,
          previousOpenClawStatus: requestRow.openclawStatus,
          previousWorkflowStatus: requestRow.workflowStatus ?? null,
          lastQuestion: requestRow.lastQuestion ?? null,
          resumePolicy: 'continue_existing_case_without_reset',
        },
      },
    );
    const handoff = await handoffToOpenClaw({
      requestId,
      pharmacyId: req.user.id,
      requestText: requestRow.requestText,
      context: handoffContext,
      handoffKey: `message-${recorded.id}`,
    });

    if (handoff.accepted) {
      await db.update(userRequests)
        .set({
          openclawStatus: handoff.status,
          openclawThreadId: handoff.threadId ?? requestRow.openclawThreadId,
          openclawSummary: handoff.summary,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(userRequests.id, requestId));
    }

    await updateOpenClawWorkItem({
      requestId,
      workflowStatus: handoff.accepted ? mapOpenClawStatusToWorkflowStatus(handoff.status) : 'queued',
      latestSummary: handoff.summary ?? (handoff.accepted ? 'OpenClawへ再連携しました' : 'OpenClawへ再連携待ちです'),
    });

    publishRequestsRefresh({
      pharmacyId: req.user.id,
      requestId,
      reason: 'request_reply_created',
    });
    publishAdminRequestsRefresh({
      requestId,
      reason: 'request_reply_created',
    });

    res.json({
      message: '返信を送信しました',
      nextStep: handoff.note,
      handoff: {
        accepted: handoff.accepted,
        connectorConfigured: handoff.connectorConfigured,
        implementationBranch: handoff.implementationBranch,
        status: handoff.status,
      },
    });
  } catch (err) {
    logger.error('User request reply error', { error: (err as Error).message });
    res.status(500).json({ error: '返信の送信に失敗しました' });
  }
});

export default router;
