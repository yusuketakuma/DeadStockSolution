import express, { Response } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAdminDirectMessageThreads: vi.fn(),
  getAdminDirectMessageThreadDetail: vi.fn(),
  getThread: vi.fn(),
}));

vi.mock('../middleware/auth', () => ({
  requireLogin: (req: { user?: { id: number; email: string; isAdmin: boolean } }, _res: unknown, next: () => void) => {
    req.user = { id: 99, email: 'admin@example.com', isAdmin: true };
    next();
  },
  requireAdmin: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('../services/messaging-service', () => ({
  getAdminDirectMessageThreads: mocks.getAdminDirectMessageThreads,
  getAdminDirectMessageThreadDetail: mocks.getAdminDirectMessageThreadDetail,
  getThread: mocks.getThread,
}));

vi.mock('../services/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

let app: express.Express;

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();

  const { default: adminRouter } = await import('../routes/admin');
  app = express();
  app.use(express.json());
  app.use('/api/admin', adminRouter);
});

describe('admin direct messages routes', () => {
  it('GET /api/admin/direct-messages/threads returns paginated thread list', async () => {
    mocks.getAdminDirectMessageThreads.mockResolvedValue({
      threads: [
        {
          pharmacyAId: 1,
          pharmacyAName: 'あおば薬局',
          pharmacyBId: 2,
          pharmacyBName: 'みどり薬局',
          lastMessage: '在庫ありますか？',
          lastMessageAt: new Date('2026-03-24T09:00:00.000Z'),
          messageCount: 4,
        },
      ],
      total: 1,
    });

    const res = await request(app).get('/api/admin/direct-messages/threads?page=1&limit=20&search=薬局');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].pharmacyAName).toBe('あおば薬局');
    expect(mocks.getAdminDirectMessageThreads).toHaveBeenCalledWith(1, 20, '薬局');
  });

  it('GET /api/admin/direct-messages/thread returns thread detail', async () => {
    mocks.getAdminDirectMessageThreadDetail.mockResolvedValue({
      pharmacyAId: 1,
      pharmacyAName: 'あおば薬局',
      pharmacyBId: 2,
      pharmacyBName: 'みどり薬局',
    });
    mocks.getThread.mockResolvedValue({
      messages: [
        {
          id: 10,
          fromPharmacyId: 1,
          toPharmacyId: 2,
          body: '在庫ありますか？',
          isRead: true,
          createdAt: '2026-03-24T09:00:00.000Z',
        },
      ],
      total: 1,
    });

    const res = await request(app).get('/api/admin/direct-messages/thread?pharmacyAId=1&pharmacyBId=2&page=1&limit=100');

    expect(res.status).toBe(200);
    expect(res.body.thread.pharmacyAName).toBe('あおば薬局');
    expect(res.body.data).toHaveLength(1);
    expect(mocks.getThread).toHaveBeenCalledWith(1, 2, 1, 100);
  });

  it('GET /api/admin/direct-messages/thread returns 400 for invalid ids', async () => {
    const res = await request(app).get('/api/admin/direct-messages/thread?pharmacyAId=1&pharmacyBId=1');

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('薬局ID');
    expect(mocks.getAdminDirectMessageThreadDetail).not.toHaveBeenCalled();
  });

  it('GET /api/admin/direct-messages/thread returns 404 when thread is missing', async () => {
    mocks.getAdminDirectMessageThreadDetail.mockResolvedValue(null);

    const res = await request(app).get('/api/admin/direct-messages/thread?pharmacyAId=1&pharmacyBId=9');

    expect(res.status).toBe(404);
    expect(res.body.error).toContain('見つかりません');
  });
});
