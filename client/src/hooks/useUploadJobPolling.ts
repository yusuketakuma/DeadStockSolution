import { useState, useCallback, useRef, useEffect } from 'react';
import { api, ApiError } from '../api/client';
import type {
  UploadConfirmJobResult,
  UploadConfirmJobStatusResponse,
  UploadJobStatus,
} from '../pages/upload/upload-job-utils';

const UPLOAD_JOB_POLL_INTERVAL_MS = import.meta.env.MODE === 'test' ? 20 : 1500;
const UPLOAD_JOB_POLL_MAX_INTERVAL_MS = import.meta.env.MODE === 'test' ? 100 : 5000;
const UPLOAD_JOB_MAX_POLL_WAIT_MS = import.meta.env.MODE === 'test' ? 3000 : 60 * 60 * 1000;
const UPLOAD_JOB_POLL_TRANSIENT_RETRY_MAX = import.meta.env.MODE === 'test' ? 1 : 3;

export interface UploadJobState {
  jobId: number | null;
  status: Extract<UploadJobStatus, 'pending' | 'processing'> | null;
  attempts: number;
  cancelable: boolean;
  errorReportAvailable: boolean;
  deduplicated: boolean;
  partialSummary: UploadConfirmJobResult['partialSummary'] | null;
}

export interface UploadProgressState {
  phase: 'idle' | 'previewing' | 'queueing' | 'pending' | 'processing' | 'completed' | 'failed';
  percent: number;
  label: string;
}

export const UPLOAD_JOB_INITIAL_STATE: UploadJobState = {
  jobId: null,
  status: null,
  attempts: 0,
  cancelable: false,
  errorReportAvailable: false,
  deduplicated: false,
  partialSummary: null,
};

export const UPLOAD_PROGRESS_IDLE: UploadProgressState = {
  phase: 'idle',
  percent: 0,
  label: '',
};

export interface UseUploadJobPollingOptions {
  onJobCompleted?: (result: UploadConfirmJobResult) => void;
  onJobFailed?: (error: string) => void;
  onJobCanceled?: () => void;
  onProgressUpdate?: (state: UploadProgressState) => void;
}

export interface UseUploadJobPollingReturn {
  job: UploadJobState;
  progress: UploadProgressState;
  isPolling: boolean;
  startPolling: (jobId: number, initialStatus?: 'pending' | 'processing') => Promise<UploadConfirmJobResult>;
  stopPolling: () => void;
  reset: () => void;
  setJob: React.Dispatch<React.SetStateAction<UploadJobState>>;
  setProgress: React.Dispatch<React.SetStateAction<UploadProgressState>>;
}

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

function isTransientUploadJobPollingError(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  if (err.status === 0) return true;
  return err.status === 429 || (err.status >= 500 && err.status <= 599);
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

function resolveJobProgressPercent(status: 'pending' | 'processing', elapsedMs: number): number {
  if (status === 'pending') {
    const elapsedBoost = Math.floor(elapsedMs / 10000);
    return Math.min(70, 50 + elapsedBoost);
  }
  const elapsedBoost = Math.floor(elapsedMs / 12000);
  return Math.min(95, 75 + elapsedBoost);
}

export function useUploadJobPolling(
  options: UseUploadJobPollingOptions = {},
): UseUploadJobPollingReturn {
  const { onJobCompleted, onJobFailed, onJobCanceled, onProgressUpdate } = options;

  const [job, setJob] = useState<UploadJobState>(UPLOAD_JOB_INITIAL_STATE);
  const [progress, setProgress] = useState<UploadProgressState>(UPLOAD_PROGRESS_IDLE);
  const [isPolling, setIsPolling] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const stopPolling = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsPolling(false);
  }, []);

  const reset = useCallback(() => {
    stopPolling();
    setJob(UPLOAD_JOB_INITIAL_STATE);
    setProgress(UPLOAD_PROGRESS_IDLE);
  }, [stopPolling]);

  const startPolling = useCallback(
    async (jobId: number, initialStatus: 'pending' | 'processing' = 'pending'): Promise<UploadConfirmJobResult> => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setIsPolling(true);
      const pollingStartedAt = Date.now();
      let transientPollFailures = 0;

      const initialProgress: UploadProgressState = {
        phase: initialStatus,
        percent: initialStatus === 'pending' ? 50 : 75,
        label: initialStatus === 'pending' ? 'キュー待機中です...' : 'データ反映を処理しています...',
      };
      setProgress(initialProgress);
      onProgressUpdate?.(initialProgress);
      setJob((prev) => ({
        ...prev,
        jobId,
        status: initialStatus,
      }));

      try {
        while (!controller.signal.aborted) {
          let jobStatus: UploadConfirmJobStatusResponse;

          try {
            jobStatus = await api.get<UploadConfirmJobStatusResponse>(`/upload/jobs/${jobId}`, {
              signal: controller.signal,
              timeout: 30000,
            });
          } catch (pollErr) {
            if (controller.signal.aborted) {
              throw pollErr;
            }

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
          if (controller.signal.aborted) {
            throw new DOMException('Aborted', 'AbortError');
          }

          const latestPartialSummary = jobStatus.partialSummary ?? jobStatus.result?.partialSummary ?? null;
          const latestErrorReportAvailable = Boolean(
            jobStatus.errorReportAvailable ?? jobStatus.result?.errorReportAvailable ?? false,
          );
          const latestDeduplicated = Boolean(
            jobStatus.deduplicated ?? jobStatus.result?.deduplicated ?? false,
          );

          setJob({
            jobId,
            status: jobStatus.status === 'pending' || jobStatus.status === 'processing' ? jobStatus.status : null,
            attempts: jobStatus.attempts,
            cancelable: Boolean(jobStatus.cancelable),
            errorReportAvailable: latestErrorReportAvailable,
            deduplicated: latestDeduplicated,
            partialSummary: latestPartialSummary,
          });

          if (jobStatus.status === 'completed') {
            if (!jobStatus.result) {
              throw new Error('アップロード処理結果の取得に失敗しました');
            }
            const completedProgress: UploadProgressState = {
              phase: 'completed',
              percent: 100,
              label: 'アップロード処理が完了しました。',
            };
            setProgress(completedProgress);
            onProgressUpdate?.(completedProgress);
            setJob((prev) => ({
              ...prev,
              status: null,
              cancelable: false,
              partialSummary: jobStatus.result?.partialSummary ?? prev.partialSummary,
              errorReportAvailable: Boolean(jobStatus.result?.errorReportAvailable ?? prev.errorReportAvailable),
              deduplicated: Boolean(jobStatus.result?.deduplicated ?? prev.deduplicated),
            }));
            onJobCompleted?.(jobStatus.result);
            setIsPolling(false);
            return jobStatus.result;
          }

          if (jobStatus.status === 'failed') {
            const errorMsg = jobStatus.lastError || 'アップロード処理に失敗しました';
            const failedProgress: UploadProgressState = {
              phase: 'failed',
              percent: 100,
              label: errorMsg,
            };
            setProgress(failedProgress);
            onProgressUpdate?.(failedProgress);
            onJobFailed?.(errorMsg);
            setIsPolling(false);
            throw new Error(errorMsg);
          }

          if (jobStatus.status === 'canceled') {
            onJobCanceled?.();
            throw new Error(jobStatus.lastError || 'アップロード処理はキャンセルされました');
          }

          if (jobStatus.status !== 'pending' && jobStatus.status !== 'processing') {
            throw new Error('アップロード処理状態の取得に失敗しました');
          }

          const elapsedMs = Date.now() - pollingStartedAt;
          const currentProgress: UploadProgressState = {
            phase: jobStatus.status,
            percent: resolveJobProgressPercent(jobStatus.status, elapsedMs),
            label: jobStatus.status === 'pending' ? 'キュー待機中です...' : 'データ反映を処理しています...',
          };
          setProgress(currentProgress);
          onProgressUpdate?.(currentProgress);

          if (elapsedMs > UPLOAD_JOB_MAX_POLL_WAIT_MS) {
            throw new Error(
              `アップロード処理の待機時間が長くなっています（ジョブID: ${jobId}）。時間をおいて再確認してください。`,
            );
          }

          const intervalMs = resolveNextPollIntervalMs(elapsedMs, jobStatus.status);
          await waitForNextPoll(controller.signal, intervalMs);
        }

        throw new DOMException('Aborted', 'AbortError');
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
        setIsPolling(false);
      }
    },
    [onJobCompleted, onJobFailed, onJobCanceled, onProgressUpdate],
  );

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  return {
    job,
    progress,
    isPolling,
    startPolling,
    stopPolling,
    reset,
    setJob,
    setProgress,
  };
}
