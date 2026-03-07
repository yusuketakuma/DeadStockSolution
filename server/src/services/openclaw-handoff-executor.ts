import { eq } from 'drizzle-orm';
import { db } from '../config/database';
import { userRequests } from '../db/schema';
import { logger } from './logger';
import { handoffToOpenClaw, type OpenClawStatus } from './openclaw-service';

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
}
