import { useState, useRef, useCallback, useEffect, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError, buildApiUrl, isApiErrorCode } from '../api/client';
import { useUploadPreview, type PreviewResponse, resolveConfidenceLabel } from './useUploadPreview';
import { useDiffPreview } from './useDiffPreview';
import {
  useUploadJobPolling,
  UPLOAD_JOB_INITIAL_STATE,
  UPLOAD_PROGRESS_IDLE,
  type UploadJobState,
  type UploadProgressState,
} from './useUploadJobPolling';
import { type DiffSummary, type UploadType, resolvePartialSummaryEntries } from '../pages/upload/upload-job-utils';

interface UploadConfirmAsyncResponse { message: string; jobId: number; status: 'pending' | 'processing'; deduplicated?: boolean }
interface UploadMutationFormDataOptions {
  file: File; uploadType: UploadType; headerRowIndex: number; applyMode: 'replace' | 'diff';
  deleteMissing: boolean; mapping: Record<string, string | null>;
}

export interface UseUploadExcelFlowReturn {
  file: File | null; fileRef: React.RefObject<HTMLInputElement>; handleFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  preview: PreviewResponse | null; uploadType: UploadType; setUploadType: (type: UploadType) => void;
  loading: boolean; error: string; message: string; showMatchingHint: boolean;
  applyMode: 'replace' | 'diff'; setApplyMode: (mode: 'replace' | 'diff') => void; deleteMissing: boolean; setDeleteMissing: (value: boolean) => void;
  diffSummary: DiffSummary | null; acknowledgeDeleteImpact: boolean; setAcknowledgeDeleteImpact: (value: boolean) => void;
  requiresDiffPreviewRefresh: boolean; hasCurrentDiffPreview: boolean; requiresDeleteImpactAcknowledgement: boolean;
  hasPreviewRows: boolean; hasResolvableMapping: boolean; canSubmit: boolean; hasManualTypeOverride: boolean;
  uploadJob: UploadJobState; cancellingJob: boolean; uploadProgress: UploadProgressState;
  uploadProgressVariant: 'danger' | 'success' | 'info'; uploadProgressAnimated: boolean;
  partialSummaryEntries: Array<{ key: string; label: string; value: number }>;
  handlePreview: (e: FormEvent) => Promise<void>; handleConfirm: () => Promise<void>; handleDiffPreview: () => Promise<void>;
  handleCancelJob: () => Promise<void>; triggerErrorReportDownload: () => void; resetDiffPreviewState: () => void;
  resolveConfidenceLabel: typeof resolveConfidenceLabel;
}

const UPLOAD_CONFIRM_ENQUEUE_TIMEOUT_MS = 5 * 60 * 1000;
const UPLOAD_COMPLETE_NAVIGATE_DELAY_MS = import.meta.env.MODE === 'test' ? 0 : 1200;

function buildUploadMutationFormData({ file, uploadType, headerRowIndex, applyMode, deleteMissing, mapping }: UploadMutationFormDataOptions): FormData {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('uploadType', uploadType);
  formData.append('headerRowIndex', String(headerRowIndex));
  formData.append('applyMode', applyMode);
  formData.append('deleteMissing', String(deleteMissing));
  formData.append('mapping', JSON.stringify(mapping));
  return formData;
}

function resolvePossiblyRunningJobMessage(jobId: number | null): string {
  return `ジョブは継続中の可能性があります（ジョブID: ${jobId ?? '不明'}）。時間をおいて再確認してください。`;
}

export function useUploadExcelFlow(): UseUploadExcelFlowReturn {
  const [uploadType, setUploadTypeState] = useState<UploadType>('dead_stock');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [showMatchingHint, setShowMatchingHint] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [cancellingJob, setCancellingJob] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const navigateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const confirmAbortRef = useRef<AbortController | null>(null);
  const navigate = useNavigate();

  const previewFlow = useUploadPreview();
  const diffPreviewFlow = useDiffPreview({
    file,
    uploadType,
    previewHeaderRowIndex: previewFlow.preview?.headerRowIndex ?? null,
    resolveSubmittedMapping: () => previewFlow.resolveSubmittedMapping(uploadType),
  });
  const jobPolling = useUploadJobPolling();

  const clearTransientFeedback = useCallback(() => { setError(''); setMessage(''); setShowMatchingHint(false); }, []);
  const setFailed = useCallback((label: string) => jobPolling.setProgress({ phase: 'failed', percent: 100, label }), [jobPolling]);

  const clearPendingUploadSideEffects = useCallback(() => {
    confirmAbortRef.current?.abort();
    confirmAbortRef.current = null;
    jobPolling.stopPolling();
    if (navigateTimerRef.current !== null) { clearTimeout(navigateTimerRef.current); navigateTimerRef.current = null; }
  }, [jobPolling]);

  const resetDiffPreviewState = useCallback(() => { diffPreviewFlow.resetDiffPreviewState(); }, [diffPreviewFlow]);
  const resetExcelTransientUiState = useCallback(() => {
    setSubmitting(false);
    setCancellingJob(false);
    clearTransientFeedback();
    jobPolling.reset();
  }, [clearTransientFeedback, jobPolling]);

  useEffect(() => { if (previewFlow.error) setError(previewFlow.error); }, [previewFlow.error]);
  useEffect(() => { if (diffPreviewFlow.error) setError(diffPreviewFlow.error); }, [diffPreviewFlow.error]);

  const preview = previewFlow.preview;
  const selectedUploadTypeMapping = preview ? previewFlow.resolveSubmittedMapping(uploadType) : null;
  const hasPreviewRows = (preview?.rows.length ?? 0) > 0;
  const hasResolvableMapping = selectedUploadTypeMapping !== null;
  const requiresDiffPreviewRefresh = diffPreviewFlow.requiresDiffPreviewRefresh;
  const hasCurrentDiffPreview = diffPreviewFlow.hasCurrentDiffPreview;
  const requiresDeleteImpactAcknowledgement = diffPreviewFlow.requiresDeleteImpactAcknowledgement;
  const canSubmit = Boolean(preview) && hasPreviewRows && hasResolvableMapping && hasCurrentDiffPreview
    && (!requiresDeleteImpactAcknowledgement || diffPreviewFlow.acknowledgeDeleteImpact);
  const hasManualTypeOverride = Boolean(preview && uploadType !== preview.resolvedUploadType);
  const partialSummaryEntries = resolvePartialSummaryEntries(jobPolling.job.partialSummary);
  const uploadProgressVariant = jobPolling.progress.phase === 'failed' ? 'danger' : jobPolling.progress.phase === 'completed' ? 'success' : 'info';
  const uploadProgressAnimated = jobPolling.progress.phase !== 'completed' && jobPolling.progress.phase !== 'failed';
  const loading = submitting || previewFlow.loading || diffPreviewFlow.loading || jobPolling.isPolling;

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    clearPendingUploadSideEffects();
    resetExcelTransientUiState();
    setFile(e.target.files?.[0] || null);
    previewFlow.reset();
    setUploadTypeState('dead_stock');
    diffPreviewFlow.setApplyMode('replace');
    diffPreviewFlow.setDeleteMissing(false);
    diffPreviewFlow.resetDiffPreviewState();
  }, [clearPendingUploadSideEffects, diffPreviewFlow, previewFlow, resetExcelTransientUiState]);

  const handlePreview = useCallback(async (e: FormEvent) => {
    e.preventDefault();
    if (!file) return;
    clearPendingUploadSideEffects();
    clearTransientFeedback();
    jobPolling.setProgress({ phase: 'previewing', percent: 20, label: 'Excelファイルを解析しています...' });
    const nextPreview = await previewFlow.handlePreview(file);
    if (!nextPreview) { setFailed('Excel解析に失敗しました。'); return; }
    setUploadTypeState(nextPreview.resolvedUploadType);
    diffPreviewFlow.resetDiffPreviewState();
    jobPolling.setProgress(UPLOAD_PROGRESS_IDLE);
  }, [clearPendingUploadSideEffects, clearTransientFeedback, diffPreviewFlow, file, jobPolling, previewFlow, setFailed]);

  const handleConfirm = useCallback(async () => {
    if (!file || !previewFlow.preview) { setError('先にプレビューを実行してください'); return; }
    const submittedMapping = previewFlow.resolveSubmittedMapping(uploadType);
    if (!submittedMapping) {
      setError('選択した取込種別の自動判定に必要な列が不足しています。ファイル見出しを確認してください。');
      return;
    }

    clearPendingUploadSideEffects();
    clearTransientFeedback();
    setSubmitting(true);
    setCancellingJob(false);
    jobPolling.setJob(UPLOAD_JOB_INITIAL_STATE);
    jobPolling.setProgress({ phase: 'queueing', percent: 35, label: 'アップロード処理を受け付けています...' });

    const submittedUploadType = uploadType;
    const controller = new AbortController();
    confirmAbortRef.current = controller;
    let currentJobId: number | null = null;

    try {
      const formData = buildUploadMutationFormData({
        file,
        uploadType: submittedUploadType,
        headerRowIndex: previewFlow.preview.headerRowIndex,
        applyMode: diffPreviewFlow.applyMode,
        deleteMissing: diffPreviewFlow.deleteMissing,
        mapping: submittedMapping,
      });

      const enqueueResult = await api.upload<UploadConfirmAsyncResponse>('/upload/confirm-async', formData, {
        signal: controller.signal,
        timeout: UPLOAD_CONFIRM_ENQUEUE_TIMEOUT_MS,
      });
      if (controller.signal.aborted) return;

      currentJobId = enqueueResult.jobId;
      const deduplicated = Boolean(enqueueResult.deduplicated);
      jobPolling.setJob({
        jobId: enqueueResult.jobId,
        status: enqueueResult.status,
        attempts: 0,
        cancelable: false,
        errorReportAvailable: false,
        deduplicated,
        partialSummary: null,
      });
      setMessage(`${enqueueResult.message}（ジョブID: ${enqueueResult.jobId}）${deduplicated ? ' 同一ジョブへ集約して処理します。' : ''}`);

      const completedResult = await jobPolling.startPolling(enqueueResult.jobId, enqueueResult.status);
      if (controller.signal.aborted) return;

      const failedCount = completedResult.partialSummary?.rejectedRows ?? completedResult.partialSummary?.failed ?? 0;
      const completionMessage = `${completedResult.rowCount ?? 0}件のデータを登録しました。マッチング候補の再計算と通知更新が反映されます。`;
      const partialMessage = failedCount > 0 ? ` 一部データの取込に失敗しました（${failedCount}件）。` : '';
      const deduplicateMessage = completedResult.deduplicated ? ' 同一内容の重複送信はジョブに集約されました。' : '';
      setMessage(`${completionMessage}${partialMessage}${deduplicateMessage}`);

      diffPreviewFlow.setDiffSummary(completedResult.diffSummary ?? null);
      diffPreviewFlow.setAcknowledgeDeleteImpact(false);
      previewFlow.setPreview(null);
      setFile(null);
      if (fileRef.current) fileRef.current.value = '';
      setShowMatchingHint(true);

      const shouldAutoNavigate = !completedResult.errorReportAvailable && failedCount === 0;
      if (shouldAutoNavigate) {
        if (navigateTimerRef.current !== null) clearTimeout(navigateTimerRef.current);
        navigateTimerRef.current = setTimeout(() => {
          navigateTimerRef.current = null;
          navigate(submittedUploadType === 'dead_stock' ? '/inventory/dead-stock' : '/inventory/used-medication');
        }, UPLOAD_COMPLETE_NAVIGATE_DELAY_MS);
      }
    } catch (err) {
      if (controller.signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) return;
      if (isApiErrorCode(err, 'UPLOAD_CONFIRM_QUEUE_LIMIT')) {
        jobPolling.setJob(UPLOAD_JOB_INITIAL_STATE);
        setFailed('アップロード処理の受付に失敗しました。');
        setMessage('');
        setError(err.message);
        return;
      }
      if (err instanceof Error && err.message.includes('待機時間が長くなっています')) {
        setFailed('アップロード処理の待機時間が上限を超えました。');
        setError(err.message);
        setMessage(resolvePossiblyRunningJobMessage(currentJobId));
        return;
      }
      if (currentJobId !== null && err instanceof ApiError) {
        jobPolling.setJob((prev) => ({ ...prev, jobId: currentJobId, status: null }));
        setFailed('ジョブ状態の確認に失敗しました。');
        setError(err.message);
        setMessage(resolvePossiblyRunningJobMessage(currentJobId));
        return;
      }
      setFailed('アップロード処理に失敗しました。');
      setMessage('');
      setError(err instanceof Error ? err.message : '登録に失敗しました');
    } finally {
      if (confirmAbortRef.current === controller) confirmAbortRef.current = null;
      setSubmitting(false);
    }
  }, [
    clearPendingUploadSideEffects,
    clearTransientFeedback,
    diffPreviewFlow,
    file,
    jobPolling,
    navigate,
    previewFlow,
    setFailed,
    uploadType,
  ]);

  const handleDiffPreview = useCallback(async () => { clearTransientFeedback(); await diffPreviewFlow.handleDiffPreview(); }, [clearTransientFeedback, diffPreviewFlow]);

  const handleCancelJob = useCallback(async () => {
    if (jobPolling.job.jobId === null || !jobPolling.job.cancelable || cancellingJob) return;
    clearPendingUploadSideEffects();
    setCancellingJob(true);
    setError('');
    try {
      const result = await api.post<{ message?: string }>(`/upload/jobs/${jobPolling.job.jobId}/cancel`);
      jobPolling.setJob((prev) => ({ ...prev, status: null, cancelable: false }));
      setFailed('アップロード処理をキャンセルしました。');
      setMessage(result.message ?? `ジョブID: ${jobPolling.job.jobId} をキャンセルしました。`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ジョブのキャンセルに失敗しました');
    } finally {
      setCancellingJob(false);
      setSubmitting(false);
    }
  }, [cancellingJob, clearPendingUploadSideEffects, jobPolling, setFailed]);

  const triggerErrorReportDownload = useCallback(() => {
    if (jobPolling.job.jobId === null || !jobPolling.job.errorReportAvailable) return;
    window.open(buildApiUrl(`/upload/jobs/${jobPolling.job.jobId}/error-report`), '_blank', 'noopener');
  }, [jobPolling.job.errorReportAvailable, jobPolling.job.jobId]);

  const handleSetUploadType = useCallback((type: UploadType) => { setUploadTypeState(type); diffPreviewFlow.resetDiffPreviewState(); }, [diffPreviewFlow]);
  const handleSetApplyMode = useCallback((mode: 'replace' | 'diff') => { diffPreviewFlow.setApplyMode(mode); diffPreviewFlow.resetDiffPreviewState(); }, [diffPreviewFlow]);
  const handleSetDeleteMissing = useCallback((value: boolean) => { diffPreviewFlow.setDeleteMissing(value); diffPreviewFlow.resetDiffPreviewState(); }, [diffPreviewFlow]);

  useEffect(() => {
    return () => {
      if (navigateTimerRef.current !== null) { clearTimeout(navigateTimerRef.current); navigateTimerRef.current = null; }
      confirmAbortRef.current?.abort();
      confirmAbortRef.current = null;
      jobPolling.stopPolling();
    };
  }, [jobPolling.stopPolling]);

  return {
    file,
    fileRef,
    handleFileChange,
    preview,
    uploadType,
    setUploadType: handleSetUploadType,
    loading,
    error,
    message,
    showMatchingHint,
    applyMode: diffPreviewFlow.applyMode,
    setApplyMode: handleSetApplyMode,
    deleteMissing: diffPreviewFlow.deleteMissing,
    setDeleteMissing: handleSetDeleteMissing,
    diffSummary: diffPreviewFlow.diffSummary,
    acknowledgeDeleteImpact: diffPreviewFlow.acknowledgeDeleteImpact,
    setAcknowledgeDeleteImpact: diffPreviewFlow.setAcknowledgeDeleteImpact,
    requiresDiffPreviewRefresh,
    hasCurrentDiffPreview,
    requiresDeleteImpactAcknowledgement,
    hasPreviewRows,
    hasResolvableMapping,
    canSubmit,
    hasManualTypeOverride,
    uploadJob: jobPolling.job,
    cancellingJob,
    uploadProgress: jobPolling.progress,
    uploadProgressVariant,
    uploadProgressAnimated,
    partialSummaryEntries,
    handlePreview,
    handleConfirm,
    handleDiffPreview,
    handleCancelJob,
    triggerErrorReportDownload,
    resetDiffPreviewState,
    resolveConfidenceLabel,
  };
}
