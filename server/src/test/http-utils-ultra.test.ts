import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  downloadResponseBuffer,
  fetchWithTimeout,
  FetchTimeoutError,
  sleep,
  summarizeSourceUrl,
} from '../utils/http-utils';

const originalFetch = global.fetch;

describe('http-utils ultra coverage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('sleep', () => {
    it('resolves after specified delay', async () => {
      const start = Date.now();
      await sleep(10);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(5);
    });
  });

  describe('summarizeSourceUrl', () => {
    it('extracts hostname from valid URL', () => {
      expect(summarizeSourceUrl('https://www.mhlw.go.jp/content/data.xlsx')).toBe('www.mhlw.go.jp');
    });

    it('truncates invalid URL to 64 chars', () => {
      const invalid = 'not-a-url-' + 'x'.repeat(100);
      expect(summarizeSourceUrl(invalid)).toBe(invalid.slice(0, 64));
    });

    it('returns full string for short invalid URL', () => {
      expect(summarizeSourceUrl('not-a-url')).toBe('not-a-url');
    });
  });

  describe('fetchWithTimeout retry logic', () => {
    it('retries network errors and succeeds on subsequent attempt', async () => {
      const fetchMock = vi.fn()
        .mockRejectedValueOnce(new Error('network error'))
        .mockResolvedValueOnce(new Response('ok', { status: 200 }));
      global.fetch = fetchMock as unknown as typeof fetch;

      const response = await fetchWithTimeout('https://example.com/retry', {
        timeoutMs: 5000,
        retry: { retries: 1, baseDelayMs: 1, maxDelayMs: 10 },
      });

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(response.status).toBe(200);
    });

    it('throws immediately when external signal is already aborted', async () => {
      const controller = new AbortController();
      controller.abort(new Error('user cancelled'));

      global.fetch = vi.fn((_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          if (init?.signal?.aborted) {
            reject(new DOMException('aborted', 'AbortError'));
            return;
          }
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          }, { once: true });
        }),
      ) as unknown as typeof fetch;

      await expect(fetchWithTimeout('https://example.com/aborted', {
        timeoutMs: 5000,
        signal: controller.signal,
        retry: { retries: 1, baseDelayMs: 1 },
      })).rejects.toThrow();
    });

    it('does not retry AbortError (non-timeout)', async () => {
      const controller = new AbortController();

      global.fetch = vi.fn((_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          }, { once: true });
          // Simulate external abort
          setTimeout(() => controller.abort(), 5);
        }),
      ) as unknown as typeof fetch;

      await expect(fetchWithTimeout('https://example.com/ext-abort', {
        timeoutMs: 5000,
        signal: controller.signal,
        retry: { retries: 2, baseDelayMs: 1 },
      })).rejects.toThrow();
    });

    it('throws last error after exhausting all retries', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('persistent error')) as unknown as typeof fetch;

      await expect(fetchWithTimeout('https://example.com/fail', {
        timeoutMs: 5000,
        retry: { retries: 1, baseDelayMs: 1, maxDelayMs: 5 },
      })).rejects.toThrow('persistent error');
    });

    it('uses default retry options when retry is not provided', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce(
        new Response('ok', { status: 200 }),
      ) as unknown as typeof fetch;

      const response = await fetchWithTimeout('https://example.com/no-retry', {
        timeoutMs: 5000,
      });

      expect(response.status).toBe(200);
    });

    it('retries on FetchTimeoutError when retries remain', async () => {
      let callCount = 0;
      global.fetch = vi.fn((_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          callCount++;
          if (callCount === 1) {
            // First call: trigger timeout by immediately calling abort listener
            const timer = setTimeout(() => {
              // This simulates timeout - abort the signal
            }, 1);
            init?.signal?.addEventListener('abort', () => {
              clearTimeout(timer);
              reject(new DOMException('aborted', 'AbortError'));
            }, { once: true });
          } else {
            _resolve(new Response('ok', { status: 200 }));
          }
        }),
      ) as unknown as typeof fetch;

      // Use very short timeout for first attempt
      const response = await fetchWithTimeout('https://example.com/timeout-retry', {
        timeoutMs: 10,
        retry: { retries: 1, baseDelayMs: 1, maxDelayMs: 5 },
      });

      expect(response.status).toBe(200);
    });

    it('returns retryable status response on final attempt without retrying', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce(
        new Response('busy', { status: 503 }),
      ) as unknown as typeof fetch;

      const response = await fetchWithTimeout('https://example.com/503-final', {
        timeoutMs: 5000,
        retry: { retries: 0 },
      });

      expect(response.status).toBe(503);
    });
  });

  describe('downloadResponseBuffer', () => {
    it('succeeds when content-length is within limit', async () => {
      const response = new Response('hello', {
        status: 200,
        headers: { 'content-length': '5' },
      });

      const buffer = await downloadResponseBuffer(response, 1024);
      expect(buffer.toString()).toBe('hello');
    });

    it('succeeds when no content-length header', async () => {
      const response = new Response('data', { status: 200 });

      const buffer = await downloadResponseBuffer(response, 1024);
      expect(buffer.toString()).toBe('data');
    });

    it('throws when actual body exceeds max size', async () => {
      const bigData = 'x'.repeat(2000);
      const response = new Response(bigData, {
        status: 200,
        // No content-length, so body check kicks in
      });

      await expect(downloadResponseBuffer(response, 1024)).rejects.toThrow('Downloaded file too large');
    });

    it('skips content-length check when header is non-numeric', async () => {
      const response = new Response('ok', {
        status: 200,
        headers: { 'content-length': 'invalid' },
      });

      const buffer = await downloadResponseBuffer(response, 1024);
      expect(buffer.toString()).toBe('ok');
    });
  });

  describe('FetchTimeoutError', () => {
    it('has correct name', () => {
      const error = new FetchTimeoutError('timeout');
      expect(error.name).toBe('FetchTimeoutError');
      expect(error.message).toBe('timeout');
      expect(error).toBeInstanceOf(Error);
    });
  });
});
