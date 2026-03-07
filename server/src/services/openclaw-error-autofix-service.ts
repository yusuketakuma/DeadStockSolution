import { logger } from './logger';
import { executeOpenClawHandoff, skippedHandoff, type HandoffExecutorResult } from './openclaw-handoff-executor';
import type { ErrorFixContext } from './error-fix-context';
import { parsePositiveInt } from '../utils/request-utils';
import { parseBoundedInt } from '../utils/number-utils';
import { getErrorMessage } from '../utils/error-utils';

export type ErrorAutoFixResult = HandoffExecutorResult;

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
    ctx.endpoint ? `エンドポイント: ${ctx.endpoint}` : '',
    ctx.sentryEventId ? `Sentry Event: ${ctx.sentryEventId}` : '',
    '5xx 障害を分析し、必要なら修正ブランチとPRを作成してください。',
  ].filter(Boolean);
  const text = parts.join(' ');
  if (text.length > 2000) {
    logger.warn('OpenClaw error autofix request text truncated', {
      originalLength: text.length,
    });
  }
  return text.slice(0, 2000);
}

function buildContext(ctx: ErrorFixContext): Record<string, unknown> {
  return {
    source: 'sentry_error_autofix',
    errorContext: {
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

export async function handoffErrorToOpenClaw(
  ctx: ErrorFixContext,
  status: number,
): Promise<ErrorAutoFixResult> {
  const config = readConfig();

  if (!config.enabled) return skippedHandoff('disabled');

  if (!config.pharmacyId) {
    logger.warn('OpenClaw error autofix skipped: invalid pharmacy ID');
    return skippedHandoff('invalid_pharmacy_id');
  }

  if (status < 500) return skippedHandoff('not_5xx');

  const fingerprint = buildFingerprint(ctx);

  if (isDeduplicated(fingerprint, config.dedupMinutes)) {
    logger.info('OpenClaw error autofix deduplicated', { fingerprint });
    return skippedHandoff('deduplicated');
  }

  try {
    dedupCache.set(fingerprint, Date.now());
    const requestText = buildRequestText(ctx);
    const result = await executeOpenClawHandoff({
      pharmacyId: config.pharmacyId,
      requestText,
      context: buildContext(ctx),
      logLabel: 'OpenClaw error autofix handoff completed',
    });
    if (!result.accepted) {
      dedupCache.delete(fingerprint);
    }
    return result;
  } catch (err) {
    dedupCache.delete(fingerprint);
    logger.error('OpenClaw error autofix failed', {
      error: getErrorMessage(err),
      fingerprint,
    });
    return skippedHandoff('error');
  }
}

/** Test-only: reset dedup cache */
export function _resetDedupCacheForTests(): void {
  dedupCache.clear();
}
