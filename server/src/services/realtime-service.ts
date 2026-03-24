import type { Response } from 'express';
import { createClient, type RedisClientType } from 'redis';
import { logger } from './logger';

export const realtimeTopics = ['timeline', 'requests', 'admin_requests', 'messages', 'admin_messages'] as const;
export type RealtimeTopic = typeof realtimeTopics[number];

interface RealtimeSubscriber {
  id: number;
  pharmacyId: number;
  isAdmin: boolean;
  topics: Set<RealtimeTopic>;
  res: Response;
  heartbeat: ReturnType<typeof setInterval>;
}

type RealtimeEventPayload = Record<string, unknown> & {
  reason: string;
  occurredAt: string;
  requestId?: number;
};

interface RealtimeEnvelope {
  topic: RealtimeTopic;
  payload: RealtimeEventPayload;
  pharmacyId?: number;
}

const subscribers = new Map<number, RealtimeSubscriber>();
let nextSubscriberId = 1;
const HEARTBEAT_INTERVAL_MS = 25_000;
const REALTIME_REDIS_CHANNEL = process.env.REALTIME_REDIS_CHANNEL ?? 'dead-stock-solution:realtime';
const REALTIME_REDIS_URL = process.env.REALTIME_REDIS_URL?.trim() || process.env.REDIS_URL?.trim() || '';

let redisPublisher: RedisClientType | null = null;
let redisSubscriber: RedisClientType | null = null;
let redisInitPromise: Promise<void> | null = null;
let redisReconnectBlockedUntil = 0;

function flush(res: Response): void {
  const maybeFlush = (res as Response & { flush?: () => void }).flush;
  if (typeof maybeFlush === 'function') {
    maybeFlush.call(res);
  }
}

function isExpectedSseDisconnect(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const code = 'code' in error && typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code
    : '';
  if (['EPIPE', 'ECONNRESET', 'ERR_STREAM_WRITE_AFTER_END'].includes(code)) {
    return true;
  }

  const message = error.message.toLowerCase();
  return message.includes('write after end')
    || message.includes('socket hang up')
    || message.includes('connection reset')
    || message.includes('broken pipe');
}

function safeWriteEvent(
  res: Response,
  eventName: string,
  payload: Record<string, unknown>,
): boolean {
  try {
    res.write(`event: ${eventName}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
    flush(res);
    return true;
  } catch (err) {
    if (!isExpectedSseDisconnect(err)) {
      logger.warn('Realtime SSE write failed', {
        error: err instanceof Error ? err.message : String(err),
        eventName,
      });
    }
    return false;
  }
}

function matchesTopic(
  subscriber: RealtimeSubscriber,
  topic: RealtimeTopic,
  pharmacyId?: number,
): boolean {
  if (!subscriber.topics.has(topic)) return false;
  if (topic === 'admin_requests' || topic === 'admin_messages') {
    return subscriber.isAdmin;
  }
  if (pharmacyId === undefined) {
    return true;
  }
  return subscriber.pharmacyId === pharmacyId;
}

function cleanupSubscriber(id: number): void {
  const subscriber = subscribers.get(id);
  if (!subscriber) return;
  clearInterval(subscriber.heartbeat);
  subscribers.delete(id);
}

function dispatchTopicEvent(
  topic: RealtimeTopic,
  payload: RealtimeEventPayload,
  options?: {
    pharmacyId?: number;
  },
): void {
  for (const subscriber of subscribers.values()) {
    if (!matchesTopic(subscriber, topic, options?.pharmacyId)) {
      continue;
    }
    const written = safeWriteEvent(subscriber.res, `${topic}.refresh`, payload);
    if (!written) {
      cleanupSubscriber(subscriber.id);
    }
  }
}

async function publishEnvelope(envelope: RealtimeEnvelope): Promise<void> {
  if (!REALTIME_REDIS_URL) {
    dispatchTopicEvent(envelope.topic, envelope.payload, { pharmacyId: envelope.pharmacyId });
    return;
  }

  await initRealtimeInfrastructure();
  if (!redisPublisher) {
    dispatchTopicEvent(envelope.topic, envelope.payload, { pharmacyId: envelope.pharmacyId });
    return;
  }

  try {
    await redisPublisher.publish(REALTIME_REDIS_CHANNEL, JSON.stringify(envelope));
  } catch (err) {
    logger.warn('Realtime Redis publish failed; falling back to local dispatch', {
      error: err instanceof Error ? err.message : String(err),
      topic: envelope.topic,
    });
    dispatchTopicEvent(envelope.topic, envelope.payload, { pharmacyId: envelope.pharmacyId });
  }
}

function handleRealtimeEnvelope(rawMessage: string): void {
  try {
    const parsed = JSON.parse(rawMessage) as Partial<RealtimeEnvelope>;
    if (!parsed || typeof parsed !== 'object') return;
    if (!isRealtimeTopic(parsed.topic)) return;
    if (!parsed.payload || typeof parsed.payload !== 'object') return;

    dispatchTopicEvent(parsed.topic, parsed.payload as RealtimeEventPayload, {
      pharmacyId: typeof parsed.pharmacyId === 'number' ? parsed.pharmacyId : undefined,
    });
  } catch (err) {
    logger.warn('Realtime Redis message parse failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export function isRealtimeTopic(value: unknown): value is RealtimeTopic {
  return typeof value === 'string' && realtimeTopics.includes(value as RealtimeTopic);
}

export async function initRealtimeInfrastructure(): Promise<void> {
  if (!REALTIME_REDIS_URL) {
    return;
  }

  if (redisReconnectBlockedUntil > Date.now()) {
    return;
  }

  if (redisPublisher?.isReady && redisSubscriber?.isReady) {
    return;
  }

  if (redisInitPromise) {
    await redisInitPromise;
    return;
  }

  redisInitPromise = (async () => {
    let publisher: RedisClientType | null = null;
    let subscriber: RedisClientType | null = null;
    try {
      publisher = createClient({ url: REALTIME_REDIS_URL });
      subscriber = publisher.duplicate();

      publisher.on('error', (err) => {
        logger.warn('Realtime Redis publisher error', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
      subscriber.on('error', (err) => {
        logger.warn('Realtime Redis subscriber error', {
          error: err instanceof Error ? err.message : String(err),
        });
      });

      await publisher.connect();
      await subscriber.connect();
      await subscriber.subscribe(REALTIME_REDIS_CHANNEL, handleRealtimeEnvelope);

      redisPublisher = publisher;
      redisSubscriber = subscriber;
      logger.info('Realtime Redis pub/sub connected', {
        channel: REALTIME_REDIS_CHANNEL,
      });
    } catch (err) {
      redisReconnectBlockedUntil = Date.now() + 30_000;
      logger.error('Realtime Redis initialization failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      try {
        await publisher?.quit();
      } catch { /* noop */ }
      try {
        await subscriber?.quit();
      } catch { /* noop */ }
      redisPublisher = null;
      redisSubscriber = null;
    } finally {
      redisInitPromise = null;
    }
  })();

  await redisInitPromise;
}

export async function shutdownRealtimeInfrastructure(): Promise<void> {
  const publisher = redisPublisher;
  const subscriber = redisSubscriber;
  redisPublisher = null;
  redisSubscriber = null;
  redisInitPromise = null;
  redisReconnectBlockedUntil = 0;

  try {
    await subscriber?.quit();
  } catch {
    await subscriber?.disconnect();
  }

  try {
    await publisher?.quit();
  } catch {
    await publisher?.disconnect();
  }
}

export function subscribeRealtimeClient(input: {
  res: Response;
  pharmacyId: number;
  isAdmin: boolean;
  topics: RealtimeTopic[];
}): () => void {
  const id = nextSubscriberId++;
  const { res } = input;

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  res.write('retry: 5000\n\n');

  const heartbeat = setInterval(() => {
    const written = safeWriteEvent(res, 'ping', { occurredAt: new Date().toISOString() });
    if (!written) {
      cleanupSubscriber(id);
    }
  }, HEARTBEAT_INTERVAL_MS);

  subscribers.set(id, {
    id,
    pharmacyId: input.pharmacyId,
    isAdmin: input.isAdmin,
    topics: new Set(input.topics),
    res,
    heartbeat,
  });

  const readyWritten = safeWriteEvent(res, 'system.ready', {
    topics: input.topics,
    occurredAt: new Date().toISOString(),
  });
  if (!readyWritten) {
    cleanupSubscriber(id);
  }

  const cleanup = () => cleanupSubscriber(id);
  res.on('close', cleanup);
  res.on('finish', cleanup);
  res.on('error', cleanup);

  return cleanup;
}

export function publishTimelineRefresh(input: {
  reason: string;
  pharmacyId?: number;
}): void {
  void publishEnvelope({
    topic: 'timeline',
    pharmacyId: input.pharmacyId,
    payload: {
      reason: input.reason,
      occurredAt: new Date().toISOString(),
    },
  });
}

export function publishRequestsRefresh(input: {
  pharmacyId: number;
  reason: string;
  requestId?: number;
}): void {
  void publishEnvelope({
    topic: 'requests',
    pharmacyId: input.pharmacyId,
    payload: {
      reason: input.reason,
      occurredAt: new Date().toISOString(),
      requestId: input.requestId,
    },
  });
}

export function publishAdminRequestsRefresh(input: {
  reason: string;
  requestId?: number;
}): void {
  void publishEnvelope({
    topic: 'admin_requests',
    payload: {
      reason: input.reason,
      occurredAt: new Date().toISOString(),
      requestId: input.requestId,
    },
  });
}

export function publishMessagesRefresh(input: {
  pharmacyId: number;
  reason: string;
  otherPharmacyId?: number;
  messageId?: number;
}): void {
  void publishEnvelope({
    topic: 'messages',
    pharmacyId: input.pharmacyId,
    payload: {
      reason: input.reason,
      occurredAt: new Date().toISOString(),
      otherPharmacyId: input.otherPharmacyId,
      messageId: input.messageId,
    },
  });
}

export function publishAdminMessagesRefresh(input: {
  reason: string;
  pharmacyAId?: number;
  pharmacyBId?: number;
  messageId?: number;
}): void {
  void publishEnvelope({
    topic: 'admin_messages',
    payload: {
      reason: input.reason,
      occurredAt: new Date().toISOString(),
      pharmacyAId: input.pharmacyAId,
      pharmacyBId: input.pharmacyBId,
      messageId: input.messageId,
    },
  });
}

export function getRealtimeSubscriberCount(): number {
  return subscribers.size;
}
