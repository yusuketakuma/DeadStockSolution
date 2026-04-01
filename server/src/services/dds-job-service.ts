import { and, asc, eq, inArray, lt, sql } from 'drizzle-orm';
import { db } from '../config/database';
import {
  ddsAgentJobs,
  ddsWorkItems,
  requestMessageAttachments,
} from '../db/schema';
import {
  computeRequestWaitingState,
  getAdminRequestDetail,
  listRequestInternalNotes,
} from './request-collaboration-service';
import { listOpenClawRequestMessages } from './openclaw/thread-service';
import { authenticateControlToken } from './dds-bootstrap-service';
import {
  DDS_ENVIRONMENT,
  DDS_INTERNAL_NOTE_LIMIT,
  type DdsWorkItemType,
  type DdsWorkflowStatus,
  buildAttachmentDownloadUrl,
  buildAttachmentPreviewText,
  buildDdsWorkItemSummary,
  createOpaqueToken,
  hashToken,
  nowIso,
  resolveLeaseSeconds,
} from './dds-agent-utils';

export async function claimNextDdsJob(token: string): Promise<null | {
  jobId: number;
  leaseToken: string;
  leaseExpiresAt: string;
  workItem: {
    id: number;
    type: DdsWorkItemType;
    workflowStatus: DdsWorkflowStatus;
      requestId: number | null;
      pharmacyId: number;
      pharmacyName: string | null;
      threadId: string | null;
      requestText: string;
      summary: string;
      source: string;
      context: Record<string, unknown> | null;
    category: string | null;
    priority: string | null;
    closeReason: string | null;
    assignedAdminId: number | null;
    assignedAdminName: string | null;
    waitingOn: 'user' | 'admin' | 'openclaw' | null;
      isOverdue: boolean;
      openclawStatus: string | null;
      lastQuestion: string | null;
      lastError: string | null;
      internalNotes: Array<{
        id: number;
        body: string;
      createdAt: string;
      authorAdminId: number | null;
      authorAdminName: string | null;
    }>;
    conversation: Array<{
      id: number;
      authorType: string;
      messageType: string;
      body: string;
      createdAt: string;
      metadata: Record<string, unknown> | null;
      attachments: Array<{
        id: number;
        fileName: string;
        mimeType: string;
        fileSize: number;
        downloadUrl: string;
        previewText: string | null;
      }>;
    }>;
  };
}> {
  const connection = await authenticateControlToken(token);
  const currentTime = nowIso();

  await db.update(ddsAgentJobs)
    .set({
      status: 'pending',
      leaseTokenHash: null,
      leaseExpiresAt: null,
      updatedAt: currentTime,
    })
    .where(and(
      eq(ddsAgentJobs.environment, DDS_ENVIRONMENT),
      eq(ddsAgentJobs.status, 'leased'),
      lt(ddsAgentJobs.leaseExpiresAt, currentTime),
    ));

  const [job] = await db.select({
    id: ddsAgentJobs.id,
    workItemId: ddsAgentJobs.workItemId,
  })
    .from(ddsAgentJobs)
    .where(and(
      eq(ddsAgentJobs.environment, DDS_ENVIRONMENT),
      eq(ddsAgentJobs.status, 'pending'),
    ))
    .orderBy(asc(ddsAgentJobs.createdAt), asc(ddsAgentJobs.id))
    .limit(1);

  if (!job) {
    return null;
  }

  const leaseToken = createOpaqueToken();
  const leaseExpiresAt = new Date(Date.now() + resolveLeaseSeconds() * 1000).toISOString();

  const locked = await db.update(ddsAgentJobs)
    .set({
      agentId: connection.agentId,
      status: 'leased',
      leaseTokenHash: hashToken(leaseToken),
      leaseExpiresAt,
      leasedAt: currentTime,
      attemptCount: sql`${ddsAgentJobs.attemptCount} + 1`,
      updatedAt: currentTime,
    })
    .where(and(
      eq(ddsAgentJobs.id, job.id),
      eq(ddsAgentJobs.status, 'pending'),
    ))
    .returning({ id: ddsAgentJobs.id });

  if (locked.length === 0) {
    return null;
  }

  if (!job.workItemId) {
    return null;
  }

  const [workItem] = await db.select()
    .from(ddsWorkItems)
    .where(eq(ddsWorkItems.id, job.workItemId))
    .limit(1);

  if (!workItem) {
    return null;
  }

  await db.update(ddsWorkItems)
    .set({
      workflowStatus: 'analyzing',
      updatedAt: currentTime,
    })
    .where(eq(ddsWorkItems.id, workItem.id));

  const requestDetail = workItem.requestId
    ? await getAdminRequestDetail(workItem.requestId)
    : null;
  const waitingState = requestDetail
    ? computeRequestWaitingState({
      latestUserMessageAt: requestDetail.latestUserMessageAt,
      latestStaffMessageAt: requestDetail.latestStaffMessageAt,
      workflowStatus: requestDetail.openclawStatus,
    })
    : { waitingOn: null, isOverdue: false } satisfies { waitingOn: 'user' | 'admin' | 'openclaw' | null; isOverdue: boolean };

  const internalNotes = workItem.requestId
    ? await listRequestInternalNotes(workItem.requestId)
    : [];

  const conversationRows = workItem.requestId
    ? await listOpenClawRequestMessages(workItem.requestId)
    : [];

  const attachmentIds = conversationRows.flatMap((row) => row.attachments.map((attachment) => attachment.id));
  const attachmentRows = attachmentIds.length > 0
    ? await db.select({
      id: requestMessageAttachments.id,
      mimeType: requestMessageAttachments.mimeType,
      contentBase64: requestMessageAttachments.contentBase64,
    })
      .from(requestMessageAttachments)
      .where(inArray(requestMessageAttachments.id, attachmentIds))
    : [];

  const attachmentPreviewById = new Map<number, string | null>();
  for (const attachment of attachmentRows) {
    attachmentPreviewById.set(
      attachment.id,
      buildAttachmentPreviewText(attachment.contentBase64, attachment.mimeType),
    );
  }

  const conversation = conversationRows.map((row) => ({
    id: row.id,
    authorType: row.authorType,
    messageType: row.messageType,
    body: row.body,
    createdAt: row.createdAt ?? nowIso(),
    metadata: row.metadata ?? null,
    attachments: row.attachments.map((attachment) => ({
      id: attachment.id,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      fileSize: attachment.fileSize,
      downloadUrl: buildAttachmentDownloadUrl(workItem.id, attachment.id, leaseToken),
      previewText: attachmentPreviewById.get(attachment.id) ?? null,
    })),
  }));

  const summary = buildDdsWorkItemSummary({
    requestText: workItem.requestText ?? '',
    resultSummary: workItem.resultSummary,
    latestSummary: workItem.latestSummary,
    openclawSummary: requestDetail?.openclawSummary ?? null,
    lastConversationBody: conversation.at(-1)?.body ?? null,
  });

  return {
    jobId: job.id,
    leaseToken,
    leaseExpiresAt,
    workItem: {
      id: workItem.id,
      type: workItem.type as DdsWorkItemType,
      workflowStatus: 'analyzing',
      requestId: workItem.requestId,
      pharmacyId: workItem.pharmacyId,
      pharmacyName: requestDetail?.pharmacyName ?? null,
      threadId: requestDetail?.openclawThreadId ?? null,
      requestText: workItem.requestText ?? '',
      summary,
      source: workItem.source ?? 'user_request',
      context: (workItem.contextJson as Record<string, unknown> | null) ?? null,
      category: requestDetail?.category ?? null,
      priority: requestDetail?.priority ?? null,
      closeReason: requestDetail?.closeReason ?? null,
      assignedAdminId: requestDetail?.assignedAdminId ?? null,
      assignedAdminName: requestDetail?.assignedAdminName ?? null,
      waitingOn: waitingState.waitingOn,
      isOverdue: waitingState.isOverdue,
      openclawStatus: requestDetail?.openclawStatus ?? null,
      lastQuestion: workItem.lastQuestion ?? null,
      lastError: workItem.lastError ?? null,
      internalNotes: internalNotes.slice(-DDS_INTERNAL_NOTE_LIMIT).map((note) => ({
        id: note.id,
        body: note.body.slice(0, 4000),
        createdAt: note.createdAt,
        authorAdminId: note.authorAdminId,
        authorAdminName: note.authorAdminName,
      })),
      conversation,
    },
  };
}
