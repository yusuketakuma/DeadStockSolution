import { useEffect, useRef } from 'react';

interface UseSSEOptions {
  onNotification: (data: unknown) => void;
  enabled?: boolean;
}

export function useSSE({ onNotification, enabled = true }: UseSSEOptions): void {
  const retryDelayRef = useRef(1000);
  const esRef = useRef<EventSource | null>(null);
  const onNotificationRef = useRef(onNotification);
  const enabledRef = useRef(enabled);
  onNotificationRef.current = onNotification;
  enabledRef.current = enabled;

  useEffect(() => {
    if (!enabled) return;

    let disposed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      if (disposed) return;
      const es = new EventSource('/api/sse/events', { withCredentials: true });

      es.addEventListener('connected', () => {
        retryDelayRef.current = 1000;
      });

      es.addEventListener('notification', (event: MessageEvent) => {
        try {
          onNotificationRef.current(JSON.parse(event.data as string));
        } catch {
          // JSON パースエラーは無視
        }
      });

      es.onerror = () => {
        es.close();
        if (disposed) return;
        const delay = Math.min(retryDelayRef.current, 30000);
        retryDelayRef.current = Math.min(retryDelayRef.current * 2, 30000);
        reconnectTimer = setTimeout(connect, delay);
      };

      esRef.current = es;
    }

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      esRef.current?.close();
    };
  }, [enabled]);
}
