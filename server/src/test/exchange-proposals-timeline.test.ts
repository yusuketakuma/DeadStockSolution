import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
  },
  loggerError: vi.fn(),
}));

vi.mock('../middleware/auth', () => ({
  requireLogin: (req: { user?: { id: number; email: string; isAdmin: boolean } }, _res: unknown, next: () => void) => {
    req.user = { id: 2, email: 'user@example.com', isAdmin: false };
    next();
  },
  rejectAdmin: (_req: unknown, _res: unknown, next: () => void) => {
    next();
  },
}));

vi.mock('../config/database', () => ({
  db: mocks.db,
}));

vi.mock('../services/matching-service', () => ({
  findMatches: vi.fn(),
}));

vi.mock('../services/exchange-service', () => ({
  createProposal: vi.fn(),
  acceptProposal: vi.fn(),
  rejectProposal: vi.fn(),
  completeProposal: vi.fn(),
}));

vi.mock('../services/matching-refresh-service', () => ({
  processPendingMatchingRefreshJobs: vi.fn(),
}));

vi.mock('../services/trust-score-service', () => ({
  recalculateTrustScoreForPharmacy: vi.fn(),
}));

vi.mock('../services/notification-service', () => ({
  createNotification: vi.fn(),
}));

vi.mock('../services/logger', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: mocks.loggerError,
  },
}));

vi.mock('../services/proposal-priority-service', () => ({
  getProposalPriority: vi.fn().mockReturnValue({ score: 0, label: 'low' }),
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn(() => ({})),
  eq: vi.fn(() => ({})),
  or: vi.fn(() => ({})),
  asc: vi.fn(() => ({})),
  desc: vi.fn(() => ({})),
  inArray: vi.fn(() => ({})),
  sql: vi.fn(() => ({})),
}));

import exchangeRouter from '../routes/exchange';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/exchange', exchangeRouter);
  return app;
}

// Helper to build chained query mock
function createSelectChain(resolvedValue: unknown[]) {
  const query: Record<string, ReturnType<typeof vi.fn>> = {
    from: vi.fn(),
    leftJoin: vi.fn(),
    innerJoin: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
  };
  query.from.mockReturnValue(query);
  query.leftJoin.mockReturnValue(query);
  query.innerJoin.mockReturnValue(query);
  query.where.mockReturnValue(query);
  query.orderBy.mockReturnValue(query);
  query.limit.mockResolvedValue(resolvedValue);
  return query;
}

function createLimitlessSelectChain(resolvedValue: unknown[]) {
  const query: Record<string, ReturnType<typeof vi.fn>> = {
    from: vi.fn(),
    leftJoin: vi.fn(),
    innerJoin: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
  };
  query.from.mockReturnValue(query);
  query.leftJoin.mockReturnValue(query);
  query.innerJoin.mockReturnValue(query);
  query.where.mockReturnValue(query);
  query.orderBy.mockResolvedValue(resolvedValue);
  return query;
}

const BASE_PROPOSAL = {
  id: 5,
  pharmacyAId: 2,
  pharmacyBId: 3,
  status: 'proposed',
  totalValueA: '1000',
  totalValueB: '1000',
  valueDifference: '0',
  proposedAt: '2026-02-01T10:00:00.000Z',
  completedAt: null,
};

const PHARM_A = { name: '薬局A', phone: '000-0000', fax: '000-0001', address: '東京', prefecture: '東京都' };
const PHARM_B = { name: '薬局B', phone: '111-0000', fax: '111-0001', address: '大阪', prefecture: '大阪府' };

const ITEMS = [
  { id: 1, deadStockItemId: 10, fromPharmacyId: 2, toPharmacyId: 3, quantity: 5, yakkaValue: '500', drugName: 'テスト薬A', unit: '錠', yakkaUnitPrice: '100' },
];

const ACTION_ROWS = [
  { action: 'proposal_accept', detail: 'proposalId=5|status=accepted_a', createdAt: '2026-02-02T10:00:00.000Z', actorPharmacyId: 2, actorName: '薬局A' },
];

const COMMENT_ROWS = [
  { id: 1, body: 'テストコメント', createdAt: '2026-02-03T10:00:00.000Z', authorPharmacyId: 2, authorName: '薬局A' },
];

const FEEDBACK_ROWS = [
  { id: 1, rating: 5, comment: '良い取引でした', createdAt: '2026-02-04T10:00:00.000Z', fromPharmacyId: 2, fromName: '薬局A' },
];

/**
 * Set up all db.select() calls in order for the GET /proposals/:id route.
 * Call order:
 *   1. proposal lookup (limit)
 *   2. items (innerJoin + where)
 *   3. pharmA (limit)
 *   4. pharmB (limit)
 *   5. actionRows (orderBy)
 *   6. commentRows (orderBy)
 *   7. feedbackRows (orderBy)
 */
function setupDetailQueries(opts?: {
  proposal?: unknown[];
  items?: unknown[];
  pharmA?: unknown[];
  pharmB?: unknown[];
  actionRows?: unknown[];
  commentRows?: unknown[];
  feedbackRows?: unknown[];
}) {
  const callIndex = { value: 0 };
  const queries = [
    createSelectChain(opts?.proposal ?? [BASE_PROPOSAL]),  // 1: proposal
    createSelectChain(opts?.items ?? ITEMS),                 // 2: items (innerJoin + where, no limit — but our chain handles it)
    createSelectChain(opts?.pharmA ?? [PHARM_A]),            // 3: pharmA
    createSelectChain(opts?.pharmB ?? [PHARM_B]),            // 4: pharmB
    createLimitlessSelectChain(opts?.actionRows ?? ACTION_ROWS), // 5: actionRows
    createLimitlessSelectChain(opts?.commentRows ?? COMMENT_ROWS), // 6: commentRows
    createLimitlessSelectChain(opts?.feedbackRows ?? FEEDBACK_ROWS), // 7: feedbackRows
  ];

  mocks.db.select.mockImplementation(() => {
    const idx = callIndex.value;
    callIndex.value++;
    if (idx < queries.length) return queries[idx];
    // Fallback for any additional calls
    return createSelectChain([]);
  });
}

describe('GET /api/exchange/proposals/:id — enrichedTimeline', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns enrichedTimeline field in response', async () => {
    const app = createApp();
    setupDetailQueries();

    const response = await request(app).get('/api/exchange/proposals/5');

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('enrichedTimeline');
    expect(Array.isArray(response.body.enrichedTimeline)).toBe(true);
  });

  it('includes status_change events in enrichedTimeline', async () => {
    const app = createApp();
    setupDetailQueries();

    const response = await request(app).get('/api/exchange/proposals/5');

    expect(response.status).toBe(200);
    const statusEvents = response.body.enrichedTimeline.filter(
      (e: { eventType: string }) => e.eventType === 'status_change',
    );
    // Should have at least 2: proposal_created + proposal_accept
    expect(statusEvents.length).toBeGreaterThanOrEqual(2);
    expect(statusEvents[0]).toMatchObject({
      eventType: 'status_change',
    });
    // Verify statusFrom/statusTo are present on status_change events
    const acceptEvent = statusEvents.find((e: { action: string }) => e.action === 'proposal_accept');
    if (acceptEvent) {
      expect(acceptEvent.statusFrom).toBeDefined();
      expect(acceptEvent.statusTo).toBeDefined();
    }
  });

  it('includes comment events in enrichedTimeline', async () => {
    const app = createApp();
    setupDetailQueries();

    const response = await request(app).get('/api/exchange/proposals/5');

    expect(response.status).toBe(200);
    const commentEvents = response.body.enrichedTimeline.filter(
      (e: { eventType: string }) => e.eventType === 'comment',
    );
    expect(commentEvents.length).toBe(1);
    expect(commentEvents[0]).toMatchObject({
      eventType: 'comment',
      action: 'comment_added',
      label: 'コメント追加',
      commentBody: 'テストコメント',
      actorPharmacyId: 2,
      actorName: '薬局A',
    });
  });

  it('includes feedback events in enrichedTimeline', async () => {
    const app = createApp();
    setupDetailQueries();

    const response = await request(app).get('/api/exchange/proposals/5');

    expect(response.status).toBe(200);
    const feedbackEvents = response.body.enrichedTimeline.filter(
      (e: { eventType: string }) => e.eventType === 'feedback',
    );
    expect(feedbackEvents.length).toBe(1);
    expect(feedbackEvents[0]).toMatchObject({
      eventType: 'feedback',
      action: 'feedback_submitted',
      label: '評価登録',
      feedbackRating: 5,
      feedbackComment: '良い取引でした',
      actorPharmacyId: 2,
      actorName: '薬局A',
    });
  });

  it('sorts enrichedTimeline by at descending (newest first)', async () => {
    const app = createApp();
    setupDetailQueries();

    const response = await request(app).get('/api/exchange/proposals/5');

    expect(response.status).toBe(200);
    const timeline = response.body.enrichedTimeline as { at: string | null }[];
    for (let i = 0; i < timeline.length - 1; i++) {
      const curr = timeline[i].at;
      const next = timeline[i + 1].at;
      if (curr && next) {
        expect(new Date(curr).getTime()).toBeGreaterThanOrEqual(new Date(next).getTime());
      }
    }
  });

  it('preserves existing timeline field unchanged (backward compat)', async () => {
    const app = createApp();
    setupDetailQueries();

    const response = await request(app).get('/api/exchange/proposals/5');

    expect(response.status).toBe(200);
    // timeline field must exist
    expect(response.body).toHaveProperty('timeline');
    expect(Array.isArray(response.body.timeline)).toBe(true);
    // timeline events should NOT have eventType (old format)
    const firstTimelineEvent = response.body.timeline[0];
    expect(firstTimelineEvent).toHaveProperty('action');
    expect(firstTimelineEvent).toHaveProperty('label');
    expect(firstTimelineEvent).toHaveProperty('at');
    expect(firstTimelineEvent).not.toHaveProperty('eventType');
    expect(firstTimelineEvent).not.toHaveProperty('commentBody');
  });

  it('returns enrichedTimeline with empty comments and feedback', async () => {
    const app = createApp();
    setupDetailQueries({ commentRows: [], feedbackRows: [] });

    const response = await request(app).get('/api/exchange/proposals/5');

    expect(response.status).toBe(200);
    expect(response.body.enrichedTimeline.length).toBeGreaterThanOrEqual(1);
    // Only status_change events
    const nonStatusEvents = response.body.enrichedTimeline.filter(
      (e: { eventType: string }) => e.eventType !== 'status_change',
    );
    expect(nonStatusEvents.length).toBe(0);
  });
});
