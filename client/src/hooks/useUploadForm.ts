/**
 * useUploadForm - アップロードフォームの状態管理フック (T129)
 *
 * uploadType / file / applyMode / deleteMissing を一元管理し、
 * requiresDiffPreviewRefresh の導出値を提供する軽量フック。
 */

import { useState, useCallback } from 'react';
import type { UploadType } from '../pages/upload/upload-job-utils';

// === 型定義 ===

export interface UseUploadFormReturn {
  /** アップロード種別 */
  uploadType: UploadType;
  /** 選択中のファイル */
  file: File | null;
  /** 反映モード */
  applyMode: 'replace' | 'diff';
  /** 差分モード時に未存在行を削除するか */
  deleteMissing: boolean;
  /** diff + deleteMissing 時に差分プレビュー再取得が必要か */
  requiresDiffPreviewRefresh: boolean;

  setUploadType: (type: UploadType) => void;
  setFile: (file: File | null) => void;
  setApplyMode: (mode: 'replace' | 'diff') => void;
  setDeleteMissing: (value: boolean) => void;
  /** 全状態を初期値に戻す */
  reset: () => void;
}

// === 初期状態定数 ===

export const UPLOAD_FORM_INITIAL_STATE = {
  uploadType: 'dead_stock' as UploadType,
  file: null as File | null,
  applyMode: 'replace' as 'replace' | 'diff',
  deleteMissing: false,
} as const;

// === メインフック ===

export function useUploadForm(): UseUploadFormReturn {
  const [uploadType, setUploadType] = useState<UploadType>(UPLOAD_FORM_INITIAL_STATE.uploadType);
  const [file, setFile] = useState<File | null>(UPLOAD_FORM_INITIAL_STATE.file);
  const [applyMode, setApplyMode] = useState<'replace' | 'diff'>(UPLOAD_FORM_INITIAL_STATE.applyMode);
  const [deleteMissing, setDeleteMissing] = useState<boolean>(UPLOAD_FORM_INITIAL_STATE.deleteMissing);

  // 導出値
  const requiresDiffPreviewRefresh = applyMode === 'diff' && deleteMissing;

  const handleSetUploadType = useCallback((type: UploadType) => {
    setUploadType(type);
  }, []);

  const handleSetFile = useCallback((nextFile: File | null) => {
    setFile(nextFile);
  }, []);

  const handleSetApplyMode = useCallback((mode: 'replace' | 'diff') => {
    setApplyMode(mode);
  }, []);

  const handleSetDeleteMissing = useCallback((value: boolean) => {
    setDeleteMissing(value);
  }, []);

  const reset = useCallback(() => {
    setUploadType(UPLOAD_FORM_INITIAL_STATE.uploadType);
    setFile(UPLOAD_FORM_INITIAL_STATE.file);
    setApplyMode(UPLOAD_FORM_INITIAL_STATE.applyMode);
    setDeleteMissing(UPLOAD_FORM_INITIAL_STATE.deleteMissing);
  }, []);

  return {
    uploadType,
    file,
    applyMode,
    deleteMissing,
    requiresDiffPreviewRefresh,
    setUploadType: handleSetUploadType,
    setFile: handleSetFile,
    setApplyMode: handleSetApplyMode,
    setDeleteMissing: handleSetDeleteMissing,
    reset,
  };
}
