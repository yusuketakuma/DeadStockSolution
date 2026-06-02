import { useState, useCallback, useMemo, useRef, type ChangeEvent } from 'react';
import { Badge, Form } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import AppAlert from '../../components/ui/AppAlert';
import AppButton from '../../components/ui/AppButton';
import AppCard from '../../components/ui/AppCard';
import AppControl from '../../components/ui/AppControl';
import LoadingButton from '../../components/ui/LoadingButton';
import {
  type AppendOrUpdateRowResult,
  normalizeCodeInput,
  useBarcodeResolver,
} from '../../hooks/useBarcodeResolver';
import { useCamera } from '../../hooks/useCamera';
import { useCameraDraftRows } from '../../hooks/useCameraDraftRows';
import { useScanFeedback } from '../../hooks/useScanFeedback';
import CameraViewport from '../../components/camera/CameraViewport';
import ScanViewfinder from '../../components/camera/ScanViewfinder';
import ScanResultSheet from '../../components/camera/ScanResultSheet';
import ScanStatsBar from '../../components/camera/ScanStatsBar';
import DraftRowList from '../../components/camera/DraftRowList';
import AppDropdownMenu from '../../components/ui/AppDropdownMenu';

interface CameraConfirmBatchResponse {
  message: string;
  uploadId: number;
  createdCount: number;
}

const MAX_CAMERA_CODE_INPUT_LENGTH = 500;

function resolveErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export default function CameraDeadStockRegisterPanel() {
  const [manualCode, setManualCode] = useState('');
  const [info, setInfo] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [cameraFullscreen, setCameraFullscreen] = useState(false);
  const [showHint, setShowHint] = useState(true);
  const [lastAddedRowId, setLastAddedRowId] = useState<number | null>(null);
  const rowsRef = useRef<typeof rows>([]);

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

  // Keep rowsRef in sync for use in callbacks that may close over stale rows
  rowsRef.current = rows;

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
    triggerFeedback,
    scanFlashType,
    soundEnabled,
    toggleSound,
    ensureAudioContext,
  } = useScanFeedback();

  const handleResolvedScanResult = useCallback((result: AppendOrUpdateRowResult | null) => {
    if (result === null) {
      return;
    }

    if (result === 'duplicate') {
      triggerFeedback('duplicate');
      return;
    }

    const currentRows = rowsRef.current;
    const latest = currentRows[currentRows.length - 1];
    if (latest) {
      triggerFeedback(latest.status === 'resolved' ? 'success' : 'unmatched');
    }

    setShowHint(false);
    setSheetOpen(true);
    if (result === 'added' && latest) {
      setLastAddedRowId(latest.id);
      return;
    }
    setLastAddedRowId(null);
  }, [triggerFeedback]);

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
    onResolveCode: (code) => {
      const promise = handleResolveCode(code);
      void promise.then(handleResolvedScanResult);
      return promise;
    },
    onError: setError,
    onInfo: setInfo,
  });

  // Computed stats
  const resolvedCount = useMemo(() => rows.filter((r) => r.status === 'resolved').length, [rows]);
  const unmatchedCount = useMemo(() => rows.filter((r) => r.status === 'unmatched').length, [rows]);

  const latestRow = rows.length > 0 ? rows[rows.length - 1] : null;

  // Hint text for viewfinder
  const hintText = useMemo(() => {
    if (!cameraActive) return '';
    if (resolving) return '読取中...';
    if (showHint) return 'バーコードを枠内に合わせてください';
    return '';
  }, [cameraActive, resolving, showHint]);

  const handleManualAdd = async () => {
    const result = await handleResolveCode(manualCode);
    if (result !== null) {
      setManualCode('');
      handleResolvedScanResult(result);
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

  const handleStartCameraWithFullscreen = async () => {
    ensureAudioContext();
    setCameraFullscreen(true);
    setShowHint(true);
    await handleStartCamera();
  };

  const handleStopCamera = () => {
    stopCamera();
    setCameraFullscreen(false);
    setSheetOpen(false);
  };

  const handleViewAllRows = () => {
    setSheetOpen(false);
    setCameraFullscreen(false);
  };

  const handleContinueScan = () => {
    setSheetOpen(false);
  };

  const handleUndo = () => {
    if (lastAddedRowId !== null) {
      removeRow(lastAddedRowId);
      setLastAddedRowId(null);
    } else if (latestRow) {
      removeRow(latestRow.id);
    }
    setSheetOpen(false);
  };

  const handleFieldChange = useCallback((rowId: number, field: 'quantity' | 'expirationDate' | 'lotNumber', value: string) => {
    updateRowField(rowId, field, value);
  }, [updateRowField]);

  return (
    <>
      {/* ── 全画面カメラモード ── */}
      {cameraFullscreen && (
        <>
          <CameraViewport
            videoRef={videoRef}
            canvasRef={frameCanvasRef}
            cameraActive={cameraActive}
            cameraError={cameraError}
            fullscreen
          >
            <ScanViewfinder
              scanning={cameraActive}
              flashType={scanFlashType}
              hintText={hintText}
            />
          </CameraViewport>

          {/* Top bar: close + stats */}
          <div className="camera-fs-top-bar">
            <button
              type="button"
              className="camera-fs-close-btn"
              onClick={handleStopCamera}
              disabled={cameraBusy}
              aria-label="カメラを閉じる"
            >
              ×
            </button>
            <ScanStatsBar
              resolvedCount={resolvedCount}
              unmatchedCount={unmatchedCount}
              totalCount={rows.length}
              soundEnabled={soundEnabled}
              onToggleSound={toggleSound}
            />
          </div>

          {/* Torch button */}
          {torchSupported && (
            <button
              type="button"
              className={`camera-fs-torch-btn ${torchEnabled ? 'camera-fs-torch-btn--on' : 'camera-fs-torch-btn--off'}${sheetOpen ? ' camera-fs-torch-btn--sheet-open' : ''}`}
              onClick={() => void handleToggleTorch()}
              disabled={!cameraActive || cameraBusy || torchBusy}
              aria-label={torchEnabled ? 'ライトをオフ' : 'ライトをオン'}
            >
              <i className={torchEnabled ? 'bi bi-lightbulb-fill' : 'bi bi-lightbulb'} />
            </button>
          )}

          {/* Bottom sheet */}
          <ScanResultSheet
            open={sheetOpen}
            latestRow={latestRow}
            totalCount={rows.length}
            onClose={() => setSheetOpen(false)}
            onViewAll={handleViewAllRows}
            onUndo={handleUndo}
            onFieldChange={handleFieldChange}
            onContinueScan={handleContinueScan}
          />
        </>
      )}

      {/* ── 通常ビュー（非フルスクリーン時） ── */}
      {!cameraFullscreen && (
        <>
          {error && <AppAlert variant="danger">{error}</AppAlert>}
          {info && <AppAlert variant="success">{info}</AppAlert>}

          <AppCard className="mb-3">
            <AppCard.Header>カメラ読取登録</AppCard.Header>
            <AppCard.Body>
              <div className="small text-muted mb-3">
                スキャン開始でカメラを起動し、バーコードを読み取ります。
                読取結果の確認・数量入力後、一括登録でデッドストックに反映します。
              </div>

              <div className="dl-action-row mobile-stack align-items-end mb-3 camera-mobile-actions">
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

              <div className="dl-action-row mb-3 mobile-stack camera-mobile-actions">
                <AppButton
                  variant={cameraActive ? 'outline-danger' : 'primary'}
                  onClick={cameraActive ? handleStopCamera : () => void handleStartCameraWithFullscreen()}
                  disabled={cameraBusy}
                >
                  {cameraActive ? 'カメラ停止' : 'スキャン開始'}
                </AppButton>
                <AppDropdownMenu
                  label="その他"
                  variant="outline-secondary"
                  items={[
                    {
                      key: 'torch',
                      label: torchEnabled ? 'ライトOFF' : 'ライトON',
                      onClick: () => void handleToggleTorch(),
                      disabled: !torchSupported || !cameraActive || cameraBusy || torchBusy,
                    },
                    {
                      key: 'capture',
                      label: frameCapturing ? '検出中...' : '手動検出',
                      onClick: () => void handleCaptureFromFrame(),
                      disabled: !barcodeDetectorSupported || !cameraActive || cameraBusy || resolving || submitting,
                    },
                    {
                      key: 'clear',
                      label: 'クリア',
                      onClick: () => {
                        clearPendingCameraCodes();
                        clearRows();
                      },
                      disabled: rows.length === 0 || submitting,
                    },
                    { key: 'list', label: '一覧へ移動', onClick: () => navigate('/inventory/dead-stock') },
                  ]}
                />
              </div>

              {cameraError && <AppAlert variant="warning" className="small">{cameraError}</AppAlert>}

              {/* Non-fullscreen video preview */}
              {!cameraFullscreen && (
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
              )}
            </AppCard.Body>
          </AppCard>

          <AppCard className="mb-3">
            <AppCard.Header>
              <div className="d-flex align-items-center gap-2">
                読取結果（{rows.length}件）
                {resolvedCount > 0 && (
                  <Badge bg="success">{resolvedCount} 確定</Badge>
                )}
                {unmatchedCount > 0 && (
                  <Badge bg="warning" text="dark">{unmatchedCount} 要確認</Badge>
                )}
              </div>
            </AppCard.Header>
            <AppCard.Body>
              <DraftRowList
                rows={rows}
                submitting={submitting}
                resolving={resolving}
                onRowRawCodeChange={handleRowRawCodeChange}
                onUpdateRowField={updateRowField}
                onRemoveRow={removeRow}
                onResolveCode={handleResolveCode}
                onSearchCandidates={fetchManualCandidatesByKeyword}
                onApplyCandidate={handleApplyManualCandidate}
              />

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
      )}
    </>
  );
}
