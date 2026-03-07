import { execFile } from 'child_process';
import { promisify } from 'util';
import { getErrorMessage } from '../middleware/error-handler';
import { sleep } from '../utils/http-utils';
import { logger } from './logger';
import {
  deleteInFlightHandoff,
  getCachedHandoffResult,
  getInFlightHandoff,
  getOpenClawConfig,
  type OpenClawConfig,
  type OpenClawHandoffResult,
  setCachedHandoffResult,
  setInFlightHandoff,
} from './openclaw-status';
import {
  buildHandoffFailure,
  buildHandoffSuccess,
  buildHandoffIdempotencyKey,
  calcBackoffMs,
  connectorNotReadyMessage,
  extractGatewaySummaryPayload,
  extractSummaryFromCli,
  getGatewayTimeoutMs,
  getGatewayTimeoutSeconds,
  getRetryMaxAttempts,
  isAbortError,
  isRetryableStatus,
  normalizeStatus,
  sanitizeCliMessage,
  type OpenClawCliAgentResponse,
  type OpenClawHandoffInput,
  type OpenClawHandoffResponseBody,
  type GatewaySendInput,
} from './openclaw-handoff-helpers';

const execFileAsync = promisify(execFile);

export type { OpenClawHandoffInput } from './openclaw-handoff-helpers';
export type { GatewaySendInput } from './openclaw-handoff-helpers';

function buildGatewayCliMessage(
  input: OpenClawHandoffInput,
  idempotencyKey: string,
): string {
  const sanitizedRequestText = sanitizeCliMessage(input.requestText);
  const sections = [
    'あなたはDeadStockSolutionのOpenClaw連携エージェントです。',
    `要望ID: ${input.requestId}`,
    `薬局ID: ${input.pharmacyId}`,
    `冪等キー: ${idempotencyKey}`,
    `要望: ${sanitizedRequestText}`,
  ];

  if (input.context && Object.keys(input.context).length > 0) {
    const serializedContext = sanitizeCliMessage(JSON.stringify(input.context, null, 2), 6000);
    sections.push(`追加コンテキスト(JSON):\n${serializedContext}`);
  }

  sections.push('次の形式で短く返答してください: 1) 受領確認 2) 初動方針 3) 次アクション');
  return sections.join('\n');
}

async function handoffViaGatewayCli(
  config: OpenClawConfig,
  input: OpenClawHandoffInput,
  idempotencyKey: string,
): Promise<OpenClawHandoffResult> {
  const timeoutSeconds = getGatewayTimeoutSeconds();
  const maxAttempts = getRetryMaxAttempts();
  const message = buildGatewayCliMessage(input, idempotencyKey);

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
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          USER: process.env.USER,
          LANG: process.env.LANG ?? 'en_US.UTF-8',
        },
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

      return buildHandoffSuccess(config, {
        status: 'in_dialogue',
        threadId,
        summary,
        note: 'OpenClaw Gateway CLI へ連携しました。',
      });
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
  const maxAttempts = getRetryMaxAttempts();
  const timeoutMs = getGatewayTimeoutMs();

  const requestPayload: Record<string, unknown> = {
    agentId: config.agentId,
    requestId: input.requestId,
    pharmacyId: input.pharmacyId,
    requestText: input.requestText,
    idempotencyKey,
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

      return buildHandoffSuccess(config, {
        status,
        threadId,
        summary,
        note: `OpenClawへ連携しました。実装ブランチは ${config.implementationBranch} に固定されています。`,
      });
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
  const config = getOpenClawConfig();

  if (config.mode === 'gateway_cli') {
    const timeoutSeconds = getGatewayTimeoutSeconds();
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
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        USER: process.env.USER,
        LANG: process.env.LANG ?? 'en_US.UTF-8',
      },
    });

    let parsed: Record<string, unknown> = {};
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

  const timeoutMs = getGatewayTimeoutMs();
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

    const data: unknown = await response.json();
    return {
      summary: extractGatewaySummaryPayload(data),
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function handoffToOpenClaw(input: OpenClawHandoffInput): Promise<OpenClawHandoffResult> {
  const config = getOpenClawConfig();
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

  const inFlight = getInFlightHandoff(idempotencyKey);
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

  setInFlightHandoff(idempotencyKey, task);

  try {
    const result = await task;
    setCachedHandoffResult(idempotencyKey, result, Date.now());
    return result;
  } finally {
    deleteInFlightHandoff(idempotencyKey);
  }
}
