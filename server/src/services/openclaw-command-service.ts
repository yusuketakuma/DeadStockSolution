import { db } from '../config/database';
import { openclawCommands, pharmacies } from '../db/schema';
import { eq, desc } from 'drizzle-orm';
import { logger } from './logger';
import { z } from 'zod';
import { LOG_SOURCES, LOG_LEVELS } from './log-center-service';
import type { LogSource, LogCenterQuery } from './log-center-service';
import { clearBuffer } from './openclaw-log-push-service';
import { resetObservabilityMetrics } from './observability-service';
import { getErrorMessage } from '../middleware/error-handler';

// ── Zod スキーマ定義 ──────────────────────────────────────────

const pharmacyToggleSchema = z.object({
  pharmacyId: z.number().int().positive(),
  enabled: z.boolean().optional(),
});

const jobCancelSchema = z.object({
  jobId: z.number().int().positive(),
  adminPharmacyId: z.number().int().positive().optional(),
});

const drugMasterSyncSchema = z.object({
  sourceUrl: z.string().trim().url().optional(),
  sourceMode: z.enum(['index', 'single']).optional(),
  includePackages: z.boolean().optional(),
});

const logsQuerySchema = z.object({
  sources: z.array(z.enum(LOG_SOURCES)).optional(),
  level: z.enum(LOG_LEVELS).optional(),
  search: z.string().optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  limit: z.number().int().positive().max(1000).optional(),
});

const notificationSendSchema = z.object({
  message: z.string().min(1).max(100),
});

function resolveCommandAdminPharmacyId(explicitAdminPharmacyId?: number): number {
  if (explicitAdminPharmacyId) {
    return explicitAdminPharmacyId;
  }

  const fromEnv = Number(process.env.OPENCLAW_COMMAND_ADMIN_PHARMACY_ID ?? '1');
  if (Number.isInteger(fromEnv) && fromEnv > 0) {
    return fromEnv;
  }

  return 1;
}

// ── 型定義 ──────────────────────────────────────────

export interface CommandDefinition {
  category: 'read' | 'write' | 'admin';
  descriptionJa: string;
  handler: (params: Record<string, unknown>) => Promise<unknown>;
}

export interface CommandRequest {
  command: string;
  parameters?: Record<string, unknown>;
  threadId?: string;
  reason?: string;
}

export interface CommandResult {
  id: number;
  command: string;
  status: 'completed' | 'failed' | 'rejected';
  result?: unknown;
  errorMessage?: string;
}

// ── 組込みコマンド定義 ──────────────────────────────────────────

export const BUILTIN_COMMANDS: Record<string, CommandDefinition> = {
  'system.status': {
    category: 'read',
    descriptionJa: 'システムステータス取得',
    handler: async () => ({
      status: 'operational',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version ?? 'unknown',
      uptime: process.uptime(),
    }),
  },
  'logs.query': {
    category: 'read',
    descriptionJa: 'ログ検索',
    handler: async (params) => {
      const validated = logsQuerySchema.parse(params);
      const { queryLogs } = await import('./log-center-service');
      return queryLogs({
        sources: validated.sources as LogSource[] | undefined,
        level: validated.level as LogCenterQuery['level'],
        search: validated.search,
        from: validated.from,
        to: validated.to,
        limit: validated.limit ?? 50,
      });
    },
  },
  'stats.summary': {
    category: 'read',
    descriptionJa: '統計サマリー取得',
    handler: async () => {
      const { getLogSummary } = await import('./log-center-service');
      return getLogSummary();
    },
  },
  'cache.clear': {
    category: 'write',
    descriptionJa: 'キャッシュクリア',
    handler: async () => {
      resetObservabilityMetrics();
      clearBuffer();
      return { cleared: true, timestamp: new Date().toISOString() };
    },
  },
  'maintenance.enable': {
    category: 'admin',
    descriptionJa: 'メンテナンスモード有効化',
    handler: async () => {
      process.env.MAINTENANCE_MODE = 'true';
      return { maintenanceMode: true };
    },
  },
  'maintenance.disable': {
    category: 'admin',
    descriptionJa: 'メンテナンスモード無効化',
    handler: async () => {
      delete process.env.MAINTENANCE_MODE;
      return { maintenanceMode: false };
    },
  },
  'scheduler.restart': {
    category: 'write',
    descriptionJa: 'スケジューラー再起動',
    handler: async () => {
      const [
        drugMasterScheduler,
        drugPackageScheduler,
        importFailureScheduler,
        matchingRefreshScheduler,
        monthlyReportScheduler,
        monitoringKpiScheduler,
      ] = await Promise.all([
        import('./drug-master-scheduler'),
        import('./drug-package-scheduler'),
        import('./import-failure-alert-scheduler'),
        import('./matching-refresh-scheduler'),
        import('./monthly-report-scheduler'),
        import('./monitoring-kpi-alert-scheduler'),
      ]);

      drugMasterScheduler.stopDrugMasterScheduler();
      drugPackageScheduler.stopDrugPackageScheduler();
      importFailureScheduler.stopImportFailureAlertScheduler();
      matchingRefreshScheduler.stopMatchingRefreshScheduler();
      monthlyReportScheduler.stopMonthlyReportScheduler();
      monitoringKpiScheduler.stopMonitoringKpiAlertScheduler();

      drugMasterScheduler.startDrugMasterScheduler();
      drugPackageScheduler.startDrugPackageScheduler();
      importFailureScheduler.startImportFailureAlertScheduler();
      matchingRefreshScheduler.startMatchingRefreshScheduler();
      monthlyReportScheduler.startMonthlyReportScheduler();
      monitoringKpiScheduler.startMonitoringKpiAlertScheduler();

      return {
        restarted: true,
        schedulers: [
          'drug_master',
          'drug_package',
          'import_failure_alert',
          'matching_refresh',
          'monthly_report',
          'monitoring_kpi_alert',
        ],
        timestamp: new Date().toISOString(),
      };
    },
  },
  'pharmacy.toggle': {
    category: 'admin',
    descriptionJa: '薬局の有効/無効切替',
    handler: async (params) => {
      const { pharmacyId, enabled } = pharmacyToggleSchema.parse(params);

      const [current] = await db.select({
        id: pharmacies.id,
        isActive: pharmacies.isActive,
      })
        .from(pharmacies)
        .where(eq(pharmacies.id, pharmacyId))
        .limit(1);

      if (!current) {
        throw new Error(`薬局が見つかりません: ${pharmacyId}`);
      }

      const nextIsActive = typeof enabled === 'boolean'
        ? enabled
        : !current.isActive;

      await db.update(pharmacies)
        .set({
          isActive: nextIsActive,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(pharmacies.id, pharmacyId));

      return {
        pharmacyId,
        action: 'toggled',
        previousIsActive: current.isActive,
        isActive: nextIsActive,
        timestamp: new Date().toISOString(),
      };
    },
  },
  'job.cancel': {
    category: 'write',
    descriptionJa: 'ジョブキャンセル',
    handler: async (params) => {
      const { jobId, adminPharmacyId } = jobCancelSchema.parse(params);
      const { cancelUploadConfirmJobByAdmin } = await import('./upload-confirm-job-service');
      const canceledBy = resolveCommandAdminPharmacyId(adminPharmacyId);
      const canceled = await cancelUploadConfirmJobByAdmin(jobId, canceledBy);

      if (!canceled) {
        throw new Error(`ジョブが見つかりません: ${jobId}`);
      }

      if (!canceled.canceledAt && !canceled.cancelRequestedAt) {
        throw new Error('このジョブはキャンセルできません');
      }

      return {
        jobId,
        action: canceled.canceledAt ? 'canceled' : 'cancel_requested',
        status: canceled.status,
        canceledAt: canceled.canceledAt,
        cancelRequestedAt: canceled.cancelRequestedAt,
        cancelable: canceled.cancelable,
        canceledBy,
        timestamp: new Date().toISOString(),
      };
    },
  },
  'drug_master.sync': {
    category: 'write',
    descriptionJa: '薬価マスター同期実行',
    handler: async (params) => {
      const validated = drugMasterSyncSchema.parse(params);
      const { triggerManualAutoSync } = await import('./drug-master-scheduler');
      const syncResult = await triggerManualAutoSync({
        sourceUrl: validated.sourceUrl ?? null,
        sourceMode: validated.sourceMode,
      });

      if (!syncResult.triggered) {
        throw new Error(syncResult.message);
      }

      let packageSyncResult: { triggered: boolean; message: string } | null = null;
      if (validated.includePackages) {
        const { triggerManualPackageAutoSync } = await import('./drug-package-scheduler');
        packageSyncResult = await triggerManualPackageAutoSync({
          sourceUrl: validated.sourceUrl ?? null,
        });
        if (!packageSyncResult.triggered) {
          throw new Error(packageSyncResult.message);
        }
      }

      return {
        syncTriggered: true,
        sourceMode: validated.sourceMode ?? 'index',
        message: syncResult.message,
        packageSync: packageSyncResult,
        timestamp: new Date().toISOString(),
      };
    },
  },
  'notification.send': {
    category: 'write',
    descriptionJa: '通知送信',
    handler: async (params) => {
      const { message } = notificationSendSchema.parse(params);
      return { sent: true, message, timestamp: new Date().toISOString() };
    },
  },
};

// ── ホワイトリスト判定 ──────────────────────────────────────────

export function isCommandAllowed(commandName: string): boolean {
  return commandName in BUILTIN_COMMANDS;
}

// ── コマンド実行 ──────────────────────────────────────────

export async function executeCommand(request: CommandRequest, signature: string): Promise<CommandResult> {
  // Record received command
  const [record] = await db.insert(openclawCommands).values({
    commandName: request.command,
    parameters: request.parameters ? JSON.stringify(request.parameters) : null,
    status: 'received',
    openclawThreadId: request.threadId ?? null,
    signature,
  }).returning();

  // Check whitelist
  if (!isCommandAllowed(request.command)) {
    await db.update(openclawCommands)
      .set({ status: 'rejected', errorMessage: `Command not in whitelist: ${request.command}`, completedAt: new Date().toISOString() })
      .where(eq(openclawCommands.id, record.id));

    logger.warn('OpenClaw command rejected', { command: request.command, reason: 'not_in_whitelist' });
    return { id: record.id, command: request.command, status: 'rejected', errorMessage: 'コマンドが許可リストにありません' };
  }

  // Execute
  try {
    await db.update(openclawCommands)
      .set({ status: 'executing' })
      .where(eq(openclawCommands.id, record.id));

    const handler = BUILTIN_COMMANDS[request.command].handler;
    const result = await handler(request.parameters ?? {});

    await db.update(openclawCommands)
      .set({ status: 'completed', result: JSON.stringify(result), completedAt: new Date().toISOString() })
      .where(eq(openclawCommands.id, record.id));

    logger.info('OpenClaw command executed', { command: request.command });
    return { id: record.id, command: request.command, status: 'completed', result };
  } catch (err) {
    const message = getErrorMessage(err);
    await db.update(openclawCommands)
      .set({ status: 'failed', errorMessage: message, completedAt: new Date().toISOString() })
      .where(eq(openclawCommands.id, record.id));

    logger.error('OpenClaw command failed', { command: request.command, error: message });
    return { id: record.id, command: request.command, status: 'failed', errorMessage: message };
  }
}

// ── 履歴取得 ──────────────────────────────────────────

export async function listCommandHistory(limit = 50, offset = 0) {
  return db.select().from(openclawCommands).orderBy(desc(openclawCommands.receivedAt)).limit(Math.min(limit, 200)).offset(offset);
}
