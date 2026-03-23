import { Router } from 'express';
import { AuthRequest } from '../types';
import { pollMessages, isRedisConfigured } from '../services/redis-pubsub-service';

const router = Router();

router.get('/events', async (req: AuthRequest, res) => {
  if (!isRedisConfigured()) {
    res.status(503).json({ error: 'SSE not available' });
    return;
  }

  const pharmacyId = req.user!.id;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  res.write(`event: connected\ndata: ${JSON.stringify({ pharmacyId })}\n\n`);

  const pollInterval = setInterval(async () => {
    try {
      let message = await pollMessages(pharmacyId);
      while (message) {
        res.write(`event: notification\ndata: ${message}\n\n`);
        message = await pollMessages(pharmacyId);
      }
    } catch { /* Redis 障害時は無視してポーリングを継続 */ }
  }, 2000);

  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 30000);

  req.on('close', () => {
    clearInterval(pollInterval);
    clearInterval(heartbeat);
    res.end();
  });
});

export default router;
