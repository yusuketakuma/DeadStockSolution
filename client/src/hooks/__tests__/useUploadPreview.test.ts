import { renderHook, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useUploadPreview, resolveSubmittedMapping, resolveConfidenceLabel } from '../useUploadPreview';
import type { UploadType } from '../../pages/upload/upload-job-utils';
import * as api from '../../api/client';

// Mock the API client
vi.mock('../../api/client', () => ({
  api: {
    upload: vi.fn(),
  },
}));

const createMockPreviewResponse = (
  overrides: Partial<ReturnType<typeof useUploadPreview>['preview']> = {},
): NonNullable<ReturnType<typeof useUploadPreview>['preview']> => ({
  headers: ['薬品名', '在庫数'],
  rows: [['薬品A', '10']],
  suggestedMapping: { name: '薬品名', quantity: '在庫数' },
  suggestedMappingByType: {
    dead_stock: { name: '薬品名', quantity: '在庫数' },
    used_medication: null,
  },
  headerRowIndex: 0,
  hasSavedMapping: false,
  detectedUploadType: 'dead_stock',
  resolvedUploadType: 'dead_stock',
  rememberedUploadType: null,
  uploadTypeConfidence: 'high',
  uploadTypeScores: { dead_stock: 0.9, used_medication: 0.1 },
  ...overrides,
});

describe('useUploadPreview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('resolveConfidenceLabel', () => {
    it('returns "高" for high confidence', () => {
      expect(resolveConfidenceLabel('high')).toBe('高');
    });

    it('returns "中" for medium confidence', () => {
      expect(resolveConfidenceLabel('medium')).toBe('中');
    });

    it('returns "低" for low confidence', () => {
      expect(resolveConfidenceLabel('low')).toBe('低');
    });
  });

  describe('resolveSubmittedMapping', () => {
    it('returns null when preview is null', () => {
      expect(resolveSubmittedMapping(null, 'dead_stock')).toBeNull();
    });

    it('returns type-specific mapping when available', () => {
      const preview = createMockPreviewResponse();
      const result = resolveSubmittedMapping(preview, 'dead_stock');
      expect(result).toEqual({ name: '薬品名', quantity: '在庫数' });
    });

    it('returns suggested mapping when selected type matches resolved type', () => {
      const preview = createMockPreviewResponse({
        suggestedMappingByType: {
          dead_stock: null,
          used_medication: null,
        },
      });
      const result = resolveSubmittedMapping(preview, 'dead_stock');
      expect(result).toEqual({ name: '薬品名', quantity: '在庫数' });
    });

    it('returns null when no mapping available for selected type', () => {
      const preview = createMockPreviewResponse({
        resolvedUploadType: 'dead_stock',
        suggestedMappingByType: {
          dead_stock: null,
          used_medication: null,
        },
      });
      const result = resolveSubmittedMapping(preview, 'used_medication' as UploadType);
      expect(result).toBeNull();
    });
  });

  describe('handlePreview', () => {
    it('fetches preview data successfully', async () => {
      const mockData = createMockPreviewResponse();
      vi.mocked(api.api.upload).mockResolvedValueOnce(mockData);

      const { result } = renderHook(() => useUploadPreview());

      let previewResult: typeof mockData | null = null;
      await act(async () => {
        previewResult = await result.current.handlePreview(new File([''], 'test.xlsx'));
      });

      expect(api.api.upload).toHaveBeenCalledWith(
        '/upload/preview',
        expect.any(FormData),
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
      expect(result.current.preview).toEqual(mockData);
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBe('');
      expect(previewResult).toEqual(mockData);
    });

    it('sets error on API failure', async () => {
      vi.mocked(api.api.upload).mockRejectedValueOnce(new Error('Network error'));

      const { result } = renderHook(() => useUploadPreview());

      await act(async () => {
        await result.current.handlePreview(new File([''], 'test.xlsx'));
      });

      expect(result.current.error).toBe('Network error');
      expect(result.current.preview).toBeNull();
    });

    it('aborts previous request on new call', async () => {
      const mockData = createMockPreviewResponse();
      vi.mocked(api.api.upload).mockResolvedValue(mockData);

      const { result } = renderHook(() => useUploadPreview());

      // Start two preview requests rapidly
      await act(async () => {
        const promise1 = result.current.handlePreview(new File(['1'], 'test1.xlsx'));
        const promise2 = result.current.handlePreview(new File(['2'], 'test2.xlsx'));
        await Promise.all([promise1, promise2]);
      });

      // Should have called API twice
      expect(api.api.upload).toHaveBeenCalledTimes(2);
    });
  });

  describe('reset', () => {
    it('clears preview state', async () => {
      const mockData = createMockPreviewResponse();
      vi.mocked(api.api.upload).mockResolvedValueOnce(mockData);

      const { result } = renderHook(() => useUploadPreview());

      await act(async () => {
        await result.current.handlePreview(new File([''], 'test.xlsx'));
      });

      expect(result.current.preview).not.toBeNull();

      act(() => {
        result.current.reset();
      });

      expect(result.current.preview).toBeNull();
      expect(result.current.error).toBe('');
    });
  });

  describe('onPreviewSuccess callback', () => {
    it('calls callback on successful preview', async () => {
      const mockData = createMockPreviewResponse();
      vi.mocked(api.api.upload).mockResolvedValueOnce(mockData);
      const onSuccess = vi.fn();

      const { result } = renderHook(() => useUploadPreview({ onPreviewSuccess: onSuccess }));

      await act(async () => {
        await result.current.handlePreview(new File([''], 'test.xlsx'));
      });

      expect(onSuccess).toHaveBeenCalledWith(mockData);
    });
  });
});
