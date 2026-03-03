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
  createPinnedDnsLookup,
  validateExternalHttpsUrl,
} from '../utils/network-utils';

const ORIGINAL_ALLOWED_HOSTS = process.env.EXTERNAL_FETCH_ALLOWED_HOSTS;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

describe('network-utils — additional coverage', () => {
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

  describe('validateExternalHttpsUrl', () => {
    it('rejects invalid URL', async () => {
      const result = await validateExternalHttpsUrl('not-a-url');

      expect(result.ok).toBe(false);
      expect(result.reason).toContain('URL形式');
      expect(result.hostname).toBeNull();
    });

    it('rejects HTTP protocol', async () => {
      const result = await validateExternalHttpsUrl('http://example.com/file.csv');

      expect(result.ok).toBe(false);
      expect(result.reason).toContain('HTTPS');
    });

    it('rejects localhost hostname', async () => {
      const result = await validateExternalHttpsUrl('https://localhost/file.csv');

      expect(result.ok).toBe(false);
      expect(result.reason).toContain('ローカルドメイン');
    });

    it('rejects .local hostname', async () => {
      const result = await validateExternalHttpsUrl('https://server.local/file.csv');

      expect(result.ok).toBe(false);
      expect(result.reason).toContain('ローカルドメイン');
    });

    it('rejects .localhost hostname', async () => {
      const result = await validateExternalHttpsUrl('https://sub.localhost/file.csv');

      expect(result.ok).toBe(false);
      expect(result.reason).toContain('ローカルドメイン');
    });

    it('rejects DNS resolution failure', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.EXTERNAL_FETCH_ALLOWED_HOSTS;
      dnsLookupMock.mockRejectedValue(new Error('ENOTFOUND'));

      const result = await validateExternalHttpsUrl('https://nonexistent.example.com/file.csv');

      expect(result.ok).toBe(false);
      expect(result.reason).toContain('ホスト名を解決');
    });

    it('rejects empty DNS resolution', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.EXTERNAL_FETCH_ALLOWED_HOSTS;
      dnsLookupMock.mockResolvedValue([]);

      const result = await validateExternalHttpsUrl('https://empty-dns.example.com/file.csv');

      expect(result.ok).toBe(false);
      expect(result.reason).toContain('解決結果が空');
    });

    it('allows IP address as hostname (bypasses DNS lookup)', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.EXTERNAL_FETCH_ALLOWED_HOSTS;

      const result = await validateExternalHttpsUrl('https://93.184.216.34/file.csv');

      expect(result.ok).toBe(true);
      expect(dnsLookupMock).not.toHaveBeenCalled();
    });

    it('rejects private IPv4 10.x', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.EXTERNAL_FETCH_ALLOWED_HOSTS;
      dnsLookupMock.mockResolvedValue([{ address: '10.0.0.1' }]);

      const result = await validateExternalHttpsUrl('https://internal.example.com/file.csv');

      expect(result.ok).toBe(false);
      expect(result.reason).toContain('プライベート');
    });

    it('rejects private IPv4 172.16.x', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.EXTERNAL_FETCH_ALLOWED_HOSTS;
      dnsLookupMock.mockResolvedValue([{ address: '172.16.0.1' }]);

      const result = await validateExternalHttpsUrl('https://internal.example.com/file.csv');

      expect(result.ok).toBe(false);
      expect(result.reason).toContain('プライベート');
    });

    it('rejects private IPv4 192.168.x', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.EXTERNAL_FETCH_ALLOWED_HOSTS;
      dnsLookupMock.mockResolvedValue([{ address: '192.168.1.1' }]);

      const result = await validateExternalHttpsUrl('https://internal.example.com/file.csv');

      expect(result.ok).toBe(false);
      expect(result.reason).toContain('プライベート');
    });

    it('rejects loopback IPv4 127.x', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.EXTERNAL_FETCH_ALLOWED_HOSTS;
      dnsLookupMock.mockResolvedValue([{ address: '127.0.0.1' }]);

      const result = await validateExternalHttpsUrl('https://loopback.example.com/file.csv');

      expect(result.ok).toBe(false);
      expect(result.reason).toContain('プライベート');
    });

    it('rejects link-local IPv4 169.254.x', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.EXTERNAL_FETCH_ALLOWED_HOSTS;
      dnsLookupMock.mockResolvedValue([{ address: '169.254.1.1' }]);

      const result = await validateExternalHttpsUrl('https://link-local.example.com/file.csv');

      expect(result.ok).toBe(false);
    });

    it('rejects CGNAT IPv4 100.64.x', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.EXTERNAL_FETCH_ALLOWED_HOSTS;
      dnsLookupMock.mockResolvedValue([{ address: '100.64.0.1' }]);

      const result = await validateExternalHttpsUrl('https://cgnat.example.com/file.csv');

      expect(result.ok).toBe(false);
    });

    it('rejects IPv6 loopback ::1', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.EXTERNAL_FETCH_ALLOWED_HOSTS;
      dnsLookupMock.mockResolvedValue([{ address: '::1' }]);

      const result = await validateExternalHttpsUrl('https://ipv6-loopback.example.com/file.csv');

      expect(result.ok).toBe(false);
      expect(result.reason).toContain('プライベート');
    });

    it('rejects IPv6 unique local fc00::', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.EXTERNAL_FETCH_ALLOWED_HOSTS;
      dnsLookupMock.mockResolvedValue([{ address: 'fc00::1' }]);

      const result = await validateExternalHttpsUrl('https://ula.example.com/file.csv');

      expect(result.ok).toBe(false);
    });

    it('rejects IPv6 link-local fe80::', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.EXTERNAL_FETCH_ALLOWED_HOSTS;
      dnsLookupMock.mockResolvedValue([{ address: 'fe80::1' }]);

      const result = await validateExternalHttpsUrl('https://link-local6.example.com/file.csv');

      expect(result.ok).toBe(false);
    });

    it('rejects IPv4-mapped IPv6 with private address', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.EXTERNAL_FETCH_ALLOWED_HOSTS;
      dnsLookupMock.mockResolvedValue([{ address: '::ffff:10.0.0.1' }]);

      const result = await validateExternalHttpsUrl('https://mapped.example.com/file.csv');

      expect(result.ok).toBe(false);
    });

    it('allows IPv4-mapped IPv6 with public address', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.EXTERNAL_FETCH_ALLOWED_HOSTS;
      dnsLookupMock.mockResolvedValue([{ address: '::ffff:93.184.216.34' }]);

      const result = await validateExternalHttpsUrl('https://mapped-public.example.com/file.csv');

      expect(result.ok).toBe(true);
    });

    it('rejects multicast IPv6 ff00::', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.EXTERNAL_FETCH_ALLOWED_HOSTS;
      dnsLookupMock.mockResolvedValue([{ address: 'ff02::1' }]);

      const result = await validateExternalHttpsUrl('https://multicast.example.com/file.csv');

      expect(result.ok).toBe(false);
    });

    it('rejects IPv4 0.x.x.x', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.EXTERNAL_FETCH_ALLOWED_HOSTS;
      dnsLookupMock.mockResolvedValue([{ address: '0.0.0.0' }]);

      const result = await validateExternalHttpsUrl('https://zero.example.com/file.csv');

      expect(result.ok).toBe(false);
    });

    it('rejects multicast IPv4 224+', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.EXTERNAL_FETCH_ALLOWED_HOSTS;
      dnsLookupMock.mockResolvedValue([{ address: '224.0.0.1' }]);

      const result = await validateExternalHttpsUrl('https://multicast4.example.com/file.csv');

      expect(result.ok).toBe(false);
    });

    it('allows multiple exact hosts in allowlist', async () => {
      process.env.EXTERNAL_FETCH_ALLOWED_HOSTS = 'a.example.com,b.example.com';
      dnsLookupMock.mockResolvedValue([{ address: '93.184.216.34' }]);

      const result = await validateExternalHttpsUrl('https://b.example.com/file.csv');

      expect(result.ok).toBe(true);
    });

    it('handles multiple resolved addresses (all public)', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.EXTERNAL_FETCH_ALLOWED_HOSTS;
      dnsLookupMock.mockResolvedValue([
        { address: '93.184.216.34' },
        { address: '93.184.216.35' },
      ]);

      const result = await validateExternalHttpsUrl('https://multi.example.com/file.csv');

      expect(result.ok).toBe(true);
      expect(result.resolvedAddresses).toHaveLength(2);
    });

    it('rejects when any resolved address is private', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.EXTERNAL_FETCH_ALLOWED_HOSTS;
      dnsLookupMock.mockResolvedValue([
        { address: '93.184.216.34' },
        { address: '10.0.0.1' },
      ]);

      const result = await validateExternalHttpsUrl('https://mixed.example.com/file.csv');

      expect(result.ok).toBe(false);
      expect(result.reason).toContain('プライベート');
    });
  });

  describe('assertExternalHttpsUrlSafe', () => {
    it('does not throw for safe URL', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.EXTERNAL_FETCH_ALLOWED_HOSTS;
      dnsLookupMock.mockResolvedValue([{ address: '93.184.216.34' }]);

      await expect(assertExternalHttpsUrlSafe('https://example.com/file.csv')).resolves.toBeUndefined();
    });

    it('throws with hostname in message for known host', async () => {
      await expect(assertExternalHttpsUrlSafe('https://localhost/file.csv'))
        .rejects.toThrow('localhost');
    });
  });

  describe('createPinnedDnsAgent', () => {
    it('throws when no addresses provided', () => {
      expect(() => createPinnedDnsAgent('example.com', []))
        .toThrow('at least one resolved address');
    });

    it('creates agent with valid addresses', () => {
      const agent = createPinnedDnsAgent('example.com', ['93.184.216.34']);

      expect(agent).toBeDefined();
    });

    it('deduplicates addresses', () => {
      const agent = createPinnedDnsAgent('example.com', ['93.184.216.34', '93.184.216.34']);

      expect(agent).toBeDefined();
    });
  });

  describe('createPinnedDnsLookup', () => {
    it('returns hostname mismatch error', async () => {
      const lookup = createPinnedDnsLookup('example.com', ['93.184.216.34']);
      await new Promise<void>((resolve) => {
        lookup('other.example.com', {}, (err) => {
          expect(err).toBeInstanceOf(Error);
          expect(err?.message).toContain('Hostname changed');
          resolve();
        });
      });
    });

    it('filters by family and errors when no address for family', async () => {
      const lookup = createPinnedDnsLookup('example.com', ['93.184.216.34']);
      await new Promise<void>((resolve) => {
        lookup('example.com', { family: 6 }, (err) => {
          expect(err).toBeInstanceOf(Error);
          expect(err?.message).toContain('No pinned address');
          resolve();
        });
      });
    });

    it('returns all addresses in lookup all mode', async () => {
      const lookup = createPinnedDnsLookup('example.com', ['93.184.216.34', '2001:db8::1']);
      await new Promise<void>((resolve) => {
        lookup('example.com', { all: true }, (err, addresses) => {
          expect(err).toBeNull();
          expect(Array.isArray(addresses)).toBe(true);
          expect((addresses as Array<{ address: string }>).map((a) => a.address)).toEqual([
            '93.184.216.34',
            '2001:db8::1',
          ]);
          resolve();
        });
      });
    });

    it('round-robins pinned addresses in single lookup mode', async () => {
      const lookup = createPinnedDnsLookup('example.com', ['93.184.216.34', '93.184.216.35']);
      const first = await new Promise<string>((resolve, reject) => {
        lookup('example.com', {}, (err, address) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(address as string);
        });
      });
      const second = await new Promise<string>((resolve, reject) => {
        lookup('example.com', {}, (err, address) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(address as string);
        });
      });
      expect(first).toBe('93.184.216.34');
      expect(second).toBe('93.184.216.35');
    });
  });
});
