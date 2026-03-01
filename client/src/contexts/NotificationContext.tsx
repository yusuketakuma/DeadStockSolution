import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from '../api/client';
import { useAuth } from './AuthContext';

interface NotificationContextValue {
  unreadCount: number;
  refreshCount: () => Promise<void>;
}

const NotificationContext = createContext<NotificationContextValue>({
  unreadCount: 0,
  refreshCount: async () => {},
});

const POLL_INTERVAL_MS = 60_000;
const MIN_FETCH_INTERVAL_MS = 5_000;

export function NotificationProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastFetchAtRef = useRef(0);

  const fetchCount = useCallback(async () => {
    if (!user) return;
    const now = Date.now();
    if (now - lastFetchAtRef.current < MIN_FETCH_INTERVAL_MS) return;
    lastFetchAtRef.current = now;
    try {
      const data = await api.get<{ unreadCount: number }>('/notifications/unread-count');
      setUnreadCount(data.unreadCount);
    } catch {
      // ベストエフォート: エラー時は前回の値を保持
    }
  }, [user]);

  useEffect(() => {
    if (!user) {
      setUnreadCount(0);
      return;
    }

    void fetchCount();

    timerRef.current = setInterval(() => {
      if (document.visibilityState === 'visible') {
        void fetchCount();
      }
    }, POLL_INTERVAL_MS);

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void fetchCount();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [user, fetchCount]);

  return (
    <NotificationContext.Provider value={{ unreadCount, refreshCount: fetchCount }}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  return useContext(NotificationContext);
}
