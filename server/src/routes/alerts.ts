import { Router } from 'express';
import { AuthRequest } from '../types';
import * as alertReadService from '../services/alert-read-service';
import type { AlertCursor } from '../services/alert-read-service';
import { predictiveAlertTypeValues } from '../db/schema';
import { parsePositiveInt } from '../utils/request-utils';
import { parseCursor } from '../utils/cursor-pagination';
import { wrapRoute } from '../middleware/wrap-route';

const router = Router();

// ── ヘルパー ──────────────────────────────────

function parseAlertId(value: string | string[] | undefined): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function parseResolved(value: string | string[] | undefined): boolean | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return undefined;
}

function parseAlertCursor(raw: unknown) {
  return parseCursor<AlertCursor>(raw, (c) =>
    typeof c.detectedAt === 'string' && Number.isFinite(Date.parse(c.detectedAt)),
  );
}

// ── GET / — アラート一覧 ──────────────────────────────────

router.get('/', wrapRoute<AuthRequest>(async (req, res) => {
  const pharmacyId = req.user!.id;
  const resolved = parseResolved(req.query.resolved as string | undefined);
  const type = (req.query.type ?? req.query.alertType) as string | undefined;
  const offset = parsePositiveInt(req.query.offset) ?? 0;
  const limit = parsePositiveInt(req.query.limit) ?? 20;

  // type バリデーション (`alertType` は後方互換 alias として受ける)
  if (type && !(predictiveAlertTypeValues as readonly string[]).includes(type)) {
    res.status(400).json({ error: `不正なアラートタイプです: ${type}` });
    return;
  }

  const cursor = parseAlertCursor(req.query.cursor);
  if (cursor === null) {
    res.status(400).json({ error: 'cursorが不正です' });
    return;
  }

  const result = await alertReadService.listAlerts(pharmacyId, {
    resolved,
    type: type as typeof predictiveAlertTypeValues[number] | undefined,
    offset,
    limit,
    cursor,
  });
  res.json(result);
}));

// ── GET /stats — アラート統計 ──────────────────────────────────
// IMPORTANT: /stats は /:id より先に定義する（Express のルート順序）

router.get('/stats', wrapRoute<AuthRequest>(async (req, res) => {
  const pharmacyId = req.user!.id;
  const result = await alertReadService.getAlertStats(pharmacyId);
  res.json(result);
}));

// ── GET /:id — アラート詳細 ──────────────────────────────────

router.get('/:id', wrapRoute<AuthRequest>(async (req, res) => {
  const alertId = parseAlertId(req.params.id);
  if (!alertId) {
    res.status(400).json({ error: '不正なIDです' });
    return;
  }

  const pharmacyId = req.user!.id;
  const result = await alertReadService.getAlertDetail(alertId, pharmacyId);
  if (!result) {
    res.status(404).json({ error: 'アラートが見つかりません' });
    return;
  }
  res.json(result);
}));

// ── PATCH /:id/resolve — アラート解決 ──────────────────────────────────

router.patch('/:id/resolve', wrapRoute<AuthRequest>(async (req, res) => {
  const alertId = parseAlertId(req.params.id);
  if (!alertId) {
    res.status(400).json({ error: '不正なIDです' });
    return;
  }

  const pharmacyId = req.user!.id;
  const result = await alertReadService.resolveAlert(alertId, pharmacyId);
  if (!result) {
    res.status(404).json({ error: 'アラートが見つかりません' });
    return;
  }
  res.json(result);
}));

export default router;
