import { useCallback, useEffect, useMemo, useRef } from 'react';
import AppButton from '../../../components/ui/AppButton';
import { Col, Form, Row } from 'react-bootstrap';
import DraftRestoreAlert from '../../../components/DraftRestoreAlert';
import { useAutoSave } from '../../../hooks/useAutoSave';
import LoadingButton from '../../../components/ui/LoadingButton';
import AppModalShell from '../../../components/ui/AppModalShell';
import AppField from '../../../components/ui/AppField';
import type { DrugMasterDetail } from './types';

/** 自動保存対象のフィールド（読み取り専用の yjCode やリレーションは除外） */
interface DrugMasterDraftData {
  drugName: string;
  genericName: string | null;
  specification: string | null;
  unit: string | null;
  yakkaPrice: number;
  manufacturer: string | null;
  isListed: boolean;
  transitionDeadline: string | null;
}

interface DrugMasterEditModalProps {
  editItem: DrugMasterDetail | null;
  show: boolean;
  editSaving: boolean;
  onHide: () => void;
  onEditItemChange: (item: DrugMasterDetail) => void;
  onSave: () => void;
}

export default function DrugMasterEditModal({
  editItem,
  show,
  editSaving,
  onHide,
  onEditItemChange,
  onSave,
}: DrugMasterEditModalProps) {
  const formId = `drug-master-edit:${editItem?.yjCode ?? 'none'}`;

  const draftData = useMemo<DrugMasterDraftData>(() => ({
    drugName: editItem?.drugName ?? '',
    genericName: editItem?.genericName ?? null,
    specification: editItem?.specification ?? null,
    unit: editItem?.unit ?? null,
    yakkaPrice: editItem?.yakkaPrice ?? 0,
    manufacturer: editItem?.manufacturer ?? null,
    isListed: editItem?.isListed ?? true,
    transitionDeadline: editItem?.transitionDeadline ?? null,
  }), [editItem]);

  const autoSave = useAutoSave<DrugMasterDraftData>(formId, draftData, {
    enabled: show && editItem !== null,
  });

  // モーダルが閉じるときに下書きをクリア（保存せずに閉じた場合も）
  const prevShowRef = useRef(show);
  useEffect(() => {
    if (prevShowRef.current && !show) {
      autoSave.clearDraft();
    }
    prevShowRef.current = show;
  }, [show, autoSave]);

  const handleRestore = useCallback(() => {
    if (!editItem) return;
    const draft = autoSave.restoreDraft();
    if (draft) {
      onEditItemChange({
        ...editItem,
        drugName: draft.drugName,
        genericName: draft.genericName,
        specification: draft.specification,
        unit: draft.unit,
        yakkaPrice: draft.yakkaPrice,
        manufacturer: draft.manufacturer,
        isListed: draft.isListed,
        transitionDeadline: draft.transitionDeadline,
      });
    }
    autoSave.clearDraft();
  }, [editItem, autoSave, onEditItemChange]);

  const handleDiscard = useCallback(() => {
    autoSave.clearDraft();
  }, [autoSave]);

  const handleSave = useCallback(() => {
    autoSave.clearDraft();
    onSave();
  }, [autoSave, onSave]);

  const handleHide = useCallback(() => {
    autoSave.clearDraft();
    onHide();
  }, [autoSave, onHide]);

  const footer = (
    <>
      <AppButton variant="secondary" size="sm" onClick={handleHide}>キャンセル</AppButton>
      <LoadingButton variant="primary" size="sm" onClick={handleSave} loading={editSaving} loadingLabel="保存中...">
        保存
      </LoadingButton>
    </>
  );

  return (
    <AppModalShell
      show={show}
      onHide={handleHide}
      title={<span className="h6 mb-0">医薬品情報の編集</span>}
      footer={footer}
    >
        {autoSave.hasDraft && editItem && (
          <DraftRestoreAlert
            draftTimestamp={autoSave.draftTimestamp}
            onRestore={handleRestore}
            onDiscard={handleDiscard}
          />
        )}
        {editItem && (
          <Form>
            <AppField
              className="mb-2"
              labelClassName="small"
              label="YJコード"
              value={editItem.yjCode}
              disabled
              controlClassName="font-monospace"
            />
            <AppField
              className="mb-2"
              labelClassName="small"
              label="品名"
              value={editItem.drugName}
              onChange={(value) => onEditItemChange({ ...editItem, drugName: value })}
            />
            <AppField
              className="mb-2"
              labelClassName="small"
              label="一般名（成分名）"
              value={editItem.genericName || ''}
              onChange={(value) => onEditItemChange({ ...editItem, genericName: value || null })}
            />
            <Row>
              <Col sm={6}>
                <AppField
                  className="mb-2"
                  labelClassName="small"
                  label="規格"
                  value={editItem.specification || ''}
                  onChange={(value) => onEditItemChange({ ...editItem, specification: value || null })}
                />
              </Col>
              <Col sm={6}>
                <AppField
                  className="mb-2"
                  labelClassName="small"
                  label="単位"
                  value={editItem.unit || ''}
                  onChange={(value) => onEditItemChange({ ...editItem, unit: value || null })}
                />
              </Col>
            </Row>
            <Row>
              <Col sm={6}>
                <AppField
                  className="mb-2"
                  labelClassName="small"
                  label="薬価（円）"
                  type="number"
                  step="0.01"
                  min="0"
                  value={String(editItem.yakkaPrice)}
                  onChange={(value) => onEditItemChange({ ...editItem, yakkaPrice: Number(value) || 0 })}
                />
              </Col>
              <Col sm={6}>
                <AppField
                  className="mb-2"
                  labelClassName="small"
                  label="メーカー"
                  value={editItem.manufacturer || ''}
                  onChange={(value) => onEditItemChange({ ...editItem, manufacturer: value || null })}
                />
              </Col>
            </Row>
            <Row>
              <Col sm={6}>
                <Form.Check
                  type="switch"
                  label="薬価基準収載中"
                  checked={editItem.isListed}
                  onChange={(e) => onEditItemChange({ ...editItem, isListed: e.target.checked })}
                  className="mb-2"
                />
              </Col>
              <Col sm={6}>
                <AppField
                  className="mb-2"
                  labelClassName="small"
                  label="経過措置期限"
                  type="date"
                  value={editItem.transitionDeadline || ''}
                  onChange={(value) => onEditItemChange({ ...editItem, transitionDeadline: value || null })}
                />
              </Col>
            </Row>
          </Form>
        )}
    </AppModalShell>
  );
}
