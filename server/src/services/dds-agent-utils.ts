import crypto from 'crypto';
import { decodeAttachmentContent } from '../utils/attachment-utils';

export type DdsWorkItemType = 'incident_autofix' | 'product_update';
export type DdsWorkflowStatus =
  | 'queued'
  | 'analyzing'
  | 'awaiting_user'
  | 'implementing'
  | 'pr_opened'
  | 'completed'
  | 'failed';

export type UserRequestMessageAuthor = 'user' | 'dds_agent' | 'system' | 'admin';

export const DDS_ENVIRONMENT = 'production';
export const DEFAULT_BOOTSTRAP_TTL_SECONDS = 900;
export const DEFAULT_LEASE_SECONDS = 180;
export const DDS_INTERNAL_NOTE_LIMIT = 5;
export const DDS_ATTACHMENT_PREVIEW_LIMIT = 2000;

export function nowIso(): string {
  return new Date().toISOString();
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function createOpaqueToken(): string {
  return crypto.randomBytes(24).toString('hex');
}

export function resolveBootstrapTtlSeconds(): number {
  const raw = Number(process.env.OPENCLAW_REMOTE_AGENT_BOOTSTRAP_TTL_SECONDS ?? DEFAULT_BOOTSTRAP_TTL_SECONDS);
  if (!Number.isFinite(raw)) return DEFAULT_BOOTSTRAP_TTL_SECONDS;
  return Math.max(60, Math.min(3600, Math.floor(raw)));
}

export function resolveLeaseSeconds(): number {
  const raw = Number(process.env.OPENCLAW_REMOTE_AGENT_LEASE_SECONDS ?? DEFAULT_LEASE_SECONDS);
  if (!Number.isFinite(raw)) return DEFAULT_LEASE_SECONDS;
  return Math.max(30, Math.min(900, Math.floor(raw)));
}

export function buildAbsoluteApiUrl(path: string): string {
  const explicitBase = (process.env.OPENCLAW_PUBLIC_BASE_URL ?? '').trim().replace(/\/+$/, '');
  if (explicitBase) {
    return `${explicitBase}${path}`;
  }

  const vercelUrl = (process.env.VERCEL_URL ?? '').trim();
  if (vercelUrl) {
    return `https://${vercelUrl}${path}`;
  }

  const port = (process.env.PORT ?? '3000').trim();
  return `http://127.0.0.1:${port}${path}`;
}

export function inferWorkItemType(input: {
  requestText: string;
  context?: Record<string, unknown>;
}): DdsWorkItemType {
  if (typeof input.context?.source === 'string' && input.context.source === 'sentry_error_autofix') {
    return 'incident_autofix';
  }
  if (input.requestText.startsWith('[自動修正]')) {
    return 'incident_autofix';
  }
  return 'product_update';
}

export function inferSource(input: {
  context?: Record<string, unknown>;
}): string {
  return typeof input.context?.source === 'string' && input.context.source.trim()
    ? input.context.source.trim().slice(0, 64)
    : 'user_request';
}

export function isTextPreviewableMimeType(mimeType: string | null | undefined): boolean {
  if (!mimeType) {
    return false;
  }
  const normalized = mimeType.toLowerCase();
  return normalized.startsWith('text/')
    || normalized === 'application/json'
    || normalized === 'application/vnd.ms-excel';
}

export function buildAttachmentPreviewText(contentBase64: string, mimeType: string): string | null {
  if (!isTextPreviewableMimeType(mimeType)) {
    return null;
  }

  const decoded = decodeAttachmentContent(contentBase64)
    .toString('utf8')
    .replace(/\u0000/g, '')
    .trim();

  return decoded ? decoded.slice(0, DDS_ATTACHMENT_PREVIEW_LIMIT) : null;
}

export function buildAttachmentDownloadUrl(workItemId: number, attachmentId: number, leaseToken: string): string {
  const url = new URL(buildAbsoluteApiUrl(`/api/openclaw/connect/work-items/${workItemId}/attachments/${attachmentId}`));
  url.searchParams.set('leaseToken', leaseToken);
  return url.toString();
}

export function buildDdsWorkItemSummary(input: {
  requestText: string;
  resultSummary?: string | null;
  latestSummary?: string | null;
  openclawSummary?: string | null;
  lastConversationBody?: string | null;
}): string {
  return (
    input.resultSummary?.trim()
    || input.latestSummary?.trim()
    || input.openclawSummary?.trim()
    || input.lastConversationBody?.trim()
    || input.requestText.trim()
    || 'DDS work item'
  ).slice(0, 4000);
}
