import { afterEach, describe, expect, it, vi } from 'vitest';
import { isCloudflareWorkersRuntime } from '../utils/runtime';

describe('isCloudflareWorkersRuntime', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('detects the workerd user agent', () => {
    vi.stubGlobal('navigator', { userAgent: 'Cloudflare-Workers' });
    expect(isCloudflareWorkersRuntime()).toBe(true);
  });

  it('returns false on Node.js', () => {
    vi.stubGlobal('navigator', { userAgent: 'Node.js/24' });
    expect(isCloudflareWorkersRuntime()).toBe(false);
    vi.stubGlobal('navigator', undefined);
    expect(isCloudflareWorkersRuntime()).toBe(false);
  });
});
