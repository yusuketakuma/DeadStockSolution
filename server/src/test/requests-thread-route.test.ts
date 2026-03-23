import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  },
  buildOpenClawLogContext: vi.fn(),
  handoffToOpenClaw: vi.fn(),
  ensureOpenClawWorkItem: vi.fn(),
  recordOpenClawRequestMessage: vi.fn(),
  buildOpenClawConversationContext: vi.fn(),
  listOpenClawRequestMessages: vi.fn(),
  updateOpenClawWorkItem: vi.fn(),
  mapOpenClawStatusToWorkflowStatus: vi.fn(),
  loggerError: vi.fn(),
  loggerWarn: vi.fn(),
}));

vi.mock('../middleware/auth', () => ({
  requireLogin: (req: { user?: { id: number; email: string; isAdmin: boolean } }, _res: unknown, next: () => void) => {
    req.user = { id: 9, email: 'user@example.com', isAdmin: false };
    next();
  },
}));

vi.mock('../config/database', () => ({
  db: mocks.db,
}));

vi.mock('../services/openclaw-log-context-service', () => ({
  buildOpenClawLogContext: mocks.buildOpenClawLogContext,
}));

vi.mock('../services/openclaw-service', () => ({
  handoffToOpenClaw: mocks.handoffToOpenClaw,
}));

vi.mock('../services/openclaw-thread-service', () => ({
  ensureOpenClawWorkItem: mocks.ensureOpenClawWorkItem,
  recordOpenClawRequestMessage: mocks.recordOpenClawRequestMessage,
  buildOpenClawConversationContext: mocks.buildOpenClawConversationContext,
  listOpenClawRequestMessages: mocks.listOpenClawRequestMessages,
  updateOpenClawWorkItem: mocks.updateOpenClawWorkItem,
  mapOpenClawStatusToWorkflowStatus: mocks.mapOpenClawStatusToWorkflowStatus,
}));

vi.mock('../services/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: mocks.loggerWarn,
    error: mocks.loggerError,
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(() => ({})),
  desc: vi.fn(() => ({})),
}));

import requestsRouter from '../routes/requests';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/requests', requestsRouter);
  return app;
}

function createLimitQuery(result: unknown) {
  const query = {
    from: vi.fn(),
    leftJoin: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
    orderBy: vi.fn(),
  };
  query.from.mockReturnValue(query);
  query.leftJoin.mockReturnValue(query);
  query.where.mockReturnValue(query);
  query.orderBy.mockReturnValue(query);
  query.limit.mockResolvedValue(result);
  return query;
}

describe('requests routes — thread flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.buildOpenClawLogContext.mockResolvedValue({ importFailures: { total: 1 } });
    mocks.buildOpenClawConversationContext.mockResolvedValue({
      latestMessageId: 1,
      messages: [{ id: 1, authorType: 'user', messageType: 'message', body: 'test', createdAt: '2026-03-23T00:00:00Z', metadata: null }],
      workItem: { workItemType: 'user_report', workflowStatus: 'queued', latestSummary: null, branchName: null, prUrl: null, prNumber: null, lastQuestion: null, lastError: null },
    });
    mocks.mapOpenClawStatusToWorkflowStatus.mockReturnValue('analyzing');
  });

  it('POST / creates a request and hands it off with conversation context', async () => {
    const app = createApp();
    mocks.db.insert.mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: 11, openclawStatus: 'pending_handoff', createdAt: '2026-03-23T00:00:00Z' }]),
      }),
    });
    mocks.handoffToOpenClaw.mockResolvedValue({
      accepted: true,
      connectorConfigured: true,
      implementationBranch: 'review',
      status: 'in_dialogue',
      threadId: 'thread-11',
      summary: '解析を開始します',
      note: 'OpenClawに連携しました',
    });
    mocks.db.update.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    });

    const res = await request(app)
      .post('/api/requests')
      .send({ message: 'ログを見て改善してください' });

    expect(res.status).toBe(201);
    expect(mocks.ensureOpenClawWorkItem).toHaveBeenCalledWith(expect.objectContaining({
      requestId: 11,
      pharmacyId: 9,
      workflowStatus: 'queued',
    }));
    expect(mocks.recordOpenClawRequestMessage).toHaveBeenCalledWith(expect.objectContaining({
      requestId: 11,
      authorType: 'user',
      body: 'ログを見て改善してください',
    }));
    expect(mocks.handoffToOpenClaw).toHaveBeenCalledWith(expect.objectContaining({
      requestId: 11,
      handoffKey: 'initial',
      context: expect.objectContaining({
        source: 'user_request',
        conversation: expect.any(Object),
      }),
    }));
  });

  it('GET /:id/messages returns thread for the owning user', async () => {
    const app = createApp();
    mocks.db.select.mockReturnValue(createLimitQuery([{
      id: 12,
      pharmacyId: 9,
      requestText: '改善要望',
      openclawStatus: 'in_dialogue',
      openclawThreadId: 'thread-12',
      openclawSummary: '要約',
      createdAt: '2026-03-23T00:00:00Z',
      updatedAt: '2026-03-23T00:00:00Z',
      workflowStatus: 'awaiting_user',
      latestSummary: '追加情報待ち',
      lastQuestion: 'OSを教えてください',
      branchName: null,
      prUrl: null,
      prNumber: null,
      lastError: null,
    }]));
    mocks.listOpenClawRequestMessages.mockResolvedValue([
      { id: 1, authorType: 'user', messageType: 'message', body: '改善要望', createdAt: '2026-03-23T00:00:00Z', metadata: null },
      { id: 2, authorType: 'openclaw_agent', messageType: 'question', body: 'OSを教えてください', createdAt: '2026-03-23T00:01:00Z', metadata: null },
    ]);

    const res = await request(app)
      .get('/api/requests/12/messages');

    expect(res.status).toBe(200);
    expect(res.body.messages).toHaveLength(2);
    expect(res.body.request.workflowStatus).toBe('awaiting_user');
  });

  it('POST /:id/messages records a user reply and re-handoffs with a new handoff key', async () => {
    const app = createApp();
    mocks.db.select.mockReturnValue(createLimitQuery([{
      id: 13,
      pharmacyId: 9,
      requestText: '元の要望',
      openclawStatus: 'in_dialogue',
      openclawThreadId: 'thread-13',
      workflowStatus: 'awaiting_user',
      lastQuestion: 'OSを教えてください',
    }]));
    mocks.recordOpenClawRequestMessage.mockResolvedValue({ id: 44 });
    mocks.handoffToOpenClaw.mockResolvedValue({
      accepted: true,
      connectorConfigured: true,
      implementationBranch: 'review',
      status: 'in_dialogue',
      threadId: 'thread-13',
      summary: '追加情報を確認します',
      note: '再連携しました',
    });
    mocks.db.update.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    });

    const res = await request(app)
      .post('/api/requests/13/messages')
      .send({ message: 'macOSです。再現条件はAです。' });

    expect(res.status).toBe(200);
    expect(mocks.recordOpenClawRequestMessage).toHaveBeenCalledWith(expect.objectContaining({
      requestId: 13,
      authorType: 'user',
      body: 'macOSです。再現条件はAです。',
    }));
    expect(mocks.handoffToOpenClaw).toHaveBeenCalledWith(expect.objectContaining({
      requestId: 13,
      handoffKey: 'message-44',
      context: expect.objectContaining({
        source: 'user_request_follow_up',
        threadId: 'thread-13',
        followUp: expect.objectContaining({
          type: 'user_reply',
          messageId: 44,
          message: 'macOSです。再現条件はAです。',
          previousWorkflowStatus: 'awaiting_user',
          lastQuestion: 'OSを教えてください',
          resumePolicy: 'continue_existing_case_without_reset',
        }),
      }),
    }));
    expect(mocks.updateOpenClawWorkItem).toHaveBeenCalledWith(expect.objectContaining({
      requestId: 13,
      workflowStatus: 'analyzing',
      latestSummary: '追加情報を受領し、再解析を開始しました',
      lastQuestion: null,
      lastError: null,
    }));
  });
});
