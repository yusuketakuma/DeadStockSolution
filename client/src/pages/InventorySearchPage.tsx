import { useNavigate } from 'react-router-dom';
import { Alert, Spinner } from 'react-bootstrap';
import { useInventorySearch } from '../hooks/useInventorySearch';
import InventorySearchForm from '../components/inventory/InventorySearchForm';
import { useGroupMembership } from '../hooks/useGroupMembership';
import PharmacySummaryCards from '../components/inventory/PharmacySummaryCards';
import InventoryMatrix from '../components/inventory/InventoryMatrix';
import PageShell, { ScrollArea } from '../components/ui/PageShell';

export default function InventorySearchPage() {
  const navigate = useNavigate();
  const {
    chips, addChip, removeChip,
    filters, setFilters,
    result, isSearching, search, error,
  } = useInventorySearch();
  const { isGroupMember } = useGroupMembership();

  const handleOpenMatchingCandidate = (pharmacyId: number) => {
    const params = new URLSearchParams({
      targetPharmacyId: String(pharmacyId),
    });
    const selectedDrugs = chips.map((chip) => chip.displayLabel).filter(Boolean).join(' / ');
    if (selectedDrugs) {
      params.set('inventorySearchDrugs', selectedDrugs);
    }
    navigate(`/matching?${params.toString()}`);
  };

  return (
    <PageShell>
      <h4 className="page-title mb-3">医薬品在庫検索</h4>
      <ScrollArea>
        <InventorySearchForm
          chips={chips}
          onAddChip={addChip}
          onRemoveChip={removeChip}
          filters={filters}
          onFiltersChange={setFilters}
          onSearch={search}
          isSearching={isSearching}
          isGroupMember={isGroupMember}
        />

        {error && <Alert variant="danger">{error}</Alert>}

        {!result && !isSearching && (
          <p className="text-muted text-center mt-4">
            検索したい薬剤を追加して在庫を確認してください
          </p>
        )}

        {isSearching && (
          <div className="text-center mt-4">
            <Spinner animation="border" />
          </div>
        )}

        {result && !isSearching && (
          <>
            <PharmacySummaryCards
              summaries={result.summary}
              onOpenMatching={handleOpenMatchingCandidate}
            />
            <InventoryMatrix
              columns={result.matrix.columns}
              rows={result.matrix.rows}
              totalDrugs={chips.length}
            />
          </>
        )}
      </ScrollArea>
    </PageShell>
  );
}
