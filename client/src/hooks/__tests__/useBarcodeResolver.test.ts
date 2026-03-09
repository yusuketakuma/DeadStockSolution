import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api/client';
import { useBarcodeResolver, type CameraManualCandidate, type CameraResolveResponse } from '../useBarcodeResolver';

vi.mock('../../api/client', () => ({
  api: {
    post: vi.fn(),
    get: vi.fn(),
  },
}));

const mockedApi = vi.mocked(api, true);

describe('useBarcodeResolver', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves code and appends row with fetched candidates', async () => {
    const resolved: CameraResolveResponse = {
      codeType: 'gs1',
      parsed: {
        gtin: '01234567890123',
        yjCode: null,
        expirationDate: '2030-12-31',
        lotNumber: 'LOT-1',
      },
      match: null,
      warnings: [],
    };

    const candidates: CameraManualCandidate[] = [{
      drugMasterId: 1,
      drugMasterPackageId: 2,
      drugName: 'テスト薬',
      yjCode: '1234567A0000',
      gs1Code: null,
      janCode: null,
      packageLabel: '10錠',
      unit: '錠',
      yakkaUnitPrice: 12.3,
    }];

    mockedApi.post.mockResolvedValue(resolved);
    mockedApi.get.mockResolvedValue({ data: candidates });

    const appendOrUpdateRow = vi.fn().mockReturnValue('added');
    const onError = vi.fn();
    const onInfo = vi.fn();

    const { result } = renderHook(() => useBarcodeResolver({
      appendOrUpdateRow,
      onError,
      onInfo,
    }));

    await act(async () => {
      await result.current.handleResolveCode(' (01)01234567890123 ');
    });

    expect(appendOrUpdateRow).toHaveBeenCalledTimes(1);
    expect(appendOrUpdateRow).toHaveBeenCalledWith(
      '(01)01234567890123',
      resolved,
      candidates,
      undefined,
    );
    expect(onInfo).toHaveBeenCalledTimes(2);
    expect(onInfo).toHaveBeenNthCalledWith(1, '');
    expect(onInfo).toHaveBeenNthCalledWith(
      2,
      'コード (01)01234567890123 を読取しました。候補 1 件から医薬品を確定してください。',
    );
    expect(onError).toHaveBeenCalledWith('');
  });

  it('returns duplicate without setting guidance info', async () => {
    const resolved: CameraResolveResponse = {
      codeType: 'unknown',
      parsed: {
        gtin: null,
        yjCode: null,
        expirationDate: null,
        lotNumber: null,
      },
      match: null,
      warnings: [],
    };

    mockedApi.post.mockResolvedValue(resolved);
    mockedApi.get.mockResolvedValue({ data: [] as CameraManualCandidate[] });

    const appendOrUpdateRow = vi.fn().mockReturnValue('duplicate');
    const onError = vi.fn();
    const onInfo = vi.fn();

    const { result } = renderHook(() => useBarcodeResolver({
      appendOrUpdateRow,
      onError,
      onInfo,
    }));

    await act(async () => {
      const output = await result.current.handleResolveCode('ABC-001');
      expect(output).toBe('duplicate');
    });

    expect(onInfo).toHaveBeenCalledWith('');
    expect(onInfo).toHaveBeenCalledTimes(1);
  });
});
