import type { LookupAddress } from 'node:dns';
import dns from 'node:dns/promises';
import net from 'node:net';
import { Agent } from 'undici';

interface ExternalUrlValidationResult {
  ok: boolean;
  reason: string | null;
  hostname: string | null;
  resolvedAddresses: string[];
}

function buildValidationFailure(
  reason: string,
  hostname: string | null,
  resolvedAddresses: string[] = [],
): ExternalUrlValidationResult {
  return { ok: false, reason, hostname, resolvedAddresses };
}

function buildValidationSuccess(
  hostname: string,
  resolvedAddresses: string[],
): ExternalUrlValidationResult {
  return { ok: true, reason: null, hostname, resolvedAddresses };
}

function parseAllowedHostPatterns(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);
}

function hostMatchesPattern(hostname: string, pattern: string): boolean {
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(2);
    return hostname.endsWith(`.${suffix}`);
  }
  return hostname === pattern;
}

function isHostnameAllowedByPolicy(hostname: string): boolean {
  const patterns = parseAllowedHostPatterns(process.env.EXTERNAL_FETCH_ALLOWED_HOSTS);
  if (patterns.length === 0) {
    return process.env.NODE_ENV !== 'production';
  }
  const lowerHostname = hostname.toLowerCase();
  return patterns.some((pattern) => hostMatchesPattern(lowerHostname, pattern));
}

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }

  const [a, b] = parts;
  if (a === 0) return true;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;
  return false;
}

function expandIpv6(ip: string): string[] | null {
  const doubleColonParts = ip.split('::');
  if (doubleColonParts.length > 2) return null;

  const left = doubleColonParts[0]
    .split(':')
    .filter((part) => part.length > 0);
  const right = (doubleColonParts[1] ?? '')
    .split(':')
    .filter((part) => part.length > 0);

  const hasIpv4Tail = (right[right.length - 1] ?? left[left.length - 1] ?? '').includes('.');
  const normalizedRight = [...right];
  const normalizedLeft = [...left];

  if (hasIpv4Tail) {
    const tail = normalizedRight.length > 0
      ? normalizedRight.pop()!
      : normalizedLeft.pop();
    if (!tail) return null;

    if (!net.isIPv4(tail)) {
      return null;
    }

    const octets = tail.split('.').map((part) => Number(part));
    const hi = ((octets[0] << 8) | octets[1]).toString(16);
    const lo = ((octets[2] << 8) | octets[3]).toString(16);

    if (normalizedRight.length > 0) {
      normalizedRight.push(hi, lo);
    } else {
      normalizedLeft.push(hi, lo);
    }
  }

  const total = normalizedLeft.length + normalizedRight.length;
  if (total > 8) return null;

  const fillCount = 8 - total;
  const middle = doubleColonParts.length === 2 ? Array(fillCount).fill('0') : [];
  const groups = [...normalizedLeft, ...middle, ...normalizedRight];
  if (groups.length !== 8) return null;

  return groups.map((group) => group.padStart(4, '0').toLowerCase());
}

function isPrivateIpv6(ip: string): boolean {
  const expanded = expandIpv6(ip);
  if (!expanded) return true;

  const first = parseInt(expanded[0], 16);

  const isLoopback = expanded.every((group, idx) => (idx < 7 ? group === '0000' : group === '0001'));
  if (isLoopback) return true;

  const isUnspecified = expanded.every((group) => group === '0000');
  if (isUnspecified) return true;

  // fc00::/7 unique local address
  if ((first & 0xfe00) === 0xfc00) return true;
  // fe80::/10 link-local
  if ((first & 0xffc0) === 0xfe80) return true;
  // ff00::/8 multicast
  if ((first & 0xff00) === 0xff00) return true;

  // ::ffff:0:0/96 IPv4-mapped IPv6
  const isIpv4Mapped = expanded.slice(0, 5).every((group) => group === '0000')
    && expanded[5] === 'ffff';
  if (isIpv4Mapped) {
    const hi = parseInt(expanded[6], 16);
    const lo = parseInt(expanded[7], 16);
    const ipv4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
    return isPrivateIpv4(ipv4);
  }

  return false;
}

function isPrivateIpAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    return isPrivateIpv4(ip);
  }
  if (net.isIPv6(ip)) {
    return isPrivateIpv6(ip);
  }
  return true;
}

function isBlockedHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return lower === 'localhost'
    || lower.endsWith('.localhost')
    || lower.endsWith('.local');
}

async function resolveHostname(hostname: string): Promise<string[]> {
  if (net.isIP(hostname)) {
    return [hostname];
  }

  const records = await dns.lookup(hostname, { all: true, verbatim: true });
  const unique = new Set<string>();
  for (const record of records) {
    if (record?.address) {
      unique.add(record.address);
    }
  }
  return [...unique];
}

function filterAddressesByFamily(addresses: string[], family: number | string | undefined): string[] {
  return addresses.filter((address) => {
    if (family === 4 || family === 'IPv4') return net.isIPv4(address);
    if (family === 6 || family === 'IPv6') return net.isIPv6(address);
    return true;
  });
}

function toLookupAddress(address: string): LookupAddress {
  return {
    address,
    family: net.isIPv6(address) ? 6 : 4,
  };
}

export async function validateExternalHttpsUrl(url: string): Promise<ExternalUrlValidationResult> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return buildValidationFailure('URL形式が不正です', null);
  }

  if (parsed.protocol !== 'https:') {
    return buildValidationFailure('HTTPSのみ許可されています', parsed.hostname);
  }

  if (isBlockedHostname(parsed.hostname)) {
    return buildValidationFailure('ローカルドメインは許可されていません', parsed.hostname);
  }

  if (!isHostnameAllowedByPolicy(parsed.hostname)) {
    return buildValidationFailure('許可リストにないホストです', parsed.hostname);
  }

  let addresses: string[];
  try {
    addresses = await resolveHostname(parsed.hostname);
  } catch {
    return buildValidationFailure('ホスト名を解決できませんでした', parsed.hostname);
  }

  if (addresses.length === 0) {
    return buildValidationFailure('ホスト名の解決結果が空です', parsed.hostname);
  }

  if (addresses.some((address) => isPrivateIpAddress(address))) {
    return buildValidationFailure(
      'プライベート/ローカルIPへの接続は許可されていません',
      parsed.hostname,
      addresses,
    );
  }

  return buildValidationSuccess(parsed.hostname, addresses);
}

export async function assertExternalHttpsUrlSafe(url: string): Promise<void> {
  const result = await validateExternalHttpsUrl(url);
  if (result.ok) return;
  const reason = result.reason ?? 'URLの検証に失敗しました';
  const hostname = result.hostname ? ` (${result.hostname})` : '';
  throw new Error(`${reason}${hostname}`);
}

export function createPinnedDnsLookup(hostname: string, allowedAddresses: string[]): net.LookupFunction {
  const normalizedHostname = hostname.toLowerCase();
  const uniqueAddresses = [...new Set(allowedAddresses)];
  if (uniqueAddresses.length === 0) {
    throw new Error('DNS pinning requires at least one resolved address');
  }
  let nextAddressIndex = 0;
  const lookup: net.LookupFunction = (lookupHostname, lookupOptions, callback) => {
    if (lookupHostname.toLowerCase() !== normalizedHostname) {
      callback(new Error('Hostname changed during DNS-pinned request'), '');
      return;
    }

    const filtered = filterAddressesByFamily(uniqueAddresses, lookupOptions?.family);

    if (filtered.length === 0) {
      callback(new Error('No pinned address available for requested IP family'), '');
      return;
    }

    if (lookupOptions?.all) {
      const addresses = filtered.map(toLookupAddress);
      callback(null, addresses);
      return;
    }

    const address = filtered[nextAddressIndex % filtered.length];
    nextAddressIndex += 1;
    callback(null, address, net.isIPv6(address) ? 6 : 4);
  };

  return lookup;
}

export function createPinnedDnsAgent(hostname: string, allowedAddresses: string[]): Agent {
  const lookup = createPinnedDnsLookup(hostname, allowedAddresses);

  return new Agent({
    connect: { lookup },
  });
}
