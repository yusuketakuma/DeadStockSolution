import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
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
const CAMERA_ERROR_UPDATE_MIN_INTERVAL_MS = 1200;
const AUTO_CANDIDATE_TERM_LIMIT = 3;

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
  onApplyCandidate: (rowId: number, candidate: CameraManualCandidate) => void;
}

function UnmatchedManualResolver({
  rowId,
  disabled,
  initialCandidates,
  initialSearchKeyword,
  onApplyCandidate,
}: UnmatchedManualResolverProps) {
  const [searchKeyword, setSearchKeyword] = useState(initialSearchKeyword);
  const [candidates, setCandidates] = useState<CameraManualCandidate[]>(initialCandidates);
  const [selectedCandidateKey, setSelectedCandidateKey] = useState(
    initialCandidates[0] ? resolveCandidateKey(initialCandidates[0]) : '',
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

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
    const keyword = searchKeyword.trim();
    if (!keyword) {
      setError('検索キーワードを入力してください');
      return;
    }
    if (keyword.length < MIN_MANUAL_CANDIDATE_SEARCH_LENGTH) {
      setError(`検索キーワードは${MIN_MANUAL_CANDIDATE_SEARCH_LENGTH}文字以上で入力してください`);
      return;
    }
    if (keyword.length > MAX_MANUAL_CANDIDATE_SEARCH_LENGTH) {
      setError(`検索キーワードは${MAX_MANUAL_CANDIDATE_SEARCH_LENGTH}文字以内で入力してください`);
      return;
    }

    setLoading(true);
    setError('');
    try {
      const result = await api.get<CameraManualCandidateResponse>(
        `/inventory/dead-stock/camera/manual-candidates?q=${encodeURIComponent(keyword)}`,
      );
      const mergedCandidates = mergeCandidateLists([...candidates, ...result.data]);
      setCandidates(mergedCandidates);
      if (result.data.length === 0) {
        setError('候補が見つかりませんでした。薬剤名やYJコードを変えて再検索してください。');
        return;
      }
      setSelectedCandidateKey(resolveCandidateKey(result.data[0]));
    } catch (err) {
      setError(err instanceof Error ? err.message : '候補検索に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="small">
      <div className="d-flex gap-1 mb-1">
        <AppControl
          value={searchKeyword}
          onChange={(event: ChangeEvent<HTMLInputElement>) => setSearchKeyword(event.currentTarget.value)}
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
  const lastScanRef = useRef<{ text: string; at: number }>({ text: '', at: 0 });
  const lastCameraErrorRef = useRef<{ message: string; at: number }>({ message: '', at: 0 });
  const resolveCacheRef = useRef(new Map<string, CameraResolveResponse>());
  const manualCandidatesCacheRef = useRef(new Map<string, CameraManualCandidate[]>());
  const navigate = useNavigate();
  const barcodeDetectorSupported = useMemo(() => getBarcodeDetectorConstructor() !== null, []);

  const canSubmit = useMemo(() => (
    rows.length > 0
    && rows.every((row) => row.status === 'resolved' && isPositiveQuantity(row.quantity))
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
    resolveCacheRef.current.set(rawCode, resolved);
    if (resolveCacheRef.current.size > MAX_RESOLVE_CACHE_SIZE) {
      const oldestCacheKey = resolveCacheRef.current.keys().next().value;
      if (oldestCacheKey) {
        resolveCacheRef.current.delete(oldestCacheKey);
      }
    }
    return resolved;
  }, []);

  const fetchManualCandidatesByKeyword = useCallback(async (keyword: string): Promise<CameraManualCandidate[]> => {
    const normalizedKeyword = keyword.trim();
    if (!normalizedKeyword) {
      return [];
    }
    if (normalizedKeyword.length < MIN_MANUAL_CANDIDATE_SEARCH_LENGTH) {
      return [];
    }
    if (normalizedKeyword.length > MAX_MANUAL_CANDIDATE_SEARCH_LENGTH) {
      return [];
    }
    const cacheKey = normalizedKeyword.toUpperCase();
    const cached = manualCandidatesCacheRef.current.get(cacheKey);
    if (cached) {
      return cached;
    }
    const result = await api.get<CameraManualCandidateResponse>(
      `/inventory/dead-stock/camera/manual-candidates?q=${encodeURIComponent(normalizedKeyword)}`,
    );
    manualCandidatesCacheRef.current.set(cacheKey, result.data);
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
  ) => {
    if (rowId !== undefined) {
      updateRow(rowId, (row) => {
        const quantity = row.quantity;
        const merged = toDraftRow(row.id, rawCode, resolved, candidateOptions);
        return { ...merged, quantity };
      });
      return;
    }

    let duplicate = false;
    setRows((prev) => {
      if (prev.some((row) => row.rawCode === rawCode)) {
        duplicate = true;
        return prev;
      }
      const nextId = nextRowIdRef.current;
      nextRowIdRef.current += 1;
      return [...prev, toDraftRow(nextId, rawCode, resolved, candidateOptions)];
    });
    if (duplicate) {
      setInfo(`同じコードは既に追加済みです: ${rawCode}`);
    }
  }, [updateRow]);

  const handleResolveCode = useCallback(async (
    inputCode: string,
    rowId?: number,
    forceRefresh = false,
  ): Promise<boolean> => {
    const normalized = normalizeCodeInput(inputCode);
    if (!normalized) {
      setError('コードを入力してください');
      return false;
    }

    if (resolvingRef.current) return false;

    resolvingRef.current = true;
    setResolving(true);
    setError('');
    setInfo('');
    try {
      const resolved = await resolveCode(normalized, forceRefresh);
      const candidateOptions = await resolveAutoCandidatesForCode(normalized, resolved);
      appendOrUpdateRow(normalized, resolved, candidateOptions, rowId);
      if (candidateOptions.length > 0) {
        setInfo(`コード ${normalized} を読取しました。候補 ${candidateOptions.length} 件から医薬品を確定してください。`);
      } else {
        setInfo(`コード ${normalized} を読取しました。候補が見つからないため、薬剤名またはYJコードで検索してください。`);
      }
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'コード解析に失敗しました');
      return false;
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
      const detector = new detectorCtor({ formats: BARCODE_DETECTOR_FORMATS });
      const detected = await detector.detect(canvas);
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
        const success = await handleResolveCode(code);
        if (success) {
          addedCount += 1;
        }
      }
      setInfo(`画像内コードを ${addedCount} 件追加しました。候補を確認して医薬品を確定してください。`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '画像からのコード検出に失敗しました');
    } finally {
      setFrameCapturing(false);
    }
  };

  const handleManualAdd = async () => {
    const success = await handleResolveCode(manualCode);
    if (success) {
      setManualCode('');
    }
  };

  const handleApplyManualCandidate = useCallback((rowId: number, candidate: CameraManualCandidate) => {
    const manualFixedWarning = '手動で医薬品候補を確定しました。';
    updateRow(rowId, (row) => {
      const warnings = row.warnings.includes(manualFixedWarning)
        ? row.warnings
        : [...row.warnings, manualFixedWarning];
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

  const handleDecodedFromCamera = useCallback(async (text: string) => {
    const normalized = normalizeCodeInput(text);
    if (!normalized) return;

    const now = Date.now();
    const last = lastScanRef.current;
    if (last.text === normalized && now - last.at < SCAN_DUPLICATE_SUPPRESS_MS) {
      return;
    }
    lastScanRef.current = { text: normalized, at: now };

    await handleResolveCode(normalized);
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
      const reader = createReader();
      const onDecode = (result: Parameters<NonNullable<Parameters<typeof reader.decodeFromConstraints>[2]>>[0], decodeError: Parameters<NonNullable<Parameters<typeof reader.decodeFromConstraints>[2]>>[1]) => {
        if (result) {
          void handleDecodedFromCamera(result.getText());
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
      if (err instanceof DOMException && err.name === 'NotAllowedError') {
        setCameraErrorState('カメラ権限が拒否されました。ブラウザ設定から許可してください');
      } else if (err instanceof DOMException && err.name === 'NotFoundError') {
        setCameraErrorState('利用可能なカメラが見つかりません');
      } else {
        setCameraErrorState(err instanceof Error ? err.message : 'カメラ起動に失敗しました');
      }
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
      setCameraErrorState(err instanceof Error ? err.message : 'ライト切替に失敗しました');
    } finally {
      setTorchBusy(false);
    }
  };

  const handleConfirmBatch = async () => {
    if (!canSubmit) {
      setError('未確定の行、または数量未入力の行があります');
      return;
    }

    setSubmitting(true);
    setError('');
    setInfo('');

    try {
      const payload = rows.map((row) => ({
        rawCode: row.rawCode,
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
      setError(err instanceof Error ? err.message : '登録に失敗しました');
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
              onClick={() => setRows([])}
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
                            const value = event.currentTarget.value;
                            updateRow(row.id, (current) => ({ ...current, rawCode: value }));
                          }}
                          maxLength={MAX_CAMERA_CODE_INPUT_LENGTH}
                          inputMode="text"
                          autoCapitalize="off"
                          autoCorrect="off"
                          spellCheck={false}
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
                            onApplyCandidate={handleApplyManualCandidate}
                          />
                        )}
                      </td>
                      <td style={{ minWidth: 120 }}>
                        <AppControl
                          value={row.packageLabel}
                          onChange={(event: ChangeEvent<HTMLInputElement>) => {
                            const value = event.currentTarget.value;
                            updateRow(row.id, (current) => ({ ...current, packageLabel: value }));
                          }}
                          maxLength={MAX_PACKAGE_LABEL_LENGTH}
                        />
                      </td>
                      <td style={{ minWidth: 140 }}>
                        <AppControl
                          type="date"
                          value={row.expirationDate}
                          onChange={(event: ChangeEvent<HTMLInputElement>) => {
                            const value = event.currentTarget.value;
                            updateRow(row.id, (current) => ({ ...current, expirationDate: value }));
                          }}
                        />
                      </td>
                      <td style={{ minWidth: 120 }}>
                        <AppControl
                          value={row.lotNumber}
                          onChange={(event: ChangeEvent<HTMLInputElement>) => {
                            const value = event.currentTarget.value;
                            updateRow(row.id, (current) => ({ ...current, lotNumber: value }));
                          }}
                          maxLength={MAX_LOT_NUMBER_LENGTH}
                          inputMode="text"
                          autoCapitalize="off"
                          autoCorrect="off"
                          spellCheck={false}
                        />
                      </td>
                      <td style={{ minWidth: 110 }}>
                        <AppControl
                          type="number"
                          min="0"
                          step={QUANTITY_STEP}
                          inputMode="decimal"
                          value={row.quantity}
                          onChange={(event: ChangeEvent<HTMLInputElement>) => {
                            const value = event.currentTarget.value;
                            updateRow(row.id, (current) => ({ ...current, quantity: value }));
                          }}
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
                医薬品が未確定の行、または数量未入力の行は登録できません。
              </div>
            )}
          </div>
        </AppCard.Body>
      </AppCard>
    </>
  );
}
