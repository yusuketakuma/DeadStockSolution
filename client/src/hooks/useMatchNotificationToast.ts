import { useEffect, useRef } from 'react';
import { useToast } from '../contexts/ToastContext';
import { useNotifications } from '../contexts/NotificationContext';

export function useMatchNotificationToast() {
  const { showInfo } = useToast();
  const { unreadCount } = useNotifications();
  const prevRef = useRef<number | null>(null);

  useEffect(() => {
    if (prevRef.current !== null && unreadCount > prevRef.current) {
      showInfo('新しいマッチング候補が見つかりました');
    }
    prevRef.current = unreadCount;
  }, [unreadCount, showInfo]);
}
