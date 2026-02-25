import crypto from 'crypto';

export type OpenClawStatus = 'pending_handoff' | 'in_dialogue' | 'implementing' | 'completed';
type OpenClawBaseUrlError = 'missing' | 'invalid' | 'insecure';
const FIXED_IMPLEMENTATION_BRANCH = 'review';
const DEFAULT_WEBHOOK_MAX_SKEW_SECONDS = 300;
const WEBHOOK_SIGNATURE_PREFIX = 'sha256=';
const webhookReplayCache = new Map<string, number>();

const OPENCLAW_STATUS_ORDER: Record<OpenClawStatus, number> = {
  pending_handoff: 0,
  in_dialogue: 1,
  implementing: 2,
  completed: 3,
};

interface OpenClawConfig {
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
  if (config.baseUrlError === 'insecure') {
    return 'OPENCLAW_BASE_URL はHTTPSを使用してください（localhostのみHTTP許可）。';
  }
  if (config.baseUrlError === 'invalid') {
    return 'OPENCLAW_BASE_URL が不正です。正しいURLを設定してください。';
  }
  return 'OpenClawコネクター未接続。接続後に再連携してください。';
}

function readConfig(): OpenClawConfig {
  const baseUrl = normalizeBaseUrl(process.env.OPENCLAW_BASE_URL ?? '');
  return {
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
  const replayKey = `${timestamp}:${signature}`;
  const existing = webhookReplayCache.get(replayKey);
  if (existing && existing > nowMs) {
    return true;
  }

  const ttlMs = resolveWebhookMaxSkewSeconds() * 1000;
  webhookReplayCache.set(replayKey, nowMs + ttlMs);
  return false;
}

function normalizeStatus(value: unknown): OpenClawStatus {
  if (value === 'in_dialogue' || value === 'implementing' || value === 'completed') {
    return value;
  }
  return 'in_dialogue';
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

  if (isReplayRequest(signature, timestampText, nowMs)) {
    return false;
  }

  return true;
}

export function resetOpenClawWebhookReplayCacheForTests(): void {
  webhookReplayCache.clear();
}

export function isImplementationBranchAllowed(branch: string | null | undefined): boolean {
  if (!branch) return false;
  return branch.trim() === getOpenClawImplementationBranch();
}

export async function handoffToOpenClaw(input: OpenClawHandoffInput): Promise<OpenClawHandoffResult> {
  const config = readConfig();
  const connectorConfigured = Boolean(config.baseUrl && config.apiKey && config.agentId);
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

  const timeoutMsRaw = Number(process.env.OPENCLAW_TIMEOUT_MS ?? 10000);
  const timeoutMs = Number.isFinite(timeoutMsRaw) && timeoutMsRaw > 0 ? timeoutMsRaw : 10000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const requestPayload: Record<string, unknown> = {
      agentId: config.agentId,
      requestId: input.requestId,
      pharmacyId: input.pharmacyId,
      requestText: input.requestText,
      constraints: {
        implementationBranch: config.implementationBranch,
      },
    };

    if (input.context && Object.keys(input.context).length > 0) {
      requestPayload.context = input.context;
    }

    const response = await fetch(`${config.baseUrl}/v1/handoffs`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestPayload),
      signal: controller.signal,
    });

    const payload = await response.json().catch(() => ({} as OpenClawHandoffResponseBody)) as OpenClawHandoffResponseBody;
    if (!response.ok) {
      return {
        accepted: false,
        connectorConfigured: true,
        implementationBranch: config.implementationBranch,
        status: 'pending_handoff',
        threadId: null,
        summary: null,
        note: `OpenClaw連携失敗: HTTP ${response.status}`,
      };
    }

    const threadId = typeof payload.threadId === 'string' && payload.threadId.trim().length > 0
      ? payload.threadId.trim()
      : null;
    const summary = typeof payload.summary === 'string' && payload.summary.trim().length > 0
      ? payload.summary.trim()
      : null;

    return {
      accepted: true,
      connectorConfigured: true,
      implementationBranch: config.implementationBranch,
      status: normalizeStatus(payload.status),
      threadId,
      summary,
      note: `OpenClawへ連携しました。実装ブランチは ${config.implementationBranch} に固定されています。`,
    };
  } catch (err) {
    return {
      accepted: false,
      connectorConfigured: true,
      implementationBranch: config.implementationBranch,
      status: 'pending_handoff',
      threadId: null,
      summary: null,
      note: isAbortError(err) ? 'OpenClaw連携がタイムアウトしました。' : 'OpenClaw連携中にエラーが発生しました。',
    };
  } finally {
    clearTimeout(timer);
  }
}
