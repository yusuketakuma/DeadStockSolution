import { Button, Spinner } from 'react-bootstrap';

interface SearchResultStatusProps {
  totalCount: number | undefined;
  isSearching: boolean;
  searchQuery: string;
  activeFilterCount?: number;
  onClearFilters?: () => void;
}

export default function SearchResultStatus({
  totalCount,
  isSearching,
  searchQuery,
  activeFilterCount = 0,
  onClearFilters,
}: SearchResultStatusProps) {
  if (isSearching) {
    return (
      <div className="text-muted small d-flex align-items-center gap-1">
        <Spinner animation="border" size="sm" />
        検索中...
      </div>
    );
  }

  if (totalCount === 0 && searchQuery.trim()) {
    return (
      <div className="text-muted small">
        該当する薬品が見つかりません。
        {activeFilterCount > 0 ? 'フィルタを解除するか、' : ''}
        キーワードを変えてお試しください。
        {activeFilterCount > 0 && onClearFilters && (
          <Button variant="link" size="sm" className="p-0 ms-1" onClick={onClearFilters}>
            フィルタ解除
          </Button>
        )}
      </div>
    );
  }

  if (totalCount != null && totalCount > 0) {
    return <div className="text-muted small">{totalCount}件見つかりました</div>;
  }

  return null;
}
