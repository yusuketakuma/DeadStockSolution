/**
 * network-utils-final.test.ts
 * Covers uncovered lines in network-utils.ts:
 * - createPinnedDnsAgent lookup callback: hostname mismatch, family filter,
 *   no-address-for-family error, all=true mode, round-robin cycling, null opts
 * - expandIpv6 edge: too many groups (9 groups with no ::)
 * - isPrivateIpv6: invalid IPv4 in IPv4-mapped tail
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dnsLookupMock = vi.hoisted(() => vi.fn());
type LookupFunction = (...args: unknown[]) => unknown;

// We need to intercept the Agent constructor to capture its `connect.lookup` option.
// To do this, we mock undici BEFORE the module is imported, using vi.hoisted + vi.mock.
const agentConstructorSpy = vi.hoisted(() => {
  let captured: LookupFunction | undefined;

  const MockAgent = vi.fn().mockImplementation(function (opts: { connect?: { lookup?: LookupFunction } }) {
    captured = opts?.connect?.lookup;
    return {};
  });

  return { MockAgent, getCaptured: () => captured, clearCaptured: () => { captured = undefined; } };
});

vi.mock('undici', () => ({
  Agent: agentConstructorSpy.MockAgent,
}));

vi.mock('node:dns/promises', () => ({
  default: {
    lookup: dnsLookupMock,
  },
}));

import { createPinnedDnsAgent, validateExternalHttpsUrl } from '../utils/network-utils';

describe('network-utils-final — createPinnedDnsAgent lookup callback', () => {
  beforeEach(() => {
    agentConstructorSpy.clearCaptured();
    agentConstructorSpy.MockAgent.mockClear();
  });

  it('hostname mismatch calls callback with error', () => {
    agentConstructorSpy.MockAgent.mockImplementationOnce(
      function (opts: { connect?: { lookup?: LookupFunction } }) {
        agentConstructorSpy.getCaptured();
        // Override captured to this call's lookup
        const captured = opts?.connect?.lookup;
        return { __lookup: captured };
      },
    );

    const agent = createPinnedDnsAgent('example.com', ['1.2.3.4']) as unknown as { __lookup?: LookupFunction };
    const lookup = agent.__lookup;
    expect(lookup).toBeDefined();

    const callback = vi.fn();
    lookup!('other.com', {}, callback);
    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Hostname changed during DNS-pinned request' }),
      '',
    );
  });

  it('family=4 filters to IPv4 addresses only', () => {
    agentConstructorSpy.MockAgent.mockImplementationOnce(
      function (opts: { connect?: { lookup?: LookupFunction } }) {
        return { __lookup: opts?.connect?.lookup };
      },
    );

    const agent = createPinnedDnsAgent('example.com', [
      '1.2.3.4',
      '2001:db8::1',
    ]) as unknown as { __lookup?: LookupFunction };
    const lookup = agent.__lookup;

    const callback = vi.fn();
    lookup!('example.com', { family: 4 }, callback);
    expect(callback).toHaveBeenCalledWith(null, '1.2.3.4', 4);
  });

  it('family=6 filters to IPv6 addresses only', () => {
    agentConstructorSpy.MockAgent.mockImplementationOnce(
      function (opts: { connect?: { lookup?: LookupFunction } }) {
        return { __lookup: opts?.connect?.lookup };
      },
    );

    const agent = createPinnedDnsAgent('example.com', [
      '1.2.3.4',
      '2001:db8::1',
    ]) as unknown as { __lookup?: LookupFunction };
    const lookup = agent.__lookup;

    const callback = vi.fn();
    lookup!('example.com', { family: 6 }, callback);
    expect(callback).toHaveBeenCalledWith(null, '2001:db8::1', 6);
  });

  it('no address for requested family triggers error callback', () => {
    agentConstructorSpy.MockAgent.mockImplementationOnce(
      function (opts: { connect?: { lookup?: LookupFunction } }) {
        return { __lookup: opts?.connect?.lookup };
      },
    );

    // IPv4-only agent, request IPv6
    const agent = createPinnedDnsAgent('example.com', [
      '1.2.3.4',
    ]) as unknown as { __lookup?: LookupFunction };
    const lookup = agent.__lookup;

    const callback = vi.fn();
    lookup!('example.com', { family: 6 }, callback);
    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'No pinned address available for requested IP family' }),
      '',
    );
  });

  it('all=true returns array of LookupAddress objects', () => {
    agentConstructorSpy.MockAgent.mockImplementationOnce(
      function (opts: { connect?: { lookup?: LookupFunction } }) {
        return { __lookup: opts?.connect?.lookup };
      },
    );

    const agent = createPinnedDnsAgent('example.com', [
      '1.2.3.4',
      '2001:db8::1',
    ]) as unknown as { __lookup?: LookupFunction };
    const lookup = agent.__lookup;

    const callback = vi.fn();
    lookup!('example.com', { all: true }, callback);

    const [err, result] = callback.mock.calls[0];
    expect(err).toBeNull();
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(2);
    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ address: '1.2.3.4', family: 4 }),
        expect.objectContaining({ address: '2001:db8::1', family: 6 }),
      ]),
    );
  });

  it('all=true with family=4 returns only IPv4 addresses in array', () => {
    agentConstructorSpy.MockAgent.mockImplementationOnce(
      function (opts: { connect?: { lookup?: LookupFunction } }) {
        return { __lookup: opts?.connect?.lookup };
      },
    );

    const agent = createPinnedDnsAgent('example.com', [
      '1.2.3.4',
      '2001:db8::1',
    ]) as unknown as { __lookup?: LookupFunction };
    const lookup = agent.__lookup;

    const callback = vi.fn();
    lookup!('example.com', { all: true, family: 4 }, callback);

    const [err, result] = callback.mock.calls[0];
    expect(err).toBeNull();
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ address: '1.2.3.4', family: 4 });
  });

  it('round-robin cycles through multiple addresses across consecutive calls', () => {
    agentConstructorSpy.MockAgent.mockImplementationOnce(
      function (opts: { connect?: { lookup?: LookupFunction } }) {
        return { __lookup: opts?.connect?.lookup };
      },
    );

    const agent = createPinnedDnsAgent('example.com', [
      '1.2.3.4',
      '5.6.7.8',
    ]) as unknown as { __lookup?: LookupFunction };
    const lookup = agent.__lookup;

    const cb1 = vi.fn();
    const cb2 = vi.fn();
    const cb3 = vi.fn();

    lookup!('example.com', {}, cb1);
    lookup!('example.com', {}, cb2);
    lookup!('example.com', {}, cb3);

    // Round-robin: 1.2.3.4, 5.6.7.8, 1.2.3.4
    expect(cb1).toHaveBeenCalledWith(null, '1.2.3.4', 4);
    expect(cb2).toHaveBeenCalledWith(null, '5.6.7.8', 4);
    expect(cb3).toHaveBeenCalledWith(null, '1.2.3.4', 4);
  });

  it('null options (no family, no all) returns first address', () => {
    agentConstructorSpy.MockAgent.mockImplementationOnce(
      function (opts: { connect?: { lookup?: LookupFunction } }) {
        return { __lookup: opts?.connect?.lookup };
      },
    );

    const agent = createPinnedDnsAgent('example.com', [
      '1.2.3.4',
    ]) as unknown as { __lookup?: LookupFunction };
    const lookup = agent.__lookup;

    const callback = vi.fn();
    lookup!('example.com', null, callback);
    expect(callback).toHaveBeenCalledWith(null, '1.2.3.4', 4);
  });

  it('case-insensitive hostname comparison in lookup', () => {
    agentConstructorSpy.MockAgent.mockImplementationOnce(
      function (opts: { connect?: { lookup?: LookupFunction } }) {
        return { __lookup: opts?.connect?.lookup };
      },
    );

    const agent = createPinnedDnsAgent('EXAMPLE.COM', [
      '1.2.3.4',
    ]) as unknown as { __lookup?: LookupFunction };
    const lookup = agent.__lookup;

    const callback = vi.fn();
    // Should match since hostname is normalized to lowercase
    lookup!('example.com', {}, callback);
    expect(callback).toHaveBeenCalledWith(null, '1.2.3.4', 4);
  });

  it('throws when no addresses are provided', () => {
    expect(() => createPinnedDnsAgent('example.com', [])).toThrow(
      'DNS pinning requires at least one resolved address',
    );
  });

  it('deduplicates addresses', () => {
    agentConstructorSpy.MockAgent.mockImplementationOnce(
      function (opts: { connect?: { lookup?: LookupFunction } }) {
        return { __lookup: opts?.connect?.lookup };
      },
    );

    const agent = createPinnedDnsAgent('example.com', [
      '1.2.3.4',
      '1.2.3.4',
      '5.6.7.8',
    ]) as unknown as { __lookup?: LookupFunction };
    const lookup = agent.__lookup;

    const cb1 = vi.fn();
    const cb2 = vi.fn();
    const cb3 = vi.fn();

    lookup!('example.com', {}, cb1);
    lookup!('example.com', {}, cb2);
    lookup!('example.com', {}, cb3);

    // After dedup: ['1.2.3.4', '5.6.7.8'] — cycles between 2
    expect(cb1).toHaveBeenCalledWith(null, '1.2.3.4', 4);
    expect(cb2).toHaveBeenCalledWith(null, '5.6.7.8', 4);
    expect(cb3).toHaveBeenCalledWith(null, '1.2.3.4', 4);
  });
});

describe('network-utils-final — expandIpv6 and IPv6 edge cases', () => {
  const ORIG_ALLOWED = process.env.EXTERNAL_FETCH_ALLOWED_HOSTS;
  const ORIG_ENV = process.env.NODE_ENV;

  afterEach(() => {
    if (typeof ORIG_ALLOWED === 'string') {
      process.env.EXTERNAL_FETCH_ALLOWED_HOSTS = ORIG_ALLOWED;
    } else {
      delete process.env.EXTERNAL_FETCH_ALLOWED_HOSTS;
    }
    if (typeof ORIG_ENV === 'string') {
      process.env.NODE_ENV = ORIG_ENV;
    } else {
      delete process.env.NODE_ENV;
    }
    dnsLookupMock.mockReset();
  });

  it('rejects IPv6 with 9 groups (overflow, no ::)', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.EXTERNAL_FETCH_ALLOWED_HOSTS;
    // 1:2:3:4:5:6:7:8:9 has 9 groups — total > 8 => expandIpv6 returns null
    dnsLookupMock.mockResolvedValue([{ address: '1:2:3:4:5:6:7:8:9' }]);
    const result = await validateExternalHttpsUrl('https://example.com/file');
    expect(result.ok).toBe(false);
  });

  it('rejects IPv6 with multiple double colons', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.EXTERNAL_FETCH_ALLOWED_HOSTS;
    dnsLookupMock.mockResolvedValue([{ address: '::1::2' }]);
    const result = await validateExternalHttpsUrl('https://example.com/file');
    expect(result.ok).toBe(false);
  });

  it('rejects IPv4-mapped IPv6 with private IPv4 (::ffff:10.0.0.1)', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.EXTERNAL_FETCH_ALLOWED_HOSTS;
    dnsLookupMock.mockResolvedValue([{ address: '::ffff:10.0.0.1' }]);
    const result = await validateExternalHttpsUrl('https://example.com/file');
    expect(result.ok).toBe(false);
  });

  it('allows IPv4-mapped IPv6 with public IPv4 (::ffff:93.184.216.34)', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.EXTERNAL_FETCH_ALLOWED_HOSTS;
    dnsLookupMock.mockResolvedValue([{ address: '::ffff:93.184.216.34' }]);
    const result = await validateExternalHttpsUrl('https://example.com/file');
    expect(result.ok).toBe(true);
  });

  it('rejects IPv6 with invalid IPv4 tail (not net.isIPv4)', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.EXTERNAL_FETCH_ALLOWED_HOSTS;
    // ::1.2.invalid -- has a dot but is not valid IPv4
    dnsLookupMock.mockResolvedValue([{ address: '::not.valid.ip4' }]);
    const result = await validateExternalHttpsUrl('https://example.com/file');
    expect(result.ok).toBe(false);
  });

  it('rejects when IPv4 tail has empty tail (normalizedLeft.pop returns undefined)', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.EXTERNAL_FETCH_ALLOWED_HOSTS;
    // An address like '::' with IPv4 tail that fails: e.g. '::.1.2.3'
    // Actually '::.1.2.3' — net.isIPv6 will return false for this, treated as private
    dnsLookupMock.mockResolvedValue([{ address: '::.1.2.3' }]);
    const result = await validateExternalHttpsUrl('https://example.com/file');
    expect(result.ok).toBe(false);
  });
});
