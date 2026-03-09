import { and, desc, eq, gte, inArray, like } from 'drizzle-orm';
import { db } from '../config/database';
import { userRequests } from '../db/schema';
import { logger } from './logger';
import { buildOpenClawLogContext, type OpenClawLogContext } from './openclaw-log-context-service';
import { executeOpenClawHandoff, skippedHandoff, type HandoffExecutorResult } from './openclaw-handoff-executor';
import { getErrorMessage } from '../utils/error-utils';
import { parseBoundedInt } from '../utils/number-utils';
import { parsePositiveInt } from '../utils/request-utils';

interface ImportFailureActionCount {
  action: string;
  count: number;
}

interface ImportFailureReasonCount {
  reason: string;
  count: number;
}

export interface ImportFailureAlertForOpenClaw {
  detectedAt: string;
  windowMinutes: number;
  threshold: number;
  totalFailures: number;
  monitoredActions: string[];
  latestFailureAt: string | null;
  failureByAction: ImportFailureActionCount[];
  failureByReason: ImportFailureReasonCount[];
}

interface OpenClawAutoHandoffConfig {
  enabled: boolean;
  pharmacyId: number | null;
  dedupMinutes: number;
}

export type OpenClawAutoHandoffResult = HandoffExecutorResult;

const AUTO_REQUEST_TEXT_PREFIX = '[自動通知] 取込失敗が閾値を超えました。';

function readConfig(): OpenClawAutoHandoffConfig {
  return {
    enabled: process.env.IMPORT_FAILURE_ALERT_OPENCLAW_AUTO_HANDOFF === 'true',
    pharmacyId: parsePositiveInt(process.env.IMPORT_FAILURE_ALERT_OPENCLAW_PHARMACY_ID),
    dedupMinutes: parseBoundedInt(process.env.IMPORT_FAILURE_ALERT_OPENCLAW_DEDUP_MINUTES, 120, 1, 24 * 30),
  };
}

function buildRequestText(payload: ImportFailureAlertForOpenClaw): string {
  const reasonText = payload.failureByReason
    .slice(0, 3)
    .map((reason) => `${reason.reason}(${reason.count})`)
    .join(', ');

  const message = [
    AUTO_REQUEST_TEXT_PREFIX,
    `直近${payload.windowMinutes}分で ${payload.totalFailures} 件（閾値: ${payload.threshold}）。`,
    reasonText ? `主要理由: ${reasonText}。` : '主要理由: 情報なし。',
    '運用ログを確認し、原因分析・修正方針・実装ステップを提示してください。',
  ].join(' ');

  if (message.length > 2000) {
    logger.warn('OpenClaw auto handoff request text truncated', {
      originalLength: message.length,
    });
  }

  return message.slice(0, 2000);
}

function buildContext(
  payload: ImportFailureAlertForOpenClaw,
  operationLogs: OpenClawLogContext | null,
): Record<string, unknown> {
  return {
    source: 'import_failure_alert_scheduler',
    alertSnapshot: {
      generatedAt: payload.detectedAt,
      importFailures: {
        windowMinutes: payload.windowMinutes,
        threshold: payload.threshold,
        total: payload.totalFailures,
        monitoredActions: payload.monitoredActions,
        latestFailureAt: payload.latestFailureAt,
        byAction: payload.failureByAction,
        byReason: payload.failureByReason,
      },
    },
    ...(operationLogs ? { operationLogs } : {}),
  };
}

async function hasRecentAutoHandoff(pharmacyId: number, dedupMinutes: number): Promise<boolean> {
  const dedupStart = new Date(Date.now() - dedupMinutes * 60_000).toISOString();
  const [row] = await db.select({ id: userRequests.id })
    .from(userRequests)
    .where(and(
      eq(userRequests.pharmacyId, pharmacyId),
      like(userRequests.requestText, `${AUTO_REQUEST_TEXT_PREFIX}%`),
      inArray(userRequests.openclawStatus, ['pending_handoff', 'in_dialogue', 'implementing']),
      gte(userRequests.createdAt, dedupStart),
    ))
    .orderBy(desc(userRequests.createdAt))
    .limit(1);
  return Boolean(row);
}

async function collectOperationLogs(pharmacyId: number): Promise<OpenClawLogContext | null> {
  try {
    return await buildOpenClawLogContext(pharmacyId);
  } catch (contextErr) {
    logger.warn('OpenClaw auto handoff: context collection failed', {
      pharmacyId,
      error: getErrorMessage(contextErr),
    });
    return null;
  }
}

export async function handoffImportFailureAlertToOpenClaw(
  payload: ImportFailureAlertForOpenClaw,
): Promise<OpenClawAutoHandoffResult> {
  const config = readConfig();
  if (!config.enabled) {
    return skippedHandoff('disabled');
  }

  if (!config.pharmacyId) {
    logger.warn('OpenClaw auto handoff skipped: invalid IMPORT_FAILURE_ALERT_OPENCLAW_PHARMACY_ID');
    return skippedHandoff('invalid_pharmacy_id');
  }

  try {
    if (await hasRecentAutoHandoff(config.pharmacyId, config.dedupMinutes)) {
      logger.info('OpenClaw auto handoff skipped: recent request already exists', {
        pharmacyId: config.pharmacyId,
        dedupMinutes: config.dedupMinutes,
      });
      return skippedHandoff('duplicate_inflight');
    }

    const requestText = buildRequestText(payload);
    const operationLogs = await collectOperationLogs(config.pharmacyId);

    return await executeOpenClawHandoff({
      pharmacyId: config.pharmacyId,
      requestText,
      context: buildContext(payload, operationLogs),
      logLabel: 'OpenClaw auto handoff completed from import failure alert',
    });
  } catch (err) {
    logger.error('OpenClaw auto handoff failed from import failure alert', {
      error: getErrorMessage(err),
    });
    return skippedHandoff('error');
  }
}
