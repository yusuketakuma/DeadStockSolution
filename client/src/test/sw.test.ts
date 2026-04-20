import { beforeEach, describe, expect, it, vi } from 'vitest';

const registerRoute = vi.fn();

vi.mock('workbox-expiration', () => ({
  ExpirationPlugin: class ExpirationPlugin {},
}));

vi.mock('workbox-precaching', () => ({
  precacheAndRoute: vi.fn(),
  matchPrecache: vi.fn(),
}));

vi.mock('workbox-routing', () => ({
  registerRoute,
  setCatchHandler: vi.fn(),
}));

vi.mock('workbox-strategies', () => ({
  CacheFirst: class CacheFirst {},
}));

type NotificationClickHandler = (event: NotificationEvent) => void;

describe('service worker notification clicks', () => {
  let notificationClickHandler: NotificationClickHandler | undefined;
  let matchAll: ReturnType<typeof vi.fn>;
  let openWindow: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    registerRoute.mockReset();
    notificationClickHandler = undefined;
    matchAll = vi.fn();
    openWindow = vi.fn();

    Object.defineProperty(globalThis, 'self', {
      configurable: true,
      writable: true,
      value: {
        skipWaiting: vi.fn(),
        __WB_MANIFEST: [],
        location: { origin: 'https://app.example' },
        registration: {
          showNotification: vi.fn(),
        },
        clients: {
          matchAll,
          openWindow,
        },
        addEventListener: vi.fn((type: string, listener: EventListenerOrEventListenerObject) => {
          if (type === 'notificationclick' && typeof listener === 'function') {
            notificationClickHandler = listener as NotificationClickHandler;
          }
        }),
      },
    });

    await import('../sw');
  });

  function createNotificationEvent(url: string): {
    event: NotificationEvent;
    close: ReturnType<typeof vi.fn>;
    waitUntil: ReturnType<typeof vi.fn>;
  } {
    const close = vi.fn();
    const waitUntil = vi.fn();
    const event = {
      notification: {
        close,
        data: { url },
      },
      waitUntil,
    } as unknown as NotificationEvent;

    return { event, close, waitUntil };
  }

  function routeMatchesRequest(url: string, request: Pick<Request, 'destination' | 'method' | 'mode'>): boolean {
    const parsedUrl = new URL(url);
    return registerRoute.mock.calls.some(([matcher]) => {
      if (typeof matcher !== 'function') return false;
      return matcher({ url: parsedUrl, request });
    });
  }

  it('rejects cross-origin notification URLs', () => {
    const { event, close, waitUntil } = createNotificationEvent('https://evil.example/phish');

    notificationClickHandler?.(event);

    expect(close).toHaveBeenCalledTimes(1);
    expect(waitUntil).not.toHaveBeenCalled();
    expect(matchAll).not.toHaveBeenCalled();
    expect(openWindow).not.toHaveBeenCalled();
  });

  it('opens a new window instead of focusing a substring match', async () => {
    const focus = vi.fn();
    matchAll.mockResolvedValue([
      {
        url: 'https://app.example/redirect?next=https://app.example/dashboard',
        focus,
      },
    ]);
    openWindow.mockResolvedValue(null);

    const { event, waitUntil } = createNotificationEvent('/dashboard');

    notificationClickHandler?.(event);

    expect(waitUntil).toHaveBeenCalledTimes(1);
    await waitUntil.mock.calls[0][0];

    expect(focus).not.toHaveBeenCalled();
    expect(openWindow).toHaveBeenCalledWith('https://app.example/dashboard');
  });

  it('focuses an exact URL match', async () => {
    const focusResult = Promise.resolve(null);
    const focus = vi.fn(() => focusResult);
    matchAll.mockResolvedValue([
      {
        url: 'https://app.example/dashboard',
        focus,
      },
    ]);

    const { event, waitUntil } = createNotificationEvent('/dashboard');

    notificationClickHandler?.(event);

    expect(waitUntil).toHaveBeenCalledTimes(1);
    await waitUntil.mock.calls[0][0];

    expect(focus).toHaveBeenCalledTimes(1);
    expect(openWindow).not.toHaveBeenCalled();
  });

  it('does not cache private API requests', () => {
    expect(routeMatchesRequest('https://app.example/api/admin/logs', {
      destination: '',
      method: 'GET',
      mode: 'same-origin',
    })).toBe(false);

    expect(routeMatchesRequest('https://app.example/api/account', {
      destination: '',
      method: 'GET',
      mode: 'same-origin',
    })).toBe(false);
  });
});
