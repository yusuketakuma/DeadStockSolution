import MatchingFilters, { type MatchingFilterState } from './MatchingFilters';

interface MatchingFiltersPanelProps {
  searched: boolean;
  candidateCount: number;
  filters: MatchingFilterState;
  onFilterChange: (filters: MatchingFilterState) => void;
}

export default function MatchingFiltersPanel({
  searched,
  candidateCount,
  filters,
  onFilterChange,
}: MatchingFiltersPanelProps) {
  if (!searched || candidateCount === 0) {
    return null;
  }

  return <MatchingFilters filters={filters} onFilterChange={onFilterChange} />;
}
