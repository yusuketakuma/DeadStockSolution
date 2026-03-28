import express, { Response } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- hoisted mocks ---
const mocks = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  getThreads: vi.fn(),
  getThread: vi.fn(),
  markThreadRead: vi.fn(),
  getUnreadCount: vi.fn(),
  pharmacyExists: vi.fn(),
  publishMessagesRefresh: vi.fn(),
  publishAdminMessagesRefresh: vi.fn(),
  dispatchCustomPush: vi.fn(),
}));

vi.mock('../middleware/auth', () => ({
  requireLogin: (req: { user?: { id: number; email: string; isAdmin: boolean } }, _res: unknown, next: () => void) => {
    req.user = { id: 1, email: 'test@example.com', isAdmin: false };
    next();
  },
  rejectAdmin: (req: { user?: { id: number; email: string; isAdmin: boolean } }, res: Response, next: () => void) => {
    if (req.user?.isAdmin) {
      res.status(403).json({ error: '管理者アカウントではこの機能を利用できません' });
      return;
    }
    next();
  },
}));

vi.mock('../services/messaging-service', () => ({
  sendMessage: mocks.sendMessage,
  getThreads: mocks.getThreads,
  getThread: mocks.getThread,
  markThreadRead: mocks.markThreadRead,
  getUnreadCount: mocks.getUnreadCount,
  pharmacyExists: mocks.pharmacyExists,
}));

vi.mock('../services/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../services/realtime-service', () => ({
  publishMessagesRefresh: mocks.publishMessagesRefresh,
  publishAdminMessagesRefresh: mocks.publishAdminMessagesRefresh,
}));

vi.mock('../services/push-notification-dispatcher', () => ({
  dispatchCustomPush: mocks.dispatchCustomPush,
}));

let app: express.Express;

beforeEach(async () => {
  vi.useRealTimers();
  vi.resetAllMocks();
  vi.resetModules();

  const { default: messagesRouter } = await import('../routes/messages');
  app = express();
  app.use(express.json());
  app.use('/messages', messagesRouter);
});

// ----------------------------------------------------------------
// POST /messages — 送信
// ----------------------------------------------------------------
describe('POST /messages', () => {
  it('should send message and return 201', async () => {
    mocks.pharmacyExists.mockResolvedValue(true);
    const now = new Date().toISOString();
    mocks.sendMessage.mockResolvedValue({
      id: 10,
      fromPharmacyId: 1,
      toPharmacyId: 2,
      body: 'こんにちは',
      isRead: false,
      readAt: null,
      isDeleted: false,
      createdAt: now,
    });

    const res = await request(app)
      .post('/messages')
      .send({ toPharmacyId: 2, body: 'こんにちは' });

    expect(res.status).toBe(201);
    expect(res.body.message).toBe('メッセージを送信しました');
    expect(res.body.data.id).toBe(10);
    expect(mocks.sendMessage).toHaveBeenCalledWith(1, 2, 'こんにちは', []);
    expect(mocks.publishMessagesRefresh).toHaveBeenCalledTimes(2);
    expect(mocks.publishAdminMessagesRefresh).toHaveBeenCalledWith({
      pharmacyAId: 1,
      pharmacyBId: 2,
      messageId: 10,
      reason: 'message_sent',
    });
    expect(mocks.dispatchCustomPush).toHaveBeenCalledWith(expect.objectContaining({
      pharmacyId: 2,
      type: 'direct_message',
      category: 'comments',
      priority: 'high',
      referenceId: 10,
    }));
  });

  it('should return 400 when body is empty', async () => {
    const res = await request(app)
      .post('/messages')
      .send({ toPharmacyId: 2, body: '' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('本文');
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it('should return 400 when body exceeds 2000 characters', async () => {
    const longBody = 'a'.repeat(2001);
    const res = await request(app)
      .post('/messages')
      .send({ toPharmacyId: 2, body: longBody });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('2000文字');
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it('should return 400 when toPharmacyId is missing', async () => {
    const res = await request(app)
      .post('/messages')
      .send({ body: 'こんにちは' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('宛先薬局ID');
  });

  it('should return 400 when sending to self', async () => {
    // User id is 1 (mocked), toPharmacyId is also 1
    const res = await request(app)
      .post('/messages')
      .send({ toPharmacyId: 1, body: 'test' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('自分自身');
  });

  it('should return 404 when recipient pharmacy does not exist', async () => {
    mocks.pharmacyExists.mockResolvedValue(false);

    const res = await request(app)
      .post('/messages')
      .send({ toPharmacyId: 999, body: 'こんにちは' });

    expect(res.status).toBe(404);
    expect(res.body.error).toContain('宛先薬局');
  });

  it('should return 429 when rate limit is hit (same from/to within 10s)', async () => {
    mocks.pharmacyExists.mockResolvedValue(true);
    mocks.sendMessage.mockResolvedValue({
      id: 1,
      fromPharmacyId: 1,
      toPharmacyId: 3,
      body: 'first',
      isRead: false,
      readAt: null,
      isDeleted: false,
      createdAt: new Date().toISOString(),
    });

    // First request should succeed
    const first = await request(app)
      .post('/messages')
      .send({ toPharmacyId: 3, body: 'first' });
    expect(first.status).toBe(201);

    // Second immediate request to same recipient should be rate-limited
    const second = await request(app)
      .post('/messages')
      .send({ toPharmacyId: 3, body: 'second' });
    expect(second.status).toBe(429);
    expect(second.headers['retry-after']).toBeDefined();
  });
});

// ----------------------------------------------------------------
// GET /messages/threads — スレッド一覧
// ----------------------------------------------------------------
describe('GET /messages/threads', () => {
  it('should return thread list', async () => {
    const threads = [
      {
        otherPharmacyId: 2,
        otherPharmacyName: '薬局B',
        lastMessage: 'こんにちは',
        lastMessageAt: new Date(),
        unreadCount: 3,
      },
    ];
    mocks.getThreads.mockResolvedValue(threads);

    const res = await request(app).get('/messages/threads');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].otherPharmacyId).toBe(2);
    expect(res.body.data[0].unreadCount).toBe(3);
    expect(mocks.getThreads).toHaveBeenCalledWith(1, null);
  });

  it('should return empty list when no threads', async () => {
    mocks.getThreads.mockResolvedValue([]);

    const res = await request(app).get('/messages/threads');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  it('should return 500 on service error', async () => {
    mocks.getThreads.mockRejectedValue(new Error('DB error'));

    const res = await request(app).get('/messages/threads');

    expect(res.status).toBe(500);
    expect(res.body.error).toContain('スレッド一覧');
  });
});

// ----------------------------------------------------------------
// GET /messages/thread/:pharmacyId — 特定スレッド
// ----------------------------------------------------------------
describe('GET /messages/thread/:pharmacyId', () => {
  it('should return messages with pagination', async () => {
    const now = new Date().toISOString();
    const messages = [
      {
        id: 5,
        fromPharmacyId: 2,
        toPharmacyId: 1,
        body: 'hello',
        isRead: false,
        readAt: null,
        isDeleted: false,
        createdAt: now,
      },
    ];
    mocks.getThread.mockResolvedValue({ messages, total: 1 });

    const res = await request(app).get('/messages/thread/2?page=1&limit=20');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.pagination.total).toBe(1);
    expect(res.body.pagination.totalPages).toBe(1);
    expect(mocks.getThread).toHaveBeenCalledWith(1, 2, 1, 20);
  });

  it('should return 400 for invalid pharmacyId', async () => {
    const res = await request(app).get('/messages/thread/abc');

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('薬局ID');
  });

  it('should return 500 on service error', async () => {
    mocks.getThread.mockRejectedValue(new Error('DB error'));

    const res = await request(app).get('/messages/thread/2');

    expect(res.status).toBe(500);
    expect(res.body.error).toContain('スレッド');
  });
});

// ----------------------------------------------------------------
// PATCH /messages/thread/:pharmacyId/read — 既読化
// ----------------------------------------------------------------
describe('PATCH /messages/thread/:pharmacyId/read', () => {
  it('should mark thread as read and return markedCount', async () => {
    mocks.markThreadRead.mockResolvedValue(5);

    const res = await request(app).patch('/messages/thread/2/read');

    expect(res.status).toBe(200);
    expect(res.body.markedCount).toBe(5);
    expect(mocks.markThreadRead).toHaveBeenCalledWith(1, 2);
    expect(mocks.publishMessagesRefresh).toHaveBeenCalledTimes(2);
    expect(mocks.publishAdminMessagesRefresh).toHaveBeenCalledWith({
      pharmacyAId: 1,
      pharmacyBId: 2,
      reason: 'thread_read',
    });
  });

  it('should return 0 markedCount when nothing to mark', async () => {
    mocks.markThreadRead.mockResolvedValue(0);

    const res = await request(app).patch('/messages/thread/2/read');

    expect(res.status).toBe(200);
    expect(res.body.markedCount).toBe(0);
    expect(mocks.publishMessagesRefresh).not.toHaveBeenCalled();
    expect(mocks.publishAdminMessagesRefresh).not.toHaveBeenCalled();
  });

  it('should return 400 for invalid pharmacyId', async () => {
    const res = await request(app).patch('/messages/thread/bad/read');

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('薬局ID');
  });

  it('should return 500 on service error', async () => {
    mocks.markThreadRead.mockRejectedValue(new Error('DB error'));

    const res = await request(app).patch('/messages/thread/2/read');

    expect(res.status).toBe(500);
    expect(res.body.error).toContain('既読');
  });
});

// ----------------------------------------------------------------
// GET /messages/unread-count — 未読総数
// ----------------------------------------------------------------
describe('GET /messages/unread-count', () => {
  it('should return unread count', async () => {
    mocks.getUnreadCount.mockResolvedValue(7);

    const res = await request(app).get('/messages/unread-count');

    expect(res.status).toBe(200);
    expect(res.body.unreadCount).toBe(7);
    expect(mocks.getUnreadCount).toHaveBeenCalledWith(1);
  });

  it('should return 0 when no unread messages', async () => {
    mocks.getUnreadCount.mockResolvedValue(0);

    const res = await request(app).get('/messages/unread-count');

    expect(res.status).toBe(200);
    expect(res.body.unreadCount).toBe(0);
  });

  it('should return 500 on service error', async () => {
    mocks.getUnreadCount.mockRejectedValue(new Error('DB error'));

    const res = await request(app).get('/messages/unread-count');

    expect(res.status).toBe(500);
    expect(res.body.error).toContain('未読数');
  });
});
