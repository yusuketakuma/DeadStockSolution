import { asc, eq } from 'drizzle-orm';
import { db } from '../../config/database';
import { openclawRequestEvents, openclawRequestMessages } from '../../db/schema';
import { parseMetadataJson } from './thread-service';

type EventInsertExecutor = {
  insert: typeof db.insert;
};

interface PostgresErrorLike {
  code?: string;
}

function isUndefinedTableError(err: unknown): err is PostgresErrorLike {
  return typeof err === 'object' && err !== null && (err as PostgresErrorLike).code === '42P01';
}

export async function recordOpenClawRequestEvent(
  input: {
    requestId: number;
    pharmacyId: number;
    eventType: string;
    fromStatus?: string | null;
    toStatus?: string | null;
    threadId?: string | null;
    summary?: string | null;
    note?: string | null;
    metadata?: Record<string, unknown> | null;
  },
  executor: EventInsertExecutor = db,
): Promise<void> {
  await (executor.insert(openclawRequestEvents) as {
    values: (value: unknown) => Promise<unknown>;
  }).values({
    requestId: input.requestId,
    pharmacyId: input.pharmacyId,
    eventType: input.eventType,
    fromStatus: input.fromStatus ?? null,
    toStatus: input.toStatus ?? null,
    threadId: input.threadId ?? null,
    summary: input.summary ?? null,
    note: input.note ?? null,
    metadataJson: input.metadata ?? null,
  });
}

export async function listRequestEventTimeline(requestId: number): Promise<Array<{
  id: number;
  requestId: number;
  pharmacyId: number | null;
  eventType: string;
  fromStatus: string | null;
  toStatus: string | null;
  threadId: string | null;
  summary: string | null;
  note: string | null;
  metadataJson: string | null;
  createdAt: string | null;
}>> {
  try {
    const rows = await db.select({
      id: openclawRequestEvents.id,
      requestId: openclawRequestEvents.requestId,
      pharmacyId: openclawRequestEvents.pharmacyId,
      eventType: openclawRequestEvents.eventType,
      fromStatus: openclawRequestEvents.fromStatus,
      toStatus: openclawRequestEvents.toStatus,
      threadId: openclawRequestEvents.threadId,
      summary: openclawRequestEvents.summary,
      note: openclawRequestEvents.note,
      metadataJson: openclawRequestEvents.metadataJson,
      createdAt: openclawRequestEvents.createdAt,
    })
      .from(openclawRequestEvents)
      .where(eq(openclawRequestEvents.requestId, requestId))
      .orderBy(asc(openclawRequestEvents.createdAt), asc(openclawRequestEvents.id));

    return rows.map((row) => ({
      ...row,
      metadataJson:
        row.metadataJson == null
          ? null
          : typeof row.metadataJson === 'string'
            ? row.metadataJson
            : JSON.stringify(row.metadataJson),
    }));
  } catch (err) {
    if (!isUndefinedTableError(err)) {
      throw err;
    }
  }

  const messages = await db.select({
    id: openclawRequestMessages.id,
    requestId: openclawRequestMessages.requestId,
    authorType: openclawRequestMessages.authorType,
    messageType: openclawRequestMessages.messageType,
    body: openclawRequestMessages.body,
    metadataJson: openclawRequestMessages.metadataJson,
    createdAt: openclawRequestMessages.createdAt,
  })
    .from(openclawRequestMessages)
    .where(eq(openclawRequestMessages.requestId, requestId))
    .orderBy(asc(openclawRequestMessages.createdAt), asc(openclawRequestMessages.id));

  return messages.map((message) => {
    const metadata = parseMetadataJson(message.metadataJson);
    const workflowStatus = typeof metadata?.workflowStatus === 'string' ? metadata.workflowStatus : null;
    const threadId = typeof metadata?.threadId === 'string' ? metadata.threadId : null;
    const summary = typeof metadata?.summary === 'string' ? metadata.summary : null;

    return {
      id: message.id,
      requestId: message.requestId,
      pharmacyId: null,
      eventType: `${message.authorType}_${message.messageType}`,
      fromStatus: null,
      toStatus: workflowStatus,
      threadId,
      summary,
      note: message.body,
      metadataJson: message.metadataJson,
      createdAt: message.createdAt,
    };
  });
}
