import { useState } from 'react';
import { Badge, Collapse, Form } from 'react-bootstrap';
import AppButton from '../ui/AppButton';
import AppCard from '../ui/AppCard';

export interface MatchingFilterState {
  sortBy: 'score' | 'distance' | 'price' | 'expiry';
  sortOrder: 'asc' | 'desc';
  favoriteOnly: boolean;
  groupOnly: boolean;
  minScore: number | null;
}

export const DEFAULT_FILTERS: MatchingFilterState = {
  sortBy: 'score',
  sortOrder: 'desc',
  favoriteOnly: false,
  groupOnly: false,
  minScore: null,
};

interface MatchingFiltersProps {
  filters: MatchingFilterState;
  onFilterChange: (filters: MatchingFilterState) => void;
}

function countActiveFilters(filters: MatchingFilterState): number {
  let count = 0;
  if (filters.sortBy !== DEFAULT_FILTERS.sortBy || filters.sortOrder !== DEFAULT_FILTERS.sortOrder) count++;
  if (filters.favoriteOnly) count++;
  if (filters.groupOnly) count++;
  if (filters.minScore !== null) count++;
  return count;
}

export default function MatchingFilters({ filters, onFilterChange }: MatchingFiltersProps) {
  const [open, setOpen] = useState(false);
  const activeCount = countActiveFilters(filters);

  function handleSortByChange(e: React.ChangeEvent<HTMLSelectElement>) {
    onFilterChange({ ...filters, sortBy: e.target.value as MatchingFilterState['sortBy'] });
  }

  function handleSortOrderChange(e: React.ChangeEvent<HTMLSelectElement>) {
    onFilterChange({ ...filters, sortOrder: e.target.value as MatchingFilterState['sortOrder'] });
  }

  function handleFavoriteOnly(e: React.ChangeEvent<HTMLInputElement>) {
    onFilterChange({ ...filters, favoriteOnly: e.target.checked });
  }

  function handleGroupOnly(e: React.ChangeEvent<HTMLInputElement>) {
    onFilterChange({ ...filters, groupOnly: e.target.checked });
  }

  function handleMinScoreChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = Number(e.target.value);
    onFilterChange({ ...filters, minScore: value === 0 ? null : value });
  }

  function handleReset() {
    onFilterChange({ ...DEFAULT_FILTERS });
  }

  return (
    <div className="mb-3">
      <AppButton
        type="button"
        variant="outline-secondary"
        size="sm"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-controls="matching-filter-panel"
        aria-label={open ? 'マッチングの絞り込みと並び替えを閉じる' : 'マッチングの絞り込みと並び替えを開く'}
        className="d-flex align-items-center gap-2"
      >
        <span aria-hidden="true">&#9776;</span>
        絞り込み・並び替え
        {activeCount > 0 && (
          <Badge bg="primary" pill>
            {activeCount}
          </Badge>
        )}
      </AppButton>

      <Collapse in={open}>
        <div id="matching-filter-panel">
          <AppCard className="mt-2">
            <AppCard.Body>
              <div className="row g-3 align-items-end">
                <div className="col-sm-6 col-md-4">
                  <Form.Label htmlFor="matching-sort-by" className="small mb-1">
                    並び替え
                  </Form.Label>
                  <Form.Select
                    id="matching-sort-by"
                    size="sm"
                    value={filters.sortBy}
                    onChange={handleSortByChange}
                  >
                    <option value="score">総合スコア</option>
                    <option value="distance">距離</option>
                    <option value="price">薬価合計</option>
                    <option value="expiry">使用期限</option>
                  </Form.Select>
                </div>

                <div className="col-sm-6 col-md-3">
                  <Form.Label htmlFor="matching-sort-order" className="small mb-1">
                    順序
                  </Form.Label>
                  <Form.Select
                    id="matching-sort-order"
                    size="sm"
                    value={filters.sortOrder}
                    onChange={handleSortOrderChange}
                  >
                    <option value="desc">降順（高い順）</option>
                    <option value="asc">昇順（低い順）</option>
                  </Form.Select>
                </div>

                <div className="col-md-5">
                  <div className="d-flex flex-wrap gap-3">
                    <Form.Check
                      type="checkbox"
                      id="filter-favorite-only"
                      label="お気に入りのみ"
                      checked={filters.favoriteOnly}
                      onChange={handleFavoriteOnly}
                      className="small"
                    />
                    <Form.Check
                      type="checkbox"
                      id="filter-group-only"
                      label="グループのみ"
                      checked={filters.groupOnly}
                      onChange={handleGroupOnly}
                      className="small"
                    />
                  </div>
                </div>

                <div className="col-12">
                  <Form.Label htmlFor="filter-min-score" className="small mb-1">
                    最低スコア: {filters.minScore !== null ? filters.minScore.toFixed(1) : '指定なし'}
                  </Form.Label>
                  <Form.Range
                    id="filter-min-score"
                    min={0}
                    max={100}
                    step={1}
                    value={filters.minScore ?? 0}
                    onChange={handleMinScoreChange}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={filters.minScore ?? 0}
                  />
                </div>

                {activeCount > 0 && (
                  <div className="col-12">
                    <AppButton type="button" variant="link" size="sm" onClick={handleReset} className="p-0 text-danger">
                      <span className="visually-hidden">マッチングフィルタをリセット</span>
                      フィルタをリセット
                    </AppButton>
                  </div>
                )}
              </div>
            </AppCard.Body>
          </AppCard>
        </div>
      </Collapse>
    </div>
  );
}
