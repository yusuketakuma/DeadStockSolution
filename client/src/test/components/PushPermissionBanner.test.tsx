import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PushPermissionBanner from '../../components/push/PushPermissionBanner';
import type { PushPermissionState } from '../../hooks/usePushSubscription';

const mockSubscribe = vi.fn();
const mockUnsubscribe = vi.fn();

vi.mock('../../hooks/usePushSubscription', () => ({
  usePushSubscription: vi.fn(() => ({
    permissionState: 'prompt' as PushPermissionState,
    isSupported: true,
    subscribing: false,
    error: '',
    subscribe: mockSubscribe,
    unsubscribe: mockUnsubscribe,
  })),
}));

import { usePushSubscription } from '../../hooks/usePushSubscription';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PushPermissionBanner', () => {
  it('shows subscribe banner when permission is prompt', () => {
    render(<PushPermissionBanner />);

    expect(screen.getByText('プッシュ通知を有効にする')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '有効にする' })).toBeInTheDocument();
  });

  it('calls subscribe when button clicked', async () => {
    const user = userEvent.setup();
    render(<PushPermissionBanner />);

    await user.click(screen.getByRole('button', { name: '有効にする' }));
    expect(mockSubscribe).toHaveBeenCalled();
  });

  it('hides when unsupported', () => {
    vi.mocked(usePushSubscription).mockReturnValue({
      permissionState: 'unsupported',
      isSupported: false,
      subscribing: false,
      error: '',
      subscribe: mockSubscribe,
      unsubscribe: mockUnsubscribe,
    });

    const { container } = render(<PushPermissionBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('hides when granted', () => {
    vi.mocked(usePushSubscription).mockReturnValue({
      permissionState: 'granted',
      isSupported: true,
      subscribing: false,
      error: '',
      subscribe: mockSubscribe,
      unsubscribe: mockUnsubscribe,
    });

    const { container } = render(<PushPermissionBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('hides when loading', () => {
    vi.mocked(usePushSubscription).mockReturnValue({
      permissionState: 'loading',
      isSupported: true,
      subscribing: false,
      error: '',
      subscribe: mockSubscribe,
      unsubscribe: mockUnsubscribe,
    });

    const { container } = render(<PushPermissionBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('shows browser settings guidance when denied', () => {
    vi.mocked(usePushSubscription).mockReturnValue({
      permissionState: 'denied',
      isSupported: true,
      subscribing: false,
      error: '',
      subscribe: mockSubscribe,
      unsubscribe: mockUnsubscribe,
    });

    render(<PushPermissionBanner />);
    expect(screen.getByText('プッシュ通知がブロックされています')).toBeInTheDocument();
    expect(screen.getByText(/ブラウザの設定からこのサイトの通知を許可してください/)).toBeInTheDocument();
  });

  it('shows error message when error exists', () => {
    vi.mocked(usePushSubscription).mockReturnValue({
      permissionState: 'prompt',
      isSupported: true,
      subscribing: false,
      error: 'プッシュ通知の登録に失敗しました',
      subscribe: mockSubscribe,
      unsubscribe: mockUnsubscribe,
    });

    render(<PushPermissionBanner />);
    expect(screen.getByText('プッシュ通知の登録に失敗しました')).toBeInTheDocument();
  });

  it('disables button while subscribing', () => {
    vi.mocked(usePushSubscription).mockReturnValue({
      permissionState: 'prompt',
      isSupported: true,
      subscribing: true,
      error: '',
      subscribe: mockSubscribe,
      unsubscribe: mockUnsubscribe,
    });

    render(<PushPermissionBanner />);
    const btn = screen.getByRole('button', { name: '設定中...' });
    expect(btn).toBeDisabled();
  });
});
