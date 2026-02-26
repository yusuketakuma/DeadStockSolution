import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/notification-service', () => ({
  getUnreadCount: vi.fn(),
  markAsRead: vi.fn(),
  markAllAsRead: vi.fn(),
}));

vi.mock('../services/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import { getUnreadCount, markAsRead, markAllAsRead } from '../services/notification-service';

describe('notification routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /unread-count', () => {
    it('getUnreadCount returns a number', async () => {
      vi.mocked(getUnreadCount).mockResolvedValue(3);
      const result = await getUnreadCount(10);
      expect(result).toBe(3);
    });
  });

  describe('PATCH /:id/read', () => {
    it('markAsRead returns true on success', async () => {
      vi.mocked(markAsRead).mockResolvedValue(true);
      const result = await markAsRead(1, 10);
      expect(result).toBe(true);
    });

    it('markAsRead returns false when not found', async () => {
      vi.mocked(markAsRead).mockResolvedValue(false);
      const result = await markAsRead(999, 10);
      expect(result).toBe(false);
    });
  });

  describe('PATCH /read-all', () => {
    it('markAllAsRead returns count', async () => {
      vi.mocked(markAllAsRead).mockResolvedValue(5);
      const result = await markAllAsRead(10);
      expect(result).toBe(5);
    });
  });
});
