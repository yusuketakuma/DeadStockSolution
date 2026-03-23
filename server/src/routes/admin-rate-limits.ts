import { Router } from 'express';
import { requireLogin, requireAdmin } from '../middleware/auth';

const router = Router();
router.use(requireLogin);
router.use(requireAdmin);

interface RateLimiterConfig {
  name: string;
  windowMs: number;
  max: number;
  appliedTo: string[];
}

const RATE_LIMITER_CONFIGS: RateLimiterConfig[] = [
  {
    name: 'apiRateLimiter',
    windowMs: 15 * 60 * 1000,
    max: 1200,
    appliedTo: ['/api/*'],
  },
  {
    name: 'adminWriteLimiter',
    windowMs: 15 * 60 * 1000,
    max: 60,
    appliedTo: [
      '/api/admin/bulk-actions/parse-csv',
      '/api/admin/bulk-actions/execute',
    ],
  },
  {
    name: 'commentRateLimit',
    windowMs: 10 * 1000,
    max: 1,
    appliedTo: ['/api/exchange/proposals/:id/comments'],
  },
];

// GET /api/admin/rate-limits/config
router.get('/config', (_req, res) => {
  res.json({ limiters: RATE_LIMITER_CONFIGS });
});

export default router;
