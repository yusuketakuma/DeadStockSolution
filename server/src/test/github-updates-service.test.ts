import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loggerWarn: vi.fn(),
}));

vi.mock('../services/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: mocks.loggerWarn,
    error: vi.fn(),
  },
}));

import { getGitHubUpdates, resetGitHubUpdatesCacheForTests } from '../services/github-updates-service';

const ENV_KEYS = [
  'NODE_ENV',
  'GITHUB_UPDATES_REPOSITORY',
  'GITHUB_REPOSITORY',
  'GITHUB_UPDATES_LIMIT',
  'GITHUB_UPDATES_CACHE_TTL_SECONDS',
  'GITHUB_UPDATES_TIMEOUT_MS',
  'GITHUB_UPDATES_RETRIES',
  'GITHUB_UPDATES_INCLUDE_PRERELEASE',
  'GITHUB_UPDATES_TOKEN',
] as const;

const originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
for (const key of ENV_KEYS) {
  originalEnv[key] = process.env[key];
}

function resetEnv(): void {
  for (const key of ENV_KEYS) {
    const value = originalEnv[key];
    if (typeof value === 'string') {
      process.env[key] = value;
    } else {
      delete process.env[key];
    }
  }
}

const originalFetch = global.fetch;

describe('github-updates-service', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetGitHubUpdatesCacheForTests();
    resetEnv();
  });

  afterEach(() => {
    resetGitHubUpdatesCacheForTests();
    resetEnv();
    vi.useRealTimers();
    global.fetch = originalFetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('fetches releases and filters drafts/prereleases by default', async () => {
    process.env.GITHUB_UPDATES_REPOSITORY = 'owner/repo';
    process.env.GITHUB_UPDATES_LIMIT = '5';

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ([
        {
          id: 10,
          tag_name: 'v1.2.0',
          name: 'Stable release',
          body: 'public release',
          html_url: 'https://github.com/owner/repo/releases/tag/v1.2.0',
          draft: false,
          prerelease: false,
          published_at: '2026-02-25T00:00:00.000Z',
        },
        {
          id: 11,
          tag_name: 'v1.3.0-rc1',
          name: 'Prerelease',
          body: 'candidate',
          html_url: 'https://github.com/owner/repo/releases/tag/v1.3.0-rc1',
          draft: false,
          prerelease: true,
          published_at: '2026-02-26T00:00:00.000Z',
        },
        {
          id: 12,
          tag_name: 'v1.4.0',
          name: 'Draft release',
          body: 'draft',
          html_url: 'https://github.com/owner/repo/releases/tag/v1.4.0',
          draft: true,
          prerelease: false,
          published_at: '2026-02-27T00:00:00.000Z',
        },
      ]),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await getGitHubUpdates();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0][0])).toContain('/repos/owner/repo/releases?per_page=5');
    expect(result.stale).toBe(false);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual(expect.objectContaining({
      tag: 'v1.2.0',
      title: 'Stable release',
      prerelease: false,
    }));
  });

  it('serves stale cache with original fetchedAt when refresh fails', async () => {
    process.env.GITHUB_UPDATES_REPOSITORY = 'owner/repo';
    process.env.GITHUB_UPDATES_CACHE_TTL_SECONDS = '30';
    process.env.GITHUB_UPDATES_RETRIES = '0';

    vi.useFakeTimers();
    const firstNow = new Date('2026-02-25T00:00:00.000Z');
    vi.setSystemTime(firstNow);

    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ([
        {
          id: 20,
          tag_name: 'v2.0.0',
          name: 'Major release',
          body: 'important',
          html_url: 'https://github.com/owner/repo/releases/tag/v2.0.0',
          draft: false,
          prerelease: false,
          published_at: '2026-02-24T00:00:00.000Z',
        },
      ]),
    });
    fetchMock.mockRejectedValueOnce(new Error('upstream unavailable'));
    global.fetch = fetchMock as unknown as typeof fetch;

    const first = await getGitHubUpdates();

    vi.setSystemTime(new Date(firstNow.getTime() + 31_000));
    const second = await getGitHubUpdates();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(first.stale).toBe(false);
    expect(second.stale).toBe(true);
    expect(second.fetchedAt).toBe(first.fetchedAt);
  });

  it('normalizes abort errors as timeout errors', async () => {
    process.env.GITHUB_UPDATES_REPOSITORY = 'owner/repo';
    process.env.GITHUB_UPDATES_TIMEOUT_MS = '4321';

    const fetchMock = vi.fn().mockRejectedValue(new DOMException('The operation was aborted', 'AbortError'));
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(getGitHubUpdates()).rejects.toThrow('GitHub updates request timed out after 4321ms');
  });

  it('falls back to default repository when configured value is invalid', async () => {
    process.env.GITHUB_UPDATES_REPOSITORY = 'invalid/repo/name/format';

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ([]),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await getGitHubUpdates();

    expect(String(fetchMock.mock.calls[0][0])).toContain('/repos/yusuketakuma/DeadStockSolution/releases');
    expect(mocks.loggerWarn).toHaveBeenCalledWith(
      'Invalid GitHub repository config for updates. Falling back to default repository.',
      expect.objectContaining({ fallbackRepository: 'yusuketakuma/DeadStockSolution' })
    );
  });

  it('falls back to default repository in production when not configured', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.GITHUB_UPDATES_REPOSITORY;
    delete process.env.GITHUB_REPOSITORY;

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{
        id: 99,
        tag_name: 'v0.0.1',
        name: 'Initial',
        body: 'init',
        html_url: 'https://github.com/yusuketakuma/DeadStockSolution/releases/tag/v0.0.1',
        draft: false,
        prerelease: false,
        published_at: '2026-02-25T00:00:00.000Z',
      }],
    });
    vi.stubGlobal('fetch', fetchMock);

    await getGitHubUpdates();

    expect(String(fetchMock.mock.calls[0][0])).toContain('/repos/yusuketakuma/DeadStockSolution/releases');
  });

  it('retries temporary 503 responses and succeeds', async () => {
    process.env.GITHUB_UPDATES_REPOSITORY = 'owner/repo';
    process.env.GITHUB_UPDATES_RETRIES = '2';

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        text: async () => 'temporary unavailable',
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ([
          {
            id: 31,
            tag_name: 'v3.1.0',
            name: 'Recovered release',
            body: 'retry success',
            html_url: 'https://github.com/owner/repo/releases/tag/v3.1.0',
            draft: false,
            prerelease: false,
            published_at: '2026-02-28T00:00:00.000Z',
          },
        ]),
      });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await getGitHubUpdates();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.tag).toBe('v3.1.0');
  });
});
