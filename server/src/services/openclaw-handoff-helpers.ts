import { isRecord } from '../utils/type-guards';
import {
  resolveGatewayTimeoutMs,
  resolveGatewayTimeoutSeconds,
  resolveRetryBaseMs,
  resolveRetryMax,
  type OpenClawConfig,
  type OpenClawHandoffResult,
  type OpenClawStatus,
} from './openclaw-status';

export interface OpenClawHandoffInput {
  requestId: number;
  pharmacyId: number;
  requestText: string;
  context?: Record<string, unknown>;
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

export function readStringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' ? value : null;
}

export function extractGatewaySummaryPayload(payload: unknown): string {
  if (!isRecord(payload)) {
    return '';
  }

  const choices = payload.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return '';
  }

  const firstChoice = choices[0];
  if (!isRecord(firstChoice)) {
    return '';
  }

  const message = firstChoice.message;
  if (!isRecord(message)) {
    return '';
  }

  return readStringField(message, 'content') ?? '';
}

export function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
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

export function sanitizeCliMessage(input: string, maxLength: number = 8000): string {
  const sanitized = input
    .replace(/[\x00-\x09\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/[`$\\]/g, '')
    .trim();

  return sanitized.slice(0, maxLength);
}

export function normalizeStatus(value: unknown): OpenClawStatus {
  if (value === 'in_dialogue' || value === 'implementing' || value === 'completed') {
    return value;
  }
  return 'in_dialogue';
}

export function buildHandoffIdempotencyKey(input: OpenClawHandoffInput): string {
  return `openclaw-handoff:${input.requestId}:${input.pharmacyId}`;
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

export function buildHandoffSuccess(
  config: OpenClawConfig,
  options: {
    status: OpenClawStatus;
    threadId: string | null;
    summary: string | null;
    note: string;
  },
): OpenClawHandoffResult {
  return {
    accepted: true,
    connectorConfigured: true,
    implementationBranch: config.implementationBranch,
    ...options,
  };
}

export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

export function calcBackoffMs(attempt: number): number {
  const baseMs = resolveRetryBaseMs();
  const jitter = Math.floor(Math.random() * 100);
  return baseMs * Math.max(1, 2 ** (attempt - 1)) + jitter;
}

export function extractSummaryFromCli(payload: OpenClawCliAgentResponse, fallbackStdout: string): string | null {
  const text = payload.result?.payloads?.find((entry) => typeof entry?.text === 'string' && entry.text.trim().length > 0)?.text;
  if (typeof text === 'string' && text.trim().length > 0) {
    return text.trim().slice(0, 4000);
  }
  const trimmed = fallbackStdout.trim();
  return trimmed ? trimmed.slice(0, 4000) : null;
}

export function getGatewayTimeoutSeconds(): number {
  return resolveGatewayTimeoutSeconds();
}

export function getGatewayTimeoutMs(): number {
  return resolveGatewayTimeoutMs();
}

export function getRetryMaxAttempts(): number {
  return resolveRetryMax() + 1;
}
