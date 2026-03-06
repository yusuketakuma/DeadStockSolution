/**
 * useUploadJobPolling テスト (T128)
 * テスト要件: ポーリング成功/失敗/タイムアウト/キャンセル
 */

import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  useUploadJobPolling,
  resolveNextPollIntervalMs,
  resolveTransientPollRetryIntervalMs,
  resolveJobProgressPercent,
  waitForNextPoll,
  UPLOAD_JOB_INITIAL_STATE,
  UPLOAD_PROGRESS_IDLE,
} from '../useUploadJobPolling';

describe('useUploadJobPolling', () => {
  describe('初期状態', () => {
    it('初期状態が正しく設定される', () => {
      const { result } = renderHook(() => useUploadJobPolling());

      expect(result.current.jobState).toEqual(UPLOAD_JOB_INITIAL_STATE);
      expect(result.current.progress).toEqual(UPLOAD_PROGRESS_IDLE);
      expect(result.current.isCancelling).toBe(false);
    });

    it('resetで状態が初期化される', () => {
      const { result } = renderHook(() => useUploadJobPolling());

      // 状態を変更
      act(() => {
        result.current.setJobState({ ...UPLOAD_JOB_INITIAL_STATE, jobId: 123 });
        result.current.setProgress({ phase: 'processing', percent: 50, label: '処理中' });
      });

      expect(result.current.jobState.jobId).toBe(123);

      // リセット
      act(() => {
        result.current.reset();
      });

      expect(result.current.jobState).toEqual(UPLOAD_JOB_INITIAL_STATE);
      expect(result.current.progress).toEqual(UPLOAD_PROGRESS_IDLE);
    });
  });

  describe('セッター', () => {
    it('setJobStateで状態を更新できる', () => {
      const { result } = renderHook(() => useUploadJobPolling());

      act(() => {
        result.current.setJobState({
          jobId: 456,
          status: 'pending',
          attempts: 1,
          cancelable: true,
          errorReportAvailable: false,
          deduplicated: false,
          partialSummary: null,
        });
      });

      expect(result.current.jobState.jobId).toBe(456);
      expect(result.current.jobState.status).toBe('pending');
    });

    it('setProgressで状態を更新できる', () => {
      const { result } = renderHook(() => useUploadJobPolling());

      act(() => {
        result.current.setProgress({
          phase: 'completed',
          percent: 100,
          label: '完了',
        });
      });

      expect(result.current.progress.phase).toBe('completed');
      expect(result.current.progress.percent).toBe(100);
    });
  });
});

describe('ヘルパー関数', () => {
  describe('resolveNextPollIntervalMs', () => {
    it('pending状態では短い間隔（テスト環境では上限100ms）', () => {
      // テスト環境では UPLOAD_JOB_POLL_MAX_INTERVAL_MS = 100
      expect(resolveNextPollIntervalMs(0, 'pending')).toBe(100);
    });

    it('processing状態で経過時間が短い場合は基本間隔', () => {
      // テスト環境では UPLOAD_JOB_POLL_INTERVAL_MS = 20
      expect(resolveNextPollIntervalMs(0, 'processing')).toBe(20);
    });

    it('processing状態で10秒超過では中間の間隔', () => {
      expect(resolveNextPollIntervalMs(15000, 'processing')).toBe(100);
    });

    it('processing状態で30秒超過では最大間隔', () => {
      expect(resolveNextPollIntervalMs(35000, 'processing')).toBe(100);
    });
  });

  describe('resolveTransientPollRetryIntervalMs', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('テスト環境では短い間隔', () => {
      // テスト環境では固定式
      const result = resolveTransientPollRetryIntervalMs(1);
      expect(result).toBeGreaterThanOrEqual(20);
      expect(result).toBeLessThanOrEqual(100);
    });
  });

  describe('resolveJobProgressPercent', () => {
    it('pending状態は50%から開始', () => {
      expect(resolveJobProgressPercent('pending', 0)).toBe(50);
    });

    it('processing状態は75%から開始', () => {
      expect(resolveJobProgressPercent('processing', 0)).toBe(75);
    });

    it('pending状態は経過時間で増加', () => {
      const result1 = resolveJobProgressPercent('pending', 10000);
      expect(result1).toBeGreaterThan(50);
    });

    it('processing状態は経過時間で増加', () => {
      const result1 = resolveJobProgressPercent('processing', 5000);
      expect(result1).toBeGreaterThan(75);
    });

    it('最大値を超えない', () => {
      expect(resolveJobProgressPercent('pending', 100000)).toBeLessThanOrEqual(75);
      expect(resolveJobProgressPercent('processing', 100000)).toBeLessThanOrEqual(95);
    });
  });

  describe('waitForNextPoll', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('指定時間後に解決される', async () => {
      const controller = new AbortController();
      const promise = waitForNextPoll(controller.signal, 100);

      await vi.advanceTimersByTimeAsync(100);
      await expect(promise).resolves.toBeUndefined();
    });

    it('AbortSignalで中断される', async () => {
      const controller = new AbortController();
      const promise = waitForNextPoll(controller.signal, 1000);

      controller.abort();

      await expect(promise).rejects.toThrow('Aborted');
    });
  });
});
