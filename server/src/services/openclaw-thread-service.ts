import { asc, eq } from 'drizzle-orm';
import { db } from '../config/database';
import {
  openclawRequestMessages,
  openclawWorkItems,
  type openclawMessageAuthorTypeEnum,
  type openclawMessageTypeEnum,
  type openclawWorkItemTypeEnum,
  type openclawWorkflowStatusEnum,
} from '../db/schema';
import type { OpenClawStatus } from './openclaw-service';

export type OpenClawWorkItemType = typeof openclawWorkItemTypeEnum.enumValues[number];
export type OpenClawWorkflowStatus = typeof openclawWorkflowStatusEnum.enumValues[number];
export type OpenClawMessageAuthorType = typeof openclawMessageAuthorTypeEnum.enumValues[number];
export type OpenClawMessageType = typeof openclawMessageTypeEnum.enumValues[number];

export interface OpenClawConversationMessage {
  id: number;
  authorType: OpenClawMessageAuthorType;
  messageType: OpenClawMessageType;
  body: string;
  createdAt: string | null;
  metadata: Record<string, unknown> | null;
}

export interface OpenClawConversationContext {
  latestMessageId: number | null;
  messages: OpenClawConversationMessage[];
  workItem: {
    workItemType: OpenClawWorkItemType;
    workflowStatus: OpenClawWorkflowStatus;
    latestSummary: string | null;
    branchName: string | null;
    prUrl: string | null;
    prNumber: number | null;
    lastQuestion: string | null;
    lastError: string | null;
  } | null;
}

function toMetadataJson(value?: Record<string, unknown> | null): string | null {
  if (!value || Object.keys(value).length === 0) {
    return null;
  }
  return JSON.stringify(value);
}

export function parseMetadataJson(rawValue: string | null | undefined): Record<string, unknown> | null {
  if (!rawValue) return null;
  try {
    const parsed = JSON.parse(rawValue) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function resolveOpenClawWorkItemType(source: string | null | undefined): OpenClawWorkItemType {
  if (source === 'admin_log_investigation' || source === 'import_failure_alert_scheduler') {
    return 'incident_investigation';
  }
  if (source === 'pharmacy_verification_request') {
    return 'verification_review';
  }
  return 'user_report';
}

export function isOpenClawWorkflowStatus(value: unknown): value is OpenClawWorkflowStatus {
  return value === 'queued'
    || value === 'analyzing'
    || value === 'awaiting_user'
    || value === 'implementing'
    || value === 'pr_opened'
    || value === 'completed'
    || value === 'failed';
}

export function mapOpenClawStatusToWorkflowStatus(status: OpenClawStatus): OpenClawWorkflowStatus {
  if (status === 'pending_handoff') return 'queued';
  if (status === 'implementing') return 'implementing';
  if (status === 'completed') return 'completed';
  return 'analyzing';
}

export async function ensureOpenClawWorkItem(input: {
  requestId: number;
  pharmacyId: number;
  source?: string | null;
  workflowStatus?: OpenClawWorkflowStatus;
  latestSummary?: string | null;
  metadata?: Record<string, unknown> | null;
}): Promise<void> {
  const [existing] = await db.select({
    id: openclawWorkItems.id,
    workItemType: openclawWorkItems.workItemType,
    metadataJson: openclawWorkItems.metadataJson,
  })
    .from(openclawWorkItems)
    .where(eq(openclawWorkItems.requestId, input.requestId))
    .limit(1);

  const updatedAt = new Date().toISOString();

  const updatePayload: {
    pharmacyId: number;
    workflowStatus: OpenClawWorkflowStatus;
    latestSummary: string | null;
    updatedAt: string;
    workItemType?: OpenClawWorkItemType;
    metadataJson?: string | null;
  } = {
    pharmacyId: input.pharmacyId,
    workflowStatus: input.workflowStatus ?? 'queued',
    latestSummary: input.latestSummary ?? null,
    updatedAt,
  };

  if (input.source !== undefined) {
    updatePayload.workItemType = resolveOpenClawWorkItemType(input.source);
  }

  if (input.metadata !== undefined) {
    updatePayload.metadataJson = toMetadataJson(input.metadata);
  }

  if (existing) {
    await db.update(openclawWorkItems)
      .set(updatePayload)
      .where(eq(openclawWorkItems.requestId, input.requestId));
    return;
  }

  const insertPayload = {
    requestId: input.requestId,
    pharmacyId: input.pharmacyId,
    workItemType: resolveOpenClawWorkItemType(input.source),
    workflowStatus: input.workflowStatus ?? 'queued',
    latestSummary: input.latestSummary ?? null,
    metadataJson: input.metadata !== undefined ? toMetadataJson(input.metadata) : null,
    updatedAt,
  };

  await db.insert(openclawWorkItems).values(insertPayload);
}

export async function updateOpenClawWorkItem(input: {
  requestId: number;
  workflowStatus?: OpenClawWorkflowStatus;
  latestSummary?: string | null;
  lastQuestion?: string | null;
  branchName?: string | null;
  prUrl?: string | null;
  prNumber?: number | null;
  lastError?: string | null;
  metadata?: Record<string, unknown> | null;
}): Promise<void> {
  const updatePayload: Record<string, unknown> = {
    updatedAt: new Date().toISOString(),
  };

  if (input.workflowStatus !== undefined) updatePayload.workflowStatus = input.workflowStatus;
  if (input.latestSummary !== undefined) updatePayload.latestSummary = input.latestSummary;
  if (input.lastQuestion !== undefined) updatePayload.lastQuestion = input.lastQuestion;
  if (input.branchName !== undefined) updatePayload.branchName = input.branchName;
  if (input.prUrl !== undefined) updatePayload.prUrl = input.prUrl;
  if (input.prNumber !== undefined) updatePayload.prNumber = input.prNumber;
  if (input.lastError !== undefined) updatePayload.lastError = input.lastError;
  if (input.metadata !== undefined) updatePayload.metadataJson = toMetadataJson(input.metadata);

  await db.update(openclawWorkItems)
    .set(updatePayload)
    .where(eq(openclawWorkItems.requestId, input.requestId));
}

export async function recordOpenClawRequestMessage(input: {
  requestId: number;
  authorType: OpenClawMessageAuthorType;
  messageType?: OpenClawMessageType;
  body: string;
  metadata?: Record<string, unknown> | null;
}): Promise<{ id: number }> {
  const [inserted] = await db.insert(openclawRequestMessages)
    .values({
      requestId: input.requestId,
      authorType: input.authorType,
      messageType: input.messageType ?? 'message',
      body: input.body,
      metadataJson: toMetadataJson(input.metadata),
    })
    .returning({ id: openclawRequestMessages.id });

  return inserted;
}

export async function listOpenClawRequestMessages(requestId: number): Promise<OpenClawConversationMessage[]> {
  const rows = await db.select({
    id: openclawRequestMessages.id,
    authorType: openclawRequestMessages.authorType,
    messageType: openclawRequestMessages.messageType,
    body: openclawRequestMessages.body,
    createdAt: openclawRequestMessages.createdAt,
    metadataJson: openclawRequestMessages.metadataJson,
  })
    .from(openclawRequestMessages)
    .where(eq(openclawRequestMessages.requestId, requestId))
    .orderBy(asc(openclawRequestMessages.createdAt), asc(openclawRequestMessages.id));

  return rows.map((row) => ({
    id: row.id,
    authorType: row.authorType,
    messageType: row.messageType,
    body: row.body,
    createdAt: row.createdAt,
    metadata: parseMetadataJson(row.metadataJson),
  }));
}

export async function buildOpenClawConversationContext(requestId: number): Promise<OpenClawConversationContext> {
  const [workItem] = await db.select({
    workItemType: openclawWorkItems.workItemType,
    workflowStatus: openclawWorkItems.workflowStatus,
    latestSummary: openclawWorkItems.latestSummary,
    branchName: openclawWorkItems.branchName,
    prUrl: openclawWorkItems.prUrl,
    prNumber: openclawWorkItems.prNumber,
    lastQuestion: openclawWorkItems.lastQuestion,
    lastError: openclawWorkItems.lastError,
  })
    .from(openclawWorkItems)
    .where(eq(openclawWorkItems.requestId, requestId))
    .limit(1);

  const messages = await listOpenClawRequestMessages(requestId);

  return {
    latestMessageId: messages.at(-1)?.id ?? null,
    messages,
    workItem: workItem ?? null,
  };
}
