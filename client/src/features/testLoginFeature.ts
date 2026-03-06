type TestLoginClientEnv = {
  readonly VITE_TEST_LOGIN_FEATURE_ENABLED?: string;
};

/**
 * Locked contract for login-screen test account shortcuts.
 * - unset defaults to enabled
 * - only explicit "false" disables the client UI
 * Changing this requires explicit product approval because preview UX depends on it.
 */
export function resolveClientTestLoginFeatureEnabled(env: TestLoginClientEnv): boolean {
  const raw = env.VITE_TEST_LOGIN_FEATURE_ENABLED?.trim().toLowerCase();
  return raw !== 'false';
}
