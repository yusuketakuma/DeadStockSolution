import { useState } from 'react';
import { api } from '../../api/client';
import type { DrugMasterDetail } from './components/types';

function resolveErrorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

async function fetchDrugMasterDetailByYjCode(yjCode: string): Promise<DrugMasterDetail> {
  return api.get<DrugMasterDetail>(`/admin/drug-master/detail/${encodeURIComponent(yjCode)}`);
}

interface UseAdminDrugMasterDetailEditorOptions {
  onSaveSuccess: () => void;
}

export function useAdminDrugMasterDetailEditor({
  onSaveSuccess,
}: UseAdminDrugMasterDetailEditorOptions) {
  const [detail, setDetail] = useState<DrugMasterDetail | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [editItem, setEditItem] = useState<DrugMasterDetail | null>(null);
  const [showEdit, setShowEdit] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const openDetail = async (yjCode: string) => {
    try {
      const data = await fetchDrugMasterDetailByYjCode(yjCode);
      setDetail(data);
      setShowDetail(true);
    } catch (err) {
      setError(resolveErrorMessage(err, '詳細の取得に失敗しました'));
    }
  };

  const openEdit = async (yjCode: string) => {
    try {
      const data = await fetchDrugMasterDetailByYjCode(yjCode);
      setEditItem(data);
      setShowEdit(true);
    } catch (err) {
      setError(resolveErrorMessage(err, '詳細の取得に失敗しました'));
    }
  };

  const handleEditSave = async () => {
    if (!editItem) return;

    setEditSaving(true);
    try {
      await api.put(`/admin/drug-master/detail/${encodeURIComponent(editItem.yjCode)}`, {
        drugName: editItem.drugName,
        genericName: editItem.genericName,
        specification: editItem.specification,
        unit: editItem.unit,
        yakkaPrice: editItem.yakkaPrice,
        manufacturer: editItem.manufacturer,
        isListed: editItem.isListed,
        transitionDeadline: editItem.transitionDeadline,
      });
      setMessage('医薬品情報を更新しました');
      setShowEdit(false);
      onSaveSuccess();
    } catch (err) {
      setError(resolveErrorMessage(err, '更新に失敗しました'));
    } finally {
      setEditSaving(false);
    }
  };

  return {
    detail,
    showDetail,
    closeDetail: () => setShowDetail(false),
    editItem,
    showEdit,
    closeEdit: () => setShowEdit(false),
    setEditItem,
    editSaving,
    message,
    clearMessage: () => setMessage(''),
    error,
    clearError: () => setError(''),
    openDetail,
    openEdit,
    handleEditSave,
  };
}
