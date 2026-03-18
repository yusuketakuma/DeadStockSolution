// 3省2ガイドライン準拠: Vercel サーバーレス環境での分散レート制限
// Upstash Redis を使用してインスタンス間でカウンターを共有する
// UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN が未設定の場合はフォールバック（開発環境向け）

import type { Request, Response, NextFunction } from 'express';

interface UpstashRatelimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  reset: number;
}

interface DistributedLimiterOptions {
  max: number;
  windowMs: number;
  keyPrefix: string;
  errorMessage: string;
}

function getRedisClient() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;

  // Lazy import to avoid startup failures when Upstash is not configured
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Redis } = require('@upstash/redis') as typeof import('@upstash/redis');
    return new Redis({ url, token });
  } catch {
    return null;
  }
}

function getRatelimit(max: number, windowMs: number, prefix: string) {
  const redis = getRedisClient();
  if (!redis) return null;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Ratelimit } = require('@upstash/ratelimit') as typeof import('@upstash/ratelimit');
    return new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(max, `${windowMs}ms`),
      prefix,
    });
  } catch {
    return null;
  }
}

// In-process fallback for dev/test environments without Upstash
const fallbackCounters = new Map<string, { count: number; resetAt: number }>();

function fallbackCheck(key: string, max: number, windowMs: number): UpstashRatelimitResult {
  const now = Date.now();
  const entry = fallbackCounters.get(key);

  if (!entry || now >= entry.resetAt) {
    fallbackCounters.delete(key); // 期限切れエントリを削除してメモリリークを防ぐ
    fallbackCounters.set(key, { count: 1, resetAt: now + windowMs });
    return { success: true, limit: max, remaining: max - 1, reset: now + windowMs };
  }

  entry.count += 1;
  const remaining = Math.max(0, max - entry.count);
  return {
    success: entry.count <= max,
    limit: max,
    remaining,
    reset: entry.resetAt,
  };
}

export function createDistributedLimiter(options: DistributedLimiterOptions) {
  const { max, windowMs, keyPrefix, errorMessage } = options;
  const ratelimit = getRatelimit(max, windowMs, keyPrefix);

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const ip = req.ip ?? 'unknown';
    const key = `${keyPrefix}:${ip}`;

    let result: UpstashRatelimitResult;
    if (ratelimit) {
      const upstashResult = await ratelimit.limit(key);
      result = {
        success: upstashResult.success,
        limit: upstashResult.limit,
        remaining: upstashResult.remaining,
        reset: upstashResult.reset,
      };
    } else {
      result = fallbackCheck(key, max, windowMs);
    }

    res.setHeader('RateLimit-Limit', result.limit);
    res.setHeader('RateLimit-Remaining', result.remaining);
    res.setHeader('RateLimit-Reset', Math.ceil(result.reset / 1000));

    if (!result.success) {
      res.status(429).json({ error: errorMessage });
      return;
    }

    next();
  };
}
