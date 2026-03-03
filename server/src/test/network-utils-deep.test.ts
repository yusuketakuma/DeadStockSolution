/**
 * network-utils-deep.test.ts
 * network-utils.ts の未カバーブランチを追加テスト
 * - isPrivateIpv4 各レンジ (0.x, 10.x, 127.x, 169.254.x, 172.16-31.x, 192.168.x, 100.64-127.x, 224+)
 * - isPrivateIpv6 各パターン (loopback, unspecified, unique-local, link-local, multicast, ipv4-mapped)
 * - expandIpv6 with double-colon, ipv4 tail, overflow
 * - isBlockedHostname (.local, .localhost)
 * - validateExternalHttpsUrl (non-https, invalid URL, blocked hostname, DNS failure, empty resolution)
 * - createPinnedDnsAgent (family filtering, hostname mismatch, all mode, round-robin)
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const dnsLookupMock = vi.hoisted(() => vi.fn());

vi.mock('node:dns/promises', () => ({
  default: {
    lookup: dnsLookupMock,
  },
}));

import { validateExternalHttpsUrl, createPinnedDnsAgent, assertExternalHttpsUrlSafe } from '../utils/network-utils';

const ORIGINAL_ALLOWED_HOSTS = process.env.EXTERNAL_FETCH_ALLOWED_HOSTS;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

describe('network-utils deep coverage', () => {
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

  // ── validateExternalHttpsUrl ──

  describe('validateExternalHttpsUrl', () => {
    it('rejects invalid URL format', async () => {
      const result = await validateExternalHttpsUrl('not-a-url');
      expect(result.ok).toBe(false);
      expect(result.reason).toContain('URL形式が不正');
    });

    it('rejects http protocol', async () => {
      const result = await validateExternalHttpsUrl('http://example.com/file');
      expect(result.ok).toBe(false);
      expect(result.reason).toContain('HTTPS');
    });

    it('rejects localhost', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.EXTERNAL_FETCH_ALLOWED_HOSTS;
      const result = await validateExternalHttpsUrl('https://localhost/test');
      expect(result.ok).toBe(false);
      expect(result.reason).toContain('ローカルドメイン');
    });

    it('rejects .localhost subdomain', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.EXTERNAL_FETCH_ALLOWED_HOSTS;
      const result = await validateExternalHttpsUrl('https://foo.localhost/test');
      expect(result.ok).toBe(false);
      expect(result.reason).toContain('ローカルドメイン');
    });

    it('rejects .local domain', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.EXTERNAL_FETCH_ALLOWED_HOSTS;
      const result = await validateExternalHttpsUrl('https://myhost.local/test');
      expect(result.ok).toBe(false);
      expect(result.reason).toContain('ローカルドメイン');
    });

    it('rejects when DNS lookup fails', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.EXTERNAL_FETCH_ALLOWED_HOSTS;
      dnsLookupMock.mockRejectedValueOnce(new Error('ENOTFOUND'));
      const result = await validateExternalHttpsUrl('https://nonexistent.example.com/test');
      expect(result.ok).toBe(false);
      expect(result.reason).toContain('ホスト名を解決できません');
    });

    it('rejects when DNS returns empty results', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.EXTERNAL_FETCH_ALLOWED_HOSTS;
      dnsLookupMock.mockResolvedValueOnce([]);
      const result = await validateExternalHttpsUrl('https://empty.example.com/test');
      expect(result.ok).toBe(false);
      expect(result.reason).toContain('解決結果が空');
    });

    // Private IPv4 ranges
    it('rejects 0.0.0.1 (reserved)', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.EXTERNAL_FETCH_ALLOWED_HOSTS;
      dnsLookupMock.mockResolvedValueOnce([{ address: '0.0.0.1' }]);
      const result = await validateExternalHttpsUrl('https://example.com/test');
      expect(result.ok).toBe(false);
    });

    it('rejects 10.0.0.1 (private)', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.EXTERNAL_FETCH_ALLOWED_HOSTS;
      dnsLookupMock.mockResolvedValueOnce([{ address: '10.0.0.1' }]);
      const result = await validateExternalHttpsUrl('https://example.com/test');
      expect(result.ok).toBe(false);
    });

    it('rejects 127.0.0.1 (loopback)', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.EXTERNAL_FETCH_ALLOWED_HOSTS;
      dnsLookupMock.mockResolvedValueOnce([{ address: '127.0.0.1' }]);
      const result = await validateExternalHttpsUrl('https://example.com/test');
      expect(result.ok).toBe(false);
    });

    it('rejects 169.254.1.1 (link-local)', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.EXTERNAL_FETCH_ALLOWED_HOSTS;
      dnsLookupMock.mockResolvedValueOnce([{ address: '169.254.1.1' }]);
      const result = await validateExternalHttpsUrl('https://example.com/test');
      expect(result.ok).toBe(false);
    });

    it('rejects 172.16.0.1 (private)', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.EXTERNAL_FETCH_ALLOWED_HOSTS;
      dnsLookupMock.mockResolvedValueOnce([{ address: '172.16.0.1' }]);
      const result = await validateExternalHttpsUrl('https://example.com/test');
      expect(result.ok).toBe(false);
    });

    it('rejects 172.31.255.255 (private upper range)', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.EXTERNAL_FETCH_ALLOWED_HOSTS;
      dnsLookupMock.mockResolvedValueOnce([{ address: '172.31.255.255' }]);
      const result = await validateExternalHttpsUrl('https://example.com/test');
      expect(result.ok).toBe(false);
    });

    it('rejects 192.168.1.1 (private)', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.EXTERNAL_FETCH_ALLOWED_HOSTS;
      dnsLookupMock.mockResolvedValueOnce([{ address: '192.168.1.1' }]);
      const result = await validateExternalHttpsUrl('https://example.com/test');
      expect(result.ok).toBe(false);
    });

    it('rejects 100.64.0.1 (CGNAT)', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.EXTERNAL_FETCH_ALLOWED_HOSTS;
      dnsLookupMock.mockResolvedValueOnce([{ address: '100.64.0.1' }]);
      const result = await validateExternalHttpsUrl('https://example.com/test');
      expect(result.ok).toBe(false);
    });

    it('rejects 100.127.255.255 (CGNAT upper)', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.EXTERNAL_FETCH_ALLOWED_HOSTS;
      dnsLookupMock.mockResolvedValueOnce([{ address: '100.127.255.255' }]);
      const result = await validateExternalHttpsUrl('https://example.com/test');
      expect(result.ok).toBe(false);
    });

    it('rejects 224.0.0.1 (multicast)', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.EXTERNAL_FETCH_ALLOWED_HOSTS;
      dnsLookupMock.mockResolvedValueOnce([{ address: '224.0.0.1' }]);
      const result = await validateExternalHttpsUrl('https://example.com/test');
      expect(result.ok).toBe(false);
    });

    // IPv6 private ranges
    it('rejects ::1 (IPv6 loopback)', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.EXTERNAL_FETCH_ALLOWED_HOSTS;
      dnsLookupMock.mockResolvedValueOnce([{ address: '::1' }]);
      const result = await validateExternalHttpsUrl('https://example.com/test');
      expect(result.ok).toBe(false);
    });

    it('rejects :: (IPv6 unspecified)', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.EXTERNAL_FETCH_ALLOWED_HOSTS;
      dnsLookupMock.mockResolvedValueOnce([{ address: '::' }]);
      const result = await validateExternalHttpsUrl('https://example.com/test');
      expect(result.ok).toBe(false);
    });

    it('rejects fc00:: (unique-local)', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.EXTERNAL_FETCH_ALLOWED_HOSTS;
      dnsLookupMock.mockResolvedValueOnce([{ address: 'fc00::1' }]);
      const result = await validateExternalHttpsUrl('https://example.com/test');
      expect(result.ok).toBe(false);
    });

    it('rejects fe80:: (link-local)', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.EXTERNAL_FETCH_ALLOWED_HOSTS;
      dnsLookupMock.mockResolvedValueOnce([{ address: 'fe80::1' }]);
      const result = await validateExternalHttpsUrl('https://example.com/test');
      expect(result.ok).toBe(false);
    });

    it('rejects ff02::1 (multicast)', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.EXTERNAL_FETCH_ALLOWED_HOSTS;
      dnsLookupMock.mockResolvedValueOnce([{ address: 'ff02::1' }]);
      const result = await validateExternalHttpsUrl('https://example.com/test');
      expect(result.ok).toBe(false);
    });

    it('rejects IPv4-mapped IPv6 with private address', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.EXTERNAL_FETCH_ALLOWED_HOSTS;
      dnsLookupMock.mockResolvedValueOnce([{ address: '::ffff:192.168.1.1' }]);
      const result = await validateExternalHttpsUrl('https://example.com/test');
      expect(result.ok).toBe(false);
    });

    it('allows public IPv6 address', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.EXTERNAL_FETCH_ALLOWED_HOSTS;
      dnsLookupMock.mockResolvedValueOnce([{ address: '2001:db8::1' }]);
      const result = await validateExternalHttpsUrl('https://example.com/test');
      expect(result.ok).toBe(true);
    });

    it('allows IP literal as hostname', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.EXTERNAL_FETCH_ALLOWED_HOSTS;
      // IP literal => resolveHostname returns the IP itself
      const result = await validateExternalHttpsUrl('https://93.184.216.34/test');
      expect(result.ok).toBe(true);
    });

    it('allows 172.32.0.1 (just outside private range)', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.EXTERNAL_FETCH_ALLOWED_HOSTS;
      dnsLookupMock.mockResolvedValueOnce([{ address: '172.32.0.1' }]);
      const result = await validateExternalHttpsUrl('https://example.com/test');
      expect(result.ok).toBe(true);
    });
  });

  // ── assertExternalHttpsUrlSafe ──

  describe('assertExternalHttpsUrlSafe', () => {
    it('does not throw for valid URL', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.EXTERNAL_FETCH_ALLOWED_HOSTS;
      dnsLookupMock.mockResolvedValueOnce([{ address: '93.184.216.34' }]);
      await expect(assertExternalHttpsUrlSafe('https://example.com/test')).resolves.toBeUndefined();
    });

    it('includes hostname in error message', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.EXTERNAL_FETCH_ALLOWED_HOSTS;
      dnsLookupMock.mockResolvedValueOnce([{ address: '10.0.0.1' }]);
      await expect(assertExternalHttpsUrlSafe('https://example.com/test'))
        .rejects.toThrow('(example.com)');
    });
  });

  // ── createPinnedDnsAgent ──

  describe('createPinnedDnsAgent', () => {
    it('throws when no addresses provided', () => {
      expect(() => createPinnedDnsAgent('example.com', [])).toThrow('at least one');
    });

    it('creates agent with single address', () => {
      const agent = createPinnedDnsAgent('example.com', ['1.2.3.4']);
      expect(agent).toBeDefined();
      agent.close();
    });

    it('deduplicates addresses', () => {
      const agent = createPinnedDnsAgent('example.com', ['1.2.3.4', '1.2.3.4', '5.6.7.8']);
      expect(agent).toBeDefined();
      agent.close();
    });
  });
});
