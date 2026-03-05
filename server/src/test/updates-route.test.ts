import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getGitHubUpdates: vi.fn(),
  loggerWarn: vi.fn(),
}));

vi.mock('../middleware/auth', () => ({
  requireLogin: (req: { user?: { id: number; email: string; isAdmin: boolean } }, _res: unknown, next: () => void) => {
    req.user = { id: 1, email: 'test@example.com', isAdmin: false };
    next();
  },
}));

vi.mock('../services/github-updates-service', () => ({
  getGitHubUpdates: mocks.getGitHubUpdates,
}));

vi.mock('../services/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: mocks.loggerWarn,
    error: vi.fn(),
  },
}));

import updatesRouter from '../routes/updates';

function createApp() {
  const app = express();
  app.use('/api/updates', updatesRouter);
  return app;
}

describe('updates route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns github updates payload', async () => {
    const app = createApp();
    mocks.getGitHubUpdates.mockResolvedValue({
      repository: 'owner/repo',
      source: 'github_releases',
      stale: false,
      fetchedAt: '2026-02-25T00:00:00.000Z',
      items: [
        {
          id: '1',
          tag: 'v1.0.0',
          title: 'Initial Release',
          body: 'First release.',
          url: 'https://github.com/owner/repo/releases/tag/v1.0.0',
          publishedAt: '2026-02-20T00:00:00.000Z',
          prerelease: false,
        },
      ],
    });

    const response = await request(app).get('/api/updates/github');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      repository: 'owner/repo',
      items: expect.arrayContaining([
        expect.objectContaining({
          tag: 'v1.0.0',
          title: 'Initial Release',
        }),
      ]),
    }));
  });

  it('returns 502 when github updates fetch fails', async () => {
    const app = createApp();
    mocks.getGitHubUpdates.mockRejectedValue(new Error('upstream error'));

    const response = await request(app).get('/api/updates/github');

    expect(response.status).toBe(502);
    expect(response.body).toEqual({
      error: 'GitHubのアップデート取得に失敗しました。しばらくしてから再試行してください',
    });
    expect(mocks.loggerWarn).toHaveBeenCalledTimes(1);
  });

  it('returns 502 and stringifies non-Error rejection reason', async () => {
    const app = createApp();
    mocks.getGitHubUpdates.mockRejectedValue('upstream-string-error');

    const response = await request(app).get('/api/updates/github');

    expect(response.status).toBe(502);
    expect(mocks.loggerWarn).toHaveBeenCalledWith(
      'Failed to fetch GitHub updates',
      { error: 'upstream-string-error' },
    );
  });
});
