import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getPharmacyHealthSummary: vi.fn(),
}));

async function createApp() {
  vi.resetModules();
  vi.doMock('../middleware/auth', () => ({
    requireLogin: (req: { user?: { id: number; email: string; isAdmin: boolean } }, _res: unknown, next: () => void) => {
      req.user = { id: 1, email: 'admin@example.com', isAdmin: true };
      next();
    },
    requireAdmin: (_req: unknown, _res: unknown, next: () => void) => {
      next();
    },
  }));
  vi.doMock('../services/admin-pharmacy-health-service', () => ({
    getPharmacyHealthSummary: mocks.getPharmacyHealthSummary,
  }));
  const { default: adminPharmacyHealthRouter } = await import('../routes/admin-pharmacy-health');
  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminPharmacyHealthRouter);
  return app;
}

const sampleData = {
  activityByPharmacy: [
    { pharmacyId: 1, pharmacyName: '薬局A', actionCount: 10, lastActivity: '2026-03-01T00:00:00Z' },
  ],
  trustScores: [
    { pharmacyId: 1, pharmacyName: '薬局A', trustScore: '4.5', ratingCount: 20, positiveRate: '0.9', updatedAt: '2026-03-01T00:00:00Z' },
  ],
  uploadActivity: [
    { pharmacyId: 1, pharmacyName: '薬局A', totalUploads: 5, lastUploadAt: '2026-03-01T00:00:00Z', successRate: 0.8 },
  ],
  lastLogins: [
    { pharmacyId: 1, pharmacyName: '薬局A', lastLoginAt: '2026-03-01T00:00:00Z' },
  ],
  proposalActivity: [
    { pharmacyId: 1, pharmacyName: '薬局A', sent: 3, received: 2, completed: 1 },
  ],
};

describe('GET /api/admin/pharmacy-health (expanded)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 200 with all expected fields', async () => {
    mocks.getPharmacyHealthSummary.mockResolvedValue(sampleData);
    const app = await createApp();
    const res = await request(app).get('/api/admin/pharmacy-health');

    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
  });

  it('returns existing activityByPharmacy field', async () => {
    mocks.getPharmacyHealthSummary.mockResolvedValue(sampleData);
    const app = await createApp();
    const res = await request(app).get('/api/admin/pharmacy-health');

    expect(res.body.data.activityByPharmacy).toBeDefined();
    expect(Array.isArray(res.body.data.activityByPharmacy)).toBe(true);
  });

  it('returns existing trustScores field', async () => {
    mocks.getPharmacyHealthSummary.mockResolvedValue(sampleData);
    const app = await createApp();
    const res = await request(app).get('/api/admin/pharmacy-health');

    expect(res.body.data.trustScores).toBeDefined();
    expect(Array.isArray(res.body.data.trustScores)).toBe(true);
  });

  it('returns new uploadActivity field with correct structure', async () => {
    mocks.getPharmacyHealthSummary.mockResolvedValue(sampleData);
    const app = await createApp();
    const res = await request(app).get('/api/admin/pharmacy-health');

    expect(res.body.data.uploadActivity).toBeDefined();
    expect(Array.isArray(res.body.data.uploadActivity)).toBe(true);

    const item = res.body.data.uploadActivity[0];
    expect(item).toHaveProperty('pharmacyId');
    expect(item).toHaveProperty('pharmacyName');
    expect(item).toHaveProperty('totalUploads');
    expect(item).toHaveProperty('lastUploadAt');
    expect(item).toHaveProperty('successRate');
    expect(typeof item.successRate).toBe('number');
  });

  it('returns new lastLogins field with correct structure', async () => {
    mocks.getPharmacyHealthSummary.mockResolvedValue(sampleData);
    const app = await createApp();
    const res = await request(app).get('/api/admin/pharmacy-health');

    expect(res.body.data.lastLogins).toBeDefined();
    expect(Array.isArray(res.body.data.lastLogins)).toBe(true);

    const item = res.body.data.lastLogins[0];
    expect(item).toHaveProperty('pharmacyId');
    expect(item).toHaveProperty('pharmacyName');
    expect(item).toHaveProperty('lastLoginAt');
  });

  it('returns new proposalActivity field with correct structure', async () => {
    mocks.getPharmacyHealthSummary.mockResolvedValue(sampleData);
    const app = await createApp();
    const res = await request(app).get('/api/admin/pharmacy-health');

    expect(res.body.data.proposalActivity).toBeDefined();
    expect(Array.isArray(res.body.data.proposalActivity)).toBe(true);

    const item = res.body.data.proposalActivity[0];
    expect(item).toHaveProperty('pharmacyId');
    expect(item).toHaveProperty('pharmacyName');
    expect(item).toHaveProperty('sent');
    expect(item).toHaveProperty('received');
    expect(item).toHaveProperty('completed');
    expect(typeof item.sent).toBe('number');
    expect(typeof item.received).toBe('number');
    expect(typeof item.completed).toBe('number');
  });

  it('handles null lastLoginAt for pharmacies that never logged in', async () => {
    const dataWithNullLogin = {
      ...sampleData,
      lastLogins: [
        { pharmacyId: 2, pharmacyName: '薬局B', lastLoginAt: null },
      ],
    };
    mocks.getPharmacyHealthSummary.mockResolvedValue(dataWithNullLogin);
    const app = await createApp();
    const res = await request(app).get('/api/admin/pharmacy-health');

    expect(res.status).toBe(200);
    expect(res.body.data.lastLogins[0].lastLoginAt).toBeNull();
  });

  it('handles null lastUploadAt for pharmacies with no uploads', async () => {
    const dataWithNullUpload = {
      ...sampleData,
      uploadActivity: [
        { pharmacyId: 2, pharmacyName: '薬局B', totalUploads: 0, lastUploadAt: null, successRate: 0 },
      ],
    };
    mocks.getPharmacyHealthSummary.mockResolvedValue(dataWithNullUpload);
    const app = await createApp();
    const res = await request(app).get('/api/admin/pharmacy-health');

    expect(res.status).toBe(200);
    expect(res.body.data.uploadActivity[0].lastUploadAt).toBeNull();
    expect(res.body.data.uploadActivity[0].successRate).toBe(0);
  });

  it('returns 500 when service throws', async () => {
    mocks.getPharmacyHealthSummary.mockRejectedValue(new Error('DB error'));
    const app = await createApp();
    const res = await request(app).get('/api/admin/pharmacy-health');

    expect(res.status).toBe(500);
  });
});
