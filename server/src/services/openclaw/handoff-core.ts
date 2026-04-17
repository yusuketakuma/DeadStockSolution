/**
 * OpenClaw ハンドオフ実行 (CLI / Legacy HTTP) + Gateway 送信
 *
 * openclaw-service.ts から分割。CLI/HTTP 経由のハンドオフ実行、
 * リトライ・バックオフ、べき等キャッシュ、Gateway 送信を担当する。
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { getErrorMessage } from '../../middleware/error-handler';
import { sleep } from '../../utils/http-utils';
import { logger } from '../logger';
import {
  buildHandoffFailure,
  buildHandoffIdempotencyKey,
  calcBackoffMs,
  connectorNotReadyMessage,
  isAbortError,
  isRetryableStatus,
  normalizeStatus,
  readConfig,
  resolveGatewayTimeoutMs,
  resolveGatewayTimeoutSeconds,
  resolveIdempotencyTtlMs,
  resolveRetryMax,
  type OpenClawCliAgentResponse,
  type OpenClawConfig,
  type OpenClawHandoffInput,
  type OpenClawHandoffResponseBody,
  type OpenClawHandoffResult,
  type GatewaySendInput,
} from './connector-config';
import { buildGatewayCliMessage, buildTaskEnvelope } from './task-envelope';

/** OpenAI-compatible chat completion response shape (subset). */
interface ChatCompletionResponse {
  choices?: { message?: { content?: string } }[];
}

const execFileAsync = promisify(execFile);

const handoffInFlight = new Map<string, Promise<OpenClawHandoffResult>>();
const handoffResultCache = new Map<string, { expiresAtMs: number; result: OpenClawHandoffResult }>();

function pruneHandoffResultCache(nowMs: number): void {
  for (const [key, entry] of handoffResultCache.entries()) {
    if (entry.expiresAtMs <= nowMs) {
      handoffResultCache.delete(key);
    }
  }
}

function getCachedHandoffResult(key: string, nowMs: number): OpenClawHandoffResult | null {
  const cached = handoffResultCache.get(key);
  if (!cached || cached.expiresAtMs <= nowMs) return null;
  return cached.result;
}

function setCachedHandoffResult(key: string, result: OpenClawHandoffResult, nowMs: number): void {
  pruneHandoffResultCache(nowMs);
  const ttlMs = resolveIdempotencyTtlMs();
  handoffResultCache.set(key, {
    expiresAtMs: nowMs + ttlMs,
    result,
  });
}

function extractSummaryFromCli(payload: OpenClawCliAgentResponse, fallbackStdout: string): string | null {
  const text = payload.result?.payloads?.find((entry) => typeof entry?.text === 'string' && entry.text.trim().length > 0)?.text;
  if (typeof text === 'string' && text.trim().length > 0) {
    return text.trim().slice(0, 4000);
  }
  const trimmed = fallbackStdout.trim();
  return trimmed ? trimmed.slice(0, 4000) : null;
}

async function handoffViaGatewayCli(
  config: OpenClawConfig,
  input: OpenClawHandoffInput,
  idempotencyKey: string,
): Promise<OpenClawHandoffResult> {
  const timeoutSeconds = resolveGatewayTimeoutSeconds();
  const maxAttempts = resolveRetryMax() + 1;
  const task = buildTaskEnvelope(config, input, idempotencyKey);
  const message = buildGatewayCliMessage(task);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const startedAt = Date.now();
    const args = [
      'agent',
      '--agent', config.agentId,
      '--message', message,
      '--thinking', 'low',
      '--timeout', String(timeoutSeconds),
      '--json',
    ];

    try {
      const { stdout } = await execFileAsync(config.cliPath, args, {
        timeout: timeoutSeconds * 1000 + 3000,
        maxBuffer: 2 * 1024 * 1024,
        env: process.env,
      });

      let payload: OpenClawCliAgentResponse = {};
      try {
        payload = JSON.parse(stdout) as OpenClawCliAgentResponse;
      } catch {
        payload = {};
      }

      const summary = extractSummaryFromCli(payload, stdout);
      const sessionIdRaw = payload.result?.meta?.agentMeta?.sessionId;
      const threadId = typeof sessionIdRaw === 'string' && sessionIdRaw.trim().length > 0 ? sessionIdRaw.trim() : null;

      logger.info('OpenClaw handoff gateway_cli success', {
        mode: config.mode,
        requestId: input.requestId,
        pharmacyId: input.pharmacyId,
        idempotencyKey,
        attempt,
        durationMs: Date.now() - startedAt,
        threadId,
      });

      return {
        accepted: true,
        connectorConfigured: true,
        implementationBranch: config.implementationBranch,
        status: 'in_dialogue',
        threadId,
        summary,
        note: 'OpenClaw Gateway CLI へ連携しました。',
      };
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      const messageText = getErrorMessage(err);
      const retryable = attempt < maxAttempts;
      logger.warn('OpenClaw handoff gateway_cli failed', {
        mode: config.mode,
        requestId: input.requestId,
        pharmacyId: input.pharmacyId,
        idempotencyKey,
        attempt,
        durationMs,
        retryable,
        error: messageText,
      });
      if (retryable) {
        await sleep(calcBackoffMs(attempt));
        continue;
      }

      return buildHandoffFailure(config, 'OpenClaw Gateway CLI 連携に失敗しました。');
    }
  }

  return buildHandoffFailure(config, 'OpenClaw Gateway CLI 連携に失敗しました。');
}

async function handoffViaLegacyHttp(
  config: OpenClawConfig,
  input: OpenClawHandoffInput,
  idempotencyKey: string,
): Promise<OpenClawHandoffResult> {
  const maxAttempts = resolveRetryMax() + 1;
  const timeoutMs = resolveGatewayTimeoutMs();
  const task = buildTaskEnvelope(config, input, idempotencyKey);

  const requestPayload: Record<string, unknown> = {
    agentId: config.agentId,
    requestId: input.requestId,
    pharmacyId: input.pharmacyId,
    requestText: input.requestText,
    idempotencyKey,
    task,
    constraints: {
      implementationBranch: config.implementationBranch,
    },
  };

  if (input.context && Object.keys(input.context).length > 0) {
    requestPayload.context = input.context;
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = Date.now();

    try {
      const response = await fetch(`${config.baseUrl}/v1/handoffs`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
          'X-Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify(requestPayload),
        signal: controller.signal,
      });

      const payload = await response.json().catch(() => ({} as OpenClawHandoffResponseBody)) as OpenClawHandoffResponseBody;

      if (!response.ok) {
        const retryable = isRetryableStatus(response.status) && attempt < maxAttempts;
        logger.warn('OpenClaw handoff legacy_http failed', {
          mode: config.mode,
          requestId: input.requestId,
          pharmacyId: input.pharmacyId,
          idempotencyKey,
          attempt,
          durationMs: Date.now() - startedAt,
          statusCode: response.status,
          retryable,
        });
        if (retryable) {
          await sleep(calcBackoffMs(attempt));
          continue;
        }
        return buildHandoffFailure(config, `OpenClaw連携失敗: HTTP ${response.status}`);
      }

      const threadId = typeof payload.threadId === 'string' && payload.threadId.trim().length > 0
        ? payload.threadId.trim()
        : null;
      const summary = typeof payload.summary === 'string' && payload.summary.trim().length > 0
        ? payload.summary.trim()
        : null;
      const status = normalizeStatus(payload.status);

      logger.info('OpenClaw handoff legacy_http success', {
        mode: config.mode,
        requestId: input.requestId,
        pharmacyId: input.pharmacyId,
        idempotencyKey,
        attempt,
        durationMs: Date.now() - startedAt,
        threadId,
        status,
      });

      return {
        accepted: true,
        connectorConfigured: true,
        implementationBranch: config.implementationBranch,
        status,
        threadId,
        summary,
        note: 'OpenClawのタスク管理フローへ連携しました。実装とPRは OpenClaw 側で処理されます。',
      };
    } catch (err) {
      const retryable = attempt < maxAttempts;
      logger.warn('OpenClaw handoff legacy_http error', {
        mode: config.mode,
        requestId: input.requestId,
        pharmacyId: input.pharmacyId,
        idempotencyKey,
        attempt,
        durationMs: Date.now() - startedAt,
        retryable,
        timeout: isAbortError(err),
        error: getErrorMessage(err),
      });
      if (retryable) {
        await sleep(calcBackoffMs(attempt));
        continue;
      }
      return buildHandoffFailure(
        config,
        isAbortError(err) ? 'OpenClaw連携がタイムアウトしました。' : 'OpenClaw連携中にエラーが発生しました。',
      );
    } finally {
      clearTimeout(timer);
    }
  }

  return buildHandoffFailure(config, 'OpenClaw連携中にエラーが発生しました。');
}

export async function sendToOpenClawGateway(input: GatewaySendInput): Promise<{ summary: string }> {
  const config = readConfig();

  if (config.mode === 'gateway_cli') {
    const timeoutSeconds = resolveGatewayTimeoutSeconds();
    const args = [
      'agent',
      '--agent', input.agentId,
      '--message', input.message,
      '--thinking', 'low',
      '--timeout', String(timeoutSeconds),
      '--json',
    ];

    const { stdout } = await execFileAsync(config.cliPath, args, {
      timeout: timeoutSeconds * 1000 + 3000,
      maxBuffer: 2 * 1024 * 1024,
      env: process.env,
    });

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(stdout) as Record<string, unknown>;
    } catch {
      parsed = {};
    }

    return {
      summary:
        (typeof parsed.result === 'string' ? parsed.result : null)
        ?? (typeof parsed.message === 'string' ? parsed.message : null)
        ?? stdout.slice(0, 500),
    };
  }

  // Legacy HTTP mode
  const timeoutMs = resolveGatewayTimeoutMs();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${config.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.agentId,
        messages: [{ role: 'user', content: input.message }],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`OpenClaw API error: ${response.status}`);
    }

    const data = await response.json() as ChatCompletionResponse;
    return {
      summary: (data?.choices?.[0]?.message?.content as string) ?? '',
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function handoffToOpenClaw(input: OpenClawHandoffInput): Promise<OpenClawHandoffResult> {
  const config = readConfig();
  const connectorConfigured = config.mode === 'gateway_cli'
    ? Boolean(config.cliPath && config.agentId)
    : Boolean(config.baseUrl && config.apiKey && config.agentId);

  if (!connectorConfigured) {
    return {
      accepted: false,
      connectorConfigured: false,
      implementationBranch: config.implementationBranch,
      status: 'pending_handoff',
      threadId: null,
      summary: null,
      note: connectorNotReadyMessage(config),
    };
  }

  const idempotencyKey = buildHandoffIdempotencyKey(input);
  const nowMs = Date.now();
  const cached = getCachedHandoffResult(idempotencyKey, nowMs);
  if (cached) {
    logger.info('OpenClaw handoff cache hit', {
      mode: config.mode,
      requestId: input.requestId,
      pharmacyId: input.pharmacyId,
      idempotencyKey,
    });
    return cached;
  }

  const inFlight = handoffInFlight.get(idempotencyKey);
  if (inFlight) {
    logger.info('OpenClaw handoff deduplicated by in-flight key', {
      mode: config.mode,
      requestId: input.requestId,
      pharmacyId: input.pharmacyId,
      idempotencyKey,
    });
    return inFlight;
  }

  const task = (async () => {
    if (config.mode === 'gateway_cli') {
      return handoffViaGatewayCli(config, input, idempotencyKey);
    }
    return handoffViaLegacyHttp(config, input, idempotencyKey);
  })();

  handoffInFlight.set(idempotencyKey, task);

  try {
    const result = await task;
    setCachedHandoffResult(idempotencyKey, result, Date.now());
    return result;
  } finally {
    handoffInFlight.delete(idempotencyKey);
  }
}

/** テスト用: ハンドオフ関連キャッシュをクリアする */
export function clearHandoffCachesForTests(): void {
  handoffInFlight.clear();
  handoffResultCache.clear();
}
