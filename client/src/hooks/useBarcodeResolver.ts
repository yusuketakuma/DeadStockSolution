import { useCallback, useRef, useState } from 'react';
import { api } from '../api/client';

export type CameraCodeType = 'gs1' | 'yj' | 'unknown';
export type AppendOrUpdateRowResult = 'added' | 'updated' | 'duplicate';

export interface CameraResolveMatch {
  drugMasterId: number;
  drugMasterPackageId: number | null;
  drugName: string;
  yjCode: string | null;
  gs1Code: string | null;
  janCode: string | null;
  packageLabel: string | null;
  unit: string | null;
  yakkaUnitPrice: number | null;
}

export interface CameraResolveResponse {
  codeType: CameraCodeType;
  parsed: {
    gtin: string | null;
    yjCode: string | null;
    expirationDate: string | null;
    lotNumber: string | null;
  };
  match: CameraResolveMatch | null;
  warnings: string[];
}

export interface CameraManualCandidate {
  drugMasterId: number;
  drugMasterPackageId: number | null;
  drugName: string;
  yjCode: string | null;
  gs1Code: string | null;
  janCode: string | null;
  packageLabel: string | null;
  unit: string | null;
  yakkaUnitPrice: number | null;
}

interface CameraManualCandidateResponse {
  data: CameraManualCandidate[];
}

const MAX_CAMERA_CODE_INPUT_LENGTH = 500;
const MIN_MANUAL_CANDIDATE_SEARCH_LENGTH = 2;
export const MAX_MANUAL_CANDIDATE_SEARCH_LENGTH = 80;
const MAX_RESOLVE_CACHE_SIZE = 300;
const MAX_MANUAL_CANDIDATES_CACHE_SIZE = 300;
const AUTO_CANDIDATE_TERM_LIMIT = 3;

export function normalizeCodeInput(value: string): string {
  let sanitized = '';
  for (const char of value) {
    const code = char.charCodeAt(0);
    const isControl = code <= 0x1f || code === 0x7f;
    const isGsSeparator = code === 0x1d;
    if (isControl && !isGsSeparator) {
      continue;
    }
    sanitized += char;
  }

  return sanitized.trim().slice(0, MAX_CAMERA_CODE_INPUT_LENGTH);
}

export function normalizeManualCandidateKeyword(value: string): string {
  return value.trim();
}

export function getManualCandidateKeywordValidationError(keyword: string): string | null {
  if (!keyword) {
    return '検索キーワードを入力してください';
  }
  if (keyword.length < MIN_MANUAL_CANDIDATE_SEARCH_LENGTH) {
    return `検索キーワードは${MIN_MANUAL_CANDIDATE_SEARCH_LENGTH}文字以上で入力してください`;
  }
  if (keyword.length > MAX_MANUAL_CANDIDATE_SEARCH_LENGTH) {
    return `検索キーワードは${MAX_MANUAL_CANDIDATE_SEARCH_LENGTH}文字以内で入力してください`;
  }
  return null;
}

function setCacheValueWithLimit<K, V>(cache: Map<K, V>, key: K, value: V, maxSize: number): void {
  cache.set(key, value);
  if (cache.size <= maxSize) {
    return;
  }
  const oldestKey = cache.keys().next().value;
  if (oldestKey !== undefined) {
    cache.delete(oldestKey);
  }
}

export function resolveCandidateKey(candidate: CameraManualCandidate): string {
  return `${candidate.drugMasterId}:${candidate.drugMasterPackageId ?? 'none'}`;
}

function mergeCandidateLists(candidates: CameraManualCandidate[]): CameraManualCandidate[] {
  const uniqueByKey = new Map<string, CameraManualCandidate>();
  for (const candidate of candidates) {
    const key = resolveCandidateKey(candidate);
    if (!uniqueByKey.has(key)) {
      uniqueByKey.set(key, candidate);
    }
  }
  return [...uniqueByKey.values()];
}

function resolveAutoCandidateSearchTerms(rawCode: string, resolved: CameraResolveResponse): string[] {
  const terms = [
    resolved.parsed.yjCode,
    resolved.parsed.gtin,
    resolved.match?.yjCode,
    resolved.match?.gs1Code,
    rawCode,
  ]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.trim())
    .filter((value) => value.length >= MIN_MANUAL_CANDIDATE_SEARCH_LENGTH
      && value.length <= MAX_MANUAL_CANDIDATE_SEARCH_LENGTH);

  return [...new Set(terms)].slice(0, AUTO_CANDIDATE_TERM_LIMIT);
}

function resolveCandidateGuidanceMessage(rawCode: string, candidateCount: number): string {
  if (candidateCount > 0) {
    return `コード ${rawCode} を読取しました。候補 ${candidateCount} 件から医薬品を確定してください。`;
  }
  return `コード ${rawCode} を読取しました。候補が見つからないため、薬剤名またはYJコードで検索してください。`;
}

function resolveErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function resolveManualCandidatesEndpoint(keyword: string): string {
  return `/inventory/dead-stock/camera/manual-candidates?q=${encodeURIComponent(keyword)}`;
}

interface UseBarcodeResolverOptions {
  appendOrUpdateRow: (
    rawCode: string,
    resolved: CameraResolveResponse,
    candidateOptions: CameraManualCandidate[],
    rowId?: number,
  ) => AppendOrUpdateRowResult;
  onError: (message: string) => void;
  onInfo: (message: string) => void;
}

export function useBarcodeResolver({
  appendOrUpdateRow,
  onError,
  onInfo,
}: UseBarcodeResolverOptions) {
  const [resolving, setResolving] = useState(false);
  const resolvingRef = useRef(false);
  const resolveCacheRef = useRef(new Map<string, CameraResolveResponse>());
  const manualCandidatesCacheRef = useRef(new Map<string, CameraManualCandidate[]>());

  const resolveCode = useCallback(async (
    rawCode: string,
    forceRefresh = false,
  ): Promise<CameraResolveResponse> => {
    if (!forceRefresh) {
      const cached = resolveCacheRef.current.get(rawCode);
      if (cached) {
        return cached;
      }
    }

    const resolved = await api.post<CameraResolveResponse>('/inventory/dead-stock/camera/resolve', {
      rawCode,
    });
    setCacheValueWithLimit(resolveCacheRef.current, rawCode, resolved, MAX_RESOLVE_CACHE_SIZE);
    return resolved;
  }, []);

  const fetchManualCandidatesByKeyword = useCallback(async (keyword: string): Promise<CameraManualCandidate[]> => {
    const normalizedKeyword = normalizeManualCandidateKeyword(keyword);
    if (getManualCandidateKeywordValidationError(normalizedKeyword)) {
      return [];
    }

    const cacheKey = normalizedKeyword.toUpperCase();
    const cached = manualCandidatesCacheRef.current.get(cacheKey);
    if (cached) {
      return cached;
    }

    const result = await api.get<CameraManualCandidateResponse>(
      resolveManualCandidatesEndpoint(normalizedKeyword),
    );
    setCacheValueWithLimit(
      manualCandidatesCacheRef.current,
      cacheKey,
      result.data,
      MAX_MANUAL_CANDIDATES_CACHE_SIZE,
    );
    return result.data;
  }, []);

  const resolveAutoCandidatesForCode = useCallback(async (
    rawCode: string,
    resolved: CameraResolveResponse,
  ): Promise<CameraManualCandidate[]> => {
    const seededCandidates = resolved.match ? [resolved.match] : [];
    const terms = resolveAutoCandidateSearchTerms(rawCode, resolved);
    if (terms.length === 0) {
      return seededCandidates;
    }

    const fetched = await Promise.all(terms.map(async (term) => {
      try {
        return await fetchManualCandidatesByKeyword(term);
      } catch {
        return [] as CameraManualCandidate[];
      }
    }));

    return mergeCandidateLists([...seededCandidates, ...fetched.flat()]);
  }, [fetchManualCandidatesByKeyword]);

  const handleResolveCode = useCallback(async (
    inputCode: string,
    rowId?: number,
    forceRefresh = false,
  ): Promise<AppendOrUpdateRowResult | null> => {
    const normalized = normalizeCodeInput(inputCode);
    if (!normalized) {
      onError('コードを入力してください');
      return null;
    }

    if (resolvingRef.current) return null;

    resolvingRef.current = true;
    setResolving(true);
    onError('');
    onInfo('');

    try {
      const resolved = await resolveCode(normalized, forceRefresh);
      const candidateOptions = await resolveAutoCandidatesForCode(normalized, resolved);
      const rowMutationResult = appendOrUpdateRow(normalized, resolved, candidateOptions, rowId);
      if (rowMutationResult === 'duplicate') {
        return rowMutationResult;
      }
      onInfo(resolveCandidateGuidanceMessage(normalized, candidateOptions.length));
      return rowMutationResult;
    } catch (err) {
      onError(resolveErrorMessage(err, 'コード解析に失敗しました'));
      return null;
    } finally {
      resolvingRef.current = false;
      setResolving(false);
    }
  }, [appendOrUpdateRow, onError, onInfo, resolveAutoCandidatesForCode, resolveCode]);

  return {
    resolving,
    handleResolveCode,
    fetchManualCandidatesByKeyword,
  };
}
