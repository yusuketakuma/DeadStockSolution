import crypto from 'crypto';
import {
  clearOpenClawCachesForTests,
  getOpenClawConfig,
  isWebhookReplay,
  normalizeWebhookSignature,
  releaseWebhookReplay,
  rememberWebhookReplay,
  resolveWebhookMaxSkewSeconds,
} from './openclaw-status';

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
  const expectedSecret = getOpenClawConfig().webhookSecret;
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

  const signature = normalizeWebhookSignature(receivedSignature);
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
  const signature = normalizeWebhookSignature(receivedSignature);
  const timestamp = receivedTimestamp.trim();
  if (!signature || !timestamp) {
    return false;
  }
  return rememberWebhookReplay(signature, timestamp, nowMs);
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
  const signature = normalizeWebhookSignature(receivedSignature);
  const timestamp = receivedTimestamp.trim();
  if (!signature || !timestamp) {
    return false;
  }
  return isWebhookReplay(signature, timestamp, nowMs);
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
  const signature = normalizeWebhookSignature(receivedSignature);
  const timestamp = receivedTimestamp.trim();
  if (!signature || !timestamp) {
    return;
  }
  releaseWebhookReplay(signature, timestamp);
}

export function resetOpenClawWebhookReplayCacheForTests(): void {
  clearOpenClawCachesForTests();
}
