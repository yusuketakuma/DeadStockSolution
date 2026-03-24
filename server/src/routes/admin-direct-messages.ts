import { Router, Response } from 'express';
import { AuthRequest } from '../types';
import { normalizeSearchTerm, parsePositiveInt } from '../utils/request-utils';
import {
  getDirectMessageAttachmentDownload,
  getAdminDirectMessageThreadDetail,
  getAdminDirectMessageThreads,
  getThread,
} from '../services/messaging-service';
import { handleAdminError, parseListPagination, sendPaginated } from './admin-utils';

const router = Router();

router.get('/direct-messages/threads', async (req: AuthRequest, res: Response) => {
  try {
    const { page, limit } = parseListPagination(req);
    const search = normalizeSearchTerm(req.query.search);
    const result = await getAdminDirectMessageThreads(page, limit, search ?? null);
    sendPaginated(res, result.threads, page, limit, result.total);
  } catch (err) {
    handleAdminError(err, 'Admin direct message threads error', 'ユーザー間メッセージ一覧の取得に失敗しました', res);
  }
});

router.get('/direct-messages/thread', async (req: AuthRequest, res: Response) => {
  try {
    const pharmacyAId = parsePositiveInt(typeof req.query.pharmacyAId === 'string' ? req.query.pharmacyAId : undefined);
    const pharmacyBId = parsePositiveInt(typeof req.query.pharmacyBId === 'string' ? req.query.pharmacyBId : undefined);
    if (!pharmacyAId || !pharmacyBId || pharmacyAId === pharmacyBId) {
      res.status(400).json({ error: '薬局IDが不正です' });
      return;
    }

    const { page, limit } = parseListPagination(req, 50);
    const detail = await getAdminDirectMessageThreadDetail(pharmacyAId, pharmacyBId);
    if (!detail) {
      res.status(404).json({ error: '対象スレッドが見つかりません' });
      return;
    }

    const result = await getThread(detail.pharmacyAId, detail.pharmacyBId, page, limit);
    res.json({
      thread: detail,
      data: result.messages,
      pagination: {
        page,
        limit,
        total: result.total,
        totalPages: Math.ceil(result.total / limit),
      },
    });
  } catch (err) {
    handleAdminError(err, 'Admin direct message thread error', 'ユーザー間メッセージ履歴の取得に失敗しました', res);
  }
});

router.get('/direct-messages/attachments/:attachmentId', async (req: AuthRequest, res: Response) => {
  try {
    const attachmentId = parsePositiveInt(typeof req.params.attachmentId === 'string' ? req.params.attachmentId : undefined);
    if (!attachmentId) {
      res.status(400).json({ error: '添付IDが不正です' });
      return;
    }

    const attachment = await getDirectMessageAttachmentDownload(attachmentId);
    if (!attachment) {
      res.status(404).json({ error: '添付ファイルが見つかりません' });
      return;
    }

    res.setHeader('Content-Type', attachment.mimeType);
    res.setHeader('Content-Length', String(attachment.fileSize));
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`);
    res.send(attachment.content);
  } catch (err) {
    handleAdminError(err, 'Admin direct message attachment error', '添付ファイルの取得に失敗しました', res);
  }
});

export default router;
