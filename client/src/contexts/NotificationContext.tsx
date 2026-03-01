import { createContext, useContext, type ReactNode } from 'react';
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

  return (
    <NotificationContext.Provider value={{ unreadCount, refreshCount: refreshUnreadCount }}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  return useContext(NotificationContext);
}
