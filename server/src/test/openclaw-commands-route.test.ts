import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  isOpenClawWebhookConfigured: vi.fn(),
  verifyOpenClawWebhookSignature: vi.fn(),
  isOpenClawWebhookReplay: vi.fn(),
  consumeOpenClawWebhookReplay: vi.fn(),
  releaseOpenClawWebhookReplay: vi.fn(),
  executeCommand: vi.fn(),
  listCommandHistory: vi.fn(),
  parseListPagination: vi.fn(() => ({ page: 1, limit: 50, offset: 0 })),
  handleAdminError: vi.fn((_err: unknown, _logCtx: string, msg: string, res: express.Response) => {
    res.status(500).json({ error: msg });
  }),
}));

vi.mock('../services/openclaw-service', () => ({
  isOpenClawWebhookConfigured: mocks.isOpenClawWebhookConfigured,
  verifyOpenClawWebhookSignature: mocks.verifyOpenClawWebhookSignature,
  isOpenClawWebhookReplay: mocks.isOpenClawWebhookReplay,
  consumeOpenClawWebhookReplay: mocks.consumeOpenClawWebhookReplay,
  releaseOpenClawWebhookReplay: mocks.releaseOpenClawWebhookReplay,
}));

vi.mock('../services/openclaw-command-service', () => ({
  executeCommand: mocks.executeCommand,
  listCommandHistory: mocks.listCommandHistory,
}));

vi.mock('../services/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../routes/admin-utils', () => ({
  parseListPagination: mocks.parseListPagination,
  handleAdminError: mocks.handleAdminError,
}));

// requireLogin and requireAdmin mocks — default: pass as admin
let mockUser: { id: number; email: string; isAdmin: boolean } | undefined = {
  id: 1,
  email: 'admin@example.com',
  isAdmin: true,
};

vi.mock('../middleware/auth', () => ({
  requireLogin: (req: { user?: typeof mockUser }, _res: unknown, next: () => void) => {
    if (!mockUser) {
      const res = _res as express.Response;
      res.status(401).json({ error: 'ログインが必要です' });
      return;
    }
    req.user = mockUser;
    next();
  },
  requireAdmin: (req: { user?: typeof mockUser }, _res: unknown, next: () => void) => {
    if (!req.user?.isAdmin) {
      const res = _res as express.Response;
      res.status(403).json({ error: '管理者権限が必要です' });
      return;
    }
    next();
  },
}));

import openclawCommandsRouter from '../routes/openclaw-commands';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/openclaw-commands', openclawCommandsRouter);
  return app;
}

const VALID_SIGNATURE = 'sha256=abc123';
const VALID_TIMESTAMP = '1700000000';

describe('POST /api/openclaw-commands', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockUser = { id: 1, email: 'admin@example.com', isAdmin: true };
    // Default: feature enabled, webhook configured
    process.env.OPENCLAW_COMMANDS_ENABLED = 'true';
    mocks.isOpenClawWebhookConfigured.mockReturnValue(true);
    mocks.verifyOpenClawWebhookSignature.mockReturnValue(true);
    mocks.isOpenClawWebhookReplay.mockReturnValue(false);
    mocks.consumeOpenClawWebhookReplay.mockReturnValue(true);
    mocks.executeCommand.mockResolvedValue({ status: 'ok', result: 'done' });
  });

  afterEach(() => {
    delete process.env.OPENCLAW_COMMANDS_ENABLED;
  });

  it('returns 503 when feature is disabled', async () => {
    process.env.OPENCLAW_COMMANDS_ENABLED = 'false';
    const app = createApp();
    const res = await request(app)
      .post('/api/openclaw-commands')
      .set('x-openclaw-signature', VALID_SIGNATURE)
      .set('x-openclaw-timestamp', VALID_TIMESTAMP)
      .send({ command: 'ping' });
    expect(res.status).toBe(503);
    expect(res.body.error).toBeDefined();
  });

  it('returns 503 when OPENCLAW_COMMANDS_ENABLED env var is not set', async () => {
    delete process.env.OPENCLAW_COMMANDS_ENABLED;
    const app = createApp();
    const res = await request(app)
      .post('/api/openclaw-commands')
      .set('x-openclaw-signature', VALID_SIGNATURE)
      .set('x-openclaw-timestamp', VALID_TIMESTAMP)
      .send({ command: 'ping' });
    expect(res.status).toBe(503);
  });

  it('returns 503 when webhook is not configured', async () => {
    mocks.isOpenClawWebhookConfigured.mockReturnValue(false);
    const app = createApp();
    const res = await request(app)
      .post('/api/openclaw-commands')
      .set('x-openclaw-signature', VALID_SIGNATURE)
      .set('x-openclaw-timestamp', VALID_TIMESTAMP)
      .send({ command: 'ping' });
    expect(res.status).toBe(503);
    expect(res.body.error).toContain('未設定');
  });

  it('returns 401 when signature header is missing and verification fails', async () => {
    mocks.verifyOpenClawWebhookSignature.mockReturnValue(false);
    const app = createApp();
    const res = await request(app)
      .post('/api/openclaw-commands')
      .send({ command: 'ping' });
    expect(res.status).toBe(401);
    expect(res.body.error).toContain('認証に失敗しました');
  });

  it('returns 401 when signature is invalid', async () => {
    mocks.verifyOpenClawWebhookSignature.mockReturnValue(false);
    const app = createApp();
    const res = await request(app)
      .post('/api/openclaw-commands')
      .set('x-openclaw-signature', 'bad-sig')
      .set('x-openclaw-timestamp', VALID_TIMESTAMP)
      .send({ command: 'ping' });
    expect(res.status).toBe(401);
    expect(res.body.error).toContain('認証に失敗しました');
  });

  it('returns 401 when request is a replay', async () => {
    mocks.isOpenClawWebhookReplay.mockReturnValue(true);
    const app = createApp();
    const res = await request(app)
      .post('/api/openclaw-commands')
      .set('x-openclaw-signature', VALID_SIGNATURE)
      .set('x-openclaw-timestamp', VALID_TIMESTAMP)
      .send({ command: 'ping' });
    expect(res.status).toBe(401);
  });

  it('returns 401 when consumeOpenClawWebhookReplay returns false', async () => {
    mocks.consumeOpenClawWebhookReplay.mockReturnValue(false);
    const app = createApp();
    const res = await request(app)
      .post('/api/openclaw-commands')
      .set('x-openclaw-signature', VALID_SIGNATURE)
      .set('x-openclaw-timestamp', VALID_TIMESTAMP)
      .send({ command: 'ping' });
    expect(res.status).toBe(401);
  });

  it('returns 400 when command field is missing', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/openclaw-commands')
      .set('x-openclaw-signature', VALID_SIGNATURE)
      .set('x-openclaw-timestamp', VALID_TIMESTAMP)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('command フィールドが必要です');
    expect(mocks.releaseOpenClawWebhookReplay).toHaveBeenCalledTimes(1);
  });

  it('returns 400 when command is not a string', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/openclaw-commands')
      .set('x-openclaw-signature', VALID_SIGNATURE)
      .set('x-openclaw-timestamp', VALID_TIMESTAMP)
      .send({ command: 42 });
    expect(res.status).toBe(400);
  });

  it('returns 200 when valid command is received and executed successfully', async () => {
    mocks.executeCommand.mockResolvedValue({ status: 'ok', result: 'done' });
    const app = createApp();
    const res = await request(app)
      .post('/api/openclaw-commands')
      .set('x-openclaw-signature', VALID_SIGNATURE)
      .set('x-openclaw-timestamp', VALID_TIMESTAMP)
      .send({ command: 'list-tasks', parameters: { filter: 'open' }, threadId: 'thread-1', reason: 'test' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(mocks.executeCommand).toHaveBeenCalledWith(
      { command: 'list-tasks', parameters: { filter: 'open' }, threadId: 'thread-1', reason: 'test' },
      VALID_SIGNATURE,
    );
  });

  it('returns 403 when command is rejected', async () => {
    mocks.executeCommand.mockResolvedValue({ status: 'rejected', reason: 'not allowed' });
    const app = createApp();
    const res = await request(app)
      .post('/api/openclaw-commands')
      .set('x-openclaw-signature', VALID_SIGNATURE)
      .set('x-openclaw-timestamp', VALID_TIMESTAMP)
      .send({ command: 'dangerous-command' });
    expect(res.status).toBe(403);
    expect(res.body.status).toBe('rejected');
  });

  it('returns 500 when command execution fails', async () => {
    mocks.executeCommand.mockResolvedValue({ status: 'failed', error: 'something went wrong' });
    const app = createApp();
    const res = await request(app)
      .post('/api/openclaw-commands')
      .set('x-openclaw-signature', VALID_SIGNATURE)
      .set('x-openclaw-timestamp', VALID_TIMESTAMP)
      .send({ command: 'broken-command' });
    expect(res.status).toBe(500);
    expect(res.body.status).toBe('failed');
  });

  it('returns 500 and releases replay when executeCommand throws', async () => {
    mocks.executeCommand.mockRejectedValue(new Error('unexpected error'));
    const app = createApp();
    const res = await request(app)
      .post('/api/openclaw-commands')
      .set('x-openclaw-signature', VALID_SIGNATURE)
      .set('x-openclaw-timestamp', VALID_TIMESTAMP)
      .send({ command: 'throws-command' });
    expect(res.status).toBe(500);
    expect(mocks.releaseOpenClawWebhookReplay).toHaveBeenCalledTimes(1);
  });
});

describe('GET /api/openclaw-commands/history', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockUser = { id: 1, email: 'admin@example.com', isAdmin: true };
    mocks.parseListPagination.mockReturnValue({ page: 1, limit: 50, offset: 0 });
    mocks.listCommandHistory.mockResolvedValue([]);
  });

  it('returns 401 when unauthenticated', async () => {
    mockUser = undefined;
    const app = createApp();
    const res = await request(app).get('/api/openclaw-commands/history');
    expect(res.status).toBe(401);
  });

  it('returns 403 when user is not admin', async () => {
    mockUser = { id: 2, email: 'user@example.com', isAdmin: false };
    const app = createApp();
    const res = await request(app).get('/api/openclaw-commands/history');
    expect(res.status).toBe(403);
  });

  it('returns 200 with empty history for admin', async () => {
    mocks.listCommandHistory.mockResolvedValue([]);
    const app = createApp();
    const res = await request(app).get('/api/openclaw-commands/history');
    expect(res.status).toBe(200);
    expect(res.body.commands).toEqual([]);
    expect(res.body.limit).toBe(50);
    expect(res.body.offset).toBe(0);
  });

  it('returns 200 with command history for admin', async () => {
    const history = [
      { id: 1, command: 'list-tasks', status: 'ok', executedAt: '2026-03-01T10:00:00Z' },
      { id: 2, command: 'close-issue', status: 'ok', executedAt: '2026-03-02T10:00:00Z' },
    ];
    mocks.listCommandHistory.mockResolvedValue(history);
    const app = createApp();
    const res = await request(app).get('/api/openclaw-commands/history');
    expect(res.status).toBe(200);
    expect(res.body.commands).toHaveLength(2);
    expect(res.body.commands[0].command).toBe('list-tasks');
  });

  it('returns 200 with pagination params passed to service', async () => {
    mocks.parseListPagination.mockReturnValue({ page: 2, limit: 10, offset: 10 });
    mocks.listCommandHistory.mockResolvedValue([]);
    const app = createApp();
    const res = await request(app).get('/api/openclaw-commands/history?page=2&limit=10');
    expect(res.status).toBe(200);
    expect(res.body.limit).toBe(10);
    expect(res.body.offset).toBe(10);
    expect(mocks.listCommandHistory).toHaveBeenCalledWith(10, 10);
  });

  it('calls handleAdminError when listCommandHistory throws', async () => {
    mocks.listCommandHistory.mockRejectedValue(new Error('db error'));
    const app = createApp();
    const res = await request(app).get('/api/openclaw-commands/history');
    expect(res.status).toBe(500);
    expect(mocks.handleAdminError).toHaveBeenCalledTimes(1);
  });
});
