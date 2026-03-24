import { and, asc, eq, inArray, lte, ne, sql } from 'drizzle-orm';
import { db } from '../config/database';
import { openclawRetryJobs, userRequests } from '../db/schema';
import { logger } from './logger';
import { recordOpenClawRequestEvent } from './openclaw-request-event-service';
import { handoffToOpenClaw } from './openclaw-service';

interface PostgresErrorLike {
  code?: string;
}

export interface OpenClawRetryQueueSnapshot {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
}

export interface ScheduleOpenClawRetryInput {
  requestId: number;
  pharmacyId: number;
  reason: string;
  maxAttempts?: number;
}

export interface ProcessOpenClawRetriesResult {
  processed: number;
  completed: number;
  deferred: number;
  failed: number;
  skipped: number;
}

const EMPTY_SNAPSHOT: OpenClawRetryQueueSnapshot = {
  pending: 0,
  processing: 0,
  completed: 0,
  failed: 0,
};

const EMPTY_PROCESS_RESULT: ProcessOpenClawRetriesResult = {
  processed: 0,
  completed: 0,
  deferred: 0,
  failed: 0,
  skipped: 0,
};

function isUndefinedTableError(err: unknown): err is PostgresErrorLike {
  return typeof err === 'object' && err !== null && (err as PostgresErrorLike).code === '42P01';
}

function nowIso(): string {
  return new Date().toISOString();
}

function clampMaxAttempts(input?: number): number {
  if (!Number.isFinite(input)) return 3;
  return Math.max(1, Math.min(10, Math.floor(input as number)));
}

function resolveRetryDelayMs(attemptCount: number): number {
  const baseMs = 60_000;
  const delay = baseMs * (2 ** Math.max(0, attemptCount - 1));
  return Math.min(delay, 15 * 60_000);
}

function truncateErrorMessage(message: string): string {
  return message.trim().slice(0, 4000);
}

export async function scheduleOpenClawRetry(input: ScheduleOpenClawRetryInput): Promise<void> {
  const currentTime = nowIso();
  const reason = truncateErrorMessage(input.reason || 'retry scheduled');

  try {
    await db.insert(openclawRetryJobs)
      .values({
        requestId: input.requestId,
        pharmacyId: input.pharmacyId,
        status: 'pending',
        attemptCount: 0,
        maxAttempts: clampMaxAttempts(input.maxAttempts),
        nextRetryAt: currentTime,
        lastError: reason,
        triggerReason: reason,
        updatedAt: currentTime,
      })
      .onConflictDoUpdate({
        target: openclawRetryJobs.requestId,
        set: {
          pharmacyId: input.pharmacyId,
          status: 'pending',
          nextRetryAt: currentTime,
          lastError: reason,
          triggerReason: reason,
          completedAt: null,
          updatedAt: currentTime,
        },
      });
  } catch (err) {
    if (isUndefinedTableError(err)) {
      return;
    }
    throw err;
  }
}

export async function getOpenClawRetryQueueSnapshot(): Promise<OpenClawRetryQueueSnapshot> {
  try {
    const rows = await db.select({ status: openclawRetryJobs.status })
      .from(openclawRetryJobs);

    return rows.reduce<OpenClawRetryQueueSnapshot>((acc, row) => {
      if (row.status === 'pending') acc.pending += 1;
      if (row.status === 'processing') acc.processing += 1;
      if (row.status === 'completed') acc.completed += 1;
      if (row.status === 'failed') acc.failed += 1;
      return acc;
    }, { ...EMPTY_SNAPSHOT });
  } catch (err) {
    if (!isUndefinedTableError(err)) {
      logger.warn('OpenClaw retry snapshot query failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return { ...EMPTY_SNAPSHOT };
  }
}

export async function markOpenClawRetryJobCompleted(id: number): Promise<void> {
  const currentTime = nowIso();
  try {
    await db.update(openclawRetryJobs)
      .set({
        status: 'completed',
        completedAt: currentTime,
        updatedAt: currentTime,
      })
      .where(eq(openclawRetryJobs.id, id));
  } catch (err) {
    if (!isUndefinedTableError(err)) {
      logger.warn('OpenClaw retry completion update failed', {
        id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

export async function completeOpenClawRetryForRequest(requestId: number): Promise<void> {
  const currentTime = nowIso();
  try {
    await db.update(openclawRetryJobs)
      .set({
        status: 'completed',
        completedAt: currentTime,
        updatedAt: currentTime,
      })
      .where(and(
        eq(openclawRetryJobs.requestId, requestId),
        ne(openclawRetryJobs.status, 'completed'),
      ));
  } catch (err) {
    if (!isUndefinedTableError(err)) {
      logger.warn('OpenClaw retry completion update failed', {
        requestId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

export async function processPendingOpenClawRetries(limit: number = 20): Promise<ProcessOpenClawRetriesResult> {
  const currentTime = nowIso();
  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));

  let jobs: Array<{
    id: number;
    requestId: number;
    pharmacyId: number;
    attemptCount: number;
    maxAttempts: number;
  }> = [];

  try {
    jobs = await db.select({
      id: openclawRetryJobs.id,
      requestId: openclawRetryJobs.requestId,
      pharmacyId: openclawRetryJobs.pharmacyId,
      attemptCount: openclawRetryJobs.attemptCount,
      maxAttempts: openclawRetryJobs.maxAttempts,
    })
      .from(openclawRetryJobs)
      .where(and(
        inArray(openclawRetryJobs.status, ['pending']),
        lte(openclawRetryJobs.nextRetryAt, currentTime),
      ))
      .orderBy(asc(openclawRetryJobs.nextRetryAt), asc(openclawRetryJobs.id))
      .limit(safeLimit);
  } catch (err) {
    if (isUndefinedTableError(err)) {
      return { ...EMPTY_PROCESS_RESULT };
    }
    throw err;
  }

  const result: ProcessOpenClawRetriesResult = { ...EMPTY_PROCESS_RESULT };

  for (const job of jobs) {
    const claimed = await db.update(openclawRetryJobs)
      .set({
        status: 'processing',
        attemptCount: job.attemptCount + 1,
        lastAttemptAt: currentTime,
        updatedAt: currentTime,
      })
      .where(and(
        eq(openclawRetryJobs.id, job.id),
        eq(openclawRetryJobs.status, 'pending'),
      ))
      .returning({ id: openclawRetryJobs.id });

    if (claimed.length === 0) {
      continue;
    }

    result.processed += 1;
    const currentAttempt = job.attemptCount + 1;

    try {
      const [requestRow] = await db.select({
        requestText: userRequests.requestText,
        openclawStatus: userRequests.openclawStatus,
        openclawThreadId: userRequests.openclawThreadId,
        openclawSummary: userRequests.openclawSummary,
      })
        .from(userRequests)
        .where(eq(userRequests.id, job.requestId))
        .limit(1);

      if (!requestRow || requestRow.openclawStatus !== 'pending_handoff') {
        await markOpenClawRetryJobCompleted(job.id);
        result.skipped += 1;
        continue;
      }

      const handoff = await handoffToOpenClaw({
        requestId: job.requestId,
        pharmacyId: job.pharmacyId,
        requestText: requestRow.requestText,
        context: {
          source: 'openclaw_retry_queue',
          retryJobId: job.id,
          attempt: currentAttempt,
        },
        handoffKey: `retry:${currentAttempt}`,
      });

      if (handoff.accepted) {
        await db.transaction(async (tx) => {
          await tx.update(userRequests)
            .set({
              openclawStatus: handoff.status,
              openclawThreadId: handoff.threadId,
              openclawSummary: handoff.summary,
              updatedAt: currentTime,
            })
            .where(eq(userRequests.id, job.requestId));

          await tx.update(openclawRetryJobs)
            .set({
              status: 'completed',
              completedAt: currentTime,
              lastError: null,
              updatedAt: currentTime,
            })
            .where(eq(openclawRetryJobs.id, job.id));

          await recordOpenClawRequestEvent({
            requestId: job.requestId,
            pharmacyId: job.pharmacyId,
            eventType: 'handoff_accepted',
            fromStatus: 'pending_handoff',
            toStatus: handoff.status,
            threadId: handoff.threadId,
            summary: handoff.summary,
            note: handoff.note,
            metadata: {
              retryJobId: job.id,
              attempt: currentAttempt,
            },
          }, tx);
        });

        result.completed += 1;
        continue;
      }

      const exhausted = currentAttempt >= job.maxAttempts;
      const nextRetryAt = new Date(Date.now() + resolveRetryDelayMs(currentAttempt)).toISOString();
      await db.transaction(async (tx) => {
        await tx.update(openclawRetryJobs)
          .set({
            status: exhausted ? 'failed' : 'pending',
            nextRetryAt,
            lastError: truncateErrorMessage(handoff.note),
            updatedAt: currentTime,
          })
          .where(eq(openclawRetryJobs.id, job.id));

        await recordOpenClawRequestEvent({
          requestId: job.requestId,
          pharmacyId: job.pharmacyId,
          eventType: 'handoff_deferred',
          fromStatus: 'pending_handoff',
          toStatus: 'pending_handoff',
          note: handoff.note,
          metadata: {
            retryJobId: job.id,
            attempt: currentAttempt,
            exhausted,
            nextRetryAt: exhausted ? null : nextRetryAt,
          },
        }, tx);
      });

      if (exhausted) {
        result.failed += 1;
      } else {
        result.deferred += 1;
      }
    } catch (err) {
      const message = truncateErrorMessage(err instanceof Error ? err.message : String(err));
      const exhausted = currentAttempt >= job.maxAttempts;
      const nextRetryAt = new Date(Date.now() + resolveRetryDelayMs(currentAttempt)).toISOString();

      try {
        await db.update(openclawRetryJobs)
          .set({
            status: exhausted ? 'failed' : 'pending',
            nextRetryAt,
            lastError: message,
            updatedAt: currentTime,
          })
          .where(eq(openclawRetryJobs.id, job.id));
      } catch (updateErr) {
        logger.warn('OpenClaw retry failure update failed', {
          jobId: job.id,
          error: updateErr instanceof Error ? updateErr.message : String(updateErr),
        });
      }

      logger.warn('OpenClaw retry processing failed', {
        jobId: job.id,
        requestId: job.requestId,
        attempt: currentAttempt,
        exhausted,
        error: message,
      });

      if (exhausted) {
        result.failed += 1;
      } else {
        result.deferred += 1;
      }
    }
  }

  return result;
}
