import { describe, expect, it } from 'vitest';
import { resolveClientTestLoginFeatureEnabled } from '../features/testLoginFeature';

describe('resolveClientTestLoginFeatureEnabled', () => {
  it('defaults to enabled in non-production when env is unset', () => {
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

  it('enables by default on vercel preview builds', () => {
    expect(resolveClientTestLoginFeatureEnabled({
      MODE: 'production',
      VITE_VERCEL_ENV: 'preview',
    })).toBe(true);
  });

  it('stays enabled by default on production builds', () => {
    expect(resolveClientTestLoginFeatureEnabled({
      MODE: 'production',
      VITE_VERCEL_ENV: 'production',
    })).toBe(true);
  });

  it('keeps test login enabled across every environment unless explicitly disabled', () => {
    expect(resolveClientTestLoginFeatureEnabled({
      MODE: 'development',
      VITE_VERCEL_ENV: 'development',
    })).toBe(true);
    expect(resolveClientTestLoginFeatureEnabled({
      MODE: 'production',
      VITE_VERCEL_ENV: 'preview',
    })).toBe(true);
    expect(resolveClientTestLoginFeatureEnabled({
      MODE: 'production',
      VITE_VERCEL_ENV: 'production',
    })).toBe(true);
  });
});
