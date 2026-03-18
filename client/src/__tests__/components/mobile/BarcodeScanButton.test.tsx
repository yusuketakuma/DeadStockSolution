import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import BarcodeScanButton from '../../../components/mobile/BarcodeScanButton';

// Mock ToastContext
const mockShowWarning = vi.fn();
vi.mock('../../../contexts/ToastContext', () => ({
  useToast: () => ({
    showSuccess: vi.fn(),
    showError: vi.fn(),
    showWarning: mockShowWarning,
    showInfo: vi.fn(),
  }),
}));

// Mock API client
vi.mock('../../../api/client', () => ({
  api: {
    get: vi.fn(),
  },
}));

// Mock zxing-camera (dynamic import)
vi.mock('../../../lib/zxing-camera', () => ({
  NotFoundException: class NotFoundException extends Error {},
  createReader: vi.fn(() => ({})),
  startReaderWithFallback: vi.fn(() => Promise.resolve({
    stop: vi.fn(),
  })),
}));

describe('BarcodeScanButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders camera icon button', () => {
    render(<BarcodeScanButton onScanResult={vi.fn()} />);

    const button = screen.getByRole('button', { name: 'バーコードスキャン' });
    expect(button).toBeInTheDocument();
  });

  it('renders with d-lg-none class for mobile only', () => {
    render(<BarcodeScanButton onScanResult={vi.fn()} />);

    const button = screen.getByRole('button', { name: 'バーコードスキャン' });
    // The parent span has d-lg-none
    expect(button.closest('.d-lg-none')).toBeInTheDocument();
  });

  it('opens modal on click', async () => {
    const user = userEvent.setup();
    render(<BarcodeScanButton onScanResult={vi.fn()} />);

    const button = screen.getByRole('button', { name: 'バーコードスキャン' });
    await user.click(button);

    expect(screen.getByText('バーコードスキャン', { selector: '.modal-title' })).toBeInTheDocument();
  });

  it('closes modal when close button is clicked', async () => {
    const user = userEvent.setup();
    render(<BarcodeScanButton onScanResult={vi.fn()} />);

    // Open modal
    await user.click(screen.getByRole('button', { name: 'バーコードスキャン' }));
    expect(screen.getByText('バーコードスキャン', { selector: '.modal-title' })).toBeInTheDocument();

    // Close modal
    const closeButton = screen.getByRole('button', { name: 'Close' });
    await user.click(closeButton);

    // Modal should be closed (title no longer visible)
    await vi.waitFor(() => {
      expect(screen.queryByText('バーコードスキャン', { selector: '.modal-title' })).not.toBeInTheDocument();
    });
  });
});
