import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveHostnameViaDoh, validateExternalHttpsUrl } from '../utils/network-utils';

function dohResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/dns-json' } });
}

describe('resolveHostnameViaDoh', () => {
  it('returns A and AAAA addresses and ignores CNAME answers', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (url) => {
      const type = new URL(String(url)).searchParams.get('type');
      if (type === 'A') {
        return dohResponse({
          Status: 0,
          Answer: [
            { type: 5, data: 'alias.example.com.' },
            { type: 1, data: '203.0.113.10' },
            { type: 1, data: '203.0.113.10' },
          ],
        });
      }
      return dohResponse({ Status: 0, Answer: [{ type: 28, data: '2001:db8::1' }] });
    });

    const addresses = await resolveHostnameViaDoh('www.example.com', fetchImpl);

    expect(addresses).toEqual(['203.0.113.10', '2001:db8::1']);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://cloudflare-dns.com/dns-query?name=www.example.com&type=A',
      { headers: { accept: 'application/dns-json' } },
    );
  });

  it('returns an empty list for NXDOMAIN', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => dohResponse({ Status: 3 }));
    await expect(resolveHostnameViaDoh('missing.example.com', fetchImpl)).resolves.toEqual([]);
  });

  it('throws when the resolver fails', async () => {
    const httpError = vi.fn<typeof fetch>(async () => dohResponse({}, 502));
    await expect(resolveHostnameViaDoh('www.example.com', httpError)).rejects.toThrow('HTTP 502');

    const servfail = vi.fn<typeof fetch>(async () => dohResponse({ Status: 2 }));
    await expect(resolveHostnameViaDoh('www.example.com', servfail)).rejects.toThrow('status 2');
  });
});

describe('validateExternalHttpsUrl on Cloudflare Workers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('resolves through DNS over HTTPS and still blocks private addresses', async () => {
    vi.stubEnv('EXTERNAL_FETCH_ALLOWED_HOSTS', 'internal.example.com');
    vi.stubGlobal('navigator', { userAgent: 'Cloudflare-Workers' });
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const type = new URL(url).searchParams.get('type');
      return dohResponse({ Status: 0, Answer: type === 'A' ? [{ type: 1, data: '10.0.0.5' }] : [] });
    }));

    const result = await validateExternalHttpsUrl('https://internal.example.com/file.xlsx');

    expect(result.ok).toBe(false);
    expect(result.resolvedAddresses).toEqual(['10.0.0.5']);
  });
});
