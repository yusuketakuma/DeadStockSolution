import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { Badge, Form } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';
import { BarcodeFormat, DecodeHintType, NotFoundException } from '@zxing/library';
import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser';
import { api } from '../../api/client';
import AppAlert from '../../components/ui/AppAlert';
import AppButton from '../../components/ui/AppButton';
import AppCard from '../../components/ui/AppCard';
import AppControl from '../../components/ui/AppControl';
import LoadingButton from '../../components/ui/LoadingButton';

type CameraCodeType = 'gs1' | 'yj' | 'unknown';
type DraftStatus = 'resolved' | 'unmatched';

interface CameraResolveMatch {
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

interface CameraResolveResponse {
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

interface CameraConfirmBatchResponse {
  message: string;
  uploadId: number;
  createdCount: number;
}

interface CameraManualCandidate {
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

type AppendOrUpdateRowResult = 'added' | 'updated' | 'duplicate';

interface DraftRow {
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

type EditableDraftField = 'rawCode' | 'packageLabel' | 'expirationDate' | 'lotNumber' | 'quantity';

interface DetectedBarcodeLike {
  rawValue?: string;
}

interface BarcodeDetectorLike {
  detect: (image: HTMLCanvasElement) => Promise<DetectedBarcodeLike[]>;
}

interface BarcodeDetectorConstructorLike {
  new (options?: { formats?: string[] }): BarcodeDetectorLike;
}

const SCAN_DUPLICATE_SUPPRESS_MS = 1500;
const MAX_CAMERA_CODE_INPUT_LENGTH = 500;
const MAX_PACKAGE_LABEL_LENGTH = 120;
const MAX_LOT_NUMBER_LENGTH = 120;
const MIN_MANUAL_CANDIDATE_SEARCH_LENGTH = 2;
const MAX_MANUAL_CANDIDATE_SEARCH_LENGTH = 80;
const QUANTITY_STEP = '0.001';
const MAX_RESOLVE_CACHE_SIZE = 300;
const MAX_MANUAL_CANDIDATES_CACHE_SIZE = 300;
const CAMERA_ERROR_UPDATE_MIN_INTERVAL_MS = 1200;
const AUTO_CANDIDATE_TERM_LIMIT = 3;
const MANUAL_FIXED_WARNING = '手動で医薬品候補を確定しました。';

const BARCODE_DETECTOR_FORMATS = [
  'data_matrix',
  'code_128',
  'ean_13',
  'ean_8',
  'itf',
  'upc_a',
  'upc_e',
  'qr_code',
];

const CAMERA_CONSTRAINTS_PREFERRED: MediaStreamConstraints = {
  audio: false,
  video: {
    facingMode: { ideal: 'environment' },
    width: { ideal: 1280, max: 1920 },
    height: { ideal: 720, max: 1080 },
    frameRate: { ideal: 24, max: 30 },
  },
};

const CAMERA_CONSTRAINTS_FALLBACK: MediaStreamConstraints = {
  audio: false,
  video: {
    facingMode: { ideal: 'environment' },
  },
};

const POSSIBLE_FORMATS = [
  BarcodeFormat.DATA_MATRIX,
  BarcodeFormat.CODE_128,
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.ITF,
  BarcodeFormat.RSS_14,
  BarcodeFormat.RSS_EXPANDED,
  BarcodeFormat.QR_CODE,
];

function createReader(): BrowserMultiFormatReader {
  const hints = new Map<DecodeHintType, unknown>();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, POSSIBLE_FORMATS);
  return new BrowserMultiFormatReader(hints, {
    delayBetweenScanAttempts: 180,
    delayBetweenScanSuccess: 600,
  });
}

function resolveCandidateKey(candidate: CameraManualCandidate): string {
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

function getBarcodeDetectorConstructor(): BarcodeDetectorConstructorLike | null {
  const maybe = (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector;
  return typeof maybe === 'function' ? maybe as BarcodeDetectorConstructorLike : null;
}

function resolveAutoCandidateSearchKeyword(rawCode: string, resolved: CameraResolveResponse): string {
  const candidate = resolved.parsed.yjCode
    ?? resolved.parsed.gtin
    ?? resolved.match?.yjCode
    ?? resolved.match?.gs1Code
    ?? rawCode;
  return candidate.slice(0, MAX_MANUAL_CANDIDATE_SEARCH_LENGTH);
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

function normalizeCodeInput(value: string): string {
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

function normalizeManualCandidateKeyword(value: string): string {
  return value.trim();
}

function getManualCandidateKeywordValidationError(keyword: string): string | null {
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

function resolveCaptureResultInfo(addedCount: number): string {
  return `画像内コードを ${addedCount} 件追加しました。候補を確認して医薬品を確定してください。`;
}

function resolveCameraStartErrorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === 'NotAllowedError') {
    return 'カメラ権限が拒否されました。ブラウザ設定から許可してください';
  }
  if (error instanceof DOMException && error.name === 'NotFoundError') {
    return '利用可能なカメラが見つかりません';
  }
  return error instanceof Error ? error.message : 'カメラ起動に失敗しました';
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

function isPositiveQuantity(value: string): boolean {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0;
}

function isOverconstrainedError(error: unknown): boolean {
  if (error instanceof DOMException) {
    return error.name === 'OverconstrainedError';
  }
  if (typeof error === 'object' && error !== null && 'name' in error) {
    const { name } = error as { name?: unknown };
    return name === 'OverconstrainedError';
  }
  return false;
}

interface UnmatchedManualResolverProps {
  rowId: number;
  disabled: boolean;
  initialCandidates: CameraManualCandidate[];
  initialSearchKeyword: string;
  onSearchCandidates: (keyword: string) => Promise<CameraManualCandidate[]>;
  onApplyCandidate: (rowId: number, candidate: CameraManualCandidate) => void;
}

function resolveErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function resolveManualCandidatesEndpoint(keyword: string): string {
  return `/inventory/dead-stock/camera/manual-candidates?q=${encodeURIComponent(keyword)}`;
}

function resolveCandidateGuidanceMessage(rawCode: string, candidateCount: number): string {
  if (candidateCount > 0) {
    return `コード ${rawCode} を読取しました。候補 ${candidateCount} 件から医薬品を確定してください。`;
  }
  return `コード ${rawCode} を読取しました。候補が見つからないため、薬剤名またはYJコードで検索してください。`;
}

function UnmatchedManualResolver({
  rowId,
  disabled,
  initialCandidates,
  initialSearchKeyword,
  onSearchCandidates,
  onApplyCandidate,
}: UnmatchedManualResolverProps) {
  const [searchKeyword, setSearchKeyword] = useState(initialSearchKeyword);
  const [candidates, setCandidates] = useState<CameraManualCandidate[]>(initialCandidates);
  const [selectedCandidateKey, setSelectedCandidateKey] = useState(
    initialCandidates[0] ? resolveCandidateKey(initialCandidates[0]) : '',
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const searchRequestIdRef = useRef(0);

  useEffect(() => {
    setCandidates(initialCandidates);
    setSelectedCandidateKey(initialCandidates[0] ? resolveCandidateKey(initialCandidates[0]) : '');
  }, [initialCandidates]);

  useEffect(() => {
    setSearchKeyword(initialSearchKeyword);
  }, [initialSearchKeyword]);

  const selectedCandidate = useMemo(() => (
    candidates.find((candidate) => resolveCandidateKey(candidate) === selectedCandidateKey) ?? null
  ), [candidates, selectedCandidateKey]);

  const handleSearch = async () => {
    const keyword = normalizeManualCandidateKeyword(searchKeyword);
    const validationError = getManualCandidateKeywordValidationError(keyword);
    if (validationError) {
      setError(validationError);
      return;
    }

    const requestId = searchRequestIdRef.current + 1;
    searchRequestIdRef.current = requestId;
    setLoading(true);
    setError('');
    try {
      const nextCandidates = await onSearchCandidates(keyword);
      if (searchRequestIdRef.current !== requestId) {
        return;
      }
      setCandidates((prev) => mergeCandidateLists([...prev, ...nextCandidates]));
      if (nextCandidates.length === 0) {
        setError('候補が見つかりませんでした。薬剤名やYJコードを変えて再検索してください。');
        return;
      }
      setSelectedCandidateKey(resolveCandidateKey(nextCandidates[0]));
    } catch (err) {
      if (searchRequestIdRef.current !== requestId) {
        return;
      }
      setError(resolveErrorMessage(err, '候補検索に失敗しました'));
    } finally {
      if (searchRequestIdRef.current === requestId) {
        setLoading(false);
      }
    }
  };

  return (
    <div className="small">
      <div className="d-flex gap-1 mb-1">
        <AppControl
          value={searchKeyword}
          onChange={(event: ChangeEvent<HTMLInputElement>) => setSearchKeyword(event.currentTarget.value)}
          onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void handleSearch();
            }
          }}
          aria-label="候補検索キーワード"
          maxLength={MAX_MANUAL_CANDIDATE_SEARCH_LENGTH}
          placeholder="薬剤名 or YJコードで検索"
        />
        <LoadingButton
          variant="outline-primary"
          size="sm"
          loading={loading}
          loadingLabel="検索中..."
          disabled={disabled}
          onClick={() => void handleSearch()}
        >
          候補検索
        </LoadingButton>
      </div>
      {candidates.length > 0 && (
        <div className="d-flex gap-1 align-items-center">
          <Form.Select
            size="sm"
            value={selectedCandidateKey}
            disabled={disabled}
            aria-label="候補医薬品"
            onChange={(event) => setSelectedCandidateKey(event.currentTarget.value)}
          >
            {candidates.map((candidate) => (
              <option key={resolveCandidateKey(candidate)} value={resolveCandidateKey(candidate)}>
                {candidate.drugName} ({candidate.yjCode ?? '-'})
              </option>
            ))}
          </Form.Select>
          <AppButton
            variant="outline-success"
            size="sm"
            disabled={disabled || selectedCandidate === null}
            onClick={() => {
              if (!selectedCandidate) return;
              onApplyCandidate(rowId, selectedCandidate);
            }}
          >
            確定
          </AppButton>
        </div>
      )}
      {error && <div className="text-danger mt-1">{error}</div>}
    </div>
  );
}

export default function CameraDeadStockRegisterPanel() {
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [manualCode, setManualCode] = useState('');
  const [info, setInfo] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [cameraBusy, setCameraBusy] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchEnabled, setTorchEnabled] = useState(false);
  const [torchBusy, setTorchBusy] = useState(false);
  const [frameCapturing, setFrameCapturing] = useState(false);

  const nextRowIdRef = useRef(1);
  const resolvingRef = useRef(false);
  const controlsRef = useRef<IScannerControls | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const frameCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const barcodeDetectorRef = useRef<BarcodeDetectorLike | null>(null);
  const lastScanRef = useRef<{ text: string; at: number }>({ text: '', at: 0 });
  const lastCameraErrorRef = useRef<{ message: string; at: number }>({ message: '', at: 0 });
  const resolveCacheRef = useRef(new Map<string, CameraResolveResponse>());
  const manualCandidatesCacheRef = useRef(new Map<string, CameraManualCandidate[]>());
  const pendingCameraCodesRef = useRef(new Set<string>());
  const cameraSessionRef = useRef(0);
  const navigate = useNavigate();
  const barcodeDetectorSupported = useMemo(() => getBarcodeDetectorConstructor() !== null, []);

  const canSubmit = useMemo(() => (
    rows.length > 0
    && rows.every((row) => (
      row.status === 'resolved'
      && row.drugMasterId !== null
      && normalizeCodeInput(row.rawCode).length > 0
      && isPositiveQuantity(row.quantity)
    ))
  ), [rows]);

  const setCameraErrorState = useCallback((message: string, throttled = false) => {
    if (!message) {
      lastCameraErrorRef.current = { message: '', at: 0 };
      setCameraError('');
      return;
    }

    if (!throttled) {
      lastCameraErrorRef.current = { message, at: Date.now() };
      setCameraError(message);
      return;
    }

    const now = Date.now();
    const last = lastCameraErrorRef.current;
    if (last.message === message && now - last.at < CAMERA_ERROR_UPDATE_MIN_INTERVAL_MS) {
      return;
    }
    lastCameraErrorRef.current = { message, at: now };
    setCameraError(message);
  }, []);

  const stopCamera = useCallback(() => {
    cameraSessionRef.current += 1;
    pendingCameraCodesRef.current.clear();
    controlsRef.current?.stop();
    controlsRef.current = null;
    const videoElement = videoRef.current;
    const stream = videoElement?.srcObject;
    if (videoElement && stream && typeof (stream as MediaStream).getTracks === 'function') {
      (stream as MediaStream).getTracks().forEach((track) => track.stop());
      videoElement.srcObject = null;
    }
    setTorchSupported(false);
    setTorchEnabled(false);
    setTorchBusy(false);
    setCameraActive(false);
  }, []);

  useEffect(() => () => {
    stopCamera();
  }, [stopCamera]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        stopCamera();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [stopCamera]);

  const updateRow = useCallback((rowId: number, updater: (row: DraftRow) => DraftRow) => {
    setRows((prev) => prev.map((row) => (row.id === rowId ? updater(row) : row)));
  }, []);

  const updateRowField = useCallback(<K extends EditableDraftField>(
    rowId: number,
    field: K,
    value: DraftRow[K],
  ) => {
    updateRow(rowId, (row) => ({ ...row, [field]: value }));
  }, [updateRow]);

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

    let result = 'added' as AppendOrUpdateRowResult;
    setRows((prev) => {
      if (prev.some((row) => row.rawCode === rawCode)) {
        result = 'duplicate';
        return prev;
      }
      const nextId = nextRowIdRef.current;
      nextRowIdRef.current += 1;
      return [...prev, toDraftRow(nextId, rawCode, resolved, candidateOptions)];
    });
    if (result === 'duplicate') {
      setInfo(`同じコードは既に追加済みです: ${rawCode}`);
    }
    return result;
  }, [updateRow]);

  const handleResolveCode = useCallback(async (
    inputCode: string,
    rowId?: number,
    forceRefresh = false,
  ): Promise<AppendOrUpdateRowResult | null> => {
    const normalized = normalizeCodeInput(inputCode);
    if (!normalized) {
      setError('コードを入力してください');
      return null;
    }

    if (resolvingRef.current) return null;

    resolvingRef.current = true;
    setResolving(true);
    setError('');
    setInfo('');
    try {
      const resolved = await resolveCode(normalized, forceRefresh);
      const candidateOptions = await resolveAutoCandidatesForCode(normalized, resolved);
      const rowMutationResult = appendOrUpdateRow(normalized, resolved, candidateOptions, rowId);
      if (rowMutationResult === 'duplicate') {
        return rowMutationResult;
      }
      setInfo(resolveCandidateGuidanceMessage(normalized, candidateOptions.length));
      return rowMutationResult;
    } catch (err) {
      setError(resolveErrorMessage(err, 'コード解析に失敗しました'));
      return null;
    } finally {
      resolvingRef.current = false;
      setResolving(false);
    }
  }, [appendOrUpdateRow, resolveAutoCandidatesForCode, resolveCode]);

  const detectCodesFromCurrentFrame = useCallback(async (): Promise<string[]> => {
    const videoElement = videoRef.current;
    if (!videoElement) {
      throw new Error('カメラ映像が取得できません');
    }
    if (videoElement.videoWidth < 2 || videoElement.videoHeight < 2) {
      throw new Error('カメラ映像を準備中です。少し待って再実行してください。');
    }

    const canvas = frameCanvasRef.current ?? document.createElement('canvas');
    frameCanvasRef.current = canvas;
    canvas.width = videoElement.videoWidth;
    canvas.height = videoElement.videoHeight;

    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('カメラ画像の解析準備に失敗しました');
    }
    context.drawImage(videoElement, 0, 0, canvas.width, canvas.height);

    const detectorCtor = getBarcodeDetectorConstructor();
    if (detectorCtor) {
      if (!barcodeDetectorRef.current) {
        barcodeDetectorRef.current = new detectorCtor({ formats: BARCODE_DETECTOR_FORMATS });
      }
      const detected = await barcodeDetectorRef.current.detect(canvas);
      const detectedCodes = [...new Set(
        detected
          .map((item) => normalizeCodeInput(item.rawValue ?? ''))
          .filter((code) => code.length > 0),
      )];
      if (detectedCodes.length > 0) {
        return detectedCodes;
      }
    }

    try {
      const reader = createReader();
      const result = reader.decodeFromCanvas(canvas);
      const fallbackCode = normalizeCodeInput(result.getText());
      return fallbackCode ? [fallbackCode] : [];
    } catch (err) {
      if (err instanceof NotFoundException) {
        return [];
      }
      throw err;
    }
  }, []);

  const handleCaptureFromFrame = async () => {
    if (frameCapturing || resolving || submitting) return;
    if (!cameraActive) {
      setError('先に「カメラ開始」を押してから実行してください');
      return;
    }

    setFrameCapturing(true);
    setError('');
    setInfo('');
    try {
      const codes = await detectCodesFromCurrentFrame();
      if (codes.length === 0) {
        setError('画像内に読取可能なコードが見つかりませんでした');
        return;
      }

      let addedCount = 0;
      for (const code of codes) {
        const result = await handleResolveCode(code);
        if (result === 'added') {
          addedCount += 1;
        }
      }
      setInfo(resolveCaptureResultInfo(addedCount));
    } catch (err) {
      setError(resolveErrorMessage(err, '画像からのコード検出に失敗しました'));
    } finally {
      setFrameCapturing(false);
    }
  };

  const handleManualAdd = async () => {
    const result = await handleResolveCode(manualCode);
    if (result !== null) {
      setManualCode('');
    }
  };

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
    setError('');
    setInfo(`手動で医薬品を確定しました: ${candidate.drugName}`);
  }, [updateRow]);

  const handleDecodedFromCamera = useCallback(async (text: string, sessionId: number) => {
    if (sessionId !== cameraSessionRef.current) {
      return;
    }
    const normalized = normalizeCodeInput(text);
    if (!normalized) return;

    const now = Date.now();
    const last = lastScanRef.current;
    if (last.text === normalized && now - last.at < SCAN_DUPLICATE_SUPPRESS_MS) {
      return;
    }
    lastScanRef.current = { text: normalized, at: now };
    pendingCameraCodesRef.current.add(normalized);
    if (resolvingRef.current) {
      return;
    }
    while (sessionId === cameraSessionRef.current && pendingCameraCodesRef.current.size > 0) {
      const nextCode = pendingCameraCodesRef.current.values().next().value;
      if (!nextCode) break;
      pendingCameraCodesRef.current.delete(nextCode);
      await handleResolveCode(nextCode);
    }
  }, [handleResolveCode]);

  const handleStartCamera = async () => {
    if (cameraActive || cameraBusy) return;
    if (!videoRef.current) {
      setCameraErrorState('カメラ初期化に失敗しました');
      return;
    }
    if (!window.isSecureContext) {
      setCameraErrorState('カメラ利用にはHTTPS接続が必要です');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraErrorState('このブラウザはカメラ機能に対応していません');
      return;
    }

    setCameraBusy(true);
    setCameraErrorState('', false);

    try {
      const sessionId = cameraSessionRef.current + 1;
      cameraSessionRef.current = sessionId;
      const reader = createReader();
      type DecodeCallback = NonNullable<Parameters<typeof reader.decodeFromConstraints>[2]>;
      type DecodeResult = Parameters<DecodeCallback>[0];
      type DecodeError = Parameters<DecodeCallback>[1];
      const onDecode = (result: DecodeResult, decodeError: DecodeError) => {
        if (result) {
          void handleDecodedFromCamera(result.getText(), sessionId);
          return;
        }
        if (decodeError && !(decodeError instanceof NotFoundException)) {
          setCameraErrorState(decodeError.message || 'カメラ読取に失敗しました', true);
        }
      };

      let controls: IScannerControls;
      try {
        controls = await reader.decodeFromConstraints(CAMERA_CONSTRAINTS_PREFERRED, videoRef.current, onDecode);
      } catch (error) {
        if (!isOverconstrainedError(error)) {
          throw error;
        }
        controls = await reader.decodeFromConstraints(CAMERA_CONSTRAINTS_FALLBACK, videoRef.current, onDecode);
      }

      controlsRef.current = controls;
      setTorchSupported(typeof controls.switchTorch === 'function');
      setTorchEnabled(false);
      setCameraActive(true);
    } catch (err) {
      setCameraErrorState(resolveCameraStartErrorMessage(err));
      stopCamera();
    } finally {
      setCameraBusy(false);
    }
  };

  const handleToggleTorch = async () => {
    const controls = controlsRef.current;
    if (!controls?.switchTorch || torchBusy) return;
    const nextTorchEnabled = !torchEnabled;
    setTorchBusy(true);
    try {
      await controls.switchTorch(nextTorchEnabled);
      setTorchEnabled(nextTorchEnabled);
    } catch (err) {
      setCameraErrorState(resolveErrorMessage(err, 'ライト切替に失敗しました'));
    } finally {
      setTorchBusy(false);
    }
  };

  const handleConfirmBatch = async () => {
    if (!canSubmit) {
      setError('未確定の行、または数量が0以下/未入力の行があります');
      return;
    }
    if (rows.some((row) => row.status === 'resolved' && row.drugMasterId === null)) {
      setError('医薬品の確定状態に不整合があります。再度候補を確定してください');
      return;
    }
    if (rows.some((row) => normalizeCodeInput(row.rawCode).length === 0)) {
      setError('コードが空の行があります。コードを入力してから登録してください');
      return;
    }

    setSubmitting(true);
    setError('');
    setInfo('');

    try {
      const payload = rows.map((row) => ({
        rawCode: normalizeCodeInput(row.rawCode),
        drugMasterId: row.drugMasterId,
        drugMasterPackageId: row.drugMasterPackageId,
        packageLabel: row.packageLabel || null,
        expirationDate: row.expirationDate || null,
        lotNumber: row.lotNumber || null,
        quantity: Number(row.quantity),
      }));

      const result = await api.post<CameraConfirmBatchResponse>('/inventory/dead-stock/camera/confirm-batch', {
        items: payload,
      });

      setRows([]);
      setInfo(`${result.message}（uploadId: ${result.uploadId}）`);
    } catch (err) {
      setError(resolveErrorMessage(err, '登録に失敗しました'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      {error && <AppAlert variant="danger">{error}</AppAlert>}
      {info && <AppAlert variant="success">{info}</AppAlert>}

      <AppCard className="mb-3">
        <AppCard.Header>カメラ読取登録</AppCard.Header>
        <AppCard.Body>
          <ol className="mb-3 upload-step-list">
            <li>カメラ開始後、リアルタイム読取または画像検出でコードを取り込みます。</li>
            <li>行ごとに提示された候補医薬品から手動で確定します。</li>
            <li>必要に応じて包装単位・使用期限・ロット番号を補完します。</li>
            <li>「一括登録」でデッドストックへ反映します。</li>
          </ol>

          <div className="d-flex gap-2 flex-wrap align-items-end mb-3 mobile-stack camera-mobile-actions">
            <Form.Group className="flex-grow-1 mb-0" controlId="camera-manual-code">
              <Form.Label>コード入力（手動補完）</Form.Label>
              <AppControl
                value={manualCode}
                onChange={(event: ChangeEvent<HTMLInputElement>) => setManualCode(event.currentTarget.value)}
                maxLength={MAX_CAMERA_CODE_INPUT_LENGTH}
                inputMode="text"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                placeholder="例: (01)...(17)...(10)... または YJコード"
              />
            </Form.Group>
            <LoadingButton
              variant="outline-primary"
              loading={resolving}
              loadingLabel="解析中..."
              disabled={!manualCode.trim()}
              onClick={() => void handleManualAdd()}
            >
              解析して追加
            </LoadingButton>
          </div>

          <div className="d-flex gap-2 flex-wrap mb-3 mobile-stack camera-mobile-actions">
            <AppButton
              variant={cameraActive ? 'outline-danger' : 'outline-secondary'}
              onClick={cameraActive ? stopCamera : () => void handleStartCamera()}
              disabled={cameraBusy}
            >
              {cameraActive ? 'カメラ停止' : 'カメラ開始'}
            </AppButton>
            {torchSupported && (
              <AppButton
                variant={torchEnabled ? 'warning' : 'outline-warning'}
                onClick={() => void handleToggleTorch()}
                disabled={!cameraActive || cameraBusy || torchBusy}
              >
                {torchEnabled ? 'ライトOFF' : 'ライトON'}
              </AppButton>
            )}
            <LoadingButton
              variant="outline-primary"
              loading={frameCapturing}
              loadingLabel="検出中..."
              disabled={!cameraActive || cameraBusy || resolving || submitting}
              onClick={() => void handleCaptureFromFrame()}
            >
              画像からコード検出
            </LoadingButton>
            <AppButton
              variant="outline-secondary"
              onClick={() => {
                pendingCameraCodesRef.current.clear();
                setRows([]);
              }}
              disabled={rows.length === 0 || submitting}
            >
              クリア
            </AppButton>
            <AppButton
              variant="outline-primary"
              onClick={() => navigate('/inventory/dead-stock')}
            >
              一覧へ移動
            </AppButton>
          </div>
          <div className="small text-muted mb-2">
            {barcodeDetectorSupported
              ? '画像検出では1フレーム内の複数コードを同時に追加できます。'
              : '画像検出は単一コード読取にフォールバックします（ブラウザ機能制限）。'}
          </div>

          {cameraError && <AppAlert variant="warning" className="small">{cameraError}</AppAlert>}

          <div className="mb-3 camera-mobile-video" style={{ maxWidth: 480 }}>
            <video
              ref={videoRef}
              muted
              playsInline
              autoPlay
              style={{ width: '100%', minHeight: 220, borderRadius: 8, border: '1px solid #dee2e6', backgroundColor: '#111' }}
            />
            <canvas ref={frameCanvasRef} style={{ display: 'none' }} />
          </div>
        </AppCard.Body>
      </AppCard>

      <AppCard className="mb-3">
        <AppCard.Header>読取結果（{rows.length}件）</AppCard.Header>
        <AppCard.Body>
          {rows.length === 0 ? (
            <div className="small text-muted">まだ読取結果がありません。カメラ読取またはコード入力で追加してください。</div>
          ) : (
            <div className="table-responsive">
              <table className="table table-sm table-bordered mobile-table camera-mobile-table">
                <thead>
                  <tr>
                    <th>コード</th>
                    <th>状態</th>
                    <th>医薬品</th>
                    <th>包装単位</th>
                    <th>使用期限</th>
                    <th>ロット</th>
                    <th>数量</th>
                    <th>単位</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td style={{ minWidth: 180 }}>
                        <AppControl
                          value={row.rawCode}
                          onChange={(event: ChangeEvent<HTMLInputElement>) => {
                            const normalizedRawCode = normalizeCodeInput(event.currentTarget.value);
                            updateRow(row.id, (current) => ({
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
                          }}
                          maxLength={MAX_CAMERA_CODE_INPUT_LENGTH}
                          inputMode="text"
                          autoCapitalize="off"
                          autoCorrect="off"
                          spellCheck={false}
                          aria-label={`コード-${row.id}`}
                        />
                      </td>
                      <td>
                        <Badge bg={row.status === 'resolved' ? 'success' : 'warning'}>
                          {row.status === 'resolved' ? '確定済み' : '候補確認待ち'}
                        </Badge>
                        {row.warnings.length > 0 && (
                          <div className="small text-muted mt-1">{row.warnings.join(' / ')}</div>
                        )}
                      </td>
                      <td style={{ minWidth: 220 }}>
                        {row.status === 'resolved' ? (
                          row.drugName || '-'
                        ) : (
                          <UnmatchedManualResolver
                            rowId={row.id}
                            disabled={submitting || resolving}
                            initialCandidates={row.candidateOptions}
                            initialSearchKeyword={row.candidateSearchKeyword}
                            onSearchCandidates={fetchManualCandidatesByKeyword}
                            onApplyCandidate={handleApplyManualCandidate}
                          />
                        )}
                      </td>
                      <td style={{ minWidth: 120 }}>
                        <AppControl
                          value={row.packageLabel}
                          onChange={(event: ChangeEvent<HTMLInputElement>) => {
                            updateRowField(row.id, 'packageLabel', event.currentTarget.value);
                          }}
                          maxLength={MAX_PACKAGE_LABEL_LENGTH}
                          aria-label={`包装単位-${row.id}`}
                        />
                      </td>
                      <td style={{ minWidth: 140 }}>
                        <AppControl
                          type="date"
                          value={row.expirationDate}
                          onChange={(event: ChangeEvent<HTMLInputElement>) => {
                            updateRowField(row.id, 'expirationDate', event.currentTarget.value);
                          }}
                          aria-label={`使用期限-${row.id}`}
                        />
                      </td>
                      <td style={{ minWidth: 120 }}>
                        <AppControl
                          value={row.lotNumber}
                          onChange={(event: ChangeEvent<HTMLInputElement>) => {
                            updateRowField(row.id, 'lotNumber', event.currentTarget.value);
                          }}
                          maxLength={MAX_LOT_NUMBER_LENGTH}
                          inputMode="text"
                          autoCapitalize="off"
                          autoCorrect="off"
                          spellCheck={false}
                          aria-label={`ロット-${row.id}`}
                        />
                      </td>
                      <td style={{ minWidth: 110 }}>
                        <AppControl
                          type="number"
                          min={QUANTITY_STEP}
                          step={QUANTITY_STEP}
                          inputMode="decimal"
                          value={row.quantity}
                          onChange={(event: ChangeEvent<HTMLInputElement>) => {
                            updateRowField(row.id, 'quantity', event.currentTarget.value);
                          }}
                          aria-label={`数量-${row.id}`}
                        />
                      </td>
                      <td>{row.unit || '-'}</td>
                      <td>
                        <div className="d-flex gap-1">
                          <LoadingButton
                            variant="outline-secondary"
                            size="sm"
                            loading={resolving}
                            loadingLabel="再解析中..."
                            onClick={() => void handleResolveCode(row.rawCode, row.id, true)}
                          >
                            再解析
                          </LoadingButton>
                          <AppButton
                            variant="outline-danger"
                            size="sm"
                            onClick={() => {
                              setRows((prev) => prev.filter((current) => current.id !== row.id));
                            }}
                          >
                            削除
                          </AppButton>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-3 d-flex gap-2 mobile-stack">
            <LoadingButton
              variant="success"
              loading={submitting}
              loadingLabel="登録中..."
              disabled={!canSubmit || resolving}
              onClick={() => void handleConfirmBatch()}
            >
              一括登録
            </LoadingButton>
            {!canSubmit && rows.length > 0 && (
              <div className="small text-warning">
                医薬品が未確定の行、または数量が0以下/未入力の行は登録できません。
              </div>
            )}
          </div>
        </AppCard.Body>
      </AppCard>
    </>
  );
}
