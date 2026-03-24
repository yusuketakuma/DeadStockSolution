import { Router, Response } from 'express';
import { AuthRequest } from '../types';
import { requireLogin, rejectAdmin } from '../middleware/auth';
import { uploadOptionalAttachments } from '../middleware/attachment-upload';
import { normalizeSearchTerm, parsePagination } from '../utils/request-utils';
import { logger } from '../services/logger';
import { ApiError } from '../utils/api-error';
import {
  getDirectMessageAttachmentDownload,
  sendMessage,
  getThreads,
  getThread,
  markThreadRead,
  getUnreadCount,
  pharmacyExists,
} from '../services/messaging-service';
import {
  publishAdminMessagesRefresh,
  publishMessagesRefresh,
} from '../services/realtime-service';

const router = Router();

const MESSAGE_POST_MIN_INTERVAL_MS = 10_000;
const MESSAGE_MAX_BODY_LENGTH = 2000;

// In-memory rate limit tracker: key = `${fromId}:${toId}` → last sent timestamp
// Note: serverless 環境ではインスタンス間で共有されないため、
// 完全な制限には Redis ベースのレートリミッターが必要（既存 apiRateLimiter で補完）
const lastSentMap = new Map<string, number>();

function checkRateLimit(fromId: number, toId: number): void {
  const key = `${fromId}:${toId}`;
  const lastSent = lastSentMap.get(key);
  const now = Date.now();
  if (lastSent !== undefined) {
    const elapsed = now - lastSent;
    if (elapsed < MESSAGE_POST_MIN_INTERVAL_MS) {
      throw new ApiError(
        429,
        '短時間での連続送信はできません。少し待ってから送信してください。',
        'RATE_LIMIT',
      );
    }
  }
  lastSentMap.set(key, now);
}

function parseBodyText(raw: unknown, allowEmpty: boolean): string {
  const body = typeof raw === 'string' ? raw.trim() : '';
  if (!body && !allowEmpty) {
    throw new ApiError(400, 'メッセージ本文を入力してください', 'EMPTY_BODY');
  }
  if (body.length > MESSAGE_MAX_BODY_LENGTH) {
    throw new ApiError(
      400,
      `メッセージは${MESSAGE_MAX_BODY_LENGTH}文字以内で入力してください`,
      'BODY_TOO_LONG',
    );
  }
  return body;
}

function parsePharmacyId(raw: unknown): number | null {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

// POST / — メッセージ送信
router.post('/', requireLogin, rejectAdmin, uploadOptionalAttachments, async (req: AuthRequest, res: Response) => {
  try {
    const fromId = req.user!.id;
    const toId = parsePharmacyId(req.body?.toPharmacyId);
    const files = Array.isArray(req.files) ? req.files as Express.Multer.File[] : [];
    if (!toId) {
      res.status(400).json({ error: '宛先薬局IDが不正です' });
      return;
    }
    if (toId === fromId) {
      res.status(400).json({ error: '自分自身にはメッセージを送信できません' });
      return;
    }

    let body: string;
    try {
      body = parseBodyText(req.body?.body, files.length > 0);
    } catch (err) {
      if (err instanceof ApiError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      throw err;
    }

    // Verify recipient exists
    const exists = await pharmacyExists(toId);
    if (!exists) {
      res.status(404).json({ error: '宛先薬局が見つかりません' });
      return;
    }

    // Rate limit check
    try {
      checkRateLimit(fromId, toId);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'RATE_LIMIT') {
        res.setHeader('Retry-After', String(Math.ceil(MESSAGE_POST_MIN_INTERVAL_MS / 1000)));
        res.status(429).json({ error: err.message });
        return;
      }
      throw err;
    }

    const message = await sendMessage(fromId, toId, body, files);
    const pharmacyAId = Math.min(fromId, toId);
    const pharmacyBId = Math.max(fromId, toId);
    publishMessagesRefresh({
      pharmacyId: fromId,
      otherPharmacyId: toId,
      messageId: message.id,
      reason: 'message_sent',
    });
    publishMessagesRefresh({
      pharmacyId: toId,
      otherPharmacyId: fromId,
      messageId: message.id,
      reason: 'message_received',
    });
    publishAdminMessagesRefresh({
      pharmacyAId,
      pharmacyBId,
      messageId: message.id,
      reason: 'message_sent',
    });
    res.status(201).json({ message: 'メッセージを送信しました', data: message });
  } catch (err) {
    logger.error('Send message error', { error: (err as Error).message });
    res.status(500).json({ error: 'メッセージ送信に失敗しました' });
  }
});

// GET /threads — スレッド一覧
router.get('/threads', requireLogin, rejectAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const pharmacyId = req.user!.id;
    const search = normalizeSearchTerm(req.query.search);
    const threads = await getThreads(pharmacyId, search ?? null);
    res.json({ data: threads });
  } catch (err) {
    logger.error('Get threads error', { error: (err as Error).message });
    res.status(500).json({ error: 'スレッド一覧の取得に失敗しました' });
  }
});

// GET /thread/:pharmacyId — 特定薬局とのスレッド
router.get('/thread/:pharmacyId', requireLogin, rejectAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const myId = req.user!.id;
    const otherId = parsePharmacyId(req.params.pharmacyId);
    if (!otherId) {
      res.status(400).json({ error: '薬局IDが不正です' });
      return;
    }

    const { page, limit } = parsePagination(req.query.page, req.query.limit, {
      defaultLimit: 50,
      maxLimit: 200,
    });

    const result = await getThread(myId, otherId, page, limit);
    res.json({
      data: result.messages,
      pagination: {
        page,
        limit,
        total: result.total,
        totalPages: Math.ceil(result.total / limit),
      },
    });
  } catch (err) {
    logger.error('Get thread error', { error: (err as Error).message });
    res.status(500).json({ error: 'スレッドの取得に失敗しました' });
  }
});

// PATCH /thread/:pharmacyId/read — スレッド既読化
router.patch('/thread/:pharmacyId/read', requireLogin, rejectAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const myId = req.user!.id;
    const otherId = parsePharmacyId(req.params.pharmacyId);
    if (!otherId) {
      res.status(400).json({ error: '薬局IDが不正です' });
      return;
    }

    const markedCount = await markThreadRead(myId, otherId);
    if (markedCount > 0) {
      const pharmacyAId = Math.min(myId, otherId);
      const pharmacyBId = Math.max(myId, otherId);
      publishMessagesRefresh({
        pharmacyId: myId,
        otherPharmacyId: otherId,
        reason: 'thread_read',
      });
      publishMessagesRefresh({
        pharmacyId: otherId,
        otherPharmacyId: myId,
        reason: 'thread_read',
      });
      publishAdminMessagesRefresh({
        pharmacyAId,
        pharmacyBId,
        reason: 'thread_read',
      });
    }
    res.json({ markedCount });
  } catch (err) {
    logger.error('Mark thread read error', { error: (err as Error).message });
    res.status(500).json({ error: '既読化に失敗しました' });
  }
});

// GET /unread-count — 未読総数
router.get('/unread-count', requireLogin, rejectAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const pharmacyId = req.user!.id;
    const unreadCount = await getUnreadCount(pharmacyId);
    res.json({ unreadCount });
  } catch (err) {
    logger.error('Get unread count error', { error: (err as Error).message });
    res.status(500).json({ error: '未読数の取得に失敗しました' });
  }
});

router.get('/attachments/:attachmentId', requireLogin, rejectAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const attachmentId = parsePharmacyId(req.params.attachmentId);
    if (!attachmentId) {
      res.status(400).json({ error: '添付IDが不正です' });
      return;
    }

    const attachment = await getDirectMessageAttachmentDownload(attachmentId);
    if (!attachment) {
      res.status(404).json({ error: '添付ファイルが見つかりません' });
      return;
    }
    if (attachment.fromPharmacyId !== req.user!.id && attachment.toPharmacyId !== req.user!.id) {
      res.status(403).json({ error: 'この添付ファイルにはアクセスできません' });
      return;
    }

    res.setHeader('Content-Type', attachment.mimeType);
    res.setHeader('Content-Length', String(attachment.fileSize));
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`);
    res.send(attachment.content);
  } catch (err) {
    logger.error('Direct message attachment download error', { error: (err as Error).message });
    res.status(500).json({ error: '添付ファイルの取得に失敗しました' });
  }
});

export default router;
