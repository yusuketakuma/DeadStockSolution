import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCamera } from '../useCamera';

const decodeFromConstraintsMock = vi.fn();

vi.mock('@zxing/library', () => ({
  BarcodeFormat: {
    DATA_MATRIX: 1,
    CODE_128: 2,
    EAN_13: 3,
    EAN_8: 4,
    ITF: 5,
    RSS_14: 6,
    RSS_EXPANDED: 7,
    QR_CODE: 8,
  },
  DecodeHintType: {
    POSSIBLE_FORMATS: 2,
  },
  NotFoundException: class NotFoundException extends Error {},
}));

vi.mock('@zxing/browser', () => ({
  BrowserMultiFormatReader: class BrowserMultiFormatReader {
    decodeFromConstraints = decodeFromConstraintsMock;
    decodeFromCanvas = vi.fn();
  },
}));

describe('useCamera', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'isSecureContext', {
      configurable: true,
      value: true,
    });
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn(),
      },
    });
  });

  it('keeps decoded code queued while resolving and drains later', async () => {
    let decodeCallback: ((result: { getText: () => string } | null, error: unknown) => void) | null = null;
    decodeFromConstraintsMock.mockImplementation(async (_constraints, _video, callback) => {
      decodeCallback = callback;
      return {
        stop: vi.fn(),
        switchTorch: vi.fn(),
      };
    });

    const onResolveCode = vi.fn().mockResolvedValue('added');
    const onError = vi.fn();
    const onInfo = vi.fn();

    const { result, rerender } = renderHook(
      ({ resolving }) => useCamera({
        resolving,
        submitting: false,
        normalizeCodeInput: (value) => value.trim(),
        onResolveCode,
        onError,
        onInfo,
      }),
      { initialProps: { resolving: true } },
    );

    result.current.videoRef.current = document.createElement('video');

    await act(async () => {
      await result.current.handleStartCamera();
    });

    expect(decodeCallback).not.toBeNull();

    await act(async () => {
      decodeCallback?.({ getText: () => 'ABC-001' }, null);
      await Promise.resolve();
    });

    expect(onResolveCode).toHaveBeenCalledTimes(0);

    rerender({ resolving: false });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onResolveCode).toHaveBeenCalledTimes(1);
    expect(onResolveCode).toHaveBeenCalledWith('ABC-001');
  });
});
