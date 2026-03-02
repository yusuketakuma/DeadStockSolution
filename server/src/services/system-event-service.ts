import { db } from '../config/database';
import { systemEvents, type SystemEventLevel, type SystemEventSource } from '../db/schema';
import { logger } from './logger';
import { enqueueLogAlert } from './openclaw-log-push-service';

interface SystemEventInput {
  source: SystemEventSource;
  level?: SystemEventLevel;
  eventType: string;
  message: string;
  detail?: unknown;
  occurredAt?: string;
  errorCode?: string;
}

interface HttpErrorSnapshotInput {
  method: string;
  path: string;
  status: number;
  requestId?: string;
  errorCode?: string;
}

const MAX_MESSAGE_LENGTH = 2000;
const MAX_DETAIL_LENGTH = 12000;

function sanitizeMessage(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= MAX_MESSAGE_LENGTH) return trimmed;
  return `${trimmed.slice(0, MAX_MESSAGE_LENGTH)}...`;
}

function toDetailJson(detail: unknown): string | null {
  if (detail === undefined || detail === null) return null;
  if (typeof detail === 'string') {
    return detail.length > MAX_DETAIL_LENGTH ? `${detail.slice(0, MAX_DETAIL_LENGTH)}...` : detail;
  }
  try {
    const serialized = JSON.stringify(detail);
    if (!serialized) return null;
    return serialized.length > MAX_DETAIL_LENGTH ? `${serialized.slice(0, MAX_DETAIL_LENGTH)}...` : serialized;
  } catch {
    return null;
  }
}

export async function recordSystemEvent(input: SystemEventInput): Promise<boolean> {
  try {
    await db.insert(systemEvents).values({
      source: input.source,
      level: input.level ?? 'error',
      eventType: sanitizeMessage(input.eventType),
      message: sanitizeMessage(input.message),
      detailJson: toDetailJson(input.detail),
      errorCode: input.errorCode ?? null,
      occurredAt: input.occurredAt ?? new Date().toISOString(),
    });

    // Forward errors/warnings to OpenClaw
    const effectiveLevel = input.level ?? 'error';
    if (effectiveLevel === 'error' || effectiveLevel === 'warning') {
      try {
        enqueueLogAlert({
          source: 'system_events',
          severity: effectiveLevel === 'error' ? 'error' : 'warning',
          errorCode: input.errorCode ?? null,
          message: sanitizeMessage(input.message),
          logId: 0,
          occurredAt: input.occurredAt ?? new Date().toISOString(),
        });
      } catch {
        // Log push should never break event recording
      }
    }

    return true;
  } catch (err) {
    logger.error('Failed to persist system event', {
      source: input.source,
      eventType: input.eventType,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

export async function recordHttpUnhandledError(input: HttpErrorSnapshotInput): Promise<boolean> {
  return recordSystemEvent({
    source: 'runtime_error',
    level: input.status >= 500 ? 'error' : 'warning',
    eventType: 'http_unhandled_error',
    message: `${input.method} ${input.path} -> ${input.status}`,
    detail: {
      status: input.status,
      requestId: input.requestId ?? null,
      code: input.errorCode ?? null,
    },
  });
}

export async function recordUnhandledRejection(reason: unknown): Promise<boolean> {
  return recordSystemEvent({
    source: 'unhandled_rejection',
    level: 'error',
    eventType: 'process_unhandled_rejection',
    message: reason instanceof Error ? reason.message : String(reason),
    detail: reason instanceof Error
      ? { errorName: reason.name }
      : { reason: String(reason) },
  });
}

export async function recordUncaughtException(err: unknown): Promise<boolean> {
  const message = err instanceof Error ? err.message : String(err);
  return recordSystemEvent({
    source: 'uncaught_exception',
    level: 'error',
    eventType: 'process_uncaught_exception',
    message,
    detail: err instanceof Error
      ? { errorName: err.name }
      : { error: message },
  });
}

export interface VercelDeployEventInput {
  eventType: string;
  level: SystemEventLevel;
  message: string;
  deploymentId?: string | null;
  url?: string | null;
  payload?: unknown;
}

export async function recordVercelDeployEvent(input: VercelDeployEventInput): Promise<boolean> {
  return recordSystemEvent({
    source: 'vercel_deploy',
    level: input.level,
    eventType: input.eventType,
    message: input.message,
    detail: {
      deploymentId: input.deploymentId ?? null,
      url: input.url ?? null,
      payload: input.payload ?? null,
    },
  });
}
