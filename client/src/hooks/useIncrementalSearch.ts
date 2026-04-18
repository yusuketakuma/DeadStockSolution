import { useState, useRef, useCallback, useEffect } from 'react';

interface UseIncrementalSearchOptions<T> {
  fetchFn: (query: string, page: number, signal: AbortSignal) => Promise<{ data: T[]; total: number }>;
  debounceMs?: number;
  minChars?: number;
  resetPageOnSearch?: boolean;
  initialQuery?: string;
}

interface UseIncrementalSearchReturn<T> {
  query: string;
  setQuery: (q: string) => void;
  results: T[];
  total: number;
  page: number;
  setPage: (p: number) => void;
  isSearching: boolean;
  clear: () => void;
  executeImmediate: (queryOverride?: string, pageOverride?: number) => void;
  tokens: string[];
}

/** 半角・全角スペースで分割し、空文字を除去 */
function splitTokens(q: string): string[] {
  return q.split(/[\s\u3000]+/).filter(Boolean);
}

/**
 * インクリメンタルサーチ用カスタムフック。
 *
 * - デバウンス付き（1トークン: 400ms / 2+トークン: 300ms）
 * - AbortController で前回フェッチをキャンセル
 * - minChars 未満は検索しない
 * - URL 同期は行わない（利用側が管理）
 */
export function useIncrementalSearch<T>(
  options: UseIncrementalSearchOptions<T>,
): UseIncrementalSearchReturn<T> {
  const {
    fetchFn,
    debounceMs,
    minChars = 2,
    resetPageOnSearch = true,
    initialQuery = '',
  } = options;

  const [query, setQueryState] = useState(initialQuery);
  const [results, setResults] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPageState] = useState(1);
  const [isSearching, setIsSearching] = useState(false);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fetchFnRef = useRef(fetchFn);
  fetchFnRef.current = fetchFn;

  // 現在の query/page を ref で保持（タイマーコールバック内で最新値を参照するため）
  const queryRef = useRef(query);
  queryRef.current = query;
  const pageRef = useRef(page);
  pageRef.current = page;

  const cancelPending = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, []);

  const doFetch = useCallback(
    async (q: string, p: number) => {
      // minChars チェック
      if (q.length < minChars) {
        setResults([]);
        setTotal(0);
        setIsSearching(false);
        return;
      }

      // 前回の fetch をキャンセル
      if (abortRef.current) {
        abortRef.current.abort();
      }

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetchFnRef.current(q, p, controller.signal);
        // abort されていなければ結果を反映
        if (!controller.signal.aborted) {
          setResults(res.data);
          setTotal(res.total);
          setIsSearching(false);
        }
      } catch {
        // abort による例外は無視
        if (!controller.signal.aborted) {
          setIsSearching(false);
        }
      }
    },
    [minChars],
  );

  const scheduleFetch = useCallback(
    (q: string, p: number) => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }

      if (q.length < minChars) {
        setResults([]);
        setTotal(0);
        setIsSearching(false);
        return;
      }

      setIsSearching(true);

      const tokens = splitTokens(q);
      const delay =
        debounceMs ?? (tokens.length >= 2 ? 300 : 400);

      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        void doFetch(q, p);
      }, delay);
    },
    [debounceMs, minChars, doFetch],
  );

  const setQuery = useCallback(
    (q: string) => {
      setQueryState(q);
      if (resetPageOnSearch) {
        setPageState(1);
      }
      scheduleFetch(q, 1);
    },
    [resetPageOnSearch, scheduleFetch],
  );

  const setPage = useCallback(
    (p: number) => {
      setPageState(p);
      // ページ変更時は即座にフェッチをスケジュール
      scheduleFetch(queryRef.current, p);
    },
    [scheduleFetch],
  );

  const clear = useCallback(() => {
    cancelPending();
    setQueryState('');
    setResults([]);
    setTotal(0);
    setPageState(1);
    setIsSearching(false);
  }, [cancelPending]);

  const executeImmediate = useCallback((queryOverride?: string, pageOverride?: number) => {
    // デバウンスタイマーをキャンセルして即座にフェッチ
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const nextQuery = queryOverride ?? queryRef.current;
    const nextPage = pageOverride ?? pageRef.current;
    if (pageOverride !== undefined) {
      setPageState(pageOverride);
    }
    setIsSearching(true);
    void doFetch(nextQuery, nextPage);
  }, [doFetch]);

  const tokens = splitTokens(query);

  // アンマウント時のクリーンアップ
  useEffect(() => {
    return () => {
      cancelPending();
    };
  }, [cancelPending]);

  return {
    query,
    setQuery,
    results,
    total,
    page,
    setPage,
    isSearching,
    clear,
    executeImmediate,
    tokens,
  };
}
