/**
 * OpenClaw Webhook 署名検証・リプレイ防止
 *
 * openclaw-service.ts から分割。Webhook の HMAC 署名検証、
 * タイムスタンプスキュー検証、リプレイキャッシュ管理を担当する。
 */

import crypto from 'crypto';
import {
  readConfig,
  resolveWebhookMaxSkewSeconds,
} from './connector-config';

const WEBHOOK_SIGNATURE_PREFIX = 'sha256=';

const webhookReplayCache = new Map<string, number>();

function normalizeSignature(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith(WEBHOOK_SIGNATURE_PREFIX)) {
    return trimmed.slice(WEBHOOK_SIGNATURE_PREFIX.length).toLowerCase();
  }
  return trimmed.toLowerCase();
}

function pruneWebhookReplayCache(nowMs: number): void {
  for (const [key, expiresAtMs] of webhookReplayCache.entries()) {
    if (expiresAtMs <= nowMs) {
      webhookReplayCache.delete(key);
    }
  }
}

function buildReplayKey(signature: string, timestamp: string): string {
  return `${timestamp}:${signature}`;
}

function isReplayRequest(signature: string, timestamp: string, nowMs: number): boolean {
  pruneWebhookReplayCache(nowMs);
  const replayKey = buildReplayKey(signature, timestamp);
  const existing = webhookReplayCache.get(replayKey);
  if (existing && existing > nowMs) {
    return true;
  }

  const ttlMs = resolveWebhookMaxSkewSeconds() * 1000;
  webhookReplayCache.set(replayKey, nowMs + ttlMs);
  return false;
}

export function verifyOpenClawWebhookSignature({
  receivedSignature,
  receivedTimestamp,
  rawBody,
  nowMs = Date.now(),
}: {
  receivedSignature: string | undefined;
  receivedTimestamp: string | undefined;
  rawBody: string | undefined;
  nowMs?: number;
}): boolean {
  const expectedSecret = readConfig().webhookSecret;
  if (!expectedSecret || !receivedSignature || !receivedTimestamp || typeof rawBody !== 'string') {
    return false;
  }

  const timestampText = receivedTimestamp.trim();
  const timestampSeconds = Number(timestampText);
  if (!Number.isInteger(timestampSeconds) || timestampSeconds <= 0) {
    return false;
  }

  const maxSkewSeconds = resolveWebhookMaxSkewSeconds();
  const skewSeconds = Math.abs(Math.floor(nowMs / 1000) - timestampSeconds);
  if (skewSeconds > maxSkewSeconds) {
    return false;
  }

  const signature = normalizeSignature(receivedSignature);
  if (!/^[a-f0-9]{64}$/.test(signature)) {
    return false;
  }

  const signedPayload = `${timestampText}.${rawBody}`;
  const expectedDigest = crypto.createHmac('sha256', expectedSecret)
    .update(signedPayload)
    .digest('hex')
    .toLowerCase();

  const expectedBuffer = Buffer.from(expectedDigest, 'utf8');
  const receivedBuffer = Buffer.from(signature, 'utf8');
  if (expectedBuffer.length !== receivedBuffer.length) {
    return false;
  }
  if (!crypto.timingSafeEqual(expectedBuffer, receivedBuffer)) {
    return false;
  }

  return true;
}

export function consumeOpenClawWebhookReplay({
  receivedSignature,
  receivedTimestamp,
  nowMs = Date.now(),
}: {
  receivedSignature: string | undefined;
  receivedTimestamp: string | undefined;
  nowMs?: number;
}): boolean {
  if (!receivedSignature || !receivedTimestamp) {
    return false;
  }
  const signature = normalizeSignature(receivedSignature);
  const timestamp = receivedTimestamp.trim();
  if (!signature || !timestamp) {
    return false;
  }
  return !isReplayRequest(signature, timestamp, nowMs);
}

export function isOpenClawWebhookReplay({
  receivedSignature,
  receivedTimestamp,
  nowMs = Date.now(),
}: {
  receivedSignature: string | undefined;
  receivedTimestamp: string | undefined;
  nowMs?: number;
}): boolean {
  if (!receivedSignature || !receivedTimestamp) {
    return false;
  }
  const signature = normalizeSignature(receivedSignature);
  const timestamp = receivedTimestamp.trim();
  if (!signature || !timestamp) {
    return false;
  }
  pruneWebhookReplayCache(nowMs);
  const existing = webhookReplayCache.get(buildReplayKey(signature, timestamp));
  return Boolean(existing && existing > nowMs);
}

export function releaseOpenClawWebhookReplay({
  receivedSignature,
  receivedTimestamp,
}: {
  receivedSignature: string | undefined;
  receivedTimestamp: string | undefined;
}): void {
  if (!receivedSignature || !receivedTimestamp) {
    return;
  }
  const signature = normalizeSignature(receivedSignature);
  const timestamp = receivedTimestamp.trim();
  if (!signature || !timestamp) {
    return;
  }
  webhookReplayCache.delete(buildReplayKey(signature, timestamp));
}

/** テスト用: webhook リプレイキャッシュをクリアする */
export function clearWebhookReplayCacheForTests(): void {
  webhookReplayCache.clear();
}
