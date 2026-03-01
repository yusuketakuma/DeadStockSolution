import { renderHook } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { usePolledFetch } from '../usePolledFetch';

describe('usePolledFetch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('enabled=true のとき setInterval でポーリングが開始される', () => {
    const fetchFn = vi.fn().mockResolvedValue(undefined);

    renderHook(() =>
      usePolledFetch(fetchFn, { enabled: true, intervalMs: 10_000 }),
    );

    // 初回は呼ばれない（hook はポーリングのみ担当）
    expect(fetchFn).not.toHaveBeenCalled();

    // 10秒経過 → 呼ばれる
    vi.advanceTimersByTime(10_000);
    expect(fetchFn).toHaveBeenCalledTimes(1);

    // さらに10秒 → 2回目
    vi.advanceTimersByTime(10_000);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('enabled=false のとき ポーリングが開始されない', () => {
    const fetchFn = vi.fn().mockResolvedValue(undefined);

    renderHook(() =>
      usePolledFetch(fetchFn, { enabled: false, intervalMs: 10_000 }),
    );

    vi.advanceTimersByTime(30_000);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('minFetchIntervalMs でスロットルが効く', () => {
    const fetchFn = vi.fn().mockResolvedValue(undefined);

    renderHook(() =>
      usePolledFetch(fetchFn, {
        enabled: true,
        intervalMs: 1_000,
        minFetchIntervalMs: 3_000,
      }),
    );

    // 1秒後: 呼ばれる（初回）
    vi.advanceTimersByTime(1_000);
    expect(fetchFn).toHaveBeenCalledTimes(1);

    // 2秒後: スロットルで抑制（前回から1秒しか経っていない）
    vi.advanceTimersByTime(1_000);
    expect(fetchFn).toHaveBeenCalledTimes(1);

    // 3秒後: まだスロットル中（前回から2秒）
    vi.advanceTimersByTime(1_000);
    expect(fetchFn).toHaveBeenCalledTimes(1);

    // 4秒後: スロットル解除（前回から3秒）
    vi.advanceTimersByTime(1_000);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('アンマウント時にクリーンアップされる', () => {
    const fetchFn = vi.fn().mockResolvedValue(undefined);

    const { unmount } = renderHook(() =>
      usePolledFetch(fetchFn, { enabled: true, intervalMs: 10_000 }),
    );

    unmount();

    vi.advanceTimersByTime(30_000);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('visibilitychange でタブ復帰時にフェッチされる', () => {
    const fetchFn = vi.fn().mockResolvedValue(undefined);

    renderHook(() =>
      usePolledFetch(fetchFn, { enabled: true, intervalMs: 60_000 }),
    );

    // visibilityState を 'visible' にしてイベント発火
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      writable: true,
      configurable: true,
    });
    document.dispatchEvent(new Event('visibilitychange'));

    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
