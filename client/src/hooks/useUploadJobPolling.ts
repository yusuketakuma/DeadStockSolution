/**
 * useUploadJobPolling - アップロードジョブのポーリング管理フック
 * UploadPage.tsxからポーリングロジックを抽出 (T128)
 */

import { useState, useRef, useCallback, useEffect, type SetStateAction } from 'react';
import { api, ApiError } from '../api/client';
import type {
  UploadConfirmJobResult,
  UploadConfirmJobStatusResponse,
  UploadJobStatus,
  PartialSummary,
} from '../pages/upload/upload-job-utils';

// === ポーリング設定定数 ===
export const UPLOAD_JOB_POLL_INTERVAL_MS = import.meta.env.MODE === 'test' ? 20 : 1500;
export const UPLOAD_JOB_POLL_MAX_INTERVAL_MS = import.meta.env.MODE === 'test' ? 100 : 5000;
export const UPLOAD_JOB_MAX_POLL_WAIT_MS = import.meta.env.MODE === 'test' ? 3000 : 60 * 60 * 1000;
export const UPLOAD_JOB_POLL_TRANSIENT_RETRY_MAX = import.meta.env.MODE === 'test' ? 1 : 3;

// === 型定義 ===
export type UploadProgressPhase =
  | 'idle'
  | 'previewing'
  | 'queueing'
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed';

export interface UploadJobState {
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

export interface PollingResult {
  result: UploadConfirmJobResult | null;
  error: Error | null;
  wasAborted: boolean;
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

// === ポーリング間隔計算 ===
export function resolveNextPollIntervalMs(elapsedMs: number, status: 'pending' | 'processing'): number {
  if (status === 'pending') {
    return Math.min(2500, UPLOAD_JOB_POLL_MAX_INTERVAL_MS);
  }
  if (elapsedMs > 30 * 1000) {
    return UPLOAD_JOB_POLL_MAX_INTERVAL_MS;
  }
  if (elapsedMs > 10 * 1000) {
    return Math.min(3000, UPLOAD_JOB_POLL_MAX_INTERVAL_MS);
  }
  return UPLOAD_JOB_POLL_INTERVAL_MS;
}

export function resolveTransientPollRetryIntervalMs(retryCount: number): number {
  if (import.meta.env.MODE === 'test') {
    return Math.min(UPLOAD_JOB_POLL_MAX_INTERVAL_MS, 20 * (retryCount + 1));
  }
  const base = Math.min(UPLOAD_JOB_POLL_MAX_INTERVAL_MS, 1000 * (2 ** Math.max(0, retryCount - 1)));
  const jitter = Math.random() * 500;
  return Math.min(UPLOAD_JOB_POLL_MAX_INTERVAL_MS, base + jitter);
}

export function resolveJobProgressPercent(status: 'pending' | 'processing', elapsedMs: number): number {
  if (status === 'pending') {
    return Math.min(75, 50 + Math.floor(elapsedMs / 10000) * 5);
  }
  return Math.min(95, 75 + Math.floor(elapsedMs / 5000) * 5);
}

// === 一時的エラー判定 ===
export function isTransientUploadJobPollingError(err: unknown): boolean {
  if (err instanceof ApiError && [429, 502, 503, 504].includes(err.status)) {
    return true;
  }
  if (err instanceof Error) {
    const message = err.message.toLowerCase();
    if (message.includes('network') || message.includes('timeout') || message.includes('temporary upstream error')) {
      return true;
    }
  }
  return false;
}

// === ポーリング待機関数 ===
export async function waitForNextPoll(signal: AbortSignal, intervalMs: number): Promise<void> {
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

function buildPollingTerminalResult(message: string): PollingResult {
  return { result: null, error: new Error(message), wasAborted: false };
}

// === メインフック ===
export function useUploadJobPolling() {
  const [jobState, setJobState] = useState<UploadJobState>(UPLOAD_JOB_INITIAL_STATE);
  const [progress, setProgress] = useState<UploadProgressState>(UPLOAD_PROGRESS_IDLE);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isPolling, setIsPolling] = useState(false);

  const controllerRef = useRef<AbortController | null>(null);

  // クリーンアップ
  useEffect(() => {
    return () => {
      if (controllerRef.current) {
        controllerRef.current.abort();
      }
    };
  }, []);

  // ポーリングキャンセル
  const cancelPolling = useCallback(() => {
    if (controllerRef.current) {
      controllerRef.current.abort();
      controllerRef.current = null;
    }
    setIsPolling(false);
    setIsCancelling(false);
    setProgress(UPLOAD_PROGRESS_IDLE);
  }, []);

  // ポーリング開始
  const startPolling = useCallback(async (
    jobId: number,
    onProgress?: (state: UploadProgressState) => void,
    onJobUpdate?: (state: UploadJobState) => void,
  ): Promise<PollingResult> => {
    // 前のポーリングをキャンセル
    if (controllerRef.current) {
      controllerRef.current.abort();
    }
    controllerRef.current = new AbortController();
    const controller = controllerRef.current;
    setIsPolling(true);

    const pollingStartedAt = Date.now();
    let transientPollFailures = 0;
    let latestAttempts = 0;
    let latestPartialSummary: PartialSummary | null = null;
    let latestErrorReportAvailable = false;
    let latestDeduplicated = false;

    while (!controller.signal.aborted) {
      let job: UploadConfirmJobStatusResponse;
      try {
        job = await api.get<UploadConfirmJobStatusResponse>(`/upload/jobs/${jobId}`, {
          signal: controller.signal,
          timeout: 30000,
        });
      } catch (pollErr) {
        if (controller.signal.aborted) {
          setIsPolling(false);
          return { result: null, error: null, wasAborted: true };
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
        setJobState((prev) => ({ ...prev, status: null, cancelable: false }));
        setIsPolling(false);
        return { result: null, error: pollErr as Error, wasAborted: false };
      }

      transientPollFailures = 0;
      if (controller.signal.aborted) {
        setIsPolling(false);
        return { result: null, error: null, wasAborted: true };
      }

      latestAttempts = job.attempts;
      latestPartialSummary = job.partialSummary ?? job.result?.partialSummary ?? latestPartialSummary;
      latestErrorReportAvailable = Boolean(job.errorReportAvailable ?? job.result?.errorReportAvailable ?? latestErrorReportAvailable);
      latestDeduplicated = Boolean(job.deduplicated ?? job.result?.deduplicated ?? latestDeduplicated);

      const newJobState: UploadJobState = {
        jobId,
        status: job.status === 'pending' || job.status === 'processing' ? job.status : null,
        attempts: latestAttempts,
        cancelable: Boolean(job.cancelable),
        errorReportAvailable: latestErrorReportAvailable,
        deduplicated: latestDeduplicated,
        partialSummary: latestPartialSummary,
      };
      setJobState(newJobState);
      onJobUpdate?.(newJobState);

      if (job.status === 'completed') {
        if (!job.result) {
          setIsPolling(false);
          return { result: null, error: new Error('アップロード処理結果の取得に失敗しました'), wasAborted: false };
        }
        setIsPolling(false);
        return { result: job.result, error: null, wasAborted: false };
      }
      if (job.status === 'failed') {
        setJobState((prev) => ({ ...prev, status: null, cancelable: false }));
        setIsPolling(false);
        return buildPollingTerminalResult(job.lastError || 'アップロード処理に失敗しました');
      }
      if (job.status === 'canceled' || job.status === 'cancelled') {
        setJobState((prev) => ({ ...prev, status: null, cancelable: false }));
        setIsPolling(false);
        return buildPollingTerminalResult(job.lastError || 'アップロード処理はキャンセルされました');
      }
      if (job.status !== 'pending' && job.status !== 'processing') {
        setJobState((prev) => ({ ...prev, status: null, cancelable: false }));
        setIsPolling(false);
        return buildPollingTerminalResult('アップロード処理状態の取得に失敗しました');
      }

      const elapsedMs = Date.now() - pollingStartedAt;
      const newProgress: UploadProgressState = {
        phase: job.status,
        percent: resolveJobProgressPercent(job.status, elapsedMs),
        label: job.status === 'pending'
          ? 'キュー待機中です...'
          : 'データ反映を処理しています...',
      };
      setProgress(newProgress);
      onProgress?.(newProgress);

      if (elapsedMs > UPLOAD_JOB_MAX_POLL_WAIT_MS) {
        setIsPolling(false);
        return {
          result: null,
          error: new Error(`アップロード処理の待機時間が長くなっています（ジョブID: ${jobId}）。時間をおいて再確認してください。`),
          wasAborted: false,
        };
      }

      const intervalMs = resolveNextPollIntervalMs(elapsedMs, job.status);
      await waitForNextPoll(controller.signal, intervalMs);
    }

    setIsPolling(false);
    return { result: null, error: null, wasAborted: true };
  }, []);

  // ジョブキャンセルAPI呼び出し
  const cancelJob = useCallback(async (jobId: number): Promise<boolean> => {
    setIsCancelling(true);
    try {
      await api.post(`/upload/jobs/${jobId}/cancel`);
      return true;
    } catch {
      return false;
    } finally {
      setIsCancelling(false);
    }
  }, []);

  // リセット
  const reset = useCallback(() => {
    cancelPolling();
    setJobState(UPLOAD_JOB_INITIAL_STATE);
    setProgress(UPLOAD_PROGRESS_IDLE);
  }, [cancelPolling]);

  const setJob = useCallback((nextState: SetStateAction<UploadJobState>) => {
    setJobState(nextState);
  }, []);

  const stopPolling = cancelPolling;

  return {
    // 状態
    job: jobState,
    jobState,
    progress,
    isCancelling,
    isPolling,
    // アクション
    startPolling,
    stopPolling,
    cancelPolling,
    cancelJob,
    reset,
    // 直接セッター（統合用）
    setJob,
    setJobState,
    setProgress,
  };
}

export default useUploadJobPolling;
