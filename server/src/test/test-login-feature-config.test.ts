import { describe, expect, it } from 'vitest';
import { resolveServerTestLoginFeatureEnabled } from '../config/test-login-feature';

describe('resolveServerTestLoginFeatureEnabled', () => {
  it('enables when explicit flag is true', () => {
    expect(resolveServerTestLoginFeatureEnabled({
      NODE_ENV: 'production',
      VERCEL_ENV: 'production',
      TEST_LOGIN_FEATURE_ENABLED: 'true',
    })).toBe(true);
  });

  it('disables when explicit flag is false', () => {
    expect(resolveServerTestLoginFeatureEnabled({
      NODE_ENV: 'development',
      VERCEL_ENV: 'preview',
      TEST_LOGIN_FEATURE_ENABLED: 'false',
    })).toBe(false);
  });

  it('defaults to enabled on vercel preview', () => {
    expect(resolveServerTestLoginFeatureEnabled({
      NODE_ENV: 'production',
      VERCEL_ENV: 'preview',
    })).toBe(true);
  });

  it('defaults to disabled on vercel production', () => {
    expect(resolveServerTestLoginFeatureEnabled({
      NODE_ENV: 'production',
      VERCEL_ENV: 'production',
    })).toBe(false);
  });

  it('defaults to disabled on plain production without vercel env', () => {
    expect(resolveServerTestLoginFeatureEnabled({
      NODE_ENV: 'production',
    })).toBe(false);
  });

  it('defaults to enabled outside production', () => {
    expect(resolveServerTestLoginFeatureEnabled({
      NODE_ENV: 'development',
    })).toBe(true);
  });
});
