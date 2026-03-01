import crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { getErrorMessage } from '../middleware/error-handler';
import { sleep } from '../utils/http-utils';
import { logger } from './logger';

export type OpenClawStatus = 'pending_handoff' | 'in_dialogue' | 'implementing' | 'completed';
type OpenClawBaseUrlError = 'missing' | 'invalid' | 'insecure';
type OpenClawConnectorMode = 'legacy_http' | 'gateway_cli';

const FIXED_IMPLEMENTATION_BRANCH = 'review';
const execFileAsync = promisify(execFile);
const DEFAULT_WEBHOOK_MAX_SKEW_SECONDS = 300;
const WEBHOOK_SIGNATURE_PREFIX = 'sha256=';
const DEFAULT_OPENCLAW_TIMEOUT_MS = 10000;
const DEFAULT_OPENCLAW_TIMEOUT_SECONDS = 120;
const DEFAULT_OPENCLAW_RETRY_MAX = 2;
const DEFAULT_OPENCLAW_RETRY_BASE_MS = 400;
const DEFAULT_OPENCLAW_IDEMPOTENCY_TTL_MS = 120_000;

const webhookReplayCache = new Map<string, number>();
const handoffInFlight = new Map<string, Promise<OpenClawHandoffResult>>();
const handoffResultCache = new Map<string, { expiresAtMs: number; result: OpenClawHandoffResult }>();

const OPENCLAW_STATUS_ORDER: Record<OpenClawStatus, number> = {
  pending_handoff: 0,
  in_dialogue: 1,
  implementing: 2,
  completed: 3,
};

interface OpenClawConfig {
  mode: OpenClawConnectorMode;
  cliPath: string;
  baseUrl: string;
  baseUrlError: OpenClawBaseUrlError | null;
  apiKey: string;
  agentId: string;
  webhookSecret: string;
  implementationBranch: string;
}

export interface OpenClawHandoffInput {
  requestId: number;
  pharmacyId: number;
  requestText: string;
  context?: Record<string, unknown>;
}

export interface OpenClawHandoffResult {
  accepted: boolean;
  connectorConfigured: boolean;
  implementationBranch: string;
  status: OpenClawStatus;
  threadId: string | null;
  summary: string | null;
  note: string;
}

interface OpenClawHandoffResponseBody {
  threadId?: unknown;
  summary?: unknown;
  status?: unknown;
}

interface OpenClawCliAgentResponse {
  status?: unknown;
  result?: {
    payloads?: Array<{ text?: unknown }>;
    meta?: {
      agentMeta?: { sessionId?: unknown };
    };
  };
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

function stripTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

function isLocalhostHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}

function normalizeBaseUrl(baseUrlRaw: string): { value: string; error: OpenClawBaseUrlError | null } {
  const trimmed = baseUrlRaw.trim();
  if (!trimmed) return { value: '', error: 'missing' };

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { value: '', error: 'invalid' };
  }

  const protocol = parsed.protocol.toLowerCase();
  if (protocol === 'https:' || (protocol === 'http:' && isLocalhostHost(parsed.hostname))) {
    parsed.search = '';
    parsed.hash = '';
    return { value: stripTrailingSlash(parsed.toString()), error: null };
  }

  return { value: '', error: 'insecure' };
}

function connectorNotReadyMessage(config: OpenClawConfig): string {
  if (config.mode === 'gateway_cli') {
    return 'OpenClaw CLIコネクター未接続。OPENCLAW_CLI_PATH と OPENCLAW_AGENT_ID を確認してください。';
  }
  if (config.baseUrlError === 'insecure') {
    return 'OPENCLAW_BASE_URL はHTTPSを使用してください（localhostのみHTTP許可）。';
  }
  if (config.baseUrlError === 'invalid') {
    return 'OPENCLAW_BASE_URL が不正です。正しいURLを設定してください。';
  }
  return 'OpenClawコネクター未接続。接続後に再連携してください。';
}

function resolveOpenClawConnectorMode(): OpenClawConnectorMode {
  const rawMode = (process.env.OPENCLAW_CONNECTOR_MODE ?? '').trim().toLowerCase();
  if (rawMode === 'gateway_cli') return 'gateway_cli';
  return 'legacy_http';
}

function readConfig(): OpenClawConfig {
  const baseUrl = normalizeBaseUrl(process.env.OPENCLAW_BASE_URL ?? '');
  return {
    mode: resolveOpenClawConnectorMode(),
    cliPath: (process.env.OPENCLAW_CLI_PATH ?? '').trim(),
    baseUrl: baseUrl.value,
    baseUrlError: baseUrl.error,
    apiKey: (process.env.OPENCLAW_API_KEY ?? '').trim(),
    agentId: (process.env.OPENCLAW_AGENT_ID ?? '').trim(),
    webhookSecret: (process.env.OPENCLAW_WEBHOOK_SECRET ?? '').trim(),
    implementationBranch: FIXED_IMPLEMENTATION_BRANCH,
  };
}

function resolveWebhookMaxSkewSeconds(): number {
  const rawValue = Number(process.env.OPENCLAW_WEBHOOK_MAX_SKEW_SECONDS ?? DEFAULT_WEBHOOK_MAX_SKEW_SECONDS);
  if (!Number.isFinite(rawValue) || rawValue <= 0 || rawValue > 3600) {
    return DEFAULT_WEBHOOK_MAX_SKEW_SECONDS;
  }
  return Math.floor(rawValue);
}

function resolveRetryMax(): number {
  const raw = Number(process.env.OPENCLAW_RETRY_MAX ?? DEFAULT_OPENCLAW_RETRY_MAX);
  if (!Number.isFinite(raw)) return DEFAULT_OPENCLAW_RETRY_MAX;
  return Math.max(0, Math.min(5, Math.floor(raw)));
}

function resolveRetryBaseMs(): number {
  const raw = Number(process.env.OPENCLAW_RETRY_BASE_MS ?? DEFAULT_OPENCLAW_RETRY_BASE_MS);
  if (!Number.isFinite(raw)) return DEFAULT_OPENCLAW_RETRY_BASE_MS;
  return Math.max(100, Math.min(5000, Math.floor(raw)));
}

function resolveIdempotencyTtlMs(): number {
  const raw = Number(process.env.OPENCLAW_IDEMPOTENCY_TTL_MS ?? DEFAULT_OPENCLAW_IDEMPOTENCY_TTL_MS);
  if (!Number.isFinite(raw)) return DEFAULT_OPENCLAW_IDEMPOTENCY_TTL_MS;
  return Math.max(5_000, Math.min(15 * 60_000, Math.floor(raw)));
}

function resolveGatewayTimeoutMs(): number {
  const raw = Number(process.env.OPENCLAW_TIMEOUT_MS ?? DEFAULT_OPENCLAW_TIMEOUT_MS);
  if (!Number.isFinite(raw)) return DEFAULT_OPENCLAW_TIMEOUT_MS;
  return Math.max(1000, Math.min(60_000, Math.floor(raw)));
}

function resolveGatewayTimeoutSeconds(): number {
  const raw = Number(process.env.OPENCLAW_TIMEOUT_SECONDS ?? DEFAULT_OPENCLAW_TIMEOUT_SECONDS);
  if (!Number.isFinite(raw)) return DEFAULT_OPENCLAW_TIMEOUT_SECONDS;
  return Math.max(10, Math.min(600, Math.floor(raw)));
}

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

function buildReplayKey(signature: string, timestamp: string): string {
  return `${timestamp}:${signature}`;
}

function normalizeStatus(value: unknown): OpenClawStatus {
  if (value === 'in_dialogue' || value === 'implementing' || value === 'completed') {
    return value;
  }
  return 'in_dialogue';
}

function buildHandoffIdempotencyKey(input: OpenClawHandoffInput): string {
  return `openclaw-handoff:${input.requestId}:${input.pharmacyId}`;
}

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

function buildHandoffFailure(config: OpenClawConfig, note: string): OpenClawHandoffResult {
  return {
    accepted: false,
    connectorConfigured: true,
    implementationBranch: config.implementationBranch,
    status: 'pending_handoff',
    threadId: null,
    summary: null,
    note,
  };
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function calcBackoffMs(attempt: number): number {
  const baseMs = resolveRetryBaseMs();
  const jitter = Math.floor(Math.random() * 100);
  return baseMs * Math.max(1, 2 ** (attempt - 1)) + jitter;
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
  const message = [
    'あなたはDeadStockSolutionのOpenClaw連携エージェントです。',
    `要望ID: ${input.requestId}`,
    `薬局ID: ${input.pharmacyId}`,
    `冪等キー: ${idempotencyKey}`,
    `要望: ${input.requestText}`,
    '次の形式で短く返答してください: 1) 受領確認 2) 初動方針 3) 次アクション',
  ].join('\n');

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

      return {
        accepted: true,
        connectorConfigured: true,
        implementationBranch: config.implementationBranch,
        status,
        threadId,
        summary,
        note: `OpenClawへ連携しました。実装ブランチは ${config.implementationBranch} に固定されています。`,
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

export function isOpenClawStatus(value: unknown): value is OpenClawStatus {
  return value === 'pending_handoff'
    || value === 'in_dialogue'
    || value === 'implementing'
    || value === 'completed';
}

export function canTransitionOpenClawStatus(current: OpenClawStatus, next: OpenClawStatus): boolean {
  return OPENCLAW_STATUS_ORDER[next] >= OPENCLAW_STATUS_ORDER[current];
}

export function getOpenClawImplementationBranch(): string {
  return FIXED_IMPLEMENTATION_BRANCH;
}

export function isOpenClawConnectorConfigured(): boolean {
  const config = readConfig();
  if (config.mode === 'gateway_cli') {
    return Boolean(config.cliPath && config.agentId);
  }
  return Boolean(config.baseUrl && config.apiKey && config.agentId);
}

export function isOpenClawWebhookConfigured(): boolean {
  return Boolean(readConfig().webhookSecret);
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

export function resetOpenClawWebhookReplayCacheForTests(): void {
  webhookReplayCache.clear();
  handoffInFlight.clear();
  handoffResultCache.clear();
}

export function isImplementationBranchAllowed(branch: string | null | undefined): boolean {
  if (!branch) return false;
  return branch.trim() === getOpenClawImplementationBranch();
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
