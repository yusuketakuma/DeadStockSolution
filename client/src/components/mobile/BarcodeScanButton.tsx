import { useCallback, useRef, useState } from 'react';
import { Badge, Form } from 'react-bootstrap';
import AppButton from '../ui/AppButton';
import CameraViewport from '../camera/CameraViewport';
import ScanViewfinder from '../camera/ScanViewfinder';
import { useToast } from '../../contexts/ToastContext';
import { api } from '../../api/client';
import {
  normalizeCodeInput,
  type AppendOrUpdateRowResult,
  type CameraResolveResponse,
  type CameraManualCandidate,
} from '../../hooks/useBarcodeResolver';
import { useCamera } from '../../hooks/useCamera';
import { useScanFeedback } from '../../hooks/useScanFeedback';

interface BarcodeScanButtonProps {
  onScanResult: (drugName: string) => void;
}

interface ResolveResult {
  match: CameraResolveResponse['match'];
  parsed: CameraResolveResponse['parsed'];
  candidates: CameraManualCandidate[];
}

/**
 * バーコードスキャンボタン（モバイル専用）
 * 共通カメラUI（ビューファインダー + フィードバック）を使用。
 * スキャン→候補ボトムシート→「この薬品で検索」で呼び出し元に薬品名を返す。
 */
export default function BarcodeScanButton({ onScanResult }: BarcodeScanButtonProps) {
  const [fullscreen, setFullscreen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [resolveResult, setResolveResult] = useState<ResolveResult | null>(null);
  const [selectedDrugName, setSelectedDrugName] = useState('');
  const [showHint, setShowHint] = useState(true);

  const { showWarning } = useToast();
  const resolvingRef = useRef(false);
  const stopCameraRef = useRef<() => void>(() => {});

  const {
    triggerFeedback,
    scanFlashType,
    soundEnabled,
    toggleSound,
    ensureAudioContext,
  } = useScanFeedback();

  const handleResolveCode = useCallback(async (code: string): Promise<AppendOrUpdateRowResult | null> => {
    if (resolvingRef.current) return null;
    const normalized = normalizeCodeInput(code);
    if (!normalized) return null;

    resolvingRef.current = true;
    try {
      const response = await api.post<CameraResolveResponse>(
        '/inventory/dead-stock/camera/resolve',
        { rawCode: normalized },
      );

      // Fetch candidates
      let candidates: CameraManualCandidate[] = [];
      const searchTerm = response.match?.yjCode
        ?? response.parsed.yjCode
        ?? response.parsed.gtin
        ?? normalized;
      if (searchTerm) {
        try {
          const candidateResp = await api.get<{ data: CameraManualCandidate[] }>(
            `/inventory/dead-stock/camera/manual-candidates?q=${encodeURIComponent(searchTerm)}`,
          );
          candidates = candidateResp.data;
        } catch {
          // Candidate search failed, continue with match only
        }
      }

      // Determine feedback type
      if (response.match) {
        triggerFeedback('success');
      } else if (candidates.length > 0) {
        triggerFeedback('unmatched');
      } else {
        triggerFeedback('unmatched');
        showWarning('このバーコードに対応する薬品が見つかりません');
        return null;
      }

      // Build combined list: match first, then candidates (excluding duplicates)
      const matchId = response.match?.drugMasterId;
      const dedupedCandidates = candidates.filter((c) => c.drugMasterId !== matchId);

      const result: ResolveResult = {
        match: response.match,
        parsed: response.parsed,
        candidates: dedupedCandidates,
      };

      stopCameraRef.current();
      setResolveResult(result);
      setSelectedDrugName(response.match?.drugName ?? dedupedCandidates[0]?.drugName ?? '');
      setShowHint(false);
      setSheetOpen(true);

      return 'added';
    } catch {
      showWarning('バーコードの解析に失敗しました');
      return null;
    } finally {
      resolvingRef.current = false;
    }
  }, [showWarning, triggerFeedback]);

  const {
    cameraActive,
    cameraError,
    cameraBusy,
    torchSupported,
    torchEnabled,
    torchBusy,
    videoRef,
    frameCanvasRef,
    stopCamera,
    handleStartCamera,
    handleToggleTorch,
  } = useCamera({
    resolving: false,
    submitting: false,
    normalizeCodeInput,
    onResolveCode: handleResolveCode,
    onScanDetected: undefined,
    onError: () => {},
    onInfo: () => {},
  });
  stopCameraRef.current = stopCamera;

  const hintText = cameraActive
    ? (showHint ? 'バーコードを枠内に合わせてください' : '')
    : '';

  const handleOpen = useCallback(async () => {
    setFullscreen(true);
    setShowHint(true);
    setSheetOpen(false);
    setResolveResult(null);
    setSelectedDrugName('');
    ensureAudioContext();
    await handleStartCamera();
  }, [ensureAudioContext, handleStartCamera]);

  const handleClose = useCallback(() => {
    stopCamera();
    setFullscreen(false);
    setSheetOpen(false);
    setResolveResult(null);
  }, [stopCamera]);

  const handleConfirmSearch = useCallback(() => {
    if (selectedDrugName) {
      onScanResult(selectedDrugName);
    }
    handleClose();
  }, [handleClose, onScanResult, selectedDrugName]);

  const handleSheetClose = useCallback(() => {
    setSheetOpen(false);
    setResolveResult(null);
    setSelectedDrugName('');
    setShowHint(true);
    void handleStartCamera();
  }, [handleStartCamera]);

  return (
    <>
      {/* Trigger button (mobile only) */}
      <span
        className="d-lg-none"
        style={{
          position: 'absolute',
          right: 8,
          top: '50%',
          transform: 'translateY(-50%)',
          zIndex: 5,
        }}
      >
        <AppButton
          variant="link"
          size="sm"
          onClick={() => void handleOpen()}
          aria-label="バーコードスキャン"
          className="p-0 text-muted"
        >
          <i className="bi bi-camera" style={{ fontSize: '1.2rem' }} />
        </AppButton>
      </span>

      {/* Fullscreen camera overlay */}
      {fullscreen && (
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

          {/* Top bar */}
          <div className="camera-fs-top-bar">
            <button
              type="button"
              className="camera-fs-close-btn"
              onClick={handleClose}
              disabled={cameraBusy}
              aria-label="カメラを閉じる"
            >
              ×
            </button>
            <button
              type="button"
              className="scan-stats-sound-btn"
              onClick={toggleSound}
              aria-label={soundEnabled ? 'サウンドをオフ' : 'サウンドをオン'}
            >
              <i className={soundEnabled ? 'bi bi-volume-up-fill' : 'bi bi-volume-mute-fill'} />
            </button>
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

          {/* Candidate bottom sheet */}
          <div className={`scan-result-sheet bottom-sheet${sheetOpen ? ' open' : ''}`}>
            <div className="bottom-sheet-handle" />
            <div className="bottom-sheet-header">
              <h3 className="bottom-sheet-header-title">スキャン結果</h3>
              <button
                type="button"
                className="bottom-sheet-close"
                aria-label="閉じる"
                onClick={handleSheetClose}
              >
                ×
              </button>
            </div>
            <div className="bottom-sheet-content">
              {resolveResult && (
                <div role="radiogroup" aria-label="候補一覧">
                  {/* Match row */}
                  {resolveResult.match && (
                    <Form.Check
                      type="radio"
                      id="scan-candidate-match"
                      name="scan-candidate"
                      checked={selectedDrugName === resolveResult.match.drugName}
                      onChange={() => setSelectedDrugName(resolveResult.match!.drugName)}
                      label={
                        <div>
                          <div className="d-flex align-items-center gap-2">
                            <span className="fw-bold">{resolveResult.match.drugName}</span>
                            <Badge bg="success" style={{ fontSize: '0.7rem' }}>確定</Badge>
                          </div>
                          <div className="small text-muted">
                            {[
                              resolveResult.match.packageLabel ? `包装: ${resolveResult.match.packageLabel}` : null,
                              resolveResult.parsed.expirationDate ? `期限: ${resolveResult.parsed.expirationDate}` : null,
                              resolveResult.parsed.lotNumber ? `ロット: ${resolveResult.parsed.lotNumber}` : null,
                            ].filter(Boolean).join(' | ')}
                          </div>
                        </div>
                      }
                      className="py-2 border-bottom"
                    />
                  )}

                  {/* Candidate rows */}
                  {resolveResult.candidates.map((candidate) => (
                    <Form.Check
                      type="radio"
                      id={`scan-candidate-${candidate.drugMasterId}`}
                      key={candidate.drugMasterId}
                      name="scan-candidate"
                      checked={selectedDrugName === candidate.drugName}
                      onChange={() => setSelectedDrugName(candidate.drugName)}
                      label={
                        <div>
                          <span className="fw-bold">{candidate.drugName}</span>
                          {candidate.packageLabel && (
                            <div className="small text-muted">
                              包装: {candidate.packageLabel}
                            </div>
                          )}
                        </div>
                      }
                      className="py-2 border-bottom"
                    />
                  ))}
                </div>
              )}
            </div>
            <div className="bottom-sheet-footer">
              <div />
              <AppButton
                variant="primary"
                size="sm"
                onClick={handleConfirmSearch}
                disabled={!selectedDrugName}
              >
                この薬品で検索
              </AppButton>
            </div>
          </div>
        </>
      )}
    </>
  );
}
