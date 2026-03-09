import * as Sentry from '@sentry/react';

let sentryEnabled = false;

export function initSentry(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    tracesSampleRate: 0.1,
  });
  sentryEnabled = true;
}

export function isSentryEnabled(): boolean {
  return sentryEnabled;
}

export { Sentry };
