import { useCallback, useMemo } from 'react';
import type { SetURLSearchParams } from 'react-router-dom';

interface UseListDetailRouteStateOptions {
  selectedParam?: string;
  pageParam?: string;
}

export function useListDetailRouteState(
  searchParams: URLSearchParams,
  setSearchParams: SetURLSearchParams,
  options: UseListDetailRouteStateOptions = {},
) {
  const {
    selectedParam = 'selected',
    pageParam = 'page',
  } = options;

  const requestedSelectedValue = searchParams.get(selectedParam) ?? '';
  const requestedPage = useMemo(() => {
    const parsed = Number(searchParams.get(pageParam) ?? '1');
    return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
  }, [pageParam, searchParams]);

  const updateListDetailRouteState = useCallback((next: { selected?: string | number | null; page?: number | null }) => {
    const nextParams = new URLSearchParams(searchParams);

    if (Object.prototype.hasOwnProperty.call(next, 'selected')) {
      const value = next.selected;
      if (value === null || value === undefined || value === '') {
        nextParams.delete(selectedParam);
      } else {
        nextParams.set(selectedParam, String(value));
      }
    }

    if (Object.prototype.hasOwnProperty.call(next, 'page')) {
      const value = next.page;
      if (value === null || value === undefined || value <= 1) {
        nextParams.delete(pageParam);
      } else {
        nextParams.set(pageParam, String(value));
      }
    }

    if (nextParams.toString() !== searchParams.toString()) {
      setSearchParams(nextParams, { replace: true });
    }
  }, [pageParam, searchParams, selectedParam, setSearchParams]);

  return {
    requestedSelectedValue,
    requestedPage,
    updateListDetailRouteState,
  };
}
