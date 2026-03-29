import { useEffect, useRef, useState } from 'react';
import { buildApiUrl } from '../api/client';
import { usePolledFetch } from './usePolledFetch';

interface UseSseRefreshOptions {
  enabled: boolean;
  streamPath: string;
  events: string[];
  onRefresh: () => Promise<void> | void;
  fallbackIntervalMs?: number;
  minFetchIntervalMs?: number;
}

const MAX_CONSECUTIVE_ERRORS = 5;
const RECONNECT_DELAY_MS = 30_000;

export function useSseRefresh(options: UseSseRefreshOptions): { connected: boolean } {
  const {
    enabled,
    streamPath,
    events,
    onRefresh,
    fallbackIntervalMs = 60_000,
    minFetchIntervalMs = 5_000,
  } = options;

  const [connected, setConnected] = useState(false);
  const onRefreshRef = useRef(onRefresh);
  const eventsRef = useRef(events);
  onRefreshRef.current = onRefresh;
  eventsRef.current = events;
  const eventsKey = events.join('|');

  useEffect(() => {
    if (!enabled) {
      setConnected(false);
      return;
    }

    if (typeof window === 'undefined' || typeof EventSource === 'undefined') {
      setConnected(false);
      return;
    }

    let source: EventSource | null = null;
    let consecutiveErrors = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    function connect(): void {
      if (disposed) return;

      source = new EventSource(buildApiUrl(streamPath), { withCredentials: true });

      source.onopen = () => {
        consecutiveErrors = 0;
        setConnected(true);
        void onRefreshRef.current();
      };

      source.onerror = () => {
        setConnected(false);
        consecutiveErrors++;

        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS && source) {
          source.close();
          source = null;
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            consecutiveErrors = 0;
            connect();
          }, RECONNECT_DELAY_MS);
        }
      };

      const currentEvents = eventsRef.current;
      for (const eventName of currentEvents) {
        source.addEventListener(eventName, () => {
          void onRefreshRef.current();
        });
      }
    }

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
      }
      if (source) {
        source.close();
      }
    };
  }, [enabled, eventsKey, streamPath]);

  usePolledFetch(async () => {
    await onRefreshRef.current();
  }, {
    enabled: enabled && !connected,
    intervalMs: fallbackIntervalMs,
    minFetchIntervalMs,
  });

  return { connected };
}
