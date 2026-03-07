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
  if (raw === 'true') return true;
  if (raw === 'false') return false;

  const vercelEnv = env.VERCEL_ENV?.trim().toLowerCase();
  if (vercelEnv === 'preview') return true;

  return env.NODE_ENV !== 'production';
}
