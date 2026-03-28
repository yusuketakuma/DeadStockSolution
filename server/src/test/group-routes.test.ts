import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createGroup: vi.fn(),
  updateGroup: vi.fn(),
  deleteGroup: vi.fn(),
  listGroups: vi.fn(),
  getMembershipSummary: vi.fn(),
  getGroupDetail: vi.fn(),
  inviteMember: vi.fn(),
  acceptInvitation: vi.fn(),
  joinPublicGroup: vi.fn(),
  removeMember: vi.fn(),
  leaveGroup: vi.fn(),
  requireLoginEnabled: { value: true },
}));

vi.mock('../middleware/auth', () => ({
  requireLogin: (
    req: { user?: { id: number; email: string; isAdmin: boolean } },
    res: { status: (code: number) => { json: (body: unknown) => void } },
    next: () => void,
  ) => {
    if (!mocks.requireLoginEnabled.value) {
      res.status(401).json({ error: 'ログインが必要です' });
      return;
    }
    req.user = { id: 1, email: 'pharmacy@example.com', isAdmin: false };
    next();
  },
}));

vi.mock('../services/group-service', () => ({
  createGroup: mocks.createGroup,
  updateGroup: mocks.updateGroup,
  deleteGroup: mocks.deleteGroup,
  listGroups: mocks.listGroups,
  getMembershipSummary: mocks.getMembershipSummary,
  getGroupDetail: mocks.getGroupDetail,
  inviteMember: mocks.inviteMember,
  acceptInvitation: mocks.acceptInvitation,
  joinPublicGroup: mocks.joinPublicGroup,
  removeMember: mocks.removeMember,
  leaveGroup: mocks.leaveGroup,
}));

vi.mock('../config/database', () => ({
  db: {},
}));

vi.mock('../services/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../services/system-event-service', () => ({
  recordHttpUnhandledError: vi.fn(),
}));

vi.mock('../utils/request-utils', () => ({
  parsePositiveInt: (raw: unknown) => {
    if (typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    if (!/^\d+$/.test(trimmed)) return null;

    const parsed = Number(trimmed);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) return null;
    return parsed;
  },
  normalizeSearchTerm: (raw: unknown, maxLength: number = 100) => {
    if (typeof raw !== 'string') return undefined;
    const sanitized = raw
      .replace(/[\x00-\x1F\x7F]/g, '')
      .trim();
    if (!sanitized) return undefined;
    return sanitized.slice(0, maxLength);
  },
}));

vi.mock('../utils/cursor-pagination', () => ({
  parseCursor: (raw: unknown, validate: (cursor: { id: number }) => boolean) => {
    if (raw === undefined) return undefined;
    if (typeof raw !== 'string' || raw.trim().length === 0) return null;
    try {
      const decoded = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
      if (!decoded || typeof decoded !== 'object') return null;
      if (
        typeof decoded.id !== 'number' ||
        !Number.isInteger(decoded.id) ||
        decoded.id <= 0
      ) {
        return null;
      }
      return validate(decoded as { id: number }) ? decoded : null;
    } catch {
      return null;
    }
  },
}));

let groupsRouter: (typeof import('../routes/groups'))['default'];
let requireLogin: (typeof import('../middleware/auth'))['requireLogin'];

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/groups', requireLogin as unknown as express.RequestHandler, groupsRouter);
  return app;
}

describe('group routes', () => {
  beforeEach(async () => {
    vi.useRealTimers();
    vi.resetAllMocks();
    vi.resetModules();
    mocks.requireLoginEnabled.value = true;
    ({ requireLogin } = await import('../middleware/auth'));
    ({ default: groupsRouter } = await import('../routes/groups'));
  });

  // ── POST /api/groups ──────────────────────────────────
  describe('POST /api/groups', () => {
    it('201 — グループ作成成功', async () => {
      const created = { id: 1, name: 'テストグループ', description: null, visibility: 'public', ownerPharmacyId: 1, createdAt: '', updatedAt: '', members: [], memberCount: 1 };
      mocks.createGroup.mockResolvedValue(created);
      const app = await createApp();

      const res = await request(app)
        .post('/api/groups')
        .send({ name: 'テストグループ', visibility: 'public' });

      expect(res.status).toBe(201);
      expect(res.body).toEqual(created);
      expect(mocks.createGroup).toHaveBeenCalledWith(1, { name: 'テストグループ', visibility: 'public' });
    });

    it('201 — description 付きで作成', async () => {
      const created = { id: 2, name: 'G', description: '説明', visibility: 'invite_only', ownerPharmacyId: 1, createdAt: '', updatedAt: '', members: [], memberCount: 1 };
      mocks.createGroup.mockResolvedValue(created);
      const app = await createApp();

      const res = await request(app)
        .post('/api/groups')
        .send({ name: 'G', description: '説明', visibility: 'invite_only' });

      expect(res.status).toBe(201);
      expect(mocks.createGroup).toHaveBeenCalledWith(1, { name: 'G', description: '説明', visibility: 'invite_only' });
    });

    it('400 — name が空', async () => {
      const app = await createApp();

      const res = await request(app)
        .post('/api/groups')
        .send({ name: '', visibility: 'public' });

      expect(res.status).toBe(400);
      expect(mocks.createGroup).not.toHaveBeenCalled();
    });

    it('400 — visibility が不正', async () => {
      const app = await createApp();

      const res = await request(app)
        .post('/api/groups')
        .send({ name: 'Test', visibility: 'invalid' });

      expect(res.status).toBe(400);
      expect(mocks.createGroup).not.toHaveBeenCalled();
    });

    it('400 — body なし', async () => {
      const app = await createApp();

      const res = await request(app)
        .post('/api/groups')
        .send({});

      expect(res.status).toBe(400);
      expect(mocks.createGroup).not.toHaveBeenCalled();
    });

    it('500 — サービスエラー', async () => {
      mocks.createGroup.mockRejectedValue(new Error('DB error'));
      const app = await createApp();

      const res = await request(app)
        .post('/api/groups')
        .send({ name: 'Test', visibility: 'public' });

      expect(res.status).toBe(500);
    });
  });

  // ── GET /api/groups ──────────────────────────────────
  describe('GET /api/groups', () => {
    it('200 — グループ一覧取得', async () => {
      const result = { groups: [], total: 0, offset: 0, limit: 20 };
      mocks.listGroups.mockResolvedValue(result);
      const app = await createApp();

      const res = await request(app).get('/api/groups');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(result);
      expect(mocks.listGroups).toHaveBeenCalledWith(1, { limit: undefined, offset: undefined, search: undefined, cursor: undefined, tab: undefined });
    });

    it('200 — limit/offset パラメータ付き', async () => {
      const result = { groups: [], total: 0, offset: 10, limit: 5 };
      mocks.listGroups.mockResolvedValue(result);
      const app = await createApp();

      const res = await request(app).get('/api/groups?limit=5&offset=10');

      expect(res.status).toBe(200);
      expect(mocks.listGroups).toHaveBeenCalledWith(1, { limit: 5, offset: 10, search: undefined, cursor: undefined, tab: undefined });
    });

    it('200 — tab パラメータ付き', async () => {
      const result = { groups: [], total: 0, offset: 0, limit: 20 };
      mocks.listGroups.mockResolvedValue(result);
      const app = await createApp();

      const res = await request(app).get('/api/groups?tab=mine');

      expect(res.status).toBe(200);
      expect(mocks.listGroups).toHaveBeenCalledWith(1, { limit: undefined, offset: undefined, search: undefined, cursor: undefined, tab: 'mine' });
    });

    it('200 — cursor パラメータ付きで cursor-based pagination を使用', async () => {
      const cursorPayload = { id: 3, createdAt: '2025-01-01T00:00:00.000Z' };
      const encodedCursor = Buffer.from(JSON.stringify(cursorPayload), 'utf-8').toString('base64url');
      const result = {
        groups: [],
        total: 10,
        offset: 0,
        limit: 20,
        pagination: { mode: 'cursor', hasMore: false, nextCursor: null },
      };
      mocks.listGroups.mockResolvedValue(result);
      const app = await createApp();

      const res = await request(app).get(`/api/groups?cursor=${encodedCursor}`);

      expect(res.status).toBe(200);
      expect(res.body.pagination.mode).toBe('cursor');
      expect(mocks.listGroups).toHaveBeenCalledWith(1, {
        limit: undefined,
        offset: undefined,
        search: undefined,
        cursor: cursorPayload,
        tab: undefined,
      });
    });

    it('400 — 不正な cursor', async () => {
      const app = await createApp();

      const res = await request(app).get('/api/groups?cursor=!!!invalid!!!');

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
      expect(mocks.listGroups).not.toHaveBeenCalled();
    });

    it('500 — サービスエラー', async () => {
      mocks.listGroups.mockRejectedValue(new Error('DB error'));
      const app = await createApp();

      const res = await request(app).get('/api/groups');

      expect(res.status).toBe(500);
    });
  });

  describe('GET /api/groups/membership-summary', () => {
    it('200 — 所属グループのサマリー取得', async () => {
      const result = {
        groups: [{ id: 10, name: '東京グループ', memberPharmacyIds: [1, 2] }],
        groupPharmacyIds: [1, 2],
      };
      mocks.getMembershipSummary.mockResolvedValue(result);
      const app = await createApp();

      const res = await request(app).get('/api/groups/membership-summary');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(result);
      expect(mocks.getMembershipSummary).toHaveBeenCalledWith(1);
    });

    it('500 — サービスエラー', async () => {
      mocks.getMembershipSummary.mockRejectedValue(new Error('DB error'));
      const app = await createApp();

      const res = await request(app).get('/api/groups/membership-summary');

      expect(res.status).toBe(500);
    });
  });

  // ── GET /api/groups/:id ──────────────────────────────
  describe('GET /api/groups/:id', () => {
    it('200 — グループ詳細取得', async () => {
      const detail = { id: 1, name: 'G', description: null, visibility: 'public', ownerPharmacyId: 1, createdAt: '', updatedAt: '', members: [], memberCount: 0 };
      mocks.getGroupDetail.mockResolvedValue(detail);
      const app = await createApp();

      const res = await request(app).get('/api/groups/1');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(detail);
      expect(mocks.getGroupDetail).toHaveBeenCalledWith(1, 1);
    });

    it('400 — 不正なID', async () => {
      const app = await createApp();

      const res = await request(app).get('/api/groups/abc');

      expect(res.status).toBe(400);
      expect(mocks.getGroupDetail).not.toHaveBeenCalled();
    });

    it('404 — グループが存在しない', async () => {
      mocks.getGroupDetail.mockRejectedValue(new Error('グループが見つかりません'));
      const app = await createApp();

      const res = await request(app).get('/api/groups/999');

      expect(res.status).toBe(404);
    });

    it('403 — 閲覧権限なし', async () => {
      mocks.getGroupDetail.mockRejectedValue(new Error('このグループを閲覧する権限がありません'));
      const app = await createApp();

      const res = await request(app).get('/api/groups/1');

      expect(res.status).toBe(403);
    });
  });

  // ── PUT /api/groups/:id ──────────────────────────────
  describe('PUT /api/groups/:id', () => {
    it('200 — グループ更新成功', async () => {
      const updated = { id: 1, name: '新名前', description: null, visibility: 'public', ownerPharmacyId: 1, createdAt: '', updatedAt: '', members: [], memberCount: 1 };
      mocks.updateGroup.mockResolvedValue(updated);
      const app = await createApp();

      const res = await request(app)
        .put('/api/groups/1')
        .send({ name: '新名前' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual(updated);
      expect(mocks.updateGroup).toHaveBeenCalledWith(1, 1, { name: '新名前' });
    });

    it('400 — 不正なID', async () => {
      const app = await createApp();

      const res = await request(app)
        .put('/api/groups/abc')
        .send({ name: '新名前' });

      expect(res.status).toBe(400);
      expect(mocks.updateGroup).not.toHaveBeenCalled();
    });

    it('403 — オーナー以外が更新', async () => {
      mocks.updateGroup.mockRejectedValue(new Error('グループオーナーのみ更新できます'));
      const app = await createApp();

      const res = await request(app)
        .put('/api/groups/1')
        .send({ name: 'X' });

      expect(res.status).toBe(403);
    });
  });

  // ── DELETE /api/groups/:id ──────────────────────────────
  describe('DELETE /api/groups/:id', () => {
    it('204 — グループ削除成功', async () => {
      mocks.deleteGroup.mockResolvedValue(undefined);
      const app = await createApp();

      const res = await request(app).delete('/api/groups/1');

      expect(res.status).toBe(204);
      expect(mocks.deleteGroup).toHaveBeenCalledWith(1, 1);
    });

    it('400 — 不正なID', async () => {
      const app = await createApp();

      const res = await request(app).delete('/api/groups/abc');

      expect(res.status).toBe(400);
      expect(mocks.deleteGroup).not.toHaveBeenCalled();
    });

    it('403 — オーナー以外が削除', async () => {
      mocks.deleteGroup.mockRejectedValue(new Error('グループオーナーのみ削除できます'));
      const app = await createApp();

      const res = await request(app).delete('/api/groups/1');

      expect(res.status).toBe(403);
    });

    it('404 — グループが見つからない', async () => {
      mocks.deleteGroup.mockRejectedValue(new Error('グループが見つかりません'));
      const app = await createApp();

      const res = await request(app).delete('/api/groups/999');

      expect(res.status).toBe(404);
    });
  });

  // ── POST /api/groups/:id/invite ──────────────────────────────
  describe('POST /api/groups/:id/invite', () => {
    it('201 — 招待送信成功', async () => {
      mocks.inviteMember.mockResolvedValue(undefined);
      const app = await createApp();

      const res = await request(app)
        .post('/api/groups/1/invite')
        .send({ pharmacyId: 2 });

      expect(res.status).toBe(201);
      expect(mocks.inviteMember).toHaveBeenCalledWith(1, 1, 2);
    });

    it('400 — pharmacyId なし', async () => {
      const app = await createApp();

      const res = await request(app)
        .post('/api/groups/1/invite')
        .send({});

      expect(res.status).toBe(400);
      expect(mocks.inviteMember).not.toHaveBeenCalled();
    });

    it('400 — pharmacyId が不正', async () => {
      const app = await createApp();

      const res = await request(app)
        .post('/api/groups/1/invite')
        .send({ pharmacyId: -1 });

      expect(res.status).toBe(400);
      expect(mocks.inviteMember).not.toHaveBeenCalled();
    });

    it('403 — 権限不足', async () => {
      mocks.inviteMember.mockRejectedValue(new Error('招待できるのはオーナーまたは管理者のみです'));
      const app = await createApp();

      const res = await request(app)
        .post('/api/groups/1/invite')
        .send({ pharmacyId: 2 });

      expect(res.status).toBe(403);
    });

    it('409 — 既にメンバー', async () => {
      mocks.inviteMember.mockRejectedValue(new Error('既にグループメンバーです'));
      const app = await createApp();

      const res = await request(app)
        .post('/api/groups/1/invite')
        .send({ pharmacyId: 2 });

      expect(res.status).toBe(409);
    });

    it('409 — 既に招待済み', async () => {
      mocks.inviteMember.mockRejectedValue(new Error('既に招待済みです'));
      const app = await createApp();

      const res = await request(app)
        .post('/api/groups/1/invite')
        .send({ pharmacyId: 2 });

      expect(res.status).toBe(409);
    });
  });

  // ── POST /api/groups/:id/join ──────────────────────────────
  describe('POST /api/groups/:id/join', () => {
    it('200 — グループ参加成功', async () => {
      mocks.joinPublicGroup.mockResolvedValue(undefined);
      const app = await createApp();

      const res = await request(app).post('/api/groups/1/join');

      expect(res.status).toBe(200);
      expect(mocks.joinPublicGroup).toHaveBeenCalledWith(1, 1);
    });

    it('400 — 不正なID', async () => {
      const app = await createApp();

      const res = await request(app).post('/api/groups/abc/join');

      expect(res.status).toBe(400);
      expect(mocks.joinPublicGroup).not.toHaveBeenCalled();
    });

    it('409 — 既にメンバー', async () => {
      mocks.joinPublicGroup.mockRejectedValue(new Error('既にグループメンバーです'));
      const app = await createApp();

      const res = await request(app).post('/api/groups/1/join');

      expect(res.status).toBe(409);
    });
  });

  // ── POST /api/groups/:id/accept ──────────────────────────────
  describe('POST /api/groups/:id/accept', () => {
    it('200 — 招待承認成功', async () => {
      mocks.acceptInvitation.mockResolvedValue(undefined);
      const app = await createApp();

      const res = await request(app).post('/api/groups/1/accept');

      expect(res.status).toBe(200);
      expect(mocks.acceptInvitation).toHaveBeenCalledWith(1, 1);
    });

    it('400 — 不正なID', async () => {
      const app = await createApp();

      const res = await request(app).post('/api/groups/abc/accept');

      expect(res.status).toBe(400);
      expect(mocks.acceptInvitation).not.toHaveBeenCalled();
    });

    it('404 — 招待が見つからない', async () => {
      mocks.acceptInvitation.mockRejectedValue(new Error('有効な招待が見つかりません'));
      const app = await createApp();

      const res = await request(app).post('/api/groups/1/accept');

      expect(res.status).toBe(404);
    });
  });

  // ── POST /api/groups/:id/leave ──────────────────────────────
  describe('POST /api/groups/:id/leave', () => {
    it('200 — グループ脱退成功', async () => {
      mocks.leaveGroup.mockResolvedValue(undefined);
      const app = await createApp();

      const res = await request(app).post('/api/groups/1/leave');

      expect(res.status).toBe(200);
      expect(mocks.leaveGroup).toHaveBeenCalledWith(1, 1);
    });

    it('400 — 不正なID', async () => {
      const app = await createApp();

      const res = await request(app).post('/api/groups/abc/leave');

      expect(res.status).toBe(400);
      expect(mocks.leaveGroup).not.toHaveBeenCalled();
    });

    it('403 — オーナーは脱退不可', async () => {
      mocks.leaveGroup.mockRejectedValue(new Error('オーナーはグループを脱退できません'));
      const app = await createApp();

      const res = await request(app).post('/api/groups/1/leave');

      expect(res.status).toBe(403);
    });

    it('403 — メンバーではない', async () => {
      mocks.leaveGroup.mockRejectedValue(new Error('グループメンバーではありません'));
      const app = await createApp();

      const res = await request(app).post('/api/groups/1/leave');

      expect(res.status).toBe(403);
    });
  });

  // ── DELETE /api/groups/:id/members/:pharmacyId ──────────────
  describe('DELETE /api/groups/:id/members/:pharmacyId', () => {
    it('204 — メンバー削除成功', async () => {
      mocks.removeMember.mockResolvedValue(undefined);
      const app = await createApp();

      const res = await request(app).delete('/api/groups/1/members/2');

      expect(res.status).toBe(204);
      expect(mocks.removeMember).toHaveBeenCalledWith(1, 1, 2);
    });

    it('400 — グループID不正', async () => {
      const app = await createApp();

      const res = await request(app).delete('/api/groups/abc/members/2');

      expect(res.status).toBe(400);
      expect(mocks.removeMember).not.toHaveBeenCalled();
    });

    it('400 — pharmacyId 不正', async () => {
      const app = await createApp();

      const res = await request(app).delete('/api/groups/1/members/abc');

      expect(res.status).toBe(400);
      expect(mocks.removeMember).not.toHaveBeenCalled();
    });

    it('403 — 権限不足', async () => {
      mocks.removeMember.mockRejectedValue(new Error('招待できるのはオーナーまたは管理者のみです'));
      const app = await createApp();

      const res = await request(app).delete('/api/groups/1/members/2');

      expect(res.status).toBe(403);
    });

    it('404 — メンバーが見つからない', async () => {
      mocks.removeMember.mockRejectedValue(new Error('対象メンバーが見つかりません'));
      const app = await createApp();

      const res = await request(app).delete('/api/groups/1/members/999');

      expect(res.status).toBe(404);
    });

    it('403 — オーナーは削除不可', async () => {
      mocks.removeMember.mockRejectedValue(new Error('オーナーは削除できません'));
      const app = await createApp();

      const res = await request(app).delete('/api/groups/1/members/2');

      expect(res.status).toBe(403);
    });
  });

  // ── 認証テスト ──────────────────────────────────
  describe('認証', () => {
    it('401 — 未認証でアクセス', async () => {
      mocks.requireLoginEnabled.value = false;
      const app = await createApp();

      const res = await request(app).get('/api/groups');

      expect(res.status).toBe(401);
      expect(mocks.listGroups).not.toHaveBeenCalled();
    });
  });
});
