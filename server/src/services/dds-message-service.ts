import { and, asc, eq, or } from 'drizzle-orm';
import { db } from '../config/database';
import {
  ddsAgentJobs,
  ddsWorkItems,
  openclawRequestMessages,
  userRequests,
} from '../db/schema';
import { ApiError } from '../utils/api-error';
import { recordOpenClawRequestEvent } from './openclaw/request-event-service';
import { ensureAgentLease } from './dds-lease-service';
import {
  DDS_ENVIRONMENT,
  hashToken,
  nowIso,
} from './dds-agent-utils';

export async function postDdsQuestion(token: string, workItemId: number, leaseToken: string, body: string): Promise<void> {
  const workItem = await ensureAgentLease(token, workItemId, leaseToken);
  if (!workItem.requestId) {
    throw new ApiError(400, 'ユーザー対話を持たない work item です');
  }

  const currentTime = nowIso();
  const leaseTokenHash = hashToken(leaseToken);
  await db.transaction(async (tx) => {
    await tx.insert(openclawRequestMessages).values({
      requestId: workItem.requestId!,
      authorType: 'openclaw_agent',
      messageType: 'question',
      body,
    });
    await tx.update(ddsWorkItems)
      .set({
        workflowStatus: 'awaiting_user',
        resultSummary: body,
        updatedAt: currentTime,
      })
      .where(eq(ddsWorkItems.id, workItem.id));
    await tx.update(userRequests)
      .set({
        openclawStatus: 'in_dialogue',
        openclawSummary: body.slice(0, 4000),
        updatedAt: currentTime,
      })
      .where(eq(userRequests.id, workItem.requestId!));

    await tx.update(ddsAgentJobs)
      .set({
        status: 'completed',
        completedAt: currentTime,
        payloadJson: {
          action: 'question',
          body,
        },
        updatedAt: currentTime,
      })
      .where(and(
        eq(ddsAgentJobs.workItemId, workItem.id),
        eq(ddsAgentJobs.status, 'leased'),
        eq(ddsAgentJobs.leaseTokenHash, leaseTokenHash),
      ));
  });
}

export async function reportDdsPullRequest(token: string, input: {
  workItemId: number;
  leaseToken: string;
  branchName: string;
  prNumber?: number | null;
  prUrl: string;
  summary: string;
}): Promise<void> {
  const workItem = await ensureAgentLease(token, input.workItemId, input.leaseToken);
  const currentTime = nowIso();
  const leaseTokenHash = hashToken(input.leaseToken);

  await db.transaction(async (tx) => {
    await tx.update(ddsWorkItems)
      .set({
        workflowStatus: 'pr_opened',
        branchName: input.branchName,
        prNumber: input.prNumber ?? null,
        prUrl: input.prUrl,
        resultSummary: input.summary,
        updatedAt: currentTime,
      })
      .where(eq(ddsWorkItems.id, workItem.id));

    await tx.update(ddsAgentJobs)
      .set({
        status: 'completed',
        completedAt: currentTime,
        payloadJson: {
          action: 'pr',
          branchName: input.branchName,
          prNumber: input.prNumber ?? null,
          prUrl: input.prUrl,
        },
        updatedAt: currentTime,
      })
      .where(and(
        eq(ddsAgentJobs.workItemId, workItem.id),
        eq(ddsAgentJobs.status, 'leased'),
        eq(ddsAgentJobs.leaseTokenHash, leaseTokenHash),
      ));

    if (workItem.requestId) {
      await tx.insert(openclawRequestMessages).values({
        requestId: workItem.requestId,
        authorType: 'system',
        messageType: 'pr_report',
        body: `PR を作成しました: ${input.prUrl}\n${input.summary}`,
        metadataJson: JSON.stringify({
          prNumber: input.prNumber ?? null,
          branchName: input.branchName,
          prUrl: input.prUrl,
        }),
      });
      await tx.update(userRequests)
        .set({
          openclawStatus: 'completed',
          openclawSummary: input.summary.slice(0, 4000),
          updatedAt: currentTime,
        })
        .where(eq(userRequests.id, workItem.requestId));
      await recordOpenClawRequestEvent({
        requestId: workItem.requestId,
        pharmacyId: workItem.pharmacyId,
        eventType: 'status_updated',
        fromStatus: 'implementing',
        toStatus: 'completed',
        summary: input.summary,
        note: `DDS が PR を作成しました: ${input.prUrl}`,
      }, tx);
    }
  });
}

export async function completeDdsWorkItem(token: string, input: {
  workItemId: number;
  leaseToken: string;
  status: 'completed' | 'failed';
  summary: string;
}): Promise<void> {
  const workItem = await ensureAgentLease(token, input.workItemId, input.leaseToken);
  const currentTime = nowIso();
  const leaseTokenHash = hashToken(input.leaseToken);
  const nextWorkflowStatus = input.status === 'failed' ? 'failed' : 'completed';

  await db.transaction(async (tx) => {
    await tx.update(ddsWorkItems)
      .set({
        workflowStatus: nextWorkflowStatus,
        resultSummary: input.summary,
        updatedAt: currentTime,
      })
      .where(eq(ddsWorkItems.id, workItem.id));

    await tx.update(ddsAgentJobs)
      .set({
        status: 'completed',
        completedAt: currentTime,
        payloadJson: {
          action: input.status,
          summary: input.summary,
        },
        updatedAt: currentTime,
      })
      .where(and(
        eq(ddsAgentJobs.workItemId, workItem.id),
        eq(ddsAgentJobs.status, 'leased'),
        eq(ddsAgentJobs.leaseTokenHash, leaseTokenHash),
      ));

    if (workItem.requestId) {
      await tx.update(userRequests)
        .set({
          openclawStatus: input.status === 'failed' ? 'in_dialogue' : 'completed',
          openclawSummary: input.summary.slice(0, 4000),
          updatedAt: currentTime,
        })
        .where(eq(userRequests.id, workItem.requestId));

      await tx.insert(openclawRequestMessages).values({
        requestId: workItem.requestId,
        authorType: 'system',
        messageType: input.status === 'failed' ? 'status_update' : 'message',
        body: input.summary,
        metadataJson: JSON.stringify({
          ddsStatus: input.status,
        }),
      });
    }
  });
}

export async function listRequestMessagesForUser(requestId: number, pharmacyId: number): Promise<(typeof openclawRequestMessages.$inferSelect)[]> {
  const [requestRow] = await db.select({
    id: userRequests.id,
  })
    .from(userRequests)
    .where(and(
      eq(userRequests.id, requestId),
      eq(userRequests.pharmacyId, pharmacyId),
    ))
    .limit(1);

  if (!requestRow) {
    throw new ApiError(404, '対象の要望が見つかりません');
  }

  return db.select()
    .from(openclawRequestMessages)
    .where(eq(openclawRequestMessages.requestId, requestId))
    .orderBy(asc(openclawRequestMessages.createdAt), asc(openclawRequestMessages.id));
}

export async function addUserReplyToRequest(requestId: number, pharmacyId: number, body: string): Promise<void> {
  const [workItem] = await db.select({
    id: ddsWorkItems.id,
    workflowStatus: ddsWorkItems.workflowStatus,
  })
    .from(ddsWorkItems)
    .innerJoin(userRequests, eq(userRequests.id, ddsWorkItems.requestId))
    .where(and(
      eq(ddsWorkItems.requestId, requestId),
      eq(userRequests.pharmacyId, pharmacyId),
    ))
    .limit(1);

  if (!workItem) {
    throw new ApiError(404, '対象の要望が見つかりません');
  }

  const currentTime = nowIso();
  await db.transaction(async (tx) => {
    await tx.insert(openclawRequestMessages).values({
      requestId,
      authorType: 'user',
      messageType: 'message',
      body,
    });

    await tx.update(ddsWorkItems)
      .set({
        workflowStatus: 'queued',
        updatedAt: currentTime,
      })
      .where(eq(ddsWorkItems.id, workItem.id));

    await tx.update(userRequests)
      .set({
        openclawStatus: 'in_dialogue',
        updatedAt: currentTime,
      })
      .where(eq(userRequests.id, requestId));

    const [existingJob] = await tx.select({ id: ddsAgentJobs.id })
      .from(ddsAgentJobs)
      .where(and(
        eq(ddsAgentJobs.workItemId, workItem.id),
        or(eq(ddsAgentJobs.status, 'pending'), eq(ddsAgentJobs.status, 'leased')),
      ))
      .limit(1);

    if (!existingJob) {
      await tx.insert(ddsAgentJobs).values({
        workItemId: workItem.id,
        environment: DDS_ENVIRONMENT,
        jobType: 'user_reply',
        status: 'pending',
        payloadJson: {
          resumeReason: 'user_reply',
        },
        createdAt: currentTime,
        updatedAt: currentTime,
      });
    }
  });
}
