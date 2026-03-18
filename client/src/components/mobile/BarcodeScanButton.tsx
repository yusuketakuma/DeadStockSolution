import { useCallback, useRef, useState } from 'react';
import { Modal } from 'react-bootstrap';
import AppButton from '../ui/AppButton';
import CameraViewport from '../camera/CameraViewport';
import { useToast } from '../../contexts/ToastContext';
import { api } from '../../api/client';
import { normalizeCodeInput } from '../../hooks/useBarcodeResolver';

interface BarcodeScanButtonProps {
  onScanResult: (drugName: string) => void;
}

interface ScannerControlsLike {
  stop: () => void;
  switchTorch?: (enabled: boolean) => Promise<void>;
}

type ZxingDecodeCallback = (
  result: { getText: () => string } | null | undefined,
  error?: { message?: string } | null | undefined,
) => void;

const NOT_FOUND_MESSAGE = 'このバーコードに対応する薬品が見つかりません';

export default function BarcodeScanButton({ onScanResult }: BarcodeScanButtonProps) {
  const [open, setOpen] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [resolving, setResolving] = useState(false);
  const { showWarning } = useToast();

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const controlsRef = useRef<ScannerControlsLike | null>(null);
  const sessionRef = useRef(0);

  const stopCamera = useCallback(() => {
    sessionRef.current += 1;
    controlsRef.current?.stop();
    controlsRef.current = null;
    const videoElement = videoRef.current;
    const stream = videoElement?.srcObject;
    if (videoElement && stream && typeof (stream as MediaStream).getTracks === 'function') {
      (stream as MediaStream).getTracks().forEach((track) => track.stop());
      videoElement.srcObject = null;
    }
    setCameraActive(false);
  }, []);

  const handleClose = useCallback(() => {
    stopCamera();
    setOpen(false);
    setCameraError('');
    setResolving(false);
  }, [stopCamera]);

  const resolveBarcodeToDrugName = useCallback(async (rawCode: string): Promise<string | null> => {
    const code = normalizeCodeInput(rawCode);
    if (!code) return null;
    try {
      const results = await api.get<string[]>(`/search/drugs?q=${encodeURIComponent(code)}`);
      return results.length > 0 ? results[0] : null;
    } catch {
      return null;
    }
  }, []);

  const handleDetected = useCallback(async (text: string, sessionId: number) => {
    if (sessionId !== sessionRef.current) return;
    if (resolving) return;

    setResolving(true);
    try {
      const drugName = await resolveBarcodeToDrugName(text);
      if (sessionId !== sessionRef.current) return;

      if (drugName) {
        onScanResult(drugName);
        handleClose();
      } else {
        showWarning(NOT_FOUND_MESSAGE);
      }
    } finally {
      setResolving(false);
    }
  }, [handleClose, onScanResult, resolveBarcodeToDrugName, resolving, showWarning]);

  const startCamera = useCallback(async () => {
    if (cameraActive) return;
    const videoElement = videoRef.current;
    if (!videoElement) {
      setCameraError('カメラ初期化に失敗しました');
      return;
    }
    if (!window.isSecureContext) {
      setCameraError('カメラ利用にはHTTPS接続が必要です');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('このブラウザはカメラ機能に対応していません');
      return;
    }

    setCameraError('');
    const sessionId = sessionRef.current + 1;
    sessionRef.current = sessionId;

    try {
      const { NotFoundException, createReader, startReaderWithFallback } = await import('../../lib/zxing-camera');
      const reader = createReader();
      const onDecode: ZxingDecodeCallback = (result, decodeError) => {
        if (result) {
          void handleDetected(result.getText(), sessionId);
          return;
        }
        if (decodeError && !(decodeError instanceof NotFoundException)) {
          setCameraError(decodeError.message || 'カメラ読取に失敗しました');
        }
      };

      const controls = await startReaderWithFallback(reader, videoElement, onDecode);
      controlsRef.current = controls;
      setCameraActive(true);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'NotAllowedError') {
        setCameraError('カメラ権限が拒否されました。ブラウザ設定から許可してください');
      } else if (err instanceof DOMException && err.name === 'NotFoundError') {
        setCameraError('利用可能なカメラが見つかりません');
      } else {
        setCameraError(err instanceof Error ? err.message : 'カメラ起動に失敗しました');
      }
    }
  }, [cameraActive, handleDetected]);

  const handleOpen = useCallback(() => {
    setOpen(true);
  }, []);

  const handleEntered = useCallback(() => {
    void startCamera();
  }, [startCamera]);

  return (
    <>
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
          onClick={handleOpen}
          aria-label="バーコードスキャン"
          className="p-0 text-muted"
        >
          <i className="bi bi-camera" style={{ fontSize: '1.2rem' }} />
        </AppButton>
      </span>

      <Modal
        show={open}
        onHide={handleClose}
        onEntered={handleEntered}
        fullscreen
        className="d-lg-none"
      >
        <Modal.Header closeButton>
          <Modal.Title className="fs-6">バーコードスキャン</Modal.Title>
        </Modal.Header>
        <Modal.Body className="p-0 bg-dark d-flex flex-column">
          <CameraViewport
            videoRef={videoRef}
            canvasRef={canvasRef}
            cameraActive={cameraActive}
            cameraError={cameraError}
            fullscreen={false}
          />
          {resolving && (
            <div className="text-center text-light py-3">
              <div className="spinner-border spinner-border-sm me-2" role="status" />
              薬品を検索中...
            </div>
          )}
          {!cameraActive && !cameraError && (
            <div className="text-center text-light py-3">
              カメラを起動中...
            </div>
          )}
        </Modal.Body>
      </Modal>
    </>
  );
}
