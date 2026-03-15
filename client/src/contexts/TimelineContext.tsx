import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
const MAX_TIMELINE_EVENTS = 200;

interface TimelineProviderInitialState {
  events?: TimelineEvent[];
  total?: number;
  hasMore?: boolean;
  loading?: boolean;
  error?: string;
  digestEvents?: TimelineEvent[];
  digestLoading?: boolean;
  unreadCount?: number;
  selectedPriority?: TimelinePriority | null;
}

interface TimelineProviderProps {
  children: ReactNode;
  initialState?: TimelineProviderInitialState;
  disableBootstrap?: boolean;
  disableUnreadPolling?: boolean;
}

export function TimelineProvider({
  children,
  initialState,
  disableBootstrap = false,
  disableUnreadPolling = false,
}: TimelineProviderProps) {
  const { user } = useAuth();

  const [events, setEvents] = useState<TimelineEvent[]>(initialState?.events ?? []);
  const [total, setTotal] = useState(initialState?.total ?? 0);
  const [hasMore, setHasMore] = useState(initialState?.hasMore ?? false);
  const [loading, setLoading] = useState(initialState?.loading ?? false);
  const [error, setError] = useState(initialState?.error ?? '');
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [selectedPriority, setSelectedPriority] = useState<TimelinePriority | null>(
    initialState?.selectedPriority ?? null,
  );

  const [digestEvents, setDigestEvents] = useState<TimelineEvent[]>(initialState?.digestEvents ?? []);
  const [digestLoading, setDigestLoading] = useState(initialState?.digestLoading ?? false);

  const [unreadCount, setUnreadCount] = useState(initialState?.unreadCount ?? 0);

  // AbortController で進行中リクエストをキャンセル可能にする
  const abortRef = useRef<AbortController | null>(null);

  const fetchTimeline = useCallback(async (
    cursor: string | undefined,
    priority: TimelinePriority | null,
    append: boolean,
  ) => {
    if (!user) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError('');
    try {
      const params: Parameters<typeof timelineApi.getTimeline>[0] = {
        limit: PAGE_LIMIT,
      };
      if (cursor) params.cursor = cursor;
      if (priority) params.priority = priority;

      const data = await timelineApi.getTimeline(params, { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (append) {
        setEvents((prev) => {
          const combined = [...prev, ...data.events];
          return combined.length > MAX_TIMELINE_EVENTS
            ? combined.slice(-MAX_TIMELINE_EVENTS)
            : combined;
        });
      } else {
        setEvents(data.events);
        setTotal(data.total);
      }
      setHasMore(data.hasMore);
      setNextCursor(data.nextCursor ?? data.pagination?.nextCursor ?? null);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError('タイムラインの取得に失敗しました');
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setLoading(false);
    }
  }, [user]);

  const fetchBootstrap = useCallback(async (priority: TimelinePriority | null) => {
    if (!user) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setDigestLoading(true);
    setError('');
    try {
      const params: Parameters<typeof timelineApi.getBootstrap>[0] = {
        limit: PAGE_LIMIT,
      };
      if (priority) params.priority = priority;

      const data = await timelineApi.getBootstrap(params, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setEvents(data.timeline.events);
      setTotal(data.timeline.total);
      setHasMore(data.timeline.hasMore);
      setNextCursor(data.timeline.nextCursor ?? data.timeline.pagination?.nextCursor ?? null);
      setDigestEvents(data.digest.events);
      setUnreadCount(data.unreadCount);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError('タイムラインの取得に失敗しました');
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
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
    if (disableBootstrap) return;
    setNextCursor(null);
    await fetchBootstrap(selectedPriority);
  }, [disableBootstrap, fetchBootstrap, selectedPriority]);

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
    if (disableBootstrap) {
      return;
    }
    void fetchBootstrap(priority);
  }, [disableBootstrap, fetchBootstrap]);

  // ポーリング（スロットル込み）
  usePolledFetch(fetchUnreadCount, { enabled: !!user && !disableUnreadPolling });

  // 初回フェッチ + ログアウト時リセット（user 変更時のみ発火）
  useEffect(() => {
    if (!user) {
      abortRef.current?.abort();
      abortRef.current = null;
      setEvents([]);
      setDigestEvents([]);
      setUnreadCount(0);
      setTotal(0);
      setHasMore(false);
      setError('');
      setNextCursor(null);
      return;
    }

    if (disableBootstrap) {
      return;
    }

    void refreshTimeline();
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
    };
    // refreshTimeline は意図的に除外: user 変更時のみ bootstrap を発火させるため
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disableBootstrap, user]);

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
