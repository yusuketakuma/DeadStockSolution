import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadResponseBuffer, fetchWithTimeout, FetchTimeoutError } from '../utils/http-utils';

const originalFetch = global.fetch;

describe('http-utils', () => {
  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('retries temporary status and returns successful response', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('temporary', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const response = await fetchWithTimeout('https://example.com/data', {
      timeoutMs: 1000,
      retry: { retries: 1, baseDelayMs: 1, maxDelayMs: 10 },
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(response.status).toBe(200);
  });

  it('throws FetchTimeoutError when request exceeds timeout', async () => {
    global.fetch = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(new DOMException('aborted', 'AbortError'));
      }, { once: true });
    })) as unknown as typeof fetch;

    await expect(fetchWithTimeout('https://example.com/slow', {
      timeoutMs: 20,
      retry: { retries: 0 },
    })).rejects.toBeInstanceOf(FetchTimeoutError);
  });

  it('rejects payload larger than max download size from content-length', async () => {
    const response = new Response('oversized', {
      status: 200,
      headers: {
        'content-length': '9999',
      },
    });

    await expect(downloadResponseBuffer(response, 1024)).rejects.toThrow('File too large');
  });

  it('continues retry even when response body cancel rejects', async () => {
    const cancelMock = vi.fn().mockRejectedValue(new Error('cancel failed'));
    const retryableResponse = {
      status: 503,
      body: {
        cancel: cancelMock,
      },
    } as unknown as Response;

    const successResponse = new Response('ok', { status: 200 });

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(retryableResponse)
      .mockResolvedValueOnce(successResponse);
    global.fetch = fetchMock as unknown as typeof fetch;

    const res = await fetchWithTimeout('https://example.com/retry', {
      timeoutMs: 200,
      retry: { retries: 1, baseDelayMs: 1, maxDelayMs: 5 },
    });

    expect(res.status).toBe(200);
    expect(cancelMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to generic request failed when retries is NaN', async () => {
    await expect(fetchWithTimeout('https://example.com/invalid', {
      timeoutMs: 100,
      retry: {
        retries: Number.NaN as unknown as number,
      },
    })).rejects.toThrow('request failed');
  });
});
