/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />
/// <reference types="vite-plugin-pwa/react" />
/// <reference types="vite-plugin-pwa/info" />

declare const __APP_VERSION__: string;
declare const __VERCEL_ENV__: string;

interface ImportMetaEnv {
  readonly VITE_APP_VERSION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module '*.css';


declare module 'workbox-expiration' {
  export class ExpirationPlugin {
    constructor(config?: { maxEntries?: number; maxAgeSeconds?: number });
  }
}

declare module 'workbox-precaching' {
  export function precacheAndRoute(entries: Array<string | { url: string; revision: string | null }>): void;
  export function matchPrecache(url: string): Promise<Response | undefined>;
}

declare module 'workbox-routing' {
  export function registerRoute(
    match: (params: { url: URL; request: Request; event?: ExtendableEvent }) => boolean,
    handler: object,
  ): void;
  export function setCatchHandler(handler: (params: { request: Request; event?: ExtendableEvent }) => Promise<Response>): void;
}

declare module 'workbox-strategies' {
  export class CacheFirst {
    constructor(config?: { cacheName?: string; plugins?: object[] });
  }
  export class StaleWhileRevalidate {
    constructor(config?: { cacheName?: string; plugins?: object[] });
  }
}
