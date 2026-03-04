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

function toDraftRow(id: number, rawCode: string, resolved: CameraResolveResponse): DraftRow {
  return {
    id,
    rawCode,
    status: resolved.match ? 'resolved' : 'unmatched',
    drugMasterId: resolved.match?.drugMasterId ?? null,
    drugMasterPackageId: resolved.match?.drugMasterPackageId ?? null,
    drugName: resolved.match?.drugName ?? '',
    packageLabel: resolved.match?.packageLabel ?? '',
    expirationDate: resolved.parsed.expirationDate ?? '',
    lotNumber: resolved.parsed.lotNumber ?? '',
    quantity: '',
    unit: resolved.match?.unit ?? '',
    warnings: resolved.warnings,
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
  onApplyCandidate: (rowId: number, candidate: CameraManualCandidate) => void;
}

function UnmatchedManualResolver({ rowId, disabled, onApplyCandidate }: UnmatchedManualResolverProps) {
  const [searchKeyword, setSearchKeyword] = useState('');
  const [candidates, setCandidates] = useState<CameraManualCandidate[]>([]);
  const [selectedDrugMasterId, setSelectedDrugMasterId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const selectedCandidate = useMemo(() => (
    candidates.find((candidate) => String(candidate.drugMasterId) === selectedDrugMasterId) ?? null
  ), [candidates, selectedDrugMasterId]);

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
      setCandidates(result.data);
      if (result.data.length === 0) {
        setSelectedDrugMasterId('');
        setError('候補が見つかりませんでした');
        return;
      }
      setSelectedDrugMasterId(String(result.data[0].drugMasterId));
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
            value={selectedDrugMasterId}
            disabled={disabled}
            onChange={(event) => setSelectedDrugMasterId(event.currentTarget.value)}
          >
            {candidates.map((candidate) => (
              <option key={candidate.drugMasterId} value={candidate.drugMasterId}>
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

  const nextRowIdRef = useRef(1);
  const resolvingRef = useRef(false);
  const controlsRef = useRef<IScannerControls | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const lastScanRef = useRef<{ text: string; at: number }>({ text: '', at: 0 });
  const lastCameraErrorRef = useRef<{ message: string; at: number }>({ message: '', at: 0 });
  const resolveCacheRef = useRef(new Map<string, CameraResolveResponse>());
  const navigate = useNavigate();

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

  const appendOrUpdateRow = useCallback((rawCode: string, resolved: CameraResolveResponse, rowId?: number) => {
    if (rowId !== undefined) {
      updateRow(rowId, (row) => {
        const quantity = row.quantity;
        const merged = toDraftRow(row.id, rawCode, resolved);
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
      return [...prev, toDraftRow(nextId, rawCode, resolved)];
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
      appendOrUpdateRow(normalized, resolved, rowId);
      if (resolved.match) {
        setInfo(`医薬品を特定しました: ${resolved.match.drugName}`);
      } else {
        setInfo('医薬品を特定できませんでした。コードを修正して再解析してください。');
      }
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'コード解析に失敗しました');
      return false;
    } finally {
      resolvingRef.current = false;
      setResolving(false);
    }
  }, [appendOrUpdateRow, resolveCode]);

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
            <li>スマートフォンのカメラでGS1またはYJコードを読み取ります。</li>
            <li>医薬品が特定されたら数量を入力します。</li>
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

          {cameraError && <AppAlert variant="warning" className="small">{cameraError}</AppAlert>}

          <div className="mb-3 camera-mobile-video" style={{ maxWidth: 480 }}>
            <video
              ref={videoRef}
              muted
              playsInline
              autoPlay
              style={{ width: '100%', minHeight: 220, borderRadius: 8, border: '1px solid #dee2e6', backgroundColor: '#111' }}
            />
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
                        <Badge bg={row.status === 'resolved' ? 'success' : 'secondary'}>
                          {row.status === 'resolved' ? '確定' : '未一致'}
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
