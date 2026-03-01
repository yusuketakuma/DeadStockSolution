import { Router } from 'express';
import { requireLogin } from '../middleware/auth';
import { db } from '../config/database';
import { AuthRequest } from '../types';
import { parsePagination } from '../utils/request-utils';
import {
  getTimeline,
  getTimelineUnreadCount,
  markTimelineViewed,
  getSmartDigest,
} from '../services/timeline-service';
import type { TimelinePriority } from '../types/timeline';
import { handleRouteError } from '../middleware/error-handler';

const router = Router();

const VALID_PRIORITIES = new Set<string>(['critical', 'high', 'medium', 'low']);

// GET /api/timeline
// query: page, limit, priority (optional filter), since (optional ISO date)
// Response: { events: TimelineEvent[], total: number, page: number, limit: number, hasMore: boolean }
router.get('/', requireLogin, async (req, res) => {
  try {
    const authReq = req as AuthRequest;
    const pharmacyId = authReq.user!.id;
    const { page, limit } = parsePagination(req.query.page, req.query.limit, { defaultLimit: 20, maxLimit: 50 });
    const priorityParam = req.query.priority;
    const priority = typeof priorityParam === 'string' && VALID_PRIORITIES.has(priorityParam)
      ? (priorityParam as TimelinePriority)
      : undefined;
    const since = typeof req.query.since === 'string' ? req.query.since : undefined;

    const result = await getTimeline(db, pharmacyId, { page, limit, priority, since });
    res.json({ ...result, page, limit });
  } catch (err) {
    handleRouteError(err, 'タイムライン取得エラー', 'タイムラインの取得に失敗しました', res);
  }
});

// GET /api/timeline/unread-count
// Response: { unreadCount: number }
router.get('/unread-count', requireLogin, async (req, res) => {
  try {
    const authReq = req as AuthRequest;
    const pharmacyId = authReq.user!.id;
    const unreadCount = await getTimelineUnreadCount(db, pharmacyId);
    res.json({ unreadCount });
  } catch (err) {
    handleRouteError(err, 'タイムライン未読数取得エラー', 'タイムライン未読数の取得に失敗しました', res);
  }
});

// PATCH /api/timeline/mark-viewed
// Response: { success: true }
router.patch('/mark-viewed', requireLogin, async (req, res) => {
  try {
    const authReq = req as AuthRequest;
    const pharmacyId = authReq.user!.id;
    await markTimelineViewed(db, pharmacyId);
    res.json({ success: true });
  } catch (err) {
    handleRouteError(err, 'タイムライン閲覧済みマークエラー', 'タイムライン閲覧済みマークに失敗しました', res);
  }
});

// GET /api/timeline/digest
// Response: { events: TimelineEvent[] }
router.get('/digest', requireLogin, async (req, res) => {
  try {
    const authReq = req as AuthRequest;
    const pharmacyId = authReq.user!.id;
    const events = await getSmartDigest(db, pharmacyId);
    res.json({ events });
  } catch (err) {
    handleRouteError(err, 'タイムラインダイジェスト取得エラー', 'タイムラインダイジェストの取得に失敗しました', res);
  }
});

export default router;
