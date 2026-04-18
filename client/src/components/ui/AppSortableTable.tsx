import { useState, useMemo } from 'react';
import { Table } from 'react-bootstrap';
import AppAlert from './AppAlert';
import AppButton from './AppButton';
import AppEmptyState from './AppEmptyState';
import InlineLoader from './InlineLoader';

export type SortDirection = 'asc' | 'desc' | 'none';

export interface SortableColumn<T> {
  key: keyof T & string;
  label: string;
  sortable?: boolean;
}

interface AppSortableTableProps<T extends Record<string, unknown>> {
  columns: SortableColumn<T>[];
  data: T[];
  renderRow: (row: T, index: number) => React.ReactNode;
  defaultSortKey?: keyof T & string;
  defaultSortDir?: 'asc' | 'desc';
  loading?: boolean;
  loadingText?: string;
  error?: string;
  onRetry?: () => void;
  emptyTitle?: string;
  emptyDescription?: string;
  striped?: boolean;
  hover?: boolean;
  size?: 'sm';
  className?: string;
}

function SortIndicator({ direction }: { direction: SortDirection }) {
  if (direction === 'asc') return <span aria-hidden="true"> ▲</span>;
  if (direction === 'desc') return <span aria-hidden="true"> ▼</span>;
  return <span aria-hidden="true" className="text-muted"> ⇅</span>;
}

export default function AppSortableTable<T extends Record<string, unknown>>({
  columns,
  data,
  renderRow,
  defaultSortKey,
  defaultSortDir = 'asc',
  loading = false,
  loadingText = '読み込み中...',
  error,
  onRetry,
  emptyTitle = 'データがありません',
  emptyDescription,
  striped = true,
  hover = true,
  size,
  className,
}: AppSortableTableProps<T>) {
  const [sortKey, setSortKey] = useState<(keyof T & string) | null>(defaultSortKey ?? null);
  const [sortDir, setSortDir] = useState<SortDirection>(
    defaultSortKey ? defaultSortDir : 'none',
  );

  function handleHeaderClick(col: SortableColumn<T>) {
    if (!col.sortable) return;
    if (sortKey !== col.key) {
      setSortKey(col.key);
      setSortDir('asc');
      return;
    }
    // cycle: asc → desc → none
    if (sortDir === 'asc') {
      setSortDir('desc');
    } else if (sortDir === 'desc') {
      setSortDir('none');
      setSortKey(null);
    } else {
      setSortDir('asc');
      setSortKey(col.key);
    }
  }

  const sortedData = useMemo(() => {
    if (!sortKey || sortDir === 'none') return data;
    return [...data].sort((a, b) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;
      let cmp: number;
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        cmp = aVal - bVal;
      } else {
        cmp = String(aVal).localeCompare(String(bVal), 'ja');
      }
      return sortDir === 'desc' ? -cmp : cmp;
    });
  }, [data, sortKey, sortDir]);

  if (error) {
    return (
      <AppAlert
        variant="danger"
        className="d-flex justify-content-between align-items-center gap-2 flex-wrap"
      >
        <span>{error}</span>
        {onRetry && (
          <AppButton size="sm" variant="outline-danger" onClick={onRetry}>
            再試行
          </AppButton>
        )}
      </AppAlert>
    );
  }

  if (loading) {
    return <InlineLoader text={loadingText} className="text-muted small" />;
  }

  if (data.length === 0) {
    return <AppEmptyState title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <Table striped={striped} hover={hover} size={size} responsive className={className}>
      <thead>
        <tr>
          {columns.map((col) => {
            const isActive = sortKey === col.key && sortDir !== 'none';
            return (
              <th
                key={col.key}
                onClick={() => handleHeaderClick(col)}
                style={col.sortable ? { cursor: 'pointer', userSelect: 'none' } : undefined}
                aria-sort={
                  isActive ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined
                }
              >
                {col.label}
                {col.sortable && (
                  <SortIndicator direction={isActive ? sortDir : 'none'} />
                )}
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {sortedData.map((row, index) => renderRow(row, index))}
      </tbody>
    </Table>
  );
}
