/**
 * Workers 用 @sentry/node シム。
 * 初期化は worker エントリの withSentry が行うため init は何もしない。
 * それ以外の API は @sentry/cloudflare をそのまま使う。
 */
export * from '@sentry/cloudflare';

export function init(): void {}
