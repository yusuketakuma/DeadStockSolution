import { and, asc, desc, eq, ilike, inArray } from 'drizzle-orm';
import { distance as levenshtein } from 'fastest-levenshtein';
import { db } from '../config/database';
import {
  openclawRequestMessages,
  pharmacies,
  requestMessageAttachments,
  userRequestInternalNotes,
  userRequests,
} from '../db/schema';
import {
  decodeAttachmentContent,
  encodeAttachmentContent,
  sanitizeAttachmentFileName,
} from '../utils/attachment-utils';
import { escapeLikeWildcards } from '../utils/request-utils';

export const requestCategoryValues = [
  'bug_report',
  'improvement',
  'question',
  'master_update',
  'integration_issue',
] as const;

export type RequestCategory = (typeof requestCategoryValues)[number];

export const requestPriorityValues = ['urgent', 'normal', 'low'] as const;
export type RequestPriority = (typeof requestPriorityValues)[number];

export const requestCloseReasonValues = [
  'completed',
  'duplicate',
  'rejected',
  'cannot_reproduce',
  'on_hold',
] as const;
export type RequestCloseReason = (typeof requestCloseReasonValues)[number];

export type RequestViewerType = 'requester' | 'admin';

export interface RequestAttachmentSummary {
  id: number;
  fileName: string;
  mimeType: string;
  fileSize: number;
}

export interface RequestInternalNote {
  id: number;
  body: string;
  createdAt: string;
  authorAdminId: number | null;
  authorAdminName: string | null;
}

export interface DuplicateRequestSuggestion {
  id: number;
  requestText: string;
  category: RequestCategory;
  priority: RequestPriority;
  closeReason: RequestCloseReason | null;
  createdAt: string | null;
  score: number;
}

const DUPLICATE_SUGGESTION_LIMIT = 5;

export function isRequestCategory(value: unknown): value is RequestCategory {
  return typeof value === 'string' && requestCategoryValues.includes(value as RequestCategory);
}

export function isRequestPriority(value: unknown): value is RequestPriority {
  return typeof value === 'string' && requestPriorityValues.includes(value as RequestPriority);
}

export function isRequestCloseReason(value: unknown): value is RequestCloseReason {
  return typeof value === 'string' && requestCloseReasonValues.includes(value as RequestCloseReason);
}

function normalizeLooseText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function scoreDuplicateCandidate(query: string, candidate: string): number {
  const normalizedQuery = normalizeLooseText(query);
  const normalizedCandidate = normalizeLooseText(candidate);
  if (!normalizedQuery || !normalizedCandidate) {
    return 0;
  }
  if (normalizedQuery === normalizedCandidate) {
    return 1000;
  }
  if (normalizedCandidate.startsWith(normalizedQuery)) {
    return 900 - Math.max(0, normalizedCandidate.length - normalizedQuery.length);
  }
  if (normalizedCandidate.includes(normalizedQuery)) {
    return 800 - Math.max(0, normalizedCandidate.length - normalizedQuery.length);
  }

  const queryTokens = normalizedQuery.split(' ').filter(Boolean);
  const candidateTokens = normalizedCandidate.split(' ').filter(Boolean);
  const overlap = queryTokens.filter((token) => candidateTokens.includes(token)).length;
  const tokenScore = overlap * 80;
  const editDistance = levenshtein(normalizedQuery, normalizedCandidate);
  const distanceScore = Math.max(0, 200 - editDistance * 8);
  return tokenScore + distanceScore;
}

export async function listRequestDuplicateSuggestions(
  pharmacyId: number,
  query: string,
): Promise<DuplicateRequestSuggestion[]> {
  const normalized = query.trim();
  if (normalized.length < 4) {
    return [];
  }

  const rows = await db.select({
    id: userRequests.id,
    requestText: userRequests.requestText,
    category: userRequests.category,
    priority: userRequests.priority,
    closeReason: userRequests.closeReason,
    createdAt: userRequests.createdAt,
  })
    .from(userRequests)
    .where(and(
      eq(userRequests.pharmacyId, pharmacyId),
      ilike(userRequests.requestText, `%${escapeLikeWildcards(normalized)}%`),
    ))
    .orderBy(desc(userRequests.createdAt))
    .limit(20);

  return rows
    .map((row) => ({
      ...row,
      category: row.category as RequestCategory,
      priority: row.priority as RequestPriority,
      closeReason: row.closeReason as RequestCloseReason | null,
      score: scoreDuplicateCandidate(normalized, row.requestText),
    }))
    .filter((row) => row.score >= 140)
    .sort((a, b) => b.score - a.score || (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
    .slice(0, DUPLICATE_SUGGESTION_LIMIT);
}

export async function createRequestMessageAttachments(
  messageId: number,
  files: Express.Multer.File[],
): Promise<RequestAttachmentSummary[]> {
  if (files.length === 0) {
    return [];
  }

  const inserted = await db.insert(requestMessageAttachments)
    .values(files.map((file) => ({
      messageId,
      fileName: sanitizeAttachmentFileName(file.originalname),
      mimeType: file.mimetype,
      fileSize: file.size,
      contentBase64: encodeAttachmentContent(file.buffer),
    })))
    .returning({
      id: requestMessageAttachments.id,
      fileName: requestMessageAttachments.fileName,
      mimeType: requestMessageAttachments.mimeType,
      fileSize: requestMessageAttachments.fileSize,
    });

  return inserted;
}

export async function listRequestMessageAttachmentsByMessageIds(
  messageIds: number[],
): Promise<Map<number, RequestAttachmentSummary[]>> {
  if (messageIds.length === 0) {
    return new Map();
  }

  const rows = await db.select({
    id: requestMessageAttachments.id,
    messageId: requestMessageAttachments.messageId,
    fileName: requestMessageAttachments.fileName,
    mimeType: requestMessageAttachments.mimeType,
    fileSize: requestMessageAttachments.fileSize,
  })
    .from(requestMessageAttachments)
    .where(inArray(requestMessageAttachments.messageId, messageIds))
    .orderBy(asc(requestMessageAttachments.createdAt), asc(requestMessageAttachments.id));

  const byMessageId = new Map<number, RequestAttachmentSummary[]>();
  for (const row of rows) {
    const list = byMessageId.get(row.messageId) ?? [];
    list.push({
      id: row.id,
      fileName: row.fileName,
      mimeType: row.mimeType,
      fileSize: row.fileSize,
    });
    byMessageId.set(row.messageId, list);
  }
  return byMessageId;
}

export async function getRequestAttachmentDownload(
  attachmentId: number,
): Promise<{
  requestId: number;
  fileName: string;
  mimeType: string;
  fileSize: number;
  content: Buffer;
} | null> {
  const [row] = await db.select({
    requestId: openclawRequestMessages.requestId,
    fileName: requestMessageAttachments.fileName,
    mimeType: requestMessageAttachments.mimeType,
    fileSize: requestMessageAttachments.fileSize,
    contentBase64: requestMessageAttachments.contentBase64,
  })
    .from(requestMessageAttachments)
    .innerJoin(openclawRequestMessages, eq(openclawRequestMessages.id, requestMessageAttachments.messageId))
    .where(eq(requestMessageAttachments.id, attachmentId))
    .limit(1);

  if (!row) {
    return null;
  }

  return {
    requestId: row.requestId,
    fileName: row.fileName,
    mimeType: row.mimeType,
    fileSize: row.fileSize,
    content: decodeAttachmentContent(row.contentBase64),
  };
}

export async function addRequestInternalNote(
  requestId: number,
  adminId: number,
  body: string,
): Promise<RequestInternalNote> {
  const [inserted] = await db.insert(userRequestInternalNotes)
    .values({
      requestId,
      authorAdminId: adminId,
      body,
    })
    .returning({
      id: userRequestInternalNotes.id,
      body: userRequestInternalNotes.body,
      createdAt: userRequestInternalNotes.createdAt,
      authorAdminId: userRequestInternalNotes.authorAdminId,
    });

  const [adminRow] = await db.select({
    id: pharmacies.id,
    name: pharmacies.name,
  })
    .from(pharmacies)
    .where(eq(pharmacies.id, adminId))
    .limit(1);

  return {
    ...inserted,
    authorAdminName: adminRow?.name ?? null,
  };
}

export async function listRequestInternalNotes(
  requestId: number,
): Promise<RequestInternalNote[]> {
  const rows = await db.select({
    id: userRequestInternalNotes.id,
    body: userRequestInternalNotes.body,
    createdAt: userRequestInternalNotes.createdAt,
    authorAdminId: userRequestInternalNotes.authorAdminId,
    authorAdminName: pharmacies.name,
  })
    .from(userRequestInternalNotes)
    .leftJoin(pharmacies, eq(pharmacies.id, userRequestInternalNotes.authorAdminId))
    .where(eq(userRequestInternalNotes.requestId, requestId))
    .orderBy(asc(userRequestInternalNotes.createdAt), asc(userRequestInternalNotes.id));

  return rows;
}

export async function listRequestAssigneeOptions(): Promise<Array<{ id: number; name: string }>> {
  return db.select({
    id: pharmacies.id,
    name: pharmacies.name,
  })
    .from(pharmacies)
    .where(and(
      eq(pharmacies.isAdmin, true),
      eq(pharmacies.isActive, true),
    ))
    .orderBy(asc(pharmacies.name));
}

export async function touchRequestViewed(
  requestId: number,
  viewerType: RequestViewerType,
): Promise<void> {
  const now = new Date().toISOString();
  await db.update(userRequests)
    .set(viewerType === 'requester'
      ? { requesterLastViewedAt: now }
      : { adminLastViewedAt: now })
    .where(eq(userRequests.id, requestId));
}

export async function updateRequestActivity(
  requestId: number,
  authorType: 'user' | 'admin' | 'openclaw_agent' | 'system',
): Promise<void> {
  const now = new Date().toISOString();
  const patch: Partial<typeof userRequests.$inferInsert> & { updatedAt: string } = {
    updatedAt: now,
  };
  if (authorType === 'user') {
    patch.latestUserMessageAt = now;
  } else if (authorType === 'admin' || authorType === 'openclaw_agent' || authorType === 'system') {
    patch.latestStaffMessageAt = now;
  }

  await db.update(userRequests)
    .set(patch)
    .where(eq(userRequests.id, requestId));
}

export async function updateRequestAdminMetadata(
  requestId: number,
  input: {
    category?: RequestCategory;
    priority?: RequestPriority;
    assignedAdminId?: number | null;
    closeReason?: RequestCloseReason | null;
    markCompleted?: boolean;
  },
): Promise<void> {
  const now = new Date().toISOString();
  const patch: Partial<typeof userRequests.$inferInsert> & { updatedAt: string } = {
    updatedAt: now,
  };

  if (input.category !== undefined) {
    patch.category = input.category;
  }
  if (input.priority !== undefined) {
    patch.priority = input.priority;
  }
  if (input.assignedAdminId !== undefined) {
    patch.assignedAdminId = input.assignedAdminId;
  }
  if (input.closeReason !== undefined) {
    patch.closeReason = input.closeReason;
    patch.closedAt = input.closeReason ? now : null;
  }
  if (input.markCompleted) {
    patch.openclawStatus = 'completed';
  }

  await db.update(userRequests)
    .set(patch)
    .where(eq(userRequests.id, requestId));
}

export async function getAdminRequestDetail(requestId: number): Promise<{
  id: number;
  pharmacyId: number;
  pharmacyName: string | null;
  requestText: string;
  category: RequestCategory;
  priority: RequestPriority;
  closeReason: RequestCloseReason | null;
  assignedAdminId: number | null;
  assignedAdminName: string | null;
  requesterLastViewedAt: string | null;
  adminLastViewedAt: string | null;
  latestUserMessageAt: string | null;
  latestStaffMessageAt: string | null;
  openclawStatus: string;
  openclawThreadId: string | null;
  openclawSummary: string | null;
  closedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
} | null> {
  const [row] = await db.select({
    id: userRequests.id,
    pharmacyId: userRequests.pharmacyId,
    pharmacyName: pharmacies.name,
    requestText: userRequests.requestText,
    category: userRequests.category,
    priority: userRequests.priority,
    closeReason: userRequests.closeReason,
    assignedAdminId: userRequests.assignedAdminId,
    requesterLastViewedAt: userRequests.requesterLastViewedAt,
    adminLastViewedAt: userRequests.adminLastViewedAt,
    latestUserMessageAt: userRequests.latestUserMessageAt,
    latestStaffMessageAt: userRequests.latestStaffMessageAt,
    openclawStatus: userRequests.openclawStatus,
    openclawThreadId: userRequests.openclawThreadId,
    openclawSummary: userRequests.openclawSummary,
    closedAt: userRequests.closedAt,
    createdAt: userRequests.createdAt,
    updatedAt: userRequests.updatedAt,
  })
    .from(userRequests)
    .leftJoin(pharmacies, eq(pharmacies.id, userRequests.pharmacyId))
    .where(eq(userRequests.id, requestId))
    .limit(1);

  if (!row) {
    return null;
  }

  const [assignedAdminRow] = row.assignedAdminId
    ? await db.select({
      id: pharmacies.id,
      name: pharmacies.name,
    })
      .from(pharmacies)
      .where(eq(pharmacies.id, row.assignedAdminId))
      .limit(1)
    : [];

  return {
    ...row,
    category: row.category as RequestCategory,
    priority: row.priority as RequestPriority,
    closeReason: row.closeReason as RequestCloseReason | null,
    assignedAdminName: assignedAdminRow?.name ?? null,
  };
}

export function computeRequestWaitingState(input: {
  latestUserMessageAt: string | null;
  latestStaffMessageAt: string | null;
  workflowStatus?: string | null;
}): { waitingOn: 'user' | 'admin' | 'openclaw' | null; isOverdue: boolean } {
  const now = Date.now();
  const latestUserAt = input.latestUserMessageAt ? new Date(input.latestUserMessageAt).getTime() : 0;
  const latestStaffAt = input.latestStaffMessageAt ? new Date(input.latestStaffMessageAt).getTime() : 0;
  const latestTimestamp = Math.max(latestUserAt, latestStaffAt);
  const hoursSinceLatest = latestTimestamp > 0 ? (now - latestTimestamp) / (1000 * 60 * 60) : 0;

  if (input.workflowStatus === 'awaiting_user' || latestStaffAt > latestUserAt) {
    return { waitingOn: 'user', isOverdue: hoursSinceLatest >= 24 };
  }
  if (latestUserAt > latestStaffAt) {
    return { waitingOn: 'admin', isOverdue: hoursSinceLatest >= 24 };
  }
  if (input.workflowStatus && input.workflowStatus !== 'completed') {
    return { waitingOn: 'openclaw', isOverdue: hoursSinceLatest >= 24 };
  }
  return { waitingOn: null, isOverdue: false };
}

export function hasRequesterUnreadMessages(input: {
  latestStaffMessageAt: string | null;
  requesterLastViewedAt: string | null;
}): boolean {
  if (!input.latestStaffMessageAt) {
    return false;
  }
  const latestStaffAt = new Date(input.latestStaffMessageAt).getTime();
  const requesterViewedAt = input.requesterLastViewedAt
    ? new Date(input.requesterLastViewedAt).getTime()
    : 0;
  return latestStaffAt > requesterViewedAt;
}

export function hasAdminUnreadMessages(input: {
  latestUserMessageAt: string | null;
  adminLastViewedAt: string | null;
}): boolean {
  if (!input.latestUserMessageAt) {
    return false;
  }
  const latestUserAt = new Date(input.latestUserMessageAt).getTime();
  const adminViewedAt = input.adminLastViewedAt
    ? new Date(input.adminLastViewedAt).getTime()
    : 0;
  return latestUserAt > adminViewedAt;
}
