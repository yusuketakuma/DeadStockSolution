import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MAX_MANUAL_CANDIDATE_SEARCH_LENGTH,
  normalizeCodeInput,
  type AppendOrUpdateRowResult,
  type CameraManualCandidate,
  type CameraResolveResponse,
} from './useBarcodeResolver';

export type DraftStatus = 'resolved' | 'unmatched';

export interface DraftRow {
  id: number;
  rawCode: string;
  status: DraftStatus;
  drugMasterId: number | null;
  drugMasterPackageId: number | null;
  drugName: string;
  packageLabel: string;
  expirationDate: string;
  lotNumber: string;
  quantity: string;
  unit: string;
  warnings: string[];
  candidateOptions: CameraManualCandidate[];
  candidateSearchKeyword: string;
}

export type EditableDraftField = 'packageLabel' | 'expirationDate' | 'lotNumber' | 'quantity';

const MANUAL_FIXED_WARNING = '手動で医薬品候補を確定しました。';

function resolveAutoCandidateSearchKeyword(rawCode: string, resolved: CameraResolveResponse): string {
  const candidate = resolved.parsed.yjCode
    ?? resolved.parsed.gtin
    ?? resolved.match?.yjCode
    ?? resolved.match?.gs1Code
    ?? rawCode;
  return candidate.slice(0, MAX_MANUAL_CANDIDATE_SEARCH_LENGTH);
}

function toDraftRow(
  id: number,
  rawCode: string,
  resolved: CameraResolveResponse,
  candidateOptions: CameraManualCandidate[],
): DraftRow {
  return {
    id,
    rawCode,
    status: 'unmatched',
    drugMasterId: null,
    drugMasterPackageId: null,
    drugName: '',
    packageLabel: resolved.match?.packageLabel ?? '',
    expirationDate: resolved.parsed.expirationDate ?? '',
    lotNumber: resolved.parsed.lotNumber ?? '',
    quantity: '',
    unit: '',
    warnings: resolved.warnings,
    candidateOptions,
    candidateSearchKeyword: resolveAutoCandidateSearchKeyword(rawCode, resolved),
  };
}

function isPositiveQuantity(value: string): boolean {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0;
}

interface UseCameraDraftRowsOptions {
  onInfo: (message: string) => void;
  onError: (message: string) => void;
}

export function useCameraDraftRows({ onInfo, onError }: UseCameraDraftRowsOptions) {
  const [rows, setRows] = useState<DraftRow[]>([]);
  const nextRowIdRef = useRef(1);
  const rowsRef = useRef<DraftRow[]>([]);

  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  const canSubmit = useMemo(() => (
    rows.length > 0
    && rows.every((row) => (
      row.status === 'resolved'
      && row.drugMasterId !== null
      && normalizeCodeInput(row.rawCode).length > 0
      && isPositiveQuantity(row.quantity)
    ))
  ), [rows]);

  const updateRow = useCallback((rowId: number, updater: (row: DraftRow) => DraftRow) => {
    setRows((prev) => {
      const next = prev.map((row) => (row.id === rowId ? updater(row) : row));
      rowsRef.current = next;
      return next;
    });
  }, []);

  const updateRowField = useCallback(<K extends EditableDraftField>(
    rowId: number,
    field: K,
    value: DraftRow[K],
  ) => {
    updateRow(rowId, (row) => ({ ...row, [field]: value }));
  }, [updateRow]);

  const appendOrUpdateRow = useCallback((
    rawCode: string,
    resolved: CameraResolveResponse,
    candidateOptions: CameraManualCandidate[],
    rowId?: number,
  ): AppendOrUpdateRowResult => {
    if (rowId !== undefined) {
      updateRow(rowId, (row) => {
        const quantity = row.quantity;
        const merged = toDraftRow(row.id, rawCode, resolved, candidateOptions);
        return { ...merged, quantity };
      });
      return 'updated';
    }

    if (rowsRef.current.some((row) => row.rawCode === rawCode)) {
      onInfo(`同じコードは既に追加済みです: ${rawCode}`);
      return 'duplicate';
    }

    const nextId = nextRowIdRef.current;
    nextRowIdRef.current += 1;
    const nextRow = toDraftRow(nextId, rawCode, resolved, candidateOptions);
    setRows((prev) => {
      const next = [...prev, nextRow];
      rowsRef.current = next;
      return next;
    });
    return 'added';
  }, [onInfo, updateRow]);

  const handleApplyManualCandidate = useCallback((rowId: number, candidate: CameraManualCandidate) => {
    updateRow(rowId, (row) => {
      const warnings = row.warnings.includes(MANUAL_FIXED_WARNING)
        ? row.warnings
        : [...row.warnings, MANUAL_FIXED_WARNING];
      return {
        ...row,
        status: 'resolved',
        drugMasterId: candidate.drugMasterId,
        drugMasterPackageId: candidate.drugMasterPackageId,
        drugName: candidate.drugName,
        packageLabel: row.packageLabel || candidate.packageLabel || '',
        unit: candidate.unit ?? row.unit,
        warnings,
      };
    });
    onError('');
    onInfo(`手動で医薬品を確定しました: ${candidate.drugName}`);
  }, [onError, onInfo, updateRow]);

  const handleRowRawCodeChange = useCallback((rowId: number, value: string) => {
    const normalizedRawCode = normalizeCodeInput(value);
    updateRow(rowId, (current) => ({
      ...current,
      rawCode: normalizedRawCode,
      status: 'unmatched',
      drugMasterId: null,
      drugMasterPackageId: null,
      drugName: '',
      packageLabel: '',
      expirationDate: '',
      lotNumber: '',
      unit: '',
      warnings: [],
      candidateOptions: [],
      candidateSearchKeyword: normalizedRawCode
        .slice(0, MAX_MANUAL_CANDIDATE_SEARCH_LENGTH),
    }));
  }, [updateRow]);

  const removeRow = useCallback((rowId: number) => {
    setRows((prev) => {
      const next = prev.filter((row) => row.id !== rowId);
      rowsRef.current = next;
      return next;
    });
  }, []);

  const clearRows = useCallback(() => {
    rowsRef.current = [];
    setRows([]);
  }, []);

  return {
    rows,
    canSubmit,
    appendOrUpdateRow,
    updateRowField,
    handleApplyManualCandidate,
    handleRowRawCodeChange,
    removeRow,
    clearRows,
  };
}
