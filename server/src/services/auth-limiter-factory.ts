import rateLimit from 'express-rate-limit';
import { createDistributedLimiter } from '../utils/distributed-rate-limiter';

export function createAuthLimiter(max: number, error: string, windowMs: number = 15 * 60 * 1000, keyPrefix: string = 'auth') {
  // Upstash Redis が設定されている場合は分散レート制限を使用（3省2ガイドライン準拠）
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    return createDistributedLimiter({
      max,
      windowMs,
      keyPrefix,
      errorMessage: error,
    });
  }
  return rateLimit({
    windowMs,
    max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error },
  });
}

// Auth limiters
export const registerLimiter = createAuthLimiter(5, '登録試行回数が上限に達しました。1時間後に再度お試しください', 60 * 60 * 1000, 'auth:register');
export const loginLimiter = createAuthLimiter(10, 'ログイン試行回数が上限に達しました。15分後に再度お試しください', 15 * 60 * 1000, 'auth:login');
export const passwordResetLimiter = createAuthLimiter(3, 'パスワードリセット試行回数が上限に達しました。1時間後に再度お試しください', 60 * 60 * 1000, 'auth:reset');
export const testPharmacyPreviewLimiter = createAuthLimiter(30, 'テスト薬局情報の取得回数が多すぎます。しばらくしてから再試行してください', 15 * 60 * 1000, 'auth:preview');
