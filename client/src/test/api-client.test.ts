import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api, hasVerificationStatusPayload, isConflictError, setAuthExpiredHandler } from '../api/client';

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('api client', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setAuthExpiredHandler(() => {});
  });

  it('sends GET/POST/PATCH/DELETE and parses json/non-json/204 responses', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(jsonResponse({ patched: true }))
      .mockResolvedValueOnce(new Response('plain', { status: 200, headers: { 'Content-Type': 'text/plain' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.get<{ ok: boolean }>('/health')).resolves.toEqual({ ok: true });
    await expect(api.post('/resource', { a: 1 })).resolves.toBeUndefined();
    await expect(api.patch<{ patched: boolean }>('/resource/1', { b: 2 })).resolves.toEqual({ patched: true });
    await expect(api.delete('/resource/1')).resolves.toBeUndefined();

    expect(fetchMock.mock.calls[0][1]).toEqual(expect.objectContaining({ method: 'GET' }));
    expect(((fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>)['Content-Type']).toBeUndefined();
    expect(fetchMock.mock.calls[1][1]).toEqual(expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ a: 1 }),
    }));
    expect(((fetchMock.mock.calls[1][1] as RequestInit).headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(fetchMock.mock.calls[2][1]).toEqual(expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ b: 2 }),
    }));
    expect(fetchMock.mock.calls[3][1]).toEqual(expect.objectContaining({ method: 'DELETE' }));
  });

  it('throws ApiError with fieldErrors and triggers auth-expired handler on 401', async () => {
    const onExpired = vi.fn();
    setAuthExpiredHandler(onExpired);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        error: 'validation failed',
        code: 'VALIDATION_ERROR',
        errors: [{ field: 'email', message: 'invalid email' }],
      }, 422))
      .mockResolvedValueOnce(jsonResponse({ error: 'unauthorized' }, 401));
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.get('/invalid')).rejects.toMatchObject({
      name: 'ApiError',
      status: 422,
      message: 'validation failed',
      code: 'VALIDATION_ERROR',
      fieldErrors: [{ field: 'email', message: 'invalid email' }],
    });

    await expect(api.get('/unauthorized')).rejects.toMatchObject({
      status: 401,
      message: 'unauthorized',
    });
    expect(onExpired).toHaveBeenCalledTimes(1);
  });

  it('handles timeout and external cancellation errors', async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => (
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
      })
    ));
    vi.stubGlobal('fetch', fetchMock);

    const controller = new AbortController();
    const cancelledPromise = api.get('/cancel', { signal: controller.signal, timeout: 50 });
    controller.abort();
    await expect(cancelledPromise).rejects.toMatchObject({
      status: 0,
      message: 'リクエストがキャンセルされました',
    });

    await expect(api.get('/timeout', { timeout: 1 })).rejects.toMatchObject({
      status: 0,
      message: 'リクエストがタイムアウトしました',
    });
  });

  it('handles upload response and network errors', async () => {
    const uploadFetch = vi.fn().mockResolvedValueOnce(jsonResponse({ uploaded: true }));
    vi.stubGlobal('fetch', uploadFetch);
    const formData = new FormData();
    formData.append('file', new Blob(['x'], { type: 'text/plain' }), 'a.txt');
    await expect(api.upload<{ uploaded: boolean }>('/upload', formData)).resolves.toEqual({ uploaded: true });

    const networkFetch = vi.fn().mockRejectedValue(new Error('boom'));
    vi.stubGlobal('fetch', networkFetch);
    await expect(api.get('/network')).rejects.toMatchObject({
      status: 0,
      message: 'ネットワークエラーが発生しました',
    });
  });

  it('identifies conflict errors with latestData payload', async () => {
    const conflict = new ApiError(409, 'conflict', { latestData: { id: 1 } });
    const notConflict = new ApiError(409, 'conflict', { foo: 'bar' });

    expect(isConflictError(conflict)).toBe(true);
    expect(isConflictError(notConflict)).toBe(false);
    expect(isConflictError(new Error('x'))).toBe(false);
  });

  it('safely identifies verification payloads from unknown json values', () => {
    expect(hasVerificationStatusPayload(null)).toBe(false);
    expect(hasVerificationStatusPayload('pending_verification')).toBe(false);
    expect(hasVerificationStatusPayload(403)).toBe(false);
    expect(hasVerificationStatusPayload({ verificationStatus: 123 })).toBe(false);
    expect(hasVerificationStatusPayload({ verificationStatus: 'pending_verification' })).toBe(true);
  });
});
