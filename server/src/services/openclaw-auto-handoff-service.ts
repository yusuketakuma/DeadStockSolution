import { and, desc, eq, gte, inArray, like } from 'drizzle-orm';
import { db } from '../config/database';
import { userRequests } from '../db/schema';
import { logger } from './logger';
import { handoffToOpenClaw, type OpenClawStatus } from './openclaw-service';
import { buildOpenClawLogContext, type OpenClawLogContext } from './openclaw-log-context-service';
import { parseBoundedInt, parsePositiveInt } from '../utils/number-utils';

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

export interface OpenClawAutoHandoffResult {
  triggered: boolean;
  accepted: boolean;
  requestId: number | null;
  status: OpenClawStatus | 'pending_handoff';
  reason: string;
}

const AUTO_REQUEST_TEXT_PREFIX = '[自動通知] 取込失敗が閾値を超えました。';
const OPENCLAW_PENDING_STATUS = 'pending_handoff' as const;

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

function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function skippedAutoHandoff(reason: OpenClawAutoHandoffResult['reason']): OpenClawAutoHandoffResult {
  return {
    triggered: false,
    accepted: false,
    requestId: null,
    status: OPENCLAW_PENDING_STATUS,
    reason,
  };
}

async function collectOperationLogs(pharmacyId: number): Promise<OpenClawLogContext | null> {
  try {
    return await buildOpenClawLogContext(pharmacyId);
  } catch (contextErr) {
    logger.warn('OpenClaw auto handoff: context collection failed', {
      pharmacyId,
      error: formatError(contextErr),
    });
    return null;
  }
}

export async function handoffImportFailureAlertToOpenClaw(
  payload: ImportFailureAlertForOpenClaw,
): Promise<OpenClawAutoHandoffResult> {
  const config = readConfig();
  if (!config.enabled) {
    return skippedAutoHandoff('disabled');
  }

  if (!config.pharmacyId) {
    logger.warn('OpenClaw auto handoff skipped: invalid IMPORT_FAILURE_ALERT_OPENCLAW_PHARMACY_ID');
    return skippedAutoHandoff('invalid_pharmacy_id');
  }

  try {
    if (await hasRecentAutoHandoff(config.pharmacyId, config.dedupMinutes)) {
      logger.info('OpenClaw auto handoff skipped: recent request already exists', {
        pharmacyId: config.pharmacyId,
        dedupMinutes: config.dedupMinutes,
      });
      return skippedAutoHandoff('duplicate_inflight');
    }

    const requestText = buildRequestText(payload);
    const operationLogs = await collectOperationLogs(config.pharmacyId);

    const [created] = await db.insert(userRequests)
      .values({
        pharmacyId: config.pharmacyId,
        requestText,
        openclawStatus: 'pending_handoff',
      })
      .returning({
        id: userRequests.id,
      });

    const handoff = await handoffToOpenClaw({
      requestId: created.id,
      pharmacyId: config.pharmacyId,
      requestText,
      context: buildContext(payload, operationLogs),
    });

    if (handoff.accepted) {
      await db.update(userRequests)
        .set({
          openclawStatus: handoff.status,
          openclawThreadId: handoff.threadId,
          openclawSummary: handoff.summary,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(userRequests.id, created.id));
    }

    logger.info('OpenClaw auto handoff completed from import failure alert', {
      requestId: created.id,
      pharmacyId: config.pharmacyId,
      accepted: handoff.accepted,
      status: handoff.status,
    });

    return {
      triggered: true,
      accepted: handoff.accepted,
      requestId: created.id,
      status: handoff.status,
      reason: handoff.note,
    };
  } catch (err) {
    logger.error('OpenClaw auto handoff failed from import failure alert', {
      error: formatError(err),
    });
    return skippedAutoHandoff('error');
  }
}
