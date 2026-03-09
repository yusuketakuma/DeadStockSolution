type TestLoginClientEnv = {
  readonly MODE?: string;
  readonly VITE_VERCEL_ENV?: string;
  readonly VITE_TEST_LOGIN_FEATURE_ENABLED?: string;
};

/**
 * Locked contract for login-screen test account shortcuts.
 * - explicit VITE_TEST_LOGIN_FEATURE_ENABLED wins
 * - Vercel preview defaults to enabled
 * - production build defaults to disabled
 * Changing this requires explicit product approval because preview UX depends on it.
 */
export function resolveClientTestLoginFeatureEnabled(env: TestLoginClientEnv): boolean {
  const raw = env.VITE_TEST_LOGIN_FEATURE_ENABLED?.trim().toLowerCase();
  if (raw === 'false') return false;

  // テスト薬局ログインは全環境で有効（production含む）
  return true;
}
