import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
    insert: vi.fn(),
  },
}));

vi.mock('../config/database', () => ({
  db: mocks.db,
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(() => ({})),
  asc: vi.fn(() => ({})),
}));

import { ensureOpenClawWorkItem } from '../services/openclaw/thread-service';

function createLimitQuery(result: unknown) {
  const query = {
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
  };
  query.from.mockReturnValue(query);
  query.where.mockReturnValue(query);
  query.limit.mockResolvedValue(result);
  return query;
}

describe('openclaw-thread-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('preserves work item type and metadata when updating an existing item without source metadata input', async () => {
    mocks.db.select.mockReturnValue(createLimitQuery([{
      id: 1,
      workItemType: 'incident_investigation',
      metadataJson: '{"source":"alert"}',
    }]));

    const where = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn().mockReturnValue({ where });
    mocks.db.update.mockReturnValue({ set });

    await ensureOpenClawWorkItem({
      requestId: 11,
      pharmacyId: 3,
      workflowStatus: 'implementing',
      latestSummary: '対応中',
    });

    const payload = set.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(payload, 'workItemType')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(payload, 'metadataJson')).toBe(false);
  });
});
