import { and, eq, or } from 'drizzle-orm';
import { db } from '../config/database';
import {
  ddsAgentJobs,
  ddsWorkItems,
  openclawRequestMessages,
} from '../db/schema';
import {
  DDS_ENVIRONMENT,
  type DdsWorkItemType,
  inferSource,
  inferWorkItemType,
  nowIso,
} from './dds-agent-utils';

async function ensureInitialRequestMessage(input: {
  requestId: number;
  pharmacyId: number;
  requestText: string;
  type: DdsWorkItemType;
}): Promise<void> {
  const [existing] = await db.select({ id: openclawRequestMessages.id })
    .from(openclawRequestMessages)
    .where(eq(openclawRequestMessages.requestId, input.requestId))
    .limit(1);

  if (existing) {
    return;
  }

  await db.insert(openclawRequestMessages).values({
    requestId: input.requestId,
    authorType: input.type === 'product_update' ? 'user' : 'system',
    messageType: 'message',
    body: input.requestText,
  });
}

export async function enqueueDdsWorkItemFromHandoff(input: {
  requestId: number;
  pharmacyId: number;
  requestText: string;
  context?: Record<string, unknown>;
}): Promise<{ workItemId: number; created: boolean }> {
  const type = inferWorkItemType(input);
  const source = inferSource(input);
  const currentTime = nowIso();

  const [existing] = await db.select()
    .from(ddsWorkItems)
    .where(eq(ddsWorkItems.requestId, input.requestId))
    .limit(1);

  let workItemId: number;
  let created = false;

  if (!existing) {
    const [createdRow] = await db.insert(ddsWorkItems)
      .values({
        requestId: input.requestId,
        pharmacyId: input.pharmacyId,
        type,
        workflowStatus: 'queued',
        source,
        requestText: input.requestText,
        contextJson: input.context ?? null,
        createdAt: currentTime,
        updatedAt: currentTime,
      })
      .returning({ id: ddsWorkItems.id });
    workItemId = createdRow.id;
    created = true;
  } else {
    workItemId = existing.id;
    await db.update(ddsWorkItems)
      .set({
        workflowStatus: existing.workflowStatus === 'awaiting_user' ? 'awaiting_user' : 'queued',
        requestText: input.requestText,
        contextJson: input.context ?? existing.contextJson ?? null,
        updatedAt: currentTime,
      })
      .where(eq(ddsWorkItems.id, existing.id));
  }

  await ensureInitialRequestMessage({
    requestId: input.requestId,
    pharmacyId: input.pharmacyId,
    requestText: input.requestText,
    type,
  });

  const [pendingJob] = await db.select({ id: ddsAgentJobs.id })
    .from(ddsAgentJobs)
    .where(and(
      eq(ddsAgentJobs.workItemId, workItemId),
      or(eq(ddsAgentJobs.status, 'pending'), eq(ddsAgentJobs.status, 'leased')),
    ))
    .limit(1);

  if (!pendingJob) {
    await db.insert(ddsAgentJobs).values({
      workItemId,
      environment: DDS_ENVIRONMENT,
      jobType: type,
      status: 'pending',
      payloadJson: input.context ?? null,
      createdAt: currentTime,
      updatedAt: currentTime,
    });
  }

  return { workItemId, created };
}
