import { renderHook, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import type {
  UploadConfirmJobResult,
  UploadConfirmJobStatusResponse,
} from '../../pages/upload/upload-job-utils';
import {
  useUploadJobPolling,
  UPLOAD_JOB_INITIAL_STATE,
  UPLOAD_PROGRESS_IDLE,
} from '../useUploadJobPolling';
import * as api from '../../api/client';

// Mock the API client (preserve ApiError for instanceof checks)
vi.mock('../../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/client')>();
  return {
    ...actual,
    api: {
      get: vi.fn(),
    },
  };
});

// Mock import.meta.env
vi.stubEnv('MODE', 'test');

const createMockJobStatusResponse = (
  overrides: Partial<UploadConfirmJobStatusResponse> = {},
): UploadConfirmJobStatusResponse => ({
  id: 123,
  status: 'pending',
  attempts: 0,
  cancelable: true,
  errorReportAvailable: false,
  deduplicated: false,
  partialSummary: null,
  lastError: null,
  result: null,
  ...overrides,
});

const createMockJobResult = (): UploadConfirmJobResult => ({
  uploadId: 1,
  rowCount: 15,
  applyMode: 'replace',
  partialSummary: null,
  errorReportAvailable: false,
  deduplicated: false,
});

describe('useUploadJobPolling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('initial state', () => {
    it('starts with idle state', () => {
      const { result } = renderHook(() => useUploadJobPolling());

      expect(result.current.job).toEqual(UPLOAD_JOB_INITIAL_STATE);
      expect(result.current.progress).toEqual(UPLOAD_PROGRESS_IDLE);
      expect(result.current.isPolling).toBe(false);
    });
  });

  describe('startPolling', () => {
    it('polls until job completes', async () => {
      const mockResult = createMockJobResult();
      const onJobCompleted = vi.fn();

      vi.mocked(api.api.get)
        .mockResolvedValueOnce(createMockJobStatusResponse({ status: 'pending' }))
        .mockResolvedValueOnce(createMockJobStatusResponse({ status: 'processing' }))
        .mockResolvedValueOnce(
          createMockJobStatusResponse({
            status: 'completed',
            result: mockResult,
          }),
        );

      const { result } = renderHook(() =>
        useUploadJobPolling({ onJobCompleted }),
      );

      let pollingPromise!: Promise<UploadConfirmJobResult>;
      await act(async () => {
        pollingPromise = result.current.startPolling(123, 'pending');
      });

      // Advance through polling cycles
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
        await vi.advanceTimersByTimeAsync(100);
        await vi.advanceTimersByTimeAsync(100);
      });

      const finalResult = await pollingPromise;

      expect(finalResult).toEqual(mockResult);
      expect(onJobCompleted).toHaveBeenCalledWith(mockResult);
      expect(result.current.progress.phase).toBe('completed');
      expect(result.current.job.jobId).toBe(123);
    });

    it('handles job failure', async () => {
      const onJobFailed = vi.fn();

      vi.mocked(api.api.get).mockResolvedValueOnce(
        createMockJobStatusResponse({
          status: 'failed',
          lastError: 'Processing error',
        }),
      );

      const { result } = renderHook(() =>
        useUploadJobPolling({ onJobFailed }),
      );

      await act(async () => {
        try {
          await result.current.startPolling(123, 'pending');
        } catch (e) {
          // Expected
        }
        await vi.advanceTimersByTimeAsync(100);
      });

      expect(onJobFailed).toHaveBeenCalledWith('Processing error');
      expect(result.current.progress.phase).toBe('failed');
    });

    it('handles job cancellation', async () => {
      const onJobCanceled = vi.fn();

      vi.mocked(api.api.get).mockResolvedValueOnce(
        createMockJobStatusResponse({
          status: 'canceled',
          lastError: 'User canceled',
        }),
      );

      const { result } = renderHook(() =>
        useUploadJobPolling({ onJobCanceled }),
      );

      await act(async () => {
        try {
          await result.current.startPolling(123, 'pending');
        } catch (e) {
          // Expected
        }
        await vi.advanceTimersByTimeAsync(100);
      });

      expect(onJobCanceled).toHaveBeenCalled();
    });

    it('retries on transient errors', async () => {
      const mockResult = createMockJobResult();
      const transientError = new api.ApiError(0, 'Network error');

      vi.mocked(api.api.get)
        .mockRejectedValueOnce(transientError)
        .mockResolvedValueOnce(
          createMockJobStatusResponse({
            status: 'completed',
            result: mockResult,
          }),
        );

      const { result } = renderHook(() => useUploadJobPolling());

      let pollingPromise!: Promise<UploadConfirmJobResult>;
      await act(async () => {
        pollingPromise = result.current.startPolling(123, 'pending');
      });

      // Advance through retry
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
        await vi.advanceTimersByTimeAsync(100);
      });

      const finalResult = await pollingPromise;

      expect(api.api.get).toHaveBeenCalledTimes(2);
      expect(finalResult).toEqual(mockResult);
    });

    it('stops polling when stopPolling is called', async () => {
      vi.mocked(api.api.get).mockResolvedValue(
        createMockJobStatusResponse({ status: 'pending' }),
      );

      const { result } = renderHook(() => useUploadJobPolling());

      // Start polling but catch the abort error
      act(() => {
        void result.current.startPolling(123, 'pending').catch(() => {
          // Expected abort error
        });
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });

      expect(result.current.isPolling).toBe(true);

      act(() => {
        result.current.stopPolling();
      });

      // Wait for the polling to abort
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });

      expect(result.current.isPolling).toBe(false);
    });
  });

  describe('reset', () => {
    it('resets all state to initial values', async () => {
      const mockResult = createMockJobResult();

      vi.mocked(api.api.get).mockResolvedValueOnce(
        createMockJobStatusResponse({
          status: 'completed',
          result: mockResult,
        }),
      );

      const { result } = renderHook(() => useUploadJobPolling());

      await act(async () => {
        try {
          await result.current.startPolling(123, 'pending');
        } catch (e) {
          // Expected
        }
        await vi.advanceTimersByTimeAsync(100);
      });

      expect(result.current.job.jobId).toBe(123);

      act(() => {
        result.current.reset();
      });

      expect(result.current.job).toEqual(UPLOAD_JOB_INITIAL_STATE);
      expect(result.current.progress).toEqual(UPLOAD_PROGRESS_IDLE);
    });
  });
});
