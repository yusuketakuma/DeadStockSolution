import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

interface AsyncResourceOptions<T> {
  immediate?: boolean;
  initialData?: T;
}

interface AsyncResourceState<T> {
  data: T | null;
  error: string;
  loading: boolean;
}

export function useAsyncResource<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  options: AsyncResourceOptions<T> = {},
) {
  const { immediate = true, initialData } = options;
  const [state, setState] = useState<AsyncResourceState<T>>({
    data: initialData ?? null,
    error: '',
    loading: immediate,
  });
  const requestIdRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  const reload = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setState((prev) => ({ ...prev, loading: true, error: '' }));

    try {
      const next = await fetcher(controller.signal);
      if (requestId !== requestIdRef.current) return;
      setState({ data: next, loading: false, error: '' });
    } catch (err) {
      if (controller.signal.aborted) return;
      if (requestId !== requestIdRef.current) return;
      setState((prev) => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : 'データ取得に失敗しました',
      }));
    }
  }, [fetcher]);

  useEffect(() => {
    if (!immediate) {
      setState((prev) => ({ ...prev, loading: false }));
      return () => {
        abortControllerRef.current?.abort();
      };
    }
    void reload();
    return () => {
      abortControllerRef.current?.abort();
    };
  }, [immediate, reload]);

  const api = useMemo(() => ({
    data: state.data,
    error: state.error,
    loading: state.loading,
    reload,
  }), [reload, state.data, state.error, state.loading]);

  return api;
}
