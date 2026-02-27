import { afterEach, describe, expect, it, vi } from 'vitest';

const dnsLookupMock = vi.hoisted(() => vi.fn());

vi.mock('node:dns/promises', () => ({
  default: {
    lookup: dnsLookupMock,
  },
}));

import { assertExternalHttpsUrlSafe, validateExternalHttpsUrl } from '../utils/network-utils';

const ORIGINAL_ALLOWED_HOSTS = process.env.EXTERNAL_FETCH_ALLOWED_HOSTS;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

describe('network-utils validateExternalHttpsUrl', () => {
  afterEach(() => {
    if (typeof ORIGINAL_ALLOWED_HOSTS === 'string') {
      process.env.EXTERNAL_FETCH_ALLOWED_HOSTS = ORIGINAL_ALLOWED_HOSTS;
    } else {
      delete process.env.EXTERNAL_FETCH_ALLOWED_HOSTS;
    }

    if (typeof ORIGINAL_NODE_ENV === 'string') {
      process.env.NODE_ENV = ORIGINAL_NODE_ENV;
    } else {
      delete process.env.NODE_ENV;
    }
    dnsLookupMock.mockReset();
  });

  it('allows public https host when allowlist is not configured outside production', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.EXTERNAL_FETCH_ALLOWED_HOSTS;
    dnsLookupMock.mockResolvedValue([{ address: '93.184.216.34' }]);

    const result = await validateExternalHttpsUrl('https://example.com/file.csv');

    expect(result.ok).toBe(true);
    expect(result.hostname).toBe('example.com');
  });

  it('rejects host when allowlist is not configured in production', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.EXTERNAL_FETCH_ALLOWED_HOSTS;
    dnsLookupMock.mockResolvedValue([{ address: '93.184.216.34' }]);

    const result = await validateExternalHttpsUrl('https://example.com/file.csv');

    expect(result.ok).toBe(false);
    expect(result.reason).toContain('許可リスト');
  });

  it('rejects host not included in allowlist', async () => {
    process.env.EXTERNAL_FETCH_ALLOWED_HOSTS = 'trusted.example.com,*.allowed.example';
    dnsLookupMock.mockResolvedValue([{ address: '93.184.216.34' }]);

    const result = await validateExternalHttpsUrl('https://example.com/file.csv');

    expect(result.ok).toBe(false);
    expect(result.reason).toContain('許可リスト');
  });

  it('allows host matched by wildcard allowlist', async () => {
    process.env.EXTERNAL_FETCH_ALLOWED_HOSTS = '*.example.com';
    dnsLookupMock.mockResolvedValue([{ address: '93.184.216.34' }]);

    const result = await validateExternalHttpsUrl('https://download.example.com/master.csv');

    expect(result.ok).toBe(true);
  });

  it('does not allow apex domain when wildcard allowlist is used', async () => {
    process.env.EXTERNAL_FETCH_ALLOWED_HOSTS = '*.example.com';
    dnsLookupMock.mockResolvedValue([{ address: '93.184.216.34' }]);

    const result = await validateExternalHttpsUrl('https://example.com/master.csv');

    expect(result.ok).toBe(false);
    expect(result.reason).toContain('許可リスト');
  });

  it('still rejects private destinations even when hostname is allowlisted', async () => {
    process.env.EXTERNAL_FETCH_ALLOWED_HOSTS = '*.example.com';
    dnsLookupMock.mockResolvedValue([{ address: '10.0.0.5' }]);

    const result = await validateExternalHttpsUrl('https://download.example.com/master.csv');

    expect(result.ok).toBe(false);
    expect(result.reason).toContain('プライベート');
  });

  it('throws on unsafe URL with assert helper', async () => {
    process.env.EXTERNAL_FETCH_ALLOWED_HOSTS = '*.example.com';
    dnsLookupMock.mockResolvedValue([{ address: '127.0.0.1' }]);

    await expect(assertExternalHttpsUrlSafe('https://download.example.com/master.csv'))
      .rejects
      .toThrow('プライベート/ローカルIP');
  });
});
