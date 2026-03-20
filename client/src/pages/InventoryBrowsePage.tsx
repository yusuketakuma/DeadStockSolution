import { useNavigate } from 'react-router-dom';
import { Alert, Spinner } from 'react-bootstrap';
import { usePrescriptionSearch } from '../hooks/usePrescriptionSearch';
import PrescriptionSearchForm from '../components/inventory/PrescriptionSearchForm';
import PharmacySummaryCards from '../components/inventory/PharmacySummaryCards';
import InventoryMatrix from '../components/inventory/InventoryMatrix';
import PageShell, { ScrollArea } from '../components/ui/PageShell';

export default function InventoryBrowsePage() {
  const navigate = useNavigate();
  const {
    chips, addChip, removeChip,
    filters, setFilters,
    result, isSearching, search, error,
  } = usePrescriptionSearch();

  // TODO: isGroupMember は auth context から取得（現在は仮設定）
  const isGroupMember = true;

  const handlePropose = (pharmacyId: number) => {
    const drugParams = chips.map(c => c.drugMasterId).join(',');
    navigate(`/proposals?targetPharmacyId=${pharmacyId}&drugs=${drugParams}`);
  };

  return (
    <PageShell>
      <h4 className="page-title mb-3">在庫検索</h4>
      <ScrollArea>
        <PrescriptionSearchForm
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
            処方せんに記載された薬剤を追加して検索してください
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
              onPropose={handlePropose}
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
