import { useState, useRef, useCallback, useEffect, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError, buildApiUrl, isApiErrorCode } from '../api/client';
import {
  type PreviewResponse,
  resolveConfidenceLabel,
  resolveSubmittedMapping,
} from './useUploadPreview';
import {
  type DiffSummary,
  type PartialSummary,
  type UploadConfirmJobResult,
  type UploadConfirmJobStatusResponse,
  type UploadJobStatus,
  type UploadType,
  resolvePartialSummaryEntries,
} from '../pages/upload/upload-job-utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UploadConfirmAsyncResponse {
  message: string;
  jobId: number;
  status: 'pending' | 'processing';
  deduplicated?: boolean;
}

type UploadProgressPhase = 'idle' | 'previewing' | 'queueing' | 'pending' | 'processing' | 'completed' | 'failed';

interface UploadJobState {
  jobId: number | null;
  status: Extract<UploadJobStatus, 'pending' | 'processing'> | null;
  attempts: number;
  cancelable: boolean;
  errorReportAvailable: boolean;
  deduplicated: boolean;
  partialSummary: PartialSummary | null;
}

export interface UploadProgressState {
  phase: UploadProgressPhase;
  percent: number;
  label: string;
}

interface UploadMutationFormDataOptions {
  file: File;
  uploadType: UploadType;
  headerRowIndex: number;
  applyMode: 'replace' | 'diff';
  deleteMissing: boolean;
  mapping: Record<string, string | null>;
}

// ---------------------------------------------------------------------------
// Return type
// ---------------------------------------------------------------------------

export interface UseUploadExcelFlowReturn {
  // File state
  file: File | null;
  fileRef: React.RefObject<HTMLInputElement>;
  handleFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;

  // Preview state
  preview: PreviewResponse | null;
  uploadType: UploadType;
  setUploadType: (type: UploadType) => void;

  // Async / feedback state
  loading: boolean;
  error: string;
  message: string;
  showMatchingHint: boolean;

  // Apply mode / diff
  applyMode: 'replace' | 'diff';
  setApplyMode: (mode: 'replace' | 'diff') => void;
  deleteMissing: boolean;
  setDeleteMissing: (value: boolean) => void;
  diffSummary: DiffSummary | null;
  acknowledgeDeleteImpact: boolean;
  setAcknowledgeDeleteImpact: (value: boolean) => void;

  // Derived booleans
  requiresDiffPreviewRefresh: boolean;
  hasCurrentDiffPreview: boolean;
  requiresDeleteImpactAcknowledgement: boolean;
  hasPreviewRows: boolean;
  hasResolvableMapping: boolean;
  canSubmit: boolean;
  hasManualTypeOverride: boolean;

  // Upload job state
  uploadJob: UploadJobState;
  cancellingJob: boolean;
  uploadProgress: UploadProgressState;
  uploadProgressVariant: 'danger' | 'success' | 'info';
  uploadProgressAnimated: boolean;
  partialSummaryEntries: Array<{ key: string; label: string; value: number }>;

  // Actions
  handlePreview: (e: FormEvent) => Promise<void>;
  handleConfirm: () => Promise<void>;
  handleDiffPreview: () => Promise<void>;
  handleCancelJob: () => Promise<void>;
  triggerErrorReportDownload: () => void;
  resetDiffPreviewState: () => void;

  // Re-exported utilities the JSX needs
  resolveConfidenceLabel: typeof resolveConfidenceLabel;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const UPLOAD_JOB_INITIAL_STATE: UploadJobState = {
  jobId: null,
  status: null,
  attempts: 0,
  cancelable: false,
  errorReportAvailable: false,
  deduplicated: false,
  partialSummary: null,
};
const UPLOAD_PROGRESS_IDLE: UploadProgressState = { phase: 'idle', percent: 0, label: '' };

const UPLOAD_CONFIRM_ENQUEUE_TIMEOUT_MS = 5 * 60 * 1000;
const UPLOAD_JOB_POLL_INTERVAL_MS = import.meta.env.MODE === 'test' ? 20 : 1500;
const UPLOAD_JOB_POLL_MAX_INTERVAL_MS = import.meta.env.MODE === 'test' ? 100 : 5000;
const UPLOAD_JOB_MAX_POLL_WAIT_MS = import.meta.env.MODE === 'test' ? 3000 : 60 * 60 * 1000;
const UPLOAD_JOB_POLL_TRANSIENT_RETRY_MAX = import.meta.env.MODE === 'test' ? 1 : 3;
const UPLOAD_COMPLETE_NAVIGATE_DELAY_MS = import.meta.env.MODE === 'test' ? 0 : 1200;

// ---------------------------------------------------------------------------
// Pure helpers (identical to the originals in UploadPage)
// ---------------------------------------------------------------------------

function resolveNextPollIntervalMs(elapsedMs: number, status: 'pending' | 'processing'): number {
  if (status === 'processing') {
    return Math.min(2500, UPLOAD_JOB_POLL_MAX_INTERVAL_MS);
  }
  if (elapsedMs >= 5 * 60 * 1000) {
    return UPLOAD_JOB_POLL_MAX_INTERVAL_MS;
  }
  if (elapsedMs >= 60 * 1000) {
    return Math.min(3000, UPLOAD_JOB_POLL_MAX_INTERVAL_MS);
  }
  return UPLOAD_JOB_POLL_INTERVAL_MS;
}

function resolveTransientPollRetryIntervalMs(retryCount: number): number {
  if (import.meta.env.MODE === 'test') {
    return Math.min(UPLOAD_JOB_POLL_MAX_INTERVAL_MS, 20 * (retryCount + 1));
  }
  const base = Math.min(UPLOAD_JOB_POLL_MAX_INTERVAL_MS, 1000 * (2 ** Math.max(0, retryCount - 1)));
  const jitter = Math.floor(Math.random() * 300);
  return Math.min(UPLOAD_JOB_POLL_MAX_INTERVAL_MS, base + jitter);
}

function resolveJobProgressPercent(status: 'pending' | 'processing', elapsedMs: number): number {
  if (status === 'pending') {
    const elapsedBoost = Math.floor(elapsedMs / 10000);
    return Math.min(70, 50 + elapsedBoost);
  }
  const elapsedBoost = Math.floor(elapsedMs / 12000);
  return Math.min(95, 75 + elapsedBoost);
}

function isTransientUploadJobPollingError(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  if (err.status === 0) return true;
  return err.status === 429 || (err.status >= 500 && err.status <= 599);
}

function buildUploadMutationFormData({
  file,
  uploadType,
  headerRowIndex,
  applyMode,
  deleteMissing,
  mapping,
}: UploadMutationFormDataOptions): FormData {
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

async function waitForNextPoll(signal: AbortSignal, intervalMs: number): Promise<void> {
  if (signal.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }
  await new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const onAbort = () => {
      if (timer !== null) {
        clearTimeout(timer);
      }
      signal.removeEventListener('abort', onAbort);
      reject(new DOMException('Aborted', 'AbortError'));
    };

    timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, intervalMs);

    signal.addEventListener('abort', onAbort, { once: true });
  });
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useUploadExcelFlow(): UseUploadExcelFlowReturn {
  const [uploadType, setUploadType] = useState<UploadType>('dead_stock');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [showMatchingHint, setShowMatchingHint] = useState(false);
  const [applyMode, setApplyMode] = useState<'replace' | 'diff'>('replace');
  const [deleteMissing, setDeleteMissing] = useState(false);
  const [diffSummary, setDiffSummary] = useState<DiffSummary | null>(null);
  const [acknowledgeDeleteImpact, setAcknowledgeDeleteImpact] = useState(false);
  const [uploadJob, setUploadJob] = useState<UploadJobState>(UPLOAD_JOB_INITIAL_STATE);
  const [cancellingJob, setCancellingJob] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgressState>(UPLOAD_PROGRESS_IDLE);
  const fileRef = useRef<HTMLInputElement>(null!);  // eslint-disable-line @typescript-eslint/no-non-null-assertion
  const navigateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const uploadRequestAbortRef = useRef<AbortController | null>(null);
  const navigate = useNavigate();

  // Derived values
  const requiresDiffPreviewRefresh = applyMode === 'diff' && deleteMissing;
  const hasCurrentDiffPreview = !requiresDiffPreviewRefresh || diffSummary !== null;
  const requiresDeleteImpactAcknowledgement = requiresDiffPreviewRefresh && (diffSummary?.deactivated ?? 0) > 0;
  const hasPreviewRows = (preview?.rows.length ?? 0) > 0;
  const selectedUploadTypeMapping = preview ? resolveSubmittedMapping(preview, uploadType) : null;
  const hasResolvableMapping = selectedUploadTypeMapping !== null;
  const canSubmit = Boolean(preview)
    && hasPreviewRows
    && hasResolvableMapping
    && hasCurrentDiffPreview
    && (!requiresDeleteImpactAcknowledgement || acknowledgeDeleteImpact);

  const hasManualTypeOverride = Boolean(preview && uploadType !== preview.resolvedUploadType);
  const partialSummaryEntries = resolvePartialSummaryEntries(uploadJob.partialSummary);
  const uploadProgressVariant = uploadProgress.phase === 'failed'
    ? 'danger'
    : uploadProgress.phase === 'completed'
      ? 'success'
      : 'info';
  const uploadProgressAnimated = uploadProgress.phase !== 'completed' && uploadProgress.phase !== 'failed';

  // Internal helpers
  const setFailed = useCallback(
    (label: string) => setUploadProgress({ phase: 'failed', percent: 100, label }),
    [],
  );

  const clearTransientFeedback = useCallback(() => {
    setError('');
    setMessage('');
    setShowMatchingHint(false);
  }, []);

  const resetDiffPreviewState = useCallback(() => {
    setDiffSummary(null);
    setAcknowledgeDeleteImpact(false);
  }, []);

  const clearPendingUploadSideEffects = useCallback(() => {
    uploadRequestAbortRef.current?.abort();
    uploadRequestAbortRef.current = null;
    if (navigateTimerRef.current !== null) {
      clearTimeout(navigateTimerRef.current);
      navigateTimerRef.current = null;
    }
  }, []);

  const resetExcelTransientUiState = useCallback(() => {
    setLoading(false);
    clearTransientFeedback();
    setUploadJob(UPLOAD_JOB_INITIAL_STATE);
    setCancellingJob(false);
    setUploadProgress(UPLOAD_PROGRESS_IDLE);
  }, [clearTransientFeedback]);

  // --- Actions ---

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      clearPendingUploadSideEffects();
      resetExcelTransientUiState();
      const selected = e.target.files?.[0] || null;
      setFile(selected);
      setPreview(null);
      setUploadType('dead_stock');
      setApplyMode('replace');
      setDeleteMissing(false);
      resetDiffPreviewState();
    },
    [clearPendingUploadSideEffects, resetExcelTransientUiState, resetDiffPreviewState],
  );

  const handlePreview = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!file) return;

      uploadRequestAbortRef.current?.abort();
      const controller = new AbortController();
      uploadRequestAbortRef.current = controller;

      setLoading(true);
      clearTransientFeedback();
      setUploadProgress({
        phase: 'previewing',
        percent: 20,
        label: 'Excelファイルを解析しています...',
      });

      try {
        const formData = new FormData();
        formData.append('file', file);

        const data = await api.upload<PreviewResponse>('/upload/preview', formData, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setPreview(data);
        setUploadType(data.resolvedUploadType);
        resetDiffPreviewState();
        setUploadProgress(UPLOAD_PROGRESS_IDLE);
      } catch (err) {
        if (controller.signal.aborted) return;
        setFailed('Excel解析に失敗しました。');
        setError(err instanceof Error ? err.message : 'プレビューに失敗しました');
      } finally {
        if (uploadRequestAbortRef.current === controller) {
          uploadRequestAbortRef.current = null;
        }
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    },
    [file, clearTransientFeedback, resetDiffPreviewState, setFailed],
  );

  const handleConfirm = useCallback(async () => {
    if (!file || !preview) {
      setError('先にプレビューを実行してください');
      return;
    }
    const submittedMapping = resolveSubmittedMapping(preview, uploadType);
    if (!submittedMapping) {
      setError('選択した取込種別の自動判定に必要な列が不足しています。ファイル見出しを確認してください。');
      return;
    }

    uploadRequestAbortRef.current?.abort();
    const controller = new AbortController();
    uploadRequestAbortRef.current = controller;
    const submittedUploadType = uploadType;

    setLoading(true);
    clearTransientFeedback();
    setUploadJob(UPLOAD_JOB_INITIAL_STATE);
    setCancellingJob(false);
    setUploadProgress({
      phase: 'queueing',
      percent: 35,
      label: 'アップロード処理を受け付けています...',
    });
    let currentJobId: number | null = null;
    try {
      const formData = buildUploadMutationFormData({
        file,
        uploadType: submittedUploadType,
        headerRowIndex: preview.headerRowIndex,
        applyMode,
        deleteMissing,
        mapping: submittedMapping,
      });

      const enqueueResult = await api.upload<UploadConfirmAsyncResponse>(
        '/upload/confirm-async',
        formData,
        {
          signal: controller.signal,
          timeout: UPLOAD_CONFIRM_ENQUEUE_TIMEOUT_MS,
        },
      );
      if (controller.signal.aborted) return;

      const { jobId } = enqueueResult;
      currentJobId = jobId;
      let latestAttempts = 0;
      let latestPartialSummary: PartialSummary | null = null;
      let latestErrorReportAvailable = false;
      let latestDeduplicated = Boolean(enqueueResult.deduplicated);
      setUploadJob({
        jobId,
        status: enqueueResult.status,
        attempts: 0,
        cancelable: false,
        errorReportAvailable: false,
        deduplicated: latestDeduplicated,
        partialSummary: null,
      });
      setMessage(
        `${enqueueResult.message}（ジョブID: ${jobId}）${latestDeduplicated ? ' 同一ジョブへ集約して処理します。' : ''}`,
      );
      setUploadProgress({
        phase: enqueueResult.status,
        percent: enqueueResult.status === 'pending' ? 50 : 75,
        label: enqueueResult.status === 'pending' ? 'キュー待機中です...' : 'データ反映を処理しています...',
      });

      const pollingStartedAt = Date.now();
      let completedResult: UploadConfirmJobResult | null = null;
      let transientPollFailures = 0;

      while (!controller.signal.aborted) {
        let job: UploadConfirmJobStatusResponse;
        try {
          job = await api.get<UploadConfirmJobStatusResponse>(`/upload/jobs/${jobId}`, {
            signal: controller.signal,
            timeout: 30000,
          });
        } catch (pollErr) {
          if (controller.signal.aborted) return;

          if (
            isTransientUploadJobPollingError(pollErr)
            && transientPollFailures < UPLOAD_JOB_POLL_TRANSIENT_RETRY_MAX
          ) {
            transientPollFailures += 1;
            const retryIntervalMs = resolveTransientPollRetryIntervalMs(transientPollFailures);
            await waitForNextPoll(controller.signal, retryIntervalMs);
            continue;
          }

          throw pollErr;
        }

        transientPollFailures = 0;
        if (controller.signal.aborted) return;
        latestAttempts = job.attempts;
        latestPartialSummary = job.partialSummary ?? job.result?.partialSummary ?? null;
        latestErrorReportAvailable = Boolean(job.errorReportAvailable ?? job.result?.errorReportAvailable ?? latestErrorReportAvailable);
        latestDeduplicated = Boolean(job.deduplicated ?? job.result?.deduplicated ?? latestDeduplicated);
        setUploadJob((prev) => ({
          ...prev,
          status: job.status === 'pending' || job.status === 'processing' ? job.status : null,
          attempts: latestAttempts,
          cancelable: Boolean(job.cancelable),
          errorReportAvailable: latestErrorReportAvailable,
          deduplicated: latestDeduplicated,
          partialSummary: latestPartialSummary,
        }));

        if (job.status === 'completed') {
          if (!job.result) {
            throw new Error('アップロード処理結果の取得に失敗しました');
          }
          latestPartialSummary = job.result.partialSummary ?? latestPartialSummary;
          latestErrorReportAvailable = Boolean(job.result.errorReportAvailable ?? latestErrorReportAvailable);
          latestDeduplicated = Boolean(job.result.deduplicated ?? latestDeduplicated);
          completedResult = job.result;
          break;
        }
        if (job.status === 'failed') {
          throw new Error(job.lastError || 'アップロード処理に失敗しました');
        }
        if (job.status === 'canceled') {
          throw new Error(job.lastError || 'アップロード処理はキャンセルされました');
        }
        if (job.status !== 'pending' && job.status !== 'processing') {
          throw new Error('アップロード処理状態の取得に失敗しました');
        }

        const elapsedMs = Date.now() - pollingStartedAt;
        setUploadProgress({
          phase: job.status,
          percent: resolveJobProgressPercent(job.status, elapsedMs),
          label: job.status === 'pending'
            ? 'キュー待機中です...'
            : 'データ反映を処理しています...',
        });

        if (elapsedMs > UPLOAD_JOB_MAX_POLL_WAIT_MS) {
          throw new Error(`アップロード処理の待機時間が長くなっています（ジョブID: ${jobId}）。時間をおいて再確認してください。`);
        }

        const intervalMs = resolveNextPollIntervalMs(elapsedMs, job.status);
        await waitForNextPoll(controller.signal, intervalMs);
      }

      if (controller.signal.aborted) return;
      setUploadJob({
        jobId,
        status: null,
        attempts: latestAttempts,
        cancelable: false,
        errorReportAvailable: Boolean(completedResult?.errorReportAvailable ?? latestErrorReportAvailable),
        deduplicated: Boolean(completedResult?.deduplicated ?? latestDeduplicated),
        partialSummary: completedResult?.partialSummary ?? latestPartialSummary,
      });
      setUploadProgress({
        phase: 'completed',
        percent: 100,
        label: 'アップロード処理が完了しました。',
      });
      const failedCount = completedResult?.partialSummary?.rejectedRows
        ?? completedResult?.partialSummary?.failed
        ?? latestPartialSummary?.rejectedRows
        ?? latestPartialSummary?.failed
        ?? 0;
      const completionMessage = `${completedResult?.rowCount ?? 0}件のデータを登録しました。マッチング候補の再計算と通知更新が反映されます。`;
      const partialMessage = failedCount > 0
        ? ` 一部データの取込に失敗しました（${failedCount}件）。`
        : '';
      const deduplicateMessage = latestDeduplicated ? ' 同一内容の重複送信はジョブに集約されました。' : '';
      setMessage(`${completionMessage}${partialMessage}${deduplicateMessage}`);
      setDiffSummary(completedResult?.diffSummary ?? null);
      setShowMatchingHint(true);
      setPreview(null);
      setFile(null);
      if (fileRef.current) fileRef.current.value = '';

      const shouldAutoNavigate = !(completedResult?.errorReportAvailable ?? latestErrorReportAvailable) && failedCount === 0;
      if (shouldAutoNavigate) {
        if (navigateTimerRef.current !== null) {
          clearTimeout(navigateTimerRef.current);
        }
        navigateTimerRef.current = setTimeout(() => {
          navigateTimerRef.current = null;
          navigate(submittedUploadType === 'dead_stock' ? '/inventory/dead-stock' : '/inventory/used-medication');
        }, UPLOAD_COMPLETE_NAVIGATE_DELAY_MS);
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      if (isApiErrorCode(err, 'UPLOAD_CONFIRM_QUEUE_LIMIT')) {
        setUploadJob(UPLOAD_JOB_INITIAL_STATE);
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
        setUploadJob((prev) => ({
          ...prev,
          jobId: currentJobId,
        }));
        setFailed('ジョブ状態の確認に失敗しました。');
        setError(err.message);
        setMessage(resolvePossiblyRunningJobMessage(currentJobId));
        return;
      }
      setUploadJob((prev) => ({
        ...prev,
        jobId: currentJobId ?? prev.jobId,
        status: null,
        cancelable: false,
      }));
      setFailed('アップロード処理に失敗しました。');
      setMessage('');
      setError(err instanceof Error ? err.message : '登録に失敗しました');
    } finally {
      if (uploadRequestAbortRef.current === controller) {
        uploadRequestAbortRef.current = null;
      }
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  }, [file, preview, uploadType, applyMode, deleteMissing, clearTransientFeedback, setFailed, navigate]);

  const handleDiffPreview = useCallback(async () => {
    if (!file || !preview) return;
    if (applyMode !== 'diff') return;
    const submittedMapping = resolveSubmittedMapping(preview, uploadType);
    if (!submittedMapping) {
      setError('選択した取込種別の自動判定に必要な列が不足しています。ファイル見出しを確認してください。');
      return;
    }

    uploadRequestAbortRef.current?.abort();
    const controller = new AbortController();
    uploadRequestAbortRef.current = controller;

    setLoading(true);
    setError('');
    try {
      const formData = buildUploadMutationFormData({
        file,
        uploadType,
        headerRowIndex: preview.headerRowIndex,
        applyMode: 'diff',
        deleteMissing,
        mapping: submittedMapping,
      });

      const result = await api.upload<{ summary: DiffSummary }>('/upload/diff-preview', formData, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setDiffSummary(result.summary);
      setAcknowledgeDeleteImpact(false);
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : '差分プレビューに失敗しました');
    } finally {
      if (uploadRequestAbortRef.current === controller) {
        uploadRequestAbortRef.current = null;
      }
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  }, [file, preview, uploadType, applyMode, deleteMissing]);

  const handleCancelJob = useCallback(async () => {
    if (uploadJob.jobId === null || !uploadJob.cancelable || cancellingJob) return;

    uploadRequestAbortRef.current?.abort();
    uploadRequestAbortRef.current = null;
    setCancellingJob(true);
    setError('');
    try {
      const result = await api.post<{ message?: string }>(`/upload/jobs/${uploadJob.jobId}/cancel`);
      setUploadJob((prev) => ({
        ...prev,
        status: null,
        cancelable: false,
      }));
      setFailed('アップロード処理をキャンセルしました。');
      setMessage(result.message ?? `ジョブID: ${uploadJob.jobId} をキャンセルしました。`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ジョブのキャンセルに失敗しました');
    } finally {
      setCancellingJob(false);
    }
  }, [uploadJob.jobId, uploadJob.cancelable, cancellingJob, setFailed]);

  const triggerErrorReportDownload = useCallback(() => {
    if (uploadJob.jobId === null || !uploadJob.errorReportAvailable) return;
    window.open(buildApiUrl(`/upload/jobs/${uploadJob.jobId}/error-report`), '_blank', 'noopener');
  }, [uploadJob.jobId, uploadJob.errorReportAvailable]);

  // Wrapping setUploadType so we also reset diff state
  const handleSetUploadType = useCallback(
    (type: UploadType) => {
      setUploadType(type);
      resetDiffPreviewState();
    },
    [resetDiffPreviewState],
  );

  // Wrapping setApplyMode so we also reset diff state
  const handleSetApplyMode = useCallback(
    (mode: 'replace' | 'diff') => {
      setApplyMode(mode);
      resetDiffPreviewState();
    },
    [resetDiffPreviewState],
  );

  // Wrapping setDeleteMissing so we also reset diff state
  const handleSetDeleteMissing = useCallback(
    (value: boolean) => {
      setDeleteMissing(value);
      resetDiffPreviewState();
    },
    [resetDiffPreviewState],
  );

  // Cleanup on unmount
  useEffect(() => () => {
    if (navigateTimerRef.current !== null) {
      clearTimeout(navigateTimerRef.current);
      navigateTimerRef.current = null;
    }
    uploadRequestAbortRef.current?.abort();
    uploadRequestAbortRef.current = null;
  }, []);

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

    applyMode,
    setApplyMode: handleSetApplyMode,
    deleteMissing,
    setDeleteMissing: handleSetDeleteMissing,
    diffSummary,
    acknowledgeDeleteImpact,
    setAcknowledgeDeleteImpact,

    requiresDiffPreviewRefresh,
    hasCurrentDiffPreview,
    requiresDeleteImpactAcknowledgement,
    hasPreviewRows,
    hasResolvableMapping,
    canSubmit,
    hasManualTypeOverride,

    uploadJob,
    cancellingJob,
    uploadProgress,
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
