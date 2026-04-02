import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { usePaginatedList } from '../../hooks/usePaginatedList';

interface TestItem {
  id: number;
  label: string;
}

interface TestResponse {
  data: TestItem[];
  pagination: {
    totalPages: number;
  };
}

describe('usePaginatedList', () => {
  it('fetchPage(force=true) bypasses the page cache', async () => {
    const fetcher = vi.fn<(_: number, __?: AbortSignal) => Promise<TestResponse>>()
      .mockResolvedValueOnce({
        data: [{ id: 1, label: 'first' }],
        pagination: { totalPages: 1 },
      })
      .mockResolvedValueOnce({
        data: [{ id: 1, label: 'updated' }],
        pagination: { totalPages: 1 },
      });

    const { result } = renderHook(() => usePaginatedList<TestItem, TestResponse>(fetcher));

    await waitFor(() => {
      expect(result.current.items).toEqual([{ id: 1, label: 'first' }]);
    });
    expect(fetcher).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.fetchPage(1);
    });
    expect(fetcher).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.fetchPage(1, { force: true });
    });

    await waitFor(() => {
      expect(result.current.items).toEqual([{ id: 1, label: 'updated' }]);
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('refetches the current page when the fetcher changes without changing pagination state', async () => {
    const initialFetcher = vi.fn<(_: number, __?: AbortSignal) => Promise<TestResponse>>()
      .mockResolvedValue({
        data: [{ id: 1, label: 'before-filter' }],
        pagination: { totalPages: 1 },
      });
    const nextFetcher = vi.fn<(_: number, __?: AbortSignal) => Promise<TestResponse>>()
      .mockResolvedValue({
        data: [{ id: 2, label: 'after-filter' }],
        pagination: { totalPages: 1 },
      });

    const { result, rerender } = renderHook(
      ({ fetcher }) => usePaginatedList<TestItem, TestResponse>(fetcher),
      { initialProps: { fetcher: initialFetcher } },
    );

    await waitFor(() => {
      expect(result.current.items).toEqual([{ id: 1, label: 'before-filter' }]);
    });

    rerender({ fetcher: nextFetcher });

    await waitFor(() => {
      expect(result.current.items).toEqual([{ id: 2, label: 'after-filter' }]);
    });

    expect(initialFetcher).toHaveBeenCalledTimes(1);
    expect(nextFetcher).toHaveBeenCalledTimes(1);
  });
});
