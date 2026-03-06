import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BarcodeFormat, DecodeHintType, NotFoundException } from '@zxing/library';
import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser';
import type { AppendOrUpdateRowResult } from './useBarcodeResolver';

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
const CAMERA_ERROR_UPDATE_MIN_INTERVAL_MS = 1200;

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

function getBarcodeDetectorConstructor(): BarcodeDetectorConstructorLike | null {
  const maybe = (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector;
  return typeof maybe === 'function' ? maybe as BarcodeDetectorConstructorLike : null;
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

function resolveCameraStartErrorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === 'NotAllowedError') {
    return 'カメラ権限が拒否されました。ブラウザ設定から許可してください';
  }
  if (error instanceof DOMException && error.name === 'NotFoundError') {
    return '利用可能なカメラが見つかりません';
  }
  return error instanceof Error ? error.message : 'カメラ起動に失敗しました';
}

function resolveErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function resolveCaptureResultInfo(addedCount: number): string {
  return `画像内コードを ${addedCount} 件追加しました。候補を確認して医薬品を確定してください。`;
}

interface UseCameraOptions {
  resolving: boolean;
  submitting: boolean;
  normalizeCodeInput: (value: string) => string;
  onResolveCode: (code: string) => Promise<AppendOrUpdateRowResult | null>;
  onError: (message: string) => void;
  onInfo: (message: string) => void;
}

export function useCamera({
  resolving,
  submitting,
  normalizeCodeInput,
  onResolveCode,
  onError,
  onInfo,
}: UseCameraOptions) {
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [cameraBusy, setCameraBusy] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchEnabled, setTorchEnabled] = useState(false);
  const [torchBusy, setTorchBusy] = useState(false);
  const [frameCapturing, setFrameCapturing] = useState(false);

  const controlsRef = useRef<IScannerControls | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const frameCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const barcodeDetectorRef = useRef<BarcodeDetectorLike | null>(null);
  const lastScanRef = useRef<{ text: string; at: number }>({ text: '', at: 0 });
  const lastCameraErrorRef = useRef<{ message: string; at: number }>({ message: '', at: 0 });
  const pendingCameraCodesRef = useRef(new Set<string>());
  const cameraSessionRef = useRef(0);
  const drainingCodesRef = useRef(false);

  const barcodeDetectorSupported = useMemo(() => getBarcodeDetectorConstructor() !== null, []);

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
  }, [normalizeCodeInput]);

  const drainPendingCodes = useCallback(async (sessionId: number) => {
    if (drainingCodesRef.current) {
      return;
    }
    drainingCodesRef.current = true;
    try {
      while (sessionId === cameraSessionRef.current && pendingCameraCodesRef.current.size > 0) {
        const nextCode = pendingCameraCodesRef.current.values().next().value;
        if (!nextCode) break;
        pendingCameraCodesRef.current.delete(nextCode);
        await onResolveCode(nextCode);
      }
    } finally {
      drainingCodesRef.current = false;
    }
  }, [onResolveCode]);

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
    if (resolving) {
      return;
    }
    await drainPendingCodes(sessionId);
  }, [drainPendingCodes, normalizeCodeInput, resolving]);

  useEffect(() => {
    if (resolving || !cameraActive || pendingCameraCodesRef.current.size === 0) {
      return;
    }
    void drainPendingCodes(cameraSessionRef.current);
  }, [cameraActive, drainPendingCodes, resolving]);

  const handleStartCamera = useCallback(async () => {
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
  }, [cameraActive, cameraBusy, handleDecodedFromCamera, setCameraErrorState, stopCamera]);

  const handleToggleTorch = useCallback(async () => {
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
  }, [setCameraErrorState, torchBusy, torchEnabled]);

  const handleCaptureFromFrame = useCallback(async () => {
    if (frameCapturing || resolving || submitting) return;
    if (!cameraActive) {
      onError('先に「カメラ開始」を押してから実行してください');
      return;
    }

    setFrameCapturing(true);
    onError('');
    onInfo('');
    try {
      const codes = await detectCodesFromCurrentFrame();
      if (codes.length === 0) {
        onError('画像内に読取可能なコードが見つかりませんでした');
        return;
      }

      let addedCount = 0;
      for (const code of codes) {
        const result = await onResolveCode(code);
        if (result === 'added') {
          addedCount += 1;
        }
      }
      onInfo(resolveCaptureResultInfo(addedCount));
    } catch (err) {
      onError(resolveErrorMessage(err, '画像からのコード検出に失敗しました'));
    } finally {
      setFrameCapturing(false);
    }
  }, [cameraActive, detectCodesFromCurrentFrame, frameCapturing, onError, onInfo, onResolveCode, resolving, submitting]);

  const clearPendingCameraCodes = useCallback(() => {
    pendingCameraCodesRef.current.clear();
  }, []);

  return {
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
  };
}
