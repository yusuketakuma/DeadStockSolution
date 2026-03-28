import { eq } from 'drizzle-orm';
import { Router, Response } from 'express';
import { db } from '../config/database';
import { openclawWorkItems, userRequests } from '../db/schema';
import { AuthRequest } from '../types';
import { normalizeSearchTerm, parsePositiveInt } from '../utils/request-utils';
import {
  buildOpenClawConversationContext,
  isMissingOpenClawSchemaError,
  listOpenClawRequestMessages,
  mapOpenClawStatusToWorkflowStatus,
  recordOpenClawRequestMessage,
  updateOpenClawWorkItem,
} from '../services/openclaw-thread-service';
import { buildOpenClawLogContext } from '../services/openclaw-log-context-service';
import { handoffToOpenClaw } from '../services/openclaw-service';
import {
  addRequestInternalNote,
  createRequestMessageAttachments,
  getAdminRequestDetail,
  getRequestAttachmentDownload,
  isRequestCategory,
  isRequestCloseReason,
  isRequestPriority,
  listRequestAssigneeOptions,
  listRequestInternalNotes,
  touchRequestViewed,
  updateRequestActivity,
  updateRequestAdminMetadata,
} from '../services/request-collaboration-service';
import { listUserRequests } from '../services/admin-user-request-service';
import { listRequestEventTimeline } from '../services/openclaw-request-event-service';
import { createNotification } from '../services/notification-service';
import { handleAdminError, parseListPagination, sendPaginated } from './admin-utils';
import { uploadOptionalAttachments } from '../middleware/attachment-upload';
import {
  publishAdminRequestsRefresh,
  publishRequestsRefresh,
} from '../services/realtime-service';

const router = Router();

const VALID_OPENCLAW_STATUSES = ['pending_handoff', 'in_dialogue', 'implementing', 'completed'] as const;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}/;

async function buildAdminRequestHandoffContext(
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
  } catch {
    return {
      source,
      conversation,
      ...(threadId ? { threadId } : {}),
      ...(options?.followUp ? { followUp: options.followUp } : {}),
    };
  }
}

router.get('/user-requests', async (req: AuthRequest, res: Response) => {
  try {
    const { page, limit, offset } = parseListPagination(req);
    const rawStatus = typeof req.query.status === 'string' ? req.query.status : undefined;
    const status = rawStatus && (VALID_OPENCLAW_STATUSES as readonly string[]).includes(rawStatus) ? rawStatus : undefined;
    const pharmacyId = parsePositiveInt(req.query.pharmacyId) ?? undefined;
    const rawDateFrom = typeof req.query.dateFrom === 'string' ? req.query.dateFrom : undefined;
    const rawDateTo = typeof req.query.dateTo === 'string' ? req.query.dateTo : undefined;
    const dateFrom = rawDateFrom && ISO_DATE_RE.test(rawDateFrom) ? rawDateFrom : undefined;
    const dateTo = rawDateTo && ISO_DATE_RE.test(rawDateTo) ? rawDateTo : undefined;
    const search = normalizeSearchTerm(req.query.search, 200);
    const category = typeof req.query.category === 'string' && isRequestCategory(req.query.category)
      ? req.query.category
      : undefined;
    const priority = typeof req.query.priority === 'string' && isRequestPriority(req.query.priority)
      ? req.query.priority
      : undefined;
    const assignedAdminId = parsePositiveInt(req.query.assignedAdminId) ?? undefined;
    const waitingOn = typeof req.query.waitingOn === 'string'
      && ['user', 'admin', 'openclaw'].includes(req.query.waitingOn)
      ? req.query.waitingOn as 'user' | 'admin' | 'openclaw'
      : undefined;
    const onlyUnread = req.query.onlyUnread === 'true';

    const { data, total } = await listUserRequests({
      page,
      limit,
      offset,
      status,
      pharmacyId,
      dateFrom,
      dateTo,
      search,
      category,
      priority,
      assignedAdminId,
      waitingOn,
      onlyUnread,
    });
    sendPaginated(res, data, page, limit, total);
  } catch (err) {
    handleAdminError(err, 'Admin user requests list error', 'ユーザーリクエスト一覧の取得に失敗しました', res);
  }
});

router.get('/user-requests/assignees', async (_req: AuthRequest, res: Response) => {
  try {
    const data = await listRequestAssigneeOptions();
    res.json({ data });
  } catch (err) {
    handleAdminError(err, 'Admin user request assignees error', '担当者一覧の取得に失敗しました', res);
  }
});

router.get('/user-requests/:id', async (req: AuthRequest, res: Response) => {
  try {
    const requestId = parsePositiveInt(req.params.id);
    if (!requestId) {
      res.status(400).json({ error: '要望IDが不正です' });
      return;
    }

    const detail = await getAdminRequestDetail(requestId);
    if (!detail) {
      res.status(404).json({ error: '要望が見つかりません' });
      return;
    }

    await touchRequestViewed(requestId, 'admin');
    const [messages, notes, events] = await Promise.all([
      listOpenClawRequestMessages(requestId),
      listRequestInternalNotes(requestId),
      listRequestEventTimeline(requestId),
    ]);

    res.json({
      request: detail,
      messages,
      notes,
      events,
    });
  } catch (err) {
    handleAdminError(err, 'Admin user request detail error', '要望詳細の取得に失敗しました', res);
  }
});

router.patch('/user-requests/:id', async (req: AuthRequest, res: Response) => {
  try {
    const requestId = parsePositiveInt(req.params.id);
    if (!requestId) {
      res.status(400).json({ error: '要望IDが不正です' });
      return;
    }

    const detail = await getAdminRequestDetail(requestId);
    if (!detail) {
      res.status(404).json({ error: '要望が見つかりません' });
      return;
    }

    const category = req.body.category === undefined
      ? undefined
      : isRequestCategory(req.body.category)
        ? req.body.category
        : null;
    const priority = req.body.priority === undefined
      ? undefined
      : isRequestPriority(req.body.priority)
        ? req.body.priority
        : null;
    const closeReason = req.body.closeReason === undefined
      ? undefined
      : req.body.closeReason === null || req.body.closeReason === ''
        ? null
        : isRequestCloseReason(req.body.closeReason)
          ? req.body.closeReason
          : 'invalid';
    const assignedAdminId = req.body.assignedAdminId === undefined
      ? undefined
      : req.body.assignedAdminId === null || req.body.assignedAdminId === ''
        ? null
        : Number(req.body.assignedAdminId);

    if (category === null) {
      res.status(400).json({ error: 'カテゴリが不正です' });
      return;
    }
    if (priority === null) {
      res.status(400).json({ error: '優先度が不正です' });
      return;
    }
    if (closeReason === 'invalid') {
      res.status(400).json({ error: 'クローズ理由が不正です' });
      return;
    }
    if (assignedAdminId !== undefined && assignedAdminId !== null && (!Number.isInteger(assignedAdminId) || assignedAdminId <= 0)) {
      res.status(400).json({ error: '担当者IDが不正です' });
      return;
    }

    await updateRequestAdminMetadata(requestId, {
      ...(category !== undefined ? { category } : {}),
      ...(priority !== undefined ? { priority } : {}),
      ...(assignedAdminId !== undefined ? { assignedAdminId } : {}),
      ...(closeReason !== undefined ? { closeReason } : {}),
      ...(closeReason ? { markCompleted: true } : {}),
    });

    if (closeReason) {
      await updateOpenClawWorkItem({
        requestId,
        workflowStatus: 'completed',
        latestSummary: '管理者によりクローズされました',
      });
    }

    publishAdminRequestsRefresh({ requestId, reason: 'request_updated' });
    publishRequestsRefresh({ pharmacyId: detail.pharmacyId, requestId, reason: 'request_updated' });

    const updated = await getAdminRequestDetail(requestId);
    res.json({ request: updated });
  } catch (err) {
    handleAdminError(err, 'Admin user request update error', '要望の更新に失敗しました', res);
  }
});

router.post('/user-requests/:id/messages', uploadOptionalAttachments, async (req: AuthRequest, res: Response) => {
  try {
    const requestId = parsePositiveInt(req.params.id);
    if (!requestId) {
      res.status(400).json({ error: '要望IDが不正です' });
      return;
    }

    const detail = await getAdminRequestDetail(requestId);
    if (!detail) {
      res.status(404).json({ error: '要望が見つかりません' });
      return;
    }

    const body = typeof req.body.message === 'string' ? req.body.message.trim() : '';
    const files = Array.isArray(req.files) ? req.files as Express.Multer.File[] : [];
    if ((!body && files.length === 0) || body.length > 2000) {
      res.status(400).json({ error: '返信は1〜2000文字で入力してください' });
      return;
    }

    let workflowStatus: string | null = null;
    try {
      const [workItem] = await db.select({
        workflowStatus: openclawWorkItems.workflowStatus,
      })
        .from(openclawWorkItems)
        .where(eq(openclawWorkItems.requestId, requestId))
        .limit(1);
      workflowStatus = workItem?.workflowStatus ?? null;
    } catch (err) {
      if (!isMissingOpenClawSchemaError(err)) {
        throw err;
      }
    }

    const recorded = await recordOpenClawRequestMessage({
      requestId,
      authorType: 'admin',
      body,
    });
    await createRequestMessageAttachments(recorded.id, files);
    await updateRequestActivity(requestId, 'admin');
    await touchRequestViewed(requestId, 'admin');

    await updateOpenClawWorkItem({
      requestId,
      workflowStatus: workflowStatus === 'awaiting_user' ? 'analyzing' : 'queued',
      latestSummary: '管理者コメントを受領し、再解析を開始しました',
      lastQuestion: null,
      lastError: null,
    });

    const handoffContext = await buildAdminRequestHandoffContext(
      detail.pharmacyId,
      requestId,
      'admin_request_follow_up',
      detail.openclawThreadId,
      {
        followUp: {
          type: 'admin_reply',
          messageId: recorded.id,
          message: body,
          previousOpenClawStatus: detail.openclawStatus,
          previousWorkflowStatus: workflowStatus,
          resumePolicy: 'continue_existing_case_without_reset',
        },
      },
    );

    const handoff = await handoffToOpenClaw({
      requestId,
      pharmacyId: detail.pharmacyId,
      requestText: detail.requestText,
      context: handoffContext,
      handoffKey: `admin-message-${recorded.id}`,
    });

    if (handoff.accepted) {
      await db.update(userRequests)
        .set({
          openclawStatus: handoff.status,
          openclawThreadId: handoff.threadId ?? detail.openclawThreadId,
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

    publishAdminRequestsRefresh({ requestId, reason: 'admin_reply_created' });
    publishRequestsRefresh({ pharmacyId: detail.pharmacyId, requestId, reason: 'admin_reply_created' });
    await createNotification({
      pharmacyId: detail.pharmacyId,
      type: 'request_update',
      title: '要望に管理者から返信がありました',
      message: body || '添付ファイル付きの返信が届きました。内容をご確認ください。',
      referenceType: 'request',
      referenceId: requestId,
      detailJson: {
        source: 'admin_reply',
        messageId: recorded.id,
      },
    });

    res.json({
      message: '管理者返信を送信しました',
      nextStep: handoff.note,
      handoff,
    });
  } catch (err) {
    handleAdminError(err, 'Admin user request reply error', '管理者返信の送信に失敗しました', res);
  }
});

router.post('/user-requests/:id/internal-notes', async (req: AuthRequest, res: Response) => {
  try {
    const requestId = parsePositiveInt(req.params.id);
    if (!requestId) {
      res.status(400).json({ error: '要望IDが不正です' });
      return;
    }

    const detail = await getAdminRequestDetail(requestId);
    if (!detail) {
      res.status(404).json({ error: '要望が見つかりません' });
      return;
    }

    const body = typeof req.body.body === 'string' ? req.body.body.trim() : '';
    if (!body || body.length > 2000) {
      res.status(400).json({ error: '内部メモは1〜2000文字で入力してください' });
      return;
    }

    const note = await addRequestInternalNote(requestId, req.user!.id, body);
    publishAdminRequestsRefresh({ requestId, reason: 'internal_note_created' });
    res.status(201).json({ note });
  } catch (err) {
    handleAdminError(err, 'Admin user request internal note error', '内部メモの保存に失敗しました', res);
  }
});

router.get('/user-requests/:id/messages', async (req: AuthRequest, res: Response) => {
  try {
    const requestId = parsePositiveInt(req.params.id);
    if (!requestId) {
      res.json({ data: [] });
      return;
    }

    const detail = await getAdminRequestDetail(requestId);
    if (!detail) {
      res.json({ data: [] });
      return;
    }

    await touchRequestViewed(requestId, 'admin');
    const messages = await listOpenClawRequestMessages(requestId);
    res.json({ data: messages });
  } catch (err) {
    handleAdminError(err, 'Admin user request messages error', '要望メッセージの取得に失敗しました', res);
  }
});

router.get('/user-requests/:id/events', async (req: AuthRequest, res: Response) => {
  try {
    const requestId = Number(req.params.id);
    if (!Number.isInteger(requestId) || requestId <= 0) {
      res.json({ events: [] });
      return;
    }
    const events = await listRequestEventTimeline(requestId);
    res.json({ events });
  } catch (err) {
    handleAdminError(err, 'Admin user request events error', 'タイムラインの取得に失敗しました', res);
  }
});

router.get('/user-requests/attachments/:attachmentId', async (req: AuthRequest, res: Response) => {
  try {
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

    res.setHeader('Content-Type', attachment.mimeType);
    res.setHeader('Content-Length', String(attachment.fileSize));
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`);
    res.send(attachment.content);
  } catch (err) {
    handleAdminError(err, 'Admin user request attachment error', '添付ファイルの取得に失敗しました', res);
  }
});

export default router;
