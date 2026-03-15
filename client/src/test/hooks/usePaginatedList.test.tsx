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
});
