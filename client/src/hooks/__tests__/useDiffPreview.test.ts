import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDiffPreview } from '../useDiffPreview';

// Mock api
vi.mock('../../api/client', () => ({
  api: {
    upload: vi.fn(),
  },
}));

describe('useDiffPreview', () => {
  const mockFile = new File(['test'], 'test.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const mockResolveSubmittedMapping = vi.fn(() => ({ col1: 'janCode' }));

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('initializes with default values', () => {
    const { result } = renderHook(() =>
      useDiffPreview({
        file: null,
        uploadType: 'dead_stock',
        previewHeaderRowIndex: null,
        resolveSubmittedMapping: mockResolveSubmittedMapping,
      }),
    );

    expect(result.current.applyMode).toBe('replace');
    expect(result.current.deleteMissing).toBe(false);
    expect(result.current.diffSummary).toBe(null);
    expect(result.current.acknowledgeDeleteImpact).toBe(false);
  });

  it('sets apply mode', () => {
    const { result } = renderHook(() =>
      useDiffPreview({
        file: mockFile,
        uploadType: 'dead_stock',
        previewHeaderRowIndex: 0,
        resolveSubmittedMapping: mockResolveSubmittedMapping,
      }),
    );

    act(() => {
      result.current.setApplyMode('diff');
    });

    expect(result.current.applyMode).toBe('diff');
  });

  it('sets delete missing flag', () => {
    const { result } = renderHook(() =>
      useDiffPreview({
        file: mockFile,
        uploadType: 'dead_stock',
        previewHeaderRowIndex: 0,
        resolveSubmittedMapping: mockResolveSubmittedMapping,
      }),
    );

    act(() => {
      result.current.setDeleteMissing(true);
    });

    expect(result.current.deleteMissing).toBe(true);
  });

  it('resets diff preview state', () => {
    const { result } = renderHook(() =>
      useDiffPreview({
        file: mockFile,
        uploadType: 'dead_stock',
        previewHeaderRowIndex: 0,
        resolveSubmittedMapping: mockResolveSubmittedMapping,
      }),
    );

    act(() => {
      result.current.setApplyMode('diff');
      result.current.setDeleteMissing(true);
      result.current.setAcknowledgeDeleteImpact(true);
    });

    act(() => {
      result.current.resetDiffPreviewState();
    });

    expect(result.current.diffSummary).toBe(null);
    expect(result.current.acknowledgeDeleteImpact).toBe(false);
  });

  it('aborts in-flight diff preview when reset is called', async () => {
    const { api } = await import('../../api/client');
    const mockApi = vi.mocked(api);

    let requestSignal: AbortSignal | undefined;
    mockApi.upload.mockImplementationOnce(async (_path, _body, options) => {
      requestSignal = options?.signal;
      return new Promise(() => {});
    });

    const { result } = renderHook(() =>
      useDiffPreview({
        file: mockFile,
        uploadType: 'dead_stock',
        previewHeaderRowIndex: 0,
        resolveSubmittedMapping: mockResolveSubmittedMapping,
      }),
    );

    act(() => {
      result.current.setApplyMode('diff');
      result.current.setDeleteMissing(true);
    });

    act(() => {
      void result.current.handleDiffPreview();
    });

    act(() => {
      result.current.resetDiffPreviewState();
    });

    expect(requestSignal?.aborted).toBe(true);
    expect(result.current.loading).toBe(false);
  });

  it('computes requiresDiffPreviewRefresh correctly', () => {
    const { result } = renderHook(() =>
      useDiffPreview({
        file: mockFile,
        uploadType: 'dead_stock',
        previewHeaderRowIndex: 0,
        resolveSubmittedMapping: mockResolveSubmittedMapping,
      }),
    );

    // Default: replace mode, no refresh needed
    expect(result.current.requiresDiffPreviewRefresh).toBe(false);

    act(() => {
      result.current.setApplyMode('diff');
    });

    // Diff mode but deleteMissing false
    expect(result.current.requiresDiffPreviewRefresh).toBe(false);

    act(() => {
      result.current.setDeleteMissing(true);
    });

    // Diff mode + deleteMissing = refresh needed
    expect(result.current.requiresDiffPreviewRefresh).toBe(true);
  });

  it('computes requiresDeleteImpactAcknowledgement correctly', async () => {
    const { api } = await import('../../api/client');
    const mockApi = vi.mocked(api);
    mockApi.upload.mockResolvedValue({
      summary: { inserted: 5, updated: 3, deactivated: 2, unchanged: 1, totalIncoming: 11 },
    });

    const { result } = renderHook(() =>
      useDiffPreview({
        file: mockFile,
        uploadType: 'dead_stock',
        previewHeaderRowIndex: 0,
        resolveSubmittedMapping: mockResolveSubmittedMapping,
      }),
    );

    act(() => {
      result.current.setApplyMode('diff');
      result.current.setDeleteMissing(true);
    });

    await act(async () => {
      await result.current.handleDiffPreview();
    });

    // Now diffSummary has deactivated > 0, and deleteMissing is true
    expect(result.current.diffSummary?.deactivated).toBe(2);
    expect(result.current.requiresDeleteImpactAcknowledgement).toBe(true);
  });

  it('does not fetch diff preview when file is null', async () => {
    const { api } = await import('../../api/client');
    const mockApi = vi.mocked(api);

    const { result } = renderHook(() =>
      useDiffPreview({
        file: null,
        uploadType: 'dead_stock',
        previewHeaderRowIndex: 0,
        resolveSubmittedMapping: mockResolveSubmittedMapping,
      }),
    );

    act(() => {
      result.current.setApplyMode('diff');
    });

    await act(async () => {
      await result.current.handleDiffPreview();
    });

    expect(mockApi.upload).not.toHaveBeenCalled();
  });

  it('does not fetch diff preview when applyMode is replace', async () => {
    const { api } = await import('../../api/client');
    const mockApi = vi.mocked(api);

    const { result } = renderHook(() =>
      useDiffPreview({
        file: mockFile,
        uploadType: 'dead_stock',
        previewHeaderRowIndex: 0,
        resolveSubmittedMapping: mockResolveSubmittedMapping,
      }),
    );

    // applyMode is 'replace' by default
    await act(async () => {
      await result.current.handleDiffPreview();
    });

    expect(mockApi.upload).not.toHaveBeenCalled();
  });
});
