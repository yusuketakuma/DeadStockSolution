import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useUploadPreview } from '../../hooks/useUploadPreview';
import { api } from '../../api/client';

vi.mock('../../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/client')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      upload: vi.fn(),
    },
  };
});

const mockApi = vi.mocked(api);

describe('useUploadPreview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('treats duplicate suggested columns as incomplete until the user fixes them', async () => {
    mockApi.upload.mockResolvedValue({
      headers: ['コード候補', '薬剤名', '数量', '単位', '期限', '薬価'],
      rows: [['A001', '薬A', '10', '錠', '2026-03-31', '100']],
      suggestedMapping: {
        drug_code: '1',
        drug_name: '1',
        quantity: '2',
        unit: '3',
        yakka_unit_price: '5',
        expiration_date: '4',
        lot_number: null,
      },
      suggestedMappingByType: {
        dead_stock: null,
        used_medication: {
          drug_code: '0',
          drug_name: '1',
          monthly_usage: '2',
          unit: '3',
          yakka_unit_price: null,
        },
      },
      headerRowIndex: 0,
      hasSavedMapping: false,
      detectedUploadType: 'dead_stock',
      resolvedUploadType: 'dead_stock',
      rememberedUploadType: null,
      uploadTypeConfidence: 'medium',
      uploadTypeScores: {
        dead_stock: 18,
        used_medication: 7,
      },
      mappingComplete: false,
      missingRequiredFields: [],
      fieldHints: {},
    });

    const { result } = renderHook(() => useUploadPreview());

    await act(async () => {
      await result.current.handlePreview(
        new File(['dummy'], 'preview.xlsx', {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
      );
    });

    expect(result.current.mappingComplete).toBe(false);
    expect(result.current.duplicateAssignedFields.sort()).toEqual(['drug_code', 'drug_name']);
    expect(result.current.resolveSubmittedMapping('dead_stock')).toBeNull();

    await act(async () => {
      result.current.handleMappingChange('drug_code', '0');
    });

    expect(result.current.mappingComplete).toBe(true);
    expect(result.current.duplicateAssignedFields).toEqual([]);
    expect(result.current.resolveSubmittedMapping('dead_stock')).toEqual(expect.objectContaining({
      drug_code: '0',
      drug_name: '1',
      quantity: '2',
      yakka_unit_price: '5',
    }));
  });

  it('registers an external abort listener that forwards abort to the internal controller', async () => {
    mockApi.upload.mockImplementation((_path, _body, options) => {
      return new Promise((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        }, { once: true });
      });
    });

    const { result } = renderHook(() => useUploadPreview());
    const externalController = new AbortController();
    const addSpy = vi.spyOn(externalController.signal, 'addEventListener');
    const removeSpy = vi.spyOn(externalController.signal, 'removeEventListener');

    let previewResult: Promise<unknown>;
    await act(async () => {
      previewResult = result.current.handlePreview(
        new File(['a,b'], 'preview.csv', { type: 'text/csv' }),
        externalController.signal,
      );
    });

    // The hook registers an abort listener on the external signal to forward
    // cancellation to the internal AbortController (fire-and-forget style).
    expect(addSpy).toHaveBeenCalledWith('abort', expect.any(Function), { once: true });

    externalController.abort();

    await act(async () => {
      await previewResult!;
    });

    expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(result.current.preview).toBeNull();
    expect(result.current.loading).toBe(false);
  });
});
