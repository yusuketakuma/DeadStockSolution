import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BarcodeScanButton from '../../../components/mobile/BarcodeScanButton';

let lastResolveCode: ((code: string) => Promise<unknown>) | null = null;
const {
  mockShowWarning,
  stopCameraMock,
  handleStartCameraMock,
  handleToggleTorchMock,
  triggerFeedbackMock,
  apiGetMock,
  apiPostMock,
} = vi.hoisted(() => ({
  mockShowWarning: vi.fn(),
  stopCameraMock: vi.fn(),
  handleStartCameraMock: vi.fn().mockResolvedValue(undefined),
  handleToggleTorchMock: vi.fn().mockResolvedValue(undefined),
  triggerFeedbackMock: vi.fn(),
  apiGetMock: vi.fn(),
  apiPostMock: vi.fn(),
}));

vi.mock('../../../contexts/ToastContext', () => ({
  useToast: () => ({
    showSuccess: vi.fn(),
    showError: vi.fn(),
    showWarning: mockShowWarning,
    showInfo: vi.fn(),
  }),
}));

vi.mock('../../../api/client', () => ({
  api: {
    get: apiGetMock,
    post: apiPostMock,
  },
}));

vi.mock('../../../hooks/useScanFeedback', () => ({
  useScanFeedback: () => ({
    triggerFeedback: triggerFeedbackMock,
    scanFlashType: null,
    soundEnabled: true,
    toggleSound: vi.fn(),
    ensureAudioContext: vi.fn(),
  }),
}));

vi.mock('../../../hooks/useCamera', () => ({
  useCamera: (options: { onResolveCode: (code: string) => Promise<unknown> }) => {
    lastResolveCode = options.onResolveCode;
    return {
      cameraActive: true,
      cameraError: '',
      cameraBusy: false,
      torchSupported: false,
      torchEnabled: false,
      torchBusy: false,
      videoRef: { current: document.createElement('video') },
      frameCanvasRef: { current: document.createElement('canvas') },
      stopCamera: stopCameraMock,
      handleStartCamera: handleStartCameraMock,
      handleToggleTorch: handleToggleTorchMock,
    };
  },
}));

describe('BarcodeScanButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastResolveCode = null;
    handleStartCameraMock.mockResolvedValue(undefined);
    handleToggleTorchMock.mockResolvedValue(undefined);
  });

  it('renders camera icon button', () => {
    render(<BarcodeScanButton onScanResult={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'バーコードスキャン' })).toBeInTheDocument();
  });

  it('renders with d-lg-none class for mobile only', () => {
    render(<BarcodeScanButton onScanResult={vi.fn()} />);

    const button = screen.getByRole('button', { name: 'バーコードスキャン' });
    expect(button.closest('.d-lg-none')).toBeInTheDocument();
  });

  it('opens fullscreen camera on click', async () => {
    const user = userEvent.setup();
    render(<BarcodeScanButton onScanResult={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'バーコードスキャン' }));

    expect(screen.getByLabelText('カメラを閉じる')).toBeInTheDocument();
    expect(handleStartCameraMock).toHaveBeenCalledTimes(1);
  });

  it('closes fullscreen camera when close button is clicked', async () => {
    const user = userEvent.setup();
    render(<BarcodeScanButton onScanResult={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'バーコードスキャン' }));
    await user.click(screen.getByLabelText('カメラを閉じる'));

    expect(screen.queryByLabelText('カメラを閉じる')).not.toBeInTheDocument();
    expect(stopCameraMock).toHaveBeenCalledTimes(1);
  });

  it('stops live scanning before showing barcode candidates', async () => {
    const user = userEvent.setup();
    apiPostMock.mockResolvedValue({
      codeType: 'yj',
      parsed: {
        gtin: null,
        yjCode: '1234567890123',
        expirationDate: null,
        lotNumber: null,
      },
      match: {
        drugMasterId: 10,
        drugMasterPackageId: null,
        drugName: 'テスト薬',
        yjCode: '1234567890123',
        gs1Code: null,
        janCode: null,
        packageLabel: 'PTP 100T',
        unit: '錠',
        yakkaUnitPrice: 100,
      },
      warnings: [],
    });
    apiGetMock.mockResolvedValue({ data: [] });

    render(<BarcodeScanButton onScanResult={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'バーコードスキャン' }));

    await act(async () => {
      await lastResolveCode?.('1234567890123');
    });

    expect(stopCameraMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText('スキャン結果')).toBeInTheDocument();
    expect(screen.getByText('テスト薬')).toBeInTheDocument();
  });
});
