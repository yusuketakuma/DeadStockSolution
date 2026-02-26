import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { usePaginatedList } from '../usePaginatedList';

interface TestItem {
  id: number;
}

interface TestResponse {
  data: TestItem[];
  pagination: {
    page: number;
    totalPages: number;
    total: number;
  };
}

describe('usePaginatedList', () => {
  it('clears stale items when latest request fails', async () => {
    const fetcher = vi.fn(async (targetPage: number): Promise<TestResponse> => {
      if (targetPage === 1) {
        return {
          data: [{ id: 1 }],
          pagination: { page: 1, totalPages: 3, total: 3 },
        };
      }
      throw new Error('取得失敗');
    });

    const { result } = renderHook(() =>
      usePaginatedList<TestItem, TestResponse>(fetcher),
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.items).toEqual([{ id: 1 }]);

    act(() => {
      result.current.setPage(2);
    });

    await waitFor(() => {
      expect(result.current.error).toBe('取得失敗');
    });
    expect(result.current.items).toEqual([]);
    expect(result.current.pagination).toBeNull();
    expect(result.current.totalPages).toBe(1);
  });

  it('aborts previous request when a new page fetch starts', async () => {
    const fetcher = vi.fn(async (targetPage: number, signal?: AbortSignal): Promise<TestResponse> => {
      if (!signal) throw new Error('signal is required');
      return {
        data: [{ id: targetPage }],
        pagination: { page: targetPage, totalPages: 5, total: 10 },
      };
    });

    const { result } = renderHook(() =>
      usePaginatedList<TestItem, TestResponse>(fetcher),
    );

    await waitFor(() => {
      expect(fetcher).toHaveBeenCalledTimes(1);
    });
    const firstSignal = fetcher.mock.calls[0][1] as AbortSignal;

    act(() => {
      result.current.setPage(2);
    });

    await waitFor(() => {
      expect(fetcher).toHaveBeenCalledTimes(2);
    });
    expect(firstSignal.aborted).toBe(true);
  });
});
