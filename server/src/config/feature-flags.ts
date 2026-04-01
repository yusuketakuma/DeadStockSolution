/**
 * Feature Flag Registry
 *
 * すべての環境変数ベースのフィーチャーフラグをここで一元管理します。
 * process.env はインポート時に一度だけ読み取りキャッシュされます。
 *
 * 既存コードはこのレジストリを参照していません（後方互換）。
 * 新規コードはこのレジストリを通じてフラグを参照してください。
 */

export interface FeatureFlag {
  /** 環境変数名 */
  key: string;
  /** フラグの説明 */
  description: string;
  /** 環境変数が未設定の場合のデフォルト値 */
  defaultValue: boolean;
  /**
   * このフラグが意図された環境。
   * ドキュメント目的であり、実行時の制限ではありません。
   * 実行時の制限が必要な場合は別途実装してください。
   */
  environments: ('development' | 'production' | 'test')[];
}

/**
 * フラグ定義マップ。
 * 各エントリのキーはコード内でのフラグ識別子、値はメタデータです。
 */
export const FLAGS = {
  /**
   * パスワードリセットトークンをレスポンスに含めるかどうか。
   * テスト環境でのみ有効にすること。本番で有効にすると起動時エラーになります。
   * @see server/src/routes/auth.ts
   */
  EXPOSE_PASSWORD_RESET_TOKEN: {
    key: 'EXPOSE_PASSWORD_RESET_TOKEN',
    description:
      'パスワードリセットトークンを API レスポンスに含めます。テスト環境専用フラグ。本番での有効化は禁止。',
    defaultValue: false,
    environments: ['test'],
  },

  /**
   * 分散レート制限（Upstash Redis）が未設定の場合にインメモリフォールバックを許可するか。
   * 本番で有効にするとレート制限保護が劣化しますが、Redis 未設定のままでも起動できます。
   * @see server/src/utils/distributed-rate-limiter.ts
   */
  ALLOW_IN_MEMORY_RATE_LIMIT_FALLBACK: {
    key: 'ALLOW_IN_MEMORY_RATE_LIMIT_FALLBACK',
    description:
      'Upstash Redis が未設定の場合にインメモリのレート制限カウンターへフォールバックを許可します。本番での使用は保護劣化を招くため注意が必要。',
    defaultValue: false,
    environments: ['development', 'test'],
  },

  /**
   * 医薬品マスターの自動同期スケジューラーを有効化するか。
   * @see server/src/services/drug-master-scheduler.ts
   */
  DRUG_MASTER_AUTO_SYNC: {
    key: 'DRUG_MASTER_AUTO_SYNC',
    description: '医薬品マスターの自動同期スケジューラーを有効化します。',
    defaultValue: false,
    environments: ['production'],
  },

  /**
   * 医薬品包装単位マスターの自動同期スケジューラーを有効化するか。
   * @see server/src/services/drug-package-scheduler.ts
   */
  DRUG_PACKAGE_AUTO_SYNC: {
    key: 'DRUG_PACKAGE_AUTO_SYNC',
    description: '医薬品包装単位マスターの自動同期スケジューラーを有効化します。',
    defaultValue: false,
    environments: ['production'],
  },

  /**
   * 医薬品マスターの部分インデックス同期を許可するか。
   * 全件取得に失敗した場合に部分的なデータで同期を継続します。
   * @see server/src/services/mhlw-multi-file-fetcher.ts
   */
  DRUG_MASTER_ALLOW_PARTIAL_INDEX_SYNC: {
    key: 'DRUG_MASTER_ALLOW_PARTIAL_INDEX_SYNC',
    description:
      '医薬品マスターのインデックスファイル取得が一部失敗した場合でも部分的なデータで同期を継続します。',
    defaultValue: false,
    environments: ['development', 'production'],
  },

  /**
   * OpenClaw コマンド API エンドポイントを有効化するか。
   * @see server/src/routes/openclaw-commands.ts
   */
  OPENCLAW_COMMANDS_ENABLED: {
    key: 'OPENCLAW_COMMANDS_ENABLED',
    description: 'OpenClaw コマンド API エンドポイントを有効化します。',
    defaultValue: false,
    environments: ['development', 'production'],
  },

  /**
   * OpenClaw エラー自動修正サービスを有効化するか。
   * @see server/src/services/openclaw/error-autofix-service.ts
   */
  OPENCLAW_ERROR_AUTOFIX_ENABLED: {
    key: 'OPENCLAW_ERROR_AUTOFIX_ENABLED',
    description: 'OpenClaw のエラー自動修正機能を有効化します。',
    defaultValue: false,
    environments: ['development', 'production'],
  },

  /**
   * OpenClaw のログ自動エスカレーションを有効化するか。
   * @see server/src/services/openclaw/log-push-service.ts
   */
  OPENCLAW_AUTO_ESCALATE_ENABLED: {
    key: 'OPENCLAW_AUTO_ESCALATE_ENABLED',
    description: 'OpenClaw のエラーログを自動的にエスカレーションします。',
    defaultValue: false,
    environments: ['production'],
  },

  /**
   * OpenClaw へのログプッシュを有効化するか。
   * @see server/src/services/openclaw/log-push-service.ts
   */
  OPENCLAW_LOG_PUSH_ENABLED: {
    key: 'OPENCLAW_LOG_PUSH_ENABLED',
    description: 'OpenClaw へのログプッシュを有効化します。',
    defaultValue: false,
    environments: ['production'],
  },

  /**
   * インポート失敗アラートのモニタリングスケジューラーを有効化するか。
   * @see server/src/services/import-failure-alert-scheduler.ts
   */
  IMPORT_FAILURE_ALERT_ENABLED: {
    key: 'IMPORT_FAILURE_ALERT_ENABLED',
    description: 'インポート失敗アラートのモニタリングスケジューラーを有効化します。',
    defaultValue: false,
    environments: ['production'],
  },

  /**
   * インポート失敗アラート時に OpenClaw への自動ハンドオフを有効化するか。
   * @see server/src/services/openclaw/auto-handoff-service.ts
   */
  IMPORT_FAILURE_ALERT_OPENCLAW_AUTO_HANDOFF: {
    key: 'IMPORT_FAILURE_ALERT_OPENCLAW_AUTO_HANDOFF',
    description: 'インポート失敗アラート時に OpenClaw への自動ハンドオフを有効化します。',
    defaultValue: false,
    environments: ['production'],
  },

  /**
   * KPI モニタリングアラートスケジューラーを有効化するか。
   * @see server/src/services/monitoring-kpi-alert-scheduler.ts
   */
  MONITORING_KPI_ALERT_ENABLED: {
    key: 'MONITORING_KPI_ALERT_ENABLED',
    description: 'KPI モニタリングアラートスケジューラーを有効化します。',
    defaultValue: false,
    environments: ['production'],
  },

  /**
   * テスト薬局のパスワードを API レスポンスに含めるか。
   * テスト・開発環境専用フラグ。
   * @see server/src/services/auth-helper-service.ts
   */
  EXPOSE_TEST_PHARMACY_PASSWORDS: {
    key: 'EXPOSE_TEST_PHARMACY_PASSWORDS',
    description: 'テスト薬局のパスワードを API レスポンスに含めます。テスト・開発環境専用。',
    defaultValue: false,
    environments: ['test', 'development'],
  },

  /**
   * テストログイン機能を無効化するか（デフォルト有効）。
   * 明示的に TEST_LOGIN_FEATURE_ENABLED=false を設定した場合のみ無効化されます。
   * @see server/src/config/test-login-feature.ts
   */
  TEST_LOGIN_FEATURE_ENABLED: {
    key: 'TEST_LOGIN_FEATURE_ENABLED',
    description:
      'テストログイン機能を有効化します。明示的に false を設定しない限り有効。デフォルト true。',
    defaultValue: true,
    environments: ['development', 'test', 'production'],
  },
} as const satisfies Record<string, FeatureFlag>;

/**
 * 各フラグの現在値を import 時に一度だけ評価してキャッシュします。
 * TEST_LOGIN_FEATURE_ENABLED は "false" 以外はすべて true の特殊ルールに従います。
 */
function resolveFlag(flag: FeatureFlag): boolean {
  const raw = process.env[flag.key];

  // TEST_LOGIN_FEATURE_ENABLED は "false" のみ無効化（他はデフォルト true）
  if (flag.key === 'TEST_LOGIN_FEATURE_ENABLED') {
    return raw?.trim().toLowerCase() !== 'false';
  }

  if (raw === undefined || raw === null || raw.trim() === '') {
    return flag.defaultValue;
  }

  return raw.trim().toLowerCase() === 'true';
}

/** キャッシュされたフラグ値マップ */
const _cache: Record<keyof typeof FLAGS, boolean> = {} as Record<keyof typeof FLAGS, boolean>;

for (const [name, flag] of Object.entries(FLAGS) as [keyof typeof FLAGS, FeatureFlag][]) {
  _cache[name] = resolveFlag(flag);
}

/**
 * 指定フラグが有効かどうかを返します。
 * 値は import 時にキャッシュ済みのため、繰り返し呼び出しても process.env を再読しません。
 *
 * @example
 * ```ts
 * import { isFeatureEnabled } from '../config/feature-flags';
 *
 * if (isFeatureEnabled('EXPOSE_PASSWORD_RESET_TOKEN')) {
 *   // ...
 * }
 * ```
 */
export function isFeatureEnabled(flag: keyof typeof FLAGS): boolean {
  return _cache[flag];
}

/**
 * すべてのフラグの現在値を返します。
 * ヘルスエンドポイントや運用ダッシュボードでの一覧表示に使用します。
 *
 * @example
 * ```ts
 * // GET /api/health での使用例
 * const flags = getAllFlags();
 * res.json({ status: 'ok', featureFlags: flags });
 * ```
 */
export function getAllFlags(): Record<string, boolean> {
  return { ..._cache };
}
