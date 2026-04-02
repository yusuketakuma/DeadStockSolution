import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useIncrementalSearch } from '../useIncrementalSearch';

describe('useIncrementalSearch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const createMockFetch = (data: unknown[] = [], total = 0) =>
    vi.fn().mockResolvedValue({ data, total });

  it('初期状態では空の結果を返す', () => {
    const fetchFn = createMockFetch();

    const { result } = renderHook(() =>
      useIncrementalSearch({ fetchFn }),
    );

    expect(result.current.query).toBe('');
    expect(result.current.results).toEqual([]);
    expect(result.current.total).toBe(0);
    expect(result.current.page).toBe(1);
    expect(result.current.isSearching).toBe(false);
    expect(result.current.tokens).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('デバウンス後に fetchFn を呼び出す', async () => {
    const fetchFn = createMockFetch([{ id: 1 }], 1);

    const { result } = renderHook(() =>
      useIncrementalSearch({ fetchFn }),
    );

    act(() => {
      result.current.setQuery('テスト');
    });

    // デバウンス中はまだ呼ばれない
    expect(fetchFn).not.toHaveBeenCalled();

    // 400ms 後にフェッチ
    await act(async () => {
      vi.advanceTimersByTime(400);
    });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledWith('テスト', 1, expect.any(AbortSignal));
    expect(result.current.results).toEqual([{ id: 1 }]);
    expect(result.current.total).toBe(1);
  });

  it('query が minChars 未満のとき fetchFn を呼ばない', async () => {
    const fetchFn = createMockFetch();

    const { result } = renderHook(() =>
      useIncrementalSearch({ fetchFn, minChars: 2 }),
    );

    act(() => {
      result.current.setQuery('a');
    });

    await act(async () => {
      vi.advanceTimersByTime(400);
    });

    expect(fetchFn).not.toHaveBeenCalled();
    expect(result.current.results).toEqual([]);
  });

  it('新しい入力で前回の fetch を AbortController でキャンセルする', async () => {
    const capturedSignals: AbortSignal[] = [];
    const fetchFn = vi.fn().mockImplementation(
      (_q: string, _p: number, signal: AbortSignal) => {
        capturedSignals.push(signal);
        return new Promise((resolve) => {
          setTimeout(() => resolve({ data: [], total: 0 }), 500);
        });
      },
    );

    const { result } = renderHook(() =>
      useIncrementalSearch({ fetchFn }),
    );

    // 最初のクエリ
    act(() => {
      result.current.setQuery('ab');
    });
    await act(async () => {
      vi.advanceTimersByTime(400);
    });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const firstSignal = capturedSignals[0];

    // 2つ目のクエリ（最初のフェッチ完了前）
    act(() => {
      result.current.setQuery('abc');
    });
    await act(async () => {
      vi.advanceTimersByTime(400);
    });

    expect(fetchFn).toHaveBeenCalledTimes(2);
    // 最初のシグナルが abort されている
    expect(firstSignal.aborted).toBe(true);
  });

  it('executeImmediate でデバウンスをスキップして即座にフェッチする', async () => {
    const fetchFn = createMockFetch([{ id: 1 }], 1);

    const { result } = renderHook(() =>
      useIncrementalSearch({ fetchFn }),
    );

    act(() => {
      result.current.setQuery('テスト');
    });

    // デバウンスを待たずに即座に実行
    await act(async () => {
      result.current.executeImmediate();
    });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledWith('テスト', 1, expect.any(AbortSignal));
  });

  it('executeImmediate は override された query と page を優先する', async () => {
    const fetchFn = createMockFetch([{ id: 2 }], 1);

    const { result } = renderHook(() =>
      useIncrementalSearch({ fetchFn }),
    );

    act(() => {
      result.current.setQuery('旧クエリ');
      result.current.setPage(3);
    });

    await act(async () => {
      result.current.executeImmediate('新クエリ', 1);
    });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledWith('新クエリ', 1, expect.any(AbortSignal));
  });

  it('クエリ変更時にページを 1 にリセットする', async () => {
    const fetchFn = createMockFetch([{ id: 1 }], 10);

    const { result } = renderHook(() =>
      useIncrementalSearch({ fetchFn }),
    );

    // 最初の検索
    act(() => {
      result.current.setQuery('テスト');
    });
    await act(async () => {
      vi.advanceTimersByTime(400);
    });

    // ページを 2 に変更
    act(() => {
      result.current.setPage(2);
    });
    expect(result.current.page).toBe(2);

    // クエリを変更 → ページが 1 にリセット
    act(() => {
      result.current.setQuery('別の検索');
    });
    expect(result.current.page).toBe(1);
  });

  it('clear() でクエリと結果をリセットする', async () => {
    const fetchFn = createMockFetch([{ id: 1 }], 1);

    const { result } = renderHook(() =>
      useIncrementalSearch({ fetchFn }),
    );

    // 検索を実行
    act(() => {
      result.current.setQuery('テスト');
    });
    await act(async () => {
      vi.advanceTimersByTime(400);
    });

    expect(result.current.results).toEqual([{ id: 1 }]);

    // クリア
    act(() => {
      result.current.clear();
    });

    expect(result.current.query).toBe('');
    expect(result.current.results).toEqual([]);
    expect(result.current.total).toBe(0);
    expect(result.current.page).toBe(1);
  });

  it('tokens がスペースで正しく分割される', () => {
    const fetchFn = createMockFetch();

    const { result } = renderHook(() =>
      useIncrementalSearch({ fetchFn }),
    );

    // 半角スペース
    act(() => {
      result.current.setQuery('ロキソニン 60mg');
    });
    expect(result.current.tokens).toEqual(['ロキソニン', '60mg']);

    // 全角スペース (U+3000)
    act(() => {
      result.current.setQuery('ロキソニン\u300060mg');
    });
    expect(result.current.tokens).toEqual(['ロキソニン', '60mg']);

    // 混在 + 連続スペース
    act(() => {
      result.current.setQuery('  ロキソニン  60mg  ');
    });
    expect(result.current.tokens).toEqual(['ロキソニン', '60mg']);
  });

  it('isSearching がデバウンス中と fetch 中に true になる', async () => {
    const fetchFn = vi.fn().mockImplementation(
      () => new Promise((resolve) => {
        setTimeout(() => resolve({ data: [], total: 0 }), 200);
      }),
    );

    const { result } = renderHook(() =>
      useIncrementalSearch({ fetchFn }),
    );

    expect(result.current.isSearching).toBe(false);

    // クエリ設定 → デバウンス中は true
    act(() => {
      result.current.setQuery('テスト');
    });
    expect(result.current.isSearching).toBe(true);

    // デバウンス完了 → fetch 中も true
    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    expect(result.current.isSearching).toBe(true);

    // fetch 完了 → false
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current.isSearching).toBe(false);
  });

  it('2トークン以上でデバウンスが 300ms に短縮される', async () => {
    const fetchFn = createMockFetch([{ id: 1 }], 1);

    const { result } = renderHook(() =>
      useIncrementalSearch({ fetchFn }),
    );

    act(() => {
      result.current.setQuery('ロキソニン 60mg');
    });

    // 300ms 後にフェッチ
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('initialQuery が設定されている場合に初期値として使用される', () => {
    const fetchFn = createMockFetch();

    const { result } = renderHook(() =>
      useIncrementalSearch({ fetchFn, initialQuery: '初期クエリ' }),
    );

    expect(result.current.query).toBe('初期クエリ');
  });

  it('アンマウント時にタイマーと AbortController がクリーンアップされる', async () => {
    let capturedSignal: AbortSignal | null = null;
    const fetchFn = vi.fn().mockImplementation(
      (_q: string, _p: number, signal: AbortSignal) => {
        capturedSignal = signal;
        return new Promise((resolve) => {
          setTimeout(() => resolve({ data: [], total: 0 }), 500);
        });
      },
    );

    const { result, unmount } = renderHook(() =>
      useIncrementalSearch({ fetchFn }),
    );

    // 検索を開始
    act(() => {
      result.current.setQuery('テスト');
    });
    await act(async () => {
      vi.advanceTimersByTime(400);
    });

    expect(capturedSignal).not.toBeNull();

    // アンマウント
    unmount();

    // AbortController が abort されている
    expect(capturedSignal!.aborted).toBe(true);
  });
});
