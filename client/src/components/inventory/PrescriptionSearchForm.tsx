import { useState } from 'react';
import { Badge, Button, Form, OverlayTrigger, Spinner, Tooltip } from 'react-bootstrap';
import SearchInput, { type DrugMasterSuggestion } from '../SearchInput';
import BarcodeScanButton from '../mobile/BarcodeScanButton';
import type { DrugChip, PrescriptionSearchFilters } from '../../api/client';

interface Props {
  chips: DrugChip[];
  onAddChip: (chip: DrugChip) => void;
  onRemoveChip: (index: number) => void;
  filters: PrescriptionSearchFilters;
  onFiltersChange: React.Dispatch<React.SetStateAction<PrescriptionSearchFilters>>;
  onSearch: () => void;
  isSearching: boolean;
  isGroupMember: boolean;
}

export default function PrescriptionSearchForm({
  chips,
  onAddChip,
  onRemoveChip,
  filters,
  onFiltersChange,
  onSearch,
  isSearching,
  isGroupMember,
}: Props) {
  const [searchValue, setSearchValue] = useState('');

  const handleSelectItem = (item: DrugMasterSuggestion) => {
    onAddChip({
      drugMasterId: item.id,
      genericName: item.genericName,
      specification: item.specification,
      displayLabel: item.genericName
        ? `${item.genericName} ${item.specification ?? ''}`.trim()
        : item.drugName,
    });
    setSearchValue('');
  };

  const handleScanResult = (drugName: string) => {
    setSearchValue(drugName);
  };

  return (
    <div className="mb-3">
      <div style={{ position: 'relative' }}>
        <SearchInput<DrugMasterSuggestion>
          placeholder="薬品名を入力..."
          suggestUrl="/search/drug-master"
          value={searchValue}
          onChange={setSearchValue}
          renderItem={(item) => item.drugName}
          onSelect={handleSelectItem}
          clearOnSelect
          trailingIcon={<BarcodeScanButton onScanResult={handleScanResult} />}
        />
      </div>

      {chips.length > 0 && (
        <div className="mt-2 d-flex flex-wrap gap-1">
          {chips.map((chip, i) => (
            <Badge
              key={chip.drugMasterId}
              bg="primary"
              className="d-flex align-items-center"
            >
              {chip.displayLabel}
              <button
                type="button"
                className="btn-close btn-close-white ms-1"
                style={{ fontSize: '0.5rem' }}
                aria-label={`${chip.displayLabel}を削除`}
                onClick={() => onRemoveChip(i)}
              />
            </Badge>
          ))}
        </div>
      )}

      <div className="mt-2 d-flex flex-wrap gap-3">
        {isGroupMember ? (
          <Form.Check
            type="checkbox"
            label="グループ内のみ"
            checked={filters.groupOnly}
            onChange={(e) =>
              onFiltersChange((prev) => ({ ...prev, groupOnly: e.target.checked }))
            }
          />
        ) : (
          <OverlayTrigger
            placement="top"
            overlay={
              <Tooltip>グループに所属すると利用できます</Tooltip>
            }
          >
            <span>
              <Form.Check
                type="checkbox"
                label="グループ内のみ"
                checked={filters.groupOnly}
                disabled
                style={{ pointerEvents: 'none' }}
                onChange={() => {}}
              />
            </span>
          </OverlayTrigger>
        )}

        <Form.Check
          type="checkbox"
          label="営業中のみ"
          checked={filters.openOnly}
          onChange={(e) =>
            onFiltersChange((prev) => ({ ...prev, openOnly: e.target.checked }))
          }
        />

        <Form.Check
          type="checkbox"
          label="お気に入り優先"
          checked={filters.favoritePriority}
          onChange={(e) =>
            onFiltersChange((prev) => ({ ...prev, favoritePriority: e.target.checked }))
          }
        />
      </div>

      <Button
        className="mt-2 w-100"
        disabled={chips.length === 0 || isSearching}
        onClick={onSearch}
      >
        {isSearching ? (
          <>
            <Spinner size="sm" className="me-1" role="status" aria-hidden />
            検索中...
          </>
        ) : (
          '在庫を検索'
        )}
      </Button>
    </div>
  );
}
