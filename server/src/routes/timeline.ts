import { Router } from 'express';
import { requireLogin } from '../middleware/auth';
import { db } from '../config/database';
import { AuthRequest } from '../types';
import { parsePositiveInt } from '../utils/request-utils';
import {
  getTimeline,
  getTimelineUnreadCount,
  markTimelineViewed,
  getSmartDigest,
} from '../services/timeline-service';
import type { TimelineCursor, TimelinePriority } from '../types/timeline';
import { handleRouteError } from '../middleware/error-handler';
import { decodeCursor } from '../utils/cursor-pagination';

const router = Router();

const VALID_PRIORITIES = new Set<string>(['critical', 'high', 'medium', 'low']);
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

function parseTimelineCursor(raw: unknown): TimelineCursor | null | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string' || raw.trim().length === 0) return null;

  const cursor = decodeCursor<TimelineCursor>(raw);
  if (!cursor) return null;
  if (typeof cursor.id !== 'string' || cursor.id.length === 0) return null;
  if (typeof cursor.timestamp !== 'string' || !Number.isFinite(Date.parse(cursor.timestamp))) return null;
  return cursor;
}

function parseTimelinePriority(raw: unknown): TimelinePriority | undefined {
  if (typeof raw !== 'string') return undefined;
  return VALID_PRIORITIES.has(raw) ? (raw as TimelinePriority) : undefined;
}

function parseTimelineLimit(raw: unknown): number {
  const parsedLimit = parsePositiveInt(raw);
  return Math.min(parsedLimit ?? DEFAULT_LIMIT, MAX_LIMIT);
}

// GET /api/timeline
// query: cursor, limit, priority (optional filter), since (optional ISO date)
// Response: { events: TimelineEvent[], total: number, hasMore: boolean, nextCursor: string | null, ... }
router.get('/', requireLogin, async (req, res) => {
  try {
    const authReq = req as AuthRequest;
    const pharmacyId = authReq.user!.id;
    const limit = parseTimelineLimit(req.query.limit);
    const priority = parseTimelinePriority(req.query.priority);
    const since = typeof req.query.since === 'string' ? req.query.since : undefined;
    const cursor = parseTimelineCursor(req.query.cursor);
    if (cursor === null) {
      res.status(400).json({ error: 'cursorが不正です' });
      return;
    }

    const result = await getTimeline(db, pharmacyId, { cursor, limit, priority, since });

    res.json({
      ...result,
      limit,
      pagination: {
        mode: 'cursor',
        limit,
        hasMore: result.hasMore,
        nextCursor: result.nextCursor ?? null,
      },
    });
  } catch (err) {
    handleRouteError(err, 'タイムライン取得エラー', 'タイムラインの取得に失敗しました', res);
  }
});

// GET /api/timeline/bootstrap
// query: limit, priority (optional), since (optional)
// Response: { timeline, digest, unreadCount }
router.get('/bootstrap', requireLogin, async (req, res) => {
  try {
    const authReq = req as AuthRequest;
    const pharmacyId = authReq.user!.id;
    const limit = parseTimelineLimit(req.query.limit);
    const priority = parseTimelinePriority(req.query.priority);
    const since = typeof req.query.since === 'string' ? req.query.since : undefined;

    const [timeline, digestEvents, unreadCount] = await Promise.all([
      getTimeline(db, pharmacyId, { limit, priority, since, cursor: undefined }),
      getSmartDigest(db, pharmacyId),
      getTimelineUnreadCount(db, pharmacyId),
    ]);

    res.json({
      timeline: {
        ...timeline,
        limit,
        pagination: {
          mode: 'cursor',
          limit,
          hasMore: timeline.hasMore,
          nextCursor: timeline.nextCursor ?? null,
        },
      },
      digest: { events: digestEvents },
      unreadCount,
    });
  } catch (err) {
    handleRouteError(err, 'タイムライン初期データ取得エラー', 'タイムライン初期データの取得に失敗しました', res);
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
