import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchWithTimeout: vi.fn(),
  downloadResponseBuffer: vi.fn(),
  getSourceState: vi.fn(),
  decideSourceUpdate: vi.fn(),
}));

vi.mock('../utils/http-utils', () => ({
  fetchWithTimeout: mocks.fetchWithTimeout,
  downloadResponseBuffer: mocks.downloadResponseBuffer,
  MHLW_MAX_DOWNLOAD_SIZE: 100 * 1024 * 1024,
  MHLW_FETCH_TIMEOUT_MS: 120_000,
}));

vi.mock('../services/drug-master-source-state-service', () => ({
  getSourceState: mocks.getSourceState,
}));

vi.mock('../services/source-update-detection', () => ({
  decideSourceUpdate: mocks.decideSourceUpdate,
}));

import { checkForUpdates, downloadFile } from '../services/mhlw-source-fetch';

describe('mhlw-source-fetch: checkForUpdates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns hasUpdate true when source has changed', async () => {
    const headers = new Map([
      ['etag', '"abc123"'],
      ['last-modified', 'Mon, 01 Jan 2026 00:00:00 GMT'],
      ['content-type', 'application/vnd.ms-excel'],
    ]);
    mocks.fetchWithTimeout.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: (key: string) => headers.get(key) ?? null },
    });
    mocks.getSourceState.mockResolvedValue({
      etag: '"old"',
      lastModified: 'old',
      contentHash: 'oldhash',
    });
    mocks.decideSourceUpdate.mockReturnValue({
      shouldDownload: true,
      compareByContentHash: false,
    });

    const result = await checkForUpdates(
      'https://example.com/data.xlsx',
      undefined as unknown as import('../utils/http-utils').FetchDispatcher,
      { sourceKey: 'test-key', retries: 2, headers: {} },
    );

    expect(result.hasUpdate).toBe(true);
    expect(result.etag).toBe('"abc123"');
    expect(result.lastModified).toBe('Mon, 01 Jan 2026 00:00:00 GMT');
    expect(result.contentType).toBe('application/vnd.ms-excel');
    expect(result.compareByContentHash).toBe(false);
    expect(result.previousContentHash).toBe('oldhash');
  });

  it('returns hasUpdate false when source has not changed', async () => {
    const headers = new Map([
      ['etag', '"abc123"'],
      ['last-modified', 'Mon, 01 Jan 2026 00:00:00 GMT'],
      ['content-type', 'application/vnd.ms-excel'],
    ]);
    mocks.fetchWithTimeout.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: (key: string) => headers.get(key) ?? null },
    });
    mocks.getSourceState.mockResolvedValue({
      etag: '"abc123"',
      lastModified: 'Mon, 01 Jan 2026 00:00:00 GMT',
      contentHash: null,
    });
    mocks.decideSourceUpdate.mockReturnValue({
      shouldDownload: false,
      compareByContentHash: false,
    });

    const result = await checkForUpdates(
      'https://example.com/data.xlsx',
      undefined as unknown as import('../utils/http-utils').FetchDispatcher,
      { sourceKey: 'test-key', retries: 2, headers: {} },
    );

    expect(result.hasUpdate).toBe(false);
    expect(result.previousContentHash).toBeNull();
  });

  it('throws on redirect response', async () => {
    mocks.fetchWithTimeout.mockResolvedValue({
      ok: false,
      status: 301,
      statusText: 'Moved Permanently',
      headers: { get: () => null },
    });

    await expect(
      checkForUpdates(
        'https://example.com/data.xlsx',
        undefined as unknown as import('../utils/http-utils').FetchDispatcher,
        { sourceKey: 'test-key', retries: 2, headers: {} },
      ),
    ).rejects.toThrow('Redirect response is not allowed');
  });

  it('throws on non-ok response', async () => {
    mocks.fetchWithTimeout.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      headers: { get: () => null },
    });

    await expect(
      checkForUpdates(
        'https://example.com/data.xlsx',
        undefined as unknown as import('../utils/http-utils').FetchDispatcher,
        { sourceKey: 'test-key', retries: 2, headers: {} },
      ),
    ).rejects.toThrow('HEAD request failed');
  });

  it('returns null previousContentHash when no previous state', async () => {
    const headers = new Map<string, string>();
    mocks.fetchWithTimeout.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: (key: string) => headers.get(key) ?? null },
    });
    mocks.getSourceState.mockResolvedValue(null);
    mocks.decideSourceUpdate.mockReturnValue({
      shouldDownload: true,
      compareByContentHash: true,
    });

    const result = await checkForUpdates(
      'https://example.com/data.xlsx',
      undefined as unknown as import('../utils/http-utils').FetchDispatcher,
      { sourceKey: 'test-key', retries: 2, headers: {} },
    );

    expect(result.hasUpdate).toBe(true);
    expect(result.compareByContentHash).toBe(true);
    expect(result.previousContentHash).toBeNull();
  });
});

describe('mhlw-source-fetch: downloadFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('downloads a file and returns buffer with content type', async () => {
    const mockBuffer = Buffer.from('file-content');
    const headers = new Map([['content-type', 'application/vnd.ms-excel']]);
    mocks.fetchWithTimeout.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: (key: string) => headers.get(key) ?? null },
    });
    mocks.downloadResponseBuffer.mockResolvedValue(mockBuffer);

    const result = await downloadFile(
      'https://example.com/data.xlsx',
      undefined as unknown as import('../utils/http-utils').FetchDispatcher,
      { retries: 2, headers: {} },
    );

    expect(result.buffer).toBe(mockBuffer);
    expect(result.contentType).toBe('application/vnd.ms-excel');
  });

  it('throws on redirect response', async () => {
    mocks.fetchWithTimeout.mockResolvedValue({
      ok: false,
      status: 302,
      statusText: 'Found',
      headers: { get: () => null },
    });

    await expect(
      downloadFile(
        'https://example.com/data.xlsx',
        undefined as unknown as import('../utils/http-utils').FetchDispatcher,
        { retries: 2, headers: {} },
      ),
    ).rejects.toThrow('Redirect response is not allowed');
  });

  it('throws on non-ok response', async () => {
    mocks.fetchWithTimeout.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      headers: { get: () => null },
    });

    await expect(
      downloadFile(
        'https://example.com/data.xlsx',
        undefined as unknown as import('../utils/http-utils').FetchDispatcher,
        { retries: 2, headers: {} },
      ),
    ).rejects.toThrow('Download failed');
  });

  it('returns null content type when not present', async () => {
    const mockBuffer = Buffer.from('file-content');
    mocks.fetchWithTimeout.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => null },
    });
    mocks.downloadResponseBuffer.mockResolvedValue(mockBuffer);

    const result = await downloadFile(
      'https://example.com/data.xlsx',
      undefined as unknown as import('../utils/http-utils').FetchDispatcher,
      { retries: 2, headers: {} },
    );

    expect(result.contentType).toBeNull();
  });
});
