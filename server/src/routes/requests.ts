import { Router, Response } from 'express';
import { desc, eq } from 'drizzle-orm';
import { db } from '../config/database';
import { openclawWorkItems, pharmacies, userRequests } from '../db/schema';
import { requireLogin } from '../middleware/auth';
import { uploadOptionalAttachments } from '../middleware/attachment-upload';
import { logger } from '../services/logger';
import { buildOpenClawLogContext } from '../services/openclaw/log-context-service';
import { handoffToOpenClaw } from '../services/openclaw';
import { recordOpenClawRequestEvent } from '../services/openclaw/request-event-service';
import {
  buildOpenClawConversationContext,
  ensureOpenClawWorkItem,
  isMissingOpenClawSchemaError,
  listOpenClawRequestMessages,
  mapOpenClawStatusToWorkflowStatus,
  recordOpenClawRequestMessage,
  updateOpenClawWorkItem,
} from '../services/openclaw/thread-service';
import {
  computeRequestWaitingState,
  createRequestMessageAttachments,
  getRequestAttachmentDownload,
  hasRequesterUnreadMessages,
  isRequestCategory,
  isRequestPriority,
  listRequestDuplicateSuggestions,
  touchRequestViewed,
  updateRequestActivity,
} from '../services/request-collaboration-service';
import {
  publishAdminRequestsRefresh,
  publishRequestsRefresh,
} from '../services/realtime-service';
import { AuthRequest } from '../types';
import { normalizeSearchTerm, parsePositiveInt } from '../utils/request-utils';

const router = Router();
const REQUEST_REMINDER_COOLDOWN_MS = 6 * 60 * 60 * 1000;

router.use(requireLogin);

function parseRequestBodyMessage(rawValue: unknown): string {
  return typeof rawValue === 'string' ? rawValue.trim() : '';
}

function parseRequestCategoryInput(rawValue: unknown) {
  return isRequestCategory(rawValue) ? rawValue : 'improvement';
}

function parseRequestPriorityInput(rawValue: unknown) {
  return isRequestPriority(rawValue) ? rawValue : 'normal';
}

function buildRequestSummary(row: {
  id: number;
  requestText: string;
  category?: string | null;
  priority?: string | null;
  closeReason?: string | null;
  assignedAdminId?: number | null;
  assignedAdminName?: string | null;
  requesterLastViewedAt?: string | null;
  adminLastViewedAt?: string | null;
  latestUserMessageAt?: string | null;
  latestStaffMessageAt?: string | null;
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
}) {
  const waitingState = computeRequestWaitingState({
    latestUserMessageAt: row.latestUserMessageAt ?? null,
    latestStaffMessageAt: row.latestStaffMessageAt ?? null,
    workflowStatus: row.workflowStatus ?? null,
  });

  return {
    id: row.id,
    requestText: row.requestText,
    category: row.category ?? 'improvement',
    priority: row.priority ?? 'normal',
    closeReason: row.closeReason ?? null,
    assignedAdminId: row.assignedAdminId ?? null,
    assignedAdminName: row.assignedAdminName ?? null,
    requesterLastViewedAt: row.requesterLastViewedAt ?? null,
    adminLastViewedAt: row.adminLastViewedAt ?? null,
    latestUserMessageAt: row.latestUserMessageAt ?? null,
    latestStaffMessageAt: row.latestStaffMessageAt ?? null,
    openclawStatus: row.openclawStatus ?? 'pending_handoff',
    openclawThreadId: row.openclawThreadId,
    openclawSummary: row.openclawSummary,
    workflowStatus: row.workflowStatus,
    latestSummary: row.latestSummary,
    branchName: row.branchName,
    prUrl: row.prUrl,
    prNumber: row.prNumber,
    updatedAt: row.updatedAt,
    createdAt: row.createdAt,
    hasUnread: hasRequesterUnreadMessages({
      latestStaffMessageAt: row.latestStaffMessageAt ?? null,
      requesterLastViewedAt: row.requesterLastViewedAt ?? null,
    }),
    waitingOn: waitingState.waitingOn,
    isOverdue: waitingState.isOverdue,
  };
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
      category: string | null;
      priority: string | null;
      closeReason: string | null;
      assignedAdminId: number | null;
      assignedAdminName: string | null;
      requesterLastViewedAt: string | null;
      adminLastViewedAt: string | null;
      latestUserMessageAt: string | null;
      latestStaffMessageAt: string | null;
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
        category: userRequests.category,
        priority: userRequests.priority,
        closeReason: userRequests.closeReason,
        assignedAdminId: userRequests.assignedAdminId,
        assignedAdminName: pharmacies.name,
        requesterLastViewedAt: userRequests.requesterLastViewedAt,
        adminLastViewedAt: userRequests.adminLastViewedAt,
        latestUserMessageAt: userRequests.latestUserMessageAt,
        latestStaffMessageAt: userRequests.latestStaffMessageAt,
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
        .leftJoin(pharmacies, eq(pharmacies.id, userRequests.assignedAdminId))
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
        category: userRequests.category,
        priority: userRequests.priority,
        closeReason: userRequests.closeReason,
        assignedAdminId: userRequests.assignedAdminId,
        requesterLastViewedAt: userRequests.requesterLastViewedAt,
        adminLastViewedAt: userRequests.adminLastViewedAt,
        latestUserMessageAt: userRequests.latestUserMessageAt,
        latestStaffMessageAt: userRequests.latestStaffMessageAt,
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
          assignedAdminName: null,
          workflowStatus: null,
          latestSummary: null,
          branchName: null,
          prUrl: null,
          prNumber: null,
        })));
    }

    res.json({
      data: rows.map((row) => buildRequestSummary(row)),
      pagination: {
        limit,
      },
    });
  } catch (err) {
    logger.error('User request list error', { error: (err as Error).message });
    res.status(500).json({ error: '要望一覧の取得に失敗しました' });
  }
});

router.get('/suggestions', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?.id) {
      res.status(401).json({ error: 'ログインが必要です' });
      return;
    }

    const query = normalizeSearchTerm(req.query.query, 200);
    if (!query) {
      res.json({ data: [] });
      return;
    }

    const data = await listRequestDuplicateSuggestions(req.user.id, query);
    res.json({ data });
  } catch (err) {
    logger.error('Request duplicate suggestions error', { error: (err as Error).message });
    res.status(500).json({ error: '重複候補の取得に失敗しました' });
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
      category: string | null;
      priority: string | null;
      closeReason: string | null;
      assignedAdminId: number | null;
      assignedAdminName: string | null;
      requesterLastViewedAt: string | null;
      adminLastViewedAt: string | null;
      latestUserMessageAt: string | null;
      latestStaffMessageAt: string | null;
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
        category: userRequests.category,
        priority: userRequests.priority,
        closeReason: userRequests.closeReason,
        assignedAdminId: userRequests.assignedAdminId,
        assignedAdminName: pharmacies.name,
        requesterLastViewedAt: userRequests.requesterLastViewedAt,
        adminLastViewedAt: userRequests.adminLastViewedAt,
        latestUserMessageAt: userRequests.latestUserMessageAt,
        latestStaffMessageAt: userRequests.latestStaffMessageAt,
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
        .leftJoin(pharmacies, eq(pharmacies.id, userRequests.assignedAdminId))
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
        category: userRequests.category,
        priority: userRequests.priority,
        closeReason: userRequests.closeReason,
        assignedAdminId: userRequests.assignedAdminId,
        requesterLastViewedAt: userRequests.requesterLastViewedAt,
        adminLastViewedAt: userRequests.adminLastViewedAt,
        latestUserMessageAt: userRequests.latestUserMessageAt,
        latestStaffMessageAt: userRequests.latestStaffMessageAt,
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
          assignedAdminName: null,
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

    await touchRequestViewed(requestId, 'requester');
    const messages = await listOpenClawRequestMessages(requestId);

    res.json({
      request: {
        ...buildRequestSummary(requestRow),
        lastQuestion: requestRow.lastQuestion,
        lastError: requestRow.lastError,
      },
      messages,
    });
  } catch (err) {
    logger.error('User request message list error', { error: (err as Error).message });
    res.status(500).json({ error: '会話履歴の取得に失敗しました' });
  }
});

router.post('/', uploadOptionalAttachments, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?.id) {
      res.status(401).json({ error: 'ログインが必要です' });
      return;
    }

    const requestText = parseRequestBodyMessage(req.body.message);
    const files = Array.isArray(req.files) ? req.files as Express.Multer.File[] : [];
    if ((!requestText && files.length === 0) || requestText.length > 2000) {
      res.status(400).json({ error: '要望は1〜2000文字で入力してください' });
      return;
    }
    const category = parseRequestCategoryInput(req.body.category);
    const priority = parseRequestPriorityInput(req.body.priority);

    const [created] = await db.insert(userRequests)
      .values({
        pharmacyId: req.user.id,
        requestText,
        category,
        priority,
        openclawStatus: 'pending_handoff',
      })
      .returning({
        id: userRequests.id,
        requestText: userRequests.requestText,
        category: userRequests.category,
        priority: userRequests.priority,
        closeReason: userRequests.closeReason,
        assignedAdminId: userRequests.assignedAdminId,
        requesterLastViewedAt: userRequests.requesterLastViewedAt,
        adminLastViewedAt: userRequests.adminLastViewedAt,
        latestUserMessageAt: userRequests.latestUserMessageAt,
        latestStaffMessageAt: userRequests.latestStaffMessageAt,
        openclawStatus: userRequests.openclawStatus,
        openclawThreadId: userRequests.openclawThreadId,
        openclawSummary: userRequests.openclawSummary,
        updatedAt: userRequests.updatedAt,
        createdAt: userRequests.createdAt,
      });

    await ensureOpenClawWorkItem({
      requestId: created.id,
      pharmacyId: req.user.id,
      source: 'user_request',
      workflowStatus: 'queued',
      latestSummary: '要望を受け付けました',
    });

    const recorded = await recordOpenClawRequestMessage({
      requestId: created.id,
      authorType: 'user',
      body: requestText,
    });
    await createRequestMessageAttachments(recorded.id, files);
    await updateRequestActivity(created.id, 'user');
    await touchRequestViewed(created.id, 'requester');

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
        ...buildRequestSummary({
          ...created,
          workflowStatus: handoff.accepted ? mapOpenClawStatusToWorkflowStatus(handoff.status) : 'queued',
          latestSummary: handoff.summary ?? null,
          branchName: null,
          prUrl: null,
          prNumber: null,
          assignedAdminName: null,
        }),
        openclawStatus,
      },
    });
  } catch (err) {
    logger.error('User request submit error', { error: (err as Error).message });
    res.status(500).json({ error: '要望の送信に失敗しました' });
  }
});

router.post('/:id/messages', uploadOptionalAttachments, async (req: AuthRequest, res: Response) => {
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
    const files = Array.isArray(req.files) ? req.files as Express.Multer.File[] : [];
    if ((!message && files.length === 0) || message.length > 2000) {
      res.status(400).json({ error: '返信は1〜2000文字で入力してください' });
      return;
    }

    let requestRows: Array<{
      id: number;
      pharmacyId: number;
      requestText: string;
      assignedAdminId: number | null;
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
        assignedAdminId: userRequests.assignedAdminId,
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
        assignedAdminId: userRequests.assignedAdminId,
        openclawStatus: userRequests.openclawStatus,
        openclawThreadId: userRequests.openclawThreadId,
      })
        .from(userRequests)
        .where(eq(userRequests.id, requestId))
        .limit(1)
        .then((fallbackRows) => fallbackRows.map((row) => ({
          ...row,
          assignedAdminId: row.assignedAdminId ?? null,
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
    await createRequestMessageAttachments(recorded.id, files);
    await updateRequestActivity(requestId, 'user');
    await touchRequestViewed(requestId, 'requester');

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

router.post('/:id/remind', async (req: AuthRequest, res: Response) => {
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
      assignedAdminId: number | null;
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
        assignedAdminId: userRequests.assignedAdminId,
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
        assignedAdminId: userRequests.assignedAdminId,
        openclawStatus: userRequests.openclawStatus,
        openclawThreadId: userRequests.openclawThreadId,
      })
        .from(userRequests)
        .where(eq(userRequests.id, requestId))
        .limit(1)
        .then((fallbackRows) => fallbackRows.map((row) => ({
          ...row,
          assignedAdminId: row.assignedAdminId ?? null,
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
      res.status(400).json({ error: '完了済み要望には再催促できません' });
      return;
    }

    const messages = await listOpenClawRequestMessages(requestId);
    const latestReminder = [...messages]
      .reverse()
      .find((entry) =>
        entry.authorType === 'user'
        && entry.metadata?.kind === 'user_reminder');

    if (latestReminder?.createdAt) {
      const latestReminderMs = Date.parse(latestReminder.createdAt);
      if (Number.isFinite(latestReminderMs) && Date.now() - latestReminderMs < REQUEST_REMINDER_COOLDOWN_MS) {
        const nextAllowedAt = new Date(latestReminderMs + REQUEST_REMINDER_COOLDOWN_MS).toISOString();
        res.status(429).json({
          error: '再催促は6時間ごとに送信できます',
          nextAllowedAt,
        });
        return;
      }
    }

    const reminderBodyRaw = parseRequestBodyMessage(req.body.message);
    const reminderBody = reminderBodyRaw || '対応状況を確認したいです。進捗があれば共有してください。';
    const recorded = await recordOpenClawRequestMessage({
      requestId,
      authorType: 'user',
      body: `[再催促] ${reminderBody}`,
      metadata: {
        kind: 'user_reminder',
      },
    });
    await updateRequestActivity(requestId, 'user');
    await touchRequestViewed(requestId, 'requester');

    await updateOpenClawWorkItem({
      requestId,
      workflowStatus: requestRow.workflowStatus === 'awaiting_user' ? 'analyzing' : 'queued',
      latestSummary: 'ユーザーから再催促があり、状況確認を再開しました',
      lastQuestion: null,
      lastError: null,
    });

    const handoffContext = await buildRequestHandoffContext(
      req.user.id,
      requestId,
      'user_request_reminder',
      requestRow.openclawThreadId,
      {
        followUp: {
          type: 'user_reminder',
          messageId: recorded.id,
          message: reminderBody,
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
      handoffKey: `reminder-${recorded.id}`,
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
      latestSummary: handoff.summary ?? (handoff.accepted ? '再催促をOpenClawへ送信しました' : '再催促を受付し、連携待ちです'),
    });

    if (requestRow.workflowStatus === 'awaiting_user' || requestRow.workflowStatus === 'implementing' || requestRow.workflowStatus === 'queued' || requestRow.workflowStatus === 'analyzing') {
      await recordOpenClawRequestEvent({
        requestId,
        pharmacyId: req.user.id,
        eventType: 'request_escalated',
        summary: 'ユーザー再催促によりエスカレーション',
        note: reminderBody,
        metadata: {
          source: 'user_reminder',
        },
      }).catch(() => {
        // non-blocking
      });
    }

    if (requestRow.assignedAdminId) {
      const { createNotification } = await import('../services/notification-service');
      await createNotification({
        pharmacyId: requestRow.assignedAdminId,
        type: 'request_update',
        title: '再催促された要望があります',
        message: reminderBody,
        referenceType: 'request',
        referenceId: requestId,
        detailJson: {
          source: 'user_reminder',
        },
      });
    }

    publishRequestsRefresh({
      pharmacyId: req.user.id,
      requestId,
      reason: 'request_reminder_created',
    });
    publishAdminRequestsRefresh({
      requestId,
      reason: 'request_reminder_created',
    });

    res.json({
      message: '再催促を送信しました',
      nextStep: handoff.note,
      handoff: {
        accepted: handoff.accepted,
        connectorConfigured: handoff.connectorConfigured,
        implementationBranch: handoff.implementationBranch,
        status: handoff.status,
      },
    });
  } catch (err) {
    logger.error('User request reminder error', { error: (err as Error).message });
    res.status(500).json({ error: '再催促の送信に失敗しました' });
  }
});

router.get('/attachments/:attachmentId', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?.id) {
      res.status(401).json({ error: 'ログインが必要です' });
      return;
    }

    const attachmentId = parsePositiveInt(req.params.attachmentId);
    if (!attachmentId) {
      res.status(400).json({ error: '添付IDが不正です' });
      return;
    }

    const attachment = await getRequestAttachmentDownload(attachmentId);
    if (!attachment) {
      res.status(404).json({ error: '添付ファイルが見つかりません' });
      return;
    }

    const [requestRow] = await db.select({
      pharmacyId: userRequests.pharmacyId,
    })
      .from(userRequests)
      .where(eq(userRequests.id, attachment.requestId))
      .limit(1);

    if (!requestRow || requestRow.pharmacyId !== req.user.id) {
      res.status(403).json({ error: 'この添付ファイルにはアクセスできません' });
      return;
    }

    res.setHeader('Content-Type', attachment.mimeType);
    res.setHeader('Content-Length', String(attachment.fileSize));
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`);
    res.send(attachment.content);
  } catch (err) {
    logger.error('Request attachment download error', { error: (err as Error).message });
    res.status(500).json({ error: '添付ファイルの取得に失敗しました' });
  }
});

export default router;
