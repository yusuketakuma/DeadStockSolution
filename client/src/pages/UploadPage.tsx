import { useState, useRef, FormEvent, useEffect } from 'react';
import AppAlert from '../components/ui/AppAlert';
import { Form, ProgressBar } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';
import { api, ApiError, buildApiUrl, isApiErrorCode } from '../api/client';
import AppSelect from '../components/ui/AppSelect';
import LoadingButton from '../components/ui/LoadingButton';
import AppControl from '../components/ui/AppControl';
import AppCard from '../components/ui/AppCard';
import AppButton from '../components/ui/AppButton';
import { useAsyncState } from '../hooks/useAsyncState';
import {
  type DiffSummary,
  type PartialSummary,
  type UploadConfirmJobResult,
  type UploadConfirmJobStatusResponse,
  type UploadJobStatus,
  type UploadType,
  resolvePartialSummaryEntries,
  resolveUploadTypeLabel,
} from './upload/upload-job-utils';

interface PreviewResponse {
  headers: string[];
  rows: string[][];
  suggestedMapping: Record<string, string | null>;
  suggestedMappingByType: Record<UploadType, Record<string, string | null> | null>;
  headerRowIndex: number;
  hasSavedMapping: boolean;
  detectedUploadType: UploadType;
  resolvedUploadType: UploadType;
  rememberedUploadType: UploadType | null;
  uploadTypeConfidence: 'high' | 'medium' | 'low';
  uploadTypeScores: {
    dead_stock: number;
    used_medication: number;
  };
}

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

interface UploadProgressState {
  phase: UploadProgressPhase;
  percent: number;
  label: string;
}

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

function resolveConfidenceLabel(confidence: PreviewResponse['uploadTypeConfidence']): string {
  if (confidence === 'high') return '高';
  if (confidence === 'medium') return '中';
  return '低';
}

function resolveSubmittedMapping(
  preview: PreviewResponse,
  selectedUploadType: UploadType,
): Record<string, string | null> | null {
  const selectedTypeMapping = preview.suggestedMappingByType[selectedUploadType];
  if (selectedTypeMapping) {
    return selectedTypeMapping;
  }
  if (selectedUploadType === preview.resolvedUploadType) {
    return preview.suggestedMapping;
  }
  return null;
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

export default function UploadPage() {
  const [uploadType, setUploadType] = useState<UploadType>('dead_stock');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const { loading, setLoading, error, setError, message, setMessage } = useAsyncState();
  const [showMatchingHint, setShowMatchingHint] = useState(false);
  const [applyMode, setApplyMode] = useState<'replace' | 'diff'>('replace');
  const [deleteMissing, setDeleteMissing] = useState(false);
  const [diffSummary, setDiffSummary] = useState<DiffSummary | null>(null);
  const [acknowledgeDeleteImpact, setAcknowledgeDeleteImpact] = useState(false);
  const [uploadJob, setUploadJob] = useState<UploadJobState>(UPLOAD_JOB_INITIAL_STATE);
  const [cancellingJob, setCancellingJob] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgressState>(UPLOAD_PROGRESS_IDLE);
  const fileRef = useRef<HTMLInputElement>(null);
  const navigateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const uploadRequestAbortRef = useRef<AbortController | null>(null);
  const navigate = useNavigate();

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

  const setFailed = (label: string) =>
    setUploadProgress({ phase: 'failed', percent: 100, label });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    uploadRequestAbortRef.current?.abort();
    uploadRequestAbortRef.current = null;
    if (navigateTimerRef.current !== null) {
      clearTimeout(navigateTimerRef.current);
      navigateTimerRef.current = null;
    }
    setLoading(false);
    const selected = e.target.files?.[0] || null;
    setFile(selected);
    setPreview(null);
    setUploadType('dead_stock');
    setMessage('');
    setError('');
    setShowMatchingHint(false);
    setApplyMode('replace');
    setDeleteMissing(false);
    setDiffSummary(null);
    setAcknowledgeDeleteImpact(false);
    setUploadJob(UPLOAD_JOB_INITIAL_STATE);
    setCancellingJob(false);
    setUploadProgress(UPLOAD_PROGRESS_IDLE);
  };

  const handlePreview = async (e: FormEvent) => {
    e.preventDefault();
    if (!file) return;

    uploadRequestAbortRef.current?.abort();
    const controller = new AbortController();
    uploadRequestAbortRef.current = controller;

    setLoading(true);
    setError('');
    setMessage('');
    setShowMatchingHint(false);
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
      setDiffSummary(null);
      setAcknowledgeDeleteImpact(false);
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
  };

  const handleConfirm = async () => {
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
    setError('');
    setMessage('');
    setShowMatchingHint(false);
    setUploadJob(UPLOAD_JOB_INITIAL_STATE);
    setCancellingJob(false);
    setUploadProgress({
      phase: 'queueing',
      percent: 35,
      label: 'アップロード処理を受け付けています...',
    });
    let currentJobId: number | null = null;
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('uploadType', submittedUploadType);
      formData.append('headerRowIndex', String(preview.headerRowIndex));
      formData.append('applyMode', applyMode);
      formData.append('deleteMissing', String(deleteMissing));
      formData.append('mapping', JSON.stringify(submittedMapping));

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
        }, 1200);
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
        setMessage(`ジョブは継続中の可能性があります（ジョブID: ${currentJobId ?? '不明'}）。時間をおいて再確認してください。`);
        return;
      }
      if (currentJobId !== null && err instanceof ApiError) {
        setUploadJob((prev) => ({
          ...prev,
          jobId: currentJobId,
        }));
        setFailed('ジョブ状態の確認に失敗しました。');
        setError(err.message);
        setMessage(`ジョブは継続中の可能性があります（ジョブID: ${currentJobId}）。時間をおいて再確認してください。`);
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
  };

  const handleDiffPreview = async () => {
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
      const formData = new FormData();
      formData.append('file', file);
      formData.append('uploadType', uploadType);
      formData.append('headerRowIndex', String(preview.headerRowIndex));
      formData.append('applyMode', 'diff');
      formData.append('deleteMissing', String(deleteMissing));
      formData.append('mapping', JSON.stringify(submittedMapping));

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
  };

  const handleCancelJob = async () => {
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
  };

  const triggerErrorReportDownload = () => {
    if (uploadJob.jobId === null || !uploadJob.errorReportAvailable) return;
    window.open(buildApiUrl(`/upload/jobs/${uploadJob.jobId}/error-report`), '_blank', 'noopener');
  };

  useEffect(() => () => {
    if (navigateTimerRef.current !== null) {
      clearTimeout(navigateTimerRef.current);
      navigateTimerRef.current = null;
    }
    uploadRequestAbortRef.current?.abort();
    uploadRequestAbortRef.current = null;
  }, []);

  return (
    <div>
      <h4 className="page-title mb-3">Excelアップロード</h4>
      {error && <AppAlert variant="danger">{error}</AppAlert>}
      {message && <AppAlert variant="success">{message}</AppAlert>}
      {showMatchingHint && (
        <AppAlert variant="info">
          交換候補をすぐ確認する場合は「マッチング」ページで再実行してください。
        </AppAlert>
      )}

      {uploadProgress.phase !== 'idle' && (
        <AppCard className="mb-3">
          <AppCard.Body>
            <div className="small mb-2">{uploadProgress.label}</div>
            <ProgressBar
              animated={uploadProgressAnimated}
              now={uploadProgress.percent}
              variant={uploadProgressVariant}
            />
            {uploadJob.jobId !== null && (
              <div className="small text-muted mt-2">
                ジョブID: {uploadJob.jobId}
                {uploadJob.status && ` / 状態: ${uploadJob.status === 'pending' ? '待機中' : '処理中'}`}
                {' '} / 試行回数: {uploadJob.attempts}
              </div>
            )}
            {uploadJob.deduplicated && (
              <div className="small text-info mt-2">
                同一内容の送信は重複ジョブとして集約されました。
              </div>
            )}
            {partialSummaryEntries.length > 0 && (
              <div className="small mt-2">
                部分サマリー:
                {' '}
                {partialSummaryEntries.map((entry) => `${entry.label} ${entry.value}件`).join(' / ')}
              </div>
            )}
            {(uploadJob.cancelable || uploadJob.errorReportAvailable) && (
              <div className="d-flex gap-2 mt-2">
                <AppButton
                  size="sm"
                  variant="outline-warning"
                  disabled={!uploadJob.cancelable || cancellingJob}
                  onClick={() => void handleCancelJob()}
                >
                  {cancellingJob ? 'キャンセル中...' : 'このジョブをキャンセル'}
                </AppButton>
                <AppButton
                  size="sm"
                  variant="outline-secondary"
                  disabled={!uploadJob.errorReportAvailable}
                  onClick={triggerErrorReportDownload}
                >
                  エラーレポートをダウンロード
                </AppButton>
              </div>
            )}
          </AppCard.Body>
        </AppCard>
      )}

      <AppCard className="mb-3">
        <AppCard.Header>アップロード手順</AppCard.Header>
        <AppCard.Body>
          <ol className="mb-2 upload-step-list">
            <li>Excelファイル（.xlsx・最大50MB）を選択します。</li>
            <li>「プレビュー」を押して、ファイルの内容を確認します。</li>
            <li>取込種別（デッドストック／使用量）が正しいことを確認します。</li>
            <li>「この設定でデータを登録」を押して反映します。</li>
          </ol>
          <div className="small text-muted mt-1">
            列の対応付けは自動で行われるため、手動での設定は不要です。
          </div>
        </AppCard.Body>
      </AppCard>

      <AppCard className="mb-3">
        <AppCard.Body>
          <Form onSubmit={handlePreview}>
            <Form.Group className="mb-3" controlId="upload-file">
              <Form.Label>Excelファイル (.xlsx)</Form.Label>
              <AppControl
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={handleFileChange}
                ref={fileRef}
              />
            </Form.Group>

            <LoadingButton type="submit" variant="primary" disabled={!file} loading={loading} loadingLabel="プレビュー中...">
              プレビュー
            </LoadingButton>
          </Form>
        </AppCard.Body>
      </AppCard>

      {loading && uploadProgress.phase === 'idle' && <ProgressBar animated now={100} className="mb-3" />}

      {preview && (
        <AppCard className="mb-3">
          <AppCard.Header>取込内容の確認</AppCard.Header>
          <AppCard.Body>
            <Form.Group className="mb-3" controlId="upload-type">
              <Form.Label>取込種別（自動判定）</Form.Label>
              <AppSelect
                controlId="upload-type"
                value={uploadType}
                ariaLabel="取込種別"
                disabled={loading}
                onChange={(value) => {
                  setUploadType(value as UploadType);
                  setDiffSummary(null);
                  setAcknowledgeDeleteImpact(false);
                }}
                options={[
                  { value: 'dead_stock', label: 'デッドストックリスト' },
                  { value: 'used_medication', label: '医薬品使用量リスト' },
                ]}
              />
              <div className="small text-muted mt-1">
                自動判定: {resolveUploadTypeLabel(preview.detectedUploadType)}（信頼度: {resolveConfidenceLabel(preview.uploadTypeConfidence)}）
                {' '} / スコア: 在庫 {preview.uploadTypeScores.dead_stock}・使用量 {preview.uploadTypeScores.used_medication}
                {preview.rememberedUploadType && (
                  <>
                    {' '} / 前回記憶: {resolveUploadTypeLabel(preview.rememberedUploadType)}
                  </>
                )}
              </div>
              {preview.hasSavedMapping && (
                <div className="small text-muted mt-1">
                  同一ヘッダーの過去アップロード設定を参照しています。
                </div>
              )}
              {hasManualTypeOverride && (
                <div className="small text-warning mt-1">
                  自動判定結果を手動修正しています。この種別で取り込みます。
                </div>
              )}
            </Form.Group>

            <div className="table-responsive mb-3">
              <table className="table table-sm table-bordered mobile-table">
                <thead>
                  <tr>
                    {preview.headers.map((header, headerIdx) => (
                      <th key={headerIdx} className="small">{header || `列${headerIdx + 1}`}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.slice(0, 3).map((row, rowIdx) => (
                    <tr key={rowIdx}>
                      {row.map((cell, cellIdx) => (
                        <td key={cellIdx} className="small">{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!hasPreviewRows && (
              <AppAlert variant="warning" className="small">
                プレビューに取込対象の行が見つかりません。ファイル内容を確認してください。
              </AppAlert>
            )}
            {!hasResolvableMapping && (
              <AppAlert variant="warning" className="small">
                選択した取込種別で必要な列を自動判定できませんでした。ファイル見出しを確認してください。
              </AppAlert>
            )}

            <hr />

            <Form.Group className="mb-2" controlId="upload-apply-mode">
              <Form.Label>反映方式</Form.Label>
              <AppSelect
                controlId="upload-apply-mode"
                value={applyMode}
                ariaLabel="反映方式"
                disabled={loading}
                onChange={(value) => {
                  setApplyMode(value as 'replace' | 'diff');
                  setDiffSummary(null);
                  setAcknowledgeDeleteImpact(false);
                }}
                options={[
                  { value: 'replace', label: '置換' },
                  { value: 'diff', label: '差分反映' },
                ]}
              />
              <div className="small text-muted mt-1">
                {preview.hasSavedMapping
                  ? '同一ヘッダーの過去設定を検出しました。反映方式は必要に応じて選択してください。'
                  : '初回アップロードのため、反映方式を選択して登録してください。'}
              </div>
            </Form.Group>

            {applyMode === 'diff' && (
              <Form.Group className="mb-2">
                <Form.Check
                  id="upload-delete-missing"
                  type="checkbox"
                  label="差分に存在しない既存データを無効化/削除する"
                  checked={deleteMissing}
                  onChange={(e) => {
                    setDeleteMissing(e.currentTarget.checked);
                    setDiffSummary(null);
                    setAcknowledgeDeleteImpact(false);
                  }}
                />
                <div className="mt-2">
                  <LoadingButton
                    variant="outline-secondary"
                    size="sm"
                    onClick={handleDiffPreview}
                    loading={loading}
                    loadingLabel="差分比較中..."
                  >
                    差分プレビューを更新
                  </LoadingButton>
                </div>
              </Form.Group>
            )}

            {applyMode === 'diff' && diffSummary && (
              <AppAlert variant="info" className="small">
                追加: {diffSummary.inserted}件 / 更新: {diffSummary.updated}件 / 無効化・削除: {diffSummary.deactivated}件 / 変更なし: {diffSummary.unchanged}件
                {' '}（取込総数: {diffSummary.totalIncoming}件）
              </AppAlert>
            )}

            <div className="mt-3 mobile-stack">
              <LoadingButton
                variant="success"
                onClick={handleConfirm}
                disabled={!canSubmit}
                loading={loading}
                loadingLabel="登録中..."
              >
                この設定でデータを登録
              </LoadingButton>
              {requiresDeleteImpactAcknowledgement && (
                <div className="small text-warning mt-2">
                  <Form.Check
                    id="upload-delete-impact-ack"
                    type="checkbox"
                    label={`無効化・削除 ${diffSummary?.deactivated ?? 0} 件の影響を確認しました`}
                    checked={acknowledgeDeleteImpact}
                    onChange={(e) => setAcknowledgeDeleteImpact(e.currentTarget.checked)}
                  />
                </div>
              )}
              {requiresDiffPreviewRefresh && !diffSummary && (
                <div className="small text-warning mt-2">
                  無効化・削除を有効にした場合は、送信前に「差分プレビューを更新」を実行してください。
                </div>
              )}
            </div>
          </AppCard.Body>
        </AppCard>
      )}
    </div>
  );
}
