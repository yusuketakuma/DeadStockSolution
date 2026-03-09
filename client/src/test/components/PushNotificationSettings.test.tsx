import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PushNotificationSettings from '../../components/account/PushNotificationSettings';
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

describe('PushNotificationSettings', () => {
  it('renders subscribe button when prompt', () => {
    render(<PushNotificationSettings />);

    expect(screen.getByText('プッシュ通知設定')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'プッシュ通知を有効にする' })).toBeInTheDocument();
  });

  it('shows enabled state with unsubscribe button when granted', () => {
    vi.mocked(usePushSubscription).mockReturnValue({
      permissionState: 'granted',
      isSupported: true,
      subscribing: false,
      error: '',
      subscribe: mockSubscribe,
      unsubscribe: mockUnsubscribe,
    });

    render(<PushNotificationSettings />);

    expect(screen.getByText(/プッシュ通知は有効です/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'プッシュ通知を無効にする' })).toBeInTheDocument();
  });

  it('calls unsubscribe when disable button clicked', async () => {
    const user = userEvent.setup();
    vi.mocked(usePushSubscription).mockReturnValue({
      permissionState: 'granted',
      isSupported: true,
      subscribing: false,
      error: '',
      subscribe: mockSubscribe,
      unsubscribe: mockUnsubscribe,
    });

    render(<PushNotificationSettings />);

    await user.click(screen.getByRole('button', { name: 'プッシュ通知を無効にする' }));
    expect(mockUnsubscribe).toHaveBeenCalled();
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

    const { container } = render(<PushNotificationSettings />);
    expect(container.firstChild).toBeNull();
  });

  it('shows denied state with guidance', () => {
    vi.mocked(usePushSubscription).mockReturnValue({
      permissionState: 'denied',
      isSupported: true,
      subscribing: false,
      error: '',
      subscribe: mockSubscribe,
      unsubscribe: mockUnsubscribe,
    });

    render(<PushNotificationSettings />);

    expect(screen.getByText(/プッシュ通知がブラウザでブロックされています/)).toBeInTheDocument();
    expect(screen.getByText(/ブラウザの設定からこのサイトの通知を許可してください/)).toBeInTheDocument();
  });

  it('shows error when present', () => {
    vi.mocked(usePushSubscription).mockReturnValue({
      permissionState: 'prompt',
      isSupported: true,
      subscribing: false,
      error: 'エラーが発生しました',
      subscribe: mockSubscribe,
      unsubscribe: mockUnsubscribe,
    });

    render(<PushNotificationSettings />);
    expect(screen.getByText('エラーが発生しました')).toBeInTheDocument();
  });
});
