type TestLoginClientEnv = {
  readonly MODE?: string;
  readonly VITE_VERCEL_ENV?: string;
  readonly VITE_TEST_LOGIN_FEATURE_ENABLED?: string;
};

/**
 * Locked contract for login-screen test account shortcuts.
 * - explicit VITE_TEST_LOGIN_FEATURE_ENABLED=false disables
 * - production / preview / development を問わず既定で enabled
 * Do not reintroduce environment-based gating without explicit product approval.
 */
export function resolveClientTestLoginFeatureEnabled(env: TestLoginClientEnv): boolean {
  const raw = env.VITE_TEST_LOGIN_FEATURE_ENABLED?.trim().toLowerCase();
  if (raw === 'false') return false;
  return true;
}
