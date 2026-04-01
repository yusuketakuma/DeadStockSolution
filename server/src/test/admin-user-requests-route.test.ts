import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
  },
  parsePositiveInt: vi.fn((value: unknown) => {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }),
  getAdminRequestDetail: vi.fn(),
  recordOpenClawRequestMessage: vi.fn(),
  createRequestMessageAttachments: vi.fn(),
  updateRequestActivity: vi.fn(),
  touchRequestViewed: vi.fn(),
  updateOpenClawWorkItem: vi.fn(),
  buildOpenClawConversationContext: vi.fn(),
  buildOpenClawLogContext: vi.fn(),
  handoffToOpenClaw: vi.fn(),
  mapOpenClawStatusToWorkflowStatus: vi.fn(),
  isMissingOpenClawSchemaError: vi.fn(),
  createNotification: vi.fn(),
  publishAdminRequestsRefresh: vi.fn(),
  publishRequestsRefresh: vi.fn(),
}));

function mockDependencies() {
  vi.doMock('../config/database', () => ({ db: mocks.db }));
  vi.doMock('../utils/request-utils', () => ({
    normalizeSearchTerm: vi.fn((value: unknown) => (typeof value === 'string' ? value.trim() : '')),
    parsePositiveInt: mocks.parsePositiveInt,
  }));
  vi.doMock('../services/openclaw/thread-service', () => ({
    buildOpenClawConversationContext: mocks.buildOpenClawConversationContext,
    isMissingOpenClawSchemaError: mocks.isMissingOpenClawSchemaError,
    listOpenClawRequestMessages: vi.fn(),
    mapOpenClawStatusToWorkflowStatus: mocks.mapOpenClawStatusToWorkflowStatus,
    recordOpenClawRequestMessage: mocks.recordOpenClawRequestMessage,
    updateOpenClawWorkItem: mocks.updateOpenClawWorkItem,
  }));
  vi.doMock('../services/openclaw/log-context-service', () => ({
    buildOpenClawLogContext: mocks.buildOpenClawLogContext,
  }));
  vi.doMock('../services/openclaw', () => ({
    handoffToOpenClaw: mocks.handoffToOpenClaw,
  }));
  vi.doMock('../services/request-collaboration-service', () => ({
    addRequestInternalNote: vi.fn(),
    createRequestMessageAttachments: mocks.createRequestMessageAttachments,
    getAdminRequestDetail: mocks.getAdminRequestDetail,
    getRequestAttachmentDownload: vi.fn(),
    isRequestCategory: vi.fn(),
    isRequestCloseReason: vi.fn(),
    isRequestPriority: vi.fn(),
    listRequestAssigneeOptions: vi.fn(),
    listRequestInternalNotes: vi.fn(),
    touchRequestViewed: mocks.touchRequestViewed,
    updateRequestActivity: mocks.updateRequestActivity,
    updateRequestAdminMetadata: vi.fn(),
  }));
  vi.doMock('../services/admin-user-request-service', () => ({
    listUserRequests: vi.fn(),
  }));
  vi.doMock('../services/openclaw/request-event-service', () => ({
    listRequestEventTimeline: vi.fn(),
  }));
  vi.doMock('../services/notification-service', () => ({
    createNotification: mocks.createNotification,
  }));
  vi.doMock('../routes/admin-utils', () => ({
    handleAdminError: vi.fn((_err: unknown, _ctx: string, message: string, res: express.Response) => {
      res.status(500).json({ error: message });
    }),
    parseListPagination: vi.fn(() => ({ page: 1, limit: 20, offset: 0 })),
    sendPaginated: vi.fn(),
  }));
  vi.doMock('../middleware/attachment-upload', () => ({
    uploadOptionalAttachments: (_req: unknown, _res: unknown, next: () => void) => next(),
  }));
  vi.doMock('../services/realtime-service', () => ({
    publishAdminRequestsRefresh: mocks.publishAdminRequestsRefresh,
    publishRequestsRefresh: mocks.publishRequestsRefresh,
  }));
  vi.doMock('../services/logger', () => ({
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  }));
  vi.doMock('drizzle-orm', () => ({
    eq: vi.fn(() => ({})),
  }));
}

async function createApp() {
  vi.resetModules();
  mockDependencies();
  const { default: router } = await import('../routes/admin-user-requests');
  const app = express();
  app.use(express.json());
  app.use('/admin', router);
  return app;
}

describe('POST /admin/user-requests/:id/messages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mapOpenClawStatusToWorkflowStatus.mockReturnValue('implementing');
    mocks.isMissingOpenClawSchemaError.mockReturnValue(false);
  });

  it('creates a request notification for the pharmacy after admin reply', async () => {
    const app = await createApp();
    mocks.getAdminRequestDetail.mockResolvedValue({
      id: 12,
      pharmacyId: 44,
      requestText: '在庫連携を改善したい',
      openclawStatus: 'in_dialogue',
      openclawThreadId: 'thread-12',
    });
    mocks.db.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ workflowStatus: 'awaiting_user' }]),
        }),
      }),
    });
    mocks.recordOpenClawRequestMessage.mockResolvedValue({ id: 91 });
    mocks.buildOpenClawConversationContext.mockResolvedValue([]);
    mocks.buildOpenClawLogContext.mockResolvedValue({ recent: [] });
    mocks.handoffToOpenClaw.mockResolvedValue({
      accepted: true,
      connectorConfigured: true,
      implementationBranch: 'main',
      note: 'queued',
      status: 'implementing',
      threadId: 'thread-12',
      summary: '再解析を開始しました',
    });
    mocks.db.update.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    });

    const res = await request(app)
      .post('/admin/user-requests/12/messages')
      .send({ message: '追加の確認結果です' });

    expect(res.status).toBe(200);
    expect(mocks.createNotification).toHaveBeenCalledWith(expect.objectContaining({
      pharmacyId: 44,
      type: 'request_update',
      title: '要望に管理者から返信がありました',
      referenceId: 12,
      detailJson: expect.objectContaining({
        source: 'admin_reply',
        messageId: 91,
      }),
    }));
    expect(mocks.publishRequestsRefresh).toHaveBeenCalledWith({
      pharmacyId: 44,
      requestId: 12,
      reason: 'admin_reply_created',
    });
  });
});
