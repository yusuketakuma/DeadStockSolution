import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { usePushSubscription } from '../../hooks/usePushSubscription';

// Mock api client
vi.mock('../../api/client', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

import { api } from '../../api/client';

const mockGetSubscription = vi.fn();
const mockSubscribe = vi.fn();
const mockUnsubscribe = vi.fn();

function setupPushManagerSupported(opts: {
  existingSubscription?: PushSubscription | null;
  notificationPermission?: NotificationPermission;
} = {}) {
  const { existingSubscription = null, notificationPermission = 'default' } = opts;

  mockGetSubscription.mockResolvedValue(existingSubscription);
  mockSubscribe.mockResolvedValue({
    endpoint: 'https://push.example.com/sub/123',
    toJSON: () => ({
      endpoint: 'https://push.example.com/sub/123',
      keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
    }),
    unsubscribe: mockUnsubscribe.mockResolvedValue(true),
  });

  Object.defineProperty(window, 'PushManager', { value: class {}, writable: true, configurable: true });
  Object.defineProperty(navigator, 'serviceWorker', {
    value: {
      ready: Promise.resolve({
        pushManager: {
          getSubscription: mockGetSubscription,
          subscribe: mockSubscribe,
        },
      }),
    },
    writable: true,
    configurable: true,
  });
  Object.defineProperty(window, 'Notification', {
    value: { permission: notificationPermission },
    writable: true,
    configurable: true,
  });
}

function removePushManagerSupport() {
  // @ts-expect-error removing PushManager from window
  delete window.PushManager;
}

describe('usePushSubscription', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    removePushManagerSupport();
  });

  afterEach(() => {
    removePushManagerSupport();
  });

  it('returns unsupported when PushManager is not available', async () => {
    const { result } = renderHook(() => usePushSubscription());

    await waitFor(() => {
      expect(result.current.permissionState).toBe('unsupported');
    });
    expect(result.current.isSupported).toBe(false);
  });

  it('returns prompt when no existing subscription', async () => {
    setupPushManagerSupported();

    const { result } = renderHook(() => usePushSubscription());

    await waitFor(() => {
      expect(result.current.permissionState).toBe('prompt');
    });
    expect(result.current.isSupported).toBe(true);
  });

  it('returns granted when existing subscription found', async () => {
    const mockSub = { endpoint: 'https://push.example.com/sub/123' } as PushSubscription;
    setupPushManagerSupported({ existingSubscription: mockSub });

    const { result } = renderHook(() => usePushSubscription());

    await waitFor(() => {
      expect(result.current.permissionState).toBe('granted');
    });
  });

  it('returns denied when Notification.permission is denied', async () => {
    setupPushManagerSupported({ notificationPermission: 'denied' });

    const { result } = renderHook(() => usePushSubscription());

    await waitFor(() => {
      expect(result.current.permissionState).toBe('denied');
    });
  });

  it('subscribes successfully', async () => {
    setupPushManagerSupported();
    vi.mocked(api.get).mockResolvedValue({ publicKey: 'BTEST_VAPID_KEY' });
    vi.mocked(api.post).mockResolvedValue({});

    const { result } = renderHook(() => usePushSubscription());

    await waitFor(() => {
      expect(result.current.permissionState).toBe('prompt');
    });

    await act(async () => {
      await result.current.subscribe();
    });

    expect(api.get).toHaveBeenCalledWith('/push/vapid-public-key');
    expect(mockSubscribe).toHaveBeenCalled();
    expect(api.post).toHaveBeenCalledWith('/push/subscribe', {
      endpoint: 'https://push.example.com/sub/123',
      keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
    });
    expect(result.current.permissionState).toBe('granted');
  });

  it('unsubscribes successfully', async () => {
    const mockSub = {
      endpoint: 'https://push.example.com/sub/123',
      unsubscribe: mockUnsubscribe.mockResolvedValue(true),
    } as unknown as PushSubscription;
    setupPushManagerSupported({ existingSubscription: mockSub });
    vi.mocked(api.delete).mockResolvedValue({});

    // Override getSubscription to return subscription for unsubscribe
    mockGetSubscription.mockResolvedValue(mockSub);

    const { result } = renderHook(() => usePushSubscription());

    await waitFor(() => {
      expect(result.current.permissionState).toBe('granted');
    });

    await act(async () => {
      await result.current.unsubscribe();
    });

    expect(api.delete).toHaveBeenCalledWith('/push/subscribe', {
      endpoint: 'https://push.example.com/sub/123',
    });
    expect(mockUnsubscribe).toHaveBeenCalled();
    expect(result.current.permissionState).toBe('prompt');
  });

  it('sets error on subscribe failure', async () => {
    setupPushManagerSupported();
    vi.mocked(api.get).mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => usePushSubscription());

    await waitFor(() => {
      expect(result.current.permissionState).toBe('prompt');
    });

    await act(async () => {
      await result.current.subscribe();
    });

    expect(result.current.error).toBe('Network error');
    expect(result.current.subscribing).toBe(false);
  });
});
