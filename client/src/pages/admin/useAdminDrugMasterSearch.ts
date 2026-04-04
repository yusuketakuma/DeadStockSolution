import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../api/client';
import { useIncrementalSearch } from '../../hooks/useIncrementalSearch';
import type { DrugMasterItem } from './components/types';

interface ListResponse {
  data: DrugMasterItem[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

export const DRUG_MASTER_STATUS_OPTIONS = [
  { value: '', label: '全ステータス' },
  { value: 'listed', label: '収載中' },
  { value: 'transition', label: '経過措置中' },
  { value: 'delisted', label: '削除済' },
];

export const DRUG_MASTER_CATEGORY_OPTIONS = [
  { value: '', label: '全区分' },
  { value: '内用薬', label: '内用薬' },
  { value: '外用薬', label: '外用薬' },
  { value: '注射薬', label: '注射薬' },
  { value: '歯科用薬剤', label: '歯科用薬剤' },
];

function buildDrugMasterListParams(input: {
  page: number;
  search: string;
  statusFilter: string;
  categoryFilter: string;
}): string {
  const params = new URLSearchParams({
    page: String(input.page),
    limit: '100',
  });
  if (input.search) params.set('search', input.search);
  if (input.statusFilter) params.set('status', input.statusFilter);
  if (input.categoryFilter) params.set('category', input.categoryFilter);
  return params.toString();
}

export function useAdminDrugMasterSearch() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [statusFilter, setStatusFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [totalPages, setTotalPages] = useState(1);

  const initialQuery = searchParams.get('search') || '';
  const statusFilterRef = useRef(statusFilter);
  statusFilterRef.current = statusFilter;
  const categoryFilterRef = useRef(categoryFilter);
  categoryFilterRef.current = categoryFilter;

  const fetchDrugMasterItems = useCallback(
    async (query: string, page: number, signal: AbortSignal) => {
      const params = buildDrugMasterListParams({
        page,
        search: query,
        statusFilter: statusFilterRef.current,
        categoryFilter: categoryFilterRef.current,
      });
      const data = await api.get<ListResponse>(`/admin/drug-master?${params}`, { signal });
      setTotalPages(data.pagination.totalPages);
      return { data: data.data, total: data.pagination.total };
    },
    [],
  );

  const incrementalSearch = useIncrementalSearch<DrugMasterItem>({
    fetchFn: fetchDrugMasterItems,
    minChars: 0,
    initialQuery,
  });
  const { executeImmediate, query, setQuery, tokens } = incrementalSearch;

  useEffect(() => {
    const currentQuery = searchParams.get('search') || '';
    if (currentQuery === query) {
      return;
    }

    const nextParams = new URLSearchParams(searchParams);
    if (query) {
      nextParams.set('search', query);
    } else {
      nextParams.delete('search');
    }
    setSearchParams(nextParams, { replace: true });
  }, [query, searchParams, setSearchParams]);

  useEffect(() => {
    executeImmediate();
  }, [categoryFilter, executeImmediate, statusFilter]);

  const handleRemoveToken = useCallback((token: string) => {
    const nextTokens = tokens.filter((value) => value !== token);
    setQuery(nextTokens.join(' '));
  }, [setQuery, tokens]);

  return {
    ...incrementalSearch,
    statusFilter,
    setStatusFilter,
    categoryFilter,
    setCategoryFilter,
    totalPages,
    handleRemoveToken,
    activeFilterCount: (statusFilter ? 1 : 0) + (categoryFilter ? 1 : 0),
  };
}
