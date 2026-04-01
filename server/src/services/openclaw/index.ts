/**
 * OpenClaw サービス — バレルファイル（後方互換性）
 *
 * 元の 994 行のモノリスを以下の4モジュールに分割し、
 * 既存のインポート先を壊さないよう全エクスポートを再公開する。
 *
 * - connector-config.ts — 型定義・設定・URL正規化・コネクター判定
 * - webhook-validator.ts — Webhook 署名検証・リプレイ防止
 * - task-envelope.ts    — タスクエンベロープ構築・分類
 * - handoff-core.ts     — ハンドオフ実行 (CLI/HTTP)・Gateway 送信
 */

// ── 型・設定・コネクター ──────────────────────────────────
export type {
  OpenClawStatus,
  OpenClawConfig,
  OpenClawHandoffInput,
  OpenClawHandoffResult,
  GatewaySendInput,
} from './connector-config';

export {
  getOpenClawConfig,
  isOpenClawStatus,
  canTransitionOpenClawStatus,
  getOpenClawImplementationBranch,
  isOpenClawConnectorConfigured,
  isOpenClawWebhookConfigured,
  isImplementationBranchAllowed,
} from './connector-config';

// ── Webhook 検証 ──────────────────────────────────────
export {
  verifyOpenClawWebhookSignature,
  consumeOpenClawWebhookReplay,
  isOpenClawWebhookReplay,
  releaseOpenClawWebhookReplay,
} from './webhook-validator';

// ── ハンドオフ実行・Gateway 送信 ──────────────────────────
export {
  handoffToOpenClaw,
  sendToOpenClawGateway,
} from './handoff-core';

// ── テスト用リセット（後方互換） ─────────────────────────
import { clearWebhookReplayCacheForTests } from './webhook-validator';
import { clearHandoffCachesForTests } from './handoff-core';

/**
 * テスト用: 全内部キャッシュ（webhook リプレイ、ハンドオフ in-flight、結果キャッシュ）をクリアする。
 * 既存テストとの後方互換性のために維持。
 */
export function resetOpenClawWebhookReplayCacheForTests(): void {
  clearWebhookReplayCacheForTests();
  clearHandoffCachesForTests();
}
