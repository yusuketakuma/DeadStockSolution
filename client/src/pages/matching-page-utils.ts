import { DEFAULT_FILTERS, type MatchingFilterState } from '../components/matching/MatchingFilters';
import type { MatchItem } from '../types/matching';

export interface ProposalMessageState {
  errorMessage: string;
  shouldSuggestRetry: boolean;
}

const MATCHING_FILTER_STORAGE_KEY = 'matching-page-filters';

function parseBooleanParam(value: string | null): boolean {
  return value === '1';
}

export function resolveProposalMessageState(err: unknown): ProposalMessageState {
  const errorMessage = err instanceof Error ? err.message : '仮マッチングの送信に失敗しました';
  return {
    errorMessage,
    shouldSuggestRetry: (
      errorMessage.includes('在庫')
      || errorMessage.includes('数量')
      || errorMessage.includes('利用可能')
    ),
  };
}

export function parsePositiveId(value: string | null): number | null {
  if (!value) return null;
  const normalized = Number(value);
  return Number.isInteger(normalized) && normalized > 0 ? normalized : null;
}

export function parseRequestedDrugTerms(requestedDrug: string, inventorySearchDrugs: string): string[] {
  if (requestedDrug) {
    return [requestedDrug.toLowerCase()];
  }

  return inventorySearchDrugs
    .split('/')
    .map((term) => term.trim().toLowerCase())
    .filter(Boolean);
}

export function parseMatchingFiltersFromSearchParams(searchParams: URLSearchParams): MatchingFilterState | null {
  const sortBy = searchParams.get('sortBy');
  const sortOrder = searchParams.get('sortOrder');
  const minScoreValue = searchParams.get('minScore');
  if (!sortBy && !sortOrder && !searchParams.has('favoriteOnly') && !searchParams.has('groupOnly') && !minScoreValue) {
    return null;
  }
  const parsedMinScore = minScoreValue === null || minScoreValue === '' ? null : Number(minScoreValue);
  return {
    sortBy: sortBy === 'distance' || sortBy === 'price' || sortBy === 'expiry' ? sortBy : 'score',
    sortOrder: sortOrder === 'asc' ? 'asc' : 'desc',
    favoriteOnly: parseBooleanParam(searchParams.get('favoriteOnly')),
    groupOnly: parseBooleanParam(searchParams.get('groupOnly')),
    minScore: Number.isFinite(parsedMinScore) ? parsedMinScore : null,
  };
}

export function parseMatchingFiltersFromStorage(): MatchingFilterState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(MATCHING_FILTER_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<MatchingFilterState>;
    return {
      sortBy: parsed.sortBy === 'distance' || parsed.sortBy === 'price' || parsed.sortBy === 'expiry' ? parsed.sortBy : 'score',
      sortOrder: parsed.sortOrder === 'asc' ? 'asc' : 'desc',
      favoriteOnly: parsed.favoriteOnly === true,
      groupOnly: parsed.groupOnly === true,
      minScore: typeof parsed.minScore === 'number' ? parsed.minScore : null,
    };
  } catch {
    return null;
  }
}

export function persistMatchingFilters(filters: MatchingFilterState): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(MATCHING_FILTER_STORAGE_KEY, JSON.stringify(filters));
}

export function buildMatchingFilterParams(baseParams: URLSearchParams, filters: MatchingFilterState): URLSearchParams {
  const nextParams = new URLSearchParams(baseParams);
  nextParams.delete('sortBy');
  nextParams.delete('sortOrder');
  nextParams.delete('favoriteOnly');
  nextParams.delete('groupOnly');
  nextParams.delete('minScore');

  if (filters.sortBy !== DEFAULT_FILTERS.sortBy) nextParams.set('sortBy', filters.sortBy);
  if (filters.sortOrder !== DEFAULT_FILTERS.sortOrder) nextParams.set('sortOrder', filters.sortOrder);
  if (filters.favoriteOnly) nextParams.set('favoriteOnly', '1');
  if (filters.groupOnly) nextParams.set('groupOnly', '1');
  if (filters.minScore !== null) nextParams.set('minScore', String(filters.minScore));

  return nextParams;
}

export function resolveCandidateExpiryTime(item: MatchItem): number | null {
  const source = item.expirationDateIso ?? item.expirationDate;
  if (!source) return null;
  const parsed = new Date(source).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}
