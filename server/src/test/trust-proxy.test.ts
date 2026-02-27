import { describe, expect, it } from 'vitest';
import { resolveTrustProxySetting } from '../utils/trust-proxy';

describe('resolveTrustProxySetting', () => {
  it('returns explicit true as hop=1', () => {
    expect(resolveTrustProxySetting({ TRUST_PROXY: 'true' } as NodeJS.ProcessEnv)).toBe(1);
  });

  it('returns explicit false when TRUST_PROXY=false', () => {
    expect(resolveTrustProxySetting({
      TRUST_PROXY: 'false',
      VERCEL: '1',
    } as NodeJS.ProcessEnv)).toBe(false);
  });

  it('returns explicit hop count when TRUST_PROXY is numeric', () => {
    expect(resolveTrustProxySetting({ TRUST_PROXY: '2' } as NodeJS.ProcessEnv)).toBe(2);
  });

  it('defaults to false outside Vercel when TRUST_PROXY is not set', () => {
    expect(resolveTrustProxySetting({} as NodeJS.ProcessEnv)).toBe(false);
  });

  it('defaults to hop=1 on Vercel when TRUST_PROXY is not set', () => {
    expect(resolveTrustProxySetting({ VERCEL: '1' } as NodeJS.ProcessEnv)).toBe(1);
    expect(resolveTrustProxySetting({ VERCEL_ENV: 'preview' } as NodeJS.ProcessEnv)).toBe(1);
  });

  it('falls back to Vercel default when TRUST_PROXY has invalid value', () => {
    expect(resolveTrustProxySetting({
      TRUST_PROXY: 'unexpected',
      VERCEL: '1',
    } as NodeJS.ProcessEnv)).toBe(1);
  });
});
