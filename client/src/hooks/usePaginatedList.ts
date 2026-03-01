import { useCallback, useEffect, useRef, useState } from 'react';

type PaginationExtra = Record<string, unknown>;

interface PaginatedResponse<TItem, TExtra extends PaginationExtra = PaginationExtra> {
  data: TItem[];
  pagination: {
    totalPages: number;
  } & TExtra;
}

interface UsePaginatedListOptions {
  initialPage?: number;
  errorMessage?: string;
}

interface UsePaginatedListReturn<TItem, TResponse extends PaginatedResponse<TItem, PaginationExtra>> {
  page: number;
  setPage: (page: number) => void;
  items: TItem[];
  response: TResponse | null;
  totalPages: number;
  pagination: TResponse['pagination'] | null;
  loading: boolean;
  error: string;
  fetchPage: (targetPage: number) => Promise<void>;
  retry: () => void;
}

export function usePaginatedList<TItem, TResponse extends PaginatedResponse<TItem, PaginationExtra>>(
  fetcher: (targetPage: number, signal?: AbortSignal) => Promise<TResponse>,
  options: UsePaginatedListOptions = {},
): UsePaginatedListReturn<TItem, TResponse> {
  const { initialPage = 1, errorMessage = 'データ取得に失敗しました' } = options;

  const [page, setPage] = useState(initialPage);
  const [items, setItems] = useState<TItem[]>([]);
  const [response, setResponse] = useState<TResponse | null>(null);
  const [pagination, setPagination] = useState<TResponse['pagination'] | null>(null);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const latestRequestIdRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  }, [fetcher]);

  const fetchPage = useCallback(async (targetPage: number) => {
    const requestId = ++latestRequestIdRef.current;
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setLoading(true);
    setError('');
    try {
      const response = await fetcherRef.current(targetPage, controller.signal);
      if (requestId !== latestRequestIdRef.current) return;
      setResponse(response);
      setItems(response.data);
      setPagination(response.pagination);
      setTotalPages(response.pagination.totalPages);
    } catch (err) {
      if (controller.signal.aborted) return;
      if (requestId !== latestRequestIdRef.current) return;
      setError(err instanceof Error ? err.message : errorMessage);
      setResponse(null);
      setItems([]);
      setPagination(null);
      setTotalPages(1);
    } finally {
      if (requestId === latestRequestIdRef.current) {
        setLoading(false);
      }
    }
  }, [errorMessage]);

  const retry = useCallback(() => {
    void fetchPage(page);
  }, [fetchPage, page]);

  useEffect(() => {
    void fetchPage(page);
  }, [fetchPage, page]);

  useEffect(() => () => {
    latestRequestIdRef.current += 1;
    abortControllerRef.current?.abort();
  }, []);

  return {
    page,
    setPage,
    items,
    response,
    totalPages,
    pagination,
    loading,
    error,
    fetchPage,
    retry,
  };
}
