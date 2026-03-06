import { describe, expect, it } from 'vitest';
import { resolveClientTestLoginFeatureEnabled } from '../features/testLoginFeature';

describe('resolveClientTestLoginFeatureEnabled', () => {
  it('defaults to enabled when env is unset', () => {
    expect(resolveClientTestLoginFeatureEnabled({})).toBe(true);
  });

  it('stays enabled when explicit true is set', () => {
    expect(resolveClientTestLoginFeatureEnabled({
      VITE_TEST_LOGIN_FEATURE_ENABLED: 'true',
    })).toBe(true);
  });

  it('disables only when explicit false is set', () => {
    expect(resolveClientTestLoginFeatureEnabled({
      VITE_TEST_LOGIN_FEATURE_ENABLED: ' false ',
    })).toBe(false);
  });
});
