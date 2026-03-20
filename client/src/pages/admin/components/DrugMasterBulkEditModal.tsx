import { useState } from 'react';
import { Form } from 'react-bootstrap';
import AppButton from '../../../components/ui/AppButton';
import AppModalShell from '../../../components/ui/AppModalShell';
import AppSelect from '../../../components/ui/AppSelect';
import LoadingButton from '../../../components/ui/LoadingButton';
import type { AppSelectOption } from '../../../components/ui/AppSelect';

interface DrugMasterBulkEditModalProps {
  show: boolean;
  selectedCount: number;
  onHide: () => void;
  onSave: (updates: { isListed?: boolean; transitionDeadline?: string | null }) => Promise<void>;
  saving: boolean;
}

const IS_LISTED_OPTIONS: AppSelectOption[] = [
  { value: '', label: '変更しない' },
  { value: 'true', label: '収載中 (true)' },
  { value: 'false', label: '削除 (false)' },
];

export default function DrugMasterBulkEditModal({
  show,
  selectedCount,
  onHide,
  onSave,
  saving,
}: DrugMasterBulkEditModalProps) {
  const [isListedValue, setIsListedValue] = useState('');
  const [transitionDeadlineValue, setTransitionDeadlineValue] = useState('');
  const [clearTransitionDeadline, setClearTransitionDeadline] = useState(false);

  const handleHide = () => {
    setIsListedValue('');
    setTransitionDeadlineValue('');
    setClearTransitionDeadline(false);
    onHide();
  };

  const handleSave = async () => {
    const updates: { isListed?: boolean; transitionDeadline?: string | null } = {};

    if (isListedValue !== '') {
      updates.isListed = isListedValue === 'true';
    }

    if (clearTransitionDeadline) {
      updates.transitionDeadline = null;
    } else if (transitionDeadlineValue !== '') {
      updates.transitionDeadline = transitionDeadlineValue;
    }

    await onSave(updates);
    setIsListedValue('');
    setTransitionDeadlineValue('');
    setClearTransitionDeadline(false);
  };

  const footer = (
    <>
      <AppButton variant="secondary" size="sm" onClick={handleHide} disabled={saving}>
        キャンセル
      </AppButton>
      <LoadingButton variant="primary" size="sm" onClick={handleSave} loading={saving} loadingLabel="更新中...">
        更新
      </LoadingButton>
    </>
  );

  return (
    <AppModalShell
      show={show}
      onHide={handleHide}
      title={<span className="h6 mb-0">一括編集 ({selectedCount}件)</span>}
      footer={footer}
    >
      <Form>
        <Form.Group className="mb-3">
          <Form.Label className="small fw-semibold">収載ステータス</Form.Label>
          <AppSelect
            value={isListedValue}
            onChange={setIsListedValue}
            options={IS_LISTED_OPTIONS}
            ariaLabel="収載ステータスを選択"
          />
        </Form.Group>

        <Form.Group className="mb-2">
          <Form.Label className="small fw-semibold">経過措置期限</Form.Label>
          <Form.Control
            type="date"
            size="sm"
            value={transitionDeadlineValue}
            disabled={clearTransitionDeadline}
            onChange={(e) => setTransitionDeadlineValue(e.target.value)}
          />
        </Form.Group>
        <Form.Check
          type="checkbox"
          id="bulk-edit-clear-transition-deadline"
          label="クリアする"
          checked={clearTransitionDeadline}
          onChange={(e) => {
            setClearTransitionDeadline(e.target.checked);
            if (e.target.checked) setTransitionDeadlineValue('');
          }}
          className="small"
        />
      </Form>
    </AppModalShell>
  );
}
