import { useState, useCallback, useRef } from 'react';
import { api } from '../api/client';
import type { DiffSummary, UploadType } from '../pages/upload/upload-job-utils';

interface UseDiffPreviewOptions {
  file: File | null;
  uploadType: UploadType;
  previewHeaderRowIndex: number | null;
  resolveSubmittedMapping: () => Record<string, string | null> | null;
}

export interface UseDiffPreviewReturn {
  applyMode: 'replace' | 'diff';
  setApplyMode: (mode: 'replace' | 'diff') => void;
  deleteMissing: boolean;
  setDeleteMissing: (value: boolean) => void;
  diffSummary: DiffSummary | null;
  setDiffSummary: React.Dispatch<React.SetStateAction<DiffSummary | null>>;
  acknowledgeDeleteImpact: boolean;
  setAcknowledgeDeleteImpact: (value: boolean) => void;
  requiresDiffPreviewRefresh: boolean;
  hasCurrentDiffPreview: boolean;
  requiresDeleteImpactAcknowledgement: boolean;
  handleDiffPreview: () => Promise<void>;
  abortDiffPreview: () => void;
  resetDiffPreviewState: () => void;
  loading: boolean;
  error: string;
}

/**
 * Hook for managing diff preview state and operations in upload flow.
 * Handles apply mode selection, delete missing toggle, and diff preview fetching.
 */
export function useDiffPreview({
  file,
  uploadType,
  previewHeaderRowIndex,
  resolveSubmittedMapping,
}: UseDiffPreviewOptions): UseDiffPreviewReturn {
  const [applyMode, setApplyMode] = useState<'replace' | 'diff'>('replace');
  const [deleteMissing, setDeleteMissing] = useState(false);
  const [diffSummary, setDiffSummary] = useState<DiffSummary | null>(null);
  const [acknowledgeDeleteImpact, setAcknowledgeDeleteImpact] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  const requiresDiffPreviewRefresh = applyMode === 'diff' && deleteMissing;
  const hasCurrentDiffPreview = !requiresDiffPreviewRefresh || diffSummary !== null;
  const requiresDeleteImpactAcknowledgement = requiresDiffPreviewRefresh && (diffSummary?.deactivated ?? 0) > 0;

  const abortDiffPreview = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setLoading(false);
  }, []);

  const resetDiffPreviewState = useCallback(() => {
    abortDiffPreview();
    setDiffSummary(null);
    setAcknowledgeDeleteImpact(false);
  }, [abortDiffPreview]);

  const handleDiffPreview = useCallback(async () => {
    if (!file || previewHeaderRowIndex === null) return;
    if (applyMode !== 'diff') return;
    const submittedMapping = resolveSubmittedMapping();
    if (!submittedMapping) {
      setError('選択した取込種別の自動判定に必要な列が不足しています。ファイル見出しを確認してください。');
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('uploadType', uploadType);
      formData.append('headerRowIndex', String(previewHeaderRowIndex));
      formData.append('applyMode', 'diff');
      formData.append('deleteMissing', String(deleteMissing));
      formData.append('mapping', JSON.stringify(submittedMapping));

      const result = await api.upload<{ summary: DiffSummary }>('/upload/diff-preview', formData, {
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setDiffSummary(result.summary);
      setAcknowledgeDeleteImpact(false);
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : '差分プレビューに失敗しました');
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  }, [file, uploadType, previewHeaderRowIndex, applyMode, deleteMissing, resolveSubmittedMapping]);

  // Return cleanup function for useEffect if needed
  return {
    applyMode,
    setApplyMode,
    deleteMissing,
    setDeleteMissing,
    diffSummary,
    setDiffSummary,
    acknowledgeDeleteImpact,
    setAcknowledgeDeleteImpact,
    requiresDiffPreviewRefresh,
    hasCurrentDiffPreview,
    requiresDeleteImpactAcknowledgement,
    handleDiffPreview,
    abortDiffPreview,
    resetDiffPreviewState,
    loading,
    error,
  };
}
