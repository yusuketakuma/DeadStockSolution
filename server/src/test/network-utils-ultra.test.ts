import { afterEach, describe, expect, it, vi } from 'vitest';

const dnsLookupMock = vi.hoisted(() => vi.fn());

vi.mock('node:dns/promises', () => ({
  default: {
    lookup: dnsLookupMock,
  },
}));

import {
  assertExternalHttpsUrlSafe,
  createPinnedDnsAgent,
  validateExternalHttpsUrl,
} from '../utils/network-utils';

const ORIGINAL_ALLOWED_HOSTS = process.env.EXTERNAL_FETCH_ALLOWED_HOSTS;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

describe('network-utils-ultra', () => {
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

  // ── Invalid URL ──
  describe('invalid URL handling', () => {
    it('rejects invalid URL format', async () => {
      const result = await validateExternalHttpsUrl('not-a-url');
      expect(result.ok).toBe(false);
      expect(result.reason).toContain('URL形式が不正です');
      expect(result.hostname).toBeNull();
    });

    it('rejects http URLs', async () => {
      const result = await validateExternalHttpsUrl('http://example.com/file');
      expect(result.ok).toBe(false);
      expect(result.reason).toContain('HTTPSのみ');
    });
  });

  // ── Blocked hostnames ──
  describe('blocked hostnames', () => {
    it('rejects localhost', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.EXTERNAL_FETCH_ALLOWED_HOSTS;
      const result = await validateExternalHttpsUrl('https://localhost/file');
      expect(result.ok).toBe(false);
      expect(result.reason).toContain('ローカルドメイン');
    });

    it('rejects sub.localhost', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.EXTERNAL_FETCH_ALLOWED_HOSTS;
      const result = await validateExternalHttpsUrl('https://sub.localhost/file');
      expect(result.ok).toBe(false);
      expect(result.reason).toContain('ローカルドメイン');
    });

    it('rejects .local domains', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.EXTERNAL_FETCH_ALLOWED_HOSTS;
      const result = await validateExternalHttpsUrl('https://myhost.local/file');
      expect(result.ok).toBe(false);
      expect(result.reason).toContain('ローカルドメイン');
    });
  });

  // ── DNS resolution failure ──
  describe('DNS resolution', () => {
    it('rejects when DNS resolution fails', async () => {
      process.env.EXTERNAL_FETCH_ALLOWED_HOSTS = 'example.com';
      dnsLookupMock.mockRejectedValue(new Error('ENOTFOUND'));
      const result = await validateExternalHttpsUrl('https://example.com/file');
      expect(result.ok).toBe(false);
      expect(result.reason).toContain('ホスト名を解決できませんでした');
    });

    it('rejects when DNS returns empty results', async () => {
      process.env.EXTERNAL_FETCH_ALLOWED_HOSTS = 'example.com';
      dnsLookupMock.mockResolvedValue([]);
      const result = await validateExternalHttpsUrl('https://example.com/file');
      expect(result.ok).toBe(false);
      expect(result.reason).toContain('ホスト名の解決結果が空です');
    });

    it('skips DNS lookup when hostname is an IP address', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.EXTERNAL_FETCH_ALLOWED_HOSTS;
      const result = await validateExternalHttpsUrl('https://93.184.216.34/file');
      expect(result.ok).toBe(true);
      expect(dnsLookupMock).not.toHaveBeenCalled();
    });

    it('deduplicates DNS results', async () => {
      process.env.EXTERNAL_FETCH_ALLOWED_HOSTS = 'example.com';
      dnsLookupMock.mockResolvedValue([
        { address: '93.184.216.34' },
        { address: '93.184.216.34' },
      ]);
      const result = await validateExternalHttpsUrl('https://example.com/file');
      expect(result.ok).toBe(true);
      expect(result.resolvedAddresses).toHaveLength(1);
    });

    it('skips DNS records without address', async () => {
      process.env.EXTERNAL_FETCH_ALLOWED_HOSTS = 'example.com';
      dnsLookupMock.mockResolvedValue([
        { address: null },
        { address: '93.184.216.34' },
      ]);
      const result = await validateExternalHttpsUrl('https://example.com/file');
      expect(result.ok).toBe(true);
    });
  });

  // ── Private IPv4 addresses ──
  describe('private IPv4 detection', () => {
    const privateIps = [
      '0.0.0.1',    // 0.x.x.x
      '10.0.0.1',   // 10.x.x.x
      '127.0.0.1',  // loopback
      '169.254.1.1', // link-local
      '172.16.0.1',  // 172.16-31
      '172.31.255.255',
      '192.168.0.1', // 192.168
      '100.64.0.1',  // CGN
      '100.127.0.1',
      '224.0.0.1',   // multicast
      '255.255.255.255',
    ];

    for (const ip of privateIps) {
      it(`rejects private IPv4: ${ip}`, async () => {
        process.env.NODE_ENV = 'development';
        delete process.env.EXTERNAL_FETCH_ALLOWED_HOSTS;
        dnsLookupMock.mockResolvedValue([{ address: ip }]);
        const result = await validateExternalHttpsUrl('https://example.com/file');
        expect(result.ok).toBe(false);
        expect(result.reason).toContain('プライベート');
      });
    }

    it('allows public IPv4: 8.8.8.8', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.EXTERNAL_FETCH_ALLOWED_HOSTS;
      dnsLookupMock.mockResolvedValue([{ address: '8.8.8.8' }]);
      const result = await validateExternalHttpsUrl('https://example.com/file');
      expect(result.ok).toBe(true);
    });
  });

  // ── Private IPv6 addresses ──
  describe('private IPv6 detection', () => {
    it('rejects IPv6 loopback ::1', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.EXTERNAL_FETCH_ALLOWED_HOSTS;
      dnsLookupMock.mockResolvedValue([{ address: '::1' }]);
      const result = await validateExternalHttpsUrl('https://example.com/file');
      expect(result.ok).toBe(false);
    });

    it('rejects IPv6 unspecified ::', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.EXTERNAL_FETCH_ALLOWED_HOSTS;
      dnsLookupMock.mockResolvedValue([{ address: '::' }]);
      const result = await validateExternalHttpsUrl('https://example.com/file');
      expect(result.ok).toBe(false);
    });

    it('rejects unique-local fc00::', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.EXTERNAL_FETCH_ALLOWED_HOSTS;
      dnsLookupMock.mockResolvedValue([{ address: 'fc00::1' }]);
      const result = await validateExternalHttpsUrl('https://example.com/file');
      expect(result.ok).toBe(false);
    });

    it('rejects link-local fe80::', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.EXTERNAL_FETCH_ALLOWED_HOSTS;
      dnsLookupMock.mockResolvedValue([{ address: 'fe80::1' }]);
      const result = await validateExternalHttpsUrl('https://example.com/file');
      expect(result.ok).toBe(false);
    });

    it('rejects multicast ff00::', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.EXTERNAL_FETCH_ALLOWED_HOSTS;
      dnsLookupMock.mockResolvedValue([{ address: 'ff02::1' }]);
      const result = await validateExternalHttpsUrl('https://example.com/file');
      expect(result.ok).toBe(false);
    });

    it('rejects IPv4-mapped IPv6 with private IPv4', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.EXTERNAL_FETCH_ALLOWED_HOSTS;
      dnsLookupMock.mockResolvedValue([{ address: '::ffff:10.0.0.1' }]);
      const result = await validateExternalHttpsUrl('https://example.com/file');
      expect(result.ok).toBe(false);
    });

    it('allows public IPv6 address', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.EXTERNAL_FETCH_ALLOWED_HOSTS;
      dnsLookupMock.mockResolvedValue([{ address: '2001:db8::1' }]);
      const result = await validateExternalHttpsUrl('https://example.com/file');
      expect(result.ok).toBe(true);
    });

    it('treats malformed IPv6 as private (safety fallback)', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.EXTERNAL_FETCH_ALLOWED_HOSTS;
      // Invalid: more than one :: -- too many groups
      dnsLookupMock.mockResolvedValue([{ address: '::1::2::3' }]);
      const result = await validateExternalHttpsUrl('https://example.com/file');
      expect(result.ok).toBe(false);
    });

    it('treats non-IP string as private', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.EXTERNAL_FETCH_ALLOWED_HOSTS;
      dnsLookupMock.mockResolvedValue([{ address: 'not-an-ip' }]);
      const result = await validateExternalHttpsUrl('https://example.com/file');
      expect(result.ok).toBe(false);
    });
  });

  // ── assertExternalHttpsUrlSafe ──
  describe('assertExternalHttpsUrlSafe', () => {
    it('resolves for safe URLs', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.EXTERNAL_FETCH_ALLOWED_HOSTS;
      dnsLookupMock.mockResolvedValue([{ address: '93.184.216.34' }]);
      await expect(assertExternalHttpsUrlSafe('https://example.com/file')).resolves.toBeUndefined();
    });

    it('throws with hostname context when reason is present', async () => {
      const result = await validateExternalHttpsUrl('http://example.com/');
      expect(result.ok).toBe(false);
      await expect(assertExternalHttpsUrlSafe('http://example.com/')).rejects.toThrow('(example.com)');
    });

    it('throws without hostname when hostname is null', async () => {
      await expect(assertExternalHttpsUrlSafe('not-valid')).rejects.toThrow('URL形式が不正です');
    });
  });

  // ── createPinnedDnsAgent ──
  describe('createPinnedDnsAgent', () => {
    it('throws when no addresses are provided', () => {
      expect(() => createPinnedDnsAgent('example.com', [])).toThrow('at least one');
    });

    it('creates an agent with pinned addresses', () => {
      const agent = createPinnedDnsAgent('example.com', ['93.184.216.34']);
      expect(agent).toBeDefined();
    });

    it('deduplicates provided addresses', () => {
      const agent = createPinnedDnsAgent('example.com', ['1.2.3.4', '1.2.3.4', '5.6.7.8']);
      expect(agent).toBeDefined();
    });

    it('creates agent successfully with IPv6 addresses', () => {
      const agent = createPinnedDnsAgent('example.com', ['2001:db8::1']);
      expect(agent).toBeDefined();
    });

    it('creates agent with mixed IPv4 and IPv6', () => {
      const agent = createPinnedDnsAgent('example.com', ['93.184.216.34', '2001:db8::1']);
      expect(agent).toBeDefined();
    });
  });

  // ── Hostname policy (additional edge cases) ──
  describe('hostname policy edge cases', () => {
    it('allows exact match in allowlist', async () => {
      process.env.EXTERNAL_FETCH_ALLOWED_HOSTS = 'example.com';
      dnsLookupMock.mockResolvedValue([{ address: '93.184.216.34' }]);
      const result = await validateExternalHttpsUrl('https://example.com/file');
      expect(result.ok).toBe(true);
    });

    it('allows multiple hosts in comma-separated allowlist', async () => {
      process.env.EXTERNAL_FETCH_ALLOWED_HOSTS = 'a.com, b.com, c.com';
      dnsLookupMock.mockResolvedValue([{ address: '93.184.216.34' }]);
      const result = await validateExternalHttpsUrl('https://b.com/file');
      expect(result.ok).toBe(true);
    });

    it('rejects when allowlist is empty string', async () => {
      process.env.EXTERNAL_FETCH_ALLOWED_HOSTS = '';
      process.env.NODE_ENV = 'production';
      const result = await validateExternalHttpsUrl('https://example.com/file');
      expect(result.ok).toBe(false);
    });

    it('case-insensitive hostname matching', async () => {
      process.env.EXTERNAL_FETCH_ALLOWED_HOSTS = 'EXAMPLE.COM';
      dnsLookupMock.mockResolvedValue([{ address: '93.184.216.34' }]);
      const result = await validateExternalHttpsUrl('https://Example.COM/file');
      expect(result.ok).toBe(true);
    });
  });
});
