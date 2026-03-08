import { useState, type ChangeEvent } from 'react';
import { Form } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import AppAlert from '../../components/ui/AppAlert';
import AppButton from '../../components/ui/AppButton';
import AppCard from '../../components/ui/AppCard';
import AppControl from '../../components/ui/AppControl';
import LoadingButton from '../../components/ui/LoadingButton';
import {
  normalizeCodeInput,
  useBarcodeResolver,
} from '../../hooks/useBarcodeResolver';
import { useCamera } from '../../hooks/useCamera';
import { useCameraDraftRows } from '../../hooks/useCameraDraftRows';
import CameraViewport from '../../components/camera/CameraViewport';
import ScanResultSheet from '../../components/camera/ScanResultSheet';
import DraftRowList from '../../components/camera/DraftRowList';

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
  const [showScanSheet, setShowScanSheet] = useState(false);
  const [cameraFullscreen, setCameraFullscreen] = useState(false);

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
    onResolveCode: (code) => {
      setShowScanSheet(true);
      return handleResolveCode(code);
    },
    onError: setError,
    onInfo: setInfo,
  });

  const handleManualAdd = async () => {
    const result = await handleResolveCode(manualCode);
    if (result !== null) {
      setManualCode('');
      setShowScanSheet(true);
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

  const latestRow = rows.length > 0 ? rows[rows.length - 1] : null;

  const handleStartCameraWithFullscreen = async () => {
    setCameraFullscreen(true);
    await handleStartCamera();
  };

  const handleStopCamera = () => {
    stopCamera();
    setCameraFullscreen(false);
  };

  const handleViewAllRows = () => {
    setShowScanSheet(false);
    setCameraFullscreen(false);
  };

  return (
    <>
      {/* 全画面カメラモード */}
      {cameraFullscreen && (
        <CameraViewport
          videoRef={videoRef}
          canvasRef={frameCanvasRef}
          cameraActive={cameraActive}
          cameraError={cameraError}
          fullscreen
        />
      )}

      {/* 全画面カメラ時のコントロールオーバーレイ */}
      {cameraFullscreen && (
        <div
          className="camera-fullscreen-controls"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            zIndex: 120,
            padding: 'calc(0.5rem + env(safe-area-inset-top, 0px)) 0.75rem',
            background: 'linear-gradient(180deg, rgba(0,0,0,0.6) 0%, transparent 100%)',
          }}
        >
          <div className="d-flex gap-2 justify-content-between">
            <div className="d-flex gap-2">
              <AppButton
                variant="light"
                size="sm"
                onClick={handleStopCamera}
                disabled={cameraBusy}
              >
                閉じる
              </AppButton>
              {torchSupported && (
                <AppButton
                  variant={torchEnabled ? 'warning' : 'outline-light'}
                  size="sm"
                  onClick={() => void handleToggleTorch()}
                  disabled={!cameraActive || cameraBusy || torchBusy}
                >
                  {torchEnabled ? '💡' : '🔦'}
                </AppButton>
              )}
            </div>
            <div className="d-flex gap-2">
              <LoadingButton
                variant="light"
                size="sm"
                loading={frameCapturing}
                loadingLabel="検出中..."
                disabled={!cameraActive || cameraBusy || resolving || submitting}
                onClick={() => void handleCaptureFromFrame()}
              >
                撮影
              </LoadingButton>
            </div>
          </div>
        </div>
      )}

      {/* スキャン結果ボトムシート */}
      {cameraFullscreen && showScanSheet && (
        <ScanResultSheet
          latestRow={latestRow}
          onClose={() => setShowScanSheet(false)}
          totalCount={rows.length}
          onViewAll={handleViewAllRows}
        />
      )}

      {/* 通常ビュー（非フルスクリーン時） */}
      {!cameraFullscreen && (
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
                  onClick={cameraActive ? handleStopCamera : () => void handleStartCameraWithFullscreen()}
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
