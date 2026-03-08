/// <reference lib="WebWorker" />

import { ExpirationPlugin } from 'workbox-expiration';
import { precacheAndRoute, matchPrecache } from 'workbox-precaching';
import { registerRoute, setCatchHandler } from 'workbox-routing';
import { CacheFirst, StaleWhileRevalidate } from 'workbox-strategies';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<string | { url: string; revision: string | null }> };

// Injected by vite-plugin-pwa at build time
precacheAndRoute(self.__WB_MANIFEST);

registerRoute(
  ({ request }: { request: Request }) =>
    request.destination === 'script' ||
    request.destination === 'style' ||
    request.destination === 'font',
  new CacheFirst({
    cacheName: 'static-assets',
    plugins: [
      new ExpirationPlugin({
        maxAgeSeconds: 30 * 24 * 60 * 60,
      }),
    ],
  })
);

registerRoute(
  ({ url, request }: { url: URL; request: Request }) =>
    request.method === 'GET' &&
    url.pathname.startsWith('/api/') &&
    !url.pathname.startsWith('/api/auth/') &&
    !url.pathname.startsWith('/api/push/') &&
    !url.pathname.includes('/api/csrf-token'),
  new StaleWhileRevalidate({
    cacheName: 'api-responses',
    plugins: [
      new ExpirationPlugin({
        maxEntries: 50,
      }),
    ],
  })
);

registerRoute(
  ({ request }: { request: Request }) => request.destination === 'image',
  new CacheFirst({
    cacheName: 'images',
    plugins: [
      new ExpirationPlugin({
        maxEntries: 100,
        maxAgeSeconds: 7 * 24 * 60 * 60,
      }),
    ],
  })
);

setCatchHandler(async ({ request }: { request: Request }) => {
  if (request.mode === 'navigate') {
    return (await matchPrecache('/offline.html')) ?? Response.error();
  }

  return Response.error();
});

self.addEventListener('push', (event: PushEvent) => {
  const data = event.data?.json() ?? {};
  const title = data.title ?? '通知';
  const options: NotificationOptions = {
    body: data.body,
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-192x192.png',
    data: data.data,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close();

  const notificationData = event.notification.data as { url?: string } | undefined;
  const targetUrl = notificationData?.url;

  if (!targetUrl) {
    return;
  }

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList: readonly WindowClient[]) => {
      for (const client of clientList) {
        if (client.url.includes(targetUrl) && 'focus' in client) {
          return client.focus();
        }
      }

      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }

      return undefined;
    })
  );
});
