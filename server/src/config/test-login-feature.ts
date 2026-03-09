type TestLoginEnv = {
  NODE_ENV?: string;
  VERCEL_ENV?: string;
  TEST_LOGIN_FEATURE_ENABLED?: string;
};

/**
 * Locked contract for test-login availability.
 * - explicit TEST_LOGIN_FEATURE_ENABLED wins
 * - Vercel preview defaults to enabled
 * - plain NODE_ENV=production defaults to disabled
 * Changing this requires explicit product approval because login UX depends on it.
 */
export function resolveServerTestLoginFeatureEnabled(env: TestLoginEnv = process.env as TestLoginEnv): boolean {
  const raw = env.TEST_LOGIN_FEATURE_ENABLED?.trim().toLowerCase();
  if (raw === 'false') return false;

  // テスト薬局ログインは全環境で有効（production含む）
  return true;
}
