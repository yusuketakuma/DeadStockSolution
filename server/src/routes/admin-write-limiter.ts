import rateLimit from 'express-rate-limit';

export const adminWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: '管理系APIへのリクエストが多すぎます。しばらくして再試行してください' },
});

