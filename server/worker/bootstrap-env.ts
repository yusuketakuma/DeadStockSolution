/**
 * Workers の env バインディングを、既存コードが参照する process.env へ反映する。
 * 他モジュールより先に評価される必要があるため、worker エントリの先頭で import する。
 *
 * 既存コードはデプロイ環境名を VERCEL_ENV、公開ホスト名を VERCEL_URL から読むため、
 * Cloudflare 側では DEPLOY_ENV / PUBLIC_HOST を設定し、ここで旧名に橋渡しする。
 */
import packageJson from '../package.json';

function setDefault(key: string, value: string | undefined): void {
  if (value && !process.env[key]) {
    process.env[key] = value;
  }
}

// Hyperdrive の接続文字列はグローバルスコープでは参照できないため、リクエスト処理時に設定する（worker/index.ts）
setDefault('VERCEL_ENV', process.env.DEPLOY_ENV);
setDefault('VERCEL_URL', process.env.PUBLIC_HOST);
// Cloudflare のエッジを 1 段経由するため、X-Forwarded-For の先頭をクライアント IP として扱う
setDefault('TRUST_PROXY', '1');
setDefault('NODE_ENV', 'production');

/*
 * Workers はグローバルスコープ（モジュール評価時）でのタイマー生成を禁止している。
 * express-rate-limit の MemoryStore などは生成時に期限切れエントリ掃除用の setInterval を張るため、
 * モジュール評価中に限ってタイマー生成を「スケジュールしないハンドル」に置き換える。
 * 掃除が走らなくても各ストアはアクセス時に期限を判定するため動作は変わらず、
 * isolate は定期的に破棄されるのでメモリが増え続けることもない。
 * 最初のリクエスト処理前に endGlobalScope() で元の実装へ戻す。
 */
const originalSetInterval = globalThis.setInterval;
const originalSetTimeout = globalThis.setTimeout;
const originalClearInterval = globalThis.clearInterval;
const originalClearTimeout = globalThis.clearTimeout;

class DeferredTimerHandle {
  ref(): this { return this; }
  unref(): this { return this; }
  hasRef(): boolean { return false; }
  refresh(): this { return this; }
  close(): this { return this; }
  [Symbol.toPrimitive](): number { return 0; }
}

function isDeferredHandle(handle: unknown): handle is DeferredTimerHandle {
  return handle instanceof DeferredTimerHandle;
}

let globalScopeEnded = false;

globalThis.setInterval = ((..._args: unknown[]) => new DeferredTimerHandle()) as unknown as typeof setInterval;
globalThis.setTimeout = ((..._args: unknown[]) => new DeferredTimerHandle()) as unknown as typeof setTimeout;
globalThis.clearInterval = ((handle?: unknown) => {
  if (!isDeferredHandle(handle)) originalClearInterval(handle as never);
}) as typeof clearInterval;
globalThis.clearTimeout = ((handle?: unknown) => {
  if (!isDeferredHandle(handle)) originalClearTimeout(handle as never);
}) as typeof clearTimeout;

export function endGlobalScope(): void {
  if (globalScopeEnded) return;
  globalScopeEnded = true;
  globalThis.setInterval = originalSetInterval;
  globalThis.setTimeout = originalSetTimeout;
}

// /api/health が返すバージョン（Node では npm が npm_package_version を設定していた）
setDefault('npm_package_version', packageJson.version);
