import { useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { Badge, Form } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import AppAlert from '../../components/ui/AppAlert';
import AppButton from '../../components/ui/AppButton';
import AppCard from '../../components/ui/AppCard';
import AppControl from '../../components/ui/AppControl';
import LoadingButton from '../../components/ui/LoadingButton';
import {
  getManualCandidateKeywordValidationError,
  MAX_MANUAL_CANDIDATE_SEARCH_LENGTH,
  normalizeCodeInput,
  normalizeManualCandidateKeyword,
  resolveCandidateKey,
  useBarcodeResolver,
  type CameraManualCandidate,
} from '../../hooks/useBarcodeResolver';
import { useCamera } from '../../hooks/useCamera';
import { useCameraDraftRows } from '../../hooks/useCameraDraftRows';

interface CameraConfirmBatchResponse {
  message: string;
  uploadId: number;
  createdCount: number;
}

const MAX_CAMERA_CODE_INPUT_LENGTH = 500;
const MAX_PACKAGE_LABEL_LENGTH = 120;
const MAX_LOT_NUMBER_LENGTH = 120;
const QUANTITY_STEP = '0.001';

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
  const [manualCode, setManualCode] = useState('');
  const [info, setInfo] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const navigate = useNavigate();

  const {
    rows,
    canSubmit,
    appendOrUpdateRow,
    updateRowField,
    handleApplyManualCandidate,
    handleRowRawCodeChange,
    removeRow,
    clearRows,
  } = useCameraDraftRows({
    onInfo: setInfo,
    onError: setError,
  });


  const {
    resolving,
    handleResolveCode,
    fetchManualCandidatesByKeyword,
  } = useBarcodeResolver({
    appendOrUpdateRow,
    onError: setError,
    onInfo: setInfo,
  });

  const {
    cameraActive,
    cameraError,
    cameraBusy,
    torchSupported,
    torchEnabled,
    torchBusy,
    frameCapturing,
    barcodeDetectorSupported,
    videoRef,
    frameCanvasRef,
    stopCamera,
    handleStartCamera,
    handleToggleTorch,
    handleCaptureFromFrame,
    clearPendingCameraCodes,
  } = useCamera({
    resolving,
    submitting,
    normalizeCodeInput,
    onResolveCode: (code) => handleResolveCode(code),
    onError: setError,
    onInfo: setInfo,
  });

  const handleManualAdd = async () => {
    const result = await handleResolveCode(manualCode);
    if (result !== null) {
      setManualCode('');
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

      clearRows();
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
                clearPendingCameraCodes();
                clearRows();
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
                            handleRowRawCodeChange(row.id, event.currentTarget.value);
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
                            onClick={() => removeRow(row.id)}
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
