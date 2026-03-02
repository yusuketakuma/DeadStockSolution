import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { requireLogin, requireAdmin } from '../middleware/auth';
import {
  isOpenClawWebhookConfigured,
  verifyOpenClawWebhookSignature,
  isOpenClawWebhookReplay,
  consumeOpenClawWebhookReplay,
  releaseOpenClawWebhookReplay,
} from '../services/openclaw-service';
import { executeCommand, listCommandHistory } from '../services/openclaw-command-service';
import { logger } from '../services/logger';
import { AuthRequest } from '../types';
import { handleAdminError, parseListPagination } from './admin-utils';

const router = Router();
const commandLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'リクエストが多すぎます。時間をおいて再試行してください' },
});

// POST / --- OpenClaw command reception (HMAC auth, not admin JWT)
router.post('/', commandLimiter, async (req: Request, res: Response) => {
  try {
    if (process.env.OPENCLAW_COMMANDS_ENABLED !== 'true') {
      res.status(503).json({ error: 'コマンド受信が無効です' });
      return;
    }

    if (!isOpenClawWebhookConfigured()) {
      res.status(503).json({ error: 'OpenClaw webhook が未設定です' });
      return;
    }

    const signature = req.header('x-openclaw-signature');
    const timestamp = req.header('x-openclaw-timestamp');
    const replayKey = { receivedSignature: signature, receivedTimestamp: timestamp };

    const isAuthorized = verifyOpenClawWebhookSignature({ ...replayKey, rawBody: req.rawBody });
    if (!isAuthorized) {
      res.status(401).json({ error: 'OpenClaw webhook 認証に失敗しました' });
      return;
    }

    if (isOpenClawWebhookReplay(replayKey)) {
      res.status(401).json({ error: 'OpenClaw webhook 認証に失敗しました' });
      return;
    }

    const replayAccepted = consumeOpenClawWebhookReplay(replayKey);
    if (!replayAccepted) {
      res.status(401).json({ error: 'OpenClaw webhook 認証に失敗しました' });
      return;
    }

    const { command, parameters, threadId, reason } = req.body;
    if (!command || typeof command !== 'string') {
      releaseOpenClawWebhookReplay(replayKey);
      res.status(400).json({ error: 'command フィールドが必要です' });
      return;
    }

    try {
      const result = await executeCommand({ command, parameters, threadId, reason }, signature!);
      const statusCode = result.status === 'rejected' ? 403 : result.status === 'failed' ? 500 : 200;
      res.status(statusCode).json(result);
    } catch (err) {
      releaseOpenClawWebhookReplay(replayKey);
      throw err;
    }
  } catch (err) {
    logger.error('OpenClaw command route error', { error: (err as Error).message });
    res.status(500).json({ error: 'コマンド処理に失敗しました' });
  }
});

// GET /history --- Admin command history (JWT admin auth)
router.get('/history', requireLogin, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { page, limit } = parseListPagination(req, 50);
    const offset = (page - 1) * limit;
    const commands = await listCommandHistory(limit, offset);
    res.json({ commands, limit, offset });
  } catch (err) {
    handleAdminError(err, 'OpenClaw command history error', 'コマンド履歴の取得に失敗しました', res);
  }
});

export default router;
