import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useAuth } from './AuthContext';
import { timelineApi } from '../api/timeline';
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

  // フィルタ・ページネーション
  selectedPriority: TimelinePriority | null;
  page: number;

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
  page: 1,
  refreshTimeline: async () => {},
  refreshUnreadCount: async () => {},
  markViewed: async () => {},
  setSelectedPriority: () => {},
  loadMore: async () => {},
});

const POLL_INTERVAL_MS = 60_000;
const MIN_FETCH_INTERVAL_MS = 5_000;
const PAGE_LIMIT = 20;

export function TimelineProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();

  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [selectedPriority, setSelectedPriority] = useState<TimelinePriority | null>(null);

  const [digestEvents, setDigestEvents] = useState<TimelineEvent[]>([]);
  const [digestLoading, setDigestLoading] = useState(false);

  const [unreadCount, setUnreadCount] = useState(0);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastFetchAtRef = useRef(0);

  const fetchTimeline = useCallback(async (
    targetPage: number,
    priority: TimelinePriority | null,
    append: boolean,
  ) => {
    if (!user) return;
    setLoading(true);
    setError('');
    try {
      const params: Parameters<typeof timelineApi.getTimeline>[0] = {
        page: targetPage,
        limit: PAGE_LIMIT,
      };
      if (priority) params.priority = priority;

      const data = await timelineApi.getTimeline(params);
      if (append) {
        setEvents((prev) => [...prev, ...data.events]);
      } else {
        setEvents(data.events);
      }
      setTotal(data.total);
      setHasMore(data.hasMore);
    } catch {
      setError('タイムラインの取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, [user]);

  const fetchDigest = useCallback(async () => {
    if (!user) return;
    setDigestLoading(true);
    try {
      const data = await timelineApi.getDigest();
      setDigestEvents(data.events);
    } catch {
      // ベストエフォート
    } finally {
      setDigestLoading(false);
    }
  }, [user]);

  const fetchUnreadCount = useCallback(async () => {
    if (!user) return;
    const now = Date.now();
    if (now - lastFetchAtRef.current < MIN_FETCH_INTERVAL_MS) return;
    lastFetchAtRef.current = now;
    try {
      const data = await timelineApi.getUnreadCount();
      setUnreadCount(data.unreadCount);
    } catch {
      // ベストエフォート
    }
  }, [user]);

  const refreshTimeline = useCallback(async () => {
    setPage(1);
    await Promise.all([
      fetchTimeline(1, selectedPriority, false),
      fetchDigest(),
      fetchUnreadCount(),
    ]);
  }, [fetchTimeline, fetchDigest, fetchUnreadCount, selectedPriority]);

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
    const nextPage = page + 1;
    setPage(nextPage);
    await fetchTimeline(nextPage, selectedPriority, true);
  }, [page, fetchTimeline, selectedPriority]);

  const handlePriorityChange = useCallback((priority: TimelinePriority | null) => {
    setSelectedPriority(priority);
    setPage(1);
    setEvents([]);
    void fetchTimeline(1, priority, false);
  }, [fetchTimeline]);

  // 初回フェッチ + ポーリング
  useEffect(() => {
    if (!user) {
      setEvents([]);
      setDigestEvents([]);
      setUnreadCount(0);
      setTotal(0);
      setHasMore(false);
      setError('');
      return;
    }

    void refreshTimeline();

    timerRef.current = setInterval(() => {
      if (document.visibilityState === 'visible') {
        void fetchUnreadCount();
      }
    }, POLL_INTERVAL_MS);

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void fetchUnreadCount();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [user, refreshTimeline, fetchUnreadCount]);

  return (
    <TimelineContext.Provider value={{
      events,
      total,
      hasMore,
      loading,
      error,
      digestEvents,
      digestLoading,
      unreadCount,
      selectedPriority,
      page,
      refreshTimeline,
      refreshUnreadCount: fetchUnreadCount,
      markViewed,
      setSelectedPriority: handlePriorityChange,
      loadMore,
    }}>
      {children}
    </TimelineContext.Provider>
  );
}

export function useTimeline() {
  return useContext(TimelineContext);
}
