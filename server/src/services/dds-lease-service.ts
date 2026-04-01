import { and, eq, sql } from 'drizzle-orm';
import { db } from '../config/database';
import {
  ddsAgentJobs,
  ddsWorkItems,
} from '../db/schema';
import { ApiError } from '../utils/api-error';
import { getRequestAttachmentDownload } from './request-collaboration-service';
import { authenticateControlToken } from './dds-bootstrap-service';
import {
  DDS_ENVIRONMENT,
  hashToken,
  nowIso,
} from './dds-agent-utils';

export async function ensureAgentLease(
  token: string,
  workItemId: number,
  leaseToken: string,
): Promise<typeof ddsWorkItems.$inferSelect> {
  const connection = await authenticateControlToken(token);
  const currentTime = nowIso();
  const [lease] = await db.select({ id: ddsAgentJobs.id })
    .from(ddsAgentJobs)
    .where(and(
      eq(ddsAgentJobs.environment, DDS_ENVIRONMENT),
      eq(ddsAgentJobs.agentId, connection.agentId),
      eq(ddsAgentJobs.workItemId, workItemId),
      eq(ddsAgentJobs.status, 'leased'),
      eq(ddsAgentJobs.leaseTokenHash, hashToken(leaseToken)),
      sql`${ddsAgentJobs.leaseExpiresAt} > ${currentTime}`,
    ))
    .limit(1);

  if (!lease) {
    throw new ApiError(409, 'lease token が不正または期限切れです');
  }

  const [workItem] = await db.select()
    .from(ddsWorkItems)
    .where(eq(ddsWorkItems.id, workItemId))
    .limit(1);

  if (!workItem) {
    throw new ApiError(404, '対象 work item が見つかりません');
  }

  return workItem;
}

export async function getDdsWorkItemAttachmentDownload(
  token: string,
  workItemId: number,
  leaseToken: string,
  attachmentId: number,
): Promise<{
  fileName: string;
  mimeType: string;
  fileSize: number;
  content: Buffer;
} | null> {
  const workItem = await ensureAgentLease(token, workItemId, leaseToken);
  if (!workItem.requestId) {
    throw new ApiError(400, '添付を持たない work item です');
  }

  const attachment = await getRequestAttachmentDownload(attachmentId);
  if (!attachment) {
    return null;
  }
  if (attachment.requestId !== workItem.requestId) {
    throw new ApiError(403, 'この添付ファイルにはアクセスできません');
  }

  return {
    fileName: attachment.fileName,
    mimeType: attachment.mimeType,
    fileSize: attachment.fileSize,
    content: attachment.content,
  };
}
