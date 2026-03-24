import { Router, Response } from 'express';
import { requireLogin } from '../middleware/auth';
import type { AuthRequest } from '../types';
import {
  initRealtimeInfrastructure,
  isRealtimeTopic,
  subscribeRealtimeClient,
  type RealtimeTopic,
} from '../services/realtime-service';

const router = Router();

router.use(requireLogin);

function parseRealtimeTopics(rawValue: unknown): RealtimeTopic[] | null {
  const rawTopics = Array.isArray(rawValue)
    ? rawValue.flatMap((value) => String(value).split(','))
    : String(rawValue ?? '').split(',');

  const topics = rawTopics
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  if (topics.length === 0) {
    return ['timeline'];
  }

  if (!topics.every(isRealtimeTopic)) {
    return null;
  }

  return Array.from(new Set(topics));
}

router.get('/stream', async (req: AuthRequest, res: Response) => {
  const topics = parseRealtimeTopics(req.query.topics);
  if (!topics) {
    res.status(400).json({ error: 'topics が不正です' });
    return;
  }

  if ((topics.includes('admin_requests') || topics.includes('admin_messages')) && !req.user?.isAdmin) {
    res.status(403).json({ error: '管理者権限が必要です' });
    return;
  }

  if (!req.user?.id) {
    res.status(401).json({ error: 'ログインが必要です' });
    return;
  }

  await initRealtimeInfrastructure();

  subscribeRealtimeClient({
    res,
    pharmacyId: req.user.id,
    isAdmin: req.user.isAdmin,
    topics,
  });
});

export default router;
