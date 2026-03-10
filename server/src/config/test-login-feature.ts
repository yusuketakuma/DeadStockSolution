type TestLoginEnv = {
  NODE_ENV?: string;
  VERCEL_ENV?: string;
  TEST_LOGIN_FEATURE_ENABLED?: string;
};

/**
 * Locked contract for test-login availability.
 * - explicit TEST_LOGIN_FEATURE_ENABLED=false disables
 * - production / preview / development を問わず既定で enabled
 * Do not reintroduce environment-based gating without explicit product approval.
 */
export function resolveServerTestLoginFeatureEnabled(env: TestLoginEnv = process.env as TestLoginEnv): boolean {
  const raw = env.TEST_LOGIN_FEATURE_ENABLED?.trim().toLowerCase();
  if (raw === 'false') return false;
  return true;
}
