import { db } from '../config/database';
import { userRequests } from '../db/schema';
import { eq } from 'drizzle-orm';
import { logger } from './logger';
import { handoffToOpenClaw } from './openclaw-service';
import type { ErrorFixContext } from './error-fix-context';
import { parsePositiveInt } from '../utils/request-utils';
import { parseBoundedInt } from '../utils/number-utils';

export interface ErrorAutoFixResult {
  triggered: boolean;
  accepted: boolean;
  requestId: number | null;
  reason: string;
}

const AUTO_REQUEST_TEXT_PREFIX = '[自動修正] Sentry エラー検知:';

const dedupCache = new Map<string, number>();

function readConfig() {
  return {
    enabled: process.env.OPENCLAW_ERROR_AUTOFIX_ENABLED === 'true',
    pharmacyId: parsePositiveInt(
      process.env.OPENCLAW_ERROR_AUTOFIX_PHARMACY_ID,
    ),
    dedupMinutes: parseBoundedInt(
      process.env.OPENCLAW_ERROR_AUTOFIX_DEDUP_MINUTES,
      60,
      1,
      1440,
    ),
  };
}

function buildFingerprint(ctx: ErrorFixContext): string {
  return `${ctx.errorMessage}::${ctx.sourceFile ?? 'unknown'}`;
}

function isDeduplicated(fingerprint: string, dedupMinutes: number): boolean {
  const lastSeen = dedupCache.get(fingerprint);
  if (!lastSeen) return false;
  if (Date.now() - lastSeen >= dedupMinutes * 60_000) {
    dedupCache.delete(fingerprint);
    return false;
  }
  return true;
}

function buildRequestText(ctx: ErrorFixContext): string {
  const parts = [
    AUTO_REQUEST_TEXT_PREFIX,
    ctx.errorMessage,
    ctx.sourceFile ? `ファイル: ${ctx.sourceFile}:${ctx.sourceLine}` : '',
    ctx.endpoint ? `エンドポイント: ${ctx.endpoint}` : '',
    ctx.sentryEventId ? `Sentry Event: ${ctx.sentryEventId}` : '',
    'エラーを分析し、修正ブランチを作成してPRを出してください。',
  ].filter(Boolean);
  return parts.join(' ').slice(0, 2000);
}

function buildContext(ctx: ErrorFixContext): Record<string, unknown> {
  return {
    source: 'sentry_error_autofix',
    errorContext: {
      errorMessage: ctx.errorMessage,
      stackTrace: ctx.stackTrace,
      sourceFile: ctx.sourceFile,
      sourceLine: ctx.sourceLine,
      endpoint: ctx.endpoint,
      sentryEventId: ctx.sentryEventId,
      timestamp: ctx.timestamp,
    },
    instructions: [
      '1. エラーの根本原因を特定してください',
      '2. preview ブランチから修正ブランチを作成してください',
      '3. テストを追加/修正してください',
      '4. PR を作成してください（タイトルに Sentry eventId を含める）',
      '5. main ブランチへの直接変更は禁止です',
    ],
  };
}

function skipped(reason: string): ErrorAutoFixResult {
  return {
    triggered: false,
    accepted: false,
    requestId: null,
    reason,
  };
}

export async function handoffErrorToOpenClaw(
  ctx: ErrorFixContext,
  status: number,
): Promise<ErrorAutoFixResult> {
  const config = readConfig();

  if (!config.enabled) return skipped('disabled');

  if (!config.pharmacyId) {
    logger.warn('OpenClaw error autofix skipped: invalid pharmacy ID');
    return skipped('invalid_pharmacy_id');
  }

  if (status < 500) return skipped('not_5xx');

  const fingerprint = buildFingerprint(ctx);

  if (isDeduplicated(fingerprint, config.dedupMinutes)) {
    logger.info('OpenClaw error autofix deduplicated', { fingerprint });
    return skipped('deduplicated');
  }

  try {
    dedupCache.set(fingerprint, Date.now());

    const requestText = buildRequestText(ctx);
    const [created] = await db
      .insert(userRequests)
      .values({
        pharmacyId: config.pharmacyId,
        requestText,
        openclawStatus: 'pending_handoff',
      })
      .returning({ id: userRequests.id });

    const handoff = await handoffToOpenClaw({
      requestId: created.id,
      pharmacyId: config.pharmacyId,
      requestText,
      context: buildContext(ctx),
    });

    if (handoff.accepted) {
      await db
        .update(userRequests)
        .set({
          openclawStatus: handoff.status,
          openclawThreadId: handoff.threadId,
          openclawSummary: handoff.summary,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(userRequests.id, created.id));
    }

    logger.info('OpenClaw error autofix handoff completed', {
      requestId: created.id,
      accepted: handoff.accepted,
      fingerprint,
    });

    return {
      triggered: true,
      accepted: handoff.accepted,
      requestId: created.id,
      reason: handoff.note,
    };
  } catch (err) {
    logger.error('OpenClaw error autofix failed', {
      error: err instanceof Error ? err.message : String(err),
      fingerprint,
    });
    return skipped('error');
  }
}

/** Test-only: reset dedup cache */
export function _resetDedupCacheForTests(): void {
  dedupCache.clear();
}
