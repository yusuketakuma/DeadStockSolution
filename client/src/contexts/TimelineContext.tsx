import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from './AuthContext';
import { timelineApi } from '../api/timeline';
import { usePolledFetch } from '../hooks/usePolledFetch';
import type { TimelineEvent, TimelinePriority } from '../types/timeline';

interface TimelineContextValue {
  // タイムラインイベント
  events: TimelineEvent[];
  total: number;
  hasMore: boolean;
  loading: boolean;
  error: string;

  // ダイジェスト（Critical/High 最大5件）
  digestEvents: TimelineEvent[];
  digestLoading: boolean;

  // 未読数
  unreadCount: number;

  // フィルタ
  selectedPriority: TimelinePriority | null;

  // アクション
  refreshTimeline: () => Promise<void>;
  refreshUnreadCount: () => Promise<void>;
  markViewed: () => Promise<void>;
  setSelectedPriority: (priority: TimelinePriority | null) => void;
  loadMore: () => Promise<void>;
}

const TimelineContext = createContext<TimelineContextValue>({
  events: [],
  total: 0,
  hasMore: false,
  loading: false,
  error: '',
  digestEvents: [],
  digestLoading: false,
  unreadCount: 0,
  selectedPriority: null,
  refreshTimeline: async () => {},
  refreshUnreadCount: async () => {},
  markViewed: async () => {},
  setSelectedPriority: () => {},
  loadMore: async () => {},
});

const PAGE_LIMIT = 20;

export function TimelineProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();

  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [selectedPriority, setSelectedPriority] = useState<TimelinePriority | null>(null);

  const [digestEvents, setDigestEvents] = useState<TimelineEvent[]>([]);
  const [digestLoading, setDigestLoading] = useState(false);

  const [unreadCount, setUnreadCount] = useState(0);

  const fetchTimeline = useCallback(async (
    cursor: string | undefined,
    priority: TimelinePriority | null,
    append: boolean,
  ) => {
    if (!user) return;
    setLoading(true);
    setError('');
    try {
      const params: Parameters<typeof timelineApi.getTimeline>[0] = {
        limit: PAGE_LIMIT,
      };
      if (cursor) params.cursor = cursor;
      if (priority) params.priority = priority;

      const data = await timelineApi.getTimeline(params);
      if (append) {
        setEvents((prev) => [...prev, ...data.events]);
      } else {
        setEvents(data.events);
        setTotal(data.total);
      }
      setHasMore(data.hasMore);
      setNextCursor(data.nextCursor ?? data.pagination?.nextCursor ?? null);
    } catch {
      setError('タイムラインの取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, [user]);

  const fetchBootstrap = useCallback(async (priority: TimelinePriority | null) => {
    if (!user) return;
    setLoading(true);
    setDigestLoading(true);
    setError('');
    try {
      const params: Parameters<typeof timelineApi.getBootstrap>[0] = {
        limit: PAGE_LIMIT,
      };
      if (priority) params.priority = priority;

      const data = await timelineApi.getBootstrap(params);
      setEvents(data.timeline.events);
      setTotal(data.timeline.total);
      setHasMore(data.timeline.hasMore);
      setNextCursor(data.timeline.nextCursor ?? data.timeline.pagination?.nextCursor ?? null);
      setDigestEvents(data.digest.events);
      setUnreadCount(data.unreadCount);
    } catch {
      setError('タイムラインの取得に失敗しました');
    } finally {
      setLoading(false);
      setDigestLoading(false);
    }
  }, [user]);

  const fetchUnreadCount = useCallback(async () => {
    if (!user) return;
    try {
      const data = await timelineApi.getUnreadCount();
      setUnreadCount(data.unreadCount);
    } catch {
      // ベストエフォート
    }
  }, [user]);

  const refreshTimeline = useCallback(async () => {
    setNextCursor(null);
    await fetchBootstrap(selectedPriority);
  }, [fetchBootstrap, selectedPriority]);

  const markViewed = useCallback(async () => {
    if (!user) return;
    try {
      await timelineApi.markViewed();
      setUnreadCount(0);
    } catch {
      // ベストエフォート
    }
  }, [user]);

  const loadMore = useCallback(async () => {
    if (!user || !hasMore || !nextCursor) return;
    await fetchTimeline(nextCursor, selectedPriority, true);
  }, [user, hasMore, nextCursor, fetchTimeline, selectedPriority]);

  const handlePriorityChange = useCallback((priority: TimelinePriority | null) => {
    setSelectedPriority(priority);
    setNextCursor(null);
    setEvents([]);
    void fetchBootstrap(priority);
  }, [fetchBootstrap]);

  // ポーリング（スロットル込み）
  usePolledFetch(fetchUnreadCount, { enabled: !!user });

  // 初回フェッチ + ログアウト時リセット（user 変更時のみ発火）
  useEffect(() => {
    if (!user) {
      setEvents([]);
      setDigestEvents([]);
      setUnreadCount(0);
      setTotal(0);
      setHasMore(false);
      setError('');
      setNextCursor(null);
      return;
    }

    void refreshTimeline();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const value = useMemo<TimelineContextValue>(() => ({
    events,
    total,
    hasMore,
    loading,
    error,
    digestEvents,
    digestLoading,
    unreadCount,
    selectedPriority,
    refreshTimeline,
    refreshUnreadCount: fetchUnreadCount,
    markViewed,
    setSelectedPriority: handlePriorityChange,
    loadMore,
  }), [
    events, total, hasMore, loading, error,
    digestEvents, digestLoading, unreadCount, selectedPriority,
    refreshTimeline, fetchUnreadCount, markViewed, handlePriorityChange, loadMore,
  ]);

  return (
    <TimelineContext.Provider value={value}>
      {children}
    </TimelineContext.Provider>
  );
}

export function useTimeline() {
  return useContext(TimelineContext);
}
