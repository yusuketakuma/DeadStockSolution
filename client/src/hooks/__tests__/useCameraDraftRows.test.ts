import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  useCameraDraftRows,
} from '../useCameraDraftRows';
import type {
  CameraManualCandidate,
  CameraResolveResponse,
} from '../useBarcodeResolver';

function buildResolved(overrides?: Partial<CameraResolveResponse>): CameraResolveResponse {
  return {
    codeType: 'gs1',
    parsed: {
      gtin: '04912345678904',
      yjCode: null,
      expirationDate: '2031-12-31',
      lotNumber: 'LOT-1',
    },
    match: {
      drugMasterId: 10,
      drugMasterPackageId: 20,
      drugName: 'テスト薬',
      yjCode: '2171014F1020',
      gs1Code: '04912345678904',
      janCode: '4912345678904',
      packageLabel: '100錠',
      unit: '錠',
      yakkaUnitPrice: 12.3,
    },
    warnings: [],
    ...overrides,
  };
}

function buildCandidate(overrides?: Partial<CameraManualCandidate>): CameraManualCandidate {
  return {
    drugMasterId: 10,
    drugMasterPackageId: 20,
    drugName: 'テスト薬',
    yjCode: '2171014F1020',
    gs1Code: '04912345678904',
    janCode: '4912345678904',
    packageLabel: '100錠',
    unit: '錠',
    yakkaUnitPrice: 12.3,
    ...overrides,
  };
}

describe('useCameraDraftRows', () => {
  it('adds row and suppresses duplicates', () => {
    const onInfo = vi.fn();
    const onError = vi.fn();
    const resolved = buildResolved();
    const candidates = [buildCandidate()];

    const { result } = renderHook(() => useCameraDraftRows({ onInfo, onError }));

    act(() => {
      const output = result.current.appendOrUpdateRow('CODE-001', resolved, candidates);
      expect(output).toBe('added');
    });

    expect(result.current.rows).toHaveLength(1);
    expect(result.current.rows[0]).toEqual(expect.objectContaining({
      rawCode: 'CODE-001',
      status: 'unmatched',
      packageLabel: '100錠',
      candidateOptions: candidates,
    }));

    act(() => {
      const output = result.current.appendOrUpdateRow('CODE-001', resolved, candidates);
      expect(output).toBe('duplicate');
    });

    expect(result.current.rows).toHaveLength(1);
    expect(onInfo).toHaveBeenCalledWith('同じコードは既に追加済みです: CODE-001');
  });

  it('can resolve row manually and become submittable when quantity is positive', () => {
    const onInfo = vi.fn();
    const onError = vi.fn();
    const resolved = buildResolved({ match: null });
    const candidate = buildCandidate({ drugMasterId: 99, drugMasterPackageId: 199, drugName: '手動薬' });

    const { result } = renderHook(() => useCameraDraftRows({ onInfo, onError }));

    act(() => {
      result.current.appendOrUpdateRow('MANUAL-001', resolved, [candidate]);
    });

    const rowId = result.current.rows[0].id;

    act(() => {
      result.current.handleApplyManualCandidate(rowId, candidate);
      result.current.updateRowField(rowId, 'quantity', '3');
    });

    expect(result.current.rows[0]).toEqual(expect.objectContaining({
      status: 'resolved',
      drugMasterId: 99,
      drugMasterPackageId: 199,
      drugName: '手動薬',
      unit: '錠',
      quantity: '3',
    }));
    expect(result.current.canSubmit).toBe(true);
    expect(onError).toHaveBeenCalledWith('');
    expect(onInfo).toHaveBeenCalledWith('手動で医薬品を確定しました: 手動薬');
  });

  it('resets resolution fields on raw code edit but preserves quantity', () => {
    const onInfo = vi.fn();
    const onError = vi.fn();
    const resolved = buildResolved();
    const candidate = buildCandidate();

    const { result } = renderHook(() => useCameraDraftRows({ onInfo, onError }));

    act(() => {
      result.current.appendOrUpdateRow('CODE-EDIT-001', resolved, [candidate]);
    });

    const rowId = result.current.rows[0].id;

    act(() => {
      result.current.handleApplyManualCandidate(rowId, candidate);
      result.current.updateRowField(rowId, 'quantity', '5');
      result.current.handleRowRawCodeChange(rowId, `\u0000${'A'.repeat(120)}`);
    });

    const row = result.current.rows[0];
    expect(row.status).toBe('unmatched');
    expect(row.drugMasterId).toBeNull();
    expect(row.drugMasterPackageId).toBeNull();
    expect(row.drugName).toBe('');
    expect(row.packageLabel).toBe('');
    expect(row.expirationDate).toBe('');
    expect(row.lotNumber).toBe('');
    expect(row.unit).toBe('');
    expect(row.warnings).toEqual([]);
    expect(row.candidateOptions).toEqual([]);
    expect(row.quantity).toBe('5');
    expect(row.rawCode).toBe('A'.repeat(120));
    expect(row.candidateSearchKeyword).toHaveLength(80);
  });

  it('updates existing row while preserving quantity', () => {
    const onInfo = vi.fn();
    const onError = vi.fn();
    const firstResolved = buildResolved({
      parsed: {
        gtin: '111',
        yjCode: null,
        expirationDate: '2030-01-01',
        lotNumber: 'LOT-A',
      },
      warnings: ['first'],
    });
    const secondResolved = buildResolved({
      parsed: {
        gtin: '222',
        yjCode: null,
        expirationDate: '2035-12-31',
        lotNumber: 'LOT-B',
      },
      warnings: ['second'],
    });

    const { result } = renderHook(() => useCameraDraftRows({ onInfo, onError }));

    act(() => {
      result.current.appendOrUpdateRow('CODE-OLD', firstResolved, [buildCandidate()]);
    });
    const rowId = result.current.rows[0].id;

    act(() => {
      result.current.updateRowField(rowId, 'quantity', '7');
      const output = result.current.appendOrUpdateRow('CODE-NEW', secondResolved, [], rowId);
      expect(output).toBe('updated');
    });

    expect(result.current.rows[0]).toEqual(expect.objectContaining({
      rawCode: 'CODE-NEW',
      quantity: '7',
      expirationDate: '2035-12-31',
      lotNumber: 'LOT-B',
      warnings: ['second'],
    }));
  });
});
