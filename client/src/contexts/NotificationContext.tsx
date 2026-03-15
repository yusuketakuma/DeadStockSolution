import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useTimeline } from './TimelineContext';

interface NotificationContextValue {
  unreadCount: number;
  refreshCount: () => Promise<void>;
}

const NotificationContext = createContext<NotificationContextValue>({
  unreadCount: 0,
  refreshCount: async () => {},
});

export function NotificationProvider({ children }: { children: ReactNode }) {
  const { unreadCount, refreshUnreadCount } = useTimeline();

  const value = useMemo(() => ({
    unreadCount, refreshCount: refreshUnreadCount
  }), [unreadCount, refreshUnreadCount]);

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  return useContext(NotificationContext);
}
