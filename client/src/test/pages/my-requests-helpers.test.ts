import { describe, expect, it } from 'vitest';
import {
  matchesQueueFilter,
  priorityBadge,
  requestSortRank,
  statusBadge,
} from '../../pages/my-requests/helpers';
import type { RequestItem } from '../../pages/my-requests/types';

const baseItem: RequestItem = {
  id: 1,
  requestText: 'テスト要望',
  category: 'improvement',
  priority: 'normal',
  closeReason: null,
  assignedAdminId: null,
  assignedAdminName: null,
  requesterLastViewedAt: null,
  adminLastViewedAt: null,
  latestUserMessageAt: null,
  latestStaffMessageAt: null,
  openclawStatus: 'queued',
  openclawThreadId: null,
  openclawSummary: null,
  workflowStatus: 'queued',
  latestSummary: null,
  branchName: null,
  prUrl: null,
  prNumber: null,
  updatedAt: null,
  createdAt: null,
  hasUnread: false,
  waitingOn: null,
  isOverdue: false,
};

describe('my-requests helpers', () => {
  it('maps workflow status to badge metadata', () => {
    expect(statusBadge('awaiting_user')).toEqual({ bg: 'primary', label: '回答待ち' });
    expect(statusBadge('completed')).toEqual({ bg: 'success', label: '完了' });
    expect(statusBadge('unexpected')).toEqual({ bg: 'secondary', label: '受付済み' });
  });

  it('maps priority to badge metadata', () => {
    expect(priorityBadge('urgent')).toEqual({ bg: 'danger', label: '緊急' });
    expect(priorityBadge('low')).toEqual({ bg: 'secondary', label: '低' });
    expect(priorityBadge('normal')).toEqual({ bg: 'info', label: '通常' });
  });

  it('filters queue views correctly', () => {
    expect(matchesQueueFilter({ ...baseItem, waitingOn: 'user' }, 'my_turn')).toBe(true);
    expect(matchesQueueFilter(baseItem, 'my_turn')).toBe(false);
    expect(matchesQueueFilter({ ...baseItem, isOverdue: true }, 'overdue')).toBe(true);
    expect(matchesQueueFilter({ ...baseItem, hasUnread: true }, 'unread')).toBe(true);
    expect(matchesQueueFilter({ ...baseItem, waitingOn: 'openclaw' }, 'openclaw')).toBe(true);
  });

  it('sorts actionable requests before passive ones', () => {
    expect(requestSortRank({ ...baseItem, isOverdue: true })).toBe(0);
    expect(requestSortRank({ ...baseItem, waitingOn: 'user' })).toBe(1);
    expect(requestSortRank({ ...baseItem, hasUnread: true })).toBe(2);
    expect(requestSortRank({ ...baseItem, waitingOn: 'admin' })).toBe(3);
    expect(requestSortRank({ ...baseItem, waitingOn: 'openclaw' })).toBe(4);
    expect(requestSortRank(baseItem)).toBe(5);
  });
});
