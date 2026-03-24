import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import {
  claimNextDdsJob,
  heartbeatDdsAgent,
  postDdsQuestion,
  registerDdsAgent,
  reportDdsPullRequest,
} from '../services/dds-agent-service';
import { logger } from '../services/logger';
import { parsePositiveInt } from '../utils/request-utils';

const router = Router();

const connectLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'リクエストが多すぎます。時間をおいて再試行してください' },
});

function extractBearerToken(req: Request): string | null {
  const header = req.header('authorization');
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return match ? match[1] : null;
}

function requireControlToken(req: Request, res: Response): string | null {
  const token = extractBearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'Authorization ヘッダーが必要です' });
    return null;
  }
  return token;
}

// POST /register — bootstrap token を使って DDS エージェントを登録
router.post('/register', connectLimiter, async (req: Request, res: Response) => {
  try {
    const bootstrapToken = typeof req.body?.bootstrapToken === 'string' ? req.body.bootstrapToken.trim() : '';
    const agentId = typeof req.body?.agentId === 'string' ? req.body.agentId.trim() : '';
    const agentName = typeof req.body?.agentName === 'string' ? req.body.agentName.trim() : '';

    if (!bootstrapToken) {
      res.status(400).json({ error: 'bootstrapToken が必要です' });
      return;
    }
    if (!agentId) {
      res.status(400).json({ error: 'agentId が必要です' });
      return;
    }
    if (!agentName) {
      res.status(400).json({ error: 'agentName が必要です' });
      return;
    }

    const result = await registerDdsAgent({
      bootstrapToken,
      agentId,
      agentName,
      deviceLabel: typeof req.body?.deviceLabel === 'string' ? req.body.deviceLabel : null,
      openclawVersion: typeof req.body?.openclawVersion === 'string' ? req.body.openclawVersion : null,
    });

    res.status(201).json(result);
  } catch (err) {
    if (err instanceof Error && 'status' in err) {
      const status = (err as { status: number }).status;
      res.status(status).json({ error: err.message });
      return;
    }
    logger.error('openclaw-connect register error', { error: (err as Error).message });
    res.status(500).json({ error: 'エージェント登録に失敗しました' });
  }
});

// POST /jobs/claim — エージェントが次のジョブを取得
router.post('/jobs/claim', connectLimiter, async (req: Request, res: Response) => {
  try {
    const token = requireControlToken(req, res);
    if (!token) return;

    const job = await claimNextDdsJob(token);
    if (!job) {
      res.status(204).end();
      return;
    }

    res.json(job);
  } catch (err) {
    if (err instanceof Error && 'status' in err) {
      const status = (err as { status: number }).status;
      res.status(status).json({ error: err.message });
      return;
    }
    logger.error('openclaw-connect jobs/claim error', { error: (err as Error).message });
    res.status(500).json({ error: 'ジョブの取得に失敗しました' });
  }
});

// POST /heartbeat — エージェントのハートビート
router.post('/heartbeat', connectLimiter, async (req: Request, res: Response) => {
  try {
    const token = requireControlToken(req, res);
    if (!token) return;

    const payload = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
      ? (req.body as Record<string, unknown>)
      : undefined;

    await heartbeatDdsAgent(token, payload);
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && 'status' in err) {
      const status = (err as { status: number }).status;
      res.status(status).json({ error: err.message });
      return;
    }
    logger.error('openclaw-connect heartbeat error', { error: (err as Error).message });
    res.status(500).json({ error: 'ハートビートの処理に失敗しました' });
  }
});

// POST /work-items/:id/question — エージェントがユーザーへ質問を投稿
router.post('/work-items/:id/question', connectLimiter, async (req: Request, res: Response) => {
  try {
    const token = requireControlToken(req, res);
    if (!token) return;

    const workItemId = parsePositiveInt(req.params.id);
    if (!workItemId) {
      res.status(400).json({ error: 'work item ID が不正です' });
      return;
    }

    const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
    const leaseToken = typeof req.body?.leaseToken === 'string' ? req.body.leaseToken.trim() : '';
    if (!body) {
      res.status(400).json({ error: '質問本文が必要です' });
      return;
    }
    if (!leaseToken) {
      res.status(400).json({ error: 'leaseToken が必要です' });
      return;
    }

    await postDdsQuestion(token, workItemId, leaseToken, body.slice(0, 8000));
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && 'status' in err) {
      const status = (err as { status: number }).status;
      res.status(status).json({ error: err.message });
      return;
    }
    logger.error('openclaw-connect work-items question error', { error: (err as Error).message });
    res.status(500).json({ error: '質問の投稿に失敗しました' });
  }
});

// POST /work-items/:id/pr — エージェントがPR作成を報告
router.post('/work-items/:id/pr', connectLimiter, async (req: Request, res: Response) => {
  try {
    const token = requireControlToken(req, res);
    if (!token) return;

    const workItemId = parsePositiveInt(req.params.id);
    if (!workItemId) {
      res.status(400).json({ error: 'work item ID が不正です' });
      return;
    }

    const { branchName, prNumber, prUrl, summary } = req.body ?? {};
    const leaseToken = typeof req.body?.leaseToken === 'string' ? req.body.leaseToken.trim() : '';
    if (typeof branchName !== 'string' || !branchName.trim()) {
      res.status(400).json({ error: 'branchName が必要です' });
      return;
    }
    if (typeof prUrl !== 'string' || !prUrl.trim()) {
      res.status(400).json({ error: 'prUrl が必要です' });
      return;
    }
    if (!leaseToken) {
      res.status(400).json({ error: 'leaseToken が必要です' });
      return;
    }

    const parsedPrNumber = typeof prNumber === 'number' && Number.isFinite(prNumber) && prNumber > 0
      ? Math.floor(prNumber)
      : null;

    await reportDdsPullRequest(token, {
      workItemId,
      leaseToken,
      branchName: branchName.trim().slice(0, 255),
      prNumber: parsedPrNumber,
      prUrl: prUrl.trim().slice(0, 2000),
      summary: typeof summary === 'string' ? summary.trim().slice(0, 4000) : '',
    });
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && 'status' in err) {
      const status = (err as { status: number }).status;
      res.status(status).json({ error: err.message });
      return;
    }
    logger.error('openclaw-connect work-items pr error', { error: (err as Error).message });
    res.status(500).json({ error: 'PR 報告の処理に失敗しました' });
  }
});

export default router;
