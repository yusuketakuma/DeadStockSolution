import { useMemo, useState } from 'react';

interface QueueFilterItem {
  id: number;
  waitingOn: 'user' | 'admin' | 'openclaw' | null;
  isOverdue: boolean;
  hasUnread: boolean;
  latestEscalatedAt?: string | null;
  updatedAt: string | null;
  createdAt: string | null;
}

export type AdminQueueFilter = 'all' | 'my_turn' | 'overdue' | 'unread' | 'openclaw' | 'escalated';

function adminRequestSortRank(item: QueueFilterItem): number {
  if (item.isOverdue) return 0;
  if (item.latestEscalatedAt) return 1;
  if (item.waitingOn === 'admin') return 1;
  if (item.hasUnread) return 2;
  if (item.waitingOn === 'user') return 3;
  if (item.waitingOn === 'openclaw') return 4;
  return 5;
}

function matchesAdminQueueFilter(item: QueueFilterItem, filter: AdminQueueFilter): boolean {
  if (filter === 'my_turn') return item.waitingOn === 'admin';
  if (filter === 'overdue') return item.isOverdue;
  if (filter === 'unread') return item.hasUnread;
  if (filter === 'openclaw') return item.waitingOn === 'openclaw';
  if (filter === 'escalated') return Boolean(item.latestEscalatedAt);
  return true;
}

export function useAdminUserRequestsQueue<T extends QueueFilterItem>(items: T[], initialFilter: AdminQueueFilter = 'all') {
  const [queueFilter, setQueueFilter] = useState<AdminQueueFilter>(initialFilter);

  const itemSummary = useMemo(() => ({
    myTurn: items.filter((item) => item.waitingOn === 'admin').length,
    overdue: items.filter((item) => item.isOverdue).length,
    unread: items.filter((item) => item.hasUnread).length,
    openclaw: items.filter((item) => item.waitingOn === 'openclaw').length,
    escalated: items.filter((item) => item.latestEscalatedAt).length,
  }), [items]);

  const displayItems = useMemo(() => [...items]
    .filter((item) => matchesAdminQueueFilter(item, queueFilter))
    .sort((left, right) => {
      const rankDiff = adminRequestSortRank(left) - adminRequestSortRank(right);
      if (rankDiff !== 0) return rankDiff;
      return new Date(right.updatedAt ?? right.createdAt ?? '').getTime()
        - new Date(left.updatedAt ?? left.createdAt ?? '').getTime();
    }), [items, queueFilter]);

  return {
    queueFilter,
    setQueueFilter,
    itemSummary,
    displayItems,
  };
}
