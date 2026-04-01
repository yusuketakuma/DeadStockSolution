/**
 * OpenClaw コネクター設定・URL正規化・接続確認
 *
 * openclaw-service.ts から分割。型定義・設定読み込み・
 * コネクターモード解決・URL 正規化を担当する。
 */

export type OpenClawStatus = 'pending_handoff' | 'in_dialogue' | 'implementing' | 'completed';
export type OpenClawBaseUrlError = 'missing' | 'invalid' | 'insecure';
export type OpenClawConnectorMode = 'legacy_http' | 'gateway_cli' | 'managed_remote_agent';

const FIXED_IMPLEMENTATION_BRANCH = 'review';
export const DEFAULT_WEBHOOK_MAX_SKEW_SECONDS = 300;
export const DEFAULT_OPENCLAW_TIMEOUT_MS = 10000;
export const DEFAULT_OPENCLAW_TIMEOUT_SECONDS = 120;
export const DEFAULT_OPENCLAW_RETRY_MAX = 2;
export const DEFAULT_OPENCLAW_RETRY_BASE_MS = 400;
export const DEFAULT_OPENCLAW_IDEMPOTENCY_TTL_MS = 120_000;

export const OPENCLAW_STATUS_ORDER: Record<OpenClawStatus, number> = {
  pending_handoff: 0,
  in_dialogue: 1,
  implementing: 2,
  completed: 3,
};

export interface OpenClawConfig {
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
  handoffKey?: string;
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

export interface OpenClawHandoffResponseBody {
  threadId?: unknown;
  summary?: unknown;
  status?: unknown;
}

export interface OpenClawCliAgentResponse {
  status?: unknown;
  result?: {
    payloads?: Array<{ text?: unknown }>;
    meta?: {
      agentMeta?: { sessionId?: unknown };
    };
  };
}

export interface GatewaySendInput {
  agentId: string;
  message: string;
  metadata?: unknown;
}

export function stripTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

export function isLocalhostHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === 'localhost'
    || normalized === '127.0.0.1'
    || normalized === '::1'
    || normalized === '[::1]';
}

export function normalizeBaseUrl(baseUrlRaw: string): { value: string; error: OpenClawBaseUrlError | null } {
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

export function resolveAppBaseUrl(): string | null {
  const raw = (process.env.APP_BASE_URL ?? '').trim();
  const candidate = raw || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '');
  if (!candidate) return null;

  try {
    const parsed = new URL(candidate);
    parsed.search = '';
    parsed.hash = '';
    return stripTrailingSlash(parsed.toString());
  } catch {
    return null;
  }
}

export function connectorNotReadyMessage(config: OpenClawConfig): string {
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
  if (rawMode === 'managed_remote_agent') return 'managed_remote_agent';
  if (rawMode === 'gateway_cli') return 'gateway_cli';
  return 'legacy_http';
}

export function readConfig(): OpenClawConfig {
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

export function resolveWebhookMaxSkewSeconds(): number {
  const rawValue = Number(process.env.OPENCLAW_WEBHOOK_MAX_SKEW_SECONDS ?? DEFAULT_WEBHOOK_MAX_SKEW_SECONDS);
  if (!Number.isFinite(rawValue) || rawValue <= 0 || rawValue > 3600) {
    return DEFAULT_WEBHOOK_MAX_SKEW_SECONDS;
  }
  return Math.floor(rawValue);
}

export function resolveRetryMax(): number {
  const raw = Number(process.env.OPENCLAW_RETRY_MAX ?? DEFAULT_OPENCLAW_RETRY_MAX);
  if (!Number.isFinite(raw)) return DEFAULT_OPENCLAW_RETRY_MAX;
  return Math.max(0, Math.min(5, Math.floor(raw)));
}

export function resolveRetryBaseMs(): number {
  const raw = Number(process.env.OPENCLAW_RETRY_BASE_MS ?? DEFAULT_OPENCLAW_RETRY_BASE_MS);
  if (!Number.isFinite(raw)) return DEFAULT_OPENCLAW_RETRY_BASE_MS;
  return Math.max(100, Math.min(5000, Math.floor(raw)));
}

export function resolveIdempotencyTtlMs(): number {
  const raw = Number(process.env.OPENCLAW_IDEMPOTENCY_TTL_MS ?? DEFAULT_OPENCLAW_IDEMPOTENCY_TTL_MS);
  if (!Number.isFinite(raw)) return DEFAULT_OPENCLAW_IDEMPOTENCY_TTL_MS;
  return Math.max(5_000, Math.min(15 * 60_000, Math.floor(raw)));
}

export function resolveGatewayTimeoutMs(): number {
  const raw = Number(process.env.OPENCLAW_TIMEOUT_MS ?? DEFAULT_OPENCLAW_TIMEOUT_MS);
  if (!Number.isFinite(raw)) return DEFAULT_OPENCLAW_TIMEOUT_MS;
  return Math.max(1000, Math.min(60_000, Math.floor(raw)));
}

export function resolveGatewayTimeoutSeconds(): number {
  const raw = Number(process.env.OPENCLAW_TIMEOUT_SECONDS ?? DEFAULT_OPENCLAW_TIMEOUT_SECONDS);
  if (!Number.isFinite(raw)) return DEFAULT_OPENCLAW_TIMEOUT_SECONDS;
  return Math.max(10, Math.min(600, Math.floor(raw)));
}

export function normalizeStatus(value: unknown): OpenClawStatus {
  if (value === 'in_dialogue' || value === 'implementing' || value === 'completed') {
    return value;
  }
  return 'in_dialogue';
}

export function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

export function calcBackoffMs(attempt: number): number {
  const baseMs = resolveRetryBaseMs();
  const jitter = Math.floor(Math.random() * 100);
  return baseMs * Math.max(1, 2 ** (attempt - 1)) + jitter;
}

export function getOpenClawConfig(): OpenClawConfig {
  return readConfig();
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
  if (config.mode === 'managed_remote_agent') {
    return true;
  }
  if (config.mode === 'gateway_cli') {
    return Boolean(config.cliPath && config.agentId);
  }
  return Boolean(config.baseUrl && config.apiKey && config.agentId);
}

export function isOpenClawWebhookConfigured(): boolean {
  return Boolean(readConfig().webhookSecret);
}

export function isImplementationBranchAllowed(branch: string | null | undefined): boolean {
  if (!branch) return false;
  return branch.trim() === getOpenClawImplementationBranch();
}

export function buildHandoffFailure(config: OpenClawConfig, note: string): OpenClawHandoffResult {
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

export function buildHandoffIdempotencyKey(input: OpenClawHandoffInput): string {
  const suffix = typeof input.handoffKey === 'string' && input.handoffKey.trim()
    ? input.handoffKey.trim().slice(0, 120)
    : 'initial';
  return `openclaw-handoff:${input.requestId}:${input.pharmacyId}:${suffix}`;
}
