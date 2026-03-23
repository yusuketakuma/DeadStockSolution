import { Router, Response } from 'express';
import { AuthRequest } from '../types';
import { parseListPagination, sendPaginated, handleAdminError } from './admin-utils';
import { listUserRequests } from '../services/admin-user-request-service';
import { listRequestEventTimeline } from '../services/openclaw-request-event-service';
import { listRequestMessagesForUser } from '../services/dds-agent-service';
import { parsePositiveInt } from '../utils/request-utils';
import { db } from '../config/database';
import { userRequests } from '../db/schema';
import { eq } from 'drizzle-orm';

const router = Router();

const VALID_OPENCLAW_STATUSES = ['pending_handoff', 'in_dialogue', 'implementing', 'completed'] as const;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}/;

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

    const { data, total } = await listUserRequests({ page, limit, offset, status, pharmacyId, dateFrom, dateTo });
    sendPaginated(res, data, page, limit, total);
  } catch (err) {
    handleAdminError(err, 'Admin user requests list error', 'ユーザーリクエスト一覧の取得に失敗しました', res);
  }
});

// GET /admin/user-requests/:id/events — リクエストのステータス遷移タイムライン
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

router.get('/user-requests/:id/messages', async (req: AuthRequest, res: Response) => {
  try {
    const requestId = parsePositiveInt(req.params.id);
    if (!requestId) {
      res.json({ data: [] });
      return;
    }

    const [requestRow] = await db.select({
      pharmacyId: userRequests.pharmacyId,
    })
      .from(userRequests)
      .where(eq(userRequests.id, requestId))
      .limit(1);

    if (!requestRow) {
      res.json({ data: [] });
      return;
    }

    const messages = await listRequestMessagesForUser(requestId, requestRow.pharmacyId);
    res.json({ data: messages });
  } catch (err) {
    handleAdminError(err, 'Admin user request messages error', '要望メッセージの取得に失敗しました', res);
  }
});

export default router;
