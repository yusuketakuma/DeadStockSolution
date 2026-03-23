import { Router, Response } from 'express';
import { AuthRequest } from '../types';
import { requireLogin, requireAdmin } from '../middleware/auth';
import { adminWriteLimiter } from './admin-write-limiter';
import { handleAdminError } from './admin-utils';
import { parsePositiveInt } from '../utils/request-utils';
import {
  listExperiments,
  createExperiment,
  startExperiment,
  stopExperiment,
  getExperimentResults,
} from '../services/matching-experiment-service';

const router = Router();

// GET /api/admin/matching-experiments — 実験一覧
router.get('/matching-experiments', requireLogin, requireAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    const experiments = await listExperiments();
    res.json({ experiments });
  } catch (err) {
    handleAdminError(err, 'Admin matching experiments list error', '実験一覧の取得に失敗しました', res);
  }
});

// POST /api/admin/matching-experiments — 実験作成
router.post('/matching-experiments', requireLogin, requireAdmin, adminWriteLimiter, async (req: AuthRequest, res: Response) => {
  try {
    const { name, controlProfileId, treatmentProfileId, trafficPercentage } = req.body as Record<string, unknown>;

    if (typeof name !== 'string' || name.trim().length === 0) {
      res.status(400).json({ error: '実験名を指定してください' });
      return;
    }
    if (typeof controlProfileId !== 'number' || !Number.isInteger(controlProfileId) || controlProfileId <= 0) {
      res.status(400).json({ error: 'controlProfileId は正の整数で指定してください' });
      return;
    }
    if (typeof treatmentProfileId !== 'number' || !Number.isInteger(treatmentProfileId) || treatmentProfileId <= 0) {
      res.status(400).json({ error: 'treatmentProfileId は正の整数で指定してください' });
      return;
    }
    if (controlProfileId === treatmentProfileId) {
      res.status(400).json({ error: 'controlProfileId と treatmentProfileId は異なるプロファイルを指定してください' });
      return;
    }

    const parsedTraffic = trafficPercentage !== undefined
      ? Number(trafficPercentage)
      : 50;

    if (!Number.isInteger(parsedTraffic) || parsedTraffic < 0 || parsedTraffic > 100) {
      res.status(400).json({ error: 'trafficPercentage は 0 以上 100 以下の整数で指定してください' });
      return;
    }

    const experiment = await createExperiment({
      name: name.trim(),
      controlProfileId,
      treatmentProfileId,
      trafficPercentage: parsedTraffic,
    });

    res.status(201).json({ experiment });
  } catch (err) {
    handleAdminError(err, 'Admin matching experiment create error', '実験の作成に失敗しました', res);
  }
});

// PATCH /api/admin/matching-experiments/:id/start — 実験開始
router.patch('/matching-experiments/:id/start', requireLogin, requireAdmin, adminWriteLimiter, async (req: AuthRequest, res: Response) => {
  const id = parsePositiveInt(typeof req.params.id === 'string' ? req.params.id : undefined);
  if (!id) {
    res.status(400).json({ error: '不正なIDです' });
    return;
  }

  try {
    const experiment = await startExperiment(id);
    res.json({ experiment });
  } catch (err) {
    if (err instanceof Error && err.message.includes('既に実行中')) {
      res.status(409).json({ error: err.message });
      return;
    }
    if (err instanceof Error && err.message.includes('見つかりません')) {
      res.status(404).json({ error: err.message });
      return;
    }
    handleAdminError(err, 'Admin matching experiment start error', '実験の開始に失敗しました', res);
  }
});

// PATCH /api/admin/matching-experiments/:id/stop — 実験停止
router.patch('/matching-experiments/:id/stop', requireLogin, requireAdmin, adminWriteLimiter, async (req: AuthRequest, res: Response) => {
  const id = parsePositiveInt(typeof req.params.id === 'string' ? req.params.id : undefined);
  if (!id) {
    res.status(400).json({ error: '不正なIDです' });
    return;
  }

  try {
    const experiment = await stopExperiment(id);
    res.json({ experiment });
  } catch (err) {
    if (err instanceof Error && err.message.includes('見つかりません')) {
      res.status(404).json({ error: err.message });
      return;
    }
    handleAdminError(err, 'Admin matching experiment stop error', '実験の停止に失敗しました', res);
  }
});

// GET /api/admin/matching-experiments/:id/results — 実験結果
router.get('/matching-experiments/:id/results', requireLogin, requireAdmin, async (req: AuthRequest, res: Response) => {
  const id = parsePositiveInt(typeof req.params.id === 'string' ? req.params.id : undefined);
  if (!id) {
    res.status(400).json({ error: '不正なIDです' });
    return;
  }

  try {
    const results = await getExperimentResults(id);
    res.json({ results });
  } catch (err) {
    handleAdminError(err, 'Admin matching experiment results error', '実験結果の取得に失敗しました', res);
  }
});

export default router;
