import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listTemplates: vi.fn(),
  createTemplateFromProposal: vi.fn(),
  deleteTemplate: vi.fn(),
  recordTemplateUse: vi.fn(),
}));

vi.mock('../middleware/auth', () => ({
  requireLogin: (
    req: { user?: { id: number; email: string; isAdmin: boolean } },
    _res: unknown,
    next: () => void,
  ) => {
    req.user = { id: 11, email: 'pharmacy@example.com', isAdmin: false };
    next();
  },
}));

vi.mock('../services/proposal-template-service', () => ({
  listTemplates: mocks.listTemplates,
  createTemplateFromProposal: mocks.createTemplateFromProposal,
  deleteTemplate: mocks.deleteTemplate,
  recordTemplateUse: mocks.recordTemplateUse,
}));

vi.mock('../services/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

async function createApp() {
  vi.resetModules();
  const { default: router } = await import('../routes/proposal-templates');
  const app = express();
  app.use(express.json());
  app.use('/api/proposal-templates', router);
  return app;
}

describe('proposal-templates routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists templates for the logged-in pharmacy', async () => {
    mocks.listTemplates.mockResolvedValue([
      { id: 1, name: '定番提案', useCount: 3 },
    ]);
    const app = await createApp();

    const res = await request(app).get('/api/proposal-templates');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 1, name: '定番提案', useCount: 3 }]);
    expect(mocks.listTemplates).toHaveBeenCalledWith(11);
  });

  it('validates proposalId on create', async () => {
    const app = await createApp();

    const res = await request(app).post('/api/proposal-templates').send({
      proposalId: 'bad-id',
      name: 'テンプレート',
    });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: '不正な提案IDです' });
    expect(mocks.createTemplateFromProposal).not.toHaveBeenCalled();
  });

  it('validates template name on create', async () => {
    const app = await createApp();

    const blank = await request(app).post('/api/proposal-templates').send({
      proposalId: 8,
      name: '   ',
    });
    expect(blank.status).toBe(400);
    expect(blank.body).toEqual({ error: 'テンプレート名を入力してください' });

    const tooLong = await request(app).post('/api/proposal-templates').send({
      proposalId: 8,
      name: 'a'.repeat(101),
    });
    expect(tooLong.status).toBe(400);
    expect(tooLong.body).toEqual({ error: 'テンプレート名は100文字以内で入力してください' });
  });

  it('creates a template from a proposal', async () => {
    mocks.createTemplateFromProposal.mockResolvedValue({
      id: 3,
      name: '再利用テンプレート',
    });
    const app = await createApp();

    const res = await request(app).post('/api/proposal-templates').send({
      proposalId: 55,
      name: ' 再利用テンプレート ',
    });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: 3, name: '再利用テンプレート' });
    expect(mocks.createTemplateFromProposal).toHaveBeenCalledWith(11, 55, '再利用テンプレート');
  });

  it('maps known business errors to 400 on create', async () => {
    mocks.createTemplateFromProposal.mockRejectedValue(new Error('完了済みの提案は保存できません'));
    const app = await createApp();

    const res = await request(app).post('/api/proposal-templates').send({
      proposalId: 55,
      name: 'テンプレート',
    });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: '完了済みの提案は保存できません' });
  });

  it('validates template id on delete', async () => {
    const app = await createApp();

    const res = await request(app).delete('/api/proposal-templates/not-a-number');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: '不正なIDです' });
    expect(mocks.deleteTemplate).not.toHaveBeenCalled();
  });

  it('deletes a template', async () => {
    const app = await createApp();

    const res = await request(app).delete('/api/proposal-templates/12');

    expect(res.status).toBe(204);
    expect(mocks.deleteTemplate).toHaveBeenCalledWith(11, 12);
  });

  it('maps missing templates to 404 on delete', async () => {
    mocks.deleteTemplate.mockRejectedValue(new Error('テンプレートが見つかりません'));
    const app = await createApp();

    const res = await request(app).delete('/api/proposal-templates/12');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'テンプレートが見つかりません' });
  });

  it('validates template id on use', async () => {
    const app = await createApp();

    const res = await request(app).post('/api/proposal-templates/0/use');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: '不正なIDです' });
    expect(mocks.recordTemplateUse).not.toHaveBeenCalled();
  });

  it('records template usage', async () => {
    mocks.recordTemplateUse.mockResolvedValue({
      id: 12,
      name: 'よく使う提案',
      useCount: 9,
    });
    const app = await createApp();

    const res = await request(app).post('/api/proposal-templates/12/use');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: 12,
      name: 'よく使う提案',
      useCount: 9,
    });
    expect(mocks.recordTemplateUse).toHaveBeenCalledWith(11, 12);
  });

  it('maps permission errors to 403 on use', async () => {
    mocks.recordTemplateUse.mockRejectedValue(new Error('権限がありません'));
    const app = await createApp();

    const res = await request(app).post('/api/proposal-templates/12/use');

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: '権限がありません' });
  });
});
