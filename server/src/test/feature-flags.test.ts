import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * feature-flags.ts のテスト
 *
 * モジュールキャッシュのリセットが必要なため vi.resetModules() を使用します。
 * 各テストで process.env を操作して再インポートし、キャッシュ動作を検証します。
 */
describe('feature-flags', () => {
  // 元の process.env を保存してテスト後に復元
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    // 追加した環境変数を削除してクリーンな状態に戻す
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    }
  });

  describe('FLAGS', () => {
    it('すべてのフラグが FeatureFlag インターフェースに準拠している', async () => {
      const { FLAGS } = await import('../config/feature-flags');

      for (const [name, flag] of Object.entries(FLAGS)) {
        expect(flag.key, `${name}.key`).toBeTypeOf('string');
        expect(flag.key.length, `${name}.key.length`).toBeGreaterThan(0);
        expect(flag.description, `${name}.description`).toBeTypeOf('string');
        expect(flag.defaultValue, `${name}.defaultValue`).toBeTypeOf('boolean');
        expect(Array.isArray(flag.environments), `${name}.environments is array`).toBe(true);
        expect(flag.environments.length, `${name}.environments.length`).toBeGreaterThan(0);
      }
    });

    it('FLAGS のキーと .key フィールドが一致している', async () => {
      const { FLAGS } = await import('../config/feature-flags');

      for (const [name, flag] of Object.entries(FLAGS)) {
        expect(flag.key).toBe(name);
      }
    });
  });

  describe('isFeatureEnabled', () => {
    it('環境変数が "true" のとき true を返す', async () => {
      process.env.ALLOW_IN_MEMORY_RATE_LIMIT_FALLBACK = 'true';
      const { isFeatureEnabled } = await import('../config/feature-flags');
      expect(isFeatureEnabled('ALLOW_IN_MEMORY_RATE_LIMIT_FALLBACK')).toBe(true);
    });

    it('環境変数が "false" のとき false を返す', async () => {
      process.env.ALLOW_IN_MEMORY_RATE_LIMIT_FALLBACK = 'false';
      const { isFeatureEnabled } = await import('../config/feature-flags');
      expect(isFeatureEnabled('ALLOW_IN_MEMORY_RATE_LIMIT_FALLBACK')).toBe(false);
    });

    it('環境変数が未設定のときデフォルト値を返す（defaultValue=false）', async () => {
      delete process.env.ALLOW_IN_MEMORY_RATE_LIMIT_FALLBACK;
      const { isFeatureEnabled } = await import('../config/feature-flags');
      expect(isFeatureEnabled('ALLOW_IN_MEMORY_RATE_LIMIT_FALLBACK')).toBe(false);
    });

    it('環境変数が未設定のときデフォルト値を返す（defaultValue=true）', async () => {
      delete process.env.TEST_LOGIN_FEATURE_ENABLED;
      const { isFeatureEnabled } = await import('../config/feature-flags');
      expect(isFeatureEnabled('TEST_LOGIN_FEATURE_ENABLED')).toBe(true);
    });

    it('EXPOSE_PASSWORD_RESET_TOKEN が "true" のとき true を返す', async () => {
      process.env.EXPOSE_PASSWORD_RESET_TOKEN = 'true';
      const { isFeatureEnabled } = await import('../config/feature-flags');
      expect(isFeatureEnabled('EXPOSE_PASSWORD_RESET_TOKEN')).toBe(true);
    });

    it('EXPOSE_PASSWORD_RESET_TOKEN が未設定のとき false を返す（デフォルト false）', async () => {
      delete process.env.EXPOSE_PASSWORD_RESET_TOKEN;
      const { isFeatureEnabled } = await import('../config/feature-flags');
      expect(isFeatureEnabled('EXPOSE_PASSWORD_RESET_TOKEN')).toBe(false);
    });

    it('値の大文字・小文字を区別しない（"TRUE" → true）', async () => {
      process.env.DRUG_MASTER_AUTO_SYNC = 'TRUE';
      const { isFeatureEnabled } = await import('../config/feature-flags');
      expect(isFeatureEnabled('DRUG_MASTER_AUTO_SYNC')).toBe(true);
    });

    it('値の大文字・小文字を区別しない（"False" → false）', async () => {
      process.env.DRUG_MASTER_AUTO_SYNC = 'False';
      const { isFeatureEnabled } = await import('../config/feature-flags');
      expect(isFeatureEnabled('DRUG_MASTER_AUTO_SYNC')).toBe(false);
    });

    it('前後の空白を無視する', async () => {
      process.env.OPENCLAW_COMMANDS_ENABLED = '  true  ';
      const { isFeatureEnabled } = await import('../config/feature-flags');
      expect(isFeatureEnabled('OPENCLAW_COMMANDS_ENABLED')).toBe(true);
    });

    it('空文字列はデフォルト値にフォールバックする', async () => {
      process.env.OPENCLAW_LOG_PUSH_ENABLED = '';
      const { isFeatureEnabled } = await import('../config/feature-flags');
      // defaultValue = false
      expect(isFeatureEnabled('OPENCLAW_LOG_PUSH_ENABLED')).toBe(false);
    });

    it('値がスペースのみの場合はデフォルト値にフォールバックする', async () => {
      process.env.OPENCLAW_LOG_PUSH_ENABLED = '   ';
      const { isFeatureEnabled } = await import('../config/feature-flags');
      expect(isFeatureEnabled('OPENCLAW_LOG_PUSH_ENABLED')).toBe(false);
    });
  });

  describe('TEST_LOGIN_FEATURE_ENABLED の特殊ルール', () => {
    it('"false" を設定すると false を返す', async () => {
      process.env.TEST_LOGIN_FEATURE_ENABLED = 'false';
      const { isFeatureEnabled } = await import('../config/feature-flags');
      expect(isFeatureEnabled('TEST_LOGIN_FEATURE_ENABLED')).toBe(false);
    });

    it('"FALSE" (大文字) でも false を返す', async () => {
      process.env.TEST_LOGIN_FEATURE_ENABLED = 'FALSE';
      const { isFeatureEnabled } = await import('../config/feature-flags');
      expect(isFeatureEnabled('TEST_LOGIN_FEATURE_ENABLED')).toBe(false);
    });

    it('"true" を設定すると true を返す', async () => {
      process.env.TEST_LOGIN_FEATURE_ENABLED = 'true';
      const { isFeatureEnabled } = await import('../config/feature-flags');
      expect(isFeatureEnabled('TEST_LOGIN_FEATURE_ENABLED')).toBe(true);
    });

    it('未設定でも true を返す（デフォルト true）', async () => {
      delete process.env.TEST_LOGIN_FEATURE_ENABLED;
      const { isFeatureEnabled } = await import('../config/feature-flags');
      expect(isFeatureEnabled('TEST_LOGIN_FEATURE_ENABLED')).toBe(true);
    });
  });

  describe('getAllFlags', () => {
    it('すべてのフラグキーを含むオブジェクトを返す', async () => {
      const { FLAGS, getAllFlags } = await import('../config/feature-flags');
      const result = getAllFlags();
      for (const key of Object.keys(FLAGS)) {
        expect(key in result, `${key} in result`).toBe(true);
        expect(result[key], `${key} is boolean`).toBeTypeOf('boolean');
      }
    });

    it('返されたオブジェクトを変更してもキャッシュに影響しない（シャローコピー）', async () => {
      const { isFeatureEnabled, getAllFlags } = await import('../config/feature-flags');
      const flags = getAllFlags();
      const original = flags['ALLOW_IN_MEMORY_RATE_LIMIT_FALLBACK'];
      flags['ALLOW_IN_MEMORY_RATE_LIMIT_FALLBACK'] = !original;
      // キャッシュは変わらない
      expect(isFeatureEnabled('ALLOW_IN_MEMORY_RATE_LIMIT_FALLBACK')).toBe(original);
    });

    it('すべての値が boolean 型である', async () => {
      const { getAllFlags } = await import('../config/feature-flags');
      const result = getAllFlags();
      for (const [key, value] of Object.entries(result)) {
        expect(typeof value, `${key} should be boolean`).toBe('boolean');
      }
    });
  });

  describe('キャッシュ動作', () => {
    it('同じモジュール内で isFeatureEnabled を繰り返し呼んでも同じ値を返す', async () => {
      process.env.DRUG_MASTER_AUTO_SYNC = 'true';
      const { isFeatureEnabled } = await import('../config/feature-flags');
      const first = isFeatureEnabled('DRUG_MASTER_AUTO_SYNC');
      // import 後に環境変数を変更しても影響しない
      process.env.DRUG_MASTER_AUTO_SYNC = 'false';
      const second = isFeatureEnabled('DRUG_MASTER_AUTO_SYNC');
      expect(first).toBe(true);
      expect(second).toBe(true); // キャッシュされているため変わらない
    });
  });
});
