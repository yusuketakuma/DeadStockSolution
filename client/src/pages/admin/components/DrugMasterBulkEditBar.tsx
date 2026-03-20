import AppButton from '../../../components/ui/AppButton';

interface DrugMasterBulkEditBarProps {
  selectedCount: number;
  onClearSelection: () => void;
  onBulkEdit: () => void;
}

export default function DrugMasterBulkEditBar({
  selectedCount,
  onClearSelection,
  onBulkEdit,
}: DrugMasterBulkEditBarProps) {
  if (selectedCount === 0) return null;

  return (
    <div
      className="d-flex align-items-center gap-2 px-3 py-2 bg-white border-top shadow-sm"
      style={{ position: 'sticky', bottom: 0, zIndex: 10 }}
    >
      <span className="small fw-semibold me-auto">{selectedCount}件選択中</span>
      <AppButton size="sm" variant="outline-secondary" onClick={onClearSelection}>
        選択解除
      </AppButton>
      <AppButton size="sm" variant="primary" onClick={onBulkEdit}>
        一括編集
      </AppButton>
    </div>
  );
}
