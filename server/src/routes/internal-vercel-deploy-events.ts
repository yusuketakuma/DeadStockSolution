import { Router, Request, Response } from 'express';
import { isAuthorizedCron } from './internal-cron-auth';
import { logger } from '../services/logger';
import { recordVercelDeployEvent } from '../services/system-event-service';
import { type SystemEventLevel } from '../db/schema';

const router = Router();
const DEDUPE_WINDOW_MS = 5 * 60 * 1000;
const recentDeployEventCache = new Map<string, number>();

interface VercelDeploymentPayload {
  id?: unknown;
  url?: unknown;
  state?: unknown;
  target?: unknown;
  error?: {
    message?: unknown;
  };
}

function asString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
}

function resolveLevel(state: string | null): SystemEventLevel {
  if (!state) return 'warning';
  const normalized = state.toLowerCase();
  if (['error', 'failed', 'failure', 'canceled'].includes(normalized)) {
    return 'error';
  }
  if (['building', 'queued', 'initializing'].includes(normalized)) {
    return 'warning';
  }
  return 'info';
}

function readWebhookSecret(): string | null {
  const value = process.env.VERCEL_DEPLOY_WEBHOOK_SECRET?.trim();
  if (!value) return null;
  return value;
}

function resolveEventType(body: Record<string, unknown>, deployment: VercelDeploymentPayload): string {
  const type = asString(body.type, 120) ?? asString(body.event, 120);
  const state = asString(deployment.state, 80);
  if (type && state) return `${type}:${state}`;
  if (type) return type;
  if (state) return `deployment:${state}`;
  return 'deployment:unknown';
}

function resolveMessage(body: Record<string, unknown>, deployment: VercelDeploymentPayload): string {
  const explicitMessage = asString(body.message, 2000);
  if (explicitMessage) return explicitMessage;

  const errorMessage = asString(deployment.error?.message, 2000);
  if (errorMessage) return errorMessage;

  const state = asString(deployment.state, 80) ?? 'unknown';
  const target = asString(deployment.target, 80) ?? 'unknown';
  return `Vercel deployment event received (state=${state}, target=${target})`;
}

function buildDedupeKey(
  eventType: string,
  deploymentId: string | null,
  state: string | null,
): string {
  return `${eventType}:${deploymentId}:${state ?? '-'}`;
}

function isRecentDuplicate(dedupeKey: string, nowMs: number): boolean {
  for (const [key, expiresAt] of recentDeployEventCache.entries()) {
    if (expiresAt <= nowMs) {
      recentDeployEventCache.delete(key);
    }
  }

  const expiresAt = recentDeployEventCache.get(dedupeKey);
  if (expiresAt && expiresAt > nowMs) {
    return true;
  }

  recentDeployEventCache.set(dedupeKey, nowMs + DEDUPE_WINDOW_MS);
  return false;
}

async function handleIngest(req: Request, res: Response): Promise<void> {
  try {
    const secret = readWebhookSecret();
    if (!secret) {
      logger.error('Vercel deploy webhook secret is not configured');
      res.status(503).json({ error: 'vercel deploy webhook is not configured' });
      return;
    }

    const authHeader = typeof req.headers.authorization === 'string' ? req.headers.authorization : undefined;
    if (!isAuthorizedCron(authHeader, secret)) {
      logger.warn('Unauthorized Vercel deploy webhook request', {
        ip: req.ip ?? null,
        userAgent: req.get('user-agent') ?? null,
      });
      res.status(401).json({ error: 'unauthorized' });
      return;
    }

    const body = (typeof req.body === 'object' && req.body !== null
      ? req.body
      : {}) as Record<string, unknown>;
    const deploymentRaw = (typeof body.payload === 'object' && body.payload !== null
      ? body.payload
      : {}) as VercelDeploymentPayload;

    const eventType = resolveEventType(body, deploymentRaw);
    const message = resolveMessage(body, deploymentRaw);
    const deploymentState = asString(deploymentRaw.state, 80);
    const deploymentId = asString(deploymentRaw.id, 120);
    const deploymentTarget = asString(deploymentRaw.target, 80);
    const level = resolveLevel(deploymentState);
    const dedupeKey = deploymentId
      ? buildDedupeKey(eventType, deploymentId, deploymentState)
      : null;
    if (dedupeKey && isRecentDuplicate(dedupeKey, Date.now())) {
      res.status(202).json({
        message: 'vercel deployment event already recorded',
        eventType,
        level,
      });
      return;
    }

    const persisted = await recordVercelDeployEvent({
      eventType,
      level,
      message,
      deploymentId,
      url: asString(deploymentRaw.url, 240),
      payload: {
        state: deploymentState,
        target: deploymentTarget,
      },
    });
    if (!persisted) {
      res.status(500).json({ error: 'vercel deploy event ingest failed' });
      return;
    }

    res.status(202).json({
      message: 'vercel deployment event recorded',
      eventType,
      level,
    });
  } catch (err) {
    logger.error('Vercel deploy event ingest failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: 'vercel deploy event ingest failed' });
  }
}

router.post('/deploy-events', handleIngest);

export default router;
