/**
 * Workers の env バインディングを、既存コードが参照する process.env へ反映する。
 * 他モジュールより先に評価される必要があるため、worker エントリの先頭で import する。
 *
 * 既存コードはデプロイ環境名を VERCEL_ENV、公開ホスト名を VERCEL_URL から読むため、
 * Cloudflare 側では DEPLOY_ENV / PUBLIC_HOST を設定し、ここで旧名に橋渡しする。
 */
import packageJson from '../package.json';
import { createDeferredTimerRegistry } from '../src/utils/deferred-timers';

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
 * express-rate-limit の MemoryStore などは生成時に期限切れキー掃除用の setInterval を張るため、
 * モジュール評価中に作られたタイマーは deferredTimers に預け、リクエスト処理の開始時に
 * runDeferredTimers() で期限が来たものを実行する（掃除処理が isolate の寿命中も動く）。
 * 最初のリクエスト処理前に endGlobalScope() で setInterval / setTimeout を元の実装へ戻す。
 */
const originalSetInterval = globalThis.setInterval;
const originalSetTimeout = globalThis.setTimeout;
const originalClearInterval = globalThis.clearInterval;
const originalClearTimeout = globalThis.clearTimeout;

const deferredTimers = createDeferredTimerRegistry();
let globalScopeEnded = false;

globalThis.setInterval = ((callback: unknown, delayMs?: unknown, ...args: unknown[]) =>
  deferredTimers.setInterval(callback, delayMs, ...args)) as unknown as typeof setInterval;
globalThis.setTimeout = ((callback: unknown, delayMs?: unknown, ...args: unknown[]) =>
  deferredTimers.setTimeout(callback, delayMs, ...args)) as unknown as typeof setTimeout;
globalThis.clearInterval = ((handle?: unknown) => {
  if (!deferredTimers.clear(handle)) originalClearInterval(handle as never);
}) as typeof clearInterval;
globalThis.clearTimeout = ((handle?: unknown) => {
  if (!deferredTimers.clear(handle)) originalClearTimeout(handle as never);
}) as typeof clearTimeout;

export function endGlobalScope(): void {
  if (globalScopeEnded) return;
  globalScopeEnded = true;
  globalThis.setInterval = originalSetInterval;
  globalThis.setTimeout = originalSetTimeout;
}

/** モジュール評価中に登録されたタイマーのうち、期限が来たものを実行する */
export function runDeferredTimers(): void {
  try {
    deferredTimers.runDue();
  } catch (err) {
    console.error('[worker] deferred timer callback failed', err);
  }
}

// /api/health が返すバージョン（Node では npm が npm_package_version を設定していた）
setDefault('npm_package_version', packageJson.version);
