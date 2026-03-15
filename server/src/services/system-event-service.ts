import { db } from '../config/database';
import { systemEvents, type SystemEventLevel, type SystemEventSource } from '../db/schema';
import { logger } from './logger';
import { dispatchLogAlert } from './openclaw-log-push-service';
import { getLogEntryById, getLogInsightForEntry } from './log-center-service';
import { recordLogIssueAutoEscalation } from './log-center-issue-service';

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
  sourceLocation?: string | null;
  tenant?: {
    pharmacyId?: number | null;
    pharmacyEmail?: string | null;
  };
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
    const occurredAt = input.occurredAt ?? new Date().toISOString();
    const [inserted] = await db.insert(systemEvents).values({
      source: input.source,
      level: input.level ?? 'error',
      eventType: sanitizeMessage(input.eventType),
      message: sanitizeMessage(input.message),
      detailJson: toDetailJson(input.detail),
      errorCode: input.errorCode ?? null,
      occurredAt,
    }).returning({ id: systemEvents.id });

    // Forward errors/warnings to OpenClaw
    const effectiveLevel = input.level ?? 'error';
    if (effectiveLevel === 'error' || effectiveLevel === 'warning') {
      try {
        const entry = inserted?.id ? await getLogEntryById('system_events', inserted.id) : null;
        const insight = entry ? await getLogInsightForEntry(entry) : null;
        const result = await dispatchLogAlert({
          source: 'system_events',
          severity: effectiveLevel === 'error' ? 'error' : 'warning',
          errorCode: entry?.errorCode ?? input.errorCode ?? null,
          message: entry?.message ?? sanitizeMessage(input.message),
          logId: inserted?.id ?? 0,
          occurredAt: entry?.timestamp ?? occurredAt,
          detail: entry?.detail ?? input.detail,
          codeLocation: entry?.codeLocation ?? null,
          tenant: entry ? {
            pharmacyId: entry.tenant.pharmacyId,
            pharmacyName: entry.tenant.pharmacyName,
            pharmacyEmail: entry.tenant.pharmacyEmail,
          } : undefined,
          whatHappened: entry?.whatHappened ?? null,
          improvementSuggestion: entry?.improvementSuggestion ?? null,
          recurrenceCount: insight?.count,
          impactedTenantCount: insight?.impactedTenantCount,
        });
        if (result.mode === 'auto_escalated' && inserted?.id) {
          await recordLogIssueAutoEscalation({
            source: 'system_events',
            logId: inserted.id,
            reasonCodes: result.reasonCodes,
            note: 'system event auto escalation',
          });
        }
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
      method: input.method,
      path: input.path,
      status: input.status,
      requestId: input.requestId ?? null,
      code: input.errorCode ?? null,
      sourceLocation: input.sourceLocation ?? null,
      tenant: {
        pharmacyId: input.tenant?.pharmacyId ?? null,
        pharmacyEmail: input.tenant?.pharmacyEmail ?? null,
      },
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
