import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  registerDdsAgent: vi.fn(),
  claimNextDdsJob: vi.fn(),
  heartbeatDdsAgent: vi.fn(),
  getDdsWorkItemAttachmentDownload: vi.fn(),
  postDdsQuestion: vi.fn(),
  reportDdsPullRequest: vi.fn(),
  completeDdsWorkItem: vi.fn(),
}));

vi.mock('../services/dds-agent-service', () => ({
  registerDdsAgent: mocks.registerDdsAgent,
  claimNextDdsJob: mocks.claimNextDdsJob,
  heartbeatDdsAgent: mocks.heartbeatDdsAgent,
  getDdsWorkItemAttachmentDownload: mocks.getDdsWorkItemAttachmentDownload,
  postDdsQuestion: mocks.postDdsQuestion,
  reportDdsPullRequest: mocks.reportDdsPullRequest,
  completeDdsWorkItem: mocks.completeDdsWorkItem,
}));

vi.mock('../services/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

let openclawConnectRouter: express.Router;

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/openclaw/connect', openclawConnectRouter);
  return app;
}

const VALID_TOKEN = 'test-control-token-abc123';
const AUTH_HEADER = `Bearer ${VALID_TOKEN}`;

describe('openclaw-connect routes', () => {
  beforeEach(async () => {
    vi.resetModules();
    const { default: router } = await import('../routes/openclaw-connect');
    openclawConnectRouter = router;
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('POST /register', () => {
    it('should return 400 when bootstrapToken is missing', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/openclaw/connect/register')
        .send({ agentId: 'agent-1', agentName: 'DDS Agent' });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('bootstrapToken');
    });

    it('should register agent successfully', async () => {
      mocks.registerDdsAgent.mockResolvedValue({
        controlToken: 'control-token',
        environment: 'production',
        claimUrl: 'https://example.com/api/openclaw/connect/jobs/claim',
        heartbeatUrl: 'https://example.com/api/openclaw/connect/heartbeat',
        callbackUrl: 'https://example.com/api/openclaw/callback',
        commandsUrl: 'https://example.com/api/openclaw/commands',
        workItemQuestionUrl: 'https://example.com/api/openclaw/connect/work-items/:id/question',
        workItemPrUrl: 'https://example.com/api/openclaw/connect/work-items/:id/pr',
        webhookSecret: 'secret',
        pollIntervalSeconds: 90,
        implementationBranch: 'review',
      });

      const app = createApp();
      const res = await request(app)
        .post('/api/openclaw/connect/register')
        .send({
          bootstrapToken: 'bootstrap-123',
          agentId: 'agent-1',
          agentName: 'DDS Agent',
          deviceLabel: 'MacBook',
          openclawVersion: '1.2.3',
        });

      expect(res.status).toBe(201);
      expect(mocks.registerDdsAgent).toHaveBeenCalledWith({
        bootstrapToken: 'bootstrap-123',
        agentId: 'agent-1',
        agentName: 'DDS Agent',
        deviceLabel: 'MacBook',
        openclawVersion: '1.2.3',
      });
      expect(res.body.controlToken).toBe('control-token');
    });
  });

  describe('POST /jobs/claim', () => {
    it('should return 401 when no authorization header', async () => {
      const app = createApp();
      const res = await request(app).post('/api/openclaw/connect/jobs/claim');
      expect(res.status).toBe(401);
      expect(res.body.error).toContain('Authorization');
    });

    it('should return 204 when no jobs available', async () => {
      mocks.claimNextDdsJob.mockResolvedValue(null);
      const app = createApp();
      const res = await request(app)
        .post('/api/openclaw/connect/jobs/claim')
        .set('Authorization', AUTH_HEADER);
      expect(res.status).toBe(204);
      expect(mocks.claimNextDdsJob).toHaveBeenCalledWith(VALID_TOKEN);
    });

    it('should return job data when a job is available', async () => {
      const jobData = {
        jobId: 1,
        leaseToken: 'lease-abc',
        leaseExpiresAt: '2026-03-24T12:00:00Z',
        workItem: {
          id: 10,
          type: 'product_update',
          workflowStatus: 'queued',
          requestId: 5,
          pharmacyId: 2,
          pharmacyName: 'テスト薬局',
          requestText: 'テスト要望',
          summary: 'テスト要望を確認しました',
          source: 'user_request',
          context: null,
          category: 'improvement',
          priority: 'normal',
          closeReason: null,
          assignedAdminId: null,
          assignedAdminName: null,
          waitingOn: 'admin',
          isOverdue: false,
          openclawStatus: 'in_dialogue',
          internalNotes: [],
          conversation: [],
        },
      };
      mocks.claimNextDdsJob.mockResolvedValue(jobData);
      const app = createApp();
      const res = await request(app)
        .post('/api/openclaw/connect/jobs/claim')
        .set('Authorization', AUTH_HEADER);
      expect(res.status).toBe(200);
      expect(res.body.jobId).toBe(1);
      expect(res.body.workItem.id).toBe(10);
    });

    it('should return 401 when service throws ApiError(401)', async () => {
      const err = new Error('control token が不正です');
      (err as unknown as { status: number }).status = 401;
      mocks.claimNextDdsJob.mockRejectedValue(err);
      const app = createApp();
      const res = await request(app)
        .post('/api/openclaw/connect/jobs/claim')
        .set('Authorization', AUTH_HEADER);
      expect(res.status).toBe(401);
    });
  });

  describe('POST /heartbeat', () => {
    it('should return 401 when no authorization header', async () => {
      const app = createApp();
      const res = await request(app).post('/api/openclaw/connect/heartbeat');
      expect(res.status).toBe(401);
    });

    it('should return ok on valid heartbeat', async () => {
      mocks.heartbeatDdsAgent.mockResolvedValue(undefined);
      const app = createApp();
      const res = await request(app)
        .post('/api/openclaw/connect/heartbeat')
        .set('Authorization', AUTH_HEADER)
        .send({ version: '1.0.0' });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(mocks.heartbeatDdsAgent).toHaveBeenCalledWith(VALID_TOKEN, { version: '1.0.0' });
    });

    it('should pass undefined payload when body is empty', async () => {
      mocks.heartbeatDdsAgent.mockResolvedValue(undefined);
      const app = createApp();
      const res = await request(app)
        .post('/api/openclaw/connect/heartbeat')
        .set('Authorization', AUTH_HEADER);
      expect(res.status).toBe(200);
      expect(mocks.heartbeatDdsAgent).toHaveBeenCalledWith(VALID_TOKEN, undefined);
    });
  });

  describe('POST /work-items/:id/question', () => {
    it('should return 401 when no authorization header', async () => {
      const app = createApp();
      const res = await request(app).post('/api/openclaw/connect/work-items/1/question');
      expect(res.status).toBe(401);
    });

    it('should return 400 when work item ID is invalid', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/openclaw/connect/work-items/abc/question')
        .set('Authorization', AUTH_HEADER)
        .send({ leaseToken: 'lease-abc', body: '質問です' });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('work item ID');
    });

    it('should return 400 when body is empty', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/openclaw/connect/work-items/1/question')
        .set('Authorization', AUTH_HEADER)
        .send({ leaseToken: 'lease-1', body: '' });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('質問本文');
    });

    it('should return 400 when leaseToken is missing', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/openclaw/connect/work-items/1/question')
        .set('Authorization', AUTH_HEADER)
        .send({ body: '質問です' });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('leaseToken');
    });

    it('should post question successfully', async () => {
      mocks.postDdsQuestion.mockResolvedValue(undefined);
      const app = createApp();
      const res = await request(app)
        .post('/api/openclaw/connect/work-items/42/question')
        .set('Authorization', AUTH_HEADER)
        .send({ leaseToken: 'lease-42', body: 'この薬品の在庫状況を教えてください' });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(mocks.postDdsQuestion).toHaveBeenCalledWith(
        VALID_TOKEN,
        42,
        'lease-42',
        'この薬品の在庫状況を教えてください',
      );
    });

    it('should return 404 when service throws ApiError(404)', async () => {
      const err = new Error('対象 work item が見つかりません');
      (err as unknown as { status: number }).status = 404;
      mocks.postDdsQuestion.mockRejectedValue(err);
      const app = createApp();
      const res = await request(app)
        .post('/api/openclaw/connect/work-items/999/question')
        .set('Authorization', AUTH_HEADER)
        .send({ leaseToken: 'lease-999', body: '質問です' });
      expect(res.status).toBe(404);
    });
  });

  describe('POST /work-items/:id/pr', () => {
    it('should return 401 when no authorization header', async () => {
      const app = createApp();
      const res = await request(app).post('/api/openclaw/connect/work-items/1/pr');
      expect(res.status).toBe(401);
    });

    it('should return 400 when work item ID is invalid', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/openclaw/connect/work-items/0/pr')
        .set('Authorization', AUTH_HEADER)
        .send({ leaseToken: 'lease-0', branchName: 'fix/test', prUrl: 'https://github.com/test/pr/1', summary: 'test' });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('work item ID');
    });

    it('should return 400 when branchName is missing', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/openclaw/connect/work-items/1/pr')
        .set('Authorization', AUTH_HEADER)
        .send({ leaseToken: 'lease-1', prUrl: 'https://github.com/test/pr/1', summary: 'test' });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('branchName');
    });

    it('should return 400 when prUrl is missing', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/openclaw/connect/work-items/1/pr')
        .set('Authorization', AUTH_HEADER)
        .send({ leaseToken: 'lease-1', branchName: 'fix/test', summary: 'test' });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('prUrl');
    });

    it('should return 400 when leaseToken is missing', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/openclaw/connect/work-items/1/pr')
        .set('Authorization', AUTH_HEADER)
        .send({ branchName: 'fix/test', prUrl: 'https://github.com/test/pr/1', summary: 'test' });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('leaseToken');
    });

    it('should report PR successfully', async () => {
      mocks.reportDdsPullRequest.mockResolvedValue(undefined);
      const app = createApp();
      const res = await request(app)
        .post('/api/openclaw/connect/work-items/10/pr')
        .set('Authorization', AUTH_HEADER)
        .send({
          leaseToken: 'lease-10',
          branchName: 'fix/dead-stock-issue',
          prNumber: 42,
          prUrl: 'https://github.com/org/repo/pull/42',
          summary: 'デッドストック問題を修正しました',
        });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(mocks.reportDdsPullRequest).toHaveBeenCalledWith(VALID_TOKEN, {
        workItemId: 10,
        leaseToken: 'lease-10',
        branchName: 'fix/dead-stock-issue',
        prNumber: 42,
        prUrl: 'https://github.com/org/repo/pull/42',
        summary: 'デッドストック問題を修正しました',
      });
    });

    it('should handle missing prNumber gracefully', async () => {
      mocks.reportDdsPullRequest.mockResolvedValue(undefined);
      const app = createApp();
      const res = await request(app)
        .post('/api/openclaw/connect/work-items/10/pr')
        .set('Authorization', AUTH_HEADER)
        .send({
          leaseToken: 'lease-10',
          branchName: 'fix/test',
          prUrl: 'https://github.com/org/repo/pull/1',
        });
      expect(res.status).toBe(200);
      expect(mocks.reportDdsPullRequest).toHaveBeenCalledWith(VALID_TOKEN, expect.objectContaining({
        leaseToken: 'lease-10',
        prNumber: null,
        summary: '',
      }));
    });
  });

  describe('GET /work-items/:id/attachments/:attachmentId', () => {
    it('should return 401 when no authorization header', async () => {
      const app = createApp();
      const res = await request(app).get('/api/openclaw/connect/work-items/1/attachments/2');
      expect(res.status).toBe(401);
    });

    it('should return 400 when work item ID is invalid', async () => {
      const app = createApp();
      const res = await request(app)
        .get('/api/openclaw/connect/work-items/0/attachments/2')
        .set('Authorization', AUTH_HEADER)
        .query({ leaseToken: 'lease-1' });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('work item ID');
    });

    it('should return 400 when attachment ID is invalid', async () => {
      const app = createApp();
      const res = await request(app)
        .get('/api/openclaw/connect/work-items/1/attachments/0')
        .set('Authorization', AUTH_HEADER)
        .query({ leaseToken: 'lease-1' });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('attachment ID');
    });

    it('should return 400 when leaseToken is missing', async () => {
      const app = createApp();
      const res = await request(app)
        .get('/api/openclaw/connect/work-items/1/attachments/2')
        .set('Authorization', AUTH_HEADER);
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('leaseToken');
    });

    it('should stream attachment successfully', async () => {
      mocks.getDdsWorkItemAttachmentDownload.mockResolvedValue({
        fileName: 'evidence.txt',
        mimeType: 'text/plain',
        fileSize: 12,
        content: Buffer.from('hello world!'),
      });

      const app = createApp();
      const res = await request(app)
        .get('/api/openclaw/connect/work-items/10/attachments/20')
        .set('Authorization', AUTH_HEADER)
        .query({ leaseToken: 'lease-10' });

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/plain');
      expect(res.headers['content-disposition']).toContain('evidence.txt');
      expect(mocks.getDdsWorkItemAttachmentDownload).toHaveBeenCalledWith(
        VALID_TOKEN,
        10,
        'lease-10',
        20,
      );
      expect(res.text).toBe('hello world!');
    });

    it('should return 404 when attachment does not exist', async () => {
      mocks.getDdsWorkItemAttachmentDownload.mockResolvedValue(null);
      const app = createApp();
      const res = await request(app)
        .get('/api/openclaw/connect/work-items/10/attachments/20')
        .set('Authorization', AUTH_HEADER)
        .query({ leaseToken: 'lease-10' });
      expect(res.status).toBe(404);
    });
  });
});
