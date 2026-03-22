import type { Express } from 'express';
import helmet from 'helmet';

/**
 * Sentry DSN からホスト部分を抽出して connectSrc に追加するためのヘルパー。
 * 例: "https://abc@o123.ingest.sentry.io/456" → "https://o123.ingest.sentry.io"
 */
function extractSentryOrigin(dsn: string): string | null {
  try {
    const url = new URL(dsn);
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

export function setupSecurity(app: Express): void {
  // Report-To ヘッダー: CSP_REPORT_URI が設定されている場合のみ出力（Helmet より前に配置）
  const cspReportUri = process.env.CSP_REPORT_URI ?? null;
  if (cspReportUri) {
    app.use((_req, res, next) => {
      res.setHeader(
        'Report-To',
        JSON.stringify({
          group: 'csp-endpoint',
          max_age: 10886400,
          endpoints: [{ url: cspReportUri }],
        }),
      );
      next();
    });
  }

  // connectSrc: SENTRY_DSN が設定されている場合は Sentry のオリジンを追加
  const connectSrcDirective: string[] = ["'self'"];
  const sentryDsn = process.env.SENTRY_DSN ?? null;
  if (sentryDsn) {
    const sentryOrigin = extractSentryOrigin(sentryDsn);
    if (sentryOrigin) {
      connectSrcDirective.push(sentryOrigin);
    }
  }

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "blob:"],
        mediaSrc: ["'self'", "blob:"],
        workerSrc: ["'self'", "blob:"],
        connectSrc: connectSrcDirective,
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: [],
        ...(cspReportUri
          ? {
              reportUri: [cspReportUri],
              reportTo: ['csp-endpoint'],
            }
          : {}),
      },
    },
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    // 3省2ガイドライン §13.3: 通信の暗号化 — HSTS を明示的に設定
    strictTransportSecurity: {
      maxAge: 31536000,       // 1年
      includeSubDomains: true,
      preload: true,
    },
  }));

  // Permissions-Policy は Helmet が直接サポートしていないためカスタムミドルウェアで追加
  // camera=(self): カメラは自分のオリジンからのみ許可（バーコードスキャン機能で使用）
  app.use((_req, res, next) => {
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=(), payment=()');
    next();
  });
}
