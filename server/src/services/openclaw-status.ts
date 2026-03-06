export type OpenClawStatus = 'pending_handoff' | 'in_dialogue' | 'implementing' | 'completed';
type OpenClawBaseUrlError = 'missing' | 'invalid' | 'insecure';
type OpenClawConnectorMode = 'legacy_http' | 'gateway_cli';

const FIXED_IMPLEMENTATION_BRANCH = 'review';
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

export interface OpenClawHandoffResult {
  accepted: boolean;
  connectorConfigured: boolean;
  implementationBranch: string;
  status: OpenClawStatus;
  threadId: string | null;
  summary: string | null;
  note: string;
}

function stripTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

function isLocalhostHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === 'localhost'
    || normalized === '127.0.0.1'
    || normalized === '::1'
    || normalized === '[::1]';
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

function resolveOpenClawConnectorMode(): OpenClawConnectorMode {
  const rawMode = (process.env.OPENCLAW_CONNECTOR_MODE ?? '').trim().toLowerCase();
  if (rawMode === 'gateway_cli') return 'gateway_cli';
  return 'legacy_http';
}

function pruneExpiredMapEntries<K, V extends { expiresAtMs: number }>(
  cache: Map<K, V>,
  nowMs: number,
): void {
  for (const [key, entry] of cache.entries()) {
    if (entry.expiresAtMs <= nowMs) {
      cache.delete(key);
    }
  }
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

function pruneHandoffResultCache(nowMs: number): void {
  pruneExpiredMapEntries(handoffResultCache, nowMs);
}

export function getOpenClawConfig(): OpenClawConfig {
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

export function normalizeWebhookSignature(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith(WEBHOOK_SIGNATURE_PREFIX)) {
    return trimmed.slice(WEBHOOK_SIGNATURE_PREFIX.length).toLowerCase();
  }
  return trimmed.toLowerCase();
}

export function rememberWebhookReplay(signature: string, timestamp: string, nowMs: number): boolean {
  pruneWebhookReplayCache(nowMs);
  const replayKey = buildReplayKey(signature, timestamp);
  const existing = webhookReplayCache.get(replayKey);
  if (existing && existing > nowMs) {
    return false;
  }

  const ttlMs = resolveWebhookMaxSkewSeconds() * 1000;
  webhookReplayCache.set(replayKey, nowMs + ttlMs);
  return true;
}

export function isWebhookReplay(signature: string, timestamp: string, nowMs: number): boolean {
  pruneWebhookReplayCache(nowMs);
  const existing = webhookReplayCache.get(buildReplayKey(signature, timestamp));
  return Boolean(existing && existing > nowMs);
}

export function releaseWebhookReplay(signature: string, timestamp: string): void {
  webhookReplayCache.delete(buildReplayKey(signature, timestamp));
}

export function getCachedHandoffResult(key: string, nowMs: number): OpenClawHandoffResult | null {
  const cached = handoffResultCache.get(key);
  if (!cached || cached.expiresAtMs <= nowMs) return null;
  return cached.result;
}

export function setCachedHandoffResult(key: string, result: OpenClawHandoffResult, nowMs: number): void {
  pruneHandoffResultCache(nowMs);
  const ttlMs = resolveIdempotencyTtlMs();
  handoffResultCache.set(key, {
    expiresAtMs: nowMs + ttlMs,
    result,
  });
}

export function getInFlightHandoff(key: string): Promise<OpenClawHandoffResult> | undefined {
  return handoffInFlight.get(key);
}

export function setInFlightHandoff(key: string, task: Promise<OpenClawHandoffResult>): void {
  handoffInFlight.set(key, task);
}

export function deleteInFlightHandoff(key: string): void {
  handoffInFlight.delete(key);
}

export function clearOpenClawCachesForTests(): void {
  webhookReplayCache.clear();
  handoffInFlight.clear();
  handoffResultCache.clear();
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
  const config = getOpenClawConfig();
  if (config.mode === 'gateway_cli') {
    return Boolean(config.cliPath && config.agentId);
  }
  return Boolean(config.baseUrl && config.apiKey && config.agentId);
}

export function isOpenClawWebhookConfigured(): boolean {
  return Boolean(getOpenClawConfig().webhookSecret);
}

export function isImplementationBranchAllowed(branch: string | null | undefined): boolean {
  if (!branch) return false;
  return branch.trim() === getOpenClawImplementationBranch();
}
