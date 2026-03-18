import * as Sentry from '@sentry/node';

// 3省2ガイドライン準拠: PII（個人情報）をSentryに送信しない
// email, name, address, phone, fax 等を除去する
function scrubPii(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  // user コンテキストから PII を除去
  if (event.user) {
    delete event.user.email;
    delete event.user.username;
    delete (event.user as Record<string, unknown>).name;
    delete event.user.ip_address;
  }

  // extra/contexts 内の PII フィールドを除去
  const piiKeys = ['email', 'pharmacyEmail', 'pharmacyName', 'name', 'phone', 'fax', 'address', 'postalCode', 'licenseNumber'];
  if (event.extra) {
    for (const key of piiKeys) {
      delete (event.extra as Record<string, unknown>)[key];
    }
  }
  if (event.contexts) {
    for (const ctx of Object.values(event.contexts)) {
      if (ctx && typeof ctx === 'object') {
        for (const key of piiKeys) {
          delete (ctx as Record<string, unknown>)[key];
        }
      }
    }
  }

  return event;
}

export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    tracesSampleRate: 0.1,
    beforeSend(event) {
      return scrubPii(event);
    },
  });
}

export function captureException(err: unknown): string | null {
  if (!process.env.SENTRY_DSN) return null;
  return Sentry.captureException(err);
}
