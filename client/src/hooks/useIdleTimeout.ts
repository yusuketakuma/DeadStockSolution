// 3省2ガイドライン準拠: 操作なし30分でセッションタイムアウト
// 25分で警告ダイアログを表示、30分で自動ログアウト

import { useEffect, useRef, useCallback } from 'react';

const IDLE_TIMEOUT_MS = 30 * 60 * 1000;     // 30分
const WARN_BEFORE_MS = 5 * 60 * 1000;       // 期限5分前に警告
const ACTIVITY_DEBOUNCE_MS = 500;            // mousemove/scroll の過剰発火を抑制

// 高頻度イベントと低頻度イベントを分類
const DEBOUNCED_EVENTS = ['mousemove', 'scroll'] as const;
const IMMEDIATE_EVENTS = ['mousedown', 'keydown', 'touchstart', 'click'] as const;

export interface IdleTimeoutOptions {
  onWarn: () => void;    // 残り5分時に呼び出される
  onTimeout: () => void; // タイムアウト時に呼び出される
  enabled?: boolean;
}

export interface IdleTimeoutHandle {
  reset: () => void;     // 警告表示後にセッション延長する際に呼ぶ
}

export function useIdleTimeout(
  { onWarn, onTimeout, enabled = true }: IdleTimeoutOptions,
): IdleTimeoutHandle {
  const warnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const logoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warnedRef = useRef(false);

  const clearTimers = useCallback(() => {
    if (warnTimerRef.current) clearTimeout(warnTimerRef.current);
    if (logoutTimerRef.current) clearTimeout(logoutTimerRef.current);
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
  }, []);

  const armTimers = useCallback(() => {
    if (!enabled) return;
    clearTimers();
    warnedRef.current = false;

    warnTimerRef.current = setTimeout(() => {
      warnedRef.current = true;
      onWarn();
    }, IDLE_TIMEOUT_MS - WARN_BEFORE_MS);

    logoutTimerRef.current = setTimeout(() => {
      onTimeout();
    }, IDLE_TIMEOUT_MS);
  }, [enabled, clearTimers, onWarn, onTimeout]);

  // 公開: セッション延長後に呼ぶとタイマーを再セット
  const reset = useCallback(() => {
    armTimers();
  }, [armTimers]);

  useEffect(() => {
    if (!enabled) return;

    armTimers();

    const handleImmediate = () => {
      if (!warnedRef.current) armTimers();
    };

    const handleDebounced = () => {
      if (warnedRef.current) return;
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(armTimers, ACTIVITY_DEBOUNCE_MS);
    };

    for (const event of IMMEDIATE_EVENTS) {
      window.addEventListener(event, handleImmediate, { passive: true });
    }
    for (const event of DEBOUNCED_EVENTS) {
      window.addEventListener(event, handleDebounced, { passive: true });
    }

    return () => {
      clearTimers();
      for (const event of IMMEDIATE_EVENTS) {
        window.removeEventListener(event, handleImmediate);
      }
      for (const event of DEBOUNCED_EVENTS) {
        window.removeEventListener(event, handleDebounced);
      }
    };
  }, [enabled, armTimers, clearTimers]);

  return { reset };
}
