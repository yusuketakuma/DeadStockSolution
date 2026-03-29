import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_PUSH_NOTIFICATION_PREFERENCES,
  getPushNotificationPreferences,
  upsertPushNotificationPreferences,
} from '../services/push-notification-preferences-service';

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

vi.mock('../db/schema', () => ({
  pushNotificationPreferences: {
    id: 'id',
    pharmacyId: 'pharmacy_id',
    categoriesJson: 'categories_json',
    allowCritical: 'allow_critical',
    updatedAt: 'updated_at',
  },
}));

function queueSelectResults(...rowsPerCall: unknown[][]) {
  let index = 0;
  mocks.db.select.mockImplementation(() => ({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(rowsPerCall[index++] ?? []),
      }),
    }),
  }));
}

function mockUpdate() {
  const where = vi.fn().mockResolvedValue(undefined);
  const set = vi.fn().mockReturnValue({ where });
  mocks.db.update.mockReturnValue({ set });
  return { set, where };
}

function mockInsert() {
  const values = vi.fn().mockResolvedValue(undefined);
  mocks.db.insert.mockReturnValue({ values });
  return { values };
}

describe('push-notification-preferences-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns default preferences when no row exists', async () => {
    queueSelectResults([]);

    await expect(getPushNotificationPreferences(12)).resolves.toEqual(
      DEFAULT_PUSH_NOTIFICATION_PREFERENCES,
    );
  });

  it('normalizes stored category flags and allowCritical', async () => {
    queueSelectResults([
      {
        categoriesJson: {
          proposals: false,
          comments: false,
        },
        allowCritical: false,
      },
    ]);

    await expect(getPushNotificationPreferences(3)).resolves.toEqual({
      categories: {
        proposals: false,
        requests: true,
        comments: false,
        matching: true,
        groups: true,
        alerts: true,
        admin: true,
      },
      allowCritical: false,
    });
  });

  it('updates an existing preference row with merged categories', async () => {
    queueSelectResults(
      [
        {
          categoriesJson: {
            proposals: true,
            requests: true,
            comments: true,
            matching: true,
            groups: true,
            alerts: true,
            admin: true,
          },
          allowCritical: true,
        },
      ],
      [{ id: 99 }],
    );
    const update = mockUpdate();

    await expect(
      upsertPushNotificationPreferences(5, {
        categories: { proposals: false, alerts: false },
        allowCritical: false,
      }),
    ).resolves.toEqual({
      categories: {
        proposals: false,
        requests: true,
        comments: true,
        matching: true,
        groups: true,
        alerts: false,
        admin: true,
      },
      allowCritical: false,
    });

    expect(update.set).toHaveBeenCalledWith(
      expect.objectContaining({
        categoriesJson: expect.objectContaining({
          proposals: false,
          alerts: false,
        }),
        allowCritical: false,
      }),
    );
  });

  it('rejects unknown category names before touching the database', async () => {
    const insert = mockInsert();

    await expect(
      upsertPushNotificationPreferences(5, {
        categories: {
          proposals: true,
          invalidCategory: false,
        } as unknown as Record<string, boolean>,
      }),
    ).rejects.toThrow('Invalid push notification category: invalidCategory');

    expect(mocks.db.select).not.toHaveBeenCalled();
    expect(insert.values).not.toHaveBeenCalled();
  });
});
