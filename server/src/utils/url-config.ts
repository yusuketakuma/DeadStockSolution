export type NormalizedHttpsOrLoopbackHttpUrlError = 'missing' | 'invalid' | 'insecure';

function stripIpv6Brackets(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
}

export function isLoopbackHostname(hostname: string): boolean {
  const normalized = stripIpv6Brackets(hostname.trim().toLowerCase());
  return normalized === 'localhost'
    || normalized === '127.0.0.1'
    || normalized === '::1';
}

function stripTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

export function normalizeHttpsOrLoopbackHttpUrl(
  rawValue: string,
  options?: {
    allowEmpty?: boolean;
    stripTrailingSlash?: boolean;
  },
): { value: string; error: NormalizedHttpsOrLoopbackHttpUrlError | null } {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return {
      value: '',
      error: options?.allowEmpty ? null : 'missing',
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { value: '', error: 'invalid' };
  }

  const protocol = parsed.protocol.toLowerCase();
  if (protocol !== 'https:' && !(protocol === 'http:' && isLoopbackHostname(parsed.hostname))) {
    return { value: '', error: 'insecure' };
  }

  parsed.search = '';
  parsed.hash = '';
  const normalized = parsed.toString();
  return {
    value: options?.stripTrailingSlash ? stripTrailingSlash(normalized) : normalized,
    error: null,
  };
}
