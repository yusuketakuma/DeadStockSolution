import crypto from 'crypto';
import { and, asc, desc, eq, lt, or, sql } from 'drizzle-orm';
import { db } from '../config/database';
import {
  ddsAgentConnections,
  ddsAgentJobs,
  ddsBootstrapTokens,
  ddsWorkItems,
  userRequestMessages,
  userRequests,
} from '../db/schema';
import { ApiError } from '../utils/api-error';
import { getOpenClawConfig } from './openclaw-status';
import { recordOpenClawRequestEvent } from './openclaw-request-event-service';

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

const DDS_ENVIRONMENT = 'production';
const DEFAULT_BOOTSTRAP_TTL_SECONDS = 900;
const DEFAULT_LEASE_SECONDS = 180;

function nowIso(): string {
  return new Date().toISOString();
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function createOpaqueToken(): string {
  return crypto.randomBytes(24).toString('hex');
}

function resolveBootstrapTtlSeconds(): number {
  const raw = Number(process.env.OPENCLAW_REMOTE_AGENT_BOOTSTRAP_TTL_SECONDS ?? DEFAULT_BOOTSTRAP_TTL_SECONDS);
  if (!Number.isFinite(raw)) return DEFAULT_BOOTSTRAP_TTL_SECONDS;
  return Math.max(60, Math.min(3600, Math.floor(raw)));
}

function resolveLeaseSeconds(): number {
  const raw = Number(process.env.OPENCLAW_REMOTE_AGENT_LEASE_SECONDS ?? DEFAULT_LEASE_SECONDS);
  if (!Number.isFinite(raw)) return DEFAULT_LEASE_SECONDS;
  return Math.max(30, Math.min(900, Math.floor(raw)));
}

function buildAbsoluteApiUrl(path: string): string {
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

function inferWorkItemType(input: {
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

function inferSource(input: {
  context?: Record<string, unknown>;
}): string {
  return typeof input.context?.source === 'string' && input.context.source.trim()
    ? input.context.source.trim().slice(0, 64)
    : 'user_request';
}

export async function issueDdsBootstrapToken(adminId: number | null): Promise<{
  token: string;
  expiresAt: string;
  environment: string;
  callbackUrl: string;
  commandsUrl: string;
  healthUrl: string;
}> {
  const token = createOpaqueToken();
  const expiresAt = new Date(Date.now() + resolveBootstrapTtlSeconds() * 1000).toISOString();

  await db.insert(ddsBootstrapTokens).values({
    environment: DDS_ENVIRONMENT,
    tokenHash: hashToken(token),
    requestedByAdminId: adminId,
    expiresAt,
  });

  return {
    token,
    expiresAt,
    environment: DDS_ENVIRONMENT,
    callbackUrl: buildAbsoluteApiUrl('/api/openclaw/callback'),
    commandsUrl: buildAbsoluteApiUrl('/api/openclaw/commands'),
    healthUrl: buildAbsoluteApiUrl('/api/health/openclaw'),
  };
}

async function consumeBootstrapToken(token: string): Promise<void> {
  const tokenHash = hashToken(token);
  const now = nowIso();

  const [row] = await db.select()
    .from(ddsBootstrapTokens)
    .where(eq(ddsBootstrapTokens.tokenHash, tokenHash))
    .limit(1);

  if (!row || row.environment !== DDS_ENVIRONMENT || row.consumedAt || row.expiresAt <= now) {
    throw new ApiError(401, 'bootstrap token が不正または期限切れです');
  }

  await db.update(ddsBootstrapTokens)
    .set({ consumedAt: now })
    .where(eq(ddsBootstrapTokens.id, row.id));
}

export async function registerDdsAgent(input: {
  bootstrapToken: string;
  agentId: string;
  agentName: string;
  deviceLabel?: string | null;
  openclawVersion?: string | null;
}): Promise<{
  controlToken: string;
  environment: string;
  claimUrl: string;
  heartbeatUrl: string;
  callbackUrl: string;
  commandsUrl: string;
  workItemQuestionUrl: string;
  workItemPrUrl: string;
  webhookSecret: string;
  pollIntervalSeconds: number;
  implementationBranch: string;
}> {
  await consumeBootstrapToken(input.bootstrapToken);

  const controlToken = createOpaqueToken();
  const currentTime = nowIso();
  const config = getOpenClawConfig();

  await db.insert(ddsAgentConnections)
    .values({
      environment: DDS_ENVIRONMENT,
      agentId: input.agentId.trim(),
      agentName: input.agentName.trim(),
      deviceLabel: input.deviceLabel?.trim() || null,
      controlTokenHash: hashToken(controlToken),
      status: 'connected',
      metadataJson: {
        openclawVersion: input.openclawVersion ?? null,
      },
      lastSeenAt: currentTime,
      createdAt: currentTime,
      updatedAt: currentTime,
    })
    .onConflictDoUpdate({
      target: ddsAgentConnections.environment,
      set: {
        agentId: input.agentId.trim(),
        agentName: input.agentName.trim(),
        deviceLabel: input.deviceLabel?.trim() || null,
        controlTokenHash: hashToken(controlToken),
        status: 'connected',
        metadataJson: {
          openclawVersion: input.openclawVersion ?? null,
        },
        lastSeenAt: currentTime,
        updatedAt: currentTime,
      },
    });

  return {
    controlToken,
    environment: DDS_ENVIRONMENT,
    claimUrl: buildAbsoluteApiUrl('/api/openclaw/connect/jobs/claim'),
    heartbeatUrl: buildAbsoluteApiUrl('/api/openclaw/connect/heartbeat'),
    callbackUrl: buildAbsoluteApiUrl('/api/openclaw/callback'),
    commandsUrl: buildAbsoluteApiUrl('/api/openclaw/commands'),
    workItemQuestionUrl: buildAbsoluteApiUrl('/api/openclaw/connect/work-items/:id/question'),
    workItemPrUrl: buildAbsoluteApiUrl('/api/openclaw/connect/work-items/:id/pr'),
    webhookSecret: config.webhookSecret,
    pollIntervalSeconds: Math.max(resolveLeaseSeconds() / 2, 30),
    implementationBranch: config.implementationBranch,
  };
}

export async function rotateDdsControlToken(): Promise<void> {
  await db.update(ddsAgentConnections)
    .set({
      controlTokenHash: hashToken(createOpaqueToken()),
      updatedAt: nowIso(),
      status: 'rotated',
    })
    .where(eq(ddsAgentConnections.environment, DDS_ENVIRONMENT));
}

export async function getDdsConnectionStatus(): Promise<{
  environment: string;
  connected: boolean;
  agentId: string | null;
  agentName: string | null;
  lastSeenAt: string | null;
  queuedJobs: number;
  awaitingUser: number;
  latestPrUrl: string | null;
}> {
  const [connection] = await db.select()
    .from(ddsAgentConnections)
    .where(eq(ddsAgentConnections.environment, DDS_ENVIRONMENT))
    .limit(1);

  const [queuedRow] = await db.select({
    count: sql<number>`count(*)::int`,
  })
    .from(ddsAgentJobs)
    .where(and(
      eq(ddsAgentJobs.environment, DDS_ENVIRONMENT),
      eq(ddsAgentJobs.status, 'pending'),
    ));

  const [awaitingRow] = await db.select({
    count: sql<number>`count(*)::int`,
  })
    .from(ddsWorkItems)
    .where(eq(ddsWorkItems.workflowStatus, 'awaiting_user'));

  const [latestPr] = await db.select({
    prUrl: ddsWorkItems.prUrl,
  })
    .from(ddsWorkItems)
    .where(sql`${ddsWorkItems.prUrl} is not null`)
    .orderBy(desc(ddsWorkItems.updatedAt), desc(ddsWorkItems.id))
    .limit(1);

  return {
    environment: DDS_ENVIRONMENT,
    connected: Boolean(connection),
    agentId: connection?.agentId ?? null,
    agentName: connection?.agentName ?? null,
    lastSeenAt: connection?.lastSeenAt ?? null,
    queuedJobs: Number(queuedRow?.count ?? 0),
    awaitingUser: Number(awaitingRow?.count ?? 0),
    latestPrUrl: latestPr?.prUrl ?? null,
  };
}

async function authenticateControlToken(token: string): Promise<typeof ddsAgentConnections.$inferSelect> {
  const tokenHash = hashToken(token);
  const [connection] = await db.select()
    .from(ddsAgentConnections)
    .where(and(
      eq(ddsAgentConnections.environment, DDS_ENVIRONMENT),
      eq(ddsAgentConnections.controlTokenHash, tokenHash),
    ))
    .limit(1);

  if (!connection) {
    throw new ApiError(401, 'control token が不正です');
  }

  return connection;
}

export async function heartbeatDdsAgent(token: string, payload?: Record<string, unknown>): Promise<void> {
  const connection = await authenticateControlToken(token);
  await db.update(ddsAgentConnections)
    .set({
      status: 'connected',
      metadataJson: payload ?? connection.metadataJson ?? null,
      lastSeenAt: nowIso(),
      updatedAt: nowIso(),
    })
    .where(eq(ddsAgentConnections.id, connection.id));
}

async function ensureInitialRequestMessage(input: {
  requestId: number;
  pharmacyId: number;
  requestText: string;
  type: DdsWorkItemType;
}): Promise<void> {
  const [existing] = await db.select({ id: userRequestMessages.id })
    .from(userRequestMessages)
    .where(eq(userRequestMessages.requestId, input.requestId))
    .limit(1);

  if (existing) {
    return;
  }

  await db.insert(userRequestMessages).values({
    requestId: input.requestId,
    authorType: input.type === 'product_update' ? 'user' : 'system',
    authorPharmacyId: input.type === 'product_update' ? input.pharmacyId : null,
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

  let workItemId = existing?.id ?? 0;
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
    requestText: string;
    source: string;
    context: Record<string, unknown> | null;
    conversation: Array<{
      id: number;
      authorType: string;
      body: string;
      createdAt: string;
    }>;
  };
}> {
  await authenticateControlToken(token);
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
      status: 'leased',
      leaseTokenHash: hashToken(leaseToken),
      leaseExpiresAt,
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

  const conversation = workItem.requestId
    ? await db.select({
      id: userRequestMessages.id,
      authorType: userRequestMessages.authorType,
      body: userRequestMessages.body,
      createdAt: userRequestMessages.createdAt,
    })
      .from(userRequestMessages)
      .where(eq(userRequestMessages.requestId, workItem.requestId))
      .orderBy(asc(userRequestMessages.createdAt), asc(userRequestMessages.id))
    : [];

  return {
    jobId: job.id,
    leaseToken,
    leaseExpiresAt,
    workItem: {
      id: workItem.id,
      type: workItem.type as DdsWorkItemType,
      workflowStatus: workItem.workflowStatus as DdsWorkflowStatus,
      requestId: workItem.requestId,
      pharmacyId: workItem.pharmacyId,
      requestText: workItem.requestText ?? '',
      source: workItem.source ?? 'user_request',
      context: (workItem.contextJson as Record<string, unknown> | null) ?? null,
      conversation,
    },
  };
}

async function ensureAgentOwnsWorkItem(token: string, workItemId: number): Promise<typeof ddsWorkItems.$inferSelect> {
  await authenticateControlToken(token);
  const [workItem] = await db.select()
    .from(ddsWorkItems)
    .where(eq(ddsWorkItems.id, workItemId))
    .limit(1);

  if (!workItem) {
    throw new ApiError(404, '対象 work item が見つかりません');
  }

  return workItem;
}

export async function postDdsQuestion(token: string, workItemId: number, body: string): Promise<void> {
  const workItem = await ensureAgentOwnsWorkItem(token, workItemId);
  if (!workItem.requestId) {
    throw new ApiError(400, 'ユーザー対話を持たない work item です');
  }

  const currentTime = nowIso();
  await db.transaction(async (tx) => {
    await tx.insert(userRequestMessages).values({
      requestId: workItem.requestId!,
      authorType: 'dds_agent',
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
        or(eq(ddsAgentJobs.status, 'pending'), eq(ddsAgentJobs.status, 'leased')),
      ));
  });
}

export async function reportDdsPullRequest(token: string, input: {
  workItemId: number;
  branchName: string;
  prNumber?: number | null;
  prUrl: string;
  summary: string;
}): Promise<void> {
  const workItem = await ensureAgentOwnsWorkItem(token, input.workItemId);
  const currentTime = nowIso();

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
        or(eq(ddsAgentJobs.status, 'pending'), eq(ddsAgentJobs.status, 'leased')),
      ));

    if (workItem.requestId) {
      await tx.insert(userRequestMessages).values({
        requestId: workItem.requestId,
        authorType: 'system',
        body: `PR を作成しました: ${input.prUrl}\n${input.summary}`,
        metadataJson: {
          prNumber: input.prNumber ?? null,
          branchName: input.branchName,
          prUrl: input.prUrl,
        },
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

export async function listRequestMessagesForUser(requestId: number, pharmacyId: number) {
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
    .from(userRequestMessages)
    .where(eq(userRequestMessages.requestId, requestId))
    .orderBy(asc(userRequestMessages.createdAt), asc(userRequestMessages.id));
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
    await tx.insert(userRequestMessages).values({
      requestId,
      authorType: 'user',
      authorPharmacyId: pharmacyId,
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
