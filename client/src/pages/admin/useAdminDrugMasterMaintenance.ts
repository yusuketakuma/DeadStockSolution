import { useRef, useState } from 'react';
import { apiUpload } from '../../api/client';

function resolveErrorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

interface UseAdminDrugMasterMaintenanceOptions {
  onSyncSuccess: () => void;
  onPackageUploadSuccess: () => void;
}

export function useAdminDrugMasterMaintenance({
  onSyncSuccess,
  onPackageUploadSuccess,
}: UseAdminDrugMasterMaintenanceOptions) {
  const [syncing, setSyncing] = useState(false);
  const [pkgUploading, setPkgUploading] = useState(false);
  const [syncResult, setSyncResult] = useState('');
  const [syncError, setSyncError] = useState('');
  const [revisionDate, setRevisionDate] = useState(new Date().toISOString().slice(0, 10));
  const [packageMessage, setPackageMessage] = useState('');
  const [packageError, setPackageError] = useState('');
  const syncFileRef = useRef<HTMLInputElement>(null);
  const pkgFileRef = useRef<HTMLInputElement>(null);

  const handleSync = async () => {
    const file = syncFileRef.current?.files?.[0];
    if (!file) {
      setSyncError('ファイルを選択してください');
      return;
    }

    setSyncing(true);
    setSyncResult('');
    setSyncError('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('revisionDate', revisionDate);

      const result = await apiUpload<{
        message: string;
        result: { itemsProcessed: number; itemsAdded: number; itemsUpdated: number; itemsDeleted: number };
      }>('/admin/drug-master/sync', formData);

      const syncSummary = result.result;
      setSyncResult(
        `同期完了: 処理 ${syncSummary.itemsProcessed}件 / 追加 ${syncSummary.itemsAdded}件 / 更新 ${syncSummary.itemsUpdated}件 / 削除 ${syncSummary.itemsDeleted}件`,
      );
      if (syncFileRef.current) {
        syncFileRef.current.value = '';
      }
      onSyncSuccess();
    } catch (err) {
      setSyncError(resolveErrorMessage(err, '同期に失敗しました'));
    } finally {
      setSyncing(false);
    }
  };

  const handlePackageUpload = async () => {
    const file = pkgFileRef.current?.files?.[0];
    if (!file) {
      setPackageError('ファイルを選択してください');
      return;
    }

    setPkgUploading(true);
    setPackageMessage('');
    setPackageError('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      const result = await apiUpload<{ message: string; result: { added: number; updated: number } }>(
        '/admin/drug-master/upload-packages',
        formData,
      );
      setPackageMessage(`包装単位登録完了: 追加 ${result.result.added}件 / 更新 ${result.result.updated}件`);
      if (pkgFileRef.current) {
        pkgFileRef.current.value = '';
      }
      onPackageUploadSuccess();
    } catch (err) {
      setPackageError(resolveErrorMessage(err, '登録に失敗しました'));
    } finally {
      setPkgUploading(false);
    }
  };

  return {
    syncing,
    pkgUploading,
    syncResult,
    syncError,
    revisionDate,
    setRevisionDate,
    syncFileRef,
    pkgFileRef,
    packageMessage,
    packageError,
    handleSync,
    handlePackageUpload,
  };
}
