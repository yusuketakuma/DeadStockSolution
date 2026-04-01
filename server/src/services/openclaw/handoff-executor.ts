import { eq } from 'drizzle-orm';
import { db } from '../../config/database';
import { userRequests } from '../../db/schema';
import { logger } from '../logger';
import { handoffToOpenClaw, type OpenClawStatus } from './index';
import { recordOpenClawRequestEvent } from './request-event-service';
import { scheduleOpenClawRetry } from './retry-service';

export type HandoffSkipReason =
  | 'disabled'
  | 'invalid_pharmacy_id'
  | 'deduplicated'
  | 'duplicate_inflight'
  | 'not_5xx'
  | 'error';

export interface HandoffExecutorResult {
  triggered: boolean;
  accepted: boolean;
  requestId: number | null;
  status: OpenClawStatus | 'pending_handoff';
  reason: string;
}

export interface HandoffExecutorInput {
  pharmacyId: number;
  requestText: string;
  context: Record<string, unknown>;
  logLabel: string;
}

export function skippedHandoff(reason: HandoffSkipReason): HandoffExecutorResult {
  return { triggered: false, accepted: false, requestId: null, status: 'pending_handoff', reason };
}

export async function executeOpenClawHandoff(
  input: HandoffExecutorInput,
): Promise<HandoffExecutorResult> {
  const [created] = await db
    .insert(userRequests)
    .values({
      pharmacyId: input.pharmacyId,
      requestText: input.requestText,
      openclawStatus: 'pending_handoff',
    })
    .returning({ id: userRequests.id });

  try {
    await recordOpenClawRequestEvent({
      requestId: created.id,
      pharmacyId: input.pharmacyId,
      eventType: 'created',
      toStatus: 'pending_handoff',
      note: input.logLabel,
    });

    const handoff = await handoffToOpenClaw({
      requestId: created.id,
      pharmacyId: input.pharmacyId,
      requestText: input.requestText,
      context: input.context,
    });

    if (handoff.accepted) {
      await db
        .update(userRequests)
        .set({
          openclawStatus: handoff.status,
          openclawThreadId: handoff.threadId,
          openclawSummary: handoff.summary,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(userRequests.id, created.id));
      await recordOpenClawRequestEvent({
        requestId: created.id,
        pharmacyId: input.pharmacyId,
        eventType: 'handoff_accepted',
        fromStatus: 'pending_handoff',
        toStatus: handoff.status,
        threadId: handoff.threadId,
        summary: handoff.summary,
        note: handoff.note,
      });
    } else {
      await scheduleOpenClawRetry({
        requestId: created.id,
        pharmacyId: input.pharmacyId,
        reason: handoff.note,
      });
      await recordOpenClawRequestEvent({
        requestId: created.id,
        pharmacyId: input.pharmacyId,
        eventType: 'handoff_deferred',
        fromStatus: 'pending_handoff',
        toStatus: 'pending_handoff',
        note: handoff.note,
      });
    }

    logger.info(input.logLabel, {
      requestId: created.id,
      accepted: handoff.accepted,
      status: handoff.status,
    });

    return {
      triggered: true,
      accepted: handoff.accepted,
      requestId: created.id,
      status: handoff.status,
      reason: handoff.note,
    };
  } catch (err) {
    logger.error('executeOpenClawHandoff failed after insert', {
      requestId: created.id,
      pharmacyId: input.pharmacyId,
      error: err instanceof Error ? err.message : String(err),
    });
    await recordOpenClawRequestEvent({
      requestId: created.id,
      pharmacyId: input.pharmacyId,
      eventType: 'handoff_deferred',
      fromStatus: 'pending_handoff',
      toStatus: 'pending_handoff',
      note: `executor error: ${err instanceof Error ? err.message : String(err)}`,
    }).catch(() => {});
    throw err;
  }
}
