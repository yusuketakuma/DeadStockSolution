import { useEffect, useRef } from 'react';

interface UsePolledFetchOptions {
  /** ポーリングを有効にするかどうか */
  enabled: boolean;
  /** ポーリング間隔 (ms) */
  intervalMs?: number;
  /** 最小フェッチ間隔 (ms) — スロットル */
  minFetchIntervalMs?: number;
}

/**
 * 一定間隔でフェッチ関数を呼び出す共通 hook。
 *
 * - setInterval でポーリング
 * - visibilitychange でタブ復帰時に即フェッチ
 * - minFetchIntervalMs でスロットル
 *
 * 注: 初回フェッチは行わない（呼び出し元が責任を持つ）
 */
export function usePolledFetch(
  fetchFn: () => Promise<void>,
  options: UsePolledFetchOptions,
): void {
  const { enabled, intervalMs = 60_000, minFetchIntervalMs = 5_000 } = options;
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastFetchAtRef = useRef(0);

  // fetchFn の最新版を常に参照するための ref
  const fetchFnRef = useRef(fetchFn);
  fetchFnRef.current = fetchFn;

  useEffect(() => {
    if (!enabled) return;

    const throttledFetch = () => {
      const now = Date.now();
      if (now - lastFetchAtRef.current < minFetchIntervalMs) return;
      lastFetchAtRef.current = now;
      void fetchFnRef.current();
    };

    timerRef.current = setInterval(() => {
      if (document.visibilityState === 'visible') {
        throttledFetch();
      }
    }, intervalMs);

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        throttledFetch();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [enabled, intervalMs, minFetchIntervalMs]);
}
