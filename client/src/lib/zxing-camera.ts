import { BrowserMultiFormatReader } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType, NotFoundException } from '@zxing/library';

const ZXING_RSS_WARNING = 'RSS Expanded reader IS NOT ready for production yet! use at your own risk.';

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

export { NotFoundException };

export type ScannerControlsLike = {
  stop: () => void;
  switchTorch?: (enabled: boolean) => Promise<void>;
};

export type ZxingDecodeResult = { getText: () => string } | null | undefined;
export type ZxingDecodeError = Error | null | undefined;
export type ZxingDecodeCallback = (result: ZxingDecodeResult, error: ZxingDecodeError) => void;

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

export function createReader(): BrowserMultiFormatReader {
  const hints = new Map<DecodeHintType, unknown>();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, POSSIBLE_FORMATS);
  const currentWarn = console.warn;
  console.warn = (message?: unknown, ...args: unknown[]) => {
    if (message === ZXING_RSS_WARNING) {
      return;
    }
    currentWarn(message, ...args);
  };
  try {
    return new BrowserMultiFormatReader(hints, {
      delayBetweenScanAttempts: 180,
      delayBetweenScanSuccess: 600,
    });
  } finally {
    console.warn = currentWarn;
  }
}

export async function startReaderWithFallback(
  reader: BrowserMultiFormatReader,
  videoElement: HTMLVideoElement,
  onDecode: ZxingDecodeCallback,
): Promise<ScannerControlsLike> {
  try {
    return await reader.decodeFromConstraints(CAMERA_CONSTRAINTS_PREFERRED, videoElement, onDecode);
  } catch (error) {
    if (!isOverconstrainedError(error)) {
      throw error;
    }
    return reader.decodeFromConstraints(CAMERA_CONSTRAINTS_FALLBACK, videoElement, onDecode);
  }
}

export function detectWithZxingCanvas(
  canvas: HTMLCanvasElement,
  normalizeCodeInput: (value: string) => string,
): string[] {
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
}
