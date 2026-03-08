import { Router, Response } from 'express';
import { AuthRequest } from '../types';
import * as alertReadService from '../services/alert-read-service';
import { predictiveAlertTypeValues } from '../db/schema';
import { logger } from '../services/logger';

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

// ── GET / — アラート一覧 ──────────────────────────────────

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const pharmacyId = req.user!.id;
    const resolved = parseResolved(req.query.resolved as string | undefined);
    const type = req.query.type as string | undefined;
    const offset = req.query.offset ? Number(req.query.offset) : 0;
    const limit = req.query.limit ? Number(req.query.limit) : 20;

    // alertType バリデーション
    if (type && !(predictiveAlertTypeValues as readonly string[]).includes(type)) {
      res.status(400).json({ error: `不正なアラートタイプです: ${type}` });
      return;
    }

    const result = await alertReadService.listAlerts(pharmacyId, {
      resolved,
      type: type as typeof predictiveAlertTypeValues[number] | undefined,
      offset,
      limit,
    });
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('List alerts error', { error: message });
    res.status(500).json({ error: message });
  }
});

// ── GET /stats — アラート統計 ──────────────────────────────────
// IMPORTANT: /stats は /:id より先に定義する（Express のルート順序）

router.get('/stats', async (req: AuthRequest, res: Response) => {
  try {
    const pharmacyId = req.user!.id;
    const result = await alertReadService.getAlertStats(pharmacyId);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Get alert stats error', { error: message });
    res.status(500).json({ error: message });
  }
});

// ── GET /:id — アラート詳細 ──────────────────────────────────

router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
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
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Get alert detail error', { error: message });
    res.status(500).json({ error: message });
  }
});

// ── PATCH /:id/resolve — アラート解決 ──────────────────────────────────

router.patch('/:id/resolve', async (req: AuthRequest, res: Response) => {
  try {
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
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Resolve alert error', { error: message });
    res.status(500).json({ error: message });
  }
});

export default router;
