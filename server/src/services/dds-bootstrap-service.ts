import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../config/database';
import {
  ddsAgentConnections,
  ddsAgentJobs,
  ddsBootstrapTokens,
  ddsWorkItems,
} from '../db/schema';
import { ApiError } from '../utils/api-error';
import { getOpenClawConfig } from './openclaw/status';
import {
  DDS_ENVIRONMENT,
  buildAbsoluteApiUrl,
  createOpaqueToken,
  hashToken,
  nowIso,
  resolveBootstrapTtlSeconds,
  resolveLeaseSeconds,
} from './dds-agent-utils';

export async function issueDdsBootstrapToken(adminId: number | null): Promise<{
  token: string;
  expiresAt: string;
  environment: string;
  registerUrl: string;
  callbackUrl: string;
  reportUrl: string;
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
    registerUrl: buildAbsoluteApiUrl('/api/openclaw/connect/register'),
    callbackUrl: buildAbsoluteApiUrl('/api/openclaw/callback'),
    reportUrl: buildAbsoluteApiUrl('/api/openclaw/report'),
    commandsUrl: buildAbsoluteApiUrl('/api/openclaw/commands'),
    healthUrl: buildAbsoluteApiUrl('/api/health/openclaw'),
  };
}

async function consumeBootstrapToken(token: string): Promise<void> {
  const tokenHash = hashToken(token);
  const now = nowIso();

  const [row] = await db.select()
    .from(ddsBootstrapTokens)
    .where(and(
      eq(ddsBootstrapTokens.tokenHash, tokenHash),
      eq(ddsBootstrapTokens.environment, DDS_ENVIRONMENT),
      sql`${ddsBootstrapTokens.consumedAt} is null`,
      sql`${ddsBootstrapTokens.expiresAt} > now()`,
    ))
    .limit(1);

  if (!row) {
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
  reportUrl: string;
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
      lastHeartbeatAt: currentTime,
      lastSeenAt: currentTime,
      createdAt: currentTime,
      updatedAt: currentTime,
    })
    .onConflictDoUpdate({
      target: [ddsAgentConnections.agentId, ddsAgentConnections.environment],
      set: {
        agentId: input.agentId.trim(),
        agentName: input.agentName.trim(),
        deviceLabel: input.deviceLabel?.trim() || null,
        controlTokenHash: hashToken(controlToken),
        status: 'connected',
        metadataJson: {
          openclawVersion: input.openclawVersion ?? null,
        },
        lastHeartbeatAt: currentTime,
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
    reportUrl: buildAbsoluteApiUrl('/api/openclaw/report'),
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

  const staleThresholdMs = Math.max(resolveLeaseSeconds() * 2 * 1000, 60_000);
  const lastSeenAtMs = connection?.lastSeenAt ? Date.parse(connection.lastSeenAt) : Number.NaN;
  const connected = Boolean(
    connection
      && connection.status === 'connected'
      && Number.isFinite(lastSeenAtMs)
      && Date.now() - lastSeenAtMs <= staleThresholdMs,
  );

  return {
    environment: DDS_ENVIRONMENT,
    connected,
    agentId: connection?.agentId ?? null,
    agentName: connection?.agentName ?? null,
    lastSeenAt: connection?.lastSeenAt ?? null,
    queuedJobs: Number(queuedRow?.count ?? 0),
    awaitingUser: Number(awaitingRow?.count ?? 0),
    latestPrUrl: latestPr?.prUrl ?? null,
  };
}

export async function authenticateControlToken(token: string): Promise<typeof ddsAgentConnections.$inferSelect> {
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
  const currentTime = nowIso();
  await db.update(ddsAgentConnections)
    .set({
      status: 'connected',
      metadataJson: payload ?? connection.metadataJson ?? null,
      lastHeartbeatAt: currentTime,
      lastSeenAt: currentTime,
      updatedAt: currentTime,
    })
    .where(eq(ddsAgentConnections.id, connection.id));
}
